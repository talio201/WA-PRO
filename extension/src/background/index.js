// Configs
const API_URL = 'http://localhost:3000/api';
const IDLE_POLLING_INTERVAL_MS = 10000; // Polling when queue is empty
const REALTIME_WS_URL = 'ws://localhost:3000/ws';
const REALTIME_RECONNECT_BASE_MS = 1200;
const QUEUE_ALARM_NAME = 'wa-manager-queue-next-run';
const DEFAULT_DELAY_RANGE = {
    minDelaySeconds: 0,
    maxDelaySeconds: 120,
};
const LONG_BREAK_MIN_MESSAGES = 8;
const LONG_BREAK_MAX_MESSAGES = 14;
const LONG_BREAK_MIN_MS = 65000;
const LONG_BREAK_MAX_MS = 210000;
const DEFAULT_EXTENSION_SETTINGS = {
    enableHumanizedTyping: true,
    enableLongBreaks: true,
    enableRealtimeToasts: true,
    softBlurOnIsland: true,
    manualPreSendDelayMs: 700,
    agentBridgePhone: '',
    agentBridgeChatQuery: '',
};

let isRunning = false;
let isProcessingQueue = false;
let isManualSendInProgress = false;
let nextRunTimeout = null;
// Track current scheduled queue run to avoid competing schedulers (realtime vs anti-ban).
let nextRunAt = null;
let nextRunReason = null;
let nextRunDelayMs = null;
let activeCampaignId = null;
let lastResolvedChat = null;
let focusWhatsAppOnNextQueueRun = false;
const inboundFingerprintCache = new Set();
let realtimeSocket = null;
let realtimeReconnectTimer = null;
let realtimeReconnectAttempt = 0;
let messagesSinceLongBreak = 0;
let nextLongBreakAt = null;
let realtimeConnectionState = 'disconnected';
let lastRealtimeEventAt = null;
let extensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };

// Listeners
chrome.runtime.onInstalled.addListener(() => {
    console.log('WhatsApp Campaign Manager Installed');
    chrome.storage.local.get(['isActive', ...Object.keys(DEFAULT_EXTENSION_SETTINGS)], (result) => {
        const patch = {};
        if (typeof result?.isActive !== 'boolean') {
            patch.isActive = false;
        }

        Object.entries(DEFAULT_EXTENSION_SETTINGS).forEach(([key, value]) => {
            if (result?.[key] === undefined) {
                patch[key] = value;
            }
        });

        applySettings(result || {});

        if (Object.keys(patch).length > 0) {
            chrome.storage.local.set(patch);
        }
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== QUEUE_ALARM_NAME) return;
    if (!isRunning) return;
    // Alarm has fired; allow schedule logic to create a fresh next run.
    nextRunAt = null;
    nextRunReason = null;
    nextRunDelayMs = null;
    processQueue();
});

function applySettings(raw = {}) {
    const merged = {
        ...DEFAULT_EXTENSION_SETTINGS,
        ...Object.fromEntries(
            Object.keys(DEFAULT_EXTENSION_SETTINGS)
                .map((key) => [key, raw[key]])
                .filter(([, value]) => value !== undefined),
        ),
    };

    extensionSettings = {
        ...merged,
        enableHumanizedTyping: toBoolean(merged.enableHumanizedTyping),
        enableLongBreaks: toBoolean(merged.enableLongBreaks),
        enableRealtimeToasts: toBoolean(merged.enableRealtimeToasts),
        softBlurOnIsland: toBoolean(merged.softBlurOnIsland),
        manualPreSendDelayMs: Math.max(100, Math.min(2500, Number(merged.manualPreSendDelayMs) || 700)),
        agentBridgePhone: digitsOnly(merged.agentBridgePhone),
        agentBridgeChatQuery: String(merged.agentBridgeChatQuery || '').trim(),
    };
}

function refreshSettingsFromStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(Object.keys(DEFAULT_EXTENSION_SETTINGS), (result) => {
            applySettings(result || {});
            resolve(extensionSettings);
        });
    });
}

function buildRuntimeStatePayload() {
    return {
        isActive: isRunning,
        realtimeStatus: realtimeConnectionState,
        isProcessingQueue,
        isManualSendInProgress,
        activeCampaignId,
        lastRealtimeEventAt,
        settings: { ...extensionSettings },
    };
}

function sendRuntimeMessage(payload) {
    try {
        chrome.runtime.sendMessage(payload, () => {
            // Reading lastError suppresses noisy "Receiving end does not exist" warnings
            // when popup/options pages are closed.
            const runtimeError = chrome.runtime?.lastError;
            if (!runtimeError) return;
            if (runtimeError.message?.includes('Receiving end does not exist')) return;
            if (runtimeError.message?.includes('Could not establish connection')) return;
        });
    } catch (error) {
        // Ignore runtime send errors.
    }
}

async function notifyWhatsAppTabs(message) {
    try {
        const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
        await Promise.all((tabs || []).map(async (tab) => {
            if (!tab?.id) return;
            try {
                await sendMessageToTab(tab.id, message);
            } catch (error) {
                // Ignore tabs without ready content script.
            }
        }));
    } catch (error) {
        // Ignore query/send failures.
    }
}

function broadcastRuntimeState() {
    const runtimeState = buildRuntimeStatePayload();
    sendRuntimeMessage({ action: 'RUNTIME_STATE_UPDATE', runtimeState });
    notifyWhatsAppTabs({ action: 'RUNTIME_STATE_UPDATE', runtimeState });
}

