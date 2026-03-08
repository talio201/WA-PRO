-- Add conversation assignment support (shared atendimento ownership).
-- Run this in Supabase SQL Editor if your project already has campaigns/messages tables.

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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_conversation_assignments_updated_at on public.conversation_assignments;
create trigger trg_conversation_assignments_updated_at
before update on public.conversation_assignments
for each row execute function public.set_updated_at();

create index if not exists idx_conversation_assignments_status on public.conversation_assignments (status);
create index if not exists idx_conversation_assignments_phone on public.conversation_assignments (phone);

grant usage on schema public to anon, authenticated, service_role;
grant all privileges on table public.conversation_assignments to service_role;
grant select, insert, update, delete on table public.conversation_assignments to anon, authenticated;

alter table public.conversation_assignments disable row level security;
