console.log('WA Campaign Manager: Content Script Loaded');

const SELECTORS = {
  sendButton: 'span[data-icon="send"], span[data-icon="send-filled"], button[aria-label*="Send" i], button[aria-label*="Enviar" i], div[role="button"][aria-label*="Send" i], div[role="button"][aria-label*="Enviar" i]',
  messageBox: 'footer div[contenteditable="true"][data-tab], footer div[role="textbox"][contenteditable="true"], div[title="Type a message"], div[title="Digite uma mensagem"], div[aria-label*="Type a message" i][contenteditable="true"], div[aria-label*="Digite uma mensagem" i][contenteditable="true"], div[contenteditable="true"][data-tab="10"]',
  // Search selectors can vary between WA builds
  searchBox: 'div[contenteditable="true"][data-tab="3"], div[contenteditable="true"][data-tab="11"], div[role="textbox"][contenteditable="true"][data-tab], div[aria-label*="Search" i][contenteditable="true"], div[aria-label*="Pesquisar" i][contenteditable="true"]',
  invalidNumber: 'div[data-animate-modal-popup="true"]',
  chatList: 'div[aria-label="Chat list"]',
  chatItem: 'div[role="listitem"]',
  incomingMessage: 'div.message-in',
  outgoingMessage: 'div.message-out',
  messageText: 'span.selectable-text',
  activeChatTitle: 'header span[title], header div[title]',
  emojiButton: 'button[aria-label*="emoji" i], button[title*="emoji" i], span[data-icon="smiley"]',
  attachButton: 'button[aria-label*="anex" i], button[title*="anex" i], button[aria-label*="attach" i], button[title*="attach" i], span[data-icon="plus"], span[data-icon="clip"]',
  micButton: 'button[aria-label*="micro" i], button[title*="micro" i], button[aria-label*="voice" i], button[title*="voice" i], span[data-icon="ptt"], span[data-icon="microphone"]',
};

const UI_STATE = {
  runtime: {
    isActive: false,
    realtimeStatus: 'disconnected',
    isProcessingQueue: false,
    isManualSendInProgress: false,
    lastRealtimeEventAt: null,
    settings: {},
  },
  isOpen: false,
  events: [],
  unreadEvents: 0,
};

let glassRoot = null;
let glassRefs = null;

function safeSendRuntimeMessage(payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          resolve({ success: false, error: runtimeError.message });
          return;
        }

        resolve(response || { success: false });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

