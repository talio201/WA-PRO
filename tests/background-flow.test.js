const fs = require('fs');
const path = require('path');

const backgroundRaw = fs.readFileSync(path.resolve(__dirname, '../js/background.js'), 'utf8');
const backgroundScript = `
class ApiClient {
  fetchContacts() { return Promise.resolve([]); }
  fetchMessageHistory() { return Promise.resolve([]); }
  syncContacts() { return Promise.resolve(); }
  logMessage() { return Promise.resolve(); }
  logMessagesBulk() { return Promise.resolve(); }
  markConversationStarted() { return Promise.resolve(); }
  insertManualContact() { return Promise.resolve(); }
  importLeads() { return Promise.resolve(); }
}
${backgroundRaw.replace(/^import\s+\{\s*ApiClient\s*\}\s+from\s+['"].*?['"];?\s*/m, '')}
`;

function makeChromeMock() {
  const storageData = {};
  const runtimeMessageListeners = [];
  const tabsUpdatedListeners = [];

  const storageGet = jest.fn((keys, cb) => {
    if (Array.isArray(keys)) {
      const out = {};
      keys.forEach((k) => { out[k] = storageData[k]; });
      cb(out);
      return;
    }
    if (typeof keys === 'object' && keys) {
      const out = {};
      Object.keys(keys).forEach((k) => {
        out[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
      });
      cb(out);
      return;
    }
    cb({ ...storageData });
  });

  const storageSet = jest.fn((obj, cb) => {
    Object.assign(storageData, obj || {});
    if (cb) cb();
  });

  const storageRemove = jest.fn((keys, cb) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    arr.forEach((k) => delete storageData[k]);
    if (cb) cb();
  });

  const storageClear = jest.fn((cb) => {
    Object.keys(storageData).forEach((k) => delete storageData[k]);
    if (cb) cb();
  });

  const chrome = {
    runtime: {
      lastError: null,
      sendMessage: jest.fn(),
      onMessage: { addListener: jest.fn((fn) => runtimeMessageListeners.push(fn)) },
      onInstalled: { addListener: jest.fn() },
      onStartup: { addListener: jest.fn() }
    },
    action: { onClicked: { addListener: jest.fn() } },
    alarms: {
      create: jest.fn(),
      onAlarm: { addListener: jest.fn() }
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
        remove: storageRemove,
        clear: storageClear
      }
    },
    tabs: {
      query: jest.fn((query, cb) => cb([{ id: 123, url: 'https://web.whatsapp.com/' }])),
      sendMessage: jest.fn((tabId, message, cb) => cb({ success: true })),
      update: jest.fn((tabId, updateInfo, cb) => {
        if (cb) cb();
        setTimeout(() => {
          tabsUpdatedListeners.slice().forEach((fn) => fn(tabId, { status: 'complete' }));
        }, 0);
      }),
      onUpdated: {
        addListener: jest.fn((fn) => tabsUpdatedListeners.push(fn)),
        removeListener: jest.fn((fn) => {
          const idx = tabsUpdatedListeners.indexOf(fn);
          if (idx >= 0) tabsUpdatedListeners.splice(idx, 1);
        })
      }
    },
    scripting: {
      executeScript: jest.fn((opts, cb) => cb && cb())
    }
  };

  return { chrome, storageData, runtimeMessageListeners };
}

function sendRuntimeRequest(listener, request) {
  return new Promise((resolve) => {
    listener(request, {}, (resp) => resolve(resp));
  });
}

describe('Background Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('SEND_MESSAGE should fallback to direct link only on infra errors, then retry send', async () => {
    const { chrome, runtimeMessageListeners } = makeChromeMock();
    global.chrome = chrome;

    eval(backgroundScript);
    const listener = runtimeMessageListeners[runtimeMessageListeners.length - 1];

    chrome.tabs.sendMessage.mockImplementation((tabId, message, cb) => {
      if (message.command === 'sendMessage' && !message.skipOpenChat) {
        cb({ error: 'Search input not found' });
        return;
      }
      if (message.command === 'openDirectLink') {
        cb({ success: true, ok: true });
        return;
      }
      cb({ success: true });
    });

    const response = await sendRuntimeRequest(listener, {
      type: 'SEND_MESSAGE',
      data: { chatId: '5511999999999@c.us', text: 'Oi', contactName: 'Teste' }
    });

    expect(response).toEqual({ success: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);
    expect(chrome.tabs.sendMessage.mock.calls[1][1].command).toBe('openDirectLink');
    expect(chrome.tabs.sendMessage.mock.calls[2][1].command).toBe('sendMessage');
    expect(chrome.tabs.sendMessage.mock.calls[2][1].skipOpenChat).toBe(true);
  });

  test('SEND_MESSAGE should create pending review item on CHAT_MISMATCH', async () => {
    const { chrome, storageData, runtimeMessageListeners } = makeChromeMock();
    global.chrome = chrome;

    eval(backgroundScript);
    const listener = runtimeMessageListeners[runtimeMessageListeners.length - 1];

    chrome.tabs.sendMessage.mockImplementation((tabId, message, cb) => {
      cb({ error: 'CHAT_MISMATCH expected=5511999999999 got=5511888888888' });
    });

    const response = await sendRuntimeRequest(listener, {
      type: 'SEND_MESSAGE',
      data: { chatId: '5511999999999@c.us', text: 'Oi', contactName: 'Contato X' }
    });

    expect(response.error).toBe('CHAT_MISMATCH');
    expect(typeof response.reviewId).toBe('string');

    const list = storageData.pending_reviews;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);
    expect(list[0].expectedDigits).toBe('5511999999999');
    expect(list[0].gotDigits).toBe('5511888888888');
    expect(list[0].contactName).toBe('Contato X');
  });

  test('SEND_MEDIA should fallback to direct link on infra errors and retry with skipOpenChat=true', async () => {
    const { chrome, runtimeMessageListeners } = makeChromeMock();
    global.chrome = chrome;

    eval(backgroundScript);
    const listener = runtimeMessageListeners[runtimeMessageListeners.length - 1];

    chrome.tabs.sendMessage.mockImplementation((tabId, message, cb) => {
      if (message.command === 'sendMedia' && !message.skipOpenChat) {
        cb({ error: 'Search input not found' });
        return;
      }
      if (message.command === 'openDirectLink') {
        cb({ success: true, ok: true });
        return;
      }
      cb({ success: true });
    });

    const response = await sendRuntimeRequest(listener, {
      type: 'SEND_MEDIA',
      data: {
        chatId: '5511999999999@c.us',
        base64: 'data:image/png;base64,AAAA',
        filename: 'arquivo.png',
        caption: 'teste',
        mimetype: 'image/png',
        contactName: 'Teste Midia'
      }
    });

    expect(response).toEqual({ success: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);
    expect(chrome.tabs.sendMessage.mock.calls[1][1].command).toBe('openDirectLink');

    const retryPayload = chrome.tabs.sendMessage.mock.calls[2][1];
    expect(retryPayload.command).toBe('sendMedia');
    expect(retryPayload.skipOpenChat).toBe(true);
  });
});
