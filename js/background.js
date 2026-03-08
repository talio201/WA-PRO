import { ApiClient } from './api-client.js';

const api = new ApiClient();
const CONTACTS_HASH_KEY = 'wa_contacts_hash';
const CLOUD_SYNC_HASH_KEY = 'cloud_sync_hash';
const CLOUD_SYNC_ALARM = 'periodic_cloud_sync';
const CLOUD_SYNC_PERIOD_MINUTES = 5;

console.log('[Background] Service Worker Started');

function safeRuntimeSendMessage(message, context = '') {
    try {
        chrome.runtime.sendMessage(message, () => {
            const err = chrome.runtime.lastError;
            if (!err) return;
            const msg = String(err.message || '');
            const msgLower = msg.toLowerCase();
            const noReceiver =
                msgLower.includes('receiving end does not exist') ||
                msgLower.includes('could not establish connection');
            const noResponseExpected =
                (msgLower.includes('message port closed') && msgLower.includes('before a response was received')) ||
                (msgLower.includes('message channel closed') && msgLower.includes('before a response was received'));
            if (noReceiver || noResponseExpected) return;
            console.warn(`[Background] runtime.sendMessage failed${context ? ` (${context})` : ''}:`, msg);
        });
    } catch (e) {
        console.warn(
            `[Background] runtime.sendMessage exception${context ? ` (${context})` : ''}:`,
            e && e.message ? e.message : e
        );
    }
}

function normalizeContactId(contact) {
    return typeof contact.id === 'string'
        ? contact.id
        : (contact.id?._serialized || (contact.number + '@c.us'));
}

function computeContactsHash(contacts) {
    const rows = contacts
        .map(c => {
            const id = normalizeContactId(c) || '';
            return `${id}|${c.name || ''}|${c.pushname || ''}|${c.isBusiness ? 1 : 0}|${c.isGroup ? 1 : 0}`;
        })
        .sort()
        .join('\n');

    let h = 2166136261;
    for (let i = 0; i < rows.length; i++) {
        h ^= rows.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return `${contacts.length}:${h.toString(16)}`;
}

function computeCloudStateHash(contacts) {
    const rows = contacts
        .map(c => {
            const id = normalizeContactId(c) || '';
            return `${id}|${c.name || ''}|${c.pushname || ''}|${c.is_lead ? 1 : 0}|${c.last_sent_at || ''}`;
        })
        .sort()
        .join('\n');

    let h = 2166136261;
    for (let i = 0; i < rows.length; i++) {
        h ^= rows.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return `${contacts.length}:${h.toString(16)}`;
}

function isSessionValid(storageResult) {
    return Boolean(
        storageResult &&
        storageResult.ext_authenticated &&
        storageResult.supa_session &&
        storageResult.supa_session.access_token
    );
}

function resolveAgentId(storageResult, payloadAgentId = null) {
    if (payloadAgentId) return { agentId: payloadAgentId, source: 'whatsapp' };
    if (storageResult && storageResult.agent_id) return { agentId: storageResult.agent_id, source: 'storage' };
    if (storageResult && storageResult.supa_user && storageResult.supa_user.id) {
        return { agentId: `user:${storageResult.supa_user.id}`, source: 'user_fallback' };
    }
    return { agentId: null, source: 'none' };
}

function ensureCloudSyncAlarm() {
    chrome.alarms.create(CLOUD_SYNC_ALARM, { periodInMinutes: CLOUD_SYNC_PERIOD_MINUTES });
}

function bootstrapWhatsAppBridge(callback) {
    chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            callback({ ok: false, reason: 'whatsapp_tab_not_found' });
            return;
        }

        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(tabId, { type: 'FROM_EXTENSION', command: 'ping' }, () => {
            if (chrome.runtime.lastError) {
                callback({ ok: false, reason: 'receiver_missing', details: chrome.runtime.lastError.message });
                return;
            }

            // Request contacts to force WAPI_READY + agent_id propagation.
            chrome.tabs.sendMessage(tabId, { type: 'FROM_EXTENSION', command: 'getContacts' }, () => {
                if (chrome.runtime.lastError) {
                    callback({ ok: false, reason: 'wapi_not_ready', details: chrome.runtime.lastError.message });
                    return;
                }
                callback({ ok: true });
            });
        });
    });
}

