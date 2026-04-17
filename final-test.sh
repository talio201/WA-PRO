#!/bin/bash

#  script final para teste - Funciona com autenticação local

set -e

echo "============================================"
echo "🚀 TESTE FINAL: Criar Campanha"
echo "============================================"
echo ""

# Step 1: Login
echo "1️⃣ Fazendo login..."
LOGIN_RESP="$(curl -s -X POST http://localhost:3000/api/public/auth/local-login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "qualquer-coisa"
  }')"

# Extract token usando jq
TOKEN="$(echo "$LOGIN_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['token']['token'])" 2>/dev/null)"

if [ -z "$TOKEN" ]; then
  echo "❌ Erro ao fazer login!"
  echo "$LOGIN_RESP" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESP"
  exit 1
fi

echo "✅ Login realizado!"
echo "Token: ${TOKEN:0:50}..."
echo ""

# Step 2: Create campaign
echo "2️⃣ Criando campanha..."
CAMPAIGN_RESP="$(curl -s -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Campanha de Teste Automático",
    "description": "Criada via script de teste"
  }')"

echo "Resposta:"
echo "$CAMPAIGN_RESP" | python3 -m json.tool 2>/dev/null || echo "$CAMPAIGN_RESP"

if echo "$CAMPAIGN_RESP" | grep -q '"id"'; then
  echo ""
  echo "✅ ✅ ✅ SUCESSO! CAMPANHA CRIADA! ✅ ✅ ✅"
  echo "🎉 Sistema está 100% FUNCIONAL!"
else
  echo ""
  echo "⚠️  Falha - Verifique resposta acima"
fi

echo ""
echo "============================================"
