/*
  Script para criar a tabela de Contatos no Supabase.
  Execute no SQL Editor do Supabase.
*/

CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    name TEXT,
    phone TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Segurança para garantir performance se houver muitos contatos
CREATE INDEX IF NOT EXISTS idx_contacts_agent_id ON public.contacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON public.contacts(phone);

-- (Opcional) Adiciona uma constraint única para garantir que um mesmo agente
-- não tenha o mesmo telefone repetido no banco
ALTER TABLE public.contacts 
  ADD CONSTRAINT unique_agent_phone UNIQUE (agent_id, phone);
