#!/usr/bin/env bash
# Net2App deployment bootstrap.
#
# Local/bundled usage:
#   sudo bash deploy.sh
#
# One-line usage:
#   curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | sudo bash
#
# Configuration is supplied through environment variables and forwarded to
# install.sh. For example:
#   sudo env MYSQL_REGISTER_CLUSTER=false bash deploy.sh

set -Eeuo pipefail

readonly INSTALL_URL="${INSTALL_URL:-https://raw.githubusercontent.com/eliasewu/net2app_v3/main/install.sh}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"

printf '\033[0;36mNet2App deployment bootstrap\033[0m\n'
printf 'Installer source: %s\n' "$INSTALL_URL"

# Fail fast with a clear message instead of a cryptic installer error.
if [[ "$(id -u)" -ne 0 ]]; then
  printf '\033[0;31mERROR:\033[0m deploy.sh must run as root:\n' >&2
  printf '  curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | sudo bash\n' >&2
  exit 1
fi
if [[ -r /etc/os-release ]] && ! grep -qi '^ID=ubuntu' /etc/os-release; then
  printf '\033[0;31mERROR:\033[0m deploy.sh supports Ubuntu only (detected: %s)\n' "$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/install.sh" ]]; then
  printf 'Using bundled installer: %s\n' "$SCRIPT_DIR/install.sh"
  exec bash "$SCRIPT_DIR/install.sh" "$@"
fi

command -v curl >/dev/null 2>&1 || {
  printf '\033[0;31mERROR:\033[0m curl is required to download install.sh\n' >&2
  exit 1
}

# Download to a temporary file so a network interruption cannot pipe a
# truncated installer into bash. Environment variables remain in the current
# process and are inherited by the installer.
tmp_install=$(mktemp)
cleanup() { rm -f "$tmp_install"; }
trap cleanup EXIT
curl --fail --silent --show-error --location --retry 3 --retry-delay 2 "$INSTALL_URL" -o "$tmp_install"
[[ -s "$tmp_install" ]] || {
  printf '\033[0;31mERROR:\033[0m downloaded installer is empty — check INSTALL_URL and network\n' >&2
  exit 1
}
bash -n "$tmp_install" || {
  printf '\033[0;31mERROR:\033[0m downloaded installer failed syntax check — refusing to execute\n' >&2
  exit 1
}
chmod 700 "$tmp_install"
exec bash "$tmp_install" "$@"
