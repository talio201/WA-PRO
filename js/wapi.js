    /**
     * Envia mensagem para novo contato via fluxo Backup:
     * 1. Seleciona conversa Backup (agent-id)
     * 2. Cola número na conversa
     * 3. Clica no número (link)
     * 4. Seleciona "enviar mensagem"
     * 5. Envia texto real da campanha
     */
    sendViaBackupFlow: async function(backupNameOrId, targetNumber, message) {
        // 1. Selecionar conversa Backup
        const chatList = document.querySelectorAll('._3m_Xw, [data-testid="cell-frame-container"]');
        let backupChat = null;
        for (const el of chatList) {
            const txt = (el.textContent || '').toLowerCase();
            if (txt.includes((backupNameOrId || '').toLowerCase())) {
                backupChat = el;
                break;
            }
        }
        if (!backupChat) throw new Error('Conversa Backup não encontrada');
        backupChat.click();
        await window.WAPI._delay(800);

        // 2. Cola número na caixa de mensagem
        const compose = await window.WAPI._waitForComposeBox(5000);
        if (!compose) throw new Error('Composer não encontrado');
        window.WAPI._setInputText(compose, targetNumber);
        await window.WAPI._delay(300);
        await window.WAPI._pressEnterOnCompose();
        await window.WAPI._delay(800);

        // 3. Clica no número recém-colado (link)
        const msgLinks = Array.from(document.querySelectorAll('a[href^="/send?phone="]'));
        let link = null;
        for (const l of msgLinks) {
            if ((l.textContent || '').replace(/\D/g, '') === String(targetNumber).replace(/\D/g, '')) {
                link = l;
                break;
            }
        }
        if (!link) throw new Error('Link do número não encontrado na conversa Backup');
        link.click();
        await window.WAPI._delay(1200);

        // 4. Espera composer da nova conversa
        const newCompose = await window.WAPI._waitForComposeBox(7000);
        if (!newCompose) throw new Error('Composer da nova conversa não apareceu');

        // 5. Envia mensagem real
        window.WAPI._setInputText(newCompose, message);
        await window.WAPI._delay(300);
        await window.WAPI._pressEnterOnCompose();
        await window.WAPI._delay(600);
        return true;
    },
console.log('WAPI: Injection started (v5 - Smart Load & Extended Serialization)');

