import { ApiClient } from './api-client.js';

// ==================== GLOBAL STATE ====================
let globalContacts = [];
let selectedContacts = new Set(); // Set of contact IDs
let currentSort = { field: null, dir: 'asc' };
let currentFilter = 'all'; // 'all', 'whatsapp', 'leads'
let currentRenderTask = null;
let campaignEngine = null;
let mediaFiles = []; // [{name, type, base64, caption}]
let campaignStartTime = null;
let statsRetryTimer = null;

// Inbox state
let inboxConversations = [];
let inboxActiveContactId = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', function () {
    // 0. Security Check
    checkSession();

    initNavigation();
    initSearch();
    initFilters();
    initSelection();
    initSorting();
    initMediaUpload();
    initCampaignUI();
    initSpintaxUI();
    initDelayBarsUI();
    initPreview();
    initTheme();
    initMagicRewrite(); // Init AI
    initAddNumberModal();
    initImportExcelModal();
    initInboxUI();
    initDiagnosticsUI();
    checkWAConnection();

    // Validação e log de carregamento de contatos do Supabase
    (async () => {
        try {
            const api = new ApiClient();
            const contatos = await api.fetchContacts();
            if (!Array.isArray(contatos) || contatos.length === 0) {
                Toast.error('Nenhum contato carregado do Supabase! Verifique a sincronização.');
                console.error('[DASHBOARD] Nenhum contato carregado do Supabase.');
            } else {
                Toast.success(`Contatos carregados do Supabase: ${contatos.length}`);
                console.log(`[DASHBOARD] Contatos carregados do Supabase: ${contatos.length}`);
            }
        } catch (e) {
            Toast.error('Erro ao carregar contatos do Supabase!');
            console.error('[DASHBOARD] Erro ao carregar contatos do Supabase:', e);
        }
    })();

    // Init campaign engine
    campaignEngine = new CampaignEngine();
    campaignEngine.onProgress = updateCampaignProgress;
    campaignEngine.onLog = addLogEntry;
    campaignEngine.onComplete = onCampaignComplete;
    campaignEngine.onStatusChange = onCampaignStatusChange;
    campaignEngine.onDelayTick = updateCountdown;
    campaignEngine.onHumanScore = updateHumanScore;
});

function initDiagnosticsUI() {
    const out = document.getElementById('diag-output');
    const inpChatId = document.getElementById('diag-chat-id');
    const inpName = document.getElementById('diag-contact-name');
    const inpMsg = document.getElementById('diag-message');
    const chkAllow = document.getElementById('diag-allow-mismatch');
    const btnOpen = document.getElementById('btn-diag-open');
    const btnDump = document.getElementById('btn-diag-dump');
    const btnSend = document.getElementById('btn-diag-send');

    if (!out || !inpChatId || !btnOpen || !btnDump || !btnSend) return;

    const digits = (v) => String(v || '').replace(/\D/g, '');
    const setOut = (obj) => {
        try {
            out.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
        } catch (e) {
            out.textContent = String(obj);
        }
    };

    btnOpen.addEventListener('click', () => {
        const chatId = digits(inpChatId.value);
        if (chatId.length < 8) {
            Toast.error('Número inválido.');
            return;
        }
        setOut('Abrindo chat...');
        chrome.runtime.sendMessage({
            type: 'OPEN_CHAT',
            data: { chatId, contactName: String(inpName.value || ''), allowMismatch: Boolean(chkAllow && chkAllow.checked) }
        }, (resp) => {
            if (resp && resp.error) {
                Toast.error('Falha ao abrir: ' + resp.error);
                setOut(resp);
                return;
            }
            Toast.success('Comando enviado. Veja o WhatsApp Web.');
            setOut(resp || { success: true });
        });
    });

    btnDump.addEventListener('click', () => {
        const chatId = digits(inpChatId.value);
        if (chatId.length < 8) {
            Toast.error('Número inválido.');
            return;
        }
        setOut('Rodando diagnóstico (openChat + dump)...');
        chrome.runtime.sendMessage({
            type: 'DIAG_OPEN_CHAT',
            data: { chatId, contactName: String(inpName.value || ''), allowMismatch: Boolean(chkAllow && chkAllow.checked) }
        }, (resp) => {
            if (resp && resp.error) {
                Toast.error('Diag falhou: ' + resp.error);
                setOut(resp);
                return;
            }
            Toast.success('Diag concluído.');
            setOut(resp);
        });
    });

    btnSend.addEventListener('click', () => {
        const chatId = digits(inpChatId.value);
        const text = String(inpMsg.value || '');
        if (chatId.length < 8) {
            Toast.error('Número inválido.');
            return;
        }
        if (!text.trim()) {
            Toast.warning('Digite uma mensagem de teste.');
            return;
        }
        const ok = confirm('Isso vai ENVIAR uma mensagem real no WhatsApp Web. Continuar?');
        if (!ok) return;

        setOut('Enviando mensagem real...');
        chrome.runtime.sendMessage({
            type: 'SEND_MESSAGE',
            data: { chatId, text, contactName: String(inpName.value || ''), allowMismatch: Boolean(chkAllow && chkAllow.checked) }
        }, (resp) => {
            if (resp && resp.error) {
                Toast.error('Falha ao enviar: ' + (resp.detail || resp.error));
                setOut(resp);
                return;
            }
            Toast.success('Mensagem enviada.');
            setOut(resp || { success: true });
        });
    });
}

// ==================== NAVIGATION ====================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('page-title');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetViewId = item.getAttribute('data-view');
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            views.forEach(view => { view.classList.remove('active'); view.style.display = 'none'; });
            const targetView = document.getElementById(`view-${targetViewId}`);
            if (targetView) { targetView.classList.add('active'); targetView.style.display = 'block'; }
            // Update title
            const label = item.querySelector('.label').textContent;
            if (pageTitle) pageTitle.textContent = label;

            if (targetViewId === 'inbox') {
                loadInbox();
            }
        });
    });

    // Refresh Contacts
    const btnRefresh = document.getElementById('btn-refresh-contacts');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            const statusText = document.querySelector('.status-text');
            if (statusText) statusText.textContent = "Atualizando...";

            // If on Leads tab, refresh leads specifically
            if (currentFilter === 'leads') {
                renderSkeleton();
                new ApiClient().fetchLeads().then(leads => {
                    console.log(`[Dashboard] Leads refreshed: ${leads.length}`);
                    renderFilteredContacts(leads);
                    if (statusText) statusText.textContent = "Leads Atualizados";
                    setTimeout(() => statusText.textContent = "Conectado", 2000);
                });
                return;
            }

            // Otherwise, refresh WA contacts
            chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, function (tabs) {
                if (tabs && tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: "FROM_EXTENSION", command: "getContacts", force: true });
                }
            });
        });
    }

    // New Campaign Button -> Go to campaigns tab
    const btnNewCampaign = document.getElementById('btn-new-campaign');
    if (btnNewCampaign) {
        btnNewCampaign.addEventListener('click', () => {
            const campaignNav = document.querySelector('.nav-item[data-view="campaigns"]');
            if (campaignNav) campaignNav.click();
        });
    }

    // Open in new tab (expand)
    const openTabBtn = document.getElementById('btn-open-tab');
    if (openTabBtn) {
        // Hide if already in a tab (not popup) - simple check
        if (window.innerWidth > 800) {
            // openTabBtn.style.display = 'none'; 
        }
        openTabBtn.addEventListener('click', () => chrome.tabs.create({ url: 'dashboard.html' }));
    }

    // Logout / Clear Data
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            if (confirm('Tem certeza? Isso apagará o cache local e desconectará o painel.\n\nSeus dados no servidor continuarão seguros.')) {
                // 1. Tell Background to wipe WAPI cache (on the WA tab)
                chrome.runtime.sendMessage({ type: 'LOGOUT_REQUEST' });

                // 2. Clear Extension Storage
                chrome.storage.local.clear(() => {
                    console.log('[Dashboard] Local storage cleared.');
                    // 3. Reload Page
                    window.location.reload();
                });
            }
        });
    }

    // Logo fallback
    const logoImg = document.getElementById('logo-img');
    if (logoImg) logoImg.addEventListener('error', function () { this.style.display = 'none'; });

    // Go Select Contacts (from Composer)
    const btnGoSelect = document.getElementById('btn-go-select-contacts');
    if (btnGoSelect) {
        btnGoSelect.addEventListener('click', () => {
            const contactsNav = document.querySelector('.nav-item[data-view="contacts"]');
            if (contactsNav) contactsNav.click();
        });
    }
}

// ==================== INBOX (ATENDIMENTO) ====================
function initInboxUI() {
    const btnRefresh = document.getElementById('btn-refresh-inbox');
    if (btnRefresh) btnRefresh.addEventListener('click', () => loadInbox(true));

    const search = document.getElementById('inbox-search');
    if (search) {
        search.addEventListener('input', () => renderInboxList());
    }

    const btnSend = document.getElementById('btn-inbox-send');
    if (btnSend) btnSend.addEventListener('click', sendInboxMessage);

    const composer = document.getElementById('inbox-compose-text');
    if (composer) {
        composer.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendInboxMessage();
            }
        });
    }

    const btnOpenWA = document.getElementById('btn-open-chat-wa');
    if (btnOpenWA) {
        btnOpenWA.addEventListener('click', () => {
            if (!inboxActiveContactId) return;
            chrome.runtime.sendMessage({ type: 'OPEN_CHAT', data: { chatId: inboxActiveContactId, contactName: '' } }, () => { });
        });
    }

    initPendingReviewsUI();
}