function runCloudOnlyMerge(trigger = 'manual') {
    return new Promise((resolve) => {
        chrome.storage.local.get(['agent_id', 'supa_user', 'ext_authenticated', 'supa_session', 'wa_contacts', CLOUD_SYNC_HASH_KEY], (res) => {
            if (!isSessionValid(res)) {
                console.log(`[Background] Cloud-only sync skipped (${trigger}): not authenticated.`);
                resolve({ status: 'sync_skipped_not_authenticated' });
                return;
            }

            const resolved = resolveAgentId(res);
            if (!resolved.agentId) {
                console.log(`[Background] Cloud-only sync skipped (${trigger}): missing agent_id.`);
                resolve({ status: 'sync_skipped_no_agent' });
                return;
            }

            const runMerge = () => Promise.all([
                api.fetchContacts(),
                api.fetchMessageHistory(2000)
            ]).then(([cloudContacts, history]) => {
                const localContacts = res.wa_contacts || [];
                const safeHistory = Array.isArray(history) ? history : [];
                const lastSentMap = new Map();

                safeHistory.forEach(msg => {
                    if (msg.contact_id && !lastSentMap.has(msg.contact_id)) {
                        lastSentMap.set(msg.contact_id, msg.sent_at);
                    }
                });

                const mergedMap = new Map();
                cloudContacts.forEach(c => {
                    const id = normalizeContactId(c);
                    if (!id) return;
                    mergedMap.set(id, { ...c, last_sent_at: lastSentMap.get(id) || c.last_sent_at || null });
                });

                const newToCloud = [];
                localContacts.forEach(c => {
                    const id = normalizeContactId(c);
                    if (!id) return;

                    const lastSent = lastSentMap.get(id);
                    if (!mergedMap.has(id)) {
                        mergedMap.set(id, { ...c, last_sent_at: lastSent || c.last_sent_at || null });
                        newToCloud.push(c);
                        return;
                    }

                    const existing = mergedMap.get(id);
                    const merged = { ...existing, ...c };
                    if (existing.is_lead || c.is_lead) merged.is_lead = true;
                    merged.last_sent_at = lastSent || existing.last_sent_at || c.last_sent_at || null;
                    mergedMap.set(id, merged);
                });

                const finalContacts = Array.from(mergedMap.values());
                const nextHash = computeCloudStateHash(finalContacts);
                if (res[CLOUD_SYNC_HASH_KEY] === nextHash) {
                    console.log(`[Background] Cloud-only sync (${trigger}): no local changes detected.`);
                    resolve({ status: 'sync_no_changes', count: finalContacts.length });
                    return;
                }

                chrome.storage.local.set({
                    'wa_contacts': finalContacts,
                    'last_updated': Date.now(),
                    [CLOUD_SYNC_HASH_KEY]: nextHash
                }, () => {
                    safeRuntimeSendMessage({ type: 'CONTACTS_UPDATED', count: finalContacts.length }, 'cloud_only_contacts_updated');
                    console.log(`[Background] Cloud-only sync (${trigger}) saved ${finalContacts.length} contacts.`);
                    resolve({ status: 'sync_completed', count: finalContacts.length });
                });

                if (newToCloud.length > 0) {
                    api.syncContacts(newToCloud).catch(err => console.error('[Background] Cloud-only upload missing contacts failed:', err));
                }
            }).catch(err => {
                console.error(`[Background] Cloud-only sync (${trigger}) failed:`, err);
                resolve({ status: 'sync_failed', error: err.message });
            });

            if (resolved.source === 'user_fallback') {
                console.warn(`[Background] Cloud-only sync (${trigger}) using fallback agent_id from user session.`);
                chrome.storage.local.set({ 'agent_id': resolved.agentId }, runMerge);
                return;
            }
            runMerge();
        });
    });
}

