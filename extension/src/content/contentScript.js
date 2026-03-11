const CS_READY_FLAG = "__wa_campaign_cs_ready__";
window[CS_READY_FLAG] = true;

function getComposerBox() {
  return (
    document.querySelector('[data-testid="conversation-compose-box-input"]') ||
    document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
    document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
    document.querySelector('footer div[contenteditable="true"]')
  );
}

function getSendButton() {
  return (
    document.querySelector('[data-testid="send"]') ||
    document.querySelector('button[aria-label="Enviar"]') ||
    document.querySelector('button[aria-label="Send"]') ||
    document.querySelector('span[data-icon="send"]')?.closest("button")
  );
}

function getFileInput() {
  return (
    document.querySelector('input[type="file"][accept*="image"]') ||
    document.querySelector('input[type="file"]')
  );
}

function getAttachButton() {
  return (
    document.querySelector('[data-testid="attach-menu-plus"]') ||
    document.querySelector('button[aria-label="Anexar"]') ||
    document.querySelector('button[aria-label="Attach"]') ||
    document.querySelector('span[data-icon="plus"]')?.closest("button") ||
    document.querySelector('span[data-icon="attach-menu-plus"]')?.closest("button")
  );
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitFor(fn, timeoutMs = 8000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function setNativeValue(element, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeInComposer(composer, text, humanized = true) {
  composer.focus();
  await sleep(120);
  const chars = [...text];
  for (const char of chars) {
    const keydown = new KeyboardEvent("keydown", { bubbles: true, key: char });
    const keypress = new KeyboardEvent("keypress", { bubbles: true, key: char });
    const input = new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: char,
    });
    const keyup = new KeyboardEvent("keyup", { bubbles: true, key: char });
    composer.dispatchEvent(keydown);
    composer.dispatchEvent(keypress);
    document.execCommand("insertText", false, char);
    composer.dispatchEvent(input);
    composer.dispatchEvent(keyup);
    if (humanized) {
      await sleep(randomBetween(18, 55));
    }
  }
  await sleep(humanized ? randomBetween(200, 500) : 120);
}

async function pressEnterToSend(composer) {
  const enterDown = new KeyboardEvent("keydown", {
    bubbles: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
  });
  const enterUp = new KeyboardEvent("keyup", {
    bubbles: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
  });
  composer.dispatchEvent(enterDown);
  composer.dispatchEvent(enterUp);
  await sleep(300);
}

async function clickSendButton() {
  const btn = await waitFor(getSendButton, 4000);
  if (btn) {
    btn.click();
    await sleep(400);
    return true;
  }
  return false;
}

async function fetchFileAsBlob(fileUrl, mimetype) {
  const response = await fetch(fileUrl, { mode: "cors" });
  if (!response.ok) throw new Error(`Falha ao baixar arquivo: ${response.status}`);
  const blob = await response.blob();
  return new Blob([blob], { type: mimetype || blob.type || "application/octet-stream" });
}

async function sendMediaViaClipboard(blob, caption) {
  const item = new ClipboardItem({ [blob.type]: blob });
  await navigator.clipboard.write([item]);
  const composer = await waitFor(getComposerBox, 6000);
  if (!composer) throw new Error("Composer nao encontrado para colar midia.");
  composer.focus();
  await sleep(200);
  document.execCommand("paste");
  await sleep(1200);
  if (caption) {
    const captionBox = await waitFor(
      () =>
        document.querySelector('[data-testid="media-caption-input-container"] div[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"][data-testid="caption-compose-box"]'),
      5000
    );
    if (captionBox) {
      captionBox.focus();
      await sleep(150);
      document.execCommand("insertText", false, caption);
      await sleep(300);
    }
  }
  const sent = await clickSendButton();
  return sent;
}

async function sendMediaViaFileInput(blob, fileName, caption) {
  const attachBtn = await waitFor(getAttachButton, 5000);
  if (attachBtn) {
    attachBtn.click();
    await sleep(600);
  }

  const fileInput = await waitFor(getFileInput, 5000);
  if (!fileInput) throw new Error("Input de arquivo nao encontrado no WhatsApp Web.");

  const file = new File([blob], fileName || "media", { type: blob.type });
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(fileInput, "files", { value: dt.files, configurable: true });
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(1500);

  if (caption) {
    const captionBox = await waitFor(
      () =>
        document.querySelector('[data-testid="media-caption-input-container"] div[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"][data-testid="caption-compose-box"]'),
      6000
    );
    if (captionBox) {
      captionBox.focus();
      await sleep(150);
      document.execCommand("insertText", false, caption);
      await sleep(300);
    }
  }

  const sent = await clickSendButton();
  return sent;
}

async function handleSendTextMessage(request) {
  const composer = await waitFor(getComposerBox, 8000);
  if (!composer) {
    return { success: false, error: "Composer nao encontrado." };
  }
  await typeInComposer(composer, request.text, Boolean(request.humanized));
  const sent = await clickSendButton();
  if (!sent) {
    await pressEnterToSend(composer);
  }
  return { success: true };
}

async function handleSendMediaMessage(request) {
  try {
    const blob = await fetchFileAsBlob(request.fileUrl, request.mimetype);
    const fileName = request.fileName || "media";
    const caption = request.caption || "";
    const isImage = String(request.mimetype || "").startsWith("image/");

    let sent = false;

    if (isImage) {
      try {
        sent = await sendMediaViaClipboard(blob, caption);
      } catch (_) {
        sent = false;
      }
    }

    if (!sent) {
      sent = await sendMediaViaFileInput(blob, fileName, caption);
    }

    if (!sent) {
      return { success: false, error: "Nao foi possivel enviar a midia." };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || "Erro ao enviar midia." };
  }
}

async function handleOpenChatViaAgentBridge(request) {
  try {
    const targetPhone = String(request.targetPhone || "").replace(/\D/g, "");
    if (!targetPhone) return { success: false, error: "targetPhone invalido." };

    const searchTerms = Array.isArray(request.agentSearchTerms)
      ? request.agentSearchTerms
      : [];

    const searchBox = await waitFor(
      () =>
        document.querySelector('[data-testid="chat-list-search"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="3"]'),
      6000
    );

    if (!searchBox) return { success: false, error: "Caixa de busca nao encontrada." };

    for (const term of searchTerms) {
      searchBox.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(200);
      document.execCommand("insertText", false, term);
      await sleep(1200);

      const result = document.querySelector('[data-testid="cell-frame-container"]');
      if (result) {
        result.click();
        await sleep(800);

        const sendToBox = await waitFor(
          () =>
            document.querySelector('[data-testid="conversation-compose-box-input"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="10"]'),
          3000
        );

        if (sendToBox) {
          const sendToField = await waitFor(
            () => document.querySelector('input[data-testid="contact-search-input"]') ||
              document.querySelector('span[data-testid="new-chat-btn"]'),
            2000
          );
          if (sendToField || true) {
            const url = `https://web.whatsapp.com/send?phone=${targetPhone}`;
            window.location.href = url;
            await sleep(3000);
            return { success: true };
          }
        }
      }
    }

    window.location.href = `https://web.whatsapp.com/send?phone=${targetPhone}`;
    await sleep(3000);

    const composer = await waitFor(getComposerBox, 8000);
    if (!composer) return { success: false, error: "Chat nao carregou apos navegacao direta." };

    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || "Erro no bridge." };
  }
}

