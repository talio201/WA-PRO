const extractBtn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');
const output = document.getElementById('output');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = ok === undefined ? '' : ok ? 'ok' : 'err';
}

extractBtn.addEventListener('click', async () => {
  setStatus('Enviando comando...', undefined);
  output.value = '';
  copyBtn.disabled = true;
  downloadBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('Aba ativa não encontrada');
    if (!/^https:\/\/web\.whatsapp\.com/.test(tab.url || '')) {
      throw new Error('Abra web.whatsapp.com e tente novamente');
    }

    // Limpa resultado anterior
    await chrome.storage.local.remove('lastResult');

    await chrome.tabs.sendMessage(tab.id, { type: 'wa-export-start' });
    setStatus('Extraindo... (aguarde)', undefined);
  } catch (e) {
    setStatus(e.message || 'Falha ao iniciar', false);
  }
});

// Atualiza UI com dados
function updateUI(data) {
  if (!data) return;
  if (!data.ok) {
    setStatus(data.error || 'Erro na extração', false);
    return;
  }
  setStatus(`Extração ok: ${data.count} contatos`, true);
  output.value = data.text || '';
  copyBtn.disabled = !data.text;
  downloadBtn.disabled = !data.contacts;
}

// 1. Ao abrir, verifica se já tem resultado salvo
chrome.storage.local.get(['lastResult'], (result) => {
  if (result.lastResult) {
    updateUI(result.lastResult);
  }
});

// 2. Ouve mudanças no storage (caso a extração termine com popup aberto)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastResult?.newValue) {
    updateUI(changes.lastResult.newValue);
  }
});

// 3. Mantém listener de mensagem por compatibilidade/debug
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'wa-export-result') {
    updateUI(msg.payload);
  }
});

copyBtn.addEventListener('click', async () => {
  if (!output.value) return;
  await navigator.clipboard.writeText(output.value);
  setStatus('Copiado!', true);
});

downloadBtn.addEventListener('click', () => {
  try {
    const blob = new Blob([output.value || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: 'contatos_whatsapp_br.txt'
    });
    setStatus('Download iniciado', true);
  } catch (e) {
    setStatus('Falha ao baixar', false);
  }
});