function ensureGlassStyles() {
  if (document.getElementById('wa-manager-glass-style')) return;

  const style = document.createElement('style');
  style.id = 'wa-manager-glass-style';
  style.textContent = `
    #wa-manager-glass-root {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483646;
      font-family: "Avenir Next", "SF Pro Display", "Segoe UI Variable", "Segoe UI", sans-serif;
      color: #1f2937;
    }

    #wa-manager-glass-root * {
      box-sizing: border-box;
    }

    #wa-manager-glass-root .wa-glass-pill {
      border: 1px solid rgba(255, 255, 255, 0.7);
      background: rgba(255, 255, 255, 0.56);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border-radius: 999px;
      padding: 8px 12px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      box-shadow: 0 14px 32px -24px rgba(15, 23, 42, 0.9);
      font-size: 12px;
      font-weight: 700;
      color: #2b354a;
    }

    #wa-manager-glass-root .wa-pill-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #f59e0b;
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5);
      animation: waPulseDot 1.8s infinite;
    }

    #wa-manager-glass-root .wa-pill-dot.is-online {
      background: #34c759;
      box-shadow: 0 0 0 0 rgba(52, 199, 89, 0.5);
    }

    #wa-manager-glass-root .wa-pill-dot.is-connecting {
      background: #0ea5e9;
      box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.5);
    }

    @keyframes waPulseDot {
      0%, 100% { transform: scale(0.95); opacity: 0.6; }
      50% { transform: scale(1.25); opacity: 1; }
    }

    #wa-manager-glass-root .wa-pill-count {
      min-width: 18px;
      height: 18px;
      border-radius: 999px;
      background: rgba(255, 45, 85, 0.9);
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      padding: 0 6px;
    }

    #wa-manager-glass-root .wa-glass-backdrop {
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.25s ease;
      backdrop-filter: blur(0px);
      -webkit-backdrop-filter: blur(0px);
    }

    #wa-manager-glass-root.is-open .wa-glass-backdrop {
      pointer-events: auto;
      opacity: 1;
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      background: rgba(8, 15, 30, 0.06);
    }

    #wa-manager-glass-root .wa-glass-panel {
      margin-top: 10px;
      width: 320px;
      border: 1px solid rgba(255, 255, 255, 0.66);
      background: rgba(255, 255, 255, 0.62);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-radius: 18px;
      box-shadow: 0 24px 45px -34px rgba(15, 23, 42, 0.9);
      padding: 12px;
      transform: translateY(-8px) scale(0.96);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }

    #wa-manager-glass-root.is-open .wa-glass-panel {
      transform: translateY(0) scale(1);
      opacity: 1;
      pointer-events: auto;
    }

    #wa-manager-glass-root .wa-panel-head h4 {
      margin: 0;
      font-size: 15px;
      color: #1f2937;
      letter-spacing: -0.01em;
    }

    #wa-manager-glass-root .wa-panel-head p {
      margin: 3px 0 0;
      font-size: 11px;
      color: #56617a;
    }

    #wa-manager-glass-root .wa-panel-stats {
      margin-top: 10px;
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #wa-manager-glass-root .wa-stat {
      border: 1px solid rgba(255, 255, 255, 0.7);
      background: rgba(255, 255, 255, 0.62);
      border-radius: 12px;
      padding: 8px;
    }

    #wa-manager-glass-root .wa-stat span {
      display: block;
      font-size: 11px;
      color: #5c6780;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    #wa-manager-glass-root .wa-stat strong {
      font-size: 12px;
      color: #1f2937;
    }

    #wa-manager-glass-root .wa-panel-actions {
      margin-top: 10px;
      display: flex;
      gap: 8px;
    }

    #wa-manager-glass-root .wa-btn {
      flex: 1;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.72);
      padding: 9px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: #374151;
      background: rgba(255, 255, 255, 0.68);
    }

    #wa-manager-glass-root .wa-btn.primary {
      color: #fff;
      border-color: transparent;
      background: linear-gradient(135deg, #007aff 0%, #5856d6 100%);
    }

    #wa-manager-glass-root .wa-event-list {
      margin-top: 10px;
      max-height: 130px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 2px;
    }

    #wa-manager-glass-root .wa-event-list::-webkit-scrollbar {
      width: 5px;
    }

    #wa-manager-glass-root .wa-event-list::-webkit-scrollbar-thumb {
      background: rgba(51, 65, 85, 0.25);
      border-radius: 999px;
    }

    #wa-manager-glass-root .wa-event-item {
      border: 1px solid rgba(255, 255, 255, 0.68);
      background: rgba(255, 255, 255, 0.6);
      border-radius: 10px;
      padding: 7px 8px;
      font-size: 11px;
      color: #2f374a;
    }

    #wa-manager-glass-toast-wrap {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }

    .wa-glass-toast {
      min-width: 280px;
      max-width: 360px;
      background: rgba(25, 25, 35, 0.62);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      padding: 12px 14px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: white;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
      animation: waToastIn 0.32s ease-out;
    }

    .wa-glass-toast .icon {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      background: rgba(255, 255, 255, 0.16);
      flex-shrink: 0;
    }

    .wa-glass-toast strong {
      display: block;
      font-size: 13px;
      margin-bottom: 2px;
      letter-spacing: -0.01em;
    }

    .wa-glass-toast p {
      margin: 0;
      font-size: 12px;
      opacity: 0.82;
    }

    .wa-glass-toast.tone-success .icon { background: rgba(52, 199, 89, 0.26); }
    .wa-glass-toast.tone-warning .icon { background: rgba(245, 158, 11, 0.26); }
    .wa-glass-toast.tone-error .icon { background: rgba(255, 59, 48, 0.26); }

    @keyframes waToastIn {
      from { transform: translateX(80px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;

  document.head.appendChild(style);
}

function appendIslandEvent(text) {
  const safeText = String(text || '').trim();
  if (!safeText) return;

  UI_STATE.events.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    text: safeText,
  });

  UI_STATE.events = UI_STATE.events.slice(0, 8);
  if (!UI_STATE.isOpen) {
    UI_STATE.unreadEvents += 1;
  }
}

function formatRealtimeLabel(status) {
  if (status === 'connected') return 'Realtime online';
  if (status === 'connecting') return 'Conectando realtime';
  return 'Realtime offline';
}

function updateGlassUi() {
  if (!glassRefs) return;

  const runtime = UI_STATE.runtime || {};
  const realtimeStatus = String(runtime.realtimeStatus || 'disconnected');
  const queueStatus = runtime.isManualSendInProgress
    ? 'Envio manual em andamento'
    : runtime.isProcessingQueue
      ? 'Fila processando'
      : runtime.isActive
        ? 'Fila ativa'
        : 'Fila pausada';

  glassRefs.root.classList.toggle('is-open', UI_STATE.isOpen);
  glassRefs.pillLabel.textContent = queueStatus;
  glassRefs.pillCount.textContent = String(Math.min(99, UI_STATE.unreadEvents));
  glassRefs.pillCount.style.display = UI_STATE.unreadEvents > 0 ? 'inline-flex' : 'none';

  glassRefs.realtimeText.textContent = formatRealtimeLabel(realtimeStatus);
  glassRefs.queueText.textContent = queueStatus;
  glassRefs.lastEventText.textContent = runtime.lastRealtimeEventAt
    ? new Date(runtime.lastRealtimeEventAt).toLocaleTimeString()
    : '-';
  glassRefs.toggleQueueBtn.textContent = runtime.isActive ? 'Pausar fila' : 'Ativar fila';
  glassRefs.blurText.textContent = runtime?.settings?.softBlurOnIsland ? 'Blur: ON' : 'Blur: OFF';

  glassRefs.pillDot.classList.toggle('is-online', realtimeStatus === 'connected');
  glassRefs.pillDot.classList.toggle('is-connecting', realtimeStatus === 'connecting');

  const blurEnabled = runtime?.settings?.softBlurOnIsland !== false;
  glassRefs.backdrop.style.display = blurEnabled ? 'block' : 'none';

  glassRefs.eventList.innerHTML = '';
  if (UI_STATE.events.length === 0) {
    const item = document.createElement('div');
    item.className = 'wa-event-item';
    item.textContent = 'Sem eventos recentes.';
    glassRefs.eventList.appendChild(item);
  } else {
    UI_STATE.events.forEach((eventItem) => {
      const item = document.createElement('div');
      item.className = 'wa-event-item';
      item.textContent = `${new Date(eventItem.at).toLocaleTimeString()} - ${eventItem.text}`;
      glassRefs.eventList.appendChild(item);
    });
  }
}

function showGlassToast(payload = {}) {
  const wrapperId = 'wa-manager-glass-toast-wrap';
  let wrapper = document.getElementById(wrapperId);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = wrapperId;
    document.body.appendChild(wrapper);
  }

  const tone = String(payload.tone || 'info').trim().toLowerCase();
  const icon = tone === 'success' ? '✅' : tone === 'warning' ? '⚠️' : tone === 'error' ? '⛔' : '🚀';
  const toast = document.createElement('div');
  toast.className = `wa-glass-toast tone-${tone}`;
  toast.innerHTML = `
    <div class=\"icon\">${icon}</div>
    <div>
      <strong>${String(payload.title || 'Atualização')}</strong>
      <p>${String(payload.message || '')}</p>
    </div>
  `;

  wrapper.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3600);
}

function updateRuntimeState(nextState = {}) {
  const previous = UI_STATE.runtime || {};
  UI_STATE.runtime = {
    ...previous,
    ...(nextState || {}),
  };

  const previousQueue = Boolean(previous.isActive);
  const currentQueue = Boolean(UI_STATE.runtime.isActive);
  const previousRealtime = String(previous.realtimeStatus || 'disconnected');
  const currentRealtime = String(UI_STATE.runtime.realtimeStatus || 'disconnected');

  if (previousQueue !== currentQueue) {
    appendIslandEvent(currentQueue ? 'Fila ativada' : 'Fila pausada');
  }

  if (previousRealtime !== currentRealtime) {
    appendIslandEvent(formatRealtimeLabel(currentRealtime));
  }

  updateGlassUi();
}

function createGlassIsland() {
  if (glassRoot) return;
  ensureGlassStyles();

  glassRoot = document.createElement('div');
  glassRoot.id = 'wa-manager-glass-root';
  glassRoot.innerHTML = `
    <button type=\"button\" class=\"wa-glass-pill\" aria-label=\"Abrir painel WA Manager\">
      <span class=\"wa-pill-dot\"></span>
      <span class=\"wa-pill-label\">Fila pausada</span>
      <span class=\"wa-pill-count\" style=\"display:none;\">0</span>
    </button>
    <div class=\"wa-glass-backdrop\"></div>
    <aside class=\"wa-glass-panel\">
      <div class=\"wa-panel-head\">
        <h4>WA Manager Island</h4>
        <p>Controle rápido em vidro</p>
      </div>
      <div class=\"wa-panel-stats\">
        <div class=\"wa-stat\"><span>Realtime</span><strong data-ref=\"realtime\">-</strong></div>
        <div class=\"wa-stat\"><span>Fila</span><strong data-ref=\"queue\">-</strong></div>
        <div class=\"wa-stat\"><span>Último evento</span><strong data-ref=\"last-event\">-</strong></div>
        <div class=\"wa-stat\"><span>Painel</span><strong data-ref=\"blur-mode\">Blur: ON</strong></div>
      </div>
      <div class=\"wa-panel-actions\">
        <button type=\"button\" class=\"wa-btn primary\" data-action=\"toggle-queue\">Ativar fila</button>
        <button type=\"button\" class=\"wa-btn\" data-action=\"open-options\">Configurações</button>
      </div>
      <div class=\"wa-event-list\"></div>
    </aside>
  `;

  document.body.appendChild(glassRoot);

  glassRefs = {
    root: glassRoot,
    pill: glassRoot.querySelector('.wa-glass-pill'),
    pillDot: glassRoot.querySelector('.wa-pill-dot'),
    pillLabel: glassRoot.querySelector('.wa-pill-label'),
    pillCount: glassRoot.querySelector('.wa-pill-count'),
    backdrop: glassRoot.querySelector('.wa-glass-backdrop'),
    realtimeText: glassRoot.querySelector('[data-ref=\"realtime\"]'),
    queueText: glassRoot.querySelector('[data-ref=\"queue\"]'),
    lastEventText: glassRoot.querySelector('[data-ref=\"last-event\"]'),
    blurText: glassRoot.querySelector('[data-ref=\"blur-mode\"]'),
    toggleQueueBtn: glassRoot.querySelector('[data-action=\"toggle-queue\"]'),
    openOptionsBtn: glassRoot.querySelector('[data-action=\"open-options\"]'),
    eventList: glassRoot.querySelector('.wa-event-list'),
  };

  const toggleOpen = () => {
    UI_STATE.isOpen = !UI_STATE.isOpen;
    if (UI_STATE.isOpen) {
      UI_STATE.unreadEvents = 0;
    }
    updateGlassUi();
  };

  glassRefs.pill.addEventListener('click', toggleOpen);
  glassRefs.backdrop.addEventListener('click', toggleOpen);

  glassRefs.toggleQueueBtn.addEventListener('click', async () => {
    const isActive = Boolean(UI_STATE.runtime?.isActive);
    await safeSendRuntimeMessage({ action: 'TOGGLE_STATUS', value: !isActive });
    appendIslandEvent(!isActive ? 'Solicitado: iniciar fila' : 'Solicitado: pausar fila');
    updateGlassUi();
  });

  glassRefs.openOptionsBtn.addEventListener('click', async () => {
    await safeSendRuntimeMessage({ action: 'OPEN_OPTIONS_PAGE' });
  });

  updateGlassUi();
}

// Utils
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function initContentGlassUi() {
  createGlassIsland();

  safeSendRuntimeMessage({ action: 'GET_RUNTIME_STATE' }).then((response) => {
    if (!response?.success) return;
    updateRuntimeState(response.runtimeState || {});
  });
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildSearchTerms(phone, providedTerms = []) {
  const normalized = digitsOnly(phone);
  const terms = new Set();

  (providedTerms || []).forEach((term) => {
    if (term) terms.add(String(term));
  });

  if (normalized) {
    terms.add(normalized);
    terms.add(`+${normalized}`);

    if (normalized.startsWith('55') && normalized.length > 2) {
      const national = normalized.slice(2);
      terms.add(national);
      terms.add(`+55${national}`);
      terms.add(`+55 ${national.slice(0, 2)} ${national.slice(2)}`);
    }
  }

  return Array.from(terms).filter(Boolean);
}

function extractChatContext(fallbackPhone = '') {
  const fallbackDigits = digitsOnly(fallbackPhone);
  const context = {
    phone: '',
    name: '',
    phoneSource: 'unknown', // url | title | fallback | unknown
  };

  try {
    const currentUrl = new URL(window.location.href);
    const urlPhone = digitsOnly(currentUrl.searchParams.get('phone'));
    if (urlPhone) {
      context.phone = urlPhone;
      context.phoneSource = 'url';
    }
  } catch (error) {
    // Ignore URL parsing issues.
  }

  const titleElement = document.querySelector(SELECTORS.activeChatTitle);
  const titleText = String(titleElement?.getAttribute('title') || titleElement?.textContent || '').trim();
  if (titleText) {
    context.name = titleText;
    const titleDigits = digitsOnly(titleText);
    if (!context.phone && titleDigits.length >= 8) {
      context.phone = titleDigits;
      context.phoneSource = 'title';
    }
  }

  if (!context.phone && fallbackDigits) {
    context.phone = fallbackDigits;
    context.phoneSource = 'fallback';
  }

  return context;
}

function buildInboundFingerprint(phone, text, prePlainText) {
  return `${digitsOnly(phone)}|${String(text || '').trim()}|${String(prePlainText || '').trim()}`;
}

function extractInboundMessages(fallbackPhone = '', limit = 20) {
  const context = extractChatContext(fallbackPhone);
  const inboundNodes = Array.from(document.querySelectorAll(SELECTORS.incomingMessage));
  const selectedNodes = inboundNodes.slice(-Math.max(1, Number(limit) || 20));
  const items = [];
  const seen = new Set();

  selectedNodes.forEach((node) => {
    const copyable = node.querySelector('[data-pre-plain-text]');
    const prePlainText = String(copyable?.getAttribute('data-pre-plain-text') || '').trim();

    const textNode = node.querySelector('span.selectable-text');
    let text = String(textNode?.innerText || textNode?.textContent || '').trim();

    if (!text) {
      const compact = String(node.innerText || '').trim();
      text = compact.split('\n').map((line) => line.trim()).filter(Boolean).join(' ').trim();
    }

    if (!text) return;

    const fingerprint = buildInboundFingerprint(context.phone || fallbackPhone, text, prePlainText);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);

    items.push({
      text,
      at: new Date().toISOString(),
      prePlainText,
      fingerprint,
    });
  });

  return {
    phone: context.phone || digitsOnly(fallbackPhone),
    name: context.name || '',
    messages: items,
  };
}

function parseWhatsappTimestamp(prePlainText = '') {
  const raw = String(prePlainText || '').trim();
  if (!raw) return null;

  const bracketMatch = raw.match(/\[([^\]]+)\]/);
  if (!bracketMatch) return null;

  const token = String(bracketMatch[1] || '').trim();
  const timestampMatch = token.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?,\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!timestampMatch) return null;

  const [, hourRaw, minuteRaw, secondRaw, dayRaw, monthRaw, yearRaw] = timestampMatch;
  let year = Number(yearRaw);
  if (year < 100) {
    year += 2000;
  }

  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw || 0);

  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function findScrollableAncestor(node) {
  let current = node;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const overflowY = String(style?.overflowY || '').toLowerCase();
    const isScrollable = (overflowY === 'auto' || overflowY === 'scroll')
      && current.scrollHeight > (current.clientHeight + 40);

    if (isScrollable) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function getMessageNodeText(messageNode) {
  const textNodes = Array.from(messageNode.querySelectorAll(SELECTORS.messageText));
  if (textNodes.length > 0) {
    const text = textNodes
      .map((node) => String(node.innerText || node.textContent || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    if (text) return text;
  }

  const compact = String(messageNode.innerText || '').trim();
  if (!compact) return '';

  const lines = compact
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.join(' ').trim();
}

function getMessageMediaUrl(messageNode) {
  const imageNode = messageNode.querySelector('img[src]');
  if (imageNode?.src) {
    const src = String(imageNode.src).trim();
    if (src.startsWith('blob:')) return '[imagem]';
    return src;
  }

  const videoSource = messageNode.querySelector('video source[src], video[src]');
  if (videoSource?.src) {
    const src = String(videoSource.src).trim();
    if (src.startsWith('blob:')) return '[video]';
    return src;
  }

  const documentLink = messageNode.querySelector('a[href^="http"]');
  if (documentLink?.href) return String(documentLink.href).trim();

  return '';
}

async function preloadOlderMessages(options = {}) {
  const maxIterations = Number.isFinite(Number(options.maxIterations))
    ? Math.max(1, Math.min(Number(options.maxIterations), 30))
    : 18;

  const messageSelector = `${SELECTORS.incomingMessage}, ${SELECTORS.outgoingMessage}`;
  const initialNodes = Array.from(document.querySelectorAll(messageSelector));
  const anchorNode = initialNodes[0];
  if (!anchorNode) return;

  const scroller = findScrollableAncestor(anchorNode);
  if (!scroller) return;

  let previousCount = initialNodes.length;
  let stableIterations = 0;

  for (let attempt = 0; attempt < maxIterations; attempt += 1) {
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(340);

    const nextCount = document.querySelectorAll(messageSelector).length;
    const reachedTop = scroller.scrollTop <= 2;

    if (nextCount === previousCount && reachedTop) {
      stableIterations += 1;
    } else {
      stableIterations = 0;
    }

    previousCount = nextCount;

    if (stableIterations >= 2) {
      break;
    }
  }
}

function extractChatHistory(fallbackPhone = '', options = {}) {
  const context = extractChatContext(fallbackPhone);
  const messageSelector = `${SELECTORS.incomingMessage}, ${SELECTORS.outgoingMessage}`;
  const allNodes = Array.from(document.querySelectorAll(messageSelector));
  const parsedLimit = Number(options.limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(50, Math.min(parsedLimit, 4000))
    : 1200;

  const selectedNodes = allNodes.length > safeLimit
    ? allNodes.slice(allNodes.length - safeLimit)
    : allNodes;

  const messages = [];
  const seen = new Set();

  selectedNodes.forEach((node) => {
    const direction = node.classList.contains('message-in') ? 'inbound' : 'outbound';
    const prePlainText = String(node.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '').trim();
    const text = getMessageNodeText(node);
    const mediaUrl = getMessageMediaUrl(node);
    const at = parseWhatsappTimestamp(prePlainText) || new Date().toISOString();

    const resolvedText = String(text || '').trim() || String(mediaUrl || '').trim();
    if (!resolvedText) return;

    const fingerprint = `${direction}|${resolvedText}|${prePlainText || at}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);

    messages.push({
      direction,
      text: resolvedText,
      mediaUrl: String(mediaUrl || '').trim(),
      at,
      prePlainText,
      fingerprint,
      name: context.name || '',
    });
  });

  return {
    phone: context.phone || digitsOnly(fallbackPhone),
    name: context.name || '',
    messages,
  };
}