function pushGlassToast({ title, message, tone = 'info' }) {
    if (!extensionSettings.enableRealtimeToasts) return;
    notifyWhatsAppTabs({
        action: 'GLASS_TOAST',
        payload: {
            title: String(title || '').trim() || 'Atualização',
            message: String(message || '').trim() || '',
            tone,
            at: new Date().toISOString(),
        },
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const patch = {};
    Object.keys(DEFAULT_EXTENSION_SETTINGS).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
            patch[key] = changes[key]?.newValue;
        }
    });

    if (Object.keys(patch).length === 0) return;
    applySettings(patch);
    broadcastRuntimeState();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TOGGLE_STATUS') {
        request.value ? startQueue() : stopQueue();
        return false;
    }

    if (request.action === 'TRIGGER_CAMPAIGN_SEND') {
        const requestedCampaignId = String(request?.campaignId || '').trim();
        if (!requestedCampaignId) {
            sendResponse({ success: false, error: 'campaignId is required.' });
            return true;
        }

        startQueue({
            preferredCampaignId: requestedCampaignId,
            forceImmediate: true,
            focusTab: toBoolean(request?.focusTab),
        });

        sendResponse({
            success: true,
            runtimeState: buildRuntimeStatePayload(),
        });
        return true;
    }

    if (request.action === 'GET_RUNTIME_STATE') {
        sendResponse({ success: true, runtimeState: buildRuntimeStatePayload() });
        return true;
    }

    if (request.action === 'OPEN_OPTIONS_PAGE') {
        chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'SET_ACTIVE_CHAT_CONTEXT') {
        const phone = digitsOnly(request.phone);
        if (phone) {
            lastResolvedChat = {
                ...(lastResolvedChat || {}),
                phone,
            };
        }
        return false;
    }

    if (request.action === 'SEND_DIRECT_MESSAGE') {
        handleDirectSendRequest(request)
            .then((result) => sendResponse({ success: true, ...result }))
            .catch((error) => sendResponse({
                success: false,
                error: error?.message || 'Failed to send direct message.',
            }));
        return true;
    }

    if (request.action === 'SEND_DIRECT_MEDIA') {
        handleDirectMediaRequest(request)
            .then((result) => sendResponse({ success: true, ...result }))
            .catch((error) => sendResponse({
                success: false,
                error: error?.message || 'Failed to send direct media.',
            }));
        return true;
    }

    if (request.action === 'OPEN_CHAT_TOOL') {
        handleOpenChatToolRequest(request)
            .then((result) => sendResponse({ success: true, ...result }))
            .catch((error) => sendResponse({
                success: false,
                error: error?.message || 'Failed to open chat tool.',
            }));
        return true;
    }

    if (request.action === 'SYNC_CONVERSATION_HISTORY') {
        handleSyncConversationHistoryRequest(request)
            .then((result) => sendResponse({ success: true, ...result }))
            .catch((error) => sendResponse({
                success: false,
                error: error?.message || 'Failed to sync conversation history.',
            }));
        return true;
    }

    return false;
});

refreshSettingsFromStorage()
    .then(() => {
        chrome.storage.local.get(['isActive'], (result) => {
            if (result?.isActive) {
                startQueue();
                return;
            }

            broadcastRuntimeState();
        });
    })
    .catch(() => {
        broadcastRuntimeState();
    });

// Queue Management
function startQueue(options = {}) {
    const requestedCampaignId = String(options?.preferredCampaignId || '').trim() || null;
    const shouldFocusTab = toBoolean(options?.focusTab);
    const shouldForceImmediate = options?.forceImmediate !== false;
    const wasRunning = isRunning;

    if (!wasRunning) {
        console.log('Starting Queue...');
        refreshSettingsFromStorage().catch(() => {});
        isRunning = true;
        activeCampaignId = null;
        lastResolvedChat = null;
        resetHumanBreakState();
        connectRealtimeBridge();
        chrome.storage.local.set({ isActive: true });
    }

    if (requestedCampaignId) {
        activeCampaignId = requestedCampaignId;
    }

    if (shouldFocusTab) {
        focusWhatsAppOnNextQueueRun = true;
    }

    if (!wasRunning || shouldForceImmediate || requestedCampaignId) {
        scheduleNextRun(0, { reason: 'start', force: true });
    }

    broadcastRuntimeState();

    if (!wasRunning) {
        pushGlassToast({
            title: 'Fila ativada',
            message: 'Processamento de campanhas iniciado.',
            tone: 'success',
        });
        return;
    }

    if (requestedCampaignId) {
        pushGlassToast({
            title: 'Campanha priorizada',
            message: 'Disparo solicitado direto do dashboard.',
            tone: 'info',
        });
    }
}

function stopQueue() {
    if (!isRunning) return;

    console.log('Stopping Queue...');
    isRunning = false;
    activeCampaignId = null;
    lastResolvedChat = null;
    disconnectRealtimeBridge();
    chrome.storage.local.set({ isActive: false });
    broadcastRuntimeState();
    pushGlassToast({
        title: 'Fila pausada',
        message: 'Processamento automático interrompido.',
        tone: 'warning',
    });
    focusWhatsAppOnNextQueueRun = false;
    clearQueueSchedule();
}

