# Lexy

This folder contains all Lexy-specific customizations that are separate from the upstream OpenClaw codebase.

## Structure

```
lexy/
├── portal/              # Lexy web portal for attorneys
│   └── src/
├── integrations/        # Lexy-specific integrations
│   └── google-workspace/  # Google Workspace (Gmail, Calendar, Drive)
└── README.md
```

## Why This Structure?

Lexy is built on top of OpenClaw. To keep upstream merges clean and avoid conflicts, all Lexy-specific code lives in this separate folder rather than modifying `src/`, `extensions/`, or `ui/`.

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
