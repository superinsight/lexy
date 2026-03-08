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

To stop and clean up:

```bash
docker compose -f lexy/docker-compose.yml down

# Also remove persisted data (resets saved model/API key settings)
docker volume rm lexy_lexy-data
```

## Integrations

### Google Workspace (Planned)

- Gmail - Read and send emails
- Calendar - View and manage events
- Drive - Search and read documents

These integrations will allow attorneys to connect their Google Workspace accounts and let Lexy assist with email, scheduling, and document management.
