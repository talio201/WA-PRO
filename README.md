# WA-PRO

Plataforma SaaS para operacao de campanhas WhatsApp, CRM de contatos e atendimento com backend Node.js + frontend React.

## Estado Atual do Sistema

- Backend principal em `backend/src/server.js` com API em `/api`.
- Webapp SaaS em `webapp/` servido no backend em `/usuarios`.
- Portal interno/administrativo servido em `/${ADMIN_PORTAL_PATH:-painel-interno}`.
- Realtime via WebSocket em `/ws` com eventos de campanhas, mensagens e bot.
- Autenticacao com Supabase e isolamento por `agentId`.

## Modulos Funcionais

- Campanhas: criacao, fila, dispatch incremental, retry de falhas.
- Contatos/CRM: importacao, edicao de estagio, score e proximas acoes.
- Atendimento: infraestrutura pronta no frontend (`Inbox.jsx`) e APIs de conversa no backend.
- Configuracoes: perfil de conta e sessao.

## Estrutura Principal

- `backend/`: API, regras de negocio, modelos e rotas.
- `webapp/`: SPA React (Vite + Tailwind).
- `python_bot/`: integracao operacional do bot.
- `deploy/` e `scripts/`: automacao de deploy e operacao.

## Melhorias Prioritarias (Nao Disruptivas)

- Padronizacao visual com design tokens globais.
- Unificacao de icones e estados visuais.
- Metricas mais realistas por agregacao no backend.
- Atualizacao realtime uniforme em todos os modulos.

## Como Rodar

### Backend

```bash
cd backend
npm install
npm run dev
```

### Webapp

```bash
cd webapp
npm install
npm run dev
```

## Versao de Documentacao

Este README descreve o baseline tecnico atualizado em abril/2026.