function initPendingReviewsUI() {
    const btnOpen = document.getElementById('btn-open-pending-reviews');
    const modal = document.getElementById('modal-pending-reviews');
    const btnCloseX = document.getElementById('modal-close-pending');
    const btnClose = document.getElementById('btn-close-pending');

    const close = () => { if (modal) modal.style.display = 'none'; };
    const open = () => {
        if (!modal) return;
        modal.style.display = 'flex';
        renderPendingReviews();
    };

    if (btnOpen) btnOpen.addEventListener('click', open);
    if (btnCloseX) btnCloseX.addEventListener('click', close);
    if (btnClose) btnClose.addEventListener('click', close);
    if (modal) modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    // Initial load
    updatePendingReviewsCount();

    // Listen for updates from background
    try {
        chrome.runtime.onMessage.addListener((msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'PENDING_REVIEW_ADDED' || msg.type === 'PENDING_REVIEW_REMOVED') {
                updatePendingReviewsCount(msg.count);
                if (modal && modal.style.display === 'flex') renderPendingReviews();
            }
        });
    } catch (e) { }
}

function updatePendingReviewsCount(explicitCount = null) {
    const badge = document.getElementById('pending-reviews-count');
    if (!badge) return;

    if (typeof explicitCount === 'number') {
        badge.textContent = String(explicitCount);
        return;
    }

    chrome.storage.local.get(['pending_reviews'], (r) => {
        const list = Array.isArray(r.pending_reviews) ? r.pending_reviews : [];
        badge.textContent = String(list.length);
    });
}

