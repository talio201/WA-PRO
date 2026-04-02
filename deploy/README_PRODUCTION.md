# Producao - Guia Rapido

## Stack

- API Node.js (systemd service)
- Reverse proxy Nginx
- Webapp estatico servido pelo backend
- Bot supervisor (Python) quando aplicavel

## Checklist de Go-Live

- Variaveis de ambiente validadas (`backend/.env`).
- Build do webapp concluido sem erros.
- Servico backend ativo e healthcheck OK (`/health`).
- Realtime `/ws` validado em conexao autenticada.
- Acesso `/usuarios` e portal interno funcionando.

## Verificacao Pos-Deploy

- Login e logout de usuario.
- Carga de campanhas e contatos.
- Atualizacao de status do bot.
- Logs sem erros criticos em 15 minutos.
