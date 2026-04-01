-- Optional: enable RLS for multi-tenant safety and Supabase Realtime.
-- Ensure backend uses SUPABASE_SERVICE_ROLE_KEY before enabling.

alter table public.campaigns enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_assignments enable row level security;
alter table public.contacts enable row level security;

create policy "tenant_select_campaigns" on public.campaigns
  for select
  using (tenant_id = auth.uid()::text);

create policy "tenant_mutate_campaigns" on public.campaigns
  for insert
  with check (tenant_id = auth.uid()::text);

create policy "tenant_update_campaigns" on public.campaigns
  for update
  using (tenant_id = auth.uid()::text)
  with check (tenant_id = auth.uid()::text);

create policy "tenant_delete_campaigns" on public.campaigns
  for delete
  using (tenant_id = auth.uid()::text);

create policy "tenant_select_messages" on public.messages
  for select
  using (tenant_id = auth.uid()::text);

create policy "tenant_mutate_messages" on public.messages
  for insert
  with check (tenant_id = auth.uid()::text);

create policy "tenant_update_messages" on public.messages
  for update
  using (tenant_id = auth.uid()::text)
  with check (tenant_id = auth.uid()::text);

create policy "tenant_delete_messages" on public.messages
  for delete
  using (tenant_id = auth.uid()::text);

create policy "tenant_select_conversations" on public.conversation_assignments
  for select
  using (tenant_id = auth.uid()::text);

create policy "tenant_mutate_conversations" on public.conversation_assignments
  for insert
  with check (tenant_id = auth.uid()::text);

create policy "tenant_update_conversations" on public.conversation_assignments
  for update
  using (tenant_id = auth.uid()::text)
  with check (tenant_id = auth.uid()::text);

create policy "tenant_delete_conversations" on public.conversation_assignments
  for delete
  using (tenant_id = auth.uid()::text);

create policy "tenant_select_contacts" on public.contacts
  for select
  using (tenant_id = auth.uid()::text);

create policy "tenant_mutate_contacts" on public.contacts
  for insert
  with check (tenant_id = auth.uid()::text);

create policy "tenant_update_contacts" on public.contacts
  for update
  using (tenant_id = auth.uid()::text)
  with check (tenant_id = auth.uid()::text);

create policy "tenant_delete_contacts" on public.contacts
  for delete
  using (tenant_id = auth.uid()::text);