async function captureChatHistory(fallbackPhone = '', options = {}) {
  const shouldPreloadOlder = options.preloadOlder !== false;

  if (shouldPreloadOlder) {
    await preloadOlderMessages({
      maxIterations: options.maxScrollIterations,
    });
  }

  return extractChatHistory(fallbackPhone, options);
}

function clearEditable(target) {
  if (!target) return;

  try {
    target.focus();
  } catch (error) {
    // Ignore focus errors.
  }

  // Some WA fields are real inputs, others are contenteditable divs.
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.value = '';
    try {
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      // Best-effort only.
    }
    return;
  }

  // Prefer selecting node contents explicitly (more reliable than execCommand('selectAll')).
  try {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch (error) {
    // Ignore selection errors.
  }

  try {
    // Replace the current selection with an empty string.
    document.execCommand('insertText', false, '');
  } catch (error) {
    // Fallback below.
  }

  if (target.isContentEditable) {
    try {
      target.textContent = '';
      target.innerHTML = '';
    } catch (error) {
      // Ignore direct DOM mutations errors.
    }
  }

  try {
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    // Best-effort only.
  }
}

function getTypingDelayMs(char, humanized) {
  if (!humanized) {
    return Math.random() * 50 + 20;
  }

  if (/[\n]/.test(char)) return Math.random() * 260 + 180;
  if (/[.,!?;:]/.test(char)) return Math.random() * 190 + 140;
  if (/\s/.test(char)) return Math.random() * 130 + 70;

  return Math.random() * 95 + 35;
}