function scheduleNextRun(delayMs = IDLE_POLLING_INTERVAL_MS, meta = {}) {
    if (!isRunning) return;

    const safeDelayMs = Math.max(0, Number(delayMs) || 0);
    const reason = String(meta?.reason || '').trim() || 'unknown';
    const force = Boolean(meta?.force);

    // If a next run is already scheduled earlier, keep it.
    const now = Date.now();
    const existingAt = Number(nextRunAt);
    const hasExisting = Number.isFinite(existingAt) && existingAt > (now + 25);
    const requestedAt = now + safeDelayMs;

    if (hasExisting) {
        if (requestedAt >= existingAt) {
            return;
        }

        // Realtime events should only wake an idle queue. Never override anti-ban sleeps.
        const existingReason = String(nextRunReason || '').trim() || 'unknown';
        if (!force && reason === 'realtime_wake' && existingReason !== 'idle') {
            return;
        }
    }

    clearQueueSchedule();

    try {
        const when = Date.now() + safeDelayMs;
        const scheduledAt = Math.max(Date.now() + 50, when);
        chrome.alarms.create(QUEUE_ALARM_NAME, {
            when: scheduledAt,
        });
        nextRunAt = scheduledAt;
        nextRunReason = reason;
        nextRunDelayMs = safeDelayMs;
        return;
    } catch (alarmError) {
        // Fallback for unexpected alarm API failures.
    }

    nextRunTimeout = setTimeout(() => {
        nextRunAt = null;
        nextRunReason = null;
        nextRunDelayMs = null;
        processQueue();
    }, safeDelayMs);
    nextRunAt = Date.now() + safeDelayMs;
    nextRunReason = reason;
    nextRunDelayMs = safeDelayMs;
}

function clearQueueSchedule() {
    if (nextRunTimeout) {
        clearTimeout(nextRunTimeout);
        nextRunTimeout = null;
    }
    nextRunAt = null;
    nextRunReason = null;
    nextRunDelayMs = null;

    try {
        chrome.alarms.clear(QUEUE_ALARM_NAME, () => {});
    } catch (alarmError) {
        // Ignore alarm clear errors.
    }
}

function resetHumanBreakState() {
    messagesSinceLongBreak = 0;
    nextLongBreakAt = randomBetween(LONG_BREAK_MIN_MESSAGES, LONG_BREAK_MAX_MESSAGES);
}

function recordOutboundSend() {
    if (!Number.isFinite(nextLongBreakAt)) {
        resetHumanBreakState();
    }

    messagesSinceLongBreak += 1;
}

function maybeApplyLongBreak(baseDelayMs) {
    const delay = Math.max(0, Number(baseDelayMs) || 0);
    if (!extensionSettings.enableLongBreaks) {
        return delay;
    }

    if (!Number.isFinite(nextLongBreakAt)) {
        resetHumanBreakState();
        return delay;
    }

    if (messagesSinceLongBreak < nextLongBreakAt) {
        return delay;
    }

    const breakMs = randomBetween(LONG_BREAK_MIN_MS, LONG_BREAK_MAX_MS);
    resetHumanBreakState();
    return delay + breakMs;
}

function clearRealtimeReconnectTimer() {
    if (!realtimeReconnectTimer) return;
    clearTimeout(realtimeReconnectTimer);
    realtimeReconnectTimer = null;
}

function disconnectRealtimeBridge() {
    clearRealtimeReconnectTimer();
    realtimeReconnectAttempt = 0;
    realtimeConnectionState = 'disconnected';

    if (!realtimeSocket) return;
    try {
        realtimeSocket.close();
    } catch (error) {
        // Ignore close errors.
    }
    realtimeSocket = null;
    broadcastRuntimeState();
}

function shouldWakeQueueByEvent(eventName) {
    if (!eventName) return false;

    if (eventName === 'campaign.created') return true;
    if (eventName === 'campaign.messages.queued') return true;
    if (eventName === 'messages.retried') return true;
    if (eventName === 'messages.edited') return true;
    if (eventName === 'messages.status.updated') return true;
    if (eventName === 'messages.outbound.manual_sent') return true;

    return false;
}

function handleRealtimeEnvelope(rawPayload) {
    try {
        const envelope = JSON.parse(String(rawPayload || '{}'));
        if (envelope?.type !== 'event') return;
        lastRealtimeEventAt = envelope.at || new Date().toISOString();
        broadcastRuntimeState();

        const eventName = String(envelope.event || '').trim();
        if (eventName === 'messages.inbound.received') {
            pushGlassToast({
                title: 'Nova resposta',
                message: 'Um cliente respondeu no atendimento.',
                tone: 'info',
            });
        }

        if (!isRunning) return;
        if (!shouldWakeQueueByEvent(eventName)) return;
        if (isProcessingQueue || isManualSendInProgress) return;

        scheduleNextRun(180, { reason: 'realtime_wake', eventName });
    } catch (error) {
        // Ignore malformed realtime payloads.
    }
}

function scheduleRealtimeReconnect() {
    if (!isRunning) return;
    if (realtimeReconnectTimer) return;

    const delayMs = Math.min(15000, (REALTIME_RECONNECT_BASE_MS * (2 ** realtimeReconnectAttempt)) + randomBetween(0, 420));
    realtimeReconnectAttempt += 1;

    realtimeReconnectTimer = setTimeout(() => {
        realtimeReconnectTimer = null;
        connectRealtimeBridge();
    }, delayMs);
}

