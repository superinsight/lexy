# Lexy Portal

A lightweight chat interface for Lexy AI Legal Assistant.

## Setup

```bash
cd portal
npm install
```

## Development

```bash
npm run dev
```

This starts the dev server at `http://localhost:5173` (or next available port).

## Build

```bash
npm run build
```

## Preview Production Build

```bash
npm run preview
```

## Configuration

The portal connects to the Lexy gateway. Make sure the gateway is running:

```bash
# From the root directory
pnpm gateway:watch
```

## URL Parameters

The portal accepts the following URL parameters:

| Parameter  | Description             | Default                |
| ---------- | ----------------------- | ---------------------- |
| `gateway`  | Gateway WebSocket URL   | `ws://localhost:18789` |
| `session`  | Session key             | `portal-admin`         |
| `token`    | Authentication token    | -                      |
| `password` | Authentication password | -                      |

### Examples

**Basic (local gateway):**

```
http://localhost:5173
```

**Custom gateway URL:**

```
http://localhost:5173?gateway=ws://192.168.1.100:18789
```

**With authentication token:**

```
http://localhost:5173?gateway=ws://localhost:18789&token=your-token-here
```

**With password authentication:**

```
http://localhost:5173?gateway=ws://localhost:18789&password=your-password
```

**Custom session:**

```
http://localhost:5173?session=my-custom-session&token=your-token
```

**Full example with all parameters:**

```
http://localhost:5173?gateway=ws://myserver:18789&session=legal-chat&token=abc123
```