function normalizeEditableText(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function typeInEditable(target, text, options = {}) {
  const humanized = options.humanized !== false;

  // Validate if the target is visible and editable
  if (!target || target.offsetParent === null || !target.isContentEditable) {
    console.error('Target is not editable or not visible');
    return { success: false, error: 'Target is not editable or not visible' };
  }

  target.focus();

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    document.execCommand('insertText', false, char);

    let delay = getTypingDelayMs(char, humanized);

    if (humanized && index > 0 && index % 12 === 0) {
      delay += Math.random() * 220 + 120;
    }

    await sleep(delay);
  }

  const expectedText = normalizeEditableText(text);
  let currentText = normalizeEditableText(target.textContent);

  // Confirm the text was inserted correctly (normalized).
  if (currentText !== expectedText) {
    console.warn('Text insertion validation failed. Retrying...');
    clearEditable(target);
    await sleep(200);
    target.focus();
    document.execCommand('insertText', false, text);
    // Retry once and re-check.
    await sleep(120);
    currentText = normalizeEditableText(target.textContent);
    if (currentText !== expectedText) {
      console.error('Text insertion failed after retry. Aborting further attempts.');
      return { success: false, error: 'Text insertion failed after retry' };
    }
  }

  return { success: true };
}

function getElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const intervalTime = 500;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        resolve(element);
      }

      elapsedTime += intervalTime;
      if (elapsedTime >= timeout) {
        clearInterval(interval);
        resolve(null);
      }
    }, intervalTime);
  });
}

