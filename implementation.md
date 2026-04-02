# Plano de Implementacao Profissional

## Objetivo

Evoluir o WA-PRO para um CRM conversacional em tempo real sem regressao operacional.

## Fase 1 - Estabilidade e Consistencia

- Corrigir build do webapp e dependencias de UI.
- Remover inconsistencias de encoding e microcopy.
- Ativar/normalizar modulos ja implementados no frontend.
- Garantir fallback de sincronizacao quando realtime cair.

## Fase 2 - Dados Realistas

- Criar endpoints de agregacao para cards e indicadores.
- Separar dados de volume historico vs janela recente.
- Exibir carimbo de ultima atualizacao por widget.

## Fase 3 - Operacao Profissional

- Cockpit executivo com funil, SLA e risco.
- Regras de priorizacao no atendimento.
- Campanhas por jornada e evento de CRM.
- Assistente de IA operacional para respostas e proximo passo.

## Criterios de Qualidade

- Sem quebra de rotas existentes.
- Sem mudanca de contrato de API sem compatibilidade.
- Build e fluxo de login funcionando ao final de cada lote.
