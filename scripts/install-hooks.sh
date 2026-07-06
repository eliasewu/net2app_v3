#!/bin/bash
# ============================================================
# scripts/install-hooks.sh — installs the pre-commit git hook
# ============================================================
# Idempotent. Existing pre-commit hook (if any) gets backed up under
# .git/hooks/pre-commit.backup.<timestamp> before being replaced.
#
# Run once after a fresh clone:
#   bash scripts/install-hooks.sh
# …or via npm if you added the alias:
#   npm run install-hooks
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
HOOK_FILE="$HOOKS_DIR/pre-commit"
SOURCE="$PROJECT_ROOT/scripts/pre-commit"

# Bail gracefully if there's no .git (CI checkout, tarball download, etc.)
if [ ! -d "$HOOKS_DIR" ]; then
  echo "[install-hooks] no .git/hooks/ — skipping (not a git working tree)"
  exit 0
fi

# Make sure the source hook exists
if [ ! -f "$SOURCE" ]; then
  echo "[install-hooks] ERROR: $SOURCE not found."
  exit 1
fi

# Back up any existing hook first (we never silently overwrite contributors' work)
if [ -e "$HOOK_FILE" ]; then
  # Refuse to touch a non-writable existing hook — otherwise mv would
  # succeed (renames are directory entries, not file writes), the cp would
  # fail, and the contributor's pre-existing pre-commit hook would have
  # been moved to a .backup.<ts> file with nothing active in its place.
  if [ ! -w "$HOOK_FILE" ]; then
    echo "[install-hooks] ERROR: $HOOK_FILE is not writable; refusing to touch it."
    echo "[install-hooks] Hint: chmod +w $HOOK_FILE (or run as the file's owner)."
    exit 1
  fi
  TS="$(date +%Y%m%d%H%M%S)"
  BACKUP_FILE="$HOOKS_DIR/pre-commit.backup.${TS}"
  mv "$HOOK_FILE" "$BACKUP_FILE"
  echo "[install-hooks] backed up existing hook → $BACKUP_FILE"
fi

cp "$SOURCE" "$HOOK_FILE"
chmod +x "$HOOK_FILE"

echo "[install-hooks] ✅ installed $HOOK_FILE"
echo ""
echo "Next commit will run: vitest + tsc --noEmit + bash scripts/smoke.sh"
echo "Bypass escape hatches:"
echo "  git commit --no-verify                       # git's standard bypass"
echo "  SKIP_SMOKE=1 git commit ...                  # skip backend smoke"
echo "  SKIP_TSC=1   git commit ...                  # skip typecheck"
echo "  SKIP_TESTS=1 git commit ...                  # skip unit tests"