function renderPendingReviews() {
    const listEl = document.getElementById('pending-reviews-list');
    if (!listEl) return;

    chrome.storage.local.get(['pending_reviews'], (r) => {
        const list = Array.isArray(r.pending_reviews) ? r.pending_reviews : [];
        if (list.length === 0) {
            listEl.innerHTML = `<div class="empty-state" style="border:none;">Sem pendências.</div>`;
            return;
        }

        listEl.innerHTML = '';
        list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'card';
            row.style.padding = '12px';
            row.style.borderRadius = '14px';

            const number = (item.chatId || '').includes('@') ? String(item.chatId).split('@')[0] : (item.expectedDigits || '');
            const preview = (item.text || '').slice(0, 140);

            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                    <div style="min-width:0;">
                        <div style="font-weight:800; color: var(--text-main); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${item.contactName || 'Contato'} <span style="color:var(--text-muted); font-weight:700;">+${number}</span>
                        </div>
                        <div style="margin-top:4px; font-size:12px; color:var(--text-muted); white-space:pre-wrap;">
                            ${preview || '(mensagem vazia)'}
                        </div>
                        <div style="margin-top:6px; font-size:11px; color: var(--text-secondary);">
                            Motivo: ${item.error || 'CHAT_MISMATCH'}
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; flex:0 0 auto; width: 220px;">
                        <button class="btn btn-sm btn-secondary btn-review-open">Conferir no WhatsApp</button>
                        <label style="display:flex; gap:8px; align-items:center; font-size:12px; color:var(--text-muted);">
                            <input type="checkbox" class="chk-review-confirm" />
                            Confirmo que é o contato correto
                        </label>
                        <button class="btn btn-sm btn-primary btn-review-send" disabled>Confirmar e Enviar</button>
                    </div>
                </div>
            `;

            const btnOpen = row.querySelector('.btn-review-open');
            const chk = row.querySelector('.chk-review-confirm');
            const btnSend = row.querySelector('.btn-review-send');

            if (btnOpen) {
                btnOpen.addEventListener('click', () => {
                    chrome.runtime.sendMessage({
                        type: 'OPEN_CHAT',
                        data: { chatId: item.chatId, contactName: item.contactName || '', allowMismatch: true }
                    }, (resp) => {
                        if (resp && resp.error) Toast.error('Falha ao abrir: ' + resp.error);
                        else Toast.info('Verifique o chat no WhatsApp Web e confirme aqui.');
                    });
                });
            }

            if (chk && btnSend) {
                chk.addEventListener('change', () => {
                    btnSend.disabled = !chk.checked;
                });
            }

            if (btnSend) {
                btnSend.addEventListener('click', () => {
                    if (!chk || !chk.checked) return;
                    btnSend.disabled = true;
                    btnSend.textContent = 'Enviando...';

                    chrome.runtime.sendMessage({
                        type: 'SEND_MESSAGE',
                        data: {
                            chatId: item.chatId,
                            text: item.text,
                            contactName: item.contactName || '',
                            allowMismatch: true,
                            reviewId: item.id
                        }
                    }, (resp) => {
                        btnSend.textContent = 'Confirmar e Enviar';
                        btnSend.disabled = false;
                        if (resp && resp.error) {
                            Toast.error('Falha ao enviar: ' + (resp.detail || resp.error));
                            return;
                        }
                        Toast.success('Mensagem enviada.');
                        updatePendingReviewsCount();
                        renderPendingReviews();
                    });
                });
            }

            listEl.appendChild(row);
        });
    });
}

async function loadInbox(force = false) {
    const listEl = document.getElementById('inbox-list');
    if (!listEl) return;
    if (force) {
        listEl.innerHTML = '<div class="empty-state" style="border:none;">Atualizando...</div>';
    }

    const api = new ApiClient();
    inboxConversations = await api.fetchConversations(250);
    renderInboxList();

    // If we had an active conversation, try re-selecting it
    if (inboxActiveContactId) {
        const exists = inboxConversations.find(c => c.contact_id === inboxActiveContactId);
        if (exists) selectInboxConversation(inboxActiveContactId);
    }
}

function renderInboxList() {
    const listEl = document.getElementById('inbox-list');
    if (!listEl) return;

    const q = (document.getElementById('inbox-search')?.value || '').toLowerCase().trim();
    const filtered = (inboxConversations || []).filter(c => {
        if (!q) return true;
        const name = (c.contact_name || '').toLowerCase();
        const num = String(c.number || c.contact_id || '').toLowerCase();
        return name.includes(q) || num.includes(q);
    });

    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="border:none;">Nenhuma conversa encontrada.</div>';
        return;
    }

    const fmtTime = (iso) => {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    };

    listEl.innerHTML = '';
    filtered.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'inbox-item' + (conv.contact_id === inboxActiveContactId ? ' active' : '');
        item.addEventListener('click', () => selectInboxConversation(conv.contact_id));

        const avatar = document.createElement('div');
        avatar.className = 'inbox-item-avatar';
        if (conv.avatar) {
            const img = document.createElement('img');
            img.src = conv.avatar;
            img.alt = '';
            avatar.textContent = '';
            avatar.appendChild(img);
        } else {
            const letter = (conv.contact_name || conv.number || '?').trim().slice(0, 1).toUpperCase();
            avatar.textContent = letter || '👤';
        }

        const main = document.createElement('div');
        main.className = 'inbox-item-main';

        const top = document.createElement('div');
        top.className = 'inbox-item-top';

        const name = document.createElement('div');
        name.className = 'inbox-item-name';
        name.textContent = conv.contact_name || conv.number || conv.contact_id;

        const time = document.createElement('div');
        time.className = 'inbox-item-time';
        time.textContent = fmtTime(conv.last_at);

        const last = document.createElement('div');
        last.className = 'inbox-item-last';
        const prefix = conv.direction === 'outbound' ? 'Você: ' : '';
        last.textContent = prefix + (conv.last_text || (conv.has_media ? '[Mídia]' : ''));

        top.appendChild(name);
        top.appendChild(time);
        main.appendChild(top);
        main.appendChild(last);

        item.appendChild(avatar);
        item.appendChild(main);
        listEl.appendChild(item);
    });
}

async function selectInboxConversation(contactId) {
    inboxActiveContactId = contactId;
    renderInboxList();

    const conv = (inboxConversations || []).find(c => c.contact_id === contactId);
    const nameEl = document.getElementById('inbox-peer-name');
    const subEl = document.getElementById('inbox-peer-sub');
    const avEl = document.getElementById('inbox-peer-avatar');
    const btnOpen = document.getElementById('btn-open-chat-wa');
    const composer = document.getElementById('inbox-compose-text');
    const btnSend = document.getElementById('btn-inbox-send');

    if (nameEl) nameEl.textContent = conv?.contact_name || conv?.number || contactId;
    if (subEl) subEl.textContent = conv?.number ? `+${conv.number}` : contactId;
    if (btnOpen) btnOpen.disabled = false;
    if (composer) composer.disabled = false;
    if (btnSend) btnSend.disabled = false;

    if (avEl) {
        avEl.innerHTML = '';
        if (conv?.avatar) {
            const img = document.createElement('img');
            img.src = conv.avatar;
            img.alt = '';
            avEl.appendChild(img);
        } else {
            avEl.textContent = (conv?.contact_name || conv?.number || '?').trim().slice(0, 1).toUpperCase();
        }
    }

    const msgEl = document.getElementById('inbox-messages');
    if (msgEl) msgEl.innerHTML = '<div class="empty-state" style="border:none;">Carregando mensagens...</div>';

    const api = new ApiClient();
    const msgs = await api.fetchConversationMessages(contactId, 300);
    renderInboxMessages(msgs);
}

function renderInboxMessages(messages) {
    const msgEl = document.getElementById('inbox-messages');
    if (!msgEl) return;

    if (!messages || messages.length === 0) {
        msgEl.innerHTML = '<div class="empty-state" style="border:none;">Sem mensagens registradas ainda.</div>';
        return;
    }

    const fmt = (iso) => {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    };

    msgEl.innerHTML = '';
    messages.forEach(m => {
        const row = document.createElement('div');
        const direction = m.direction || 'outbound';
        row.className = 'msg-row ' + (direction === 'outbound' ? 'outbound' : 'inbound');

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';

        const text = document.createElement('div');
        text.className = 'msg-text';
        text.textContent = m.message_text || (m.has_media ? '[Mídia]' : '');

        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        meta.textContent = fmt(m.sent_at);

        bubble.appendChild(text);
        bubble.appendChild(meta);
        row.appendChild(bubble);
        msgEl.appendChild(row);
    });

    msgEl.scrollTop = msgEl.scrollHeight;

    // Backfill on scroll to top (365 days), in small steps to avoid bot-like behavior.
    if (!msgEl._backfillBound) {
        msgEl._backfillBound = true;
        let backfillBusy = false;
        msgEl.addEventListener('scroll', () => {
            if (backfillBusy) return;
            if (!inboxActiveContactId) return;
            if (msgEl.scrollTop > 40) return;
            backfillBusy = true;

            chrome.runtime.sendMessage({
                type: 'SYNC_CHAT_HISTORY',
                data: {
                    chatId: inboxActiveContactId,
                    contactName: document.getElementById('inbox-peer-name')?.textContent || '',
                    sinceDays: 365,
                    maxSteps: 4
                }
            }, async (resp) => {
                // Refresh messages from server regardless of sync result.
                try {
                    await selectInboxConversation(inboxActiveContactId);
                } catch (e) { }
                setTimeout(() => { backfillBusy = false; }, 800);
            });
        });
    }
}

async function sendInboxMessage() {
    const contactId = inboxActiveContactId;
    if (!contactId) return;
    const textarea = document.getElementById('inbox-compose-text');
    const btnSend = document.getElementById('btn-inbox-send');
    const text = (textarea?.value || '').trim();
    if (!text) return;

    if (btnSend) btnSend.disabled = true;

    // Normalize chat id (avoid plain digits breaking openChat/send in some WA builds).
    const normalizedChatId = String(contactId).includes('@') ? String(contactId) : `${String(contactId).replace(/\D/g, '')}@c.us`;

    // Dispatch via WhatsApp Web real (DOM automation).
    chrome.runtime.sendMessage({
        type: 'SEND_MESSAGE',
        data: { chatId: normalizedChatId, text, contactName: '' }
    }, async (resp) => {
        if (btnSend) btnSend.disabled = false;
        if (resp && resp.error) {
            Toast.error('Falha ao enviar: ' + resp.error);
            return;
        }

        // Persist log to Supabase for CRM history.
        try {
            await new ApiClient().logMessage({
                contactId,
                contactName: document.getElementById('inbox-peer-name')?.textContent || '',
                messageText: text,
                hasMedia: false,
                status: 'sent',
                direction: 'outbound',
                messageType: 'text'
            });
        } catch (e) { }

        if (textarea) textarea.value = '';
        await selectInboxConversation(contactId);
    });
}

function checkSession() {
    chrome.storage.local.get(['supa_session', 'ext_authenticated'], (result) => {
        const hasSession = Boolean(result.ext_authenticated && result.supa_session && result.supa_session.access_token);
        if (!hasSession) {
            console.warn('[Dashboard] No session found. Redirecting to login...');
            window.location.href = 'login.html';
        }
    });
}

// ==================== CONNECTION ====================
function checkWAConnection() {
    const statusText = document.querySelector('.status-text');
    const statusDot = document.querySelector('.status-dot');
    if (statusText) statusText.textContent = "Conectando...";

    renderSkeleton(); // Show skeleton while loading

    // Load cached data first
    chrome.storage.local.get(['wa_contacts', 'reply_count'], function (result) {
        if (result.wa_contacts && Array.isArray(result.wa_contacts) && result.wa_contacts.length > 0) {
            globalContacts = result.wa_contacts;
            renderFilteredContacts();
            updateKPIs();
            if (statusText) statusText.textContent = "Cache Carregado";
            if (statusDot) {
                statusDot.classList.add('connected');
                statusDot.style.backgroundColor = '#22c55e';
            }
        }

        // ALWAYS initiate sync eventually to get latest cloud data
        chrome.runtime.sendMessage({ type: 'SYNC_CONTACTS' });

        // Load replies count
        const replies = result.reply_count || 0;
        const kpiReplies = document.getElementById('kpi-replies');
        if (kpiReplies) kpiReplies.textContent = replies;
    });

    // Ping WhatsApp Tab with Retry
    function attemptConnection(retries = 3) {
        chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, function (tabs) {
            if (tabs && tabs.length > 0) {
                const tabId = tabs[0].id;
                chrome.tabs.sendMessage(tabId, { type: "FROM_EXTENSION", command: "getContacts" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn(`Connection attempt failed (Remaining: ${retries}):`, chrome.runtime.lastError.message);
                        // If content script isn't present, inject it and retry once.
                        const msg = String(chrome.runtime.lastError.message || '');
                        const isNoReceiver = msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection');
                        if (isNoReceiver) {
                            chrome.scripting.executeScript({ target: { tabId }, files: ['js/content-script.js'] }, () => {
                                // Ignore inject errors, just fall through to retry logic.
                                if (retries > 0) setTimeout(() => attemptConnection(retries - 1), 1200);
                            });
                            return;
                        }
                        if (retries > 0) {
                            setTimeout(() => attemptConnection(retries - 1), 2000);
                        } else {
                            if (statusText) statusText.textContent = "Recarregue o WhatsApp";
                            if (statusDot) statusDot.style.backgroundColor = '#f59e0b';
                        }
                    } else {
                        console.log('[Dashboard] Connected to WhatsApp tab successfully.');
                    }
                });
            } else {
                if (statusText && statusText.textContent !== "Cache Carregado") {
                    statusText.textContent = "WhatsApp Fechado";
                    if (statusDot) statusDot.style.backgroundColor = '#ef4444';
                }
            }
        });
    }

    attemptConnection();

    // Listen for messages from background/content
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'FROM_WAPI') {
            const payload = message.payload;
            if (payload.type === 'WAPI_READY') {
                if (statusDot) {
                    statusDot.classList.add('connected');
                    statusDot.style.backgroundColor = '#22c55e';
                }
                if (statusText) statusText.textContent = "WhatsApp Online";
                scheduleDashboardStatsFetch(500);
            }
            if (payload.type === 'CONTACTS_LIST') {
                if (statusDot) {
                    statusDot.classList.add('connected');
                    statusDot.style.backgroundColor = '#22c55e';
                }
                if (statusText) statusText.textContent = "Sincronizado";

                // DO NOT overwrite globalContacts or storage directly here.
                // Trust the background.js merge logic and wait for CONTACTS_UPDATED event.
                console.log('[Dashboard] Received CONTACTS_LIST via WAPI message. Waiting for background merge...');
            }
        }

        // Listen for updates from background sync
        if (message.type === 'CONTACTS_UPDATED') {
            console.log(`[Dashboard] Contacts updated from Background: ${message.count}`);
            chrome.storage.local.get(['wa_contacts'], function (result) {
                if (result.wa_contacts) {
                    globalContacts = result.wa_contacts;
                    const leadCount = globalContacts.filter(c => c.is_lead).length;
                    console.log(`[Dashboard] Loaded ${globalContacts.length} contacts (${leadCount} leads)`);
                    renderFilteredContacts();
                    updateKPIs();
                    scheduleDashboardStatsFetch(500);
                }
            });
        }
    });
}

function updateKPIs() {
    const kpiContacts = document.getElementById('kpi-contacts');
    if (kpiContacts) kpiContacts.textContent = globalContacts.length;
}

// ==================== SEARCH ====================
function initSearch() {
    const searchInput = document.getElementById('start-contact-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            // Debounce slightly if needed, but for <3000 contacts standard filtering is fast enough
            renderFilteredContacts();
        });
    } else {
        console.warn('[Dashboard] Search input not found');
    }
}

function initFilters() {
    const filterTabs = document.querySelectorAll('.filter-tab');
    if (!filterTabs.length) return;

    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            filterTabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'transparent';
                t.style.borderColor = 'var(--border)';
            });
            tab.classList.add('active');
            tab.style.background = 'var(--bg-hover)';
            tab.style.borderColor = 'var(--primary)';
            currentFilter = tab.getAttribute('data-filter');

            // Show/Hide Advanced Filters for Leads
            const advancedFilters = document.getElementById('advanced-filters');
            if (advancedFilters) {
                advancedFilters.style.display = currentFilter === 'leads' ? 'flex' : 'none';
            }

            // If clicking 'leads', fetch from DEDICATED table
            if (currentFilter === 'leads') {
                console.log('[Dashboard] Leads filter clicked. Fetching from Dedicated Leads Table...');
                renderSkeleton(); // Show loading state

                // Fetch from isolated table
                new ApiClient().fetchLeads().then(leads => {
                    console.log(`[Dashboard] Fetched ${leads.length} dedicated leads.`);
                    // Merge into global contacts for display, but mark as is_lead
                    const leadsMap = new Map();
                    leads.forEach(l => leadsMap.set(l.id._serialized, l));

                    // Update globalContacts invisibly or just render?
                    // Better approach: maintain globalContacts as "View Data"
                    // We need to mix them with WhatsApp data effectively or just show them.
                    // For the "Leads" tab, we show these specific rows.

                    // Let's inject them into the render cycle
                    // We can store them in a separate variable or just pass them to render
                    renderFilteredContacts(leads);
                });
            } else {
                renderFilteredContacts();
            }
        });
    });

    // Listeners for Advanced Filters
    const filterTimePeriod = document.getElementById('filter-time-period');
    const filterNotSentRecently = document.getElementById('filter-not-sent-recently');

    if (filterTimePeriod) filterTimePeriod.addEventListener('change', renderFilteredContacts);
    if (filterNotSentRecently) filterNotSentRecently.addEventListener('change', renderFilteredContacts);
}

// ==================== SORTING ====================
function initSorting() {
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.getAttribute('data-sort');
            if (currentSort.field === field) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.field = field;
                currentSort.dir = 'asc';
            }
            // Update header indicators
            document.querySelectorAll('.sortable').forEach(h => {
                const f = h.getAttribute('data-sort');
                h.textContent = h.textContent.replace(/ [↑↓↕]/g, '') + (f === field ? (currentSort.dir === 'asc' ? ' ↑' : ' ↓') : ' ↕');
            });
            renderFilteredContacts();
        });
    });
}

// ==================== SELECTION ====================
function initSelection() {
    // Select All
    const selectAll = document.getElementById('select-all-contacts');
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.contact-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                const id = cb.getAttribute('data-id');
                if (e.target.checked) {
                    selectedContacts.add(id);
                } else {
                    selectedContacts.delete(id);
                }
            });
            updateCampaignRecipients();
        });
    }
}

function updateCampaignRecipients() {
    const el = document.getElementById('campaign-recipients');
    if (!el) return;
    const text = el.querySelector('.recipients-text');
    const btn = document.getElementById('btn-start-campaign');

    if (selectedContacts.size > 0) {
        text.textContent = `${selectedContacts.size} contatos selecionados`;
        if (btn) btn.disabled = false;
        // Highlight rows
        document.querySelectorAll('tr').forEach(tr => {
            const cb = tr.querySelector('.contact-checkbox');
            if (cb && cb.checked) tr.classList.add('selected');
            else tr.classList.remove('selected');
        });
    } else {
        text.textContent = '0 selecionados';
        if (btn) btn.disabled = true;
        document.querySelectorAll('tr').classList?.remove('selected');
    }
    updatePreview(); // Update preview name
}

// ==================== FILTERING & RENDERING ====================
function renderFilteredContacts(explicitData = null) {
    // Simplified filtering since tabs were removed in this iteration 
    // to focus on clean UI. Default to 'all'.

    const searchTerm = (document.getElementById('start-contact-search')?.value || '').toLowerCase().trim();

    // Deduplicate and Filter
    const uniqueMap = new Map();
    // Use explicit data (e.g. Leads) or Global Contacts
    const sourceData = explicitData || globalContacts;

    sourceData.forEach(c => {
        let rawId = c.id;
        if (typeof rawId === 'object' && rawId._serialized) rawId = rawId._serialized;

        // Skip invalid
        if (!rawId) return;

        // Normalize ID (handle objects or strings)
        let idStr = rawId;
        if (typeof rawId === 'object') idStr = rawId.user + '@' + rawId.server;

        // Skip LID (Linked Device IDs) usage for now to avoid duplicates
        if (idStr.includes('@lid')) return;

        // Skip Status Broadcast
        if (idStr === 'status@broadcast') return;

        // Use the user part (phone number) as the unique key for standard contacts
        const parts = idStr.split('@');
        const user = parts[0];
        const server = parts[1];

        // Store by user (phone number) priority
        if (uniqueMap.has(user)) {
            const existing = uniqueMap.get(user);
            // Merge: prefer info from newer scrape, but keep is_lead
            const merged = { ...existing, ...c };
            if (existing.is_lead || c.is_lead) merged.is_lead = true;
            if (!merged.name) merged.name = c.name || existing.name;
            uniqueMap.set(user, merged);
        } else {
            uniqueMap.set(user, c);
        }
    });

    let filtered = Array.from(uniqueMap.values());

    // Search filter
    if (searchTerm) {
        filtered = filtered.filter(c => {
            const name = (c.name || c.pushname || c.formattedName || '').toLowerCase();
            let number = '';
            if (typeof c.id === 'string') number = c.id.split('@')[0];
            else if (c.id && c.id.user) number = c.id.user;
            return name.includes(searchTerm) || number.includes(searchTerm);
        });
    }

    // Category Filter
    const totalLeads = filtered.filter(c => c.is_lead).length;
    console.log(`[Dashboard] Filtering: mode=${currentFilter}, search='${searchTerm}', pool=${filtered.length}, total_leads_in_pool=${totalLeads}`);

    if (currentFilter === 'whatsapp') {
        filtered = filtered.filter(c => !c.is_lead);
    } else if (currentFilter === 'leads') {
        filtered = filtered.filter(c => !!c.is_lead);

        // --- SUB-FILTERS FOR LEADS ---
        const timePeriod = document.getElementById('filter-time-period')?.value || 'all';
        const notSentRecently = document.getElementById('filter-not-sent-recently')?.checked || false;

        if (timePeriod !== 'all') {
            const now = Date.now();
            let threshold = 0;

            if (timePeriod.endsWith('m') && timePeriod !== 'month') {
                const minutes = parseInt(timePeriod);
                threshold = minutes * 60 * 1000;
            } else if (timePeriod.endsWith('h')) {
                const hours = parseInt(timePeriod);
                threshold = hours * 60 * 60 * 1000;
            } else if (timePeriod === 'today') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                threshold = now - today.getTime();
            } else if (timePeriod === 'month') {
                const month = new Date();
                month.setDate(1);
                month.setHours(0, 0, 0, 0);
                threshold = now - month.getTime();
            }

            filtered = filtered.filter(c => {
                const importedAt = c.imported_at || c.raw_data?.imported_at;
                if (!importedAt) return false;
                const date = new Date(importedAt).getTime();
                return (now - date) <= threshold;
            });
        }

        if (notSentRecently) {
            // Filter out anyone sent a message in the last 3 days
            const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            filtered = filtered.filter(c => {
                const lastSent = c.last_sent_at || c.raw_data?.last_sent_at;
                if (!lastSent) return true; // Never sent
                return (now - new Date(lastSent).getTime()) > threeDaysMs;
            });
        }

        console.log(`[Dashboard] Filtered Leads Result: ${filtered.length} items (Time: ${timePeriod}, NotSent: ${notSentRecently})`);
    }

    // Sort
    if (currentSort.field) {
        filtered.sort((a, b) => {
            let va, vb;
            if (currentSort.field === 'name') {
                va = (a.name || a.pushname || a.formattedName || '').toLowerCase();
                vb = (b.name || b.pushname || b.formattedName || '').toLowerCase();
            } else if (currentSort.field === 'number') {
                va = typeof a.id === 'string' ? a.id.split('@')[0] : '';
                vb = typeof b.id === 'string' ? b.id.split('@')[0] : '';
            } else if (currentSort.field === 'type') {
                va = a.isBusiness ? 'Business' : a.isGroup ? 'Group' : 'User';
                vb = b.isBusiness ? 'Business' : b.isGroup ? 'Group' : 'User';
            }
            if (va < vb) return currentSort.dir === 'asc' ? -1 : 1;
            if (va > vb) return currentSort.dir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderContacts(filtered);
}

function renderContacts(contacts) {
    const tbody = document.getElementById('contact-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (currentRenderTask) { clearTimeout(currentRenderTask); currentRenderTask = null; }

    if (!contacts || contacts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">Nenhum contato encontrado.</td></tr>';
        return;
    }

    const BATCH_SIZE = 50;
    let currentIndex = 0;

    function renderBatch() {
        const frag = document.createDocumentFragment();
        const batch = contacts.slice(currentIndex, currentIndex + BATCH_SIZE);

        batch.forEach(contact => {
            const tr = document.createElement('tr');
            const name = contact.name || contact.pushname || contact.formattedName || "Desconhecido";

            let rawId = contact.id;
            if (typeof rawId === 'object' && rawId._serialized) rawId = rawId._serialized;

            let number = "Unknown", server = "";
            if (typeof rawId === 'string') {
                const parts = rawId.split('@');
                number = parts[0]; server = parts[1];
            } else if (typeof rawId === 'object' && rawId.user) {
                number = rawId.user; server = rawId.server;
            }

            if (rawId === 'status@broadcast') return;

            let typeBadge = '<span class="badge badge-user">Usuário</span>';
            if (contact.isBusiness) typeBadge = '<span class="badge badge-business">Business</span>';
            if (contact.isGroup || server === 'g.us') typeBadge = '<span class="badge badge-group">Grupo</span>';
            if (contact.is_lead) typeBadge = '<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);">Lead</span>';

            const isMyContactLabel = contact.isMyContact ? 'Salvo' : 'Não Salvo';

            // Contacted Badge / Marker
            let statusBadge = `<span style="font-size:12px; color:#64748b; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${isMyContactLabel}</span>`;
            const lastSent = contact.last_sent_at || contact.raw_data?.last_sent_at;
            if (lastSent) {
                const dateStr = new Date(lastSent).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                statusBadge += ` <span class="badge" title="Último envio em ${new Date(lastSent).toLocaleString()}" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.2); font-size:10px; margin-left:4px;">Enviado ${dateStr}</span>`;
            }

            let initial = "#";
            if (name && /[a-zA-Z]/.test(name)) initial = name.charAt(0).toUpperCase();

            let avatarContent = initial;
            if (contact.avatar) {
                avatarContent = `<img src="${contact.avatar}" class="avatar-img" alt="${initial}" onerror="this.parentNode.innerText='${initial}'">`;
            }

            const contactId = rawId || number;
            const isSelected = selectedContacts.has(contactId);

            if (isSelected) tr.classList.add('selected');

            let editBtn = '';
            // Only allow editing for Leads (is_lead = true)
            if (contact.is_lead) {
                // We use onclick attribute for simplicity here or bind later
                // Storing data in attributes
                editBtn = `<button class="btn-icon-small btn-edit-lead" 
                    data-id="${contactId}" 
                    data-number="${number}" 
                    data-name="${name}" 
                    title="Editar Lead">✏️</button>`;
            }

            tr.innerHTML = `
                <td>
                    <input type="checkbox" class="contact-checkbox" data-id="${contactId}" ${isSelected ? 'checked' : ''}>
                </td>
                <td>
                    <div class="contact-info">
                        <div class="contact-avatar">
                            ${avatarContent}
                        </div>
                        <div class="contact-details">
                            <span class="contact-name">${name} ${editBtn}</span>
                        </div>
                    </div>
                </td>
                <td>${number}</td>
                <td>${typeBadge}</td>
                <td>${statusBadge}</td>
            `;

            const checkbox = tr.querySelector('.contact-checkbox');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedContacts.add(contactId);
                    tr.classList.add('selected');
                } else {
                    selectedContacts.delete(contactId);
                    tr.classList.remove('selected');
                }
                updateCampaignRecipients();
            });

            // Bind Edit Button
            const btnEdit = tr.querySelector('.btn-edit-lead');
            if (btnEdit) {
                btnEdit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btnEdit.dataset.id;
                    const num = btnEdit.dataset.number;
                    const nam = btnEdit.dataset.name;
                    openEditModal(id, num, nam);
                });
            }

            frag.appendChild(tr);
        });

        tbody.appendChild(frag);
        currentIndex += BATCH_SIZE;
        if (currentIndex < contacts.length) {
            currentRenderTask = setTimeout(renderBatch, 0);
        }
    }

    renderBatch();
}

