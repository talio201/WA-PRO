#!/bin/bash

# Script de teste rápido - Criar campanha sem problemas de autenticação
# USO: ./test-campaign.sh

set -e

echo "🚀 Test Campaign Creation Without Auth Issues"
echo "============================================"

# Variáveis
BACKEND_URL="http://localhost:3000/api"
TEST_EMAIL="admin@example.com"
TEST_CAMPAIGN_NAME="Test Campaign $(date +%s)"

echo ""
echo "📍 Backend URL: $BACKEND_URL"
echo "📧 Test Email: $TEST_EMAIL"
echo "📝 Campaign Name: $TEST_CAMPAIGN_NAME"

# Step 1: Get Local Login Token
echo ""
echo "1️⃣ Obtendo token de login local..."
TOKEN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/public/auth/local-login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"testsecurepassword123\"
  }")

echo "Resposta:"
echo "$TOKEN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TOKEN_RESPONSE"

# Extract token
TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', {}).get('token', ''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Falha ao obter token!"
  exit 1
fi

echo "✅ Token obtido: ${TOKEN:0:30}..."

# Step 2: Test Campaign Creation
echo ""
echo "2️⃣ Criando campanha de teste..."
CAMPAIGN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/campaigns" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$TEST_CAMPAIGN_NAME\",
    \"description\": \"Teste de campanha criada via script automatizado\",
    \"type\": \"whatsapp\"
  }")

echo "Resposta:"
echo "$CAMPAIGN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CAMPAIGN_RESPONSE"

# Check if success
if echo "$CAMPAIGN_RESPONSE" | grep -q '"id"'; then
  echo ""
  echo "✅ SUCESSO! Campanha criada com sucesso."
  echo "🎉 Sistema está funcionando!"
else
  echo ""
  echo "⚠️ Falha na criação, verifique a resposta acima."
fi

echo ""
echo "============================================"
echo "Teste concluído!"
