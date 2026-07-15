#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Error: Node.js 18 or newer is required.' >&2
  exit 1
fi

exec node "$SCRIPT_DIR/src/cli.mjs" "$@"