function openEditModal(id, number, name) {
    const modal = document.getElementById('modal-add-number');
    const title = modal.querySelector('.modal-header h3');
    const inputNum = document.getElementById('manual-number');
    const inputName = document.getElementById('manual-name');
    const btnSave = document.getElementById('btn-confirm-add');

    title.textContent = 'Editar Lead';
    inputNum.value = number;
    inputName.value = name;
    btnSave.dataset.editId = id;

    modal.style.display = 'flex';
}

function renderSkeleton() {
    const tbody = document.getElementById('contact-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Create 5 skeleton rows
    for (let i = 0; i < 5; i++) {
        const tr = document.createElement('tr');
        tr.className = 'skeleton-row';
        tr.innerHTML = `
            <td><div class="skeleton" style="width:16px; height:16px;"></div></td>
            <td>
                <div style="display:flex; align-items:center; gap:12px">
                    <div class="skeleton skeleton-avatar"></div>
                    <div style="display:flex; flex-direction:column; gap:4px; width:100%">
                        <div class="skeleton skeleton-text" style="width:120px"></div>
                        <div class="skeleton skeleton-subtext"></div>
                    </div>
                </div>
            </td>
            <td><div class="skeleton skeleton-text" style="width:100px"></div></td>
            <td><div class="skeleton skeleton-text" style="width:60px"></div></td>
            <td><div class="skeleton skeleton-text" style="width:40px"></div></td>
        `;
        tbody.appendChild(tr);
    }
}

// ==================== MEDIA UPLOAD ====================
function initMediaUpload() {
    const dropZone = document.getElementById('media-drop-zone');
    const fileInput = document.getElementById('media-input');
    if (!dropZone || !fileInput) return;

    // Click to upload
    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('.remove-media')) return;
        fileInput.click();
    });

    // Drag & Drop
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', () => handleFiles(fileInput.files));
}