async function waitForMessageComposer(timeoutMs = 12000) {
  const startedAt = Date.now();
  const timeout = Math.max(1000, Number(timeoutMs) || 12000);

  while ((Date.now() - startedAt) < timeout) {
    const footerCandidates = Array.from(
      document.querySelectorAll('footer div[contenteditable="true"], footer [role="textbox"][contenteditable="true"]'),
    ).filter((element) => isVisibleElement(element) && element.isContentEditable);

    if (footerCandidates.length > 0) {
      return footerCandidates[0];
    }

    const candidate = document.querySelector(SELECTORS.messageBox);
    if (candidate && isVisibleElement(candidate) && candidate.isContentEditable) {
      return candidate;
    }

    await sleep(220);
  }

  return null;
}

async function handleOpenChat(phone, searchTerms = []) {
  console.log('Attempting to open chat via DOM search:', phone);

  const box = await getElement(SELECTORS.searchBox);
  if (!box) {
    console.error('Search box not found');
    return { success: false, error: 'Search box not found' };
  }

  // Usar apenas um termo: nome OU telefone (nunca ambos)
  let term = '';
  if (searchTerms && searchTerms.length > 0) {
    term = String(searchTerms[0] || '').trim();
  } else if (phone) {
    term = String(phone).trim();
  }
  if (!term) {
    return { success: false, error: 'No search term available' };
  }

  const termDigits = digitsOnly(term);
  const termTail = termDigits.slice(-10);

  clearEditable(box);
  await sleep(180);
  await typeInEditable(box, term, { humanized: true });
  // Aguardar os resultados de busca aparecerem
  await sleep(900);

  // Tentar encontrar e clicar no item correto da lista de resultados
  // O WhatsApp renderiza resultados em elementos listitem ou spans com título/subtítulo
  const resultSelectors = [
    'div[role="listitem"]',
    'div[aria-label][role="row"]',
    'li[role="listitem"]',
  ].join(',');

  let clickedItem = null;

  for (let attempt = 0; attempt < 14; attempt++) {
    const items = Array.from(document.querySelectorAll(resultSelectors));
    const visibleItems = items.filter(isVisibleElement);

    for (const item of visibleItems) {
      const itemText = String(item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim();
      const itemDigits = digitsOnly(itemText);
      const ariaLabel = String(item.getAttribute('aria-label') || '').trim();
      const ariaDigits = digitsOnly(ariaLabel);

      // Verificar match por dígitos (últimos 10 para tolerar DDI variante)
      const matchesText = termTail && itemDigits && itemDigits.includes(termTail);
      const matchesAria = termTail && ariaDigits && ariaDigits.includes(termTail);
      // Fallback: match por nome (quando term não é número)
      const matchesName = !termDigits && itemText.toLowerCase().includes(term.toLowerCase());

      if (matchesText || matchesAria || matchesName) {
        console.log('[handleOpenChat] Found matching contact item, clicking:', itemText.slice(0, 60));
        item.click();
        clickedItem = item;
        break;
      }
    }

    if (clickedItem) break;

    // Se não encontrou nenhum item correspondente ainda, aguardar mais
    await sleep(300);
  }

  if (!clickedItem) {
    // Fallback: se não encontrou item na lista, tentar Enter (comportamento anterior)
    console.warn('[handleOpenChat] No matching contact found in list — falling back to Enter key.');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }));
  }

  await sleep(900);

  // Aguarda a abertura da conversa verificando o message box
  const msgBox = await getElement(SELECTORS.messageBox, 8000);
  if (!msgBox) {
    return { success: false, error: 'Chat open validation failed (message box not found)' };
  }

  // Validação extra: verificar se o chat aberto é o contato correto pelo número
  if (termDigits) {
    const context = extractChatContext('');
    const contextDigits = digitsOnly(context.phone);
    if (contextDigits && !isSamePhoneLoose(contextDigits, termDigits)) {
      console.warn(`[handleOpenChat] Chat opened but phone mismatch: expected ${termDigits}, got ${contextDigits}`);
      // Não retorna erro — o WhatsApp às vezes só mostra o número após o chat carregar
      // O caller (handleOpenChatViaAgentBridge) verificará o contato correto se necessário
    }
  }

  console.log('Chat opened successfully.');
  return {
    success: true,
    searchTerm: term,
    clickedItem: !!clickedItem,
  };
}

function isVisibleElement(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  if (!style) return false;
  if (style.visibility === 'hidden') return false;
  if (style.display === 'none') return false;
  return true;
}

