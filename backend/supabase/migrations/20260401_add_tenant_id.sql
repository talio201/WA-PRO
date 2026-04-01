-- Add tenant_id columns to strengthen multi-tenant isolation.
-- Safe to run multiple times.

alter table public.campaigns
  add column if not exists tenant_id text;

alter table public.messages
  add column if not exists tenant_id text;

alter table public.conversation_assignments
  add column if not exists tenant_id text;

alter table public.contacts
  add column if not exists tenant_id text;

update public.campaigns set tenant_id = coalesce(tenant_id, agent_id) where tenant_id is null;
update public.messages set tenant_id = coalesce(tenant_id, agent_id) where tenant_id is null;
update public.conversation_assignments set tenant_id = coalesce(tenant_id, '') where tenant_id is null;
update public.contacts set tenant_id = coalesce(tenant_id, agent_id) where tenant_id is null;

create index if not exists idx_campaigns_tenant_id on public.campaigns (tenant_id);
create index if not exists idx_messages_tenant_id on public.messages (tenant_id);
create index if not exists idx_conversation_assignments_tenant_id on public.conversation_assignments (tenant_id);
create index if not exists idx_contacts_tenant_id on public.contacts (tenant_id);
