Arquitetura e Implementacao - WhatsApp Campaign Manager

Visao geral
Sistema de gerenciamento de campanhas para WhatsApp com:
- Backend Node.js + Express
- Persistencia local JSON ou Supabase
- Extensao Chrome (options dashboard + content script + service worker)

Estado atual (implementado)

1) Persistencia e dados
- Provider selecionavel por `STORAGE_PROVIDER` (`local` ou `supabase`).
- Tabelas principais no Supabase: `campaigns`, `messages`, `conversation_assignments`.
- Fluxo de atendimento compartilhado por atribuicao de conversa por telefone.

2) Realtime e webhooks
- WebSocket no backend em `ws://localhost:3000/ws`.
- Eventos emitidos para campanhas, mensagens, atribuicoes, upload e IA.
- Webhooks de saida configuraveis por `WEBHOOK_TARGETS` (lista separada por virgula).
- Assinatura opcional HMAC SHA-256 por `WEBHOOK_SECRET` em header `X-WA-Signature`.

3) Frontend (dashboard/options)
- Aba Atendimentos:
  - Visual glass
  - Lista de conversas + timeline
  - Acoes por mensagem: copiar, reenviar, encaminhar
  - Botao de colar do clipboard no composer
  - Envio direto sem foco forcado na aba do WhatsApp
- Aba Campanhas e Contatos:
  - Consumo de WebSocket para atualizacao orientada a evento
  - Fallback por intervalo quando websocket estiver desconectado

4) Service worker (envio)
- Fila de campanhas continua ativa com estrategia atual (sem API oficial WhatsApp).
- Gatilho por websocket para acordar a fila quando houver novos eventos relevantes.
- Humanizacao reforcada:
  - digitacao humanizada
  - navegacao hibrida (DOM + fallback URL)
  - pausas longas ocasionais apos blocos de envios

Avaliacao da stack

Stack atual (Node + extensao Chrome + Supabase) continua viavel para o estagio atual por 3 motivos:
1. Controle total do fluxo customizado de envio
2. Custo operacional baixo
3. Iteracao rapida de produto

Limites conhecidos da stack atual:
1. Dependencia de seletor/DOM do WhatsApp Web
2. Risco operacional em automacao nao oficial
3. Escalabilidade horizontal limitada no envio por navegador

Recomendacao objetiva
- Curto prazo (agora): manter stack atual, com realtime + ownership + observabilidade (feito).
- Medio prazo: extrair "event bus" interno (Redis/NATS) e fila dedicada de jobs para reduzir acoplamento com polling.
- Longo prazo: planejar migracao gradual para provedor oficial/semioficial quando objetivo for escala e compliance.
