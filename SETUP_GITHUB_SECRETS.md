# Setup de Secrets (GitHub)

## Secrets Recomendados

- `PROD_HOST`: host de producao.
- `PROD_USER`: usuario SSH de deploy.
- `PROD_SSH_KEY`: chave privada para deploy remoto.
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_ANON_KEY`: chave anonima do frontend.
- `SUPABASE_SERVICE_ROLE_KEY`: chave service role (somente backend).
- `MONGODB_URI`: conexao do banco principal.
- `GOOGLE_API_KEY`: chave para recursos de IA (quando habilitado).
- `ADMIN_BOOTSTRAP_SECRET`: segredo para ativacao segura de admin via sessao Supabase.
- `ADMIN_BOOTSTRAP_ALLOWLIST_HASHES`: hashes SHA-256 opcionais de email ou user ID autorizados.

## Boas Praticas

- Nunca commitar `.env` no repositorio.
- Rotacionar chaves em incidentes e periodicamente.
- Separar secrets por ambiente (staging/producao).
- Limitar permissoes das chaves ao minimo necessario.
- Rotacionar o bootstrap secret apos o uso inicial.
