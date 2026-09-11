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
chmod 700 "$tmp_install"
exec bash "$tmp_install" "$@"
