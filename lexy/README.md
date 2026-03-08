# Lexy

This folder contains all Lexy-specific customizations that are separate from the upstream OpenClaw codebase.

## Structure

```
lexy/
├── config/              # Workspace templates (SOUL.md, AGENTS.md, etc.)
├── portal/              # Lexy web portal for attorneys
│   └── src/
├── integrations/        # Lexy-specific integrations
│   └── google-workspace/  # Google Workspace (Gmail, Calendar, Drive)
├── setup-workspace.sh   # Deploy workspace templates to ~/.openclaw/workspace/
├── setup-proxy.sh       # Configure proxy routing for local dev
└── README.md
```

## Why This Structure?

Lexy is built on top of OpenClaw. To keep upstream merges clean and avoid conflicts, all Lexy-specific code lives in this separate folder rather than modifying `src/`, `extensions/`, or `ui/`.

## Config (Workspace Templates)

The `config/` folder contains Lexy-customized versions of the workspace `.md` files that the OpenClaw agent reads every session. These replace the generic upstream templates with legal-specific content.

| File           | Purpose                                                     |
| -------------- | ----------------------------------------------------------- |
| `SOUL.md`      | Lexy's personality, internet restrictions, security posture |
| `AGENTS.md`    | Workspace operating manual (stripped of non-legal features) |
| `IDENTITY.md`  | Pre-filled identity as "Lexy, AI Legal Assistant"           |
| `USER.md`      | Attorney profile template with legal-specific fields        |
| `TOOLS.md`     | Tool notes template with legal workflow examples            |
| `HEARTBEAT.md` | Periodic task config (minimal by default)                   |
| `BOOTSTRAP.md` | First-run onboarding flow for attorneys                     |

### Deploying to a workspace

Run the setup script to copy templates to `~/.openclaw/workspace/`:

```bash
# First-time setup (won't overwrite existing files)
./lexy/setup-workspace.sh

# Force overwrite all templates
./lexy/setup-workspace.sh --force

# Custom workspace path
./lexy/setup-workspace.sh --workspace /path/to/workspace
```

The script skips files that already exist unless `--force` is passed, so user customizations are preserved.

## Portal

The portal (`lexy/portal/`) is a simplified chat interface designed for non-technical legal users. It connects to the OpenClaw gateway and provides a clean UI for attorneys to interact with Lexy.

### Local Development

#### 1. Configure proxy routing

Edit `lexy/.env` with your proxy settings (see [AI Model Configuration](#ai-model-configuration-proxy-mode)), then apply them:

```bash
./lexy/setup-proxy.sh proxy
```

#### 2. Start the gateway and portal

```bash
# Terminal 1: Gateway with auto-rebuild + restart on source changes
pnpm gateway:watch

# Terminal 2: Portal with Vite hot-reload
cd lexy/portal && npm install && npm run dev
```

Then open the portal URL:

```
http://localhost:5174/?gateway=ws://localhost:19001&token=YOUR_TOKEN
```

#### Reconfigure proxy routing

```bash
# Check current configuration
./lexy/setup-proxy.sh status
```

Restart the gateway after making changes.

### Docker

Build and run Lexy in a single container (gateway + portal):

```bash
##Build and Start
docker compose -f lexy/docker-compose.yml --env-file lexy/.env up --build

# Build the image (run from repo root)
docker compose -f lexy/docker-compose.yml build

# Start the container
docker compose -f lexy/docker-compose.yml up -d

# View logs
docker compose -f lexy/docker-compose.yml logs -f
```

Once running, open the portal URL with your token:

```
http://localhost:5174/?token=YOUR_TOKEN
```

Find the auto-generated token:

```bash
docker exec lexy-lexy-1 node -e "console.log(JSON.parse(require('fs').readFileSync('/home/node/.openclaw/openclaw.json','utf8')).gateway.auth.token)"
```

Or set your own token via `lexy/.env`:

```env
OPENCLAW_GATEWAY_TOKEN=my-secret-token
```

#### AI Model Configuration (Proxy Mode)

All LLM API calls are routed through a proxy server. The proxy handles provider authentication, usage metering, and billing. No individual provider API keys are needed.

```env
LEXY_PROXY_BASE_URL=http://localhost:4000
LEXY_PROXY_API_KEY=lexy_abc123
```

When `LEXY_PROXY_BASE_URL` is set:

1. **Model discovery** — The portal Settings page fetches available models from `{LEXY_PROXY_BASE_URL}/models` (with `Authorization: Bearer {LEXY_PROXY_API_KEY}`). No models are hardcoded; the proxy is the source of truth.

2. **Message routing** — The gateway routes all LLM calls through the proxy:

| Provider  | Proxy path                           | Forwards to                                    |
| --------- | ------------------------------------ | ---------------------------------------------- |
| OpenAI    | `{LEXY_PROXY_BASE_URL}/openai/v1`    | `https://api.openai.com/v1`                    |
| Anthropic | `{LEXY_PROXY_BASE_URL}/anthropic/v1` | `https://api.anthropic.com/v1`                 |
| Gemini    | `{LEXY_PROXY_BASE_URL}/gemini/v1`    | `https://generativelanguage.googleapis.com/v1` |

The proxy is a transparent pass-through — request and response formats are identical to the native provider APIs. The `LEXY_PROXY_API_KEY` is sent as the `Authorization: Bearer` header on every request so the proxy can authenticate and meter usage.

##### Verify the proxy is reachable

```bash
curl -s http://localhost:4000/models \
  -H "Authorization: Bearer lexy_abc123" | python3 -m json.tool
```

See [`lexy/portal/SERVER.md`](portal/SERVER.md) for a complete guide on building the proxy service.

To stop and clean up:

```bash
docker compose -f lexy/docker-compose.yml down

# Also remove persisted data (resets saved model/API key settings)
docker volume rm lexy_lexy-data
```

## Notification API

Lexy exposes an HTTP endpoint that lets external systems (cron jobs, webhooks, scripts) push messages directly into a chat session. Messages appear in real time in the portal.

### Endpoint

```
POST http://<gateway-host>:<port>/api/notify
Content-Type: application/json
Authorization: Bearer <gateway-token>
```

### Request body

| Field        | Type   | Required | Description                                       |
| ------------ | ------ | -------- | ------------------------------------------------- |
| `sessionKey` | string | No       | Target session key. Defaults to the main session. |
| `message`    | string | Yes      | The notification text to display in the chat.     |
| `label`      | string | No       | Optional label for the transcript entry.          |

### Example: cron job reminder

```bash
curl -X POST http://localhost:19001/api/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Reminder: Filing deadline for Case #1234 is tomorrow."}'
```

### Example: target a specific session

```bash
curl -X POST http://localhost:19001/api/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "sessionKey": "portal-1709876543210-abc123",
    "message": "New document uploaded to the Arthur Miller folder."
  }'
```

### Response

```json
{ "ok": true, "messageId": "abc123" }
```

The portal tab title shows a badge (e.g. `(2) Lexy`) when messages arrive while the tab is in the background.

## Integrations

### Google Workspace (Planned)

- Gmail - Read and send emails
- Calendar - View and manage events
- Drive - Search and read documents

These integrations will allow attorneys to connect their Google Workspace accounts and let Lexy assist with email, scheduling, and document management.
