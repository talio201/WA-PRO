const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SCOPED_ID_SEPARATOR = '::';

// Supabase Init
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// AI Init
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL_CANDIDATES = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
].filter(Boolean);

async function listAvailableGenerationModels(apiKey) {
    if (!apiKey) return [];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) {
        throw new Error(`ListModels failed (${response.status})`);
    }
    const data = await response.json();
    return (data.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => (m.name || '').replace('models/', ''))
        .filter(Boolean);
}

function buildModelAttemptOrder({ preferredModel, availableModels }) {
    const ordered = [];
    const pushUnique = (m) => {
        if (!m) return;
        if (!ordered.includes(m)) ordered.push(m);
    };

    // 1) UI selected model, if any.
    pushUnique(preferredModel);
    // 2) Curated candidates.
    GEMINI_MODEL_CANDIDATES.forEach(pushUnique);
    // 3) Whatever the API key has access to.
    (availableModels || []).forEach(pushUnique);

    return ordered;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static files from the parent directory (frontend)
const path = require('path');
app.use(express.static(path.join(__dirname, '..')));

// Cache schema capability for message_history (wa_message_id)
let MESSAGE_HISTORY_SUPPORTS_WA_ID = null;
async function detectMessageHistoryCapabilities() {
    if (MESSAGE_HISTORY_SUPPORTS_WA_ID !== null) return;
    try {
        const { error } = await supabase.from('message_history').select('wa_message_id').limit(1);
        MESSAGE_HISTORY_SUPPORTS_WA_ID = !error;
    } catch (e) {
        MESSAGE_HISTORY_SUPPORTS_WA_ID = false;
    }
}

// Auth Endpoint (Proxy)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        res.json({ session: data.session, user: data.user });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// Authentication Middleware
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Invalid Token format' });
    }

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) throw error || new Error('User not found');

        req.user = data.user;
        next();
    } catch (err) {
        console.error('[Auth] Validation failed:', err.message);
        res.status(401).json({ error: 'Unauthorized: ' + err.message });
    }
};

function normalizeContactId(input) {
    const id = typeof input?.id === 'string'
        ? input.id
        : (input?.id?._serialized || (input?.number ? `${input.number}@c.us` : null));
    return id || null;
}

function scopeId(agentId, rawId) {
    return `${agentId}${SCOPED_ID_SEPARATOR}${rawId}`;
}

function unscopeId(value) {
    if (!value || typeof value !== 'string') return value;
    const index = value.indexOf(SCOPED_ID_SEPARATOR);
    return index >= 0 ? value.slice(index + SCOPED_ID_SEPARATOR.length) : value;
}

async function assertAgentOwnership(agentId, userId) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('agent_ownership')
        .select('agent_id, user_id')
        .eq('agent_id', agentId)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        const { error: claimError } = await supabase
            .from('agent_ownership')
            .insert([{ agent_id: agentId, user_id: userId, first_seen_at: now, last_seen_at: now }]);
        if (claimError) {
            // Handle concurrent first-claim race.
            if (claimError.code === '23505') {
                const { data: retryData, error: retryError } = await supabase
                    .from('agent_ownership')
                    .select('agent_id, user_id')
                    .eq('agent_id', agentId)
                    .maybeSingle();
                if (retryError) throw retryError;
                return retryData?.user_id === userId;
            }
            throw claimError;
        }
        return true;
    }

    if (data.user_id !== userId) {
        return false;
    }

    await supabase
        .from('agent_ownership')
        .update({ last_seen_at: now })
        .eq('agent_id', agentId)
        .eq('user_id', userId);

    return true;
}