function handleFiles(fileList) {
    for (const file of fileList) {
        if (file.size > 16 * 1024 * 1024) {
            Toast.error(`Arquivo "${file.name}" excede 16MB.`);
            continue;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            mediaFiles.push({ name: file.name, type: file.type, base64: base64, caption: '' });
            renderMediaPreviews();
        };
        reader.readAsDataURL(file);
    }
}

function renderMediaPreviews() {
    const container = document.getElementById('media-preview-list');
    const placeholder = document.getElementById('upload-placeholder');
    container.innerHTML = '';

    if (mediaFiles.length > 0 && placeholder) placeholder.style.display = 'none';
    else if (placeholder) placeholder.style.display = 'flex';

    mediaFiles.forEach((media, idx) => {
        const div = document.createElement('div');
        div.className = 'media-preview-item';

        let icon = '📄';
        if (media.type.startsWith('image/')) icon = '🖼️';
        else if (media.type.startsWith('video/')) icon = '🎬';
        else if (media.type.startsWith('audio/')) icon = '🎵';

        div.innerHTML = `
            <span class="media-preview-icon">${icon}</span>
            <span class="media-file-name" style="max-width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${media.name}</span>
            <button class="remove-media" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; margin-left:8px;">&times;</button>
        `;

        div.querySelector('.remove-media').addEventListener('click', (e) => {
            e.stopPropagation();
            mediaFiles.splice(idx, 1);
            renderMediaPreviews();
        });

        container.appendChild(div);
    });

    // Update Live Preview Media
    const previewContainer = document.getElementById('preview-media-container');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        if (mediaFiles.length > 0) {
            previewContainer.style.display = 'block';
            const media = mediaFiles[0];
            if (media.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = media.base64;
                previewContainer.appendChild(img);
            } else if (media.type.startsWith('video/')) {
                const vid = document.createElement('video');
                vid.src = media.base64;
                vid.controls = true;
                vid.style.maxHeight = '200px';
                previewContainer.appendChild(vid);
            } else {
                previewContainer.innerHTML = '<div style="background:#f0f0f0; padding:10px; border-radius:4px; margin-bottom:4px;">📄 Documento</div>';
            }
            if (mediaFiles.length > 1) {
                const more = document.createElement('div');
                more.textContent = `+ ${mediaFiles.length - 1} outros`;
                more.style.fontSize = '11px';
                more.style.color = '#666';
                previewContainer.appendChild(more);
            }
        } else {
            previewContainer.style.display = 'none';
        }
    }
}

// ==================== UI HELPERS ====================
function initAddNumberModal() {
    console.log('[Dashboard] Init Add Number Modal...');
    const modal = document.getElementById('modal-add-number');
    const btnOpen = document.getElementById('btn-add-number');
    const btnClose = document.getElementById('modal-close-add');
    const btnCancel = document.getElementById('btn-cancel-add');
    const btnConfirm = document.getElementById('btn-confirm-add');

    console.log('[Dashboard] Elements:', {
        modal: !!modal,
        btnOpen: !!btnOpen,
        btnClose: !!btnClose,
        btnCancel: !!btnCancel,
        btnConfirm: !!btnConfirm
    });

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            console.log('[Dashboard] Open Modal Clicked');
            if (modal) {
                modal.querySelector('.modal-header h3').textContent = 'Adicionar Contato';
                delete btnConfirm.dataset.editId;
                document.getElementById('manual-number').value = '';
                document.getElementById('manual-name').value = '';

                modal.style.display = 'flex';
                // Force focus on input
                setTimeout(() => document.getElementById('manual-number')?.focus(), 100);
            }
        });
    }

    if (btnClose) btnClose.addEventListener('click', () => modal.style.display = 'none');
    if (btnCancel) btnCancel.addEventListener('click', () => modal.style.display = 'none');

    if (btnConfirm) {
        btnConfirm.addEventListener('click', async () => {
            console.log('[Dashboard] Confirm Add Contact Clicked');
            const numberInput = document.getElementById('manual-number');
            const nameInput = document.getElementById('manual-name');
            let number = numberInput.value.replace(/\D/g, '');
            const name = nameInput.value.trim() || 'Manual Contact';
            const editId = btnConfirm.dataset.editId;

            if (number.length < 10) {
                Toast.error('Número inválido.');
                return;
            }

            // Append domain if missing
            if (!number.includes('@')) number += '@c.us';

            // --- API SAVE (Upsert) ---
            new ApiClient().importLeads([{
                number: number.split('@')[0], // API expects just number string usually? importLeads creates ID
                name: name
            }], 'manual').then(res => {
                console.log('[Dashboard] Manual contact saved to dedicated leads table:', res);
                if (res.error) {
                    Toast.error('Erro ao salvar no servidor: ' + res.error);
                } else {
                    Toast.success('Salvo no servidor com sucesso!');
                }
            }).catch(e => {
                console.error(e);
                Toast.error('Erro de conexão ao salvar.');
            });

            // --- LOCAL UPDATE ---
            if (editId) {
                // UPDATE EXISTING
                Toast.success('Lead atualizado!');
                const idx = globalContacts.findIndex(c => (c.id._serialized || c.id) === editId);
                if (idx !== -1) {
                    globalContacts[idx].name = name;
                    globalContacts[idx].number = number.split('@')[0];
                    globalContacts[idx].id = { _serialized: number, user: number.split('@')[0], server: 'c.us' };
                }
            } else {
                // ADD NEW
                const newContact = {
                    id: { _serialized: number, user: number.split('@')[0], server: 'c.us' },
                    name: name,
                    pushname: name,
                    isMyContact: false,
                    isBusiness: false,
                    isGroup: false,
                    is_lead: true
                };
                globalContacts.unshift(newContact);
                selectedContacts.add(number); // Auto-select new (always keep full WA id)
                Toast.success('Contato adicionado e salvo!');
            }

            // Persistence
            chrome.storage.local.set({ 'wa_contacts': globalContacts });

            renderFilteredContacts();
            updateCampaignRecipients();

            modal.style.display = 'none';
            numberInput.value = '';
            nameInput.value = '';
            delete btnConfirm.dataset.editId;
        });
    }
}

