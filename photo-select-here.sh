#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(pwd)"

# Route this opt-in feature to the configured worktree, preserving the caller cwd.
for arg in "$@"; do
  if [ "$arg" = "--github-all" ]; then
    checkout="$(git -C "$SCRIPT_DIR" config --local --get photoSelect.knowledgeCheckout 2>/dev/null || true)"
    if [ -n "$checkout" ] && [ "$checkout" != "$SCRIPT_DIR" ]; then
      if [ ! -f "$checkout/photo-select-here.sh" ]; then
        echo "Photo Select GitHub checkout is unavailable: $checkout" >&2
        exit 1
      fi
      SCRIPT_DIR="$checkout"
    fi
    break
  fi
done

# Load nvm if available
if [ -z "${NVM_DIR:-}" ]; then
  if [ -d "$HOME/.nvm" ]; then
    export NVM_DIR="$HOME/.nvm"
  fi
fi
if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
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
  exec node "$SCRIPT_DIR/src/index.js" "$@"
else
  exec node "$SCRIPT_DIR/src/index.js" "$@" --dir "$TARGET_DIR"
fi