async function handleGetActiveChatContext(request) {
  const targetPhone = String(request.phone || "").replace(/\D/g, "");
  const composer = getComposerBox();
  const composerReady = Boolean(composer);

  const headerEl =
    document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
    document.querySelector("header h3") ||
    document.querySelector('[data-testid="default-user"]');

  const activePhone = "";
  const matchesTarget = false;

  return {
    success: true,
    composerReady,
    phone: activePhone,
    matchesTarget,
  };
}

async function handleCaptureInbound(request) {
  const expectedPhone = String(request.phone || "").replace(/\D/g, "");
  const limit = Number(request.limit) || 30;
  const messages = [];

  const msgEls = document.querySelectorAll(
    '[data-testid="msg-container"], [class*="message-in"]'
  );

  msgEls.forEach((el) => {
    const textEl = el.querySelector('[data-testid="msg-text"], span.selectable-text');
    const text = textEl ? textEl.innerText?.trim() : "";
    if (!text) return;
    const timeEl = el.querySelector('[data-testid="msg-meta"] span, [class*="time"]');
    messages.push({
      text,
      at: timeEl ? timeEl.title || timeEl.innerText : new Date().toISOString(),
      fingerprint: `${expectedPhone}|${text}`,
    });
  });

  return {
    success: true,
    phone: expectedPhone,
    messages: messages.slice(-limit),
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request?.action) return false;

  if (request.action === "PING") {
    sendResponse({ success: true, ready: true });
    return false;
  }

  if (request.action === "SEND_TEXT_MESSAGE") {
    handleSendTextMessage(request)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  if (request.action === "SEND_MEDIA_MESSAGE") {
    handleSendMediaMessage(request)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  if (request.action === "OPEN_CHAT_VIA_AGENT_BRIDGE") {
    handleOpenChatViaAgentBridge(request)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  if (request.action === "GET_ACTIVE_CHAT_CONTEXT") {
    handleGetActiveChatContext(request)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  if (request.action === "CAPTURE_INBOUND") {
    handleCaptureInbound(request)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  if (request.action === "FOCUS_CHAT_TOOL") {
    const tool = String(request.tool || "").toLowerCase();
    const btn = getAttachButton();
    if (tool === "attach" && btn) {
      btn.click();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: `Ferramenta nao suportada: ${tool}` });
    }
    return false;
  }

  if (request.action === "RUNTIME_STATE_UPDATE" || request.action === "GLASS_TOAST") {
    return false;
  }

  return false;
});