function initImportExcelModal() {
    console.log('[Dashboard] Init Import Excel Modal...');

    const modal = document.getElementById('modal-import-excel');
    const btnOpen = document.getElementById('btn-import-excel');
    const btnClose = document.getElementById('modal-close-import');
    const btnCancel = document.getElementById('btn-cancel-import');
    const btnConfirm = document.getElementById('btn-confirm-import');

    const dropZone = document.getElementById('excel-drop-zone');
    const fileInput = document.getElementById('excel-input');

    const step1 = document.getElementById('import-step-1');
    const step2 = document.getElementById('import-step-2');

    const selectPhone = document.getElementById('select-column-phone');
    const selectName = document.getElementById('select-column-name');

    const previewThead = document.getElementById('import-preview-thead');
    const previewTbody = document.getElementById('import-preview-tbody');
    const countLabel = document.getElementById('import-count-label');

    let importedData = []; // Array of objects from Excel
    let headers = [];

    if (btnOpen) btnOpen.addEventListener('click', () => {
        modal.style.display = 'flex';
        resetImportUI();
    });

    if (btnClose) btnClose.addEventListener('click', () => modal.style.display = 'none');
    if (btnCancel) btnCancel.addEventListener('click', () => modal.style.display = 'none');

    // Reset UI
    function resetImportUI() {
        step1.style.display = 'block';
        step2.style.display = 'none';
        btnConfirm.style.display = 'none';
        fileInput.value = '';
        importedData = [];
        headers = [];
    }

    // Drag & Drop
    if (dropZone) {
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
        dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = 'var(--border)');
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border)';
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
    }

    if (fileInput) fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const bstr = e.target.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

                if (data.length < 2) {
                    Toast.error('O arquivo parece estar vazio ou sem cabeçalho.');
                    return;
                }

                headers = data[0];
                // Remove empty headers and transform data to objects
                const rawRows = data.slice(1);
                importedData = rawRows.filter(row => row.length > 0).map(row => {
                    let obj = {};
                    headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
                    return obj;
                });

                showStep2();
            } catch (err) {
                console.error('Excel Read Error:', err);
                Toast.error('Erro ao ler arquivo. Verifique se é um Excel válido.');
            }
        };
        reader.readAsBinaryString(file);
    }

    function showStep2() {
        step1.style.display = 'none';
        step2.style.display = 'block';
        btnConfirm.style.display = 'inline-block';
        countLabel.textContent = importedData.length;

        // Populate Selects
        selectPhone.innerHTML = '<option value="" disabled selected>Selecionar Coluna...</option>';
        selectName.innerHTML = '<option value="">(Nenhuma / Não importar)</option>';

        headers.forEach(h => {
            if (!h) return;
            const opt = document.createElement('option');
            opt.value = h;
            opt.textContent = h;
            selectPhone.appendChild(opt.cloneNode(true));
            selectName.appendChild(opt.cloneNode(true));
        });

        // Auto-guess phone column
        const phoneGuess = headers.find(h => {
            if (!h) return false;
            const low = h.toString().toLowerCase();
            return low.includes('tel') || low.includes('cel') || low.includes('phone') || low.includes('número') || low.includes('numero');
        });
        if (phoneGuess) selectPhone.value = phoneGuess;

        updatePreview();
    }

    function updatePreview() {
        const phoneCol = selectPhone.value;
        const nameCol = selectName.value;

        if (!previewThead || !previewTbody) return;

        // Render Headers
        previewThead.innerHTML = `<tr>${headers.map(h => `<th>${h || ''}</th>`).join('')}</tr>`;

        // Render first 5 rows
        previewTbody.innerHTML = importedData.slice(0, 5).map(row => {
            return `<tr>${headers.map(h => {
                const val = row[h] || '';
                let style = '';
                if (h === phoneCol) style = 'background: rgba(16, 185, 129, 0.1); font-weight: bold;';
                if (h === nameCol) style = 'background: rgba(59, 130, 246, 0.1);';
                return `<td style="${style}">${val}</td>`;
            }).join('')}</tr>`;
        }).join('');
    }

    [selectPhone, selectName].forEach(sel => {
        if (sel) sel.addEventListener('change', updatePreview);
    });

    if (btnConfirm) btnConfirm.addEventListener('click', async () => {
        const phoneCol = selectPhone.value;
        const nameCol = selectName.value;

        if (!phoneCol) {
            Toast.error('Por favor, selecione a coluna de Telefone.');
            return;
        }

        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Importando...';

        try {
            // Transform selected columns to our lead format
            const leads = importedData.map(row => {
                const rawNum = String(row[phoneCol] || '').replace(/\D/g, '');
                return {
                    number: rawNum,
                    name: nameCol ? String(row[nameCol] || '').trim() : ''
                };
            }).filter(l => l.number.length >= 8);

            if (leads.length === 0) {
                Toast.error('Nenhum número válido encontrado nas colunas selecionadas.');
                btnConfirm.disabled = false;
                btnConfirm.textContent = 'Importar';
                return;
            }

            // Sync to Global Contacts
            const newContacts = leads.map(l => ({
                id: { _serialized: l.number + '@c.us', user: l.number, server: 'c.us' },
                name: l.name || 'Lead ' + l.number,
                pushname: l.name || '',
                isMyContact: false,
                isBusiness: false,
                isGroup: false,
                is_lead: true
            }));

            // merge with global
            const existingIds = new Set(globalContacts.map(c => typeof c.id === 'string' ? c.id : c.id._serialized));
            const uniqueNew = newContacts.filter(c => !existingIds.has(c.id._serialized));

            globalContacts = [...uniqueNew, ...globalContacts];
            renderFilteredContacts();

            // 4. Send to API (Dedicated Leads Table)
            // We use ApiClient directly to ensure it goes to the right table
            new ApiClient().importLeads(leads, 'excel')
                .then(response => {
                    console.log('[Dashboard] Import result:', response);

                    if (response.error) {
                        Toast.error('Erro ao salvar leads: ' + response.error);
                    } else {
                        Toast.success(`${leads.length} Leads importados e salvos com segurança!`);

                        // Force refresh if on leads tab
                        if (currentFilter === 'leads') {
                            document.querySelector('.filter-tab[data-filter="leads"]').click();
                        }
                    }
                })
                .catch(err => {
                    console.error('[Dashboard] Import failed:', err);
                    Toast.error('Falha na importação.');
                })
                .finally(() => {
                    // Close modal and reset
                    modal.style.display = 'none';
                    step1.style.display = 'block';
                    step2.style.display = 'none';
                    fileInput.value = '';
                    importedData = [];
                });
        } catch (err) {
            console.error('Import Error:', err);
            Toast.error('Erro durante a importação.');
        } finally {
            btnConfirm.disabled = false;
            btnConfirm.textContent = `Importar ${importedData.length} Leads`;
        }
    });
}

// ==================== CAMPAIGN LOGIC ====================
function initCampaignUI() {
    // Char count
    const msgArea = document.getElementById('campaign-message');
    const charCount = document.getElementById('char-count');
    if (msgArea && charCount) {
        msgArea.addEventListener('input', () => {
            charCount.textContent = msgArea.value.length;
            updateSpintaxPreview();
        });
    }

    // Buttons
    const btnStart = document.getElementById('btn-start-campaign');
    if (btnStart) btnStart.addEventListener('click', startCampaign);

    const btnPause = document.getElementById('btn-pause-campaign');
    if (btnPause) {
        btnPause.addEventListener('click', () => {
            if (campaignEngine.isPaused) {
                campaignEngine.resume();
                btnPause.innerHTML = '⏸ Pausar';
            } else {
                campaignEngine.pause();
                btnPause.innerHTML = '▶ Retomar';
            }
        });
    }

    const btnCancel = document.getElementById('btn-cancel-campaign');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            if (confirm('Cancelar campanha?')) {
                campaignEngine.cancel();
            }
        });
    }

    setCampaignActionButtons('idle');
}

function initSpintaxUI() {
    const toggle = document.getElementById('spintax-toggle');
    const preview = document.getElementById('spintax-preview');
    const btnRefresh = document.getElementById('btn-refresh-preview');

    if (toggle) {
        toggle.addEventListener('change', () => {
            if (preview) preview.style.display = toggle.checked ? 'block' : 'none';
            if (toggle.checked) {
                updateSpintaxPreview();
                Toast.info('Variação IA ativada. Use {a|b} para criar variações.');
            }
        });
    }
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => updateSpintaxPreview(true));
    }
}

let spintaxSeed = 0;
function updateSpintaxPreview(refresh = false) {
    const toggle = document.getElementById('spintax-toggle');
    const previewList = document.getElementById('spintax-preview-list');
    const msgArea = document.getElementById('campaign-message');

    if (!toggle || !toggle.checked || !previewList || !msgArea) return;

    const text = msgArea.value;
    if (refresh) spintaxSeed += 100;

    const engine = campaignEngine || new CampaignEngine();
    const previews = engine.getSpintaxPreviews(text, 3); // Show 3 previews

    previewList.innerHTML = '';
    previews.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.setAttribute('data-index', i + 1);
        div.textContent = p;
        previewList.appendChild(div);
    });
}

function initDelayBarsUI() {
    const inputs = ['delay-min', 'delay-max', 'pause-after'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateDelayBars);
    });
}
function updateDelayBars() {
    // Just validations if needed
}

function normalizeCampaignConfig(delayMin, delayMax, pauseAfter) {
    const min = Math.min(300, Math.max(2, Number.isFinite(delayMin) ? delayMin : 5));
    const max = Math.min(600, Math.max(min, Number.isFinite(delayMax) ? delayMax : 120));
    const pause = Math.min(100, Math.max(5, Number.isFinite(pauseAfter) ? pauseAfter : 10));

    return { delayMin: min, delayMax: max, pauseAfter: pause };
}

function setCampaignActionButtons(state = 'idle') {
    const btnStart = document.getElementById('btn-start-campaign');
    const btnPause = document.getElementById('btn-pause-campaign');
    const btnCancel = document.getElementById('btn-cancel-campaign');

    if (!btnStart || !btnPause || !btnCancel) return;

    if (state === 'running') {
        btnStart.style.display = 'none';
        btnPause.style.display = 'inline-flex';
        btnCancel.style.display = 'inline-flex';
        return;
    }

    btnStart.style.display = 'inline-flex';
    btnPause.style.display = 'none';
    btnCancel.style.display = 'none';
}

