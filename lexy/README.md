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
├── setup.sh             # Deploy config to ~/.openclaw/workspace/
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
./lexy/setup.sh

# Force overwrite all templates
./lexy/setup.sh --force

# Custom workspace path
./lexy/setup.sh --workspace /path/to/workspace
```

The script skips files that already exist unless `--force` is passed, so user customizations are preserved.

## Portal

The portal (`lexy/portal/`) is a simplified chat interface designed for non-technical legal users. It connects to the OpenClaw gateway and provides a clean UI for attorneys to interact with Lexy.

### Local Development

Start the gateway and portal in two separate terminals:

```bash
# Terminal 1: Start the gateway
pnpm gateway:dev

# Terminal 2: Start the portal
cd lexy/portal
npm install
npm run dev
```

For auto-rebuild and reload on source changes, use `gateway:watch` instead:

```bash
# Terminal 1: Gateway with auto-rebuild + restart on source changes
pnpm gateway:watch

# Terminal 2: Portal with Vite hot-reload (already watches by default)
cd lexy/portal && npm run dev
```

Find the gateway token (dev mode uses `~/.openclaw-dev/`):

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.openclaw-dev/openclaw.json','utf8')).gateway?.auth?.token)"
```

Then open (dev gateway runs on port 19001):

```
http://localhost:5174/?gateway=ws://localhost:19001&token=YOUR_TOKEN
```

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

#### Pre-configuring the AI model

To avoid requiring users to enter their own API key in Settings, add the key and default model to `lexy/.env`:

```env
# Provide the key for your chosen provider
OPENAI_API_KEY=sk-...
# Or: ANTHROPIC_API_KEY=sk-ant-...
# Or: GEMINI_API_KEY=AI...

# Set the default model (provider/model format)
LEXY_DEFAULT_MODEL=openai/gpt-5.4
```

The entrypoint injects these into the gateway config on every container start. Users can still change the model via Settings if needed.

#### Proxy mode (usage metering and billing)

Instead of calling OpenAI/Anthropic/Gemini directly, you can route all LLM API calls through your own proxy server. This lets you track per-customer token usage, enforce quotas, and disable access when limits are exceeded.

```env
# Your proxy server URL
LEXY_PROXY_BASE_URL=https://your-proxy.example.com

# Per-customer API key that your proxy validates
LEXY_PROXY_API_KEY=customer-abc-key-123
```

When `LEXY_PROXY_BASE_URL` is set, the entrypoint rewrites all provider base URLs:

| Provider  | Proxied URL                          |
| --------- | ------------------------------------ |
| OpenAI    | `{LEXY_PROXY_BASE_URL}/openai/v1`    |
| Anthropic | `{LEXY_PROXY_BASE_URL}/anthropic/v1` |
| Google    | `{LEXY_PROXY_BASE_URL}/gemini/v1`    |

The `LEXY_PROXY_API_KEY` is sent as the `Authorization: Bearer` header on every LLM request. Your proxy validates it, meters usage, and forwards to the real provider.

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
