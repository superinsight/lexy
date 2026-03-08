#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"

usage() {
  echo "Usage: $0 [--force] [--workspace <path>]"
  echo ""
  echo "Deploy Lexy workspace templates to the OpenClaw workspace directory."
  echo ""
  echo "Options:"
  echo "  --force         Overwrite existing files (default: skip if exists)"
  echo "  --workspace     Target workspace directory (default: ~/.openclaw/workspace)"
  echo "  --help          Show this help message"
}

FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    --workspace) WORKSPACE_DIR="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [ ! -d "$CONFIG_DIR" ]; then
  echo "Error: Config directory not found at $CONFIG_DIR"
  exit 1
fi

mkdir -p "$WORKSPACE_DIR"

TEMPLATES=(
  "SOUL.md"
  "AGENTS.md"
  "IDENTITY.md"
  "USER.md"
  "TOOLS.md"
  "HEARTBEAT.md"
  "BOOTSTRAP.md"
)

copied=0
skipped=0

for template in "${TEMPLATES[@]}"; do
  src="$CONFIG_DIR/$template"
  dst="$WORKSPACE_DIR/$template"

  if [ ! -f "$src" ]; then
    echo "  SKIP  $template (not found in config/)"
    continue
  fi

  if [ -f "$dst" ] && [ "$FORCE" = false ]; then
    echo "  EXISTS $template (use --force to overwrite)"
    skipped=$((skipped + 1))
  else
    cp "$src" "$dst"
    echo "  COPIED $template"
    copied=$((copied + 1))
  fi
done

echo ""
echo "Done. $copied copied, $skipped skipped."
echo "Workspace: $WORKSPACE_DIR"