const authorizeAgent = async (req, res, next) => {
    const rawAgentId = req.headers['x-agent-id'];
    if (!rawAgentId) {
        return res.status(400).json({ error: 'Missing Agent ID. Please connect to WhatsApp Web first.' });
    }

    try {
        let effectiveAgentId = rawAgentId;

        // Alias fallback: if client sends "user:<uuid>", map to a real WhatsApp agent_id
        // already owned by this user (prefer non-user:* ids).
        if (rawAgentId.startsWith('user:')) {
            if (rawAgentId !== `user:${req.user.id}`) {
                return res.status(403).json({ error: 'Invalid user fallback agent alias' });
            }

            const { data: ownedAgents, error: ownedError } = await supabase
                .from('agent_ownership')
                .select('agent_id, last_seen_at')
                .eq('user_id', req.user.id)
                .order('last_seen_at', { ascending: false });

            if (ownedError) throw ownedError;

            const preferred = (ownedAgents || []).find(a => !String(a.agent_id || '').startsWith('user:'));
            if (!preferred) {
                return res.status(400).json({
                    error: 'Missing WhatsApp Agent ID. Open WhatsApp Web to bind your account before syncing.'
                });
            }
            effectiveAgentId = preferred.agent_id;
        }

        const allowed = await assertAgentOwnership(effectiveAgentId, req.user.id);
        if (!allowed) {
            return res.status(403).json({ error: 'Agent ID belongs to another user' });
        }
        req.agentId = effectiveAgentId;
        next();
    } catch (err) {
        console.error('[AuthZ] Agent ownership validation failed:', err.message);
        res.status(500).json({ error: 'Failed to validate agent ownership' });
    }
};

// --- ROUTES ---

// Public Routes
app.get('/', (req, res) => res.json({ status: 'Online', version: '1.2.0' }));
app.get('/health', (req, res) => res.status(200).send('OK'));

// Apply Auth Middleware to all subsequent /api routes
app.use('/api', authenticateUser);
app.use('/api', authorizeAgent);
// Note: /api/auth/login was defined BEFORE this, so it stays public.

// Protected Routes (re-mapped if necessary, but Express matches in order)

/**
 * Transforms a WhatsApp contact object from the extension to a DB row.
 */
function toDbRow(c, agentId) {
    const rawId = normalizeContactId(c);
    if (!rawId) return null;
    const id = scopeId(agentId, rawId);

    let number = '';
    if (rawId.includes('@')) number = rawId.split('@')[0];
    else if (c.number) number = c.number;

    return {
        id: id,
        name: c.name || c.pushname || '',
        number: number,
        is_business: Boolean(c.isBusiness),
        is_group: Boolean(c.isGroup),
        is_lead: Boolean(c.is_lead), // Native column support
        last_sent_at: c.last_sent_at || null,
        server: rawId.includes('@') ? rawId.split('@')[1] : 'c.us',
        raw_data: { ...c, id: rawId }, // Preserve unscoped WA id
        agent_id: agentId // Multi-tenancy
    };
}

/**
 * Transforms an unwrapped DB row back to a WhatsApp contact object for the extension.
 */
function fromDbRow(row) {
    let data = row.raw_data || {};
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { data = {}; }
    }

    // Resilient fallback: use native column if exists, otherwise check JSON
    const isLead = row.is_lead !== undefined ? Boolean(row.is_lead) : Boolean(data.is_lead);
    const lastSent = row.last_sent_at || data.last_sent_at || null;

    return {
        ...data,
        id: data.id || unscopeId(row.id),
        name: data.name || row.name,
        is_lead: isLead,
        last_sent_at: lastSent,
        imported_at: data.imported_at || row.created_at
    };
}

