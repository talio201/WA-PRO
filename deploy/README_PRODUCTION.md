# Deploy to production server

Pré-requisitos (no servidor remoto):

- Node.js 18+ instalado
- `npm` disponível
- Usuário com privilégios `sudo` para instalar/gerenciar systemd

Passo a passo (local):

1. Garanta que você tenha commitado e enviado (`git push`) todas as alterações no repositório.
2. Execute o script de deploy localmente para empacotar e enviar os arquivos:

```bash
./deploy/remote_deploy.sh root 144.126.214.121 52088 /opt/emidiawhats
```

O script fará:
- empacotar o workspace (excluindo `node_modules` e `.git`)
- enviar para o servidor via `scp`
- extrair em `/opt/emidiawhats/current`
- instalar dependências do `backend` (`npm ci --production`)
- preparar o `webapp` (instalar e build)
- copiar e habilitar a unit `systemd` em `/etc/systemd/system/emidiawhats-backend.service` e reiniciar o serviço

Passo a passo (manual, se preferir):

1. No servidor:

```bash
sudo mkdir -p /opt/emidiawhats
sudo chown -R $(whoami):$(whoami) /opt/emidiawhats
cd /opt/emidiawhats
# git clone ... ou subir arquivo e extrair
```

2. Copiar o arquivo `.env.production` para `backend/.env.production` com as variáveis corretas (SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_ORIGINS etc.).

3. Instalar dependências e build:

```bash
cd /opt/emidiawhats/current/backend
npm ci --production
cd ../webapp
npm ci
npm run build
```

4. Copiar a unidade systemd (deploy/backend.service) para `/etc/systemd/system/emidiawhats-backend.service` e reiniciar:

```bash
sudo cp /opt/emidiawhats/current/deploy/backend.service /etc/systemd/system/emidiawhats-backend.service
sudo systemctl daemon-reload
sudo systemctl enable emidiawhats-backend.service
sudo systemctl restart emidiawhats-backend.service
sudo journalctl -u emidiawhats-backend.service -f
```

5. Verificar endpoint runtime-config:

```bash
curl -v http://localhost:3000/api/public/runtime-config
```