async function startCampaign() {
    const message = document.getElementById('campaign-message')?.value || '';
    const manualInput = document.getElementById('manual-campaign-numbers')?.value || '';

    if (!message.trim() && mediaFiles.length === 0) {
        Toast.warning('Digite uma mensagem ou adicione mídia.');
        return;
    }

    // 1. Process Manual Numbers (Legacy check or if user didn't click "Add")
    // We'll process valid ones just in case users forget to click "Add"
    if (manualInput.trim()) {
        await processManualInput(false); // Process silently, don't clear if fails? Actually better to process.
    }

    // 2. Get Selected Contacts (Now includes manual ones if added)
    const selectedRecipients = globalContacts.filter(c => {
        let rawId = c.id;
        if (typeof rawId === 'object' && rawId._serialized) rawId = rawId._serialized;
        return selectedContacts.has(rawId);
    });

    let recipients = selectedRecipients.map(c => ({
        id: typeof c.id === 'object' ? c.id : { _serialized: c.id, user: c.id.split('@')[0], server: 'c.us' },
        name: c.name || c.pushname || c.verifiedName || 'Contato',
        number: c.number || c.id.user || c.id.replace(/\D/g, '')
    }));

    // Se não há contatos selecionados, usa números manuais no MESMO motor da campanha
    if (recipients.length === 0) {
        // Busca números do campo manual
        const manualInput = document.getElementById('manual-campaign-numbers')?.value || '';
        const numbers = manualInput.split(/[,\n;]/).map(s => s.replace(/\D/g, '')).filter(s => s.length >= 8);
        if (numbers.length === 0) {
            Toast.warning('Selecione contatos ou insira números manuais.');
            return;
        }

        recipients = numbers.map(n => ({
            id: { _serialized: `${n}@c.us`, user: n, server: 'c.us' },
            name: `Lead ${n}`,
            number: n
        }));
    }

    const cfg = normalizeCampaignConfig(
        parseInt(document.getElementById('delay-min')?.value),
        parseInt(document.getElementById('delay-max')?.value),
        parseInt(document.getElementById('pause-after')?.value)
    );
    const delayMinInput = document.getElementById('delay-min');
    const delayMaxInput = document.getElementById('delay-max');
    const pauseAfterInput = document.getElementById('pause-after');
    if (delayMinInput) delayMinInput.value = String(cfg.delayMin);
    if (delayMaxInput) delayMaxInput.value = String(cfg.delayMax);
    if (pauseAfterInput) pauseAfterInput.value = String(cfg.pauseAfter);

    campaignEngine.configure(cfg);
    campaignEngine.setCampaign(recipients, message, mediaFiles);

    // Show Progress
    document.getElementById('campaign-progress-section').style.display = 'block';
    document.getElementById('stat-remaining').textContent = recipients.length;
    document.getElementById('send-log').innerHTML = '';

    // Switch Buttons
    setCampaignActionButtons('running');

    campaignStartTime = Date.now();
    campaignEngine.start();
}

function updateCampaignProgress(stats, contact) {
    document.getElementById('stat-sent').textContent = stats.sent;
    document.getElementById('stat-failed').textContent = stats.failed;
    const remaining = stats.total - stats.sent - stats.failed;
    document.getElementById('stat-remaining').textContent = remaining;

    const pct = Math.round(((stats.sent + stats.failed) / stats.total) * 100);
    const progressBar = document.getElementById('campaign-progress-bar');
    if (progressBar) progressBar.style.width = pct + '%';

    const pctLabel = document.getElementById('progress-percentage');
    if (pctLabel) pctLabel.textContent = pct + '%';
}

function addLogEntry(message, type = 'info') {
    const log = document.getElementById('send-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.style.marginBottom = '4px';
    entry.style.color = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#64748b';
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function onCampaignComplete(stats) {
    setCampaignActionButtons('idle');

    // Update dashboard KPIs
    const kpiSent = document.getElementById('kpi-sent');
    if (kpiSent) {
        const current = parseInt(kpiSent.textContent || '0');
        kpiSent.textContent = current + stats.sent;
    }
    Toast.success('Campanha finalizada!');
}

function onCampaignStatusChange(status) {
    const btnPause = document.getElementById('btn-pause-campaign');
    if (status === 'paused') btnPause.innerHTML = '▶ Retomar';
    else if (status === 'running') btnPause.innerHTML = '⏸ Pausar';
}

function updateCountdown(remaining, total, phase) {
    const section = document.getElementById('countdown-section');
    const valueEl = document.getElementById('countdown-value');

    if (remaining <= 0) {
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = 'flex';
    if (valueEl) valueEl.textContent = remaining;
}

function updateHumanScore(score) {
    const badge = document.getElementById('human-score-badge');
    const value = document.getElementById('human-score-value');
    if (value) value.textContent = score;

    if (badge) {
        badge.className = 'human-score-badge'; // reset
        if (score >= 80) badge.classList.add('score-high');
        else if (score >= 50) badge.classList.add('score-medium');
        else badge.classList.add('score-low');
    }
}

// ==================== PREVIEW LOGIC ====================
// ==================== PREVIEW LOGIC ====================
function initPreview() {
    const msgArea = document.getElementById('campaign-message');
    if (msgArea) {
        msgArea.addEventListener('input', updatePreview);
    }
}

function updatePreview() {
    const msgArea = document.getElementById('campaign-message');
    const previewText = document.getElementById('preview-message-text');
    const previewTime = document.getElementById('preview-time');
    const headerName = document.querySelector('.wa-header-name');

    if (!msgArea || !previewText) return;

    // 1. Determine Name to Display
    let displayName = "Cliente Exemplo";

    if (selectedContacts.size > 0) {
        // Find first selected contact
        const firstId = Array.from(selectedContacts)[0]; // Set iterator
        const contact = globalContacts.find(c => {
            const cId = typeof c.id === 'object' ? c.id._serialized : c.id;
            const cUser = typeof c.id === 'object' ? c.id.user : c.id.split('@')[0];
            const searchUser = firstId.split('@')[0];

            return cId === firstId || cUser === searchUser;
        });

        if (contact) {
            const name = contact.name || contact.pushname || contact.formattedName || firstId.split('@')[0];
            if (selectedContacts.size === 1) {
                displayName = name;
            } else {
                displayName = `${name} e outros ${selectedContacts.size - 1}`;
            }
        } else {
            // Fallback if contact not found in global but exists in selection (manual?)
            displayName = firstId.split('@')[0];
            if (selectedContacts.size > 1) {
                displayName += ` e outros ${selectedContacts.size - 1}`;
            }
        }
    }

    // Update Header
    if (headerName) headerName.textContent = displayName;

    // 2. Format Text
    let text = msgArea.value;

    // Spintax Preview (simple regex to pick first option for visuals)
    text = text.replace(/\{([^{}]+)\}/g, (match, p1) => {
        if (match.includes('|')) return p1.split('|')[0];
        return match;
    });

    // Variables (Use the specific name if 1 person, otherwise generic or keep variable?)
    // User asked to replace with selected contact info.
    // If multiple, maybe stick to First Contact Name for preview context?
    // Let's use the simple name of the first contact (without "and others") for the body substitution
    // Let's use the simple name of the first contact (without "and others") for the body substitution
    let bodyName = "Cliente Exemplo";
    if (selectedContacts.size > 0) {
        const firstId = Array.from(selectedContacts)[0];
        const contact = globalContacts.find(c => {
            const cId = typeof c.id === 'object' ? c.id._serialized : c.id;
            const cUser = typeof c.id === 'object' ? c.id.user : c.id.split('@')[0];
            const searchUser = firstId.split('@')[0];
            return cId === firstId || cUser === searchUser;
        });

        if (contact) {
            bodyName = contact.name || contact.pushname || contact.formattedName || firstId.split('@')[0];
        } else {
            bodyName = firstId.split('@')[0];
        }
    }

    text = text.replace(/{name}|{nome}/gi, bodyName);

    // Formatting
    text = text.replace(/\*([^\*]+)\*/g, '<b>$1</b>');
    text = text.replace(/_([^_]+)_/g, '<i>$1</i>');
    text = text.replace(/~([^~]+)~/g, '<strike>$1</strike>');
    text = text.replace(/\n/g, '<br>');

    if (!text && mediaFiles.length === 0) {
        previewText.innerHTML = '<span style="color:#aebac1; font-style:italic;">Sua mensagem aparecerá aqui...</span>';
    } else {
        previewText.innerHTML = text;
    }

    // Time
    if (previewTime) {
        const now = new Date();
        previewTime.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    }
}

// ==================== THEME LOGIC ====================
function initTheme() {
    const btn = document.getElementById('theme-toggle');
    const stored = localStorage.getItem('theme');

    // Apply stored preference
    if (stored === 'dark') {
        document.body.classList.add('dark-mode');
        if (btn) btn.textContent = '☀️ Light Mode';
    }

    if (btn) {
        btn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            btn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
        });
    }
}

// ==================== AI MAGIC REWRITE (PROXY + CARDS) ====================
function initMagicRewrite() {
    console.log('[DEBUG] initMagicRewrite Cards Mode called');
    const btnMagic = document.getElementById('btn-magic-rewrite');
    const suggestionsContainer = document.getElementById('ai-suggestions');
    const msgArea = document.getElementById('campaign-message');
    const modelSelect = document.getElementById('ai-model-select');

    if (!btnMagic || !suggestionsContainer) {
        console.error('[DEBUG] Elements not found');
        return;
    }

    // Auto-load available models
    try {
        if (window.aiService && window.aiService.hasKey()) {
            window.aiService.getAvailableModels().then(models => {
                if (models.length > 0) {
                    if (modelSelect) {
                        modelSelect.style.display = 'inline-block';
                        modelSelect.innerHTML = '<option value="">🤖 Auto (Recomendado)</option>';

                        models.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m.id;
                            opt.textContent = m.displayName || m.name;
                            modelSelect.appendChild(opt);
                        });

                        modelSelect.addEventListener('change', (e) => {
                            const val = e.target.value;
                            window.aiService.setModel(val || null);
                        });
                    }
                }
            });
        }
    } catch (e) {
        console.warn('Failed to load models:', e);
    }

    let abortController = null;
    let latestVersions = []; // Store versions for the static button

    // --- STATIC BUTTON LOGIC ---
    const btnUseAll = document.getElementById('btn-use-all-spintax');
    if (btnUseAll) {
        btnUseAll.addEventListener('click', (e) => {
            e.preventDefault();
            if (latestVersions.length === 0) {
                Toast.warning('Gere as versões com a IA primeiro!');
                return;
            }

            console.log('[DEBUG] Static Use All Clicked');
            try {
                const sanitized = latestVersions.map(v => v.text.replace(/\|/g, 'I').replace(/[{}]/g, ''));
                const spintax = '{' + sanitized.join('|') + '}';

                const txtArea = document.getElementById('campaign-message');
                if (txtArea) {
                    txtArea.value = spintax;
                    txtArea.dispatchEvent(new Event('input', { bubbles: true }));
                    Toast.success('Modo Rotação Ativado com Sucesso!');
                    document.querySelector('.wa-preview-container')?.scrollIntoView({ behavior: 'smooth' });

                    // Optional: clear UI or keep it? User might want to try again.
                    // suggestionsContainer.innerHTML = ''; 
                }
            } catch (err) {
                console.error('[DEBUG] Crash in Use All:', err);
                Toast.error('Erro: ' + err.message);
            }
        });
    }

    btnMagic.addEventListener('click', async () => {
        // --- 1. HANDLE CANCELLATION ---
        if (abortController) {
            abortController.abort();
            abortController = null;
            btnMagic.innerHTML = '✨ Gerar 5 Versões';
            btnMagic.disabled = false;
            Toast.info('Operação cancelada.');
            suggestionsContainer.innerHTML = '';

            // Reset static button
            if (btnUseAll) {
                btnUseAll.style.opacity = '0.6';
                btnUseAll.style.cursor = 'not-allowed';
                btnUseAll.disabled = true;
            }
            return;
        }

        const text = msgArea.value.trim();
        if (!text) {
            Toast.warning('Digite uma mensagem base primeiro.');
            return;
        }

        // --- 2. START GENERATION ---
        abortController = new AbortController();
        const signal = abortController.signal;

        // UI State: Loading
        btnMagic.innerHTML = '🛑 Cancelar';
        suggestionsContainer.style.display = 'grid';
        suggestionsContainer.innerHTML = '<div class="ai-card" style="grid-column: 1/-1; text-align:center; color:#64748b;">Criando 5 versões inteligentes...<br><span style="font-size:12px">Isso pode levar alguns segundos se o modelo estiver sobrecarregado.</span></div>';

        // Reset static button state
        if (btnUseAll) {
            btnUseAll.style.opacity = '0.6';
            btnUseAll.style.cursor = 'not-allowed';
            btnUseAll.disabled = true;
        }
        latestVersions = [];

        try {
            console.log('[DEBUG] Calling window.aiService.rewriteToSpintax');
            const data = await window.aiService.rewriteToSpintax(text, signal);

            if (!data.versions || !Array.isArray(data.versions)) throw new Error('Formato inválido da IA');

            // Success!
            latestVersions = data.versions;

            // Enable static button
            if (btnUseAll) {
                btnUseAll.style.opacity = '1';
                btnUseAll.style.cursor = 'pointer';
                btnUseAll.disabled = false;
            }

            // Render Cards
            renderAICards(data.versions);
            Toast.success('5 Versões geradas!');

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('AI Request aborted');
            } else {
                console.error('AI Error:', error);
                Toast.error('Erro: ' + error.message);
                suggestionsContainer.innerHTML = `<div class="ai-card" style="grid-column: 1/-1; color:red;">Erro: ${error.message}</div>`;
            }
        } finally {
            if (abortController && !signal.aborted) {
                abortController = null;
                btnMagic.innerHTML = '✨ Gerar 5 Versões';
            } else if (signal.aborted) {
                btnMagic.innerHTML = '✨ Gerar 5 Versões';
            }
            abortController = null;
        }
    });

    function renderAICards(versions) {
        suggestionsContainer.innerHTML = '';

        // Note: We removed the dynamic "Use All" button from here
        // as it is now static in HTML

        versions.forEach(v => {
            const card = document.createElement('div');
            card.className = 'ai-card';

            // Clean text for display (remove massive newlines if any)
            const cleanText = v.text.replace(/\n{3,}/g, '\n\n');

            card.innerHTML = `
                <div class="ai-card-badge">${v.title}</div>
                <p>${cleanText.substring(0, 120)}${cleanText.length > 120 ? '...' : ''}</p>
                <div class="ai-card-actions">
                    <button class="btn-card copy-btn">📋 Copiar</button>
                    <button class="btn-card use-btn use">🚀 Usar</button>
                </div>
            `;

            // Events
            const btnCopy = card.querySelector('.copy-btn');
            const btnUse = card.querySelector('.use-btn');

            btnCopy.addEventListener('click', () => {
                navigator.clipboard.writeText(v.text);
                Toast.success('Copiado!');
            });

            btnUse.addEventListener('click', () => {
                msgArea.value = v.text;
                msgArea.dispatchEvent(new Event('input')); // Update preview
                Toast.success('Mensagem aplicada!');
                // Scroll to preview
                document.querySelector('.wa-preview-container')?.scrollIntoView({ behavior: 'smooth' });
            });

            suggestionsContainer.appendChild(card);
        });
    }
}