// 2. Sync Contacts (Proxy to Supabase)
// 2. Sync Contacts (Proxy to Supabase)
app.post('/api/contacts/sync', async (req, res) => {
    try {
        const { contacts } = req.body;
        const agentId = req.agentId;

        if (!contacts || !Array.isArray(contacts)) {
            return res.status(400).json({ error: 'Invalid contacts data' });
        }

        const rows = contacts.map(c => toDbRow(c, agentId)).filter(r => r !== null);

        const { data, error } = await supabase
            .from('contacts')
            .upsert(rows, { onConflict: 'id' });

        if (error) throw error;
        res.json({ success: true, count: rows.length });
    } catch (err) {
        console.error('Sync Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Fetch Contacts (All, handling 1000 limit)
app.get('/api/contacts', async (req, res) => {
    try {
        let allContacts = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            let query = supabase
                .from('contacts')
                .select('*')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            const agentId = req.agentId;

            query = query.eq('agent_id', agentId);

            const { data, error } = await query;

            if (error) throw error;

            if (data.length > 0) {
                allContacts = allContacts.concat(data);
                page++;
                if (data.length < pageSize) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        // "Unwrap" raw_data for the extension
        const unwrapped = allContacts.map(fromDbRow);
        res.json(unwrapped);
    } catch (err) {
        console.error('Fetch Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Import Leads (Leads Table - Dedicated)
app.post('/api/leads/import', async (req, res) => {
    try {
        const { leads, source } = req.body; // source: 'excel' or 'manual'
        const agentId = req.agentId;

        if (!leads || !Array.isArray(leads)) {
            return res.status(400).json({ error: 'Invalid leads data' });
        }

        const rows = leads.map(l => ({
            id: scopeId(agentId, `${l.number}@c.us`),
            name: l.name || '',
            number: l.number,
            source: source || 'excel',
            imported_at: new Date().toISOString(),
            agent_id: agentId
        }));

        // Deduplicate rows by id (prevent "row a second time" error)
        const uniqueMap = new Map();
        rows.forEach(r => uniqueMap.set(r.id, r));
        const uniqueRows = Array.from(uniqueMap.values());

        const { data, error } = await supabase
            .from('contacts_leads')
            .upsert(uniqueRows, { onConflict: 'id' });

        if (error) throw error;
        res.json({ success: true, count: rows.length });
    } catch (err) {
        console.error('Import Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4.1 Fetch Dedicated Leads (Merged with Last Sent)
app.get('/api/leads', async (req, res) => {
    try {
        const agentId = req.agentId;

        let query = supabase
            .from('contacts_leads')
            .select('*')
            .order('imported_at', { ascending: false })
            .eq('agent_id', agentId);

        // 1. Fetch Leads
        const { data: leadsData, error: leadsError } = await query;

        if (leadsError) throw leadsError;

        if (!leadsData || leadsData.length === 0) {
            return res.json([]);
        }

        // 2. Fetch Activity (last_sent_at) from main contacts table
        const leadIds = leadsData.map(l => unscopeId(l.id));
        const scopedLeadIds = leadIds.map(id => scopeId(agentId, id));
        const { data: contactsData, error: contactsError } = await supabase
            .from('contacts')
            .select('id, last_sent_at')
            .eq('agent_id', agentId)
            .in('id', scopedLeadIds);

        if (contactsError) console.warn('Failed to fetch lead activity:', contactsError);

        // 3. Map Activity
        const activityMap = new Map();
        if (contactsData) {
            contactsData.forEach(c => activityMap.set(unscopeId(c.id), c.last_sent_at));
        }

        // 4. Transform and Merge
        const leads = leadsData.map(l => ({
            id: {
                _serialized: `${l.number}@c.us`,
                user: l.number,
                server: `${l.number}@c.us`.includes('@g.us') ? 'g.us' : 'c.us'
            },
            name: l.name,
            number: l.number,
            is_lead: true,
            isBusiness: false,
            isGroup: false,
            imported_at: l.imported_at,
            source: l.source,
            last_sent_at: activityMap.get(`${l.number}@c.us`) || null // <--- Added Field
        }));

        res.json(leads);
    } catch (err) {
        console.error('Fetch Leads Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5. Message History
app.get('/api/messages/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const agentId = req.agentId;

        let query = supabase
            .from('message_history')
            .select('*')
            .order('sent_at', { ascending: false })
            .limit(limit)
            .eq('agent_id', agentId);

        const { data, error } = await query;

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5.1 Conversations (derived from message_history)
app.get('/api/conversations', async (req, res) => {
    try {
        const agentId = req.agentId;
        const limit = Math.min(500, Math.max(20, parseInt(req.query.limit) || 200));

        const { data: rows, error } = await supabase
            .from('message_history')
            .select('contact_id, contact_name, message_text, has_media, media_filename, status, sent_at, direction, message_type')
            .eq('agent_id', agentId)
            .order('sent_at', { ascending: false })
            .limit(5000);

        if (error) throw error;

        const convMap = new Map();
        for (const r of (rows || [])) {
            const rawContactId = unscopeId(r.contact_id);
            if (!rawContactId) continue;
            if (!convMap.has(rawContactId)) {
                convMap.set(rawContactId, {
                    contact_id: rawContactId,
                    contact_name: r.contact_name || '',
                    last_text: r.message_text || '',
                    last_at: r.sent_at,
                    direction: r.direction || 'outbound',
                    message_type: r.message_type || 'text',
                    has_media: Boolean(r.has_media),
                    status: r.status || '',
                    media_filename: r.media_filename || '',
                    avatar: null,
                    number: rawContactId.includes('@') ? rawContactId.split('@')[0] : rawContactId
                });
            }
            if (convMap.size >= limit) break;
        }

        const convs = Array.from(convMap.values());
        const scopedContactIds = convs.map(c => scopeId(agentId, c.contact_id));

        // Enrich with contacts table (name + avatar URL), best-effort.
        let contactsData = [];
        if (scopedContactIds.length > 0) {
            const { data, error: contactsError } = await supabase
                .from('contacts')
                .select('id, name, number, raw_data')
                .eq('agent_id', agentId)
                .in('id', scopedContactIds);
            if (contactsError) console.warn('[Conversations] Contacts enrich failed:', contactsError.message);
            contactsData = data || [];
        }

        const enrichMap = new Map();
        for (const c of contactsData) {
            const rawId = unscopeId(c.id);
            let raw = c.raw_data || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
            }
            enrichMap.set(rawId, {
                name: c.name || raw.name || raw.pushname || raw.formattedName || '',
                avatar: raw.avatar || null,
                number: c.number || (rawId && rawId.includes('@') ? rawId.split('@')[0] : '')
            });
        }

        convs.forEach(conv => {
            const e = enrichMap.get(conv.contact_id);
            if (!e) return;
            if (e.name) conv.contact_name = e.name;
            if (e.avatar) conv.avatar = e.avatar;
            if (e.number) conv.number = e.number;
        });

        res.json(convs);
    } catch (err) {
        console.error('Conversations Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5.2 Conversation messages (single chat thread)
app.get('/api/conversations/messages', async (req, res) => {
    try {
        const agentId = req.agentId;
        const contactId = req.query.contactId;
        const limit = Math.min(500, Math.max(20, parseInt(req.query.limit) || 200));

        if (!contactId || typeof contactId !== 'string') {
            return res.status(400).json({ error: 'Missing contactId' });
        }

        const { data, error } = await supabase
            .from('message_history')
            .select('*')
            .eq('agent_id', agentId)
            .eq('contact_id', contactId)
            .order('sent_at', { ascending: true })
            .limit(limit);

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('Conversation Messages Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6. Log Message
app.post('/api/messages/log', async (req, res) => {
    try {
        const payload = req.body;
        const agentId = req.agentId;
        await detectMessageHistoryCapabilities();

        // Clean payload to match table columns
        const dbPayload = {
            contact_id: payload.contactId || '',
            contact_name: payload.contactName || '',
            message_text: payload.messageText || '',
            has_media: Boolean(payload.hasMedia),
            media_filename: payload.mediaFilename || '',
            status: payload.status || 'sent',
            error_message: payload.errorMessage || '',
            campaign_id: payload.campaignId || '',
            direction: payload.direction || 'outbound',
            message_type: payload.messageType || 'text',
            media_url: payload.mediaUrl || null,
            agent_id: agentId
        };

        // Preserve original WhatsApp timestamp if provided.
        if (payload.timestamp) {
            const ts = Number(payload.timestamp);
            if (Number.isFinite(ts) && ts > 0) {
                const ms = ts < 2e10 ? ts * 1000 : ts; // seconds vs ms heuristic
                dbPayload.sent_at = new Date(ms).toISOString();
            }
        }

        if (MESSAGE_HISTORY_SUPPORTS_WA_ID && payload.waMessageId) {
            dbPayload.wa_message_id = String(payload.waMessageId);
        }

        const { error } = await supabase
            .from('message_history')
            .insert([dbPayload]);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Log Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6.1 Bulk Log Messages (history backfill)
app.post('/api/messages/bulk', async (req, res) => {
    try {
        const agentId = req.agentId;
        await detectMessageHistoryCapabilities();

        const messages = req.body && Array.isArray(req.body.messages) ? req.body.messages : null;
        if (!messages) return res.status(400).json({ error: 'Invalid messages payload' });

        // Bound batch size to protect API.
        const trimmed = messages.slice(0, 800);

        // Deduplicate within the payload.
        const uniq = new Map();
        for (const m of trimmed) {
            const key = (m.waMessageId && MESSAGE_HISTORY_SUPPORTS_WA_ID)
                ? `wa:${m.waMessageId}`
                : `f:${m.contactId}:${m.timestamp}:${(m.text || '').slice(0, 80)}:${m.direction || ''}:${m.messageType || ''}`;
            if (!uniq.has(key)) uniq.set(key, m);
        }

        const rows = Array.from(uniq.values()).map(m => {
            const row = {
                contact_id: m.contactId || '',
                contact_name: m.contactName || m.author || '',
                message_text: m.text || m.messageText || '',
                has_media: Boolean(m.hasMedia),
                media_filename: m.mediaFilename || '',
                status: m.status || (m.direction === 'inbound' ? 'received' : 'sent'),
                error_message: m.errorMessage || '',
                campaign_id: m.campaignId || '',
                direction: m.direction || 'outbound',
                message_type: m.messageType || 'text',
                media_url: m.mediaUrl || null,
                agent_id: agentId
            };

            if (m.timestamp) {
                const ts = Number(m.timestamp);
                if (Number.isFinite(ts) && ts > 0) {
                    const ms = ts < 2e10 ? ts * 1000 : ts;
                    row.sent_at = new Date(ms).toISOString();
                }
            }

            if (MESSAGE_HISTORY_SUPPORTS_WA_ID && m.waMessageId) {
                row.wa_message_id = String(m.waMessageId);
            }

            return row;
        }).filter(r => r.contact_id);

        if (rows.length === 0) return res.json({ success: true, count: 0 });

        // Prefer upsert if wa_message_id is available.
        if (MESSAGE_HISTORY_SUPPORTS_WA_ID && rows.every(r => r.wa_message_id)) {
            const { error } = await supabase
                .from('message_history')
                .upsert(rows, { onConflict: 'agent_id,wa_message_id' });
            if (error) {
                // Fallback to plain insert if the unique constraint isn't present.
                const { error: insertError } = await supabase.from('message_history').insert(rows);
                if (insertError) throw insertError;
            }
        } else {
            const { error } = await supabase.from('message_history').insert(rows);
            if (error) throw error;
        }

        res.json({ success: true, count: rows.length });
    } catch (err) {
        console.error('Bulk Log Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7. AI Rewrite (Proxy to Gemini)
app.post('/api/ai/rewrite', async (req, res) => {
    try {
        const { text, selectedModel } = req.body;
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'Texto obrigatório' });
        }

        const prompt = `
            Você é um especialista em WhatsApp. Gere 5 versões da mensagem abaixo de forma natural (tom focado em vendas e amigável):
            "${text}"
            
            Retorne APENAS um JSON no formato:
            { "versions": [ {"title":"...", "text":"..."} ] }
        `;
        const apiKey = process.env.GEMINI_API_KEY;

        let availableModels = [];
        try {
            availableModels = await listAvailableGenerationModels(apiKey);
        } catch (err) {
            console.warn('[AI] Could not list available models:', err.message);
        }

        const candidates = buildModelAttemptOrder({
            preferredModel: selectedModel,
            availableModels
        });

        if (candidates.length === 0) {
            throw new Error('Nenhum modelo Gemini disponível para essa chave.');
        }

        const errors = [];
        for (const modelName of candidates) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                let resultText = response.text();
                resultText = resultText.replace(/```json|```/g, '').trim();
                const parsed = JSON.parse(resultText);
                if (!parsed || !Array.isArray(parsed.versions)) {
                    throw new Error('Resposta sem campo versions');
                }
                return res.json({ ...parsed, modelUsed: modelName });
            } catch (err) {
                errors.push(`${modelName}: ${err.message}`);
            }
        }

        throw new Error(`Falha em todos os modelos testados. ${errors.join(' | ')}`);
    } catch (err) {
        console.error('AI Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 8. Dashboard Stats (Aggregated)
app.get('/api/stats', async (req, res) => {
    try {
        const agentId = req.agentId;

        // Helper to apply agent filter
        const withAgent = (query) => {
            return query.eq('agent_id', agentId);
        };

        // Parallel queries
        const [totalSent, totalFailed, totalReplies, recentActivity, totalContacts, totalLeads] = await Promise.all([
            // 1. Total Sent
            withAgent(supabase.from('message_history').select('*', { count: 'exact', head: true })
                .eq('status', 'sent').eq('direction', 'outbound')),

            // 2. Total Failed
            withAgent(supabase.from('message_history').select('*', { count: 'exact', head: true })
                .eq('status', 'failed').eq('direction', 'outbound')),

            // 3. Total Replies
            withAgent(supabase.from('message_history').select('*', { count: 'exact', head: true })
                .eq('direction', 'inbound')),

            // 4. Recent Activity (Logs)
            withAgent(supabase.from('message_history')
                .select('*')
                .order('sent_at', { ascending: false })
                .limit(10)),

            // 5. Total Contacts Count
            withAgent(supabase.from('contacts').select('id, number', { count: 'exact' }).limit(5000)),

            // 6. Total Leads Count (dedicated table)
            withAgent(supabase.from('contacts_leads').select('id, number', { count: 'exact' }).limit(5000))
        ]);

        const sent = totalSent.count || 0;
        const failed = totalFailed.count || 0;
        const replies = totalReplies.count || 0;
        const activity = recentActivity.data || [];
        // Deduplicate by number between contacts + leads for KPI "Contatos"
        const numberSet = new Set();
        (totalContacts.data || []).forEach(c => {
            const n = c.number || (c.id ? String(c.id).split('@')[0] : '');
            if (n) numberSet.add(n);
        });
        (totalLeads.data || []).forEach(l => {
            const n = l.number || (l.id ? String(l.id).split('@')[0] : '');
            if (n) numberSet.add(n);
        });
        const count = numberSet.size;

        res.json({
            overview: {
                sent: sent,
                failed: failed,
                replies: replies,
                totalContacts: count,
                totalWhatsappContacts: totalContacts.count || 0,
                totalLeads: totalLeads.count || 0
            },
            activity: activity.map(a => ({
                id: a.id,
                text: a.message_text,
                status: a.status,
                contact: a.contact_name || a.contact_id,
                time: a.sent_at,
                direction: a.direction || 'outbound',
                type: a.message_type
            }))
        });

    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 EmidiaWhats API v1.1.0 running on port ${PORT}`);
});