window.WAPI = {
    _inboundListener: null,
    _inboundListenerAttached: false,
    _lastChatOpen: null,
    _flow: {
        locked: false,
        state: 'idle',
        startedAt: 0,
        op: ''
    },

    postMessage: (payload) => {
        window.postMessage({ type: 'FROM_WAPI', payload: payload }, '*');
    },

    serializeContact: (c) => {
        return {
            id: c.id._serialized,
            server: c.id.server, // c.us, g.us, broadcast, lid
            name: c.name || c.pushname || c.formattedName,
            shortName: c.shortName,
            pushname: c.pushname,
            formattedName: c.formattedName,
            isBusiness: c.isBusiness,
            isMyContact: c.isMyContact,
            isWAContact: c.isWAContact,
            isEnterprise: c.isEnterprise,
            verifiedName: c.verifiedName,
            isUser: c.isUser,
            isGroup: c.isGroup,
            status: c.statusMute,
            avatar: c.profilePicThumbObj ? c.profilePicThumbObj.eurl : null
        };
    },

    listContacts: function (forceUpdate = false) {
        if (!window.Store || !window.Store.Contact) {
            console.error('WAPI: Store.Contact not found');
            return [];
        }

        // 1. Try to load from Cache first (unless forced)
        if (!forceUpdate) {
            const cached = localStorage.getItem('extracted_contacts');
            if (cached) {
                console.log('WAPI: Loading contacts from LocalStorage cache...');
                try {
                    const contacts = JSON.parse(cached);
                    console.log(`WAPI: Loaded ${contacts.length} cached contacts.`);
                    window.WAPI.postMessage({ type: 'CONTACTS_LIST', data: contacts, source: 'cache', agentId: window.WAPI.getMyId() });
                } catch (e) {
                    console.error('WAPI: Cache parse error', e);
                }
            }
        }

        console.log('WAPI: Extracting fresh contacts from Store...');
        // Different versions use .models or .getModelsArray()
        const models = window.Store.Contact.models || (window.Store.Contact.getModelsArray && window.Store.Contact.getModelsArray()) || [];

        // Serialize
        const contacts = models.map(c => window.WAPI.serializeContact(c));
        console.log(`WAPI: Found ${contacts.length} fresh contacts.`);

        // Determine if we should update cache
        const cachedStr = localStorage.getItem('extracted_contacts');
        const freshStr = JSON.stringify(contacts);

        if (cachedStr !== freshStr) {
            console.log('WAPI: Contacts changed. Updating LocalStorage and notifying Extension.');
            try {
                localStorage.setItem('extracted_contacts', freshStr);
                // Send "Fresh" list
                window.WAPI.postMessage({ type: 'CONTACTS_LIST', data: contacts, source: 'fresh', agentId: window.WAPI.getMyId() });
            } catch (e) {
                console.error('WAPI: Failed to save to localStorage', e);
            }
        } else {
            console.log('WAPI: No changes detected.');
            // If we loaded from cache already, no need to resend, 
            // BUT if we are here because of a force request, we might want to send it.
            if (forceUpdate || !cachedStr) {
                window.WAPI.postMessage({ type: 'CONTACTS_LIST', data: contacts, source: 'fresh_unchanged', agentId: window.WAPI.getMyId() });
            }
        }

        return contacts;
    },

    /**
     * Get the current user's ID (Serialized).
     * Used for Multi-tenancy to isolate data per account.
     */
    getMyId: function () {
        const asSerialized = (v) => {
            if (!v) return null;
            if (typeof v === 'string') return v;
            return (
                v._serialized ||
                v.id?._serialized ||
                v.wid?._serialized ||
                v.me?._serialized ||
                v.user?._serialized ||
                null
            );
        };

        const fromLocalStorage = () => {
            try {
                const keys = ['last-wid', 'last-wid-md', 'last-wid:md', 'last-wid:multi-device'];
                for (const k of keys) {
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    let v = raw;
                    try { v = JSON.parse(raw); } catch (e) { /* ignore */ }
                    if (typeof v === 'string') {
                        const s = v.replace(/^\"|\"$/g, '');
                        if (s.includes('@c.us') || s.includes('@g.us')) return s;
                        const d = s.replace(/\D/g, '');
                        if (d.length >= 8) return `${d}@c.us`;
                    }
                }
            } catch (e) { /* ignore */ }
            return null;
        };

        try {
            const userMod = window.Store && window.Store.User;
            const meUser = userMod && (userMod.getMeUser?.() || userMod.getMaybeMeUser?.() || userMod.getUser?.());
            const meUserId = asSerialized(meUser);
            if (meUserId) return meUserId;

            if (window.Store && window.Store.Me) {
                const me = window.Store.Me.attributes ? window.Store.Me.attributes.wid : window.Store.Me.wid;
                const meId = asSerialized(me);
                if (meId) return meId;
            }

            if (window.Store && window.Store.Conn) {
                const connId = asSerialized(window.Store.Conn.me) || asSerialized(window.Store.Conn.wid);
                if (connId) return connId;
            }

            const ls = fromLocalStorage();
            if (ls) return ls;
        } catch (e) {
            console.error('WAPI: Could not retrieve MyId', e);
        }
        return fromLocalStorage();
    },

    // ==================== DOM AUTOMATION HELPERS ====================

    /** Small delay helper */
    _delay: function (ms) {
        return new Promise(r => setTimeout(r, ms));
    },

    _waitForComposeBox: async function (timeoutMs = 6000) {
        const started = Date.now();
        while ((Date.now() - started) < timeoutMs) {
            const box = window.WAPI._getComposeBox();
            if (box) return box;
            await window.WAPI._delay(180);
        }
        return null;
    },

    _rememberChatOpen: function (expectedDigits, source, trustLevel = 'validated') {
        const exp = window.WAPI._digits(expectedDigits);
        if (!exp || exp.length < 8) return;
        window.WAPI._lastChatOpen = {
            expectedDigits: exp,
            source: source || 'unknown',
            trustLevel: trustLevel || 'validated',
            at: Date.now()
        };
    },

    _canTrustComposeFor: function (expectedDigits, maxAgeMs = 15000) {
        const exp = window.WAPI._digits(expectedDigits);
        const last = window.WAPI._lastChatOpen;
        if (!exp || !last || !last.expectedDigits) return false;
        if (last.expectedDigits !== exp) return false;
        if ((Date.now() - Number(last.at || 0)) > maxAgeMs) return false;
        return last.trustLevel === 'validated' || last.trustLevel === 'compose_only' || last.trustLevel === 'allow_mismatch';
    },

    _setFlowState: function (state, op = '') {
        window.WAPI._flow.state = state || 'idle';
        window.WAPI._flow.op = op || '';
        window.WAPI._flow.startedAt = Date.now();
    },

    _withFlowLock: async function (opName, runner) {
        if (window.WAPI._flow.locked) {
            throw new Error(`FLOW_BUSY current=${window.WAPI._flow.op || 'unknown'}`);
        }
        window.WAPI._flow.locked = true;
        window.WAPI._setFlowState('running', opName);
        try {
            const result = await runner();
            window.WAPI._setFlowState('done', opName);
            return result;
        } finally {
            window.WAPI._flow.locked = false;
            setTimeout(() => window.WAPI._setFlowState('idle', ''), 0);
        }
    },

    _setInputText: function (input, text) {
        if (!input) return;
        const next = String(text || '');
        input.focus();
        try { document.execCommand('selectAll', false); } catch (e) { }
        try { document.execCommand('delete', false); } catch (e) { }
        try { input.textContent = ''; } catch (e) { }
        try { input.innerHTML = ''; } catch (e) { }
        try { input.value = ''; } catch (e) { }

        let inserted = false;
        try {
            inserted = document.execCommand('insertText', false, next);
        } catch (e) {
            inserted = false;
        }
        if (!inserted) {
            try { input.textContent = next; } catch (e) { }
        }
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
    },

    _getComposeText: function (box) {
        const el = box || window.WAPI._getComposeBox();
        if (!el) return '';
        try {
            return String(el.innerText || el.textContent || '').trim();
        } catch (e) {
            return '';
        }
    },

    _pressEnterOnCompose: async function () {
        const box = window.WAPI._getComposeBox();
        if (!box) return false;
        try { box.focus(); } catch (e) { }
        const opts = { bubbles: true, cancelable: true };
        try { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ...opts })); } catch (e) { }
        try { box.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ...opts })); } catch (e) { }
        try { box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ...opts })); } catch (e) { }
        await window.WAPI._delay(220);
        return true;
    },

    /** Random delay between min and max ms */
    _randomDelay: function (min, max) {
        return this._delay(Math.floor(Math.random() * (max - min + 1)) + min);
    },

    _digits: function (value) {
        return String(value || '').replace(/\D/g, '');
    },

    _resolveJidFromStoreByDigits: function (numberDigits) {
        const target = window.WAPI._digits(numberDigits);
        if (!target || target.length < 8) return '';

        const candidates = [];
        const pushIfMatch = (jid) => {
            const asString = String(jid || '');
            if (!asString || !asString.includes('@c.us')) return;
            const jidDigits = window.WAPI._digits(asString);
            if (!jidDigits) return;
            if (jidDigits === target || jidDigits.endsWith(target) || target.endsWith(jidDigits)) {
                candidates.push(asString);
            }
        };

        try {
            const contacts = (window.Store && window.Store.Contact && window.Store.Contact.models) ? window.Store.Contact.models : [];
            for (const c of contacts) {
                pushIfMatch(c && c.id ? (c.id._serialized || c.id) : '');
            }
        } catch (e) { }

        try {
            const chats = (window.Store && window.Store.Chat && window.Store.Chat.models) ? window.Store.Chat.models : [];
            for (const chat of chats) {
                pushIfMatch(chat && chat.id ? (chat.id._serialized || chat.id) : '');
            }
        } catch (e) { }

        if (candidates.length === 0) return '';
        candidates.sort((a, b) => window.WAPI._digits(b).length - window.WAPI._digits(a).length);
        return candidates[0];
    },

    _detectInvalidNumberPage: function () {
        try {
            const t = (document.body && (document.body.innerText || document.body.textContent) || '').toLowerCase();
            if (!t) return false;
            return (
                t.includes('nÃ£o estÃ¡ no whatsapp') ||
                t.includes('nao esta no whatsapp') ||
                t.includes("isn't on whatsapp") ||
                t.includes('is not on whatsapp') ||
                t.includes('phone number shared via url is invalid') ||
                t.includes('nÃºmero de telefone compartilhado por url Ã© invÃ¡lido') ||
                t.includes('numero de telefone compartilhado por url e invalido') ||
                t.includes('invalid phone number') ||
                t.includes('nÃºmero invÃ¡lido') ||
                t.includes('numero invalido')
            );
        } catch (e) {
            return false;
        }
    },

    // Compatibility helper kept as public utility.
    _extractLikelyNumberDigits: function (text) {
        const s = String(text || '');
        const matches = s.match(/\d{8,}/g) || [];
        if (matches.length === 0) return '';
        matches.sort((a, b) => b.length - a.length);
        return matches[0];
    },

    _getMsgId: function (msg) {
        try {
            if (!msg || !msg.id) return '';
            // Different builds expose different shapes.
            if (typeof msg.id === 'string') return msg.id;
            if (msg.id._serialized) return msg.id._serialized;
            if (msg.id.id) return String(msg.id.id);
            // remote + id is usually stable enough for dedupe.
            const remote = msg.id.remote ? (msg.id.remote._serialized || msg.id.remote) : '';
            const inner = msg.id.id || msg.id.toString?.() || '';
            return `${remote}:${inner}`;
        } catch (e) {
            return '';
        }
    },

    _serializeMsgForHistory: function (msg) {
        if (!msg || !msg.id) return null;

        // Filter system/group events.
        if (msg.type === 'gp2' || msg.type === 'notification_template') return null;

        const contactId = msg.id.remote ? (msg.id.remote._serialized || msg.id.remote) : '';
        if (!contactId) return null;

        const text = msg.body || msg.caption || '';
        const timestamp = msg.t || msg.timestamp || 0;
        const fromMe = Boolean(msg.id.fromMe);

        return {
            waMessageId: window.WAPI._getMsgId(msg),
            contactId,
            text,
            timestamp,
            fromMe,
            author: msg.pushname || msg.notifyName || '',
            contactName: msg.pushname || msg.notifyName || '',
            direction: fromMe ? 'outbound' : 'inbound',
            status: fromMe ? 'sent' : 'received',
            messageType: msg.type || 'chat',
            mediaFilename: msg.filename || '',
            hasMedia: msg.type !== 'chat'
        };
    },

    _collectStoreMessagesForChat: function (chatId, sinceSec) {
        try {
            const models = (window.Store && window.Store.Msg && window.Store.Msg.models) ? window.Store.Msg.models : [];
            const out = [];
            for (const m of models) {
                if (!m || !m.id) continue;
                const remote = m.id.remote ? (m.id.remote._serialized || m.id.remote) : '';
                if (remote !== chatId) continue;
                const ts = m.t || 0;
                if (sinceSec && ts && ts < sinceSec) continue;
                const s = window.WAPI._serializeMsgForHistory(m);
                if (s) out.push(s);
            }
            out.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            return out;
        } catch (e) {
            return [];
        }
    },

    _getConversationPane: function () {
        // Best-effort selector set for WhatsApp Web message panel.
        return document.querySelector('[data-testid="conversation-panel-messages"]') ||
            document.querySelector('[data-testid="msg-container"]') ||
            document.querySelector('div[aria-label="Mensagem"]') ||
            document.querySelector('div[aria-label="Message list"]') ||
            document.querySelector('#main [tabindex="-1"]') ||
            document.querySelector('#main');
    },

    _scrollConversationUp: async function () {
        const pane = window.WAPI._getConversationPane();
        if (!pane) return false;

        // Scroll near top to trigger lazy-load older messages.
        pane.scrollTop = 0;
        pane.dispatchEvent(new Event('scroll', { bubbles: true }));
        await window.WAPI._randomDelay(650, 1400);
        return true;
    },

    /**
     * Backfill chat history by opening the chat and scrolling up to load older messages.
     * Returns messages in the last sinceDays window.
     */
    syncChatHistory: async function (chatId, sinceDays = 365, maxSteps = 6) {
        if (!chatId) throw new Error('Missing chatId');
        const sinceSec = Math.floor(Date.now() / 1000) - (Number(sinceDays) * 24 * 60 * 60);

        await window.WAPI.openChat(chatId);
        await window.WAPI._randomDelay(450, 1000);

        let lastCount = 0;
        let stableSteps = 0;
        let steps = 0;

        for (steps = 0; steps < Math.max(1, maxSteps); steps++) {
            const current = window.WAPI._collectStoreMessagesForChat(chatId, sinceSec);
            const count = current.length;
            if (count <= lastCount) stableSteps++;
            else stableSteps = 0;
            lastCount = count;

            // Stop if we're no longer loading new pages.
            if (stableSteps >= 2) break;

            // Scroll up to load older.
            const scrolled = await window.WAPI._scrollConversationUp();
            if (!scrolled) break;
        }

        const messages = window.WAPI._collectStoreMessagesForChat(chatId, sinceSec);
        const oldest = messages.length > 0 ? (messages[0].timestamp || 0) : 0;

        return {
            chatId,
            sinceDays,
            steps,
            messageCount: messages.length,
            oldestTimestamp: oldest,
            messages
        };
    },

    /**
     * Open a chat. Number is ALWAYS the primary search â€” name is just support.
     * NEVER reloads the page (would destroy WAPI).
     */
    openChat: async function (chatId, _contactNameIgnored, opts = {}) {
        const raw = typeof chatId === 'string' ? chatId : (chatId?._serialized || chatId?.id || '');
        const numberDigits = window.WAPI._digits(raw);
        if (numberDigits.length < 8) throw new Error('Invalid number (too short)');

        if (window.WAPI._validateActiveChat(numberDigits)) {
            window.WAPI._rememberChatOpen(numberDigits, 'fastpath', 'validated');
            return true;
        }

        const resolvedJid = window.WAPI._resolveJidFromStoreByDigits(numberDigits);
        const searchTerm = resolvedJid ? window.WAPI._digits(resolvedJid) : numberDigits;

        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { }
        await window.WAPI._delay(180);

        const found = await window.WAPI._trySearchAndOpen(searchTerm);
        if (found) {
            await window.WAPI._delay(300);
            if (window.WAPI._validateActiveChat(numberDigits)) {
                window.WAPI._rememberChatOpen(numberDigits, 'search', 'validated');
                return true;
            }
            if (window.WAPI._getComposeBox() && opts.allowMismatch) {
                window.WAPI._rememberChatOpen(numberDigits, 'search', 'allow_mismatch');
                return true;
            }
        }

        const opened = await window.WAPI._openNewConversation(numberDigits, { allowMismatch: Boolean(opts.allowMismatch) });
        if (opened) {
            if (window.WAPI._validateActiveChat(numberDigits)) {
                window.WAPI._rememberChatOpen(numberDigits, 'new_chat', 'validated');
                return true;
            }
            if (opts.allowMismatch && window.WAPI._getComposeBox()) {
                window.WAPI._rememberChatOpen(numberDigits, 'new_chat', 'allow_mismatch');
                return true;
            }
            const got = window.WAPI._digits(window.WAPI._getActiveChatJidFromDom()) || window.WAPI._getActiveHeaderNumberDigits();
            if (!got && window.WAPI._getComposeBox() && !window.WAPI._detectInvalidNumberPage()) {
                window.WAPI._rememberChatOpen(numberDigits, 'new_chat', 'compose_only');
                return true;
            }
            throw new Error(`CHAT_MISMATCH expected=${numberDigits} got=${got || ''}`);
        }

        // Final fallback only when number search + DOM new-chat fail.
        let linkOk = false;
        try {
            linkOk = await window.WAPI.openDirectLink(numberDigits, { allowMismatch: Boolean(opts.allowMismatch) });
        } catch (e) {
            // Some WA builds open the target chat but compose detection lags.
            if (window.WAPI._validateActiveChat(numberDigits)) {
                window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'validated');
                return true;
            }
            throw e;
        }
        if (linkOk) {
            if (window.WAPI._validateActiveChat(numberDigits)) {
                window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'validated');
                return true;
            }
            if (opts.allowMismatch && window.WAPI._getComposeBox()) {
                window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'allow_mismatch');
                return true;
            }
            const got = window.WAPI._digits(window.WAPI._getActiveChatJidFromDom()) || window.WAPI._getActiveHeaderNumberDigits();
            if (!got && window.WAPI._getComposeBox() && !window.WAPI._detectInvalidNumberPage()) {
                window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'compose_only');
                return true;
            }
            throw new Error(`CHAT_MISMATCH expected=${numberDigits} got=${got || ''}`);
        }

        throw new Error('Could not open chat for: ' + numberDigits);
    },

    _getActiveHeaderNumberDigits: function () {
        try {
            const header = document.querySelector('#main header') || document.querySelector('header');
            if (!header) return '';
            // Prefer title attributes (often contain phone/name)
            const titleEl = header.querySelector('span[title]') || header.querySelector('[title]');
            const raw = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : (header.textContent || '');
            return window.WAPI._digits(raw);
        } catch (e) {
            return '';
        }
    },

    _validateActiveChatNumber: function (expectedDigits) {
        const exp = window.WAPI._digits(expectedDigits);
        const got = window.WAPI._getActiveHeaderNumberDigits();
        if (!exp || exp.length < 8) return true; // nothing to validate
        if (!got) return false;

        // Accept +55 vs no + / with country code variants.
        if (got.endsWith(exp) || exp.endsWith(got)) return true;

        return false;
    },

    _getActiveChatJidFromDom: function () {
        try {
            const main = document.querySelector('#main');
            if (!main) return '';

            const el = main.querySelector('[data-id*="@c.us"], [data-id*="@g.us"]') ||
                main.querySelector('header [data-id]') ||
                main.querySelector('[data-id]');
            if (!el) return '';

            const raw = el.getAttribute('data-id') || '';
            const m = raw.match(/([0-9]+@c\.us|[0-9]+@g\.us)/);
            return m ? m[1] : '';
        } catch (e) {
            return '';
        }
    },

    _validateActiveChat: function (expectedChatIdOrDigits) {
        const exp = window.WAPI._digits(expectedChatIdOrDigits);
        if (!exp || exp.length < 8) return true;

        const activeJid = window.WAPI._getActiveChatJidFromDom();
        if (activeJid) {
            const got = window.WAPI._digits(activeJid);
            if (!got) return false;
            return got === exp || got.endsWith(exp) || exp.endsWith(got);
        }

        return window.WAPI._validateActiveChatNumber(exp);
    },

    /**
     * Simulate a realistic mouse click on an element.
     * simplified to avoid "multiple UIM tree roots" error in React
     */
    _simulateClick: function (element) {
        if (!element) return;
        try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { }
        // Prefer native click to avoid duplicate synthetic event chains on WA React/UIM.
        try {
            element.click();
            return;
        } catch (e) { }
        try { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e) { }
    },

    /**
     * Search for a term in WhatsApp's sidebar search and open the result.
     * Returns true if chat opened successfully.
     */
    _trySearchAndOpen: async function (searchTerm) {
        const term = String(searchTerm || '').trim();
        if (!term) return false;
        const openSearchBtn = document.querySelector('span[data-icon="search"]') ||
            document.querySelector('[data-testid="chat-list-search"]') ||
            document.querySelector('button[aria-label="Search"]') ||
            document.querySelector('button[aria-label="Pesquisar"]');
        if (openSearchBtn) {
            window.WAPI._simulateClick(openSearchBtn.closest('button') || openSearchBtn);
            await this._delay(250);
        }
        const input = document.querySelector('[data-testid="chat-list-search"] div[contenteditable="true"]') ||
            document.querySelector('[data-testid="chat-list-search"] [role="textbox"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
            document.querySelector('div[role="textbox"][data-tab="3"]') ||
            document.querySelector('div[contenteditable="true"][data-tab="4"]') ||
            document.querySelector('div[role="textbox"][data-tab="4"]') ||
            document.querySelector('header [contenteditable="true"][role="textbox"]');
        if (!input) return false;
        window.WAPI._setInputText(input, term);
        await this._delay(800);
        const termDigits = window.WAPI._digits(term);
        const rows = Array.from(document.querySelectorAll('[data-testid="cell-frame-container"], [role="listitem"], [data-testid="list-item"], #pane-side [role="row"]')).slice(0, 20);
        let target = null;
        for (const row of rows) {
            const text = row.textContent || '';
            const digits = window.WAPI._digits(text);
            if (termDigits && digits && (digits.includes(termDigits) || termDigits.includes(digits))) {
                target = row;
                break;
            }
        }
        if (target) {
            window.WAPI._simulateClick(target.closest('[role="button"]') || target);
            await this._delay(500);
            if (window.WAPI._getComposeBox()) return true;
        }

        // Some builds open the first matching search result on Enter.
        try {
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
        } catch (e) { }
        await this._delay(600);
        if (window.WAPI._getComposeBox()) return true;
        return false;
    },

    /**
     * Open new conversation with an unknown number.
     * Uses WhatsApp's "New Chat" flow â†’ types the phone number directly.
     */
    _openNewConversation: async function (number, opts = {}) {
        const numberDigits = window.WAPI._digits(number);
        if (numberDigits.length < 8) return false;

        // Native "new chat" drawer flow (DOM only).
        try {
            const newBtn = document.querySelector('button[aria-label="Nova conversa"]') ||
                document.querySelector('button[aria-label="New chat"]') ||
                document.querySelector('[data-testid="new-chat-button"]') ||
                document.querySelector('[data-testid="new-chat"]') ||
                document.querySelector('span[data-icon="new-chat-outline"]') ||
                document.querySelector('span[data-icon="plus"]');

            if (!newBtn) return false;
            window.WAPI._simulateClick(newBtn.closest('button') || newBtn);
            await window.WAPI._delay(320);

            const input = document.querySelector('[role="dialog"] [contenteditable="true"]') ||
                document.querySelector('[role="dialog"] [role="textbox"][contenteditable="true"]') ||
                document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
                document.querySelector('div[role="textbox"][data-tab="3"]') ||
                document.querySelector('div[contenteditable="true"][data-tab="4"]') ||
                document.querySelector('div[role="textbox"][data-tab="4"]');

            if (!input) return false;

            window.WAPI._setInputText(input, `+${numberDigits}`);
            await window.WAPI._delay(650);

            // Click result that matches the same number.
            const candidates = Array.from(document.querySelectorAll('[role="dialog"] [role="listitem"], [role="dialog"] [data-testid="cell-frame-container"], [role="dialog"] [data-testid="list-item"]')).slice(0, 20);
            let match = null;
            for (const el of candidates) {
                const t = el.textContent || '';
                const d = window.WAPI._digits(t);
                if (d && (d.includes(numberDigits) || numberDigits.includes(d))) {
                    match = el;
                    break;
                }
            }

            if (match) {
                window.WAPI._simulateClick(match.closest('[role="button"]') || match);
                await window.WAPI._delay(650);
                if (window.WAPI._getComposeBox()) return true;
            }

            // Last resort: Enter after numeric search.
            try {
                input.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                }));
            } catch (e) { }
            await window.WAPI._delay(650);
            if (window.WAPI._getComposeBox()) return true;
        } catch (e) {
            return false;
        }
        return false;
    },

    /**
     * Get the compose box (message input) â€” the real contenteditable div
     */
    _getComposeBox: function () {
        const main = document.querySelector('#main') || document;
        const footer = main.querySelector('footer');
        if (!footer) return null;

        const byPriority =
            footer.querySelector('[data-testid="conversation-compose-box-input"][contenteditable="true"]') ||
            footer.querySelector('[data-testid="conversation-compose-box-input"] [contenteditable="true"]') ||
            footer.querySelector('div[data-testid="conversation-compose-box-input"]') ||
            footer.querySelector('div[contenteditable="true"][data-tab="10"]') ||
            footer.querySelector('div[role="textbox"][data-tab="10"]') ||
            footer.querySelector('div[contenteditable="true"][title="Type a message"]') ||
            footer.querySelector('div[contenteditable="true"][title="Digite uma mensagem"]') ||
            footer.querySelector('div[contenteditable="true"][aria-label="Type a message"]') ||
            footer.querySelector('div[contenteditable="true"][aria-label="Digite uma mensagem"]');
        if (byPriority) return byPriority;

        const candidates = Array.from(footer.querySelectorAll('div[contenteditable="true"]'));
        const visible = candidates.filter((el) => {
            try {
                return (el.offsetParent !== null) || (el.getClientRects && el.getClientRects().length > 0);
            } catch (e) {
                return true;
            }
        });
        if (visible.length === 0) return null;
        return visible[visible.length - 1];
    },

    _dumpDomDiagnostics: function () {
        const safeText = (el) => {
            if (!el) return '';
            const t = (el.textContent || '').trim();
            return t.length > 160 ? (t.slice(0, 160) + '...') : t;
        };

        const ce = Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"][contenteditable="true"]'));
        const ceTabs = {};
        for (const el of ce) {
            const k = String(el.dataset && el.dataset.tab ? el.dataset.tab : '');
            ceTabs[k || '(no data-tab)'] = (ceTabs[k || '(no data-tab)'] || 0) + 1;
        }

        const pane = document.querySelector('#pane-side') ||
            document.querySelector('div[aria-label="Chat list"]') ||
            document.querySelector('div[aria-label="Lista de conversas"]') ||
            null;

        const header = document.querySelector('#main header') || document.querySelector('#main [role="banner"]') || null;
        const headerTitle = header ? (header.querySelector('[title]')?.getAttribute('title') || '') : '';

        const buttons = Array.from(document.querySelectorAll('button[aria-label], div[role="button"][aria-label]')).slice(0, 80);
        const ariaSamples = buttons.map(b => (b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 40);

        return {
            href: location.href,
            readyState: document.readyState,
            hasPaneSide: Boolean(pane),
            hasMain: Boolean(document.querySelector('#main')),
            contentEditableCount: ce.length,
            contentEditableTabs: ceTabs,
            searchIcon: Boolean(document.querySelector('span[data-icon="search"]')),
            backIcon: Boolean(document.querySelector('span[data-icon="back"], span[data-icon="x"]')),
            newChatTestIds: Array.from(document.querySelectorAll('[data-testid*="new-chat"]')).slice(0, 10).map(el => el.getAttribute('data-testid')),
            headerText: safeText(header),
            headerTitle: headerTitle,
            activeChatJid: window.WAPI._getActiveChatJidFromDom(),
            activeHeaderDigits: window.WAPI._getActiveHeaderNumberDigits(),
            composeBox: Boolean(window.WAPI._getComposeBox()),
            ariaLabelSamples: ariaSamples
        };
    },

    diagOpenChat: async function (chatId, opts = {}) {
        const before = window.WAPI._dumpDomDiagnostics();
        const res = {
            ok: false,
            error: '',
            before,
            after: null
        };

        try {
            const ok = await window.WAPI.openChat(chatId, '', { allowMismatch: Boolean(opts.allowMismatch) });
            res.ok = Boolean(ok);
        } catch (e) {
            res.ok = false;
            res.error = e && e.message ? e.message : String(e);
        }

        // Small settle time for the DOM to update post-navigation.
        try { await window.WAPI._delay(350); } catch (e) { }
        res.after = window.WAPI._dumpDomDiagnostics();
        return res;
    },

    /**
     * Open /send?phone=... inside the current WhatsApp SPA context
     * without forcing a hard browser-level tab reload.
     */
    openDirectLink: async function (chatId, opts = {}) {
        const chatIdStr = typeof chatId === 'string' ? chatId : (chatId?._serialized || chatId?.id || '');
        const numberDigits = window.WAPI._digits(chatIdStr);
        if (numberDigits.length < 8) throw new Error('Invalid number (too short)');

        const href = `/send?phone=${numberDigits}`;
        console.log('WAPI: [DirectLink] Opening silently:', href);

        const waitForReady = async (timeoutMs = 9000) => {
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                if (window.WAPI._detectInvalidNumberPage()) {
                    throw new Error(`NUMBER_NOT_ON_WHATSAPP ${numberDigits}`);
                }

                const compose = window.WAPI._getComposeBox();
                if (compose) {
                    if (window.WAPI._validateActiveChat(numberDigits)) {
                        window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'validated');
                        return true;
                    }
                    if (opts.allowMismatch) {
                        window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'allow_mismatch');
                        return true;
                    }
                    const got = window.WAPI._digits(window.WAPI._getActiveChatJidFromDom()) || window.WAPI._getActiveHeaderNumberDigits();
                    if (!got && !window.WAPI._detectInvalidNumberPage()) {
                        console.warn('WAPI: [DirectLink] Compose available without resolvable chat id; proceeding for unsaved number.');
                        window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'compose_only');
                        return true;
                    }
                    throw new Error(`CHAT_MISMATCH expected=${numberDigits} got=${got || ''}`);
                }

                if (window.WAPI._validateActiveChat(numberDigits)) {
                    window.WAPI._rememberChatOpen(numberDigits, 'direct_link', 'validated');
                    return true;
                }
                await window.WAPI._delay(250);
            }
            return false;
        };

        // SPA-only strategy: use History API to avoid hard reload/navigation.
        try {
            history.pushState({}, '', href);
        } catch (e) {
            throw new Error('Direct-link SPA navigation failed');
        }

        if (await waitForReady(9000)) return true;
        throw new Error('Could not open chat via direct link');
    },

    /**
     * Type text into the compose box using trusted events (execCommand)
     * Simulation: Character by character with random delays (Human-like)
     */
    _typeInComposeBox: async function (text) {
        const box = await this._waitForComposeBox(7000);
        if (!box) throw new Error('Compose box not found');
        window.WAPI._setInputText(box, String(text || ''));
        await this._delay(100);

        // Fallback for WA builds that ignore the first input strategy.
        const expected = String(text || '').trim();
        const got = window.WAPI._getComposeText(box);
        if (expected && !got) {
            try {
                box.focus();
                document.execCommand('insertText', false, expected);
                box.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (e) { }
            await this._delay(80);
        }
        return true;
    },

    /** Click the send button */
    _clickSend: async function () {
        const footer = document.querySelector('#main footer') || document.querySelector('footer') || document;
        const beforeText = window.WAPI._getComposeText();

        const selectors = [
            'button[aria-label="Send"]',
            'button[aria-label="Enviar"]',
            'div[role="button"][aria-label="Send"]',
            'div[role="button"][aria-label="Enviar"]',
            '[data-testid="compose-btn-send"]',
            '[data-testid="send"]',
            'span[data-icon="send"]',
            'span[data-icon*="send"]'
        ];

        let btn = null;
        for (const sel of selectors) {
            const found = footer.querySelector(sel) || document.querySelector(sel);
            if (!found) continue;
            btn = found.closest('button') || found.closest('div[role="button"]') || found;
            if (btn) break;
        }

        if (btn) {
            console.log('WAPI: Clicking Send Button...', btn);
            window.WAPI._simulateClick(btn);
            await this._delay(260);
        } else {
            console.warn('WAPI: Send button not found, trying Enter fallback.');
        }

        // If compose still has text, force Enter fallback.
        const afterClickText = window.WAPI._getComposeText();
        if (afterClickText && beforeText && afterClickText === beforeText) {
            await window.WAPI._pressEnterOnCompose();
        } else if (!btn && afterClickText) {
            await window.WAPI._pressEnterOnCompose();
        }

        return true;
    },

    // ==================== PUBLIC SEND METHODS ====================

    /**
     * Send a text message using real WhatsApp Web UI
     * Flow: Open chat â†’ Type message â†’ Click send
     */
    sendTextMessage: async function (chatId, text, opts = {}) {
        return window.WAPI._withFlowLock('sendTextMessage', async () => {
            const expected = window.WAPI._digits(typeof chatId === 'string' ? chatId : (chatId?._serialized || ''));
            if (!opts.skipOpenChat) {
                try {
                    await window.WAPI.openChat(chatId, '', { allowMismatch: Boolean(opts.allowMismatch) });
                } catch (e) {
                    // Se não conseguir validar, mas o compose está disponível, prosseguir mesmo assim
                    if (!expected || (!window.WAPI._validateActiveChat(expected) && !window.WAPI._getComposeBox())) throw e;
                    window.WAPI._rememberChatOpen(expected, 'send_text_open_recovery', 'compose_only');
                }
                await window.WAPI._delay(220);
            }
            const gotJid = window.WAPI._getActiveChatJidFromDom();
            const gotHeader = window.WAPI._getActiveHeaderNumberDigits();
            const got = window.WAPI._digits(gotJid) || gotHeader;
            if (!opts.allowMismatch && expected && expected.length >= 8 && (!got || (got !== expected && !got.endsWith(expected) && !expected.endsWith(got)))) {
                const canTrustCompose = !got && window.WAPI._canTrustComposeFor(expected) && window.WAPI._getComposeBox() && !window.WAPI._detectInvalidNumberPage();
                // Permitir envio se o compose estiver disponível, mesmo sem validação do chat
                if (!canTrustCompose && !window.WAPI._getComposeBox()) {
                    throw new Error(`CHAT_MISMATCH expected=${expected} got=${got || ''}`);
                }
            }
            if (expected && expected.length >= 8 && got && (got === expected || got.endsWith(expected) || expected.endsWith(got))) {
                window.WAPI._rememberChatOpen(expected, 'send_text_validate', 'validated');
            } else if (expected && expected.length >= 8 && !got && window.WAPI._canTrustComposeFor(expected)) {
                window.WAPI._rememberChatOpen(expected, 'send_text_validate', 'compose_only');
            }
            const expectedText = String(text || '').trim();
            await window.WAPI._typeInComposeBox(expectedText);
            await window.WAPI._delay(120);
            await window.WAPI._clickSend();

            // Confirm send by checking composer clear state; avoid false-positive success.
            await window.WAPI._delay(220);
            const remains = window.WAPI._getComposeText();
            if (expectedText && remains && remains === expectedText) {
                await window.WAPI._pressEnterOnCompose();
                await window.WAPI._delay(220);
                const afterRetry = window.WAPI._getComposeText();
                if (afterRetry && afterRetry === expectedText) {
                    throw new Error('SEND_NOT_CONFIRMED compose_not_cleared');
                }
            }
            return { success: true };
        });
    },

    /**
     * Send media using real WhatsApp Web UI
     * Flow: Open chat â†’ Click attach â†’ Inject file â†’ Add caption â†’ Click send
     */
    sendMediaMessage: async function (chatId, base64Data, filename, caption, mimetype, skipOpenChat = false) {
        return window.WAPI._withFlowLock('sendMediaMessage', async () => {
            try {
                // 1. Navigate to the chat (unless skipped)
                if (!skipOpenChat) {
                    console.log('WAPI: [Media] Opening chat for', chatId);
                    await window.WAPI.openChat(chatId);
                    await window.WAPI._delay(300);
                } else {
                    console.log('WAPI: [Media] Skipping openChat (assumed open)');
                    await window.WAPI._delay(120);
                }
                // 2. Click the attachment button (+)
                const attachSelectors = [
                    'span[data-icon="plus"]',
                    'span[data-icon="clip"]',
                    'span[data-icon="attach-menu-plus"]',
                    'span[data-icon="attach"]',
                    '[data-testid="attach-menu-plus"]',
                    '[data-testid="clip"]',
                    '[data-testid="attach"]',
                    'button[aria-label="Attach"]',
                    'button[aria-label="Anexar"]',
                    'button[aria-label="Adjuntar"]',
                    'div[title="Attach"]',
                    'div[title="Anexar"]',
                    'div[aria-label="Attach"]',
                    'div[aria-label="Anexar"]',
                ];
                let attachBtn = null;
                for (const sel of attachSelectors) {
                    attachBtn = document.querySelector(sel);
                    if (attachBtn) break;
                }
                if (!attachBtn) {
                    const footer = document.querySelector('footer') ||
                        document.querySelector('[data-testid="conversation-compose-box-input"]')?.closest('div[class]')?.parentElement;
                    if (footer) {
                        const skipIcons = ['send', 'emoji', 'mic', 'ptt', 'smiley'];
                        const candidates = footer.querySelectorAll('span[data-icon], [data-testid]');
                        for (const el of candidates) {
                            const icon = el.getAttribute('data-icon') || el.getAttribute('data-testid') || '';
                            if (!skipIcons.some(s => icon.includes(s))) {
                                attachBtn = el;
                                break;
                            }
                        }
                    }
                }
                if (!attachBtn) throw new Error('Attachment button not found');
                const clickTarget = attachBtn.closest('button') || attachBtn.closest('div[role="button"]') || attachBtn;
                window.WAPI._simulateClick(clickTarget);
                await window.WAPI._delay(500);
                // 3. Convert base64 to File
                const arr = base64Data.split(',');
                const mime = arr[0].match(/:(.*?);/)?.[1] || mimetype;
                const bstr = atob(arr.length > 1 ? arr[1] : arr[0]);
                const u8arr = new Uint8Array(bstr.length);
                for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
                const file = new File([u8arr], filename, { type: mime });
                // 4. Find file input and inject
                let fileInput = null;
                const inputSelectors = [
                    'input[accept="image/*,video/mp4,video/3gpp,video/quicktime"]',
                    'input[type="file"][accept*="image"]',
                    'input[type="file"][accept*="video"]',
                    'input[accept="*"]',
                    'input[type="file"]',
                ];
                for (const sel of inputSelectors) {
                    const inputs = document.querySelectorAll(sel);
                    if (inputs.length > 0) {
                        fileInput = inputs[inputs.length - 1];
                        break;
                    }
                }
                if (!fileInput) throw new Error('File input not found');
                const dt = new DataTransfer();
                dt.items.add(file);
                fileInput.files = dt.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                await window.WAPI._delay(1200);
                // 5. Caption (optional)
                if (caption && caption.trim()) {
                    const captionBox = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                        document.querySelector('div[role="textbox"][data-tab="10"]') ||
                        document.querySelector('div[contenteditable="true"][spellcheck="true"]') ||
                        document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
                        document.querySelector('div[contenteditable="true"][data-tab="7"]');
                    if (captionBox) {
                        captionBox.focus();
                        document.execCommand('insertText', false, caption);
                        await window.WAPI._delay(100);
                    }
                }
                // 6. Send
                const mediaSend = document.querySelector('span[data-icon="send"]') ||
                    document.querySelector('[data-testid="send"]') ||
                    document.querySelector('div[role="button"][aria-label="Send"]') ||
                    document.querySelector('div[role="button"][aria-label="Enviar"]');
                if (!mediaSend) throw new Error('Media send button not found');
                const sendTarget = mediaSend.closest('button') || mediaSend.closest('div[role="button"]') || mediaSend;
                window.WAPI._simulateClick(sendTarget);
                await window.WAPI._delay(250);
                return { success: true };
            } catch (e) {
                try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (x) { }
                throw e;
            }
        });
    },

    /**
     * Simulate typing â€” just focus the compose box and type a few chars then delete
     */
    simulateTyping: async function () {
        try {
            let box = window.WAPI._getComposeBox();
            if (!box) return { success: true, skipped: true, reason: 'compose_not_open' };

            if (box) {
                box.focus();
                // Type short random chars and then delete to trigger realistic typing.
                const seed = Math.random().toString(36).slice(2, 5);
                document.execCommand('insertText', false, seed);
                await window.WAPI._randomDelay(280, 1100);
                for (let i = 0; i < seed.length; i++) {
                    document.execCommand('delete', false);
                    await window.WAPI._randomDelay(40, 130);
                }
            }
            console.log('WAPI: Simulated typing via DOM');
            return { success: true };
        } catch (e) {
            console.warn('WAPI: simulateTyping failed:', e);
            return { success: false };
        }
    },

    /**
     * Simulate presence â€” just scroll the chat list slightly
     */
    simulatePresence: function () {
        try {
            const pane = document.querySelector('#pane-side') ||
                document.querySelector('div[aria-label="Chat list"]') ||
                document.querySelector('div[aria-label="Lista de conversas"]');
            if (pane) {
                // Small scroll to simulate activity
                pane.scrollTop += Math.floor(Math.random() * 100) - 50;
            }
            console.log('WAPI: Simulated presence via DOM scroll');
            return { success: true };
        } catch (e) {
            console.warn('WAPI: simulatePresence failed:', e);
            return { success: false };
        }
    }
};

