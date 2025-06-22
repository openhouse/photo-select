#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(pwd)"

# Load nvm if available
if [ -z "${NVM_DIR:-}" ]; then
  if [ -d "$HOME/.nvm" ]; then
    export NVM_DIR="$HOME/.nvm"
  fi
fi
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

# Use Node version from .nvmrc if nvm is available
if command -v nvm >/dev/null 2>&1; then
  nvm use "$SCRIPT_DIR" >/dev/null || true
fi

cd "$SCRIPT_DIR"

npx photo-select "$@" --dir "$TARGET_DIR"
