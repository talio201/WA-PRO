#!/bin/bash

# SCRIPT DE SETUP FINAL - Configura tudo para funcionar

echo "============================================"
echo "⚙️ SETUP FINAL DO SISTEMA"
echo "============================================"
echo ""

# Navegar para backend
cd /workspaces/WA-PRO/backend

# 1. Parar servidor anterior
echo "1️⃣ Parando servidor anterior..."
pkill -f "node src/server" 2>/dev/null || true
sleep 2

# 2. Criar cliente admin autenticado no banco de dados
echo "2️⃣ Criando cliente admin no banco de dados..."
cat > /tmp/setup_admin.js << 'EOF'
const { 
  createClient,
  getValidApiKey,
  getAppConfig,
  registerInstallation,
  activateInstallation
} = require('/workspaces/WA-PRO/backend/src/config/adminStore.js');

// Gerar cliente admin
const admin = createClient({
  name: 'Admin Dev Client',
  description: 'Usuário admin para testes em desenvolvimento',
  active: true,
  permissions: {
    allowGemini: true,
    allowRealtime: true,
    allowCampaigns: true,
    allowContacts: true,
    allowInbox: true,
  }
});

console.log('✅ Cliente admin criado:');
console.log('  ClientId:', admin.clientId);
console.log('  ApiKey:', admin.apiKey);
console.log('');
console.log('Use este comando para testar:');
console.log(`curl -H "Authorization: Bearer ${admin.apiKey}" http://localhost:3000/api/campaigns`);
EOF

# Executar setup
node /tmp/setup_admin.js

# 3. Iniciar servidor
echo ""
echo "3️⃣ Iniciando servidor..."
timeout 3 node src/server.js > /tmp/server_setup.log 2>&1 &
sleep 5

# 4. Verificar se startou
if lsof -i :3000 > /dev/null; then
  echo "✅ Servidor iniciado na porta 3000"
else
  echo "❌ Erro ao iniciar servidor"
  cat /tmp/server_setup.log
  exit 1
fi

# 5. Testar
echo ""
echo "4️⃣ Testando..."
curl -s http://localhost:3000/api/public/runtime-config | head -c 50 && echo "... ✅" || echo "❌"

echo ""
echo "============================================"
echo "✅ SETUP CONCLUÍDO!"
echo "============================================"
