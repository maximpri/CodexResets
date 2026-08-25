#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT='CodexResets'
readonly PACKAGE='codexresets'
readonly DEFAULT_REF='main'
readonly REPOSITORY_API='https://api.github.com/repos/maximpri/CodexResets'

usage() {
  printf '%s\n' \
    'CodexResets quick installer' \
    '' \
    'Usage:' \
    '  curl -fsSL https://raw.githubusercontent.com/maximpri/CodexResets/main/install.sh -o codexresets-install.sh' \
    '  bash codexresets-install.sh [--no-plugin]' \
    '' \
    'Environment:' \
    '  CODEXRESETS_PREFIX  Alternative npm installation prefix' \
    '  CODEXRESETS_REF     Git branch, tag, or commit (default: main)' \
    '  CODEXRESETS_SKIP_PLUGIN=1  Install only the standalone CLI'
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

skip_plugin="${CODEXRESETS_SKIP_PLUGIN:-0}"
if (( $# > 0 )); then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --no-plugin)
      (( $# == 1 )) || fail 'Only one installer option may be supplied.'
      skip_plugin=1
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

if [[ "$skip_plugin" == '1' ]]; then
  printf '%s\n' 'Skipped Codex plugin setup (--no-plugin or CODEXRESETS_SKIP_PLUGIN=1).'
elif ! command -v codex >/dev/null 2>&1; then
  printf '%s\n' \
    'Codex CLI was not found on PATH; the standalone CLI is installed.' \
    'Install Codex or add it to PATH, then rerun this installer to enable the /codexresets command.'
else
  package_root="$(npm root --global --prefix "$install_prefix")/$PACKAGE"
  plugin_source="$package_root/plugins/codexresets"
  plugin_installer="$package_root/scripts/install-plugin.mjs"

  if [[ ! -d "$plugin_source" || ! -f "$plugin_installer" ]]; then
    printf '%s\n' \
      'Warning: the installed package did not include the Codex plugin files.' \
      'The standalone CLI is installed; rerun the installer from a current CodexResets release.' >&2
  elif ! node "$plugin_installer" --source "$plugin_source" --binary "$binary"; then
    printf '%s\n' \
      'Warning: the standalone CLI is installed, but Codex plugin registration failed.' \
      'You can retry with: codex plugin add codexresets@personal' >&2
  elif codex plugin add codexresets@personal; then
    printf '%s\n' \
      'Installed and enabled the CodexResets plugin.' \
      'Start a new Codex session, then use /codexresets.'
  else
    printf '%s\n' \
      'Warning: the standalone CLI is installed, but Codex could not enable the plugin.' \
      'You can retry with: codex plugin add codexresets@personal' >&2
  fi
fi
