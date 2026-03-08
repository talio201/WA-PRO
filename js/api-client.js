import { API_BASE_URL } from './config.js';

export class ApiClient {
    constructor() {
        this.baseUrl = API_BASE_URL;
    }

    async getHeaders() {
        return new Promise(resolve => {
            chrome.storage.local.get(['agent_id', 'supa_session'], (result) => {
                const agentId = result.agent_id;
                const token = result.supa_session ? result.supa_session.access_token : null;

                // Return null if critical headers missing (Stop request early)
                if (!agentId) {
                    // console.warn('[ApiClient] Missing Agent ID. Request aborted.');
                    resolve(null);
                    return;
                }

                const headers = {
                    'Content-Type': 'application/json',
                    'x-agent-id': agentId
                };

                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                resolve(headers);
            });
        });
    }

    async fetchContacts() {
        // Busca todos os contatos em lotes de 1000 até trazer todos
        try {
            const headers = await this.getHeaders();
            if (!headers) {
                console.error('[ApiClient] fetchContacts: headers ausentes!');
                return [];
            }

            let allContacts = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;
            let lastPageData = null;

            while (hasMore) {
                const url = `${this.baseUrl}/api/contacts?page=${page}&pageSize=${pageSize}`;
                console.log(`[ApiClient] Buscando contatos: ${url}`);
                const response = await fetch(url, { headers });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return [];
                }
                if (!response.ok) {
                    const errText = await response.text();
                    console.error(`[ApiClient] Erro ao buscar contatos: ${response.status} - ${errText}`);
                    throw new Error('Fetch Error');
                }
                const data = await response.json();
                console.log(`[ApiClient] Página ${page} retornou ${data.length} contatos.`);
                // Proteção: se a página retornada for igual à anterior, pare
                if (lastPageData && JSON.stringify(lastPageData) === JSON.stringify(data)) {
                    console.warn('[ApiClient] Página repetida detectada, encerrando loop.');
                    hasMore = false;
                    break;
                }
                lastPageData = data;
                if (Array.isArray(data) && data.length > 0) {
                    allContacts = allContacts.concat(data);
                    page++;
                    if (data.length < pageSize) hasMore = false;
                } else {
                    hasMore = false;
                }
            }
            console.log(`[ApiClient] Total de contatos carregados do Supabase: ${allContacts.length}`);
            return allContacts;
        } catch (err) {
            console.error('[ApiClient] fetchContacts failed:', err);
            return [];
        }
    }

    async syncContacts(contacts) {
        if (!contacts || contacts.length === 0) {
            console.warn('[ApiClient] syncContacts: lista de contatos vazia!');
            return { success: true };
        }

        const BATCH_SIZE = 100;
        let lastResult = { success: true };

        console.log(`[ApiClient] Syncing ${contacts.length} contacts in batches of ${BATCH_SIZE}...`);

        for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
            const batch = contacts.slice(i, i + BATCH_SIZE);
            try {
                const headers = await this.getHeaders();
                if (!headers) throw new Error('Missing Agent ID');

                console.log(`[ApiClient] Enviando batch ${i} a ${i + batch.length} para o Supabase...`);
                const response = await fetch(`${this.baseUrl}/api/contacts/sync`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ contacts: batch })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`[ApiClient] Erro ao sincronizar batch ${i}-${i + batch.length}: ${response.status} - ${errorText}`);
                    throw new Error(`Batch Sync Error (${response.status}): ${errorText}`);
                }
                lastResult = await response.json();
                console.log(`[ApiClient] Batch ${i}-${i + batch.length} sincronizado com sucesso.`);
            } catch (err) {
                console.error(`[ApiClient] syncContacts batch ${i}-${i + batch.length} failed:`, err);
                lastResult = { error: err.message };
            }
        }
        return lastResult;
    }

    async importLeads(leads, source = 'excel') {
        try {
            const headers = await this.getHeaders();
            if (!headers) return { error: 'Missing Agent ID' };

            const response = await fetch(`${this.baseUrl}/api/leads/import`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ leads, source })
            });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] importLeads failed:', err);
            return { error: err.message };
        }
    }

    async fetchLeads() {
        try {
            const headers = await this.getHeaders();
            if (!headers) return [];

            const response = await fetch(`${this.baseUrl}/api/leads`, { headers });
            if (!response.ok) throw new Error('Fetch Leads Error');
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] fetchLeads failed:', err);
            return [];
        }
    }

    async logMessage(payload) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return; // Silent abort

            const response = await fetch(`${this.baseUrl}/api/messages/log`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] logMessage failed:', err);
        }
    }

    async logMessagesBulk(messages) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return { error: 'Missing Agent ID' };
            if (!messages || !Array.isArray(messages) || messages.length === 0) return { success: true, count: 0 };

            const response = await fetch(`${this.baseUrl}/api/messages/bulk`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ messages })
            });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] logMessagesBulk failed:', err);
            return { error: err.message };
        }
    }

    async fetchMessageHistory(limit = 100) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return [];

            const response = await fetch(`${this.baseUrl}/api/messages/history?limit=${limit}`, { headers });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] fetchMessageHistory failed:', err);
            return [];
        }
    }

    async fetchConversations(limit = 200) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return [];

            const response = await fetch(`${this.baseUrl}/api/conversations?limit=${limit}`, { headers });
            if (!response.ok) throw new Error('Fetch Conversations Error');
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] fetchConversations failed:', err);
            return [];
        }
    }

    async fetchConversationMessages(contactId, limit = 200) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return [];
            if (!contactId) return [];

            const url = `${this.baseUrl}/api/conversations/messages?contactId=${encodeURIComponent(contactId)}&limit=${limit}`;
            const response = await fetch(url, { headers });
            if (!response.ok) throw new Error('Fetch Conversation Messages Error');
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] fetchConversationMessages failed:', err);
            return [];
        }
    }

    async rewriteMessage(text, selectedModel = null) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return { versions: [] }; // No rewrite if not connected? Or maybe allow if no agent_id required for this? Better restrict.

            const response = await fetch(`${this.baseUrl}/api/ai/rewrite`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ text, selectedModel })
            });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] rewriteMessage failed:', err);
            return { versions: [] };
        }
    }

    async markConversationStarted(contactId) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return;

            const response = await fetch(`${this.baseUrl}/api/contacts/sync`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    contacts: [{ id: contactId, started_by_tool: true, first_contact_at: new Date().toISOString() }]
                })
            });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] markConversationStarted failed:', err);
        }
    }

    async insertManualContact(number, name) {
        try {
            const headers = await this.getHeaders();
            if (!headers) return { error: 'Missing Agent ID' };

            const response = await fetch(`${this.baseUrl}/api/contacts/sync`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    contacts: [{
                        number: number,
                        name: name,
                        id: number + '@c.us',
                        server: 'c.us',
                        isManual: true
                    }]
                })
            });
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] insertManualContact failed:', err);
            return { error: err.message };
        }
    }

    async getDashboardStats() {
        try {
            const headers = await this.getHeaders();
            if (!headers) return null;

            const response = await fetch(`${this.baseUrl}/api/stats`, { headers });
            if (response.status === 401) return this.handleUnauthorized();
            if (!response.ok) throw new Error('Stats Fetch Error');
            return await response.json();
        } catch (err) {
            console.error('[ApiClient] getDashboardStats failed:', err);
            return null;
        }
    }

    handleUnauthorized() {
        console.warn('[ApiClient] Unauthorized. Redirecting to login...');
        chrome.storage.local.remove(['supa_session', 'supa_user', 'ext_authenticated', 'agent_id', 'wa_contacts'], () => {
            if (window.location.pathname.endsWith('dashboard.html')) {
                window.location.href = 'login.html';
            }
        });
        return null; // Return null/empty to caller
    }
}

if (typeof window !== 'undefined') {
    window.ApiClient = ApiClient;
}