// Open Dashboard in a new tab on extension icon click (Persistent Mode)
chrome.action.onClicked.addListener(() => {
    chrome.storage.local.get(['ext_authenticated', 'supa_session'], (res) => {
        const hasSession = Boolean(res.ext_authenticated && res.supa_session && res.supa_session.access_token);
        chrome.tabs.create({ url: hasSession ? 'dashboard.html' : 'login.html' });
    });
});

chrome.runtime.onInstalled.addListener(() => {
    ensureCloudSyncAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    ensureCloudSyncAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== CLOUD_SYNC_ALARM) return;
    runCloudOnlyMerge('alarm');
});

ensureCloudSyncAlarm();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // 1. Handle extracted contacts from WAPI
    if (request.type === 'FROM_WAPI' && request.payload && request.payload.type === 'CONTACTS_LIST') {
        const contacts = request.payload.data;
        const payloadAgentId = request.payload.agentId || null;
        console.log(`[Background] Received ${contacts.length} contacts from Content Script.`);

        if (contacts.length === 0) {
            console.log('[Background] Received empty contact list. Ignoring update to preserve local data.');
            return;
        }

        // A. Perform Smart Sync (Fetch Cloud -> Merge -> Diff -> Sync/Save)
        console.log('[Background] Starting Smart Sync...');

        chrome.storage.local.get(['agent_id', 'supa_user', 'ext_authenticated', 'supa_session', CONTACTS_HASH_KEY], (res) => {
            const isAuthed = Boolean(res.ext_authenticated && res.supa_session && res.supa_session.access_token);
            if (!isAuthed) {
                console.log('[Background] Ignored CONTACTS_LIST: extension not authenticated.');
                return;
            }

            const incomingHash = computeContactsHash(contacts);
            const sameAgent = payloadAgentId && res.agent_id && payloadAgentId === res.agent_id;
            if (sameAgent && res[CONTACTS_HASH_KEY] === incomingHash) {
                console.log('[Background] CONTACTS_LIST unchanged for same agent. Skipping sync.');
                return;
            }

            if (payloadAgentId && payloadAgentId !== res.agent_id) {
                console.log('[Background] Agent switch detected. Resetting local cache for new account.');
                chrome.storage.local.remove(['wa_contacts', CONTACTS_HASH_KEY]);
                chrome.storage.local.set({ 'agent_id': payloadAgentId });
                return;
            }

            const resolved = resolveAgentId(res, payloadAgentId);
            const effectiveAgent = resolved.agentId;
            if (!effectiveAgent) {
                console.log('[Background] Sync Skipped: No Agent ID yet.');
                return;
            }
            const runSmartSync = () => Promise.all([
                api.fetchContacts(), // Fetch Source of Truth (includes correct is_lead)
                new Promise(resolve => chrome.storage.local.get(['wa_contacts'], resolve))
            ]).then(([cloudContacts, localResult]) => {
                const localContacts = localResult.wa_contacts || [];
                const cloudMap = new Map(cloudContacts.map(c => [c.id, c]));
                const localMap = new Map(localContacts.map(c => [
                    typeof c.id === 'string' ? c.id : (c.id?._serialized || (c.number + '@c.us')),
                    c
                ]));

                const mergedMap = new Map();
                const contactsToSync = [];

                // 1. Base: Start with Cloud Data (Source of Truth for metadata)
                cloudContacts.forEach(c => mergedMap.set(c.id, c));

                // 2. Layer: Apply Local Data (Interim state)
                localContacts.forEach(c => {
                    const id = typeof c.id === 'string' ? c.id : (c.id?._serialized || (c.number + '@c.us'));
                    if (!id) return;
                    const existing = mergedMap.get(id) || {};
                    mergedMap.set(id, { ...existing, ...c, is_lead: existing.is_lead || c.is_lead });
                });

                // 3. Layer: Apply WAPI Data (Latest WhatsApp State) & Calculate Diff
                contacts.forEach(wapiContact => {
                    const id = typeof wapiContact.id === 'string' ? wapiContact.id : (wapiContact.id?._serialized || (wapiContact.number + '@c.us'));
                    if (!id) return;

                    const existingCloud = cloudMap.get(id);
                    const existingMerged = mergedMap.get(id);

                    // Preserve metadata from Cloud/Local, update WA fields
                    const finalContact = {
                        ...existingMerged,
                        ...wapiContact, // Name, pushname, number from WA
                        is_lead: existingCloud?.is_lead || existingMerged?.is_lead || false, // Cloud is authority
                        last_sent_at: existingCloud?.last_sent_at || existingMerged?.last_sent_at || null
                    };

                    mergedMap.set(id, finalContact);

                    // 4. Diff Check: Sync only if New or Changed
                    if (!existingCloud) {
                        // New contact
                        contactsToSync.push(finalContact);
                    } else {
                        // Check for relevant changes (Name, Number usually)
                        const nameChanged = (wapiContact.name && wapiContact.name !== existingCloud.name);
                        const pushnameChanged = (wapiContact.pushname && wapiContact.pushname !== existingCloud.pushname);

                        if (nameChanged || pushnameChanged) {
                            contactsToSync.push(finalContact);
                        }
                    }
                });

                const finalContacts = Array.from(mergedMap.values());

                // 5. Update Local Storage
                chrome.storage.local.set({
                    'wa_contacts': finalContacts,
                    'last_updated': Date.now(),
                    [CONTACTS_HASH_KEY]: incomingHash,
                    'agent_id': effectiveAgent
                }, () => {
                    console.log(`[Background] Smart Sync: Saved ${finalContacts.length} contacts locally.`);
                    safeRuntimeSendMessage({ type: 'CONTACTS_UPDATED', count: finalContacts.length }, 'smart_sync_contacts_updated');
                });

                // 6. Sync Diff to Cloud
                if (contactsToSync.length > 0) {
                    console.log(`[Background] Syncing ${contactsToSync.length} new/updated contacts to Cloud...`);
                    api.syncContacts(contactsToSync)
                        .then(() => console.log('[Background] Diff Sync Complete'))
                        .catch(err => console.error('[Background] Diff Sync Failed', err));
                } else {
                    console.log('[Background] No changes to sync with Cloud.');
                }

            }).catch(err => console.error('[Background] Smart Sync Failed:', err));

            if (resolved.source === 'user_fallback') {
                console.warn('[Background] Smart Sync using fallback agent_id from authenticated user.');
                chrome.storage.local.set({ 'agent_id': effectiveAgent }, runSmartSync);
                return;
            }
            runSmartSync();
        });
    }

    // 1b. Handle LOGOUT_REQUEST (Clear WAPI Cache)
    if (request.type === 'LOGOUT_REQUEST') {
        console.log('[Background] Logout Requested. Clearing WAPI Cache...');
        chrome.storage.local.clear();

        // Tell WAPI to clear its localStorage
        chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, function (tabs) {
            if (tabs && tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { type: "FROM_EXTENSION", command: "clearCache" }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Background] clearCache skipped:', chrome.runtime.lastError.message);
                    }
                });
            }
        });
    }

    // 2. Relay other WAPI messages to dashboard (WAPI_READY, etc)
    if (request.type === 'FROM_WAPI' && request.payload && request.payload.type !== 'CONTACTS_LIST') {
        chrome.storage.local.get(['ext_authenticated', 'supa_session'], (res) => {
            const isAuthed = Boolean(res.ext_authenticated && res.supa_session && res.supa_session.access_token);
            if (!isAuthed) {
                console.log('[Background] Ignored FROM_WAPI event: extension not authenticated.');
                return;
            }

            safeRuntimeSendMessage(request, 'relay_from_wapi');

            // 2a. Handle WAPI_READY -> Save Agent ID
            if (request.payload.type === 'WAPI_READY') {
                const agentId = request.payload.agentId;
                if (agentId) {
                    console.log('[Background] Multi-tenancy: Agent ID identified as:', agentId);
                    chrome.storage.local.set({ 'agent_id': agentId });
                }
            }

            // 2b. Handle Message Events -> Log to Supabase (Inbound + Outbound)
            if (request.payload.type === 'INBOUND_MESSAGE' || request.payload.type === 'OUTBOUND_MESSAGE') {
                const msg = request.payload.data || {};
                const direction = request.payload.type === 'OUTBOUND_MESSAGE' ? 'outbound' : 'inbound';
                const status = direction === 'inbound' ? 'received' : 'sent';

                // Best-effort local dedupe (prevents duplicate logs from multiple sources).
                const dedupeKey = `${direction}:${msg.contactId}:${msg.timestamp}:${(msg.text || '').slice(0, 80)}:${msg.messageType || ''}`;
                chrome.storage.local.get(['_msg_dedupe'], (r) => {
                    const map = r._msg_dedupe && typeof r._msg_dedupe === 'object' ? r._msg_dedupe : {};
                    const now = Date.now();

                    // Purge old keys (24h) to keep storage bounded.
                    for (const [k, ts] of Object.entries(map)) {
                        if (!ts || (now - ts) > 24 * 60 * 60 * 1000) delete map[k];
                    }

                    if (map[dedupeKey]) return;
                    map[dedupeKey] = now;
                    chrome.storage.local.set({ _msg_dedupe: map });

                    api.logMessage({
                        contactId: msg.contactId || '',
                        contactName: msg.author || '',
                        messageText: msg.text || '',
                        hasMedia: Boolean(msg.hasMedia),
                        mediaFilename: msg.mediaFilename || '',
                        status,
                        direction,
                        timestamp: msg.timestamp,
                        messageType: msg.messageType || 'text'
                    }).catch(e => console.error('[Background] Failed to log message event:', e));
                });
            }
        });
        return;
    }

    // 3. Sync Request from Dashboard
    if (request.type === 'SYNC_CONTACTS') {
        console.log('[Background] Manual cloud-only sync requested.');
        runCloudOnlyMerge('manual_request').then(result => {
            if (result.status === 'sync_skipped_no_agent') {
                bootstrapWhatsAppBridge((bridge) => {
                    if (!bridge.ok) {
                        sendResponse({ status: 'sync_waiting_agent', bridge });
                        return;
                    }
                    setTimeout(() => {
                        runCloudOnlyMerge('manual_request_retry').then(sendResponse);
                    }, 1200);
                });
                return;
            }
            sendResponse(result);
        });
        return true; // Keep message channel open for sendResponse
    }

    // =============== CAMPAIGN COMMANDS ===============

    function isNoReceiver(errMsg) {
        const s = String(errMsg || '');
        return s.includes('Receiving end does not exist') || s.includes('Could not establish connection');
    }

    function extractDigits(chatId) {
        return String(chatId || '').replace(/\D/g, '');
    }

    function shouldUseDirectLinkFallback(errMsg) {
        const s = String(errMsg || '');
        const l = s.toLowerCase();
        if (!s) return false;
        if (l.includes('chat_mismatch')) return false;
        if (l.includes('invalid number')) return false;
        if (l.includes('number_not_on_whatsapp')) return false;
        if (l.includes('send_not_confirmed')) return false;
        if (l.includes('flow_busy')) return false;
        // WAPI.openChat already executes internal fallback chain (search -> new chat -> direct link).
        // If these errors appear, retrying direct-link from background only duplicates navigation.
        if (l.includes('could not open chat for')) return false;
        if (l.includes('could not open chat via direct link')) return false;
        if (l.includes('direct-link spa navigation failed')) return false;
        return (
            l.includes('search input not found') ||
            l.includes('new chat button not found') ||
            l.includes('wapi_timeout') ||
            l.includes('compose box not found') ||
            l.includes('element not found')
        );
    }

    function openChatViaDirectLink(chatId, callback) {
        const digits = extractDigits(chatId);
        if (digits.length < 8) {
            callback({ ok: false, error: 'INVALID_CHAT_ID_FOR_DIRECT_LINK' });
            return;
        }

        // 1) Try direct link first (historical behavior).
        sendToWhatsAppTab({
            type: 'FROM_EXTENSION',
            command: 'openDirectLink',
            chatId: `${digits}@c.us`
        }, (response) => {
            if (response && !response.error) {
                callback({ ok: true, digits });
                return;
            }

            // 2) If direct link fails, retry chat navigation via openChat flow.
            sendToWhatsAppTab({
                type: 'FROM_EXTENSION',
                command: 'openChat',
                chatId: `${digits}@c.us`,
                allowMismatch: true
            }, (openChatResponse) => {
                if (openChatResponse && !openChatResponse.error) {
                    callback({ ok: true, digits });
                    return;
                }

                callback({
                    ok: false,
                    error: (openChatResponse && openChatResponse.error)
                        ? openChatResponse.error
                        : (response && response.error ? response.error : 'DIRECT_LINK_AND_OPEN_CHAT_FAILED')
                });
            });
        });
    }

    function sendToWhatsAppTab(message, sendResponse, opts = {}) {
        const retryInject = opts && opts.retryInject !== undefined ? Boolean(opts.retryInject) : true;
        chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                sendResponse({ error: 'WhatsApp tab not found' });
                return;
            }
            const tabId = tabs[0].id;
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message;
                    if (retryInject && isNoReceiver(msg)) {
                        chrome.scripting.executeScript({ target: { tabId }, files: ['js/content-script.js'] }, () => {
                            if (chrome.runtime.lastError) {
                                sendResponse({ error: chrome.runtime.lastError.message });
                                return;
                            }
                            // Retry once after injection.
                            chrome.tabs.sendMessage(tabId, message, (response2) => {
                                if (chrome.runtime.lastError) {
                                    sendResponse({ error: chrome.runtime.lastError.message });
                                    return;
                                }
                                sendResponse(response2 || { success: true });
                            });
                        });
                        return;
                    }
                    sendResponse({ error: msg });
                    return;
                }
                sendResponse(response || { success: true });
            });
        });
    }

    function sendToWhatsAppTabWithDirectLinkFallback(primaryMessage, sendResponse, opts = {}) {
        const chatId = opts.chatId;
        const makeRetryMessage = typeof opts.makeRetryMessage === 'function'
            ? opts.makeRetryMessage
            : (() => ({ ...primaryMessage }));

        sendToWhatsAppTab(primaryMessage, (firstResponse) => {
            const first = firstResponse || { error: 'No response from content script' };
            const firstErr = first && first.error ? String(first.error) : '';

            if (!chatId || !shouldUseDirectLinkFallback(firstErr)) {
                sendResponse(first);
                return;
            }

            console.warn('[Background] Primary send failed, trying direct-link chat open fallback:', firstErr);
            openChatViaDirectLink(chatId, (openRes) => {
                if (!openRes || !openRes.ok) {
                    sendResponse(first);
                    return;
                }

                const retryMessage = makeRetryMessage(openRes.digits);
                sendToWhatsAppTab(retryMessage, (secondResponse) => {
                    sendResponse(secondResponse || first);
                });
            });
        });
    }

    // 4. Send Text Message → relay to WhatsApp tab
    if (request.type === 'SEND_MESSAGE') {
        const { chatId, text, contactName, allowMismatch, reviewId } = request.data || {};
        console.log(`[Background] Dispatching DOM command → navigate to ${contactName || chatId}`);

        sendToWhatsAppTabWithDirectLinkFallback({
            type: 'FROM_EXTENSION',
            command: 'sendMessage',
            chatId: chatId,
            text: text,
            allowMismatch: Boolean(allowMismatch)
        }, (response) => {
            const res = response || { error: 'No response from content script' };
            const err = res && res.error ? String(res.error) : '';
            if (err) {
                console.warn('[Background] SEND_MESSAGE failed:', err);
            }

            const isMismatch = err.includes('CHAT_MISMATCH');
            if (isMismatch) {
                // Create a manual review item and continue.
                const digits = (v) => String(v || '').replace(/\D/g, '');
                const exp = (err.match(/expected=([0-9]+)/) || [])[1] || digits(chatId);
                const got = (err.match(/got=([0-9]*)/) || [])[1] || '';

                const item = {
                    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    chatId: chatId,
                    expectedDigits: exp,
                    gotDigits: got,
                    contactName: contactName || '',
                    text: text || '',
                    createdAt: new Date().toISOString(),
                    error: err
                };

                chrome.storage.local.get(['pending_reviews'], (r) => {
                    const list = Array.isArray(r.pending_reviews) ? r.pending_reviews : [];
                    list.unshift(item);
                    // cap to avoid unbounded growth
                    const capped = list.slice(0, 200);
                    chrome.storage.local.set({ pending_reviews: capped }, () => {
                        safeRuntimeSendMessage({ type: 'PENDING_REVIEW_ADDED', item, count: capped.length }, 'pending_review_added');
                    });
                });

                sendResponse({ error: 'CHAT_MISMATCH', reviewId: item.id, detail: err });
                return;
            }

            // If this was a manual review send, clear it on success.
            const success = res && !res.error;
            if (success && reviewId) {
                chrome.storage.local.get(['pending_reviews'], (r) => {
                    const list = Array.isArray(r.pending_reviews) ? r.pending_reviews : [];
                    const next = list.filter(x => x && x.id !== reviewId);
                    chrome.storage.local.set({ pending_reviews: next }, () => {
                        safeRuntimeSendMessage({ type: 'PENDING_REVIEW_REMOVED', reviewId, count: next.length }, 'pending_review_removed');
                    });
                });
            }

            sendResponse(res);
        }, {
            chatId,
            makeRetryMessage: () => ({
                type: 'FROM_EXTENSION',
                command: 'sendMessage',
                chatId: chatId,
                text: text,
                allowMismatch: Boolean(allowMismatch),
                skipOpenChat: true
            })
        });
        return true;
    }

    // 5. Send Media → relay to WhatsApp tab
    if (request.type === 'SEND_MEDIA') {
        const { chatId, base64, filename, caption, mimetype, contactName, campaignId } = request.data;
        console.log(`[Background] Dispatching DOM command → media "${filename}" to ${contactName || chatId}`);

        sendToWhatsAppTabWithDirectLinkFallback({
            type: 'FROM_EXTENSION',
            command: 'sendMedia',
            chatId: chatId,
            base64: base64,
            filename: filename,
            caption: caption,
            mimetype: mimetype
        }, (response) => {
            const success = response && !response.error;
            if (response && response.error) {
                console.warn('[Background] SEND_MEDIA failed:', response.error);
            }
            if (success) api.markConversationStarted(chatId);
            sendResponse(response || { success: true });
        }, {
            chatId,
            makeRetryMessage: () => ({
                type: 'FROM_EXTENSION',
                command: 'sendMedia',
                chatId: chatId,
                base64: base64,
                filename: filename,
                caption: caption,
                mimetype: mimetype,
                skipOpenChat: true
            })
        });
        return true;
    }

    // 6. Simulate Typing → relay to WhatsApp tab
    if (request.type === 'SIMULATE_TYPING') {
        const { chatId } = request.data;

        sendToWhatsAppTab({
            type: 'FROM_EXTENSION',
            command: 'simulateTyping',
            chatId: chatId
        }, sendResponse);
        return true;
    }

    // 7. Simulate Presence → relay to WhatsApp tab
    if (request.type === 'SIMULATE_PRESENCE') {
        sendToWhatsAppTab({ type: 'FROM_EXTENSION', command: 'simulatePresence' }, sendResponse);
        return true;
    }

    // 7.1 Open Chat (safe navigation only, no typing)
    if (request.type === 'OPEN_CHAT') {
        const { chatId, allowMismatch } = request.data || {};
        sendToWhatsAppTabWithDirectLinkFallback({
            type: 'FROM_EXTENSION',
            command: 'openChat',
            chatId,
            allowMismatch: Boolean(allowMismatch)
        }, sendResponse, { chatId });
        return true;
    }

    // 7.1.1 Diagnostics: openChat + selector dump
    if (request.type === 'DIAG_OPEN_CHAT') {
        const { chatId, allowMismatch } = request.data || {};
        sendToWhatsAppTab({
            type: 'FROM_EXTENSION',
            command: 'diagOpenChat',
            chatId,
            allowMismatch: Boolean(allowMismatch)
        }, (resp) => sendResponse(resp || { error: 'No response from content script' }));
        return true;
    }

    // 7.2 Sync Chat History (backfill up to sinceDays by scrolling up)
    if (request.type === 'SYNC_CHAT_HISTORY') {
        const { chatId, sinceDays, maxSteps } = request.data || {};
        chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
            if (tabs && tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'FROM_EXTENSION',
                    command: 'syncChatHistory',
                    chatId,
                    sinceDays: sinceDays || 365,
                    maxSteps: maxSteps || 6
                }, async (response) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ error: chrome.runtime.lastError.message });
                        return;
                    }
                    const result = response && response.result ? response.result : response;
                    if (!result || result.error) {
                        sendResponse(result || { error: 'syncChatHistory failed' });
                        return;
                    }

                    // Persist backfill to Supabase in bulk (best-effort).
                    try {
                        if (result.messages && Array.isArray(result.messages) && result.messages.length > 0) {
                            await api.logMessagesBulk(result.messages);
                        }
                    } catch (e) {
                        console.warn('[Background] bulk history log failed:', e.message);
                    }

                    sendResponse({ success: true, ...result });
                });
            } else {
                sendResponse({ error: 'WhatsApp tab not found' });
            }
        });
        return true;
    }

    // 8. Add Manual Contact → insert to Supabase
    if (request.type === 'ADD_MANUAL_CONTACT') {
        const { number, name } = request.data;
        console.log(`[Background] Adding manual contact: ${number} (${name})`);

        api.insertManualContact(number, name)
            .then(() => {
                console.log('[Background] Manual contact added successfully');
                sendResponse({ success: true });
            })
            .catch(err => {
                console.error('[Background] Failed to add manual contact:', err);
                sendResponse({ error: err.message });
            });
        return true;
    }

    // 9. Inbound Message (Reply Tracking) → log to Supabase
    if (request.type === 'INBOUND_MESSAGE') {
        const { contactId, text, timestamp, fromMe, author, messageType, mediaFilename, hasMedia } = request.data;

        // Log inbound message
        api.logMessage({
            contactId: contactId,
            contactName: '', // Name might not be available immediately
            messageText: text,
            hasMedia: hasMedia || false,
            mediaFilename: mediaFilename || '',
            messageType: messageType || 'text',
            status: 'received',
            direction: 'inbound', // Critical for measuring reply rate
            campaignId: '' // Inbound doesn't belong to a specific campaign usually
        });

        return;
    }

    // 10. Import Leads from Excel → bulk insert to Supabase & update Local
    if (request.type === 'IMPORT_LEADS_EXCEL') {
        const leads = request.data;
        console.log(`[Background] Importing ${leads.length} leads from Excel...`);

        // A. Update Local Storage immediately (avoid disappearing leads)
        chrome.storage.local.get(['wa_contacts'], (result) => {
            const localContacts = result.wa_contacts || [];
            const mergedMap = new Map();

            // Populate current
            localContacts.forEach(c => {
                const id = typeof c.id === 'string' ? c.id : (c.id?._serialized || (c.number + '@c.us'));
                if (id) mergedMap.set(id, c);
            });

            // Add leads
            leads.forEach(l => {
                const id = l.number + '@c.us';
                const existing = mergedMap.get(id);
                mergedMap.set(id, {
                    ...existing,
                    id: { _serialized: id, user: l.number, server: 'c.us' },
                    name: l.name || existing?.name || 'Lead ' + l.number,
                    pushname: l.name || existing?.pushname || '',
                    is_lead: true,
                    isMyContact: existing?.isMyContact || false
                });
            });

            const finalContacts = Array.from(mergedMap.values());
            chrome.storage.local.set({ 'wa_contacts': finalContacts, 'last_updated': Date.now() }, () => {
                console.log(`[Background] Leads saved to local storage. Total: ${finalContacts.length}`);
                safeRuntimeSendMessage({ type: 'CONTACTS_UPDATED', count: finalContacts.length }, 'excel_contacts_updated');
            });
        });

        // B. Sync to Supabase
        api.importLeads(leads)
            .then(() => {
                console.log('[Background] Excel leads imported successfully');
                sendResponse({ success: true, count: leads.length });
            })
            .catch(err => {
                console.error('[Background] Failed to import Excel leads:', err);
                sendResponse({ error: err.message });
            });
        return true;
    }

});
