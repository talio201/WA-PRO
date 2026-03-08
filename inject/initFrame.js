
(function () {
    console.log('[initFrame] Injected - Waiting for DOM...');

    // Função para aguardar o composer do WhatsApp
    window.waitForComposer = function (timeout = 15000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                observer.disconnect();
                reject('Composer não apareceu');
            }, timeout);

            const observer = new MutationObserver(() => {
                const box = document.querySelector('[contenteditable="true"][data-tab="10"]');
                if (box && box.offsetParent !== null) {
                    clearTimeout(timer);
                    observer.disconnect();
                    resolve(box);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    };

    // Função para detectar número inválido
    window.numberInvalid = function () {
        return document.body.innerText.includes('não está no WhatsApp') ||
               document.body.innerText.includes('Phone number shared via url is invalid');
    };

    // Função robusta para abrir conversa e enviar mensagem
    window.sendToNumber = async function (phone, message) {
        const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
        location.href = url;

        try {
            const box = await window.waitForComposer();
            box.focus();
            document.execCommand('insertText', false, message);
            await new Promise(r => setTimeout(r, 300));
            const sendBtn = document.querySelector('[data-icon="send"]');
            if (sendBtn) sendBtn.click();
            return true;
        } catch (e) {
            if (window.numberInvalid()) {
                console.warn('Número inválido no WhatsApp:', phone);
                return false;
            }
            throw e;
        }
    };

    function createExportButton() {
        if (document.getElementById('wa-export-btn')) return; // Already exists

        const btn = document.createElement('button');
        btn.innerText = 'Export Contacts';
        btn.style.position = 'fixed';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '2147483647'; // Max Z-Index
        btn.style.padding = '12px 24px';
        btn.style.backgroundColor = '#25D366';
        btn.style.color = 'white';
        btn.style.border = '2px solid white';
        btn.style.borderRadius = '25px';
        btn.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = 'bold';
        btn.style.fontSize = '14px';
        btn.style.pointerEvents = 'auto'; // Ensure clickable
        btn.id = 'wa-export-btn';

        btn.onclick = function () {
            console.log('[initFrame] Export button clicked');
            window.postMessage({ type: 'export:trigger' }, '*');
            btn.innerText = 'Injecting...';
            btn.style.backgroundColor = '#128C7E';
        };

        // Try appending to different roots
        (document.body || document.documentElement).appendChild(btn);
        console.log('[initFrame] Button appended');
    }

    // Aggressive check to ensure button remains visible
    setInterval(createExportButton, 2000);
    setTimeout(createExportButton, 1000);
    setTimeout(createExportButton, 5000);
})();