function connectRealtimeBridge() {
    if (!isRunning) return;
    if (realtimeSocket && (realtimeSocket.readyState === WebSocket.OPEN || realtimeSocket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    clearRealtimeReconnectTimer();
    realtimeConnectionState = 'connecting';
    broadcastRuntimeState();

    try {
        const socket = new WebSocket(REALTIME_WS_URL);
        realtimeSocket = socket;

        socket.addEventListener('open', () => {
            realtimeReconnectAttempt = 0;
            realtimeConnectionState = 'connected';
            broadcastRuntimeState();
            pushGlassToast({
                title: 'Realtime conectado',
                message: 'WebSocket online com o backend.',
                tone: 'success',
            });
        });

        socket.addEventListener('message', (event) => {
            handleRealtimeEnvelope(event?.data);
        });

        socket.addEventListener('close', () => {
            if (realtimeSocket === socket) {
                realtimeSocket = null;
            }
            realtimeConnectionState = 'disconnected';
            broadcastRuntimeState();
            scheduleRealtimeReconnect();
        });

        socket.addEventListener('error', () => {
            try {
                socket.close();
            } catch (error) {
                // Ignore close errors after socket failures.
            }
        });
    } catch (error) {
        scheduleRealtimeReconnect();
    }
}

function getCampaignDelayRange(campaign) {
    const antiBan = campaign?.antiBan || {};

    let minDelaySeconds = Number(antiBan.minDelaySeconds);
    let maxDelaySeconds = Number(antiBan.maxDelaySeconds);

    if (!Number.isFinite(minDelaySeconds) || minDelaySeconds < 0) {
        minDelaySeconds = DEFAULT_DELAY_RANGE.minDelaySeconds;
    }

    if (!Number.isFinite(maxDelaySeconds) || maxDelaySeconds < 0) {
        maxDelaySeconds = DEFAULT_DELAY_RANGE.maxDelaySeconds;
    }

    if (maxDelaySeconds < minDelaySeconds) {
        [minDelaySeconds, maxDelaySeconds] = [maxDelaySeconds, minDelaySeconds];
    }

    return { minDelaySeconds, maxDelaySeconds };
}

function getRandomDelayMs(campaign) {
    const { minDelaySeconds, maxDelaySeconds } = getCampaignDelayRange(campaign);
    const minMs = Math.round(minDelaySeconds * 1000);
    const maxMs = Math.round(maxDelaySeconds * 1000);

    if (maxMs <= minMs) return minMs;

    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function randomBetween(min, max) {
    const safeMin = Number(min) || 0;
    const safeMax = Number(max) || safeMin;

    if (safeMax <= safeMin) return safeMin;
    return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

async function waitForDispatchSlot(timeoutMs = 20000) {
    const start = Date.now();
    const timeout = Math.max(1000, Number(timeoutMs) || 20000);

    while (isProcessingQueue || isManualSendInProgress) {
        if ((Date.now() - start) >= timeout) {
            if (isProcessingQueue) {
                throw new Error('A fila esta processando agora. Tente novamente em alguns segundos.');
            }

            throw new Error('Ainda existe um envio manual em andamento. Aguarde um pouco e tente novamente.');
        }

        await sleep(220);
    }

    isManualSendInProgress = true;
    broadcastRuntimeState();
}

function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function isSamePhoneLoose(left, right) {
    const leftDigits = digitsOnly(left);
    const rightDigits = digitsOnly(right);
    if (!leftDigits || !rightDigits) return false;
    if (leftDigits === rightDigits) return true;

    const leftTail = leftDigits.slice(-10);
    const rightTail = rightDigits.slice(-10);
    return Boolean(leftTail && rightTail && leftTail === rightTail);
}

function extractCampaignId(jobCampaign) {
    if (!jobCampaign) return null;
    return typeof jobCampaign === 'string' ? jobCampaign : jobCampaign._id || null;
}

async function waitForTabSettled(tabId, timeoutMs = 15000) {
    const start = Date.now();

    while ((Date.now() - start) < timeoutMs) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab?.status === 'complete') {
                return tab;
            }
        } catch (error) {
            break;
        }

        await sleep(300);
    }

    try {
        return await chrome.tabs.get(tabId);
    } catch (error) {
        return null;
    }
}

async function ensureWhatsAppTab(options = {}) {
    const shouldFocus = toBoolean(options.focus);
    const existing = await findWhatsAppTab();
    if (existing) {
        await waitForTabSettled(existing.id, 8000);
        if (shouldFocus) {
            try {
                await chrome.tabs.update(existing.id, { active: true });
                if (existing.windowId) {
                    await chrome.windows.update(existing.windowId, { focused: true });
                }
            } catch (error) {
                // Focus is best-effort only.
            }
        }
        return existing;
    }

    const created = await chrome.tabs.create({
        url: 'https://web.whatsapp.com/',
        active: shouldFocus,
    });
    if (!created?.id) return null;

    await waitForTabSettled(created.id, 20000);
    await sleep(1200);
    return created;
}

function buildSearchTermsForPhone(phone) {
    const normalized = digitsOnly(phone);
    if (!normalized) return [];

    const terms = new Set([
        normalized,
        `+${normalized}`,
    ]);

    if (normalized.startsWith('55') && normalized.length > 2) {
        terms.add(normalized.slice(2));
        terms.add(`+55${normalized.slice(2)}`);
    }

    return Array.from(terms);
}

async function openChatForCampaignJob(tab, job) {
    if (!tab?.id) {
        return { success: false, error: 'WhatsApp tab unavailable.' };
    }

    const targetPhone = digitsOnly(job?.phone);
    if (!targetPhone) {
        return { success: false, error: 'Invalid campaign phone.' };
    }

    await refreshSettingsFromStorage().catch(() => {});

    const bridgePhone = digitsOnly(extensionSettings.agentBridgePhone);
    const bridgeChatQuery = String(extensionSettings.agentBridgeChatQuery || '').trim();
    if (!bridgePhone && !bridgeChatQuery) {
        return {
            success: false,
            error: 'Configure o chat do agente (bridge) nas configuracoes para enviar campanhas.',
        };
    }

    const contentReady = await waitForContentScriptReady(tab.id, 18000);
    if (!contentReady) {
        return {
            success: false,
            transient: true,
            error: 'WhatsApp ainda carregando. Tente novamente em instantes.',
        };
    }

    // If the same target chat is already focused and ready, avoid re-running the full bridge flow.
    if (lastResolvedChat?.tabId === tab.id && isSamePhoneLoose(lastResolvedChat.phone, targetPhone)) {
        try {
            const activeContext = await sendMessageToTabWithRetry(tab.id, {
                action: 'GET_ACTIVE_CHAT_CONTEXT',
                phone: targetPhone,
            }, 2, 220);

            if (activeContext?.success && activeContext?.composerReady) {
                const activePhone = digitsOnly(activeContext.phone || '');
                if (activeContext.matchesTarget || !activePhone) {
                    return {
                        success: true,
                        targetPhone,
                        strategy: 'cached_chat',
                    };
                }
            }
        } catch (error) {
            // Ignore and continue with bridge flow.
        }
    }

    try {
        const agentSearchTerms = [
            ...(bridgeChatQuery ? [bridgeChatQuery] : []),
            ...(bridgePhone ? buildSearchTermsForPhone(bridgePhone) : []),
        ];

        const bridgeResult = await sendMessageToTabWithRetry(tab.id, {
            action: 'OPEN_CHAT_VIA_AGENT_BRIDGE',
            agentPhone: bridgePhone || '',
            agentQuery: bridgeChatQuery || '',
            targetPhone,
            humanized: Boolean(extensionSettings.enableHumanizedTyping),
            agentSearchTerms,
        }, 6, 500);

        if (bridgeResult?.success) {
            lastResolvedChat = { tabId: tab.id, phone: targetPhone };
            await sleep(randomBetween(320, 800));
            return {
                success: true,
                targetPhone,
                strategy: 'agent_bridge',
            };
        }

        return {
            success: false,
            error: bridgeResult?.error || 'Falha no fluxo bridge via agent-id.',
        };
    } catch (bridgeError) {
        return {
            success: false,
            error: bridgeError?.message || 'Falha no fluxo bridge via agent-id.',
        };
    }
}

async function handleDirectSendRequest(request = {}) {
    const phone = digitsOnly(request.phone);
    const message = String(request.message || '').trim();
    const shouldFocusTab = toBoolean(request.focusTab);

    if (!phone) {
        throw new Error('Telefone invalido para envio direto.');
    }

    if (!message) {
        throw new Error('Mensagem vazia para envio direto.');
    }

    await waitForDispatchSlot();

    try {
        const tab = await ensureWhatsAppTab({ focus: shouldFocusTab });
        if (!tab?.id) {
            throw new Error('Nao foi possivel abrir o WhatsApp Web.');
        }

        const navigation = await openChatForCampaignJob(tab, { phone });
        if (!navigation?.success) {
            throw new Error(navigation?.error || 'Falha ao abrir conversa via agent-id.');
        }

        const basePreDelay = Number(extensionSettings.manualPreSendDelayMs || 700);
        const preSendPauseMs = Math.max(120, basePreDelay + randomBetween(-220, 260));
        await sleep(preSendPauseMs);

        const result = await sendMessageToTabWithRetry(tab.id, {
            action: 'CLICK_SEND',
            message,
            humanized: Boolean(extensionSettings.enableHumanizedTyping),
            source: 'manual_inbox',
        }, 3, 450);

        if (!result || !result.success) {
            lastResolvedChat = null;
            throw new Error(result?.error || 'Falha ao enviar mensagem no WhatsApp Web.');
        }

        lastResolvedChat = { tabId: tab.id, phone };
        await sleep(randomBetween(480, 1300));
        await captureInboundForTab(tab);
        recordOutboundSend();

        return {
            phone,
            sentAt: new Date().toISOString(),
            humanized: true,
            delivery: {
                preSendPauseMs,
            },
        };
    } finally {
        isManualSendInProgress = false;
        broadcastRuntimeState();
    }
}

function validateImageMedia(media = {}) {
    if (!media || typeof media !== 'object') {
        throw new Error('Midia invalida para envio.');
    }

    const fileUrl = String(media.fileUrl || '').trim();
    const mimetype = String(media.mimetype || '').trim().toLowerCase();

    if (!fileUrl) {
        throw new Error('Arquivo sem URL para envio.');
    }

    if (!mimetype.startsWith('image/')) {
        throw new Error('Somente imagens sao suportadas neste botao por enquanto.');
    }

    return { fileUrl, mimetype };
}

async function handleDirectMediaRequest(request = {}) {
    const phone = digitsOnly(request.phone);
    const caption = String(request.caption || '').trim();
    const media = validateImageMedia(request.media || {});
    const shouldFocusTab = toBoolean(request.focusTab);

    if (!phone) {
        throw new Error('Telefone invalido para envio de midia.');
    }

    await waitForDispatchSlot();

    try {
        const tab = await ensureWhatsAppTab({ focus: shouldFocusTab });
        if (!tab?.id) {
            throw new Error('Nao foi possivel abrir o WhatsApp Web.');
        }

        const navigation = await openChatForCampaignJob(tab, { phone });
        if (!navigation?.success) {
            throw new Error(navigation?.error || 'Falha ao abrir conversa via agent-id.');
        }
        await sleep(randomBetween(250, 650));

        const mediaResult = await sendMessageToTabWithRetry(tab.id, {
            action: 'PASTE_MEDIA',
            media,
        }, 2, 350);

        if (!mediaResult || !mediaResult.success) {
            throw new Error(mediaResult?.error || 'Falha ao anexar imagem no WhatsApp Web.');
        }

        await sleep(randomBetween(650, 1400));

        const result = await sendMessageToTabWithRetry(tab.id, {
            action: 'CLICK_SEND',
            message: caption || null,
            humanized: Boolean(extensionSettings.enableHumanizedTyping),
            source: 'manual_inbox_media',
        }, 3, 450);

        if (!result || !result.success) {
            throw new Error(result?.error || 'Falha ao enviar imagem no WhatsApp Web.');
        }

        lastResolvedChat = { tabId: tab.id, phone };
        await sleep(randomBetween(500, 1200));
        await captureInboundForTab(tab);
        recordOutboundSend();

        return {
            phone,
            sentAt: new Date().toISOString(),
            humanized: true,
            media: {
                mimetype: media.mimetype,
                fileUrl: media.fileUrl,
            },
        };
    } finally {
        isManualSendInProgress = false;
        broadcastRuntimeState();
    }
}

async function handleOpenChatToolRequest(request = {}) {
    const phone = digitsOnly(request.phone);
    const tool = String(request.tool || '').trim().toLowerCase();

    if (!phone) {
        throw new Error('Telefone invalido para abrir ferramenta do chat.');
    }

    const supportedTools = new Set(['emoji', 'attach', 'mic']);
    if (!supportedTools.has(tool)) {
        throw new Error('Ferramenta de chat nao suportada.');
    }

    const tab = await ensureWhatsAppTab({ focus: true });
    if (!tab?.id) {
        throw new Error('Nao foi possivel abrir o WhatsApp Web.');
    }

    const navigation = await openChatForCampaignJob(tab, { phone });
    if (!navigation?.success) {
        throw new Error(navigation?.error || 'Falha ao abrir conversa via agent-id.');
    }
    await sleep(randomBetween(300, 700));

    const toolResult = await sendMessageToTabWithRetry(tab.id, {
        action: 'FOCUS_CHAT_TOOL',
        tool,
    }, 2, 350);

    if (!toolResult || !toolResult.success) {
        throw new Error(toolResult?.error || `Nao foi possivel abrir a ferramenta: ${tool}.`);
    }

    return {
        phone,
        tool,
        openedAt: new Date().toISOString(),
    };
}

async function handleSyncConversationHistoryRequest(request = {}) {
    const phone = digitsOnly(request.phone);
    const shouldFocusTab = toBoolean(request.focusTab);
    const parsedLimit = Number(request.limit);
    const safeLimit = Number.isFinite(parsedLimit)
        ? Math.max(50, Math.min(parsedLimit, 4000))
        : 1200;

    if (!phone) {
        throw new Error('Telefone invalido para sincronizar historico.');
    }

    const tab = await ensureWhatsAppTab({ focus: shouldFocusTab });
    if (!tab?.id) {
        throw new Error('Nao foi possivel abrir o WhatsApp Web.');
    }

    const navigation = await openChatForCampaignJob(tab, { phone });
    if (!navigation?.success) {
        throw new Error(navigation?.error || 'Falha ao abrir conversa via agent-id.');
    }
    await sleep(randomBetween(450, 1100));

    const snapshot = await sendMessageToTabWithRetry(tab.id, {
        action: 'CAPTURE_CHAT_HISTORY',
        phone,
        limit: safeLimit,
        preloadOlder: true,
    }, 3, 450);

    if (!snapshot || !snapshot.success) {
        throw new Error(snapshot?.error || 'Falha ao capturar historico no WhatsApp Web.');
    }

    return {
        phone: snapshot.phone || phone,
        name: snapshot.name || '',
        messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
        syncedAt: new Date().toISOString(),
    };
}

async function fetchNextJob(preferredCampaignId = null) {
    const queryString = preferredCampaignId
        ? `?campaignId=${encodeURIComponent(preferredCampaignId)}`
        : '';

    const response = await fetch(`${API_URL}/messages/next${queryString}`);

    if (!response.ok) {
        throw new Error(`Failed to fetch next job: ${response.status}`);
    }

    const data = await response.json();
    return data.job || null;
}

async function registerInboundReply(payload) {
    const response = await fetch(`${API_URL}/messages/inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to register inbound reply (${response.status}): ${body}`);
    }
}

