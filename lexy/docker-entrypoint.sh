#!/usr/bin/env bash
set -euo pipefail

GATEWAY_PORT="${GATEWAY_PORT:-18789}"
PORTAL_PORT="${PORTAL_PORT:-5174}"
GATEWAY_BIND="${GATEWAY_BIND:-lan}"
OPENCLAW_DIR="${HOME}/.openclaw"
CONFIG_FILE="${OPENCLAW_DIR}/openclaw.json"

# ---------- 1. Deploy Lexy workspace config ----------
echo "==> Deploying Lexy workspace config..."
bash /app/lexy/setup.sh --force \
  --workspace "${OPENCLAW_WORKSPACE_DIR:-${OPENCLAW_DIR}/workspace}"

# ---------- 2. Write gateway config (merge, preserving user-saved settings) ----------
# Auto-generate a token if one isn't supplied via env.
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")}"
export OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN"

mkdir -p "$OPENCLAW_DIR"
node -e "
const fs = require('fs');
const cfgPath = '${CONFIG_FILE}';
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
cfg.gateway = cfg.gateway || {};
cfg.gateway.mode = 'local';
cfg.gateway.port = ${GATEWAY_PORT};
cfg.gateway.bind = '${GATEWAY_BIND}';
cfg.gateway.auth = { mode: 'token', token: '${GATEWAY_TOKEN}' };
cfg.gateway.controlUi = cfg.gateway.controlUi || {};
cfg.gateway.controlUi.allowedOrigins = [
  'http://localhost:${PORTAL_PORT}',
  'http://127.0.0.1:${PORTAL_PORT}',
  'http://localhost:${GATEWAY_PORT}',
  'http://127.0.0.1:${GATEWAY_PORT}'
];
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
"

# ---------- 3. Inject token into the portal ----------
# Always re-inject so the token stays current across container restarts.
PORTAL_INDEX="/app/lexy/portal/dist/index.html"
PORTAL_ORIG="/app/lexy/portal/dist/index.html.orig"
if [ -f "$PORTAL_INDEX" ]; then
  # Keep a pristine copy so we can re-inject cleanly on every start.
  if [ ! -f "$PORTAL_ORIG" ]; then
    cp "$PORTAL_INDEX" "$PORTAL_ORIG"
  fi
  cp "$PORTAL_ORIG" "$PORTAL_INDEX"
  INJECT="<script id=\"lexy-docker-bootstrap\">"
  INJECT+="localStorage.setItem('gateway_token','${GATEWAY_TOKEN}');"
  INJECT+="localStorage.setItem('gateway_url','ws://'+location.hostname+':${GATEWAY_PORT}');"
  INJECT+="<\/script>"
  sed -i "s|<head>|<head>${INJECT}|" "$PORTAL_INDEX" || echo "WARN: could not inject token into portal"
fi

# ---------- 4. Start gateway ----------
echo "==> Starting gateway on port ${GATEWAY_PORT}..."
node /app/openclaw.mjs gateway \
  --port "$GATEWAY_PORT" \
  --bind "$GATEWAY_BIND" &
GATEWAY_PID=$!

# ---------- 5. Start portal static server ----------
echo "==> Starting Lexy portal on port ${PORTAL_PORT}..."
npx serve /app/lexy/portal/dist \
  --listen "$PORTAL_PORT" \
  --single \
  --no-clipboard &
PORTAL_PID=$!

# ---------- Graceful shutdown ----------
cleanup() {
  echo "==> Shutting down..."
  kill "$GATEWAY_PID" "$PORTAL_PID" 2>/dev/null || true
  wait "$GATEWAY_PID" "$PORTAL_PID" 2>/dev/null || true
}
trap cleanup SIGTERM SIGINT

echo ""
echo "==> Lexy is ready."
echo "    Portal:  http://localhost:${PORTAL_PORT}"
echo "    Gateway: ws://localhost:${GATEWAY_PORT}"
echo ""

# Wait for either process to exit; if one dies, shut down both.
wait -n "$GATEWAY_PID" "$PORTAL_PID"
cleanup
