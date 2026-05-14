#!/bin/bash
#
# SessionStart hook: prepare the Claude Code on the web sandbox for the
# Last-Mile lifecycle eval runner.
#
# 1. Materialize .env.local from sandbox env vars so
#    evals/lastmile-lifecycle.ts can authenticate against staging.
#    QUIQUP_STAGING_CLIENT_ID / QUIQUP_STAGING_CLIENT_SECRET are
#    last-mile-scoped OAuth client_credentials from
#    qadmin.quiqup.com/oauth/clients. They must be injected into the
#    sandbox via Claude Code's session env settings (Vercel/GH Actions
#    secrets do not auto-flow in).
# 2. Install bun + npm deps so vitest and the bun-based eval runner work.
#
# Idempotent. Safe to re-run.

set -euo pipefail

# Only run in the remote (Claude Code on the web) sandbox. Local devs
# manage .env.local themselves.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- 1. Materialize .env.local from sandbox env vars --------------------

ENV_FILE=".env.local"

write_var() {
  local key="$1"
  local value="${!key:-}"
  if [ -z "$value" ]; then
    echo "  - $key: not set in sandbox env (skipping)"
    return 0
  fi
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # Replace existing line in-place.
    local tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
    mv "$tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  echo "  - $key: written"
}

echo "Materializing $ENV_FILE for Last-Mile lifecycle eval"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
write_var QUIQUP_STAGING_CLIENT_ID
write_var QUIQUP_STAGING_CLIENT_SECRET
write_var QUIQUP_LM_STAGING_BASE_URL

# --- 2. Install deps ----------------------------------------------------

if [ -f package.json ]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "Installing bun..."
    curl -fsSL https://bun.sh/install | bash >/dev/null
    export PATH="$HOME/.bun/bin:$PATH"
    echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "${CLAUDE_ENV_FILE:-/dev/null}" || true
  fi
  echo "Installing npm dependencies..."
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile 2>&1 | tail -20 || bun install 2>&1 | tail -20
  else
    npm install 2>&1 | tail -20
  fi
fi

echo "SessionStart hook complete."