async function captureInboundForTab(tab) {
    if (!tab) return;

    try {
        const expectedPhone = lastResolvedChat?.phone || '';
        const capture = await sendMessageToTabWithRetry(tab.id, {
            action: 'CAPTURE_INBOUND',
            phone: expectedPhone,
            limit: 30,
        }, 2, 350);

        if (!capture || !capture.success) return;

        const resolvedPhone = digitsOnly(capture.phone || expectedPhone);
        if (!resolvedPhone) return;

        const inboundMessages = Array.isArray(capture.messages) ? capture.messages : [];
        for (const item of inboundMessages) {
            const text = String(item?.text || '').trim();
            if (!text) continue;

            const fingerprint = String(item?.fingerprint || `${resolvedPhone}|${text}`);
            if (inboundFingerprintCache.has(fingerprint)) continue;
            inboundFingerprintCache.add(fingerprint);

            if (inboundFingerprintCache.size > 2000) {
                inboundFingerprintCache.clear();
                inboundFingerprintCache.add(fingerprint);
            }

            try {
                await registerInboundReply({
                    phone: resolvedPhone,
                    name: capture.name || '',
                    text,
                    at: item?.at || new Date().toISOString(),
                    campaignId: activeCampaignId || null,
                    source: 'whatsapp_web_monitor',
                });
            } catch (inboundError) {
                console.error('Failed to register inbound reply:', inboundError);
            }
        }
    } catch (error) {
        // Content script not ready in this tab or selector mismatch.
    }
}

