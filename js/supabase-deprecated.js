
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export class SupabaseClient {
    constructor() {
        this.url = SUPABASE_URL;
        this.key = SUPABASE_KEY;
        this.headers = {
            'apikey': this.key,
            'Authorization': `Bearer ${this.key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal' // Don't return the whole object after insert
        };
    }

    /**
     * Upsert contacts (Insert or Update on conflict)
     * @param {Array} contacts - List of contact objects
     * @returns {Promise<any>}
     */
    async upsertContacts(contacts) {
        if (!contacts || contacts.length === 0) return;

        // Transform if necessary to match DB schema
        // CRITICAL: All objects MUST have the same keys for Supabase batch insert
        const payload = contacts.map(c => {
            // Get ID as string
            let rawId = c.id;
            if (typeof rawId === 'object' && rawId._serialized) {
                rawId = rawId._serialized;
            }

            // Extract number from ID (part before @)
            let number = '';
            if (typeof rawId === 'string' && rawId.includes('@')) {
                number = rawId.split('@')[0];
            }

            let server = c.server || '';
            if (!server && typeof rawId === 'string' && rawId.includes('@')) {
                server = rawId.split('@')[1] || '';
            }

            // Return object with CONSISTENT keys
            return {
                id: rawId || '',
                name: c.name || c.pushname || c.formattedName || '',
                number: number || '',
                is_business: Boolean(c.isBusiness),
                is_group: Boolean(c.isGroup),
                server: server || '',
                raw_data: c
            };
        });

        // DEBUG: Log first 3 transformed contacts to verify number extraction
        if (payload.length > 0) {
            console.log('[Supabase] Sample transformed contacts:');
            payload.slice(0, 3).forEach((p, idx) => {
                console.log(`  [${idx}] name: "${p.name}", number: "${p.number}", server: "${p.server}", id: "${p.id}"`);
            });
        }

        const BATCH_SIZE = 1000;

        for (let i = 0; i < payload.length; i += BATCH_SIZE) {
            const batch = payload.slice(i, i + BATCH_SIZE);
            console.log(`[Supabase] Syncing batch ${i} to ${i + batch.length}...`);

            // Debug: Check if all objects have the same keys
            if (batch.length > 0) {
                const firstKeys = Object.keys(batch[0]).sort();
                const allMatch = batch.every(obj => {
                    const keys = Object.keys(obj).sort();
                    return JSON.stringify(keys) === JSON.stringify(firstKeys);
                });
                console.log(`[Supabase] All objects have matching keys: ${allMatch}`);
                if (!allMatch) {
                    console.error('[Supabase] Key mismatch detected! Sample:', batch.slice(0, 3).map(o => Object.keys(o)));
                }
            }

            try {
                const response = await fetch(`${this.url}/rest/v1/contacts`, {
                    method: 'POST',
                    headers: {
                        ...this.headers,
                        'Prefer': 'resolution=merge-duplicates' // Handle UPSERT logic (requires primary key in DB)
                    },
                    body: JSON.stringify(batch)
                });

                if (!response.ok) {
                    const err = await response.text();
                    console.error('[Supabase] Sync Error:', err);
                } else {
                    console.log('[Supabase] Batch synced successfully.');
                }
            } catch (error) {
                console.error('[Supabase] Network Error:', error);
            }
        }
    }

    /**
     * Fetch all contacts from Supabase
     * @returns {Promise<Array>}
     */
    async fetchContacts() {
        let allData = [];
        let offset = 0;
        const limit = 1000;
        let hasMore = true;

        try {
            while (hasMore) {
                const response = await fetch(`${this.url}/rest/v1/contacts?select=*&offset=${offset}&limit=${limit}`, {
                    method: 'GET',
                    headers: this.headers
                });

                if (!response.ok) {
                    const err = await response.text();
                    console.error('[Supabase] Fetch Error:', err);
                    break;
                }

                const data = await response.json();
                allData = allData.concat(data);

                if (data.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }

            console.log(`[Supabase] Total fetched from cloud: ${allData.length}`);
            return allData.map(item => {
                let raw = item.raw_data;
                if (typeof raw === 'string') {
                    try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
                }
                return raw || {};
            });
        } catch (error) {
            console.error('[Supabase] Network Error:', error);
            return [];
        }
    }

    /**
     * Insert a manually added contact
     */
    async insertManualContact(number, name) {
        const payload = {
            id: number + '@c.us',
            name: name || '',
            number: number,
            is_business: false,
            is_group: false,
            server: 'c.us',
            raw_data: { id: number + '@c.us', server: 'c.us', name: name, isManual: true }
        };

        const response = await fetch(`${this.url}/rest/v1/contacts`, {
            method: 'POST',
            headers: {
                ...this.headers,
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([payload])
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(err);
        }

        console.log(`[Supabase] Manual contact added: ${number}`);
    }

    /**
     * Upsert leads from Excel (Marked with is_lead: true)
     */
    async upsertLeads(leads) {
        if (!leads || leads.length === 0) return;

        const payload = leads.map(l => ({
            id: l.number + '@c.us',
            name: l.name || '',
            number: l.number,
            is_business: false,
            is_group: false,
            server: 'c.us',
            raw_data: {
                id: l.number + '@c.us',
                server: 'c.us',
                name: l.name,
                is_lead: true,
                imported_at: new Date().toISOString()
            }
        }));

        const BATCH_SIZE = 1000;
        for (let i = 0; i < payload.length; i += BATCH_SIZE) {
            const batch = payload.slice(i, i + BATCH_SIZE);
            try {
                const response = await fetch(`${this.url}/rest/v1/contacts`, {
                    method: 'POST',
                    headers: {
                        ...this.headers,
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(batch)
                });

                if (!response.ok) {
                    const err = await response.text();
                    console.error('[Supabase] Lead Sync Error:', err);
                }
            } catch (error) {
                console.error('[Supabase] Lead Sync Network Error:', error);
            }
        }
        console.log(`[Supabase] ${leads.length} leads synced successfully.`);
    }

    /**
     * Log a sent/failed message to message_history table
     */
    async logMessage({ contactId, contactName, messageText, hasMedia, mediaFilename, status, errorMessage, campaignId }) {
        const payload = {
            contact_id: contactId || '',
            contact_name: contactName || '',
            message_text: messageText || '',
            has_media: Boolean(hasMedia),
            media_filename: mediaFilename || '',
            status: status || 'sent',
            error_message: errorMessage || '',
            campaign_id: campaignId || '',
        };

        try {
            const response = await fetch(`${this.url}/rest/v1/message_history`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify([payload])
            });

            if (!response.ok) {
                const err = await response.text();
                console.error('[Supabase] logMessage Error:', err);
            } else {
                console.log(`[Supabase] Message logged: ${status} → ${contactName || contactId}`);
            }
        } catch (error) {
            console.error('[Supabase] logMessage Network Error:', error);
        }
    }

    /**
     * Mark a contact as having a conversation started by the tool.
     * Updates the contacts table: started_by_tool = true, first_contact_at = NOW()
     */
    async markConversationStarted(contactId) {
        try {
            const response = await fetch(
                `${this.url}/rest/v1/contacts?id=eq.${encodeURIComponent(contactId)}`,
                {
                    method: 'PATCH',
                    headers: {
                        ...this.headers,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({
                        started_by_tool: true,
                        first_contact_at: new Date().toISOString()
                    })
                }
            );

            if (!response.ok) {
                const err = await response.text();
                console.error('[Supabase] markConversationStarted Error:', err);
            } else {
                console.log(`[Supabase] Conversation marked: ${contactId}`);
            }
        } catch (error) {
            console.error('[Supabase] markConversationStarted Network Error:', error);
        }
    }

    /**
     * Fetch recent message history for dashboard logs
     */
    async fetchMessageHistory(limit = 100) {
        try {
            const response = await fetch(
                `${this.url}/rest/v1/message_history?select=*&order=sent_at.desc&limit=${limit}`,
                {
                    method: 'GET',
                    headers: this.headers
                }
            );

            if (!response.ok) {
                const err = await response.text();
                throw new Error(err);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('[Supabase] fetchMessageHistory Error:', error);
            return [];
        }
    }
}