/**
 * Append Inbound Listener
 * This must be after window.WAPI definition
 */
window.WAPI.enableInboundListener = function () {
    if (!window.Store || !window.Store.Msg) {
        console.error('WAPI: Store.Msg not found. Cannot enable inbound listener.');
        return;
    }

    console.log('WAPI: Enabling Inbound Message Listener...');

    // Remove existing listener to avoid duplicates
    if (this._inboundListener) {
        try { window.Store.Msg.off('add', this._inboundListener); } catch (e) { }
    }

    this._inboundListener = (msg) => {
        // Filter: Must be new, incoming, and not a system message
        if (!msg.isNewMsg && !msg.isUnreadType) return; // sometimes isUnreadType is safer
        if (msg.id.fromMe) return;
        if (msg.type === 'gp2') return; // Group notification

        const content = msg.body || msg.caption || (msg.type !== 'chat' ? `[${msg.type.toUpperCase()}]` : '');
        const sender = msg.from; // e.g. 5511999999999@c.us
        const senderName = msg.senderObj ? (msg.senderObj.pushname || msg.senderObj.formattedName) : '';

        console.log('WAPI: ðŸ“© Inbound Message from', sender, ':', content);

        // Dispatch to Content Script -> Background
        // Use a format that Background understands directly
        window.postMessage({
            type: 'FROM_WAPI',
            payload: {
                type: 'INBOUND_MESSAGE',
                data: {
                    contactId: sender && sender._serialized ? sender._serialized : sender,
                    text: content,
                    timestamp: msg.t,
                    fromMe: false,
                    author: senderName,
                    messageType: msg.type,
                    mediaFilename: msg.filename || '',
                    hasMedia: msg.type !== 'chat'
                }
            }
        }, '*');
    };

    try {
        window.Store.Msg.on('add', this._inboundListener);
        console.log('WAPI: âœ… Inbound Listener Active');
    } catch (e) {
        console.error('WAPI: Failed to attach listener', e);
    }
};

