#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

if command -v codexresets >/dev/null 2>&1; then
  exec codexresets "$@"
fi

configured_binary="$PLUGIN_ROOT/.codexresets-bin"
if [[ -r "$configured_binary" ]]; then
  IFS= read -r binary < "$configured_binary"
  if [[ -x "$binary" ]]; then
    exec "$binary" "$@"
  fi
fi

printf '%s\n' 'Error: the CodexResets CLI is not on PATH and its installed path is unavailable.' >&2
printf '%s\n' 'Run the CodexResets installer again or add its npm bin directory to PATH.' >&2
exit 1
