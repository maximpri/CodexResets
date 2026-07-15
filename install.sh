#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT='CodexResets'
readonly DEFAULT_REF='main'
readonly REPOSITORY_API='https://api.github.com/repos/maximpri/CodexResets'

usage() {
  printf '%s\n' \
    'CodexResets quick installer' \
    '' \
    'Usage:' \
    '  curl -fsSL https://raw.githubusercontent.com/maximpri/CodexResets/main/install.sh -o codexresets-install.sh' \
    '  bash codexresets-install.sh' \
    '' \
    'Environment:' \
    '  CODEXRESETS_PREFIX  Alternative npm installation prefix' \
    '  CODEXRESETS_REF     Git branch, tag, or commit (default: main)'
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

if (( $# > 0 )); then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
fi

command -v node >/dev/null 2>&1 || fail 'Node.js 18 or newer is required.'
command -v npm >/dev/null 2>&1 || fail 'npm is required.'

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" =~ ^[0-9]+$ ]] || fail 'Could not determine the Node.js version.'
(( node_major >= 18 )) || fail 'Node.js 18 or newer is required.'

ref="${CODEXRESETS_REF:-$DEFAULT_REF}"
if [[ ! "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ \
  || "$ref" == *'..'* \
  || "$ref" == *'//'* ]]; then
  fail 'CODEXRESETS_REF contains unsupported characters.'
fi

encoded_ref="${ref//\//%2F}"
package_url="${REPOSITORY_API}/tarball/${encoded_ref}"
install_args=(install --global --ignore-scripts --no-audit --no-fund)
if [[ -n "${CODEXRESETS_PREFIX:-}" ]]; then
  install_args+=(--prefix "$CODEXRESETS_PREFIX")
  install_prefix="$CODEXRESETS_PREFIX"
else
  install_prefix="$(npm prefix --global)"
fi

printf 'Installing %s from GitHub ref %s...\n' "$PROJECT" "$ref"
if ! npm "${install_args[@]}" "$package_url"; then
  printf '%s\n' \
    'Installation failed. For a user-local install, retry with:' \
    "  CODEXRESETS_PREFIX=\"${HOME}/.local\" bash install.sh" >&2
  exit 1
fi

binary="${install_prefix%/}/bin/codexresets"
[[ -x "$binary" ]] || fail 'npm completed, but the codexresets executable was not found.'
version="$($binary --version)"

printf 'Installed CodexResets %s at %s\n' "$version" "$binary"
if ! command -v codexresets >/dev/null 2>&1; then
  printf '%s\n' \
    'Add the installation directory to PATH for future shells:' \
    "  export PATH=\"${install_prefix%/}/bin:\$PATH\""
fi