async function processQueue() {
    if (!isRunning || isProcessingQueue) return;

    if (isManualSendInProgress) {
        scheduleNextRun(1500, { reason: 'manual_lock' });
        return;
    }

    isProcessingQueue = true;
    broadcastRuntimeState();
    let nextDelayMs = IDLE_POLLING_INTERVAL_MS;
    let nextRunScheduleReason = 'idle';
    // If we reserve a job but fail before updating its final status, we must requeue it
    // to avoid leaving messages stuck in "processing" forever.
    let reservedJob = null;

    try {
        const monitorTab = await findWhatsAppTab();
        if (monitorTab) {
            await captureInboundForTab(monitorTab);
        }

        // 1. Get Next Job (stick to current campaign while it has pending jobs)
        let job = await fetchNextJob(activeCampaignId);
        reservedJob = job;

        if (!job && activeCampaignId) {
            console.log(`No pending jobs for active campaign ${activeCampaignId}.`);
            activeCampaignId = null;
            job = await fetchNextJob();
            reservedJob = job;
        }

        if (!job) {
            console.log('No jobs pending.');
            return;
        }
        console.log('Processing Job:', job);
        activeCampaignId = extractCampaignId(job.campaign) || activeCampaignId;
        broadcastRuntimeState();

        // 2. Ensure WhatsApp tab (open automatically if needed)
        const shouldFocusQueueRun = focusWhatsAppOnNextQueueRun;
        focusWhatsAppOnNextQueueRun = false;
        const tab = await ensureWhatsAppTab({ focus: shouldFocusQueueRun });
        if (!tab) {
            console.log('WhatsApp Web tab not available.');
            await updateJobStatus(job._id, 'failed', 'WhatsApp Web tab unavailable');
            lastResolvedChat = null;
            pushGlassToast({
                title: 'Envio falhou',
                message: 'Nao foi possivel abrir o WhatsApp Web para continuar.',
                tone: 'error',
            });
            return;
        }

        // 3. Campaign navigation:
        // Only bridge flow via own agent chat (no direct link fallback).
        const navigation = await openChatForCampaignJob(tab, job);
        if (!navigation?.success) {
            const navigationError = String(navigation?.error || '').trim();
            const normalizedNavigationError = navigationError.toLowerCase();
            const attemptCount = Math.max(1, Number(job?.attemptCount) || 1);
            const maxBridgeRetries = 3;

            const isBridgeConfigurationIssue = (
                normalizedNavigationError.includes('configure o chat do agente')
                || normalizedNavigationError.includes('configure o numero do agente')
                || normalizedNavigationError.includes('agent bridge chat is required')
            );

            const isBridgeTransientIssue = (
                Boolean(navigation?.transient)
                || normalizedNavigationError.includes('search box not found')
                || normalizedNavigationError.includes('not found in contacts')
                || normalizedNavigationError.includes('no search term available')
                || normalizedNavigationError.includes('chat open validation failed')
                || normalizedNavigationError.includes('could not find sent number message')
                || normalizedNavigationError.includes('could not click phone in self chat message')
                || normalizedNavigationError.includes('could not find "conversar com" option')
                || normalizedNavigationError.includes('conversation option not found')
                || normalizedNavigationError.includes('did not enter new chat')
                || normalizedNavigationError.includes('bridge flow stayed in agent chat')
                || normalizedNavigationError.includes('message composer not ready')
                || normalizedNavigationError.includes('message box not found')
                || normalizedNavigationError.includes('send button not found')
            );

            if (isBridgeConfigurationIssue) {
                // Do not auto-pause the queue on configuration issues. Mark this job as failed
                // and keep the worker active for subsequent jobs/campaigns.
                await updateJobStatus(job._id, 'failed', navigationError || 'Falha de configuracao do bridge.');
                reservedJob = null;
                lastResolvedChat = null;
                pushGlassToast({
                    title: 'Envio bloqueado',
                    message: navigationError || 'Nao foi possivel abrir o chat do agente (bridge).',
                    tone: 'error',
                });
                return;
            }

            if (isBridgeTransientIssue) {
                if (attemptCount >= maxBridgeRetries) {
                    await updateJobStatus(job._id, 'failed', navigationError || 'Falha transiente no fluxo bridge.');
                    reservedJob = null;
                    lastResolvedChat = null;
                    pushGlassToast({
                        title: 'Falha no bridge',
                        message: navigationError || 'Nao foi possivel abrir o chat de destino apos varias tentativas.',
                        tone: 'error',
                    });
                    return;
                }

                nextDelayMs = 4000;
                nextRunScheduleReason = 'bridge_retry';
                await updateJobStatus(job._id, 'pending', navigationError || 'Bridge transient retry');
                reservedJob = null;
                lastResolvedChat = null;
                pushGlassToast({
                    title: 'Retentando envio',
                    message: navigationError || 'Falha temporaria ao abrir conversa. Nova tentativa em instantes.',
                    tone: 'warning',
                });
                return;
            }

            await updateJobStatus(job._id, 'failed', navigationError || 'Falha ao abrir conversa da campanha.');
            reservedJob = null;
            lastResolvedChat = null;
            pushGlassToast({
                title: 'Falha no envio',
                message: navigationError || 'Nao foi possivel abrir a conversa no WhatsApp.',
                tone: 'error',
            });
            return;
        }

        const navigationStrategy = String(navigation.strategy || 'unknown');
        console.log(`Campaign chat opened for ${job.phone} using strategy: ${navigationStrategy}.`);

        // 4. Send Media (if exists)
        if (job.campaign && job.campaign.media) {
            console.log('Sending campaign media...');
            const mediaResult = await sendMessageToTabWithRetry(tab.id, {
                action: 'PASTE_MEDIA',
                media: job.campaign.media,
            }, 2, 350);

            if (mediaResult?.success) {
                await sleep(randomBetween(800, 1700));
            } else {
                console.warn('Media attach failed, sending text only:', mediaResult?.error || mediaResult);
            }
        }

        // 5. Send Message & Click Send
        try {
            const messageToType = String(job.processedMessage || '').trim() || null;

            const result = await sendMessageToTabWithRetry(tab.id, {
                action: 'CLICK_SEND',
                message: messageToType,
                humanized: Boolean(extensionSettings.enableHumanizedTyping),
                paste: true,
                source: 'queue_campaign',
            }, 3, 450);

            const status = result && result.success ? 'sent' : 'failed';
            const errorMessage = result && result.error ? result.error : null;
            const attemptCount = Math.max(1, Number(job?.attemptCount) || 1);
            const maxSendRetries = 3;

            const normalizedSendError = String(errorMessage || '').toLowerCase();
            const isTransientSendError = (
                normalizedSendError.includes('message box not found')
                || normalizedSendError.includes('message composer not ready')
                || normalizedSendError.includes('send button not found')
                || normalizedSendError.includes('failed to click send button')
                || normalizedSendError.includes('text insertion failed')
                || normalizedSendError.includes('message text not present in composer')
            );

            if (status === 'failed' && isTransientSendError) {
                if (attemptCount >= maxSendRetries) {
                    await updateJobStatus(job._id, 'failed', errorMessage || 'Falha transiente de envio apos varias tentativas.');
                    reservedJob = null;
                    lastResolvedChat = null;
                    pushGlassToast({
                        title: 'Falha no envio',
                        message: errorMessage || `Nao foi possivel enviar para ${job.phone} apos varias tentativas.`,
                        tone: 'error',
                    });
                    return;
                }

                nextDelayMs = 3200;
                nextRunScheduleReason = 'send_retry';
                await updateJobStatus(job._id, 'pending', errorMessage || 'Transient send retry');
                reservedJob = null;
                pushGlassToast({
                    title: 'Retentando envio',
                    message: errorMessage || `Falha temporaria ao enviar para ${job.phone}.`,
                    tone: 'warning',
                });
                return;
            }

            await updateJobStatus(job._id, status, errorMessage);
            reservedJob = null;

            if (status === 'sent') {
                recordOutboundSend();
                pushGlassToast({
                    title: 'Mensagem enviada',
                    message: `Contato ${job.phone} processado com sucesso (${navigationStrategy}).`,
                    tone: 'success',
                });
            } else {
                lastResolvedChat = null;
                pushGlassToast({
                    title: 'Falha no envio',
                    message: errorMessage || `Não foi possível enviar para ${job.phone}.`,
                    tone: 'error',
                });
            }

            await captureInboundForTab(tab);
        } catch (error) {
            console.error('Error executing job in content script:', error);
            await updateJobStatus(job._id, 'failed', error.message);
            reservedJob = null;
            lastResolvedChat = null;
            pushGlassToast({
                title: 'Falha no envio',
                message: String(error.message || 'Erro ao enviar mensagem na fila.'),
                tone: 'error',
            });
        }

        // 6. Randomized anti-ban delay for next message + occasional long break.
        nextDelayMs = getRandomDelayMs(job.campaign);
        nextDelayMs = maybeApplyLongBreak(nextDelayMs);
        nextRunScheduleReason = 'anti_ban';
        const nextDelaySeconds = Math.round(nextDelayMs / 1000);
        console.log(`Next message will be processed in ${nextDelaySeconds}s`);
    } catch (error) {
        console.error('Error in processQueue:', error);
        if (reservedJob && reservedJob._id) {
            // Best-effort requeue to avoid "processing" deadlocks.
            try {
                await updateJobStatus(reservedJob._id, 'pending');
            } catch (requeueError) {
                // Ignore secondary failures.
            }
        }
    } finally {
        isProcessingQueue = false;
        broadcastRuntimeState();
        scheduleNextRun(nextDelayMs, { reason: nextRunScheduleReason });
    }
}

// Helper Sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helpers
async function findWhatsAppTab() {
    const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    return tabs.length > 0 ? tabs[0] : null;
}

function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

async function waitForContentScriptReady(tabId, timeoutMs = 15000) {
    const timeout = Math.max(1200, Number(timeoutMs) || 15000);
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeout) {
        try {
            const response = await sendMessageToTab(tabId, { action: 'PING' });
            if (response?.ready || response?.success) {
                return true;
            }
        } catch (error) {
            // Keep waiting while WhatsApp/content script initializes.
        }

        await sleep(350);
    }

    return false;
}

async function sendMessageToTabWithRetry(tabId, message, attempts = 3, delayMs = 450) {
    const totalAttempts = Math.max(1, Number(attempts) || 1);

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            return await sendMessageToTab(tabId, message);
        } catch (error) {
            const isLast = attempt >= totalAttempts;
            if (isLast) throw error;
            await sleep(delayMs);
        }
    }

    return null;
}

async function updateJobStatus(id, status, error) {
    try {
        const response = await fetch(`${API_URL}/messages/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, error }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Status update failed (${response.status}): ${body}`);
        }
    } catch (updateError) {
        console.error('Failed to update job status:', updateError);
    }
}
