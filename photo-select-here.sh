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
  if ! nvm use "$SCRIPT_DIR" >/dev/null 2>&1; then
    echo "nvm: Node $(cat "$SCRIPT_DIR/.nvmrc") not installed; using system node $(node --version)" >&2
  fi
fi

cd "$SCRIPT_DIR"

# Optional memory tweak for large batches
if [ -n "${PHOTO_SELECT_MAX_OLD_SPACE_MB:-}" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=${PHOTO_SELECT_MAX_OLD_SPACE_MB}"
fi


dir_specified=false
for arg in "$@"; do
  case "$arg" in
    -d|--dir|--dir=*|-d=*)
      dir_specified=true
      break
      ;;
  esac
done

if [ "$dir_specified" = true ]; then
  npx photo-select "$@"
else
  npx photo-select "$@" --dir "$TARGET_DIR"
fi
