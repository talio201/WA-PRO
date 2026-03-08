-- Fix permissions for WhatsApp Campaign Manager tables in Supabase.
-- Run this in Supabase SQL Editor on the target project.

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

grant all privileges on table public.campaigns to service_role;
grant all privileges on table public.messages to service_role;
grant all privileges on table public.conversation_assignments to service_role;

grant select, insert, update, delete on table public.campaigns to anon, authenticated;
grant select, insert, update, delete on table public.messages to anon, authenticated;
grant select, insert, update, delete on table public.conversation_assignments to anon, authenticated;

alter table if exists public.campaigns disable row level security;
alter table if exists public.messages disable row level security;
alter table if exists public.conversation_assignments disable row level security;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
