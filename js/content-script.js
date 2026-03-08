
// Guard against accidental double-injection (e.g. scripting.executeScript fallback).
// Use a DOM marker too because executeScript can run in a different world.
const CS_DOM_MARK = 'data-emidia-cs-loaded';
if (document?.documentElement?.hasAttribute(CS_DOM_MARK) || globalThis.__EMIDIA_CS_LOADED) {
  console.log('[ContentScript] Already loaded; skipping.');
} else {
  globalThis.__EMIDIA_CS_LOADED = true;
  try { document.documentElement.setAttribute(CS_DOM_MARK, '1'); } catch (e) { /* ignore */ }

  console.log('[ContentScript] Loaded');

// Helper to inject scripts
function injectScript(file_path, tag) {
  var node = document.getElementsByTagName(tag)[0];
  var script = document.createElement('script');
  script.setAttribute('type', 'text/javascript');
  script.setAttribute('src', file_path);
  node.appendChild(script);
}

// 1. Auto-Inject WAPI immediately
let wapiInjected = false;
let isWapiReady = false;
let commandQueue = [];
let isExtensionAuthenticated = false;
const QUEUED_COMMAND_TIMEOUT_MS = 45000;

const WAPI_SCRIPT_ID = 'wapi-script-v5';

function ensureWAPI() {
  if (document.getElementById(WAPI_SCRIPT_ID)) {
    wapiInjected = true;
    return;
  }

  if (!wapiInjected) {
    console.log('[ContentScript] Injecting WAPI...');
    // injectScript(chrome.runtime.getURL('js/wapi.js'), 'body');

    // Explicit injection to add ID
    var node = document.body;
    var script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', chrome.runtime.getURL('js/wapi.js'));
    script.id = WAPI_SCRIPT_ID;
    node.appendChild(script);

    wapiInjected = true;
  }
}

function refreshAuthState(callback) {
  chrome.storage.local.get(['ext_authenticated', 'supa_session'], (result) => {
    isExtensionAuthenticated = Boolean(result.ext_authenticated && result.supa_session && result.supa_session.access_token);
    if (callback) callback(isExtensionAuthenticated);
  });
}

// Inject only when authenticated
refreshAuthState((ok) => {
  if (ok) ensureWAPI();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.ext_authenticated || changes.supa_session) {
    refreshAuthState((ok) => {
      if (ok) ensureWAPI();
    });
  }
});

// Track pending command responses (for async WAPI replies)
let pendingCommands = {};

// 2. Listen for messages from DASHBOARD / POPUP / BACKGROUND
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

  if (request.type === "FROM_EXTENSION") {
    if (request.command !== 'clearCache' && request.command !== 'ping' && !isExtensionAuthenticated) {
      sendResponse({ error: 'Extension not authenticated' });
      return false;
    }

    // Ensure WAPI is injected for any command
    ensureWAPI();

    // If WAPI is not ready, QUEUE the command
    if (!isWapiReady && request.command !== 'ping') {
      console.log('[ContentScript] WAPI not ready. Queuing command:', request.command);
      const queuedAt = Date.now();
      const queueTimer = setTimeout(() => {
        const idx = commandQueue.findIndex(x => x && x.sendResponse === sendResponse);
        if (idx >= 0) commandQueue.splice(idx, 1);
        try { sendResponse({ error: `WAPI_NOT_READY_TIMEOUT command=${request.command}` }); } catch (e) { }
      }, QUEUED_COMMAND_TIMEOUT_MS);
      commandQueue.push({ request, sender, sendResponse, queuedAt, queueTimer });
      return true; // Keep channel open
    }

    processExtensionMessage(request, sender, sendResponse);
    return true; // Keep channel open for async response
  }
});

function processExtensionMessage(request, sender, sendResponse) {
  // For send commands, store the sendResponse callback for async reply
  if ([
    'sendMessage',
    'sendMedia',
    'getContacts',
    'openChat',
    'openDirectLink',
    'syncChatHistory',
    'diagOpenChat',
    'simulateTyping',
    'simulatePresence',
    'clearCache'
  ].includes(request.command)) {
    const cmdId = Date.now() + '_' + Math.random().toString(36).slice(2);
    request._cmdId = cmdId;
    pendingCommands[cmdId] = sendResponse;

    // Relay to WAPI with the command ID
    window.postMessage(request, "*");

    const timeoutMs =
      request.command === 'sendMedia' ? 120000 :
      request.command === 'syncChatHistory' ? 120000 :
      60000;

    // Timeout: auto-respond if no reply from WAPI
    setTimeout(() => {
      if (pendingCommands[cmdId]) {
        // Fail fast so the sender doesn't see "message channel closed" with no context.
        pendingCommands[cmdId]({ error: `WAPI_TIMEOUT command=${request.command}` });
        delete pendingCommands[cmdId];
      }
    }, timeoutMs);
  } else {
    // For non-async commands, just relay
    window.postMessage(request, "*");
    sendResponse({ success: true });
  }
}

// 3. Listen for messages from WAPI (Window)
window.addEventListener("message", function (event) {
  if (event.source != window) return;

  // Handle "Export Trigger" from the button
  if (event.data && event.data.type === 'export:trigger') {
    ensureWAPI();
  }

  // Handle Data from WAPI
  if (event.data.type && event.data.type == "FROM_WAPI") {
    if (!isExtensionAuthenticated) return;

    const payload = event.data.payload;

    // Handle Ready Event
    if (payload && payload.type === 'WAPI_READY') {
      console.log('[ContentScript] WAPI is READY. Flushing queue...', commandQueue.length);
      isWapiReady = true;
      while (commandQueue.length > 0) {
        const { request, sender, sendResponse, queueTimer } = commandQueue.shift();
        if (queueTimer) clearTimeout(queueTimer);
        processExtensionMessage(request, sender, sendResponse);
      }
    }

    // Handle async command results
    if (payload && payload.type === 'COMMAND_RESULT') {
      const cmdId = payload._cmdId;
      if (cmdId && pendingCommands[cmdId]) {
        pendingCommands[cmdId](payload.result || { error: payload.error });
        delete pendingCommands[cmdId];
        return;
      }
    }

    // Persist contacts
    if (payload && payload.type === 'CONTACTS_LIST') {
      console.log('[ContentScript] Persisting ' + payload.data.length + ' contacts to storage.');
      chrome.storage.local.set({
        'wa_contacts': payload.data,
        'last_updated': Date.now()
      });
    }

    // Forward to Background
    try { chrome.runtime.sendMessage(event.data); } catch (e) { }
  }
});

}