/**
 * Universal Module Finder
 */
function initializeWAPI() {
    console.log('WAPI: Initializing methods...');

    const findModule = (filter) => {
        // Strategy A: Standard Webpack
        if (window.webpackRequire && window.webpackRequire.m) {
            for (let id in window.webpackRequire.m) {
                try {
                    let mod = window.webpackRequire(id);
                    if (mod && filter(mod)) return mod;
                    if (mod && mod.default && filter(mod.default)) return mod.default;
                } catch (e) { }
            }
        }

        // Strategy B: Meta/Debug Modules Map
        if (window.require && window.require("__debug") && window.require("__debug").modulesMap) {
            const modulesMap = window.require("__debug").modulesMap;
            const moduleIds = Object.keys(modulesMap).filter(id => /^(?:use)?WA/.test(id));

            for (let id of moduleIds) {
                try {
                    let mod = window.importNamespace ? window.importNamespace(id) : window.require(id);
                    if (mod && filter(mod)) return mod;
                    if (mod && mod.default && filter(mod.default)) return mod.default;
                } catch (e) { }
            }
        }
        return null;
    };

    const signature = (mod) => (mod.Chat && mod.Contact && mod.Msg) || (mod.ChatStore && mod.ContactStore);
    let Store = findModule(signature);

    if (!Store) {
        console.log('WAPI: Standard Store search failed. Assembling individually...');
        Store = {};
        const Contact = findModule(mod => (mod.Contact && mod.Contact.models) || (mod.ContactStore));
        if (Contact) Store.Contact = Contact.Contact || Contact.ContactStore;

        const Chat = findModule(mod => (mod.Chat && mod.Chat.models) || (mod.ChatStore));
        if (Chat) Store.Chat = Chat.Chat || Chat.ChatStore;

        const Msg = findModule(mod => (mod.Msg && mod.Msg.models) || (mod.MsgStore));
        if (Msg) Store.Msg = Msg.Msg || Msg.MsgStore;

        // Best-effort: these modules are optional but useful for identifying the active account.
        const User = findModule(mod =>
            (mod.User && (mod.User.getMeUser || mod.User.getMaybeMeUser)) ||
            (mod.getMeUser && typeof mod.getMeUser === 'function')
        );
        if (User) Store.User = User.User || User;

        const Me = findModule(mod => mod.Me && (mod.Me.wid || mod.Me.attributes));
        if (Me) Store.Me = Me.Me || Me;

        const Conn = findModule(mod => mod.Conn && (mod.Conn.me || mod.Conn.wid));
        if (Conn) Store.Conn = Conn.Conn || Conn;
    }

    if (Store && Store.Contact) {
        console.log('WAPI: Store module found/assembled!', Store);
        window.Store = Store;
        window.WAPI.postMessage({ type: 'WAPI_READY', status: 'ready', agentId: window.WAPI.getMyId() });

        // Auto-extract on load to solve race conditions with injection
        console.log('WAPI: Performing initial auto-extraction...');
        setTimeout(() => window.WAPI.listContacts(), 500);

        // Attach dedicated inbound listener once.
        if (Store.Msg && window.WAPI.enableInboundListener && !window.WAPI._inboundListenerAttached) {
            window.WAPI.enableInboundListener();
            window.WAPI._inboundListenerAttached = true;
        }

        // Capture outbound messages only for history events.
        // Inbound is handled by enableInboundListener above.
        if (Store.Msg) {
            Store.Msg.on('add', (msg) => {
                if (!msg || !msg.isNewMsg || !msg.id) return;

                const isFromMe = Boolean(msg.id.fromMe);
                if (!isFromMe) return;

                const payload = {
                    type: 'OUTBOUND_MESSAGE',
                    data: {
                        contactId: msg.id.remote,
                        text: msg.body || msg.caption || '',
                        timestamp: msg.t,
                        fromMe: true,
                        author: msg.pushname || msg.notifyName,
                        messageType: msg.type,
                        mediaFilename: msg.filename || '',
                        hasMedia: msg.type !== 'chat'
                    }
                };

                console.log('WAPI: New Message Event:', payload.type, payload.data.contactId);
                window.postMessage({ type: 'FROM_WAPI', payload }, '*');
            });
        }

        // Retry agent ID broadcast in case WA internals are still warming up.
        setTimeout(() => {
            const retryAgentId = window.WAPI.getMyId();
            if (retryAgentId) {
                window.WAPI.postMessage({ type: 'WAPI_READY', status: 'ready_retry', agentId: retryAgentId });
            }
        }, 3000);

    } else {
        console.warn('WAPI: Store NOT found.');
    }
}

