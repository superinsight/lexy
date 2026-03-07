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

To run the portal:

```bash
cd lexy/portal
npm install
npm run dev
```

Then open: `http://localhost:5174/?gateway=ws://localhost:18789&token=YOUR_TOKEN`

## Integrations

### Google Workspace (Planned)

- Gmail - Read and send emails
- Calendar - View and manage events
- Drive - Search and read documents

These integrations will allow attorneys to connect their Google Workspace accounts and let Lexy assist with email, scheduling, and document management.
