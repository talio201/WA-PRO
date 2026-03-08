-- WhatsApp Campaign Manager - Supabase Schema
-- Execute this script in Supabase SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  message_template text,
  message_variants jsonb not null default '[]'::jsonb,
  turbo_mode boolean not null default false,
  status text not null default 'running'
    check (status in ('draft', 'running', 'paused', 'completed', 'archived')),
  anti_ban jsonb not null default '{"minDelaySeconds":0,"maxDelaySeconds":120}'::jsonb,
  stats jsonb not null default '{"total":0,"sent":0,"failed":0}'::jsonb,
  media jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_campaigns_updated_at on public.campaigns;
create trigger trg_campaigns_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  phone text not null,
  phone_original text,
  search_terms jsonb not null default '[]'::jsonb,
  name text,
  variables jsonb,
  processed_message text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  direction text not null default 'outbound'
    check (direction in ('outbound', 'inbound')),
  attempt_count integer not null default 0,
  error text,
  last_error text,
  audit jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_messages_updated_at on public.messages;
create trigger trg_messages_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

create table if not exists public.conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  campaign_id uuid references public.campaigns(id) on delete set null,
  assigned_to text not null,
  assigned_by text,
  status text not null default 'active'
    check (status in ('active', 'closed')),
  assigned_at timestamptz not null default timezone('utc', now()),
  last_inbound_at timestamptz,
  closed_at timestamptz,
  notes text,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_conversation_assignments_updated_at on public.conversation_assignments;
create trigger trg_conversation_assignments_updated_at
before update on public.conversation_assignments
for each row execute function public.set_updated_at();

create index if not exists idx_campaigns_status on public.campaigns (status);
create index if not exists idx_campaigns_created_at_desc on public.campaigns (created_at desc);
create index if not exists idx_messages_campaign_status on public.messages (campaign_id, status);
create index if not exists idx_messages_status on public.messages (status);
create index if not exists idx_messages_phone on public.messages (phone);
create index if not exists idx_messages_updated_at_desc on public.messages (updated_at desc);
create index if not exists idx_conversation_assignments_status on public.conversation_assignments (status);
create index if not exists idx_conversation_assignments_phone on public.conversation_assignments (phone);

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on table public.campaigns to service_role;
grant all privileges on table public.messages to service_role;
grant all privileges on table public.conversation_assignments to service_role;

grant select, insert, update, delete on table public.campaigns to anon, authenticated;
grant select, insert, update, delete on table public.messages to anon, authenticated;
grant select, insert, update, delete on table public.conversation_assignments to anon, authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Backend-only usage (recommended with service role key):
alter table public.campaigns disable row level security;
alter table public.messages disable row level security;
alter table public.conversation_assignments disable row level security;

-- If you need RLS for client-side access, enable and create strict policies.
-- alter table public.campaigns enable row level security;
-- alter table public.messages enable row level security;
-- alter table public.conversation_assignments enable row level security;
