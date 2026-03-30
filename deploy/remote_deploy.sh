#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy/remote_deploy.sh <user> <host> <port> [remote_dir]
# Example: ./deploy/remote_deploy.sh root 144.126.214.121 52088 /opt/emidiawhats

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <user> <host> <port> [remote_dir]" >&2
  exit 2
fi

USER="$1"
HOST="$2"
PORT="$3"
REMOTE_DIR="${4:-/opt/emidiawhats}"

ARCHIVE="emidiawhats_deploy_$(date +%Y%m%d%H%M%S).tar.gz"

echo "Packing workspace into ${ARCHIVE}..."
tar --exclude='.git' --exclude='node_modules' --exclude='**/node_modules' -czf "/tmp/${ARCHIVE}" .

echo "Uploading to ${USER}@${HOST}:${REMOTE_DIR} (port ${PORT})..."
ssh -p "${PORT}" "${USER}@${HOST}" "mkdir -p ${REMOTE_DIR}"
scp -P "${PORT}" "/tmp/${ARCHIVE}" "${USER}@${HOST}:${REMOTE_DIR}/"

echo "Extracting on remote..."
ssh -p "${PORT}" "${USER}@${HOST}" bash -lc "set -e; cd ${REMOTE_DIR}; tar xzf ${ARCHIVE}; rm -f ${ARCHIVE}; mv emidiawhats_deploy_* current_tmp || true; if [ -d current ]; then rm -rf current_old || true; mv current current_old || true; fi; mv current_tmp current; cd current;"

echo "Installing backend dependencies and building frontend on remote..."
ssh -p "${PORT}" "${USER}@${HOST}" bash -lc "cd ${REMOTE_DIR}/current/backend && npm ci --production && cd ${REMOTE_DIR}/current/webapp && npm ci && npm run build || true"

echo "Setting up systemd service (requires sudo) and restarting..."
ssh -p "${PORT}" "${USER}@${HOST}" bash -lc "sudo cp ${REMOTE_DIR}/current/deploy/backend.service /etc/systemd/system/emidiawhats-backend.service 2>/dev/null || true; sudo systemctl daemon-reload; sudo systemctl enable emidiawhats-backend.service; sudo systemctl restart emidiawhats-backend.service"

echo "Cleaning up local temp archive..."
rm -f "/tmp/${ARCHIVE}"

echo "Deploy complete. Check service status with: sudo systemctl status emidiawhats-backend.service"
