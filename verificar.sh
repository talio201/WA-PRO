#!/bin/bash

# Script de verificação rápida - execute para validar o sistema

echo "🔍 Verificação rápida do sistema..."
echo ""

# Verificar servidor
echo "1. Verificando servidor na porta 3000..."
if curl -s http://localhost:3000/api/public/runtime-config | grep -q "success"; then
  echo "   ✅ Servidor respondendo"
else
  echo "   ❌ Servidor não está respondendo"
  echo "   Execute: cd /workspaces/WA-PRO/backend && node src/server.js"
  exit 1
fi

# Verificar login
echo "2. Verificando autenticação local..."
if curl -s -X POST http://localhost:3000/api/public/auth/local-login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}' | grep -q "success"; then
  echo "   ✅ Login funciona"
else
  echo "   ❌ Login não está funcionando"
  exit 1
fi

# Verificar API com autenticação
echo "3. Verificando acesso às APIs..."
TOKEN=$(curl -s -X POST http://localhost:3000/api/public/auth/local-login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "   ❌ Não foi possível obter token de teste"
  exit 1
fi

if curl -s http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer $TOKEN" | grep -q "msg"; then
  echo "   ✅ Requisições autenticadas funcionam"
else
  echo "   ❌ Requisições autenticadas falhando"
  exit 1
fi

echo ""
echo "=========================================="
echo "✅ TODOS OS SISTEMAS ESTÃO OPERACIONAIS!"
echo "=========================================="
echo ""
echo "Para começar:"
echo "1. cd /workspaces/WA-PRO/backend"
echo "2. node src/server.js"
echo "3. Em outro terminal, use:"
echo "   curl -X POST http://localhost:3000/api/public/auth/local-login"
echo ""
