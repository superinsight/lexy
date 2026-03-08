#!/usr/bin/env bash
set -euo pipefail

# Configure the gateway + proxy routing for local dev.
# Writes directly to ~/.openclaw/openclaw.json (no CLI dependency).
#
# Usage:
#   ./lexy/setup-proxy.sh proxy    — configure gateway + route LLM calls through the proxy
#   ./lexy/setup-proxy.sh status   — show current configuration

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PROXY_BASE="${LEXY_PROXY_BASE_URL:-http://localhost:4000}"
PROXY_BASE="${PROXY_BASE%/}"
PROXY_KEY="${LEXY_PROXY_API_KEY:-}"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

GATEWAY_PORT=18789
PORTAL_PORT=5174

case "${1:-status}" in
  proxy)
    if [ -z "$PROXY_KEY" ]; then
      echo "Error: LEXY_PROXY_API_KEY not set in $ENV_FILE"
      exit 1
    fi

    echo "==> Configuring local dev (gateway :${GATEWAY_PORT}, portal :${PORTAL_PORT})"
    echo ""

    mkdir -p "$(dirname "$CONFIG_FILE")"

    node -e "
const fs = require('fs');
const cfgPath = '$CONFIG_FILE';

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}

// Gateway
cfg.gateway = cfg.gateway || {};
cfg.gateway.mode = 'local';
cfg.gateway.port = $GATEWAY_PORT;
cfg.gateway.bind = 'loopback';

const token = '$GATEWAY_TOKEN';
if (token) {
  cfg.gateway.auth = { mode: 'token', token };
}

cfg.gateway.controlUi = cfg.gateway.controlUi || {};
cfg.gateway.controlUi.allowedOrigins = [
  'http://localhost:$PORTAL_PORT',
  'http://127.0.0.1:$PORTAL_PORT',
  'http://localhost:$GATEWAY_PORT',
  'http://127.0.0.1:$GATEWAY_PORT',
];

// Proxy provider routes
cfg.models = cfg.models || {};
cfg.models.providers = cfg.models.providers || {};

const routes = {
  openai:    '/openai/v1',
  anthropic: '/anthropic/v1',
  google:    '/gemini/v1',
};

const proxyBase = '$PROXY_BASE';
const proxyKey  = '$PROXY_KEY';

for (const [provider, path] of Object.entries(routes)) {
  const existing = cfg.models.providers[provider] || {};
  cfg.models.providers[provider] = {
    ...existing,
    baseUrl: proxyBase + path,
    apiKey:  proxyKey,
    models:  existing.models || [],
  };
}

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
"

    echo "  Gateway   → ws://localhost:${GATEWAY_PORT}"
    echo "  Portal    → http://localhost:${PORTAL_PORT}"
    [ -n "$GATEWAY_TOKEN" ] && echo "  Token     → ${GATEWAY_TOKEN}"
    echo ""
    echo "  OpenAI    → ${PROXY_BASE}/openai/v1"
    echo "  Anthropic → ${PROXY_BASE}/anthropic/v1"
    echo "  Gemini    → ${PROXY_BASE}/gemini/v1"
    echo ""
    echo "Done. Restart the gateway for changes to take effect."
    ;;

  status)
    echo "==> Current gateway config:"
    echo ""
    node -e "
const fs = require('fs');
try {
  const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
  const gw = cfg.gateway || {};
  console.log('  Gateway   → ws://localhost:' + (gw.port || '(not set)'));
  console.log('  Token     → ' + (gw.auth?.token || '(not set)'));
  console.log('');
  const providers = cfg.models?.providers;
  if (!providers || Object.keys(providers).length === 0) {
    console.log('  (no providers configured)');
  } else {
    for (const [name, p] of Object.entries(providers)) {
      console.log('  ' + name.padEnd(12) + '→ ' + (p.baseUrl || '(no baseUrl)'));
    }
  }
} catch {
  console.log('(config file not found: $CONFIG_FILE)');
}
"
    ;;

  *)
    echo "Usage: $0 {proxy|status}"
    echo ""
    echo "  proxy   — configure gateway + route LLM calls through proxy"
    echo "  status  — show current configuration"
    exit 1
    ;;
esac
