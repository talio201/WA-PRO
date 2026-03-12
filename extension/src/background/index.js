import {
  getAuthorizedHeaders,
  getRuntimeConfig,
} from "../utils/runtimeConfig.js";

const IDLE_POLLING_INTERVAL_MS = 10000;
const REALTIME_RECONNECT_BASE_MS = 1200;
const QUEUE_ALARM_NAME = "wa-manager-queue-next-run";
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
  agentBridgePhone: "",
  agentBridgeChatQuery: "",
};
let isRunning = false;
let isProcessingQueue = false;
let isManualSendInProgress = false;
let nextRunTimeout = null;
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
let realtimeConnectionState = "disconnected";
let lastRealtimeEventAt = null;
let extensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };
async function buildApiUrl(pathname = "") {
  const { backendApiUrl } = await getRuntimeConfig();
  return `${backendApiUrl}${pathname}`;
}
async function buildRealtimeUrl() {
  const { backendWsUrl, backendApiKey, agentId } = await getRuntimeConfig();
  const url = new URL(backendWsUrl);
  if (backendApiKey) {
    url.searchParams.set("access_token", backendApiKey);
  }
  if (agentId) {
    url.searchParams.set("agentId", agentId);
  }
  return url.toString();
}
chrome.runtime.onInstalled.addListener(() => {
  console.log("WhatsApp Campaign Manager Installed");
  chrome.storage.local.get(
    ["isActive", ...Object.keys(DEFAULT_EXTENSION_SETTINGS)],
    (result) => {
      const patch = {};
      if (typeof result?.isActive !== "boolean") {
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
    },
  );
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== QUEUE_ALARM_NAME) return;
  if (!isRunning) return;
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
    manualPreSendDelayMs: Math.max(
      100,
      Math.min(2500, Number(merged.manualPreSendDelayMs) || 700),
    ),
    agentBridgePhone: digitsOnly(merged.agentBridgePhone),
    agentBridgeChatQuery: String(merged.agentBridgeChatQuery || "").trim(),
  };
}
function refreshSettingsFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      Object.keys(DEFAULT_EXTENSION_SETTINGS),
      (result) => {
        applySettings(result || {});
        resolve(extensionSettings);
      },
    );
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
      const runtimeError = chrome.runtime?.lastError;
      if (!runtimeError) return;
      if (runtimeError.message?.includes("Receiving end does not exist"))
        return;
      if (runtimeError.message?.includes("Could not establish connection"))
        return;
    });
  } catch (error) {}
}
async function notifyWhatsAppTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });
    await Promise.all(
      (tabs || []).map(async (tab) => {
        if (!tab?.id) return;
        try {
          await sendMessageToTab(tab.id, message);
        } catch (error) {}
      }),
    );
  } catch (error) {}
}
function broadcastRuntimeState() {
  const runtimeState = buildRuntimeStatePayload();
  sendRuntimeMessage({ action: "RUNTIME_STATE_UPDATE", runtimeState });
  notifyWhatsAppTabs({ action: "RUNTIME_STATE_UPDATE", runtimeState });
}
function pushGlassToast({ title, message, tone = "info" }) {
  if (!extensionSettings.enableRealtimeToasts) return;
  notifyWhatsAppTabs({
    action: "GLASS_TOAST",
    payload: {
      title: String(title || "").trim() || "Atualização",
      message: String(message || "").trim() || "",
      tone,
      at: new Date().toISOString(),
    },
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
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
  if (request.action === "TOGGLE_STATUS") {
    request.value ? startQueue() : stopQueue();
    return false;
  }
  if (request.action === "TRIGGER_CAMPAIGN_SEND") {
    const requestedCampaignId = String(request?.campaignId || "").trim();
    if (!requestedCampaignId) {
      sendResponse({ success: false, error: "campaignId is required." });
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
  if (request.action === "GET_RUNTIME_STATE") {
    sendResponse({ success: true, runtimeState: buildRuntimeStatePayload() });
    return true;
  }
  if (request.action === "OPEN_OPTIONS_PAGE") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "SET_ACTIVE_CHAT_CONTEXT") {
    const phone = digitsOnly(request.phone);
    if (phone) {
      lastResolvedChat = {
        ...(lastResolvedChat || {}),
        phone,
      };
    }
    return false;
  }
  if (request.action === "SEND_DIRECT_MESSAGE") {
    handleDirectSendRequest(request)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error?.message || "Failed to send direct message.",
        }),
      );
    return true;
  }
  if (request.action === "SEND_DIRECT_MEDIA") {
    handleDirectMediaRequest(request)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error?.message || "Failed to send direct media.",
        }),
      );
    return true;
  }
  if (request.action === "OPEN_CHAT_TOOL") {
    handleOpenChatToolRequest(request)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error?.message || "Failed to open chat tool.",
        }),
      );
    return true;
  }
  if (request.action === "SYNC_CONVERSATION_HISTORY") {
    handleSyncConversationHistoryRequest(request)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error?.message || "Failed to sync conversation history.",
        }),
      );
    return true;
  }
  return false;
});
refreshSettingsFromStorage()
  .then(() => {
    chrome.storage.local.get(["isActive"], (result) => {
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
function startQueue(options = {}) {
  const requestedCampaignId =
    String(options?.preferredCampaignId || "").trim() || null;
  const shouldFocusTab = toBoolean(options?.focusTab);
  const shouldForceImmediate = options?.forceImmediate !== false;
  const wasRunning = isRunning;
  if (!wasRunning) {
    console.log("Starting Queue...");
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
    scheduleNextRun(0, { reason: "start", force: true });
  }
  broadcastRuntimeState();
  if (!wasRunning) {
    pushGlassToast({
      title: "Fila ativada",
      message: "Processamento de campanhas iniciado.",
      tone: "success",
    });
    return;
  }
  if (requestedCampaignId) {
    pushGlassToast({
      title: "Campanha priorizada",
      message: "Disparo solicitado direto do dashboard.",
      tone: "info",
    });
  }
}
function stopQueue() {
  if (!isRunning) return;
  console.log("Stopping Queue...");
  isRunning = false;
  activeCampaignId = null;
  lastResolvedChat = null;
  disconnectRealtimeBridge();
  chrome.storage.local.set({ isActive: false });
  broadcastRuntimeState();
  pushGlassToast({
    title: "Fila pausada",
    message: "Processamento automático interrompido.",
    tone: "warning",
  });
  focusWhatsAppOnNextQueueRun = false;
  clearQueueSchedule();
}
function scheduleNextRun(delayMs = IDLE_POLLING_INTERVAL_MS, meta = {}) {
  if (!isRunning) return;
  const safeDelayMs = Math.max(0, Number(delayMs) || 0);
  const reason = String(meta?.reason || "").trim() || "unknown";
  const force = Boolean(meta?.force);
  const now = Date.now();
  const existingAt = Number(nextRunAt);
  const hasExisting = Number.isFinite(existingAt) && existingAt > now + 25;
  const requestedAt = now + safeDelayMs;
  if (hasExisting) {
    if (requestedAt >= existingAt) {
      return;
    }
    const existingReason = String(nextRunReason || "").trim() || "unknown";
    if (!force && reason === "realtime_wake" && existingReason !== "idle") {
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
  } catch (alarmError) {}
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
  } catch (alarmError) {}
}
function resetHumanBreakState() {
  messagesSinceLongBreak = 0;
  nextLongBreakAt = randomBetween(
    LONG_BREAK_MIN_MESSAGES,
    LONG_BREAK_MAX_MESSAGES,
  );
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
  realtimeConnectionState = "disconnected";
  if (!realtimeSocket) return;
  try {
    realtimeSocket.close();
  } catch (error) {}
  realtimeSocket = null;
  broadcastRuntimeState();
}
function shouldWakeQueueByEvent(eventName) {
  if (!eventName) return false;
  if (eventName === "campaign.created") return true;
  if (eventName === "campaign.messages.queued") return true;
  if (eventName === "messages.retried") return true;
  if (eventName === "messages.edited") return true;
  if (eventName === "messages.status.updated") return true;
  if (eventName === "messages.outbound.manual_sent") return true;
  return false;
}
function handleRealtimeEnvelope(rawPayload) {
  try {
    const envelope = JSON.parse(String(rawPayload || "{}"));
    if (envelope?.type !== "event") return;
    lastRealtimeEventAt = envelope.at || new Date().toISOString();
    broadcastRuntimeState();
    const eventName = String(envelope.event || "").trim();
    if (eventName === "messages.inbound.received") {
      pushGlassToast({
        title: "Nova resposta",
        message: "Um cliente respondeu no atendimento.",
        tone: "info",
      });
    }
    if (!isRunning) return;
    if (!shouldWakeQueueByEvent(eventName)) return;
    if (isProcessingQueue || isManualSendInProgress) return;
    scheduleNextRun(180, { reason: "realtime_wake", eventName });
  } catch (error) {}
}
function scheduleRealtimeReconnect() {
  if (!isRunning) return;
  if (realtimeReconnectTimer) return;
  const delayMs = Math.min(
    15000,
    REALTIME_RECONNECT_BASE_MS * 2 ** realtimeReconnectAttempt +
      randomBetween(0, 420),
  );
  realtimeReconnectAttempt += 1;
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null;
    connectRealtimeBridge();
  }, delayMs);
}
async function connectRealtimeBridge() {
  if (!isRunning) return;
  if (
    realtimeSocket &&
    (realtimeSocket.readyState === WebSocket.OPEN ||
      realtimeSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  clearRealtimeReconnectTimer();
  realtimeConnectionState = "connecting";
  broadcastRuntimeState();
  try {
    const socket = new WebSocket(await buildRealtimeUrl());
    realtimeSocket = socket;
    socket.addEventListener("open", () => {
      realtimeReconnectAttempt = 0;
      realtimeConnectionState = "connected";
      broadcastRuntimeState();
      pushGlassToast({
        title: "Realtime conectado",
        message: "WebSocket online com o backend.",
        tone: "success",
      });
    });
    socket.addEventListener("message", (event) => {
      handleRealtimeEnvelope(event?.data);
    });
    socket.addEventListener("close", () => {
      if (realtimeSocket === socket) {
        realtimeSocket = null;
      }
      realtimeConnectionState = "disconnected";
      broadcastRuntimeState();
      scheduleRealtimeReconnect();
    });
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch (error) {}
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
    if (Date.now() - start >= timeout) {
      if (isProcessingQueue) {
        throw new Error(
          "A fila esta processando agora. Tente novamente em alguns segundos.",
        );
      }
      throw new Error(
        "Ainda existe um envio manual em andamento. Aguarde um pouco e tente novamente.",
      );
    }
    await sleep(220);
  }
  isManualSendInProgress = true;
  broadcastRuntimeState();
}
function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
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
  return typeof jobCampaign === "string"
    ? jobCampaign
    : jobCampaign._id || null;
}
async function waitForTabSettled(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === "complete") {
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
      } catch (error) {}
    }
    return existing;
  }
  const created = await chrome.tabs.create({
    url: "https://web.whatsapp.com/",
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
  const terms = new Set([normalized, `+${normalized}`]);
  if (normalized.startsWith("55") && normalized.length > 2) {
    terms.add(normalized.slice(2));
    terms.add(`+55${normalized.slice(2)}`);
  }
  return Array.from(terms);
}
async function openChatForCampaignJob(tab, job) {
  if (!tab?.id) {
    return { success: false, error: "WhatsApp tab unavailable." };
  }
  const targetPhone = digitsOnly(job?.phone);
  if (!targetPhone) {
    return { success: false, error: "Invalid campaign phone." };
  }
  await refreshSettingsFromStorage().catch(() => {});
  const bridgePhone = digitsOnly(extensionSettings.agentBridgePhone);
  const bridgeChatQuery = String(
    extensionSettings.agentBridgeChatQuery || "",
  ).trim();
  if (!bridgePhone && !bridgeChatQuery) {
    return {
      success: false,
      error:
        "Configure o chat do agente (bridge) nas configuracoes para enviar campanhas.",
    };
  }
  const contentReady = await waitForContentScriptReady(tab.id, 18000);
  if (!contentReady) {
    return {
      success: false,
      transient: true,
      error: "WhatsApp ainda carregando. Tente novamente em instantes.",
    };
  }
  if (
    lastResolvedChat?.tabId === tab.id &&
    isSamePhoneLoose(lastResolvedChat.phone, targetPhone)
  ) {
    try {
      const activeContext = await sendMessageToTabWithRetry(
        tab.id,
        {
          action: "GET_ACTIVE_CHAT_CONTEXT",
          phone: targetPhone,
        },
        2,
        220,
      );
      if (activeContext?.success && activeContext?.composerReady) {
        const activePhone = digitsOnly(activeContext.phone || "");
        if (activeContext.matchesTarget || !activePhone) {
          return {
            success: true,
            targetPhone,
            strategy: "cached_chat",
          };
        }
      }
    } catch (error) {}
  }
  try {
    const agentSearchTerms = [
      ...(bridgeChatQuery ? [bridgeChatQuery] : []),
      ...(bridgePhone ? buildSearchTermsForPhone(bridgePhone) : []),
    ];
    const bridgeResult = await sendMessageToTabWithRetry(
      tab.id,
      {
        action: "OPEN_CHAT_VIA_AGENT_BRIDGE",
        agentPhone: bridgePhone || "",
        agentQuery: bridgeChatQuery || "",
        targetPhone,
        humanized: Boolean(extensionSettings.enableHumanizedTyping),
        agentSearchTerms,
      },
      6,
      500,
    );
    if (bridgeResult?.success) {
      lastResolvedChat = { tabId: tab.id, phone: targetPhone };
      await sleep(randomBetween(320, 800));
      return {
        success: true,
        targetPhone,
        strategy: "agent_bridge",
      };
    }
    return {
      success: false,
      error: bridgeResult?.error || "Falha no fluxo bridge via agent-id.",
    };
  } catch (bridgeError) {
    return {
      success: false,
      error: bridgeError?.message || "Falha no fluxo bridge via agent-id.",
    };
  }
}
async function handleDirectSendRequest(request = {}) {
  if (!request.phone) throw new Error("Telefone obrigatorio.");
  if (!request.text) throw new Error("A mensagem obrigatoria.");
  const payload = {
    phone: request.phone,
    text: request.text,
    name: request.name || "",
    campaignId: request.campaignId || null,
    source: "atendimento_direct",
    at: new Date().toISOString(),
  };
  try {
    const response = await fetch(
      await buildApiUrl(`/messages/outbound/manual`),
      {
        method: "POST",
        headers: await getAuthorizedHeaders(
          { "Content-Type": "application/json" },
          "agent-background-sync",
        ),
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.msg || `Erro na API: ${response.status}`);
    }
    const data = await response.json();
    return {
      success: true,
      jobId: data.message?._id,
      msg: "Enviado para fila de processamento prioritária do Bot.",
    };
  } catch (err) {
    throw new Error(`Falha de comunicacao com o servidor: ${err.message}`);
  }
}
async function handleDirectMediaRequest(request = {}) {
  if (!request.phone) throw new Error("Telefone obrigatorio.");
  if (!request.fileUrl) throw new Error("URL do arquivo obrigatoria.");
  await waitForDispatchSlot(20000);
  try {
    const tab = await ensureWhatsAppTab({ focus: true });
    if (!tab?.id) {
      throw new Error("Nao foi possivel abrir o WhatsApp Web.");
    }
    const navigation = await openChatForCampaignJob(tab, { phone: request.phone });
    if (!navigation?.success) {
      throw new Error(navigation?.error || "Falha ao abrir conversa.");
    }
    await sleep(randomBetween(400, 800));
    const result = await sendMessageToTabWithRetry(
      tab.id,
      {
        action: "SEND_MEDIA_MESSAGE",
        fileUrl: request.fileUrl,
        mimetype: request.mimetype || "application/octet-stream",
        fileName: request.fileName || "file",
        caption: request.caption || "",
      },
      4,
      700,
    );
    if (!result?.success) {
      throw new Error(result?.error || "Falha ao enviar midia.");
    }
    return { sent: true };
  } finally {
    isManualSendInProgress = false;
    broadcastRuntimeState();
  }
}
async function handleOpenChatToolRequest(request = {}) {
  const phone = digitsOnly(request.phone);
  const tool = String(request.tool || "")
    .trim()
    .toLowerCase();
  if (!phone) {
    throw new Error("Telefone invalido para abrir ferramenta do chat.");
  }
  const supportedTools = new Set(["emoji", "attach", "mic"]);
  if (!supportedTools.has(tool)) {
    throw new Error("Ferramenta de chat nao suportada.");
  }
  const tab = await ensureWhatsAppTab({ focus: true });
  if (!tab?.id) {
    throw new Error("Nao foi possivel abrir o WhatsApp Web.");
  }
  const navigation = await openChatForCampaignJob(tab, { phone });
  if (!navigation?.success) {
    throw new Error(
      navigation?.error || "Falha ao abrir conversa via agent-id.",
    );
  }
  await sleep(randomBetween(300, 700));
  const toolResult = await sendMessageToTabWithRetry(
    tab.id,
    {
      action: "FOCUS_CHAT_TOOL",
      tool,
    },
    2,
    350,
  );
  if (!toolResult || !toolResult.success) {
    throw new Error(
      toolResult?.error || `Nao foi possivel abrir a ferramenta: ${tool}.`,
    );
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
    throw new Error("Telefone invalido para sincronizar historico.");
  }
  const tab = await ensureWhatsAppTab({ focus: shouldFocusTab });
  if (!tab?.id) {
    throw new Error("Nao foi possivel abrir o WhatsApp Web.");
  }
  const navigation = await openChatForCampaignJob(tab, { phone });
  if (!navigation?.success) {
    throw new Error(
      navigation?.error || "Falha ao abrir conversa via agent-id.",
    );
  }
  await sleep(randomBetween(450, 1100));
  const snapshot = await sendMessageToTabWithRetry(
    tab.id,
    {
      action: "CAPTURE_CHAT_HISTORY",
      phone,
      limit: safeLimit,
      preloadOlder: true,
    },
    3,
    450,
  );
  if (!snapshot || !snapshot.success) {
    throw new Error(
      snapshot?.error || "Falha ao capturar historico no WhatsApp Web.",
    );
  }
  return {
    phone: snapshot.phone || phone,
    name: snapshot.name || "",
    messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
    syncedAt: new Date().toISOString(),
  };
}
async function fetchNextJob(preferredCampaignId = null) {
  const queryString = preferredCampaignId
    ? `?campaignId=${encodeURIComponent(preferredCampaignId)}`
    : "";
  const response = await fetch(await buildApiUrl(`/messages/next${queryString}`), {
    headers: await getAuthorizedHeaders({}, "agent-background-sync"),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch next job: ${response.status}`);
  }
  const data = await response.json();
  return data.job || null;
}
async function registerInboundReply(payload) {
  const response = await fetch(await buildApiUrl(`/messages/inbound`), {
    method: "POST",
    headers: await getAuthorizedHeaders(
      { "Content-Type": "application/json" },
      "agent-background-sync",
    ),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to register inbound reply (${response.status}): ${body}`,
    );
  }
}
async function captureInboundForTab(tab) {
  if (!tab) return;
  try {
    const expectedPhone = lastResolvedChat?.phone || "";
    const capture = await sendMessageToTabWithRetry(
      tab.id,
      {
        action: "CAPTURE_INBOUND",
        phone: expectedPhone,
        limit: 30,
      },
      2,
      350,
    );
    if (!capture || !capture.success) return;
    const resolvedPhone = digitsOnly(capture.phone || expectedPhone);
    if (!resolvedPhone) return;
    const inboundMessages = Array.isArray(capture.messages)
      ? capture.messages
      : [];
    for (const item of inboundMessages) {
      const text = String(item?.text || "").trim();
      if (!text) continue;
      const fingerprint = String(
        item?.fingerprint || `${resolvedPhone}|${text}`,
      );
      if (inboundFingerprintCache.has(fingerprint)) continue;
      inboundFingerprintCache.add(fingerprint);
      if (inboundFingerprintCache.size > 2000) {
        inboundFingerprintCache.clear();
        inboundFingerprintCache.add(fingerprint);
      }
      try {
        await registerInboundReply({
          phone: resolvedPhone,
          name: capture.name || "",
          text,
          at: item?.at || new Date().toISOString(),
          campaignId: activeCampaignId || null,
          source: "whatsapp_web_monitor",
        });
      } catch (inboundError) {
        console.error("Failed to register inbound reply:", inboundError);
      }
    }
  } catch (error) {}
}
async function processQueue() {
  if (!isRunning || isProcessingQueue) return;
  isProcessingQueue = true;
  broadcastRuntimeState();
  try {
    const tab = await ensureWhatsAppTab({
      focus: focusWhatsAppOnNextQueueRun,
    });
    focusWhatsAppOnNextQueueRun = false;
    if (tab) {
      await captureInboundForTab(tab);
    }
    const job = await fetchNextJob(activeCampaignId).catch(() => null);
    if (!job) {
      scheduleNextRun(IDLE_POLLING_INTERVAL_MS, { reason: "idle" });
      return;
    }
    if (!tab?.id) {
      await updateJobStatus(job._id, "pending", "WhatsApp tab not found");
      scheduleNextRun(5000, { reason: "no_tab" });
      return;
    }
    const navigation = await openChatForCampaignJob(tab, job);
    if (!navigation?.success) {
      const isTransient = Boolean(navigation?.transient);
      await updateJobStatus(
        job._id,
        isTransient ? "pending" : "failed",
        navigation?.error || "Failed to open chat",
      );
      scheduleNextRun(isTransient ? 8000 : 3000, { reason: "nav_fail" });
      return;
    }
    await sleep(randomBetween(400, 900));
    const campaign = typeof job.campaign === "object" ? job.campaign : null;
    const jobMedia = job.media || campaign?.media || null;
    if (jobMedia?.fileUrl) {
      const mediaResult = await sendMessageToTabWithRetry(
        tab.id,
        {
          action: "SEND_MEDIA_MESSAGE",
          fileUrl: jobMedia.fileUrl,
          mimetype: jobMedia.mimetype || "application/octet-stream",
          fileName: jobMedia.fileName || "file",
          caption: job.processedMessage || "",
        },
        4,
        700,
      );
      if (!mediaResult?.success) {
        await updateJobStatus(
          job._id,
          "failed",
          mediaResult?.error || "Failed to send media",
        );
        scheduleNextRun(3000, { reason: "media_fail" });
        return;
      }
    } else if (job.processedMessage) {
      const textResult = await sendMessageToTabWithRetry(
        tab.id,
        {
          action: "SEND_TEXT_MESSAGE",
          text: job.processedMessage,
          humanized: Boolean(extensionSettings.enableHumanizedTyping),
        },
        4,
        700,
      );
      if (!textResult?.success) {
        await updateJobStatus(
          job._id,
          "failed",
          textResult?.error || "Failed to send text",
        );
        scheduleNextRun(3000, { reason: "text_fail" });
        return;
      }
    }
    await updateJobStatus(job._id, "sent", null);
    recordOutboundSend();
    pushGlassToast({
      title: "Mensagem enviada",
      message: `Para: ${job.phoneOriginal || job.phone}`,
      tone: "success",
    });
    const campaign2 = typeof job.campaign === "object" ? job.campaign : null;
    const baseDelay = getRandomDelayMs(campaign2);
    const finalDelay = maybeApplyLongBreak(baseDelay);
    scheduleNextRun(finalDelay, { reason: "after_send" });
  } catch (error) {
    console.error("Error in processQueue:", error);
    scheduleNextRun(IDLE_POLLING_INTERVAL_MS, { reason: "queue_error" });
  } finally {
    isProcessingQueue = false;
    broadcastRuntimeState();
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function findWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });
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
  while (Date.now() - startedAt < timeout) {
    try {
      const response = await sendMessageToTab(tabId, { action: "PING" });
      if (response?.ready || response?.success) {
        return true;
      }
    } catch (error) {}
    await sleep(350);
  }
  return false;
}
async function sendMessageToTabWithRetry(
  tabId,
  message,
  attempts = 3,
  delayMs = 450,
) {
  const maxAttempts = Math.max(1, Number(attempts) || 3);
  const retryDelay = Math.max(100, Number(delayMs) || 450);
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay);
    }
    try {
      const response = await sendMessageToTab(tabId, message);
      if (response) return response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}
async function updateJobStatus(id, status, error) {
  try {
    const response = await fetch(await buildApiUrl(`/messages/${id}/status`), {
      method: "PUT",
      headers: await getAuthorizedHeaders(
        { "Content-Type": "application/json" },
        "agent-background-sync",
      ),
      body: JSON.stringify({ status, error }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Status update failed (${response.status}): ${body}`);
    }
  } catch (updateError) {
    console.error("Failed to update job status:", updateError);
  }
}
