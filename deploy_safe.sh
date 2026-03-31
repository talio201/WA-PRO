#!/bin/bash
set -e

echo '[1/4] Criando backup automático do diretório raiz...'
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
BACKUP_PATH="/root/EmidiaWhats_backup_${TIMESTAMP}.tar.gz"
tar -czvf "$BACKUP_PATH" --exclude='node_modules' --exclude='whatsapp_session' --exclude='.git' -C /opt EmidiaWhats
echo "✔️ Backup salvo em $BACKUP_PATH"

echo '[2/4] Atualizando repositório...'
cd /opt/EmidiaWhats || exit
# git pull origin main (descomente caso utilize git pull no servidor)

echo '[3/4] Reconstruindo imagens Docker...'
docker compose build

echo '[4/4] Subindo os containers (Restart)...'
docker compose up -d

echo '✅ Deploy automático e backup concluídos com sucesso!'