function isSamePhoneLoose(left, right) {
  const leftDigits = digitsOnly(left);
  const rightDigits = digitsOnly(right);
  if (!leftDigits || !rightDigits) return false;
  if (leftDigits === rightDigits) return true;

  const leftTail = leftDigits.slice(-10);
  const rightTail = rightDigits.slice(-10);
  if (leftTail && rightTail && leftTail === rightTail) return true;

  return false;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function isLikelyAgentChatContext(context = {}, { agentDigits = '', agentName = '' } = {}) {
  const contextPhone = digitsOnly(context.phone || '');
  const contextName = normalizeName(context.name || '');
  const normalizedAgentName = normalizeName(agentName || '');

  // Strong signal: explicit phone match to the configured agent chat.
  if (agentDigits && contextPhone && isSamePhoneLoose(contextPhone, agentDigits)) {
    return true;
  }

  // Secondary signal: exact same title as the previously opened agent chat (avoid fuzzy includes).
  if (!contextPhone && normalizedAgentName && contextName && contextName === normalizedAgentName) {
    return true;
  }

  return false;
}

function isLikelyTargetChatContext(context = {}, targetPhone = '') {
  const targetDigits = digitsOnly(targetPhone);
  if (!targetDigits) return false;

  const contextPhone = digitsOnly(context.phone || '');
  if (contextPhone && isSamePhoneLoose(contextPhone, targetDigits)) {
    return true;
  }

  const contextNameDigits = digitsOnly(context.name || '');
  const targetTail = targetDigits.slice(-8);
  if (targetTail && contextNameDigits && contextNameDigits.includes(targetTail)) {
    return true;
  }

  return false;
}

async function waitForChatPhone(targetPhone, timeoutMs = 10000) {
  const startedAt = Date.now();
  const timeout = Math.max(1000, Number(timeoutMs) || 10000);
  const targetDigits = digitsOnly(targetPhone);

  if (!targetDigits) return false;

  while ((Date.now() - startedAt) < timeout) {
    const context = extractChatContext('');
    if (context.phoneSource !== 'fallback' && isSamePhoneLoose(context.phone, targetDigits)) {
      return true;
    }

    await sleep(260);
  }

  return false;
}

function clickElementCenterLeft(element) {
  if (!element || !isVisibleElement(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const clientX = rect.left + (rect.width / 2);
  const clientY = rect.top + (rect.height / 2);
  const target = document.elementFromPoint(clientX, clientY) || element;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
  };

  try {
    target.dispatchEvent(new MouseEvent('mousemove', eventInit));
    target.dispatchEvent(new MouseEvent('mouseover', eventInit));
    target.dispatchEvent(new MouseEvent('mouseenter', eventInit));
    target.dispatchEvent(new MouseEvent('mousedown', eventInit));
    target.dispatchEvent(new MouseEvent('mouseup', eventInit));
    target.dispatchEvent(new MouseEvent('click', eventInit));
    return true;
  } catch (error) {
    try {
      element.click();
      return true;
    } catch (clickError) {
      return false;
    }
  }
}

function getNodeCompactText(node) {
  if (!node) return '';
  return String(node.innerText || node.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickPhoneClickTarget(messageNode, targetPhone) {
  if (!messageNode) return null;

  const targetDigits = digitsOnly(targetPhone);
  if (!targetDigits) return null;
  const targetTail = targetDigits.slice(-8);
  if (!targetTail) return null;

  const candidates = Array.from(messageNode.querySelectorAll(
    'a[href], span[role="link"], div[role="link"], span.selectable-text, div.selectable-text, span, div',
  ));
  let bestCandidate = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) continue;

    const text = String(candidate.innerText || candidate.textContent || '').trim();
    const href = String(candidate.getAttribute('href') || '').trim();
    const mergedDigits = digitsOnly(`${text} ${href}`);
    if (!mergedDigits) continue;

    const candidateTail = mergedDigits.slice(-8);
    if (!candidateTail) continue;

    const matchesTarget = (
      mergedDigits.includes(targetDigits)
      || targetDigits.includes(mergedDigits)
      || candidateTail === targetTail
    );
    if (!matchesTarget) continue;

    let score = 0;
    if (candidate.matches('a[href]')) score += 5;
    if (candidate.matches('[role="link"]')) score += 4;
    if (candidate.matches('.selectable-text')) score += 3;
    if (href && digitsOnly(href).includes(targetTail)) score += 4;
    if (digitsOnly(text).includes(targetTail)) score += 2;

    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (rect.width * rect.height) < 22000) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  if (isVisibleElement(messageNode)) {
    const compact = getNodeCompactText(messageNode);
    if (digitsOnly(compact).includes(targetTail)) {
      return messageNode;
    }
  }

  return null;
}

async function clickConversationWithNumberOption(targetPhone, timeoutMs = 9000) {
  const timeout = Math.max(1000, Number(timeoutMs) || 9000);
  const startedAt = Date.now();
  const targetDigits = digitsOnly(targetPhone);
  const targetTail = targetDigits.slice(-8);
  const dialogSelectors = [
    'div[role="button"]',
    'span[role="button"]',
    'button',
    'div[role="menuitem"]',
    'li[role="menuitem"]',
    'li[role="button"]',
    'div[role="option"]',
    'span[role="option"]',
    'div[tabindex="0"]',
    'span[tabindex="0"]',
  ].join(',');

  while ((Date.now() - startedAt) < timeout) {
    const candidates = Array.from(document.querySelectorAll(dialogSelectors));

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate)) continue;

      const label = String(
        candidate.getAttribute('aria-label')
        || candidate.innerText
        || candidate.textContent
        || '',
      ).trim();
      if (!label) continue;

      const normalized = label.toLowerCase();
      const labelDigits = digitsOnly(label);
      const labelTail = labelDigits.slice(-8);
      const hasConversationIntent = (
        normalized.includes('conversar com')
        || normalized.includes('conversa com')
        || normalized.includes('converse com')
        || normalized.includes('chat with')
        || normalized.includes('message +')
        || normalized.includes('mensagem para')
        || normalized.includes('enviar mensagem para')
        || normalized.includes('abrir conversa')
      );

      if (!hasConversationIntent) continue;

      const seemsTarget = (
        !targetTail
        || !labelTail
        || labelTail === targetTail
        || labelDigits.includes(targetDigits)
      );

      if (!seemsTarget) continue;

      const clicked = clickElementCenterLeft(candidate);
      if (!clicked) continue;
      await sleep(450);
      const chatOpened = await waitForChatPhone(targetDigits, 7000);
      if (chatOpened) {
        return { success: true, clickedLabel: label };
      }
    }

    await sleep(250);
  }

  return { success: false, error: 'Conversation option not found.' };
}