function start() {
    console.log('WAPI: Bootstrapping...');
    // 1. Webpack Chunk Hook
    if (window.webpackChunkwhatsapp_web_client) {
        window.webpackChunkwhatsapp_web_client.push([
            [Date.now()], {},
            function (e) { window.webpackRequire = e; initializeWAPI(); }
        ]);
    }
    // 2. Poll for Meta Loader
    setTimeout(() => {
        if (window.Store) return;
        if (typeof window.importNamespace === 'function') {
            window.webpackRequire = window.importNamespace;
            initializeWAPI();
        } else if (typeof window.require === 'function') {
            window.webpackRequire = window.require;
            initializeWAPI();
        }
    }, 2000);
}

start();

// Listen for commands from extension
window.addEventListener('message', async function (event) {
    if (!event || !event.data || event.data.type !== 'FROM_EXTENSION') return;

    const cmd = event.data.command;
    console.log('WAPI: Received command:', cmd);

    // Get Contacts
    if (cmd === 'getContacts') {
        try {
            if (!window.Store || !window.Store.Contact) {
                throw new Error('WAPI_NOT_READY');
            }
            const force = event.data.force || false;
            const contacts = window.WAPI.listContacts(force);
            // Also respond to the original chrome.tabs.sendMessage caller.
            window.WAPI.postMessage({
                type: 'COMMAND_RESULT',
                command: cmd,
                _cmdId: event.data._cmdId,
                result: { success: true, contacts }
            });
        } catch (e) {
            window.WAPI.postMessage({
                type: 'COMMAND_RESULT',
                command: cmd,
                _cmdId: event.data._cmdId,
                error: e && e.message ? e.message : String(e)
            });
        }
        return;
    }

    // Send Text Message (DOM Automation)
    if (cmd === 'sendMessage') {
        try {
            const result = await window.WAPI.sendTextMessage(
                event.data.chatId,
                event.data.text,
                { allowMismatch: Boolean(event.data.allowMismatch), skipOpenChat: Boolean(event.data.skipOpenChat) }
            );
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result: result });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e.message });
        }
        return;
    }

    // Open direct-link silently inside current tab/app context.
    if (cmd === 'openDirectLink') {
        try {
            const ok = await window.WAPI.openDirectLink(
                event.data.chatId,
                { allowMismatch: Boolean(event.data.allowMismatch) }
            );
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result: { success: true, ok } });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e.message });
        }
        return;
    }

    // Open Chat (DOM Automation, no sending)
    if (cmd === 'openChat') {
        try {
            const ok = await window.WAPI.openChat(
                event.data.chatId,
                '',
                { allowMismatch: Boolean(event.data.allowMismatch) }
            );
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result: { success: true, ok } });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e.message });
        }
        return;
    }

    // Diagnostics: run openChat + return before/after selector dump (real WA DOM).
    if (cmd === 'diagOpenChat') {
        try {
            const result = await window.WAPI.diagOpenChat(
                event.data.chatId,
                { allowMismatch: Boolean(event.data.allowMismatch) }
            );
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e.message });
        }
        return;
    }

    // Sync Chat History (Backfill)
    if (cmd === 'syncChatHistory') {
        try {
            const result = await window.WAPI.syncChatHistory(
                event.data.chatId,
                event.data.sinceDays || 365,
                event.data.maxSteps || 6
            );
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e.message });
        }
        return;
    }

    // Send Media (DOM Automation)
    if (cmd === 'sendMedia') {
        try {
            const result = await window.WAPI.sendMediaMessage(
                event.data.chatId,
                event.data.base64,
                event.data.filename,
                event.data.caption,
                event.data.mimetype,
                event.data.skipOpenChat // New flag
            );
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result: result });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e.message });
        }
        return;
    }

    // Simulate Typing (DOM â€” focus + type/delete in compose box)
    if (cmd === 'simulateTyping') {
        try {
            const result = await window.WAPI.simulateTyping();
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result: result || { success: true } });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e && e.message ? e.message : String(e) });
        }
        return;
    }

    // Simulate Presence (DOM â€” scroll chat list)
    if (cmd === 'simulatePresence') {
        try {
            const result = window.WAPI.simulatePresence();
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, result: result || { success: true } });
        } catch (e) {
            window.WAPI.postMessage({ type: 'COMMAND_RESULT', command: cmd, _cmdId: event.data._cmdId, error: e && e.message ? e.message : String(e) });
        }
        return;
    }

    // Clear Cache (Logout)
    if (cmd === 'clearCache') {
        console.log('WAPI: Clearing LocalStorage Cache (`extracted_contacts`).');
        localStorage.removeItem('extracted_contacts');
        // Avoid reloading WhatsApp tab: reload breaks the extension command channel.
        window.WAPI.postMessage({
            type: 'COMMAND_RESULT',
            command: cmd,
            _cmdId: event.data._cmdId,
            result: { success: true, cacheCleared: true }
        });
    }
});









