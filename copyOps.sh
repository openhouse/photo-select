#!/usr/bin/env bash
set -euo pipefail

copy_file() {
  local src="$1" dst="$2" strategy="${3:-auto}"
  mkdir -p "$(dirname "$dst")"
  case "$strategy" in
    clone)
      if cp -c -p -- "$src" "$dst" 2>/dev/null; then echo clone; return; fi
      ;;
    hardlink)
      if ln "$src" "$dst" 2>/dev/null; then echo hardlink; return; fi
      ;;
    move)
      if mv "$src" "$dst" 2>/dev/null; then echo move; return; fi
      ;;
  esac
  if cp -c -p -- "$src" "$dst" 2>/dev/null; then echo clone; return; fi
  if ln "$src" "$dst" 2>/dev/null; then echo hardlink; return; fi
  cp -p -- "$src" "$dst"
  echo copy
}

copy_tree() {
  local src="$1" dst="$2" strategy="${3:-auto}"
  mkdir -p "$dst"
  find "$src" -type f | while IFS= read -r file; do
    rel="${file#$src/}"
    target="$dst/$rel"
    mkdir -p "$(dirname "$target")"
    mode="$(copy_file "$file" "$target" "$strategy")"
    printf '{"op":"copy","from":"%s","to":"%s","mode":"%s"}\n' "$file" "$target" "$mode"
  done
}

if [[ "$#" -lt 2 ]]; then
  echo "usage: copyOps.sh [-r] [--strategy mode] SRC DST" >&2
  exit 2
fi

strategy="auto"
recursive=0
args=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -r|--recursive) recursive=1; shift ;;
    --strategy) strategy="$2"; shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done

src="${args[-2]}"
dst="${args[-1]}"
if [[ "$recursive" -eq 1 ]]; then
  copy_tree "$src" "$dst" "$strategy"
else
  mode="$(copy_file "$src" "$dst" "$strategy")"
  printf '{"op":"copy","from":"%s","to":"%s","mode":"%s"}\n' "$src" "$dst" "$mode"
fi