async function clickRecentPhoneFromSelfChat(targetPhone, timeoutMs = 10000) {
  const timeout = Math.max(1000, Number(timeoutMs) || 10000);
  const startedAt = Date.now();
  const targetDigits = digitsOnly(targetPhone);
  const targetTail = targetDigits.slice(-8);

  while ((Date.now() - startedAt) < timeout) {
    const outgoingNodes = Array.from(document.querySelectorAll(SELECTORS.outgoingMessage));
    const candidates = outgoingNodes
      .slice(-14)
      .reverse()
      .filter((node) => {
        const compact = getNodeCompactText(node);
        const compactDigits = digitsOnly(compact);
        if (!compactDigits) return false;
        if (!targetTail) return true;
        return compactDigits.includes(targetTail);
      });

    for (const node of candidates) {
      const clickTarget = pickPhoneClickTarget(node, targetDigits);
      if (!clickTarget) continue;

      const clicked = clickElementCenterLeft(clickTarget);
      if (!clicked) {
        continue;
      }

      await sleep(420);

      const openedDirectly = await waitForChatPhone(targetDigits, 4500);
      if (openedDirectly) {
        return { success: true, openedDirectly: true };
      }

      return { success: true, openedDirectly: false };
    }

    await sleep(260);
  }

  return { success: false, error: 'Could not click phone in self chat message.' };
}

async function handleOpenChatViaAgentBridge(agentPhone, targetPhone, options = {}) {
  const agentDigits = digitsOnly(agentPhone);
  const targetDigits = digitsOnly(targetPhone);
  const shouldHumanize = options.humanized !== false;
  const agentSearchTerms = Array.isArray(options.agentSearchTerms) ? options.agentSearchTerms : [];
  const agentQuery = String(options.agentQuery || '').trim();

  const openAgentTerms = [
    ...(agentQuery ? [agentQuery] : []),
    ...agentSearchTerms,
  ].filter(Boolean);

  if (!agentDigits && openAgentTerms.length === 0) {
    return { success: false, error: 'Agent bridge chat is required.' };
  }

  if (!targetDigits) {
    return { success: false, error: 'Target phone is required.' };
  }

  let openAgentResult = await handleOpenChat(agentDigits || '', openAgentTerms);
  if (!openAgentResult?.success && agentQuery) {
    // Some accounts don't match contacts by number; retry using chat query only.
    openAgentResult = await handleOpenChat('', [agentQuery]);
  }
  if (!openAgentResult?.success) {
    return {
      success: false,
      error: openAgentResult?.error || 'Failed to open agent bridge chat.',
      step: 'open_agent_chat',
    };
  }

  await sleep(550);
  const openedAgentContext = extractChatContext('');
  const agentContextRef = {
    agentDigits,
    agentName: String(openedAgentContext?.name || '').trim(),
  };

  const bridgeMessage = `+${targetDigits}`;
  const bridgeSendResult = await handleClickSend(bridgeMessage, { humanized: shouldHumanize, paste: true });
  if (!bridgeSendResult?.success) {
    return {
      success: false,
      error: bridgeSendResult?.error || 'Failed to send bridge number message.',
      step: 'send_bridge_message',
    };
  }

  await sleep(650);

  const clickPhoneResult = await clickRecentPhoneFromSelfChat(targetDigits, 12000);
  if (!clickPhoneResult?.success) {
    return {
      success: false,
      error: clickPhoneResult?.error || 'Failed to click phone bridge message.',
      step: 'click_bridge_phone',
    };
  }

  if (!clickPhoneResult.openedDirectly) {
    const chooseConversationResult = await clickConversationWithNumberOption(targetDigits, 9000);
    if (!chooseConversationResult?.success) {
      // WA can open the target chat directly after clicking the phone message, without
      // rendering the context menu option. If composer is ready and we're no longer in
      // the agent chat, continue instead of failing.
      const fallbackComposer = await waitForMessageComposer(2200);
      const fallbackContext = extractChatContext('');
      const movedToTarget = isLikelyTargetChatContext(fallbackContext, targetDigits);
      const stillOnAgentFallback = isLikelyAgentChatContext(fallbackContext, agentContextRef);

      if (!(fallbackComposer && (movedToTarget || !stillOnAgentFallback))) {
        return {
          success: false,
          error: chooseConversationResult?.error || 'Failed to choose "Conversar com numero".',
          step: 'choose_conversation_option',
        };
      }
    }
  }

  const chatReady = await waitForChatPhone(targetDigits, 12000);
  const composerReady = await waitForMessageComposer(12000);
  const finalContext = extractChatContext('');
  const stillAgentChat = isLikelyAgentChatContext(finalContext, agentContextRef);

  if (!composerReady || stillAgentChat) {
    return {
      success: false,
      error: stillAgentChat
        ? 'Bridge flow stayed in agent chat after clicking target.'
        : 'Message composer not ready after opening target chat.',
      step: stillAgentChat ? 'wait_target_chat' : 'wait_target_composer',
    };
  }

  if (!chatReady) {
    // Some WA variants don't expose the target phone in URL/title immediately.
    // If composer is ready and we're not in the agent chat anymore, proceed.
    return {
      success: true,
      agentPhone: agentDigits,
      targetPhone: targetDigits,
      inferredTargetChat: true,
    };
  }

  return {
    success: true,
    agentPhone: agentDigits,
    targetPhone: targetDigits,
  };
}

