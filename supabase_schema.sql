-- 1. Tabela de Campanhas
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'running', -- running, paused, completed, cancelled
    total_contacts INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    agent_id TEXT -- Para suportar múltiplos usuários
);

-- 2. Expandir message_history (se já existir, adiciona colunas)
DO $$ 
BEGIN 
    ALTER TABLE message_history ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'outbound'; -- inbound, outbound
    ALTER TABLE message_history ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text'; -- text, image, video, document, audio
    ALTER TABLE message_history ADD COLUMN IF NOT EXISTS media_url TEXT;
    ALTER TABLE message_history ADD COLUMN IF NOT EXISTS agent_id TEXT;
    ALTER TABLE message_history ADD COLUMN IF NOT EXISTS wa_message_id TEXT; -- stable-ish WA id for dedupe/upsert
EXCEPTION
    WHEN undefined_table THEN
        CREATE TABLE message_history (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            contact_id TEXT NOT NULL,
            contact_name TEXT DEFAULT '',
            message_text TEXT DEFAULT '',
            has_media BOOLEAN DEFAULT FALSE,
            media_filename TEXT DEFAULT '',
            status TEXT DEFAULT 'sent',
            error_message TEXT DEFAULT '',
            campaign_id TEXT DEFAULT '',
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            direction TEXT DEFAULT 'outbound',
            message_type TEXT DEFAULT 'text',
            media_url TEXT,
            agent_id TEXT,
            wa_message_id TEXT
        );
END $$;

-- 3. View de Estatísticas Diárias (Analytics)
DROP VIEW IF EXISTS daily_stats CASCADE;
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
    DATE(sent_at) as date,
    agent_id,
    COUNT(*) FILTER (WHERE status = 'sent' AND direction = 'outbound') as sent,
    COUNT(*) FILTER (WHERE status = 'failed' AND direction = 'outbound') as failed,
    COUNT(*) FILTER (WHERE direction = 'inbound') as replies,
    COUNT(DISTINCT campaign_id) as campaigns_active
FROM message_history
GROUP BY 1, 2;

-- 4. Índices para performance
CREATE INDEX IF NOT EXISTS idx_message_history_contact_id ON message_history(contact_id);
CREATE INDEX IF NOT EXISTS idx_message_history_sent_at ON message_history(sent_at);
CREATE INDEX IF NOT EXISTS idx_message_history_agent_sent_at ON message_history(agent_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_history_agent_contact_sent_at ON message_history(agent_id, contact_id, sent_at DESC);

-- Unique dedupe key (enables upsert by WA message id). This does NOT prevent null duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_history_agent_wa_id
ON message_history(agent_id, wa_message_id)
WHERE wa_message_id IS NOT NULL AND wa_message_id <> '';
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);

-- 5. Tabela de Contatos (Sincronização & Leads)
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY, -- phone number or serialized id (e.g. 5511999999999@c.us)
    name TEXT,
    pushname TEXT,
    number TEXT,
    is_business BOOLEAN DEFAULT FALSE,
    is_group BOOLEAN DEFAULT FALSE,
    is_my_contact BOOLEAN DEFAULT FALSE,
    is_lead BOOLEAN DEFAULT FALSE,
    server TEXT,
    raw_data JSONB,
    last_sent_at TIMESTAMPTZ,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    started_by_tool BOOLEAN DEFAULT FALSE,
    first_contact_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    agent_id TEXT -- Para multi-tenancy futuro
);

CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_is_lead ON contacts(is_lead);

-- 6. Tabela Dedicada de Leads (Importados/Manuais) - PROTEÇÃO CONTRA OVERWRITE
CREATE TABLE IF NOT EXISTS contacts_leads (
    id TEXT PRIMARY KEY, -- phone number or serialized id
    name TEXT,
    number TEXT,
    email TEXT,
    tags TEXT[],
    notes TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'excel', -- excel, manual, etc
    agent_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_contacts_leads_imported_at ON contacts_leads(imported_at);

-- 7. Ownership map to bind each WhatsApp agent_id to one authenticated user.
CREATE TABLE IF NOT EXISTS agent_ownership (
    agent_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_ownership_user_id ON agent_ownership(user_id);
