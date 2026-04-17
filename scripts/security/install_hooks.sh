#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT_DIR"
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push scripts/security/security_guard.sh

echo "Hooks de seguranca instalados com sucesso."
echo "- pre-commit: bloqueia arquivos sensiveis e secrets no staged"
echo "- pre-push: executa security_guard em modo rapido"