async function handleClickSend(message, options = {}) {
  console.log('Attempting to find Send button...');
  const shouldHumanize = options.humanized !== false;
  const shouldPaste = Boolean(options.paste);
  let msgBox = null;

  if (message) {
    msgBox = await waitForMessageComposer(12000);
    if (msgBox) {
      msgBox.focus();
      if (shouldPaste) {
        clearEditable(msgBox);
        document.execCommand('insertText', false, String(message));
        await sleep(shouldHumanize ? (Math.random() * 240 + 180) : 120);
      } else {
        const typeResult = await typeInEditable(msgBox, message, { humanized: shouldHumanize });
        await sleep(shouldHumanize ? (Math.random() * 700 + 300) : 500);
        if (!typeResult || typeResult.success !== true) {
          return { success: false, error: typeResult.error || 'Text insertion failed' };
        }
      }

      const expectedText = normalizeEditableText(message);
      const currentText = normalizeEditableText(msgBox.textContent || '');
      if (expectedText && !currentText.includes(expectedText)) {
        return { success: false, error: 'Message text not present in composer' };
      }
    } else {
      return { success: false, error: 'Message box not found' };
    }
  }

  const sendBtn = await getElement(SELECTORS.sendButton, 9000);

  if (sendBtn && isVisibleElement(sendBtn)) {
    console.log('Send button found. Clicking...');
    await sleep(shouldHumanize ? (Math.random() * 650 + 260) : (Math.random() * 500 + 200));
    const clicked = clickElementCenterLeft(sendBtn);
    if (!clicked) {
      return { success: false, error: 'Failed to click send button' };
    }
    await sleep(2000);
    return { success: true };
  }

  // Fallback: if message is already in composer and the send button did not render yet, press Enter.
  if (message && msgBox) {
    msgBox.focus();
    msgBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      which: 13,
      keyCode: 13,
      bubbles: true,
    }));
    await sleep(1400);
    return { success: true, fallback: 'enter' };
  }

  const invalidModal = document.querySelector(SELECTORS.invalidNumber);
  if (invalidModal) {
    const okBtn = invalidModal.querySelector('div[role="button"]');
    if (okBtn) okBtn.click();
    return { success: false, error: 'Invalid Number' };
  }

  return { success: false, error: 'Send button not found' };
}

async function handlePasteMedia(media) {
  console.log('Attempting to paste media:', media);

  try {
    const response = await fetch(media.fileUrl);
    const blob = await response.blob();

    if (media.mimetype.startsWith('image/')) {
      const item = new ClipboardItem({ [media.mimetype]: blob });
      await navigator.clipboard.write([item]);
      console.log('Image copied to clipboard.');

      const msgBox = await waitForMessageComposer(10000);
      if (msgBox) {
        msgBox.focus();
        document.execCommand('paste');
        await sleep(2000);
        return { success: true };
      }
    } else {
      console.warn('Non-image media paste not fully supported yet in this version.');
      return { success: false, error: 'Only images supported for now' };
    }
  } catch (e) {
    console.error('Paste failed:', e);
    return { success: false, error: e.message };
  }

  return { success: false, error: 'Unknown media error' };
}

async function handleFocusChatTool(tool) {
  const normalizedTool = String(tool || '').trim().toLowerCase();

  const selectorMap = {
    emoji: SELECTORS.emojiButton,
    attach: SELECTORS.attachButton,
    mic: SELECTORS.micButton,
  };

  const selector = selectorMap[normalizedTool];
  if (!selector) {
    return { success: false, error: 'Unsupported chat tool' };
  }

  const target = await getElement(selector, 5000);
  if (!target) {
    return { success: false, error: `Tool button not found: ${normalizedTool}` };
  }

  target.click();
  await sleep(350);
  return { success: true, tool: normalizedTool };
}

initContentGlassUi();

// Serialize DOM automation actions so concurrent background triggers don't interleave typing/clicking.
let waActionChain = Promise.resolve();
function enqueueWhatsAppAction(actionName, actionFn) {
  const run = waActionChain.then(actionFn, actionFn);
  waActionChain = run.catch(() => {});

  return run.catch((error) => ({
    success: false,
    error: error?.message || `${actionName} failed`,
  }));
}

// Receive Messages from Background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    sendResponse({ success: true, ready: true });
    return true;
  }

  if (request.action === 'RUNTIME_STATE_UPDATE') {
    updateRuntimeState(request.runtimeState || {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'GLASS_TOAST') {
    const payload = request.payload || {};
    showGlassToast(payload);
    appendIslandEvent(payload.title || payload.message || 'Notificação');
    updateGlassUi();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'OPEN_CHAT_VIA_AGENT_BRIDGE') {
    enqueueWhatsAppAction('OPEN_CHAT_VIA_AGENT_BRIDGE', () => handleOpenChatViaAgentBridge(
      request.agentPhone,
      request.targetPhone,
      {
        humanized: request.humanized !== false,
        agentSearchTerms: request.agentSearchTerms || [],
        agentQuery: request.agentQuery || '',
      },
    )).then(sendResponse);
    return true;
  }

  if (request.action === 'PASTE_MEDIA') {
    enqueueWhatsAppAction('PASTE_MEDIA', () => handlePasteMedia(request.media)).then(sendResponse);
    return true;
  }

  if (request.action === 'CLICK_SEND') {
    enqueueWhatsAppAction('CLICK_SEND', () => handleClickSend(
      request.message,
      { humanized: request.humanized, paste: request.paste },
    )).then(sendResponse);
    return true;
  }

  if (request.action === 'CAPTURE_INBOUND') {
    const snapshot = extractInboundMessages(request.phone, request.limit || 20);
    sendResponse({ success: true, ...snapshot });
    return true;
  }

  if (request.action === 'GET_ACTIVE_CHAT_CONTEXT') {
    const targetPhone = digitsOnly(request.phone || '');
    const context = extractChatContext('');
    const composer = document.querySelector(SELECTORS.messageBox);
    const composerReady = Boolean(composer && isVisibleElement(composer) && composer.isContentEditable);

    sendResponse({
      success: true,
      phone: digitsOnly(context.phone || ''),
      name: String(context.name || ''),
      phoneSource: context.phoneSource || 'unknown',
      composerReady,
      matchesTarget: targetPhone ? isSamePhoneLoose(context.phone, targetPhone) : false,
    });
    return true;
  }

  if (request.action === 'CAPTURE_CHAT_HISTORY') {
    enqueueWhatsAppAction('CAPTURE_CHAT_HISTORY', async () => {
      try {
        const snapshot = await captureChatHistory(request.phone, {
          limit: request.limit,
          preloadOlder: request.preloadOlder !== false,
          maxScrollIterations: request.maxScrollIterations,
        });
        return { success: true, ...snapshot };
      } catch (error) {
        return {
          success: false,
          error: error?.message || 'Failed to capture chat history.',
        };
      }
    }).then(sendResponse);
    return true;
  }

  if (request.action === 'FOCUS_CHAT_TOOL') {
    enqueueWhatsAppAction('FOCUS_CHAT_TOOL', () => handleFocusChatTool(request.tool)).then(sendResponse);
    return true;
  }
});
