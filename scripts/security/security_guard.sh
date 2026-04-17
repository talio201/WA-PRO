#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="$ROOT_DIR/security-reports"
FAST_MODE="${1:-}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$REPORT_DIR"

FAILURES=0
WARNINGS=0

GITLEAKS_MODE=""

log() {
  echo "[security-guard] $*"
}

run_check() {
  local name="$1"
  shift
  log "Running: ${name}"
  if "$@"; then
    log "PASS: ${name}"
  else
    log "FAIL: ${name}"
    FAILURES=$((FAILURES + 1))
  fi
}

run_optional() {
  local name="$1"
  shift
  log "Running (optional): ${name}"
  if "$@"; then
    log "PASS: ${name}"
  else
    log "WARN: ${name}"
    WARNINGS=$((WARNINGS + 1))
  fi
}

check_forbidden_files() {
  local forbidden='(^|/)(\.env(\..*)?$|id_rsa(\.pub)?$|id_ed25519(\.pub)?$|ed25519(\.pub)?$|.*\.(pem|key|p12|pfx|jks|kdbx|ovpn|crt|cer)$|.*credentials.*|.*secret.*)'
  local bad_files
  bad_files=$(git -C "$ROOT_DIR" ls-files | grep -E "$forbidden" | grep -Ev '(^|/)\.env\.example$' || true)
  if [[ -n "$bad_files" ]]; then
    echo "$bad_files"
    return 1
  fi
  return 0
}

gitleaks_worktree() {
  local scan_root config_path report_path
  scan_root="$(gitleaks_path "$ROOT_DIR")"
  config_path="$(gitleaks_path "$ROOT_DIR/.gitleaks.toml")"
  report_path="$(gitleaks_path "$REPORT_DIR/gitleaks-worktree-$TIMESTAMP.json")"
  run_gitleaks dir "$scan_root" \
    --config "$config_path" \
    --redact \
    --report-format json \
    --report-path "$report_path"
}

gitleaks_history() {
  local scan_root config_path report_path
  scan_root="$(gitleaks_path "$ROOT_DIR")"
  config_path="$(gitleaks_path "$ROOT_DIR/.gitleaks.toml")"
  report_path="$(gitleaks_path "$REPORT_DIR/gitleaks-history-$TIMESTAMP.json")"
  run_gitleaks git "$scan_root" \
    --config "$config_path" \
    --redact \
    --report-format json \
    --report-path "$report_path"
}

gitleaks_path() {
  local host_path="$1"
  if [[ "$GITLEAKS_MODE" == "docker" ]]; then
    if [[ "$host_path" == "$ROOT_DIR" ]]; then
      echo "/repo"
      return 0
    fi
    echo "/repo/${host_path#"$ROOT_DIR"/}"
    return 0
  fi
  echo "$host_path"
}

setup_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    GITLEAKS_MODE="local"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    GITLEAKS_MODE="docker"
    return 0
  fi

  return 1
}

run_gitleaks() {
  if [[ "$GITLEAKS_MODE" == "local" ]]; then
    gitleaks "$@"
    return $?
  fi

  if [[ "$GITLEAKS_MODE" == "docker" ]]; then
    docker run --rm \
      -v "$ROOT_DIR:/repo" \
      -w /repo \
      zricethezav/gitleaks:latest \
      "$@"
    return $?
  fi

  return 1
}

audit_npm_dir() {
  local dir="$1"
  (cd "$dir" && npm audit --omit=dev --audit-level=high)
}

audit_python_requirements() {
  if ! command -v pip-audit >/dev/null 2>&1; then
    return 2
  fi
  pip-audit -r "$ROOT_DIR/python_bot/requirements.txt" --strict
}

github_secret_alerts() {
  if ! command -v gh >/dev/null 2>&1; then
    return 2
  fi

  local repo
  repo=$(git -C "$ROOT_DIR" remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+)(\.git)?#\1#')
  if [[ -z "$repo" ]]; then
    return 2
  fi

  local output_file="$REPORT_DIR/github-secret-scanning-$TIMESTAMP.json"
  if gh api "repos/$repo/secret-scanning/alerts?state=open&per_page=100" > "$output_file"; then
    local count
    count=$(jq 'length' "$output_file" 2>/dev/null || echo "0")
    log "GitHub secret alerts open: $count"
    [[ "$count" == "0" ]]
  else
    return 2
  fi
}

if ! setup_gitleaks; then
  log "FAIL: gitleaks não encontrado e Docker indisponível"
  exit 1
fi

log "Gitleaks mode: $GITLEAKS_MODE"

run_check "Forbidden tracked files" check_forbidden_files
run_check "Gitleaks working tree" gitleaks_worktree

if [[ "$FAST_MODE" != "--fast" ]]; then
  run_check "Gitleaks git history" gitleaks_history
  run_optional "GitHub secret scanning alerts" github_secret_alerts
fi

if [[ -f "$ROOT_DIR/backend/package.json" ]]; then
  run_check "npm audit backend" audit_npm_dir "$ROOT_DIR/backend"
fi

if [[ -f "$ROOT_DIR/webapp/package.json" ]]; then
  run_check "npm audit webapp" audit_npm_dir "$ROOT_DIR/webapp"
fi

if [[ -f "$ROOT_DIR/package.json" ]]; then
  run_check "npm audit root" audit_npm_dir "$ROOT_DIR"
fi

if [[ -f "$ROOT_DIR/python_bot/requirements.txt" ]]; then
  if command -v pip-audit >/dev/null 2>&1; then
    run_check "pip-audit python_bot" audit_python_requirements
  else
    log "WARN: pip-audit não encontrado; instale com: pip install pip-audit"
    WARNINGS=$((WARNINGS + 1))
  fi
fi

log "Summary: failures=$FAILURES warnings=$WARNINGS"
if [[ "$FAILURES" -gt 0 ]]; then
  exit 1
fi
