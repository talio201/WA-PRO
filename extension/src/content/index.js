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
  // Removed Glass Styles
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
  // Toast removed
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
  // Island UI Removed
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
  return { success: false, error: 'Disabled' };
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

      // Validar contatos levando em conta nono dígito (Brasil)
      // Extrai os últimos 8-9 dígitos
      const itemTail = itemDigits.slice(-8);
      const searchTail = termTail.slice(-8);

      const matchesText = searchTail && itemTail && itemTail === searchTail;
      const matchesAria = searchTail && ariaDigits && ariaDigits.slice(-8) === searchTail;
      // Fallback: match por nome (quando term não é número) ou termo solto
      const matchesName = !termDigits && itemText.toLowerCase().includes(term.toLowerCase());

      if (matchesText || matchesAria || matchesName || (termDigits && itemText.includes(term))) {
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
    console.warn('[handleOpenChat] No matching contact found in list. Aborting to avoid wrong chat.');
    return { success: false, error: 'Contact not found in search results.' };
  }

  await sleep(400);

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
  return false;
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
  return { success: false, error: 'Disabled' };
}

async function handleClickSend(message, options = {}) {
  return { success: false, error: 'Disabled' };
}

async function handlePasteMedia(media) {
  return { success: false, error: 'Disabled' };
}

async function handleFocusChatTool(tool) {
  return { success: false, error: 'Disabled' };
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