// ==================== MANUAL CAMPAIGN INPUT ====================
async function processManualInput(showAlerts = true) {
    const textarea = document.getElementById('manual-campaign-numbers');
    if (!textarea) return;

    const text = textarea.value;
    if (!text.trim()) {
        if (showAlerts) Toast.warning('Digite ou cole números para adicionar.');
        return;
    }

    const rawNumbers = text.split(/[\n,;]+/)
        .map(s => s.trim().replace(/\D/g, ''))
        .filter(n => n.length >= 8);

    if (rawNumbers.length === 0) {
        if (showAlerts) Toast.warning('Nenhum número válido encontrado.');
        return;
    }

    if (showAlerts) Toast.info(`Processando ${rawNumbers.length} números...`);

    // 1. Save locally/Supabase
    const newLeads = rawNumbers.map(n => {
        let number = n;
        if (!number.includes('@')) number += '@c.us';
        return {
            id: { _serialized: number, user: number.split('@')[0], server: 'c.us' },
            name: 'Lead Manual',
            number: number.split('@')[0],
            is_lead: true,
            isMyContact: false,
            pushname: 'Lead Manual'
        };
    });

    let addedCount = 0;
    newLeads.forEach(lead => {
        // Add to globalContacts if not exists
        const exists = globalContacts.find(c => {
            const cId = typeof c.id === 'object' ? c.id._serialized : c.id;
            return cId === lead.id._serialized;
        });

        if (!exists) {
            globalContacts.unshift(lead);
            addedCount++;
        }

        // Always select (always keep full WA id)
        selectedContacts.add(lead.id._serialized);
    });

    // Save to Backend
    try {
        const payload = rawNumbers.map(n => ({ number: n, name: 'Lead Manual' }));
        await new ApiClient().importLeads(payload, 'campaign_manual');
    } catch (e) {
        console.error('Error auto-saving manual leads:', e);
    }

    // Update Persistence
    chrome.storage.local.set({ 'wa_contacts': globalContacts });

    // Update UI
    updateCampaignRecipients();
    textarea.value = ''; // Clear input

    if (showAlerts) {
        Toast.success(`${rawNumbers.length} números adicionados à lista!`);
    } else {
        console.log(`[Campaign] Auto-processed ${rawNumbers.length} manual numbers.`);
    }
}

// Bind Button
document.addEventListener('DOMContentLoaded', () => {
    const btnProcess = document.getElementById('btn-process-manual');
    if (btnProcess) {
        btnProcess.addEventListener('click', () => processManualInput(true));
    }
});
// ==================== HELPER: ADD LOG ENTRY ====================
// ==================== DASHBOARD STATS (KPIs) ====================
async function fetchDashboardStats() {
    const uiSent = document.getElementById('kpi-sent');
    const uiSuccess = document.getElementById('kpi-success');
    const uiReplies = document.getElementById('kpi-replies');
    const uiContacts = document.getElementById('kpi-contacts');
    const activityContainer = document.getElementById('recent-activity');

    try {
        const stats = await new ApiClient().getDashboardStats();
        if (!stats) {
            scheduleDashboardStatsFetch(3000);
            return;
        }

        // Update KPIs
        if (uiSent) uiSent.textContent = stats.overview.sent;
        if (uiReplies) uiReplies.textContent = stats.overview.replies;
        if (uiContacts) uiContacts.textContent = stats.overview.totalContacts;

        if (uiSuccess) {
            const total = stats.overview.sent + stats.overview.failed;
            const rate = total > 0 ? Math.round((stats.overview.sent / total) * 100) : 0;
            uiSuccess.textContent = `${rate}%`;
        }

        // Update Recent Activity
        if (activityContainer && stats.activity.length > 0) {
            activityContainer.innerHTML = ''; // Clear empty state
            activityContainer.style.padding = '0'; // Remove padding from empty state

            stats.activity.forEach(log => {
                const isOutbound = log.direction === 'outbound';
                const icon = isOutbound ? (log.status === 'sent' ? '✅' : '❌') : '↩️';

                const div = document.createElement('div');
                div.className = 'activity-item';
                div.style.cssText = 'padding: 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px;';

                div.innerHTML = `
                    <div style="font-size: 18px;">${icon}</div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">
                            ${log.contact}
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            ${log.text ? log.text.substring(0, 50) + (log.text.length > 50 ? '...' : '') : 'Mídia enviada'}
                        </div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted);">
                        ${new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                `;
                activityContainer.appendChild(div);
            });
        }
    } catch (e) {
        console.error('[Dashboard] Stats Error:', e);
        scheduleDashboardStatsFetch(5000);
    }
}

function scheduleDashboardStatsFetch(delayMs = 1000) {
    if (statsRetryTimer) clearTimeout(statsRetryTimer);
    statsRetryTimer = setTimeout(fetchDashboardStats, delayMs);
}

// Ensure it runs
document.addEventListener('DOMContentLoaded', () => {
    // ... existing init calls
    scheduleDashboardStatsFetch(1000); // Slight delay to separate from heavy sync
});
