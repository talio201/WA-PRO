#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/EmidiaWhats}"
OUT_DIR="${2:-/tmp/wa-pro-diagnostics}"

mkdir -p "$OUT_DIR"

echo "[diagnose] App dir: $APP_DIR"
echo "[diagnose] Output dir: $OUT_DIR"

if [ ! -d "$APP_DIR" ]; then
  echo "[diagnose] ERROR: diretorio da aplicacao nao encontrado: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[diagnose] ERROR: docker nao encontrado"
  exit 1
fi

if ! docker compose ps >/dev/null 2>&1; then
  echo "[diagnose] ERROR: docker compose indisponivel ou stack fora do ar"
  exit 1
fi

echo "[diagnose] Coletando logs recentes..."
docker compose logs --since=48h backend > "$OUT_DIR/backend.log" 2>&1 || true
docker compose logs --since=48h python_bot > "$OUT_DIR/python_bot.log" 2>&1 || true
docker compose logs --since=48h backend_worker > "$OUT_DIR/backend_worker.log" 2>&1 || true

echo "[diagnose] Procurando sinais de risco de bloqueio e comportamento anomalo..."
{
  echo "===== multiline / enter ====="
  rg -n "Enter|\\n|line break|multiline|digita|typing" "$OUT_DIR/python_bot.log" || true
  echo ""
  echo "===== velocidade alta / anti-ban ====="
  rg -n "Anti-ban|espera restante|Envio imediato|skip_delay_once|despachado instantaneamente" "$OUT_DIR/python_bot.log" || true
  echo ""
  echo "===== erros de auth / sessão ====="
  rg -n "401|403|invalid_token|DISCONNECTED|QR|logout|ban|bloque" "$OUT_DIR/backend.log" "$OUT_DIR/python_bot.log" || true
} > "$OUT_DIR/summary.txt"

echo "[diagnose] Resumo gerado em: $OUT_DIR/summary.txt"
echo "[diagnose] Arquivos completos:"
ls -lh "$OUT_DIR"
