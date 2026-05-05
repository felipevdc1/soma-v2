#!/usr/bin/env bash
# uninstall.sh — SOMA v2.1 clean removal
# Usage:
#   bash uninstall.sh [--keep-soma-home] [--restore-backup TIMESTAMP]
# Env overrides:
#   HOME=...  — override home dir (used for synthetic env tests)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Parse flags ─────────────────────────────────────────────────────────────
KEEP_SOMA_HOME=0
RESTORE_BACKUP=""

i=1
while [[ $i -le $# ]]; do
  arg="${!i}"
  case "$arg" in
    --keep-soma-home)
      KEEP_SOMA_HOME=1
      ;;
    --restore-backup)
      i=$((i + 1))
      RESTORE_BACKUP="${!i}"
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
  i=$((i + 1))
done

# ── Phase 1: Revert anchored blocks from CLAUDE.md / AGENTS.md ──────────────
# Strategy: strip <!-- soma-v2:start ... --> ... <!-- soma-v2:end ... --> blocks.
# rollback.cjs requires an explicit --snapshot-id <ISO> and does not support
# --revert-soma or --tool flags (Phase 5 gap documented). We use sed-based
# stripping instead, which is reliable and decoupled from snapshot state.
echo "[SOMA-UNINSTALL] Phase 1: Strip SOMA anchored blocks from target files..."

strip_soma_blocks() {
  local target="$1"
  if [[ ! -f "${target}" ]]; then
    return 0
  fi

  local tmpfile
  tmpfile=$(mktemp)

  # Remove lines from <!-- soma-v2:start ... --> through <!-- soma-v2:end ... -->
  # Uses awk for reliable multi-line block deletion without GNU sed requirement
  awk '
    /<!--\s*soma-v2:start/ { skip=1 }
    skip { if (/<!--\s*soma-v2:end/) { skip=0 } next }
    { print }
  ' "${target}" > "${tmpfile}"

  # Only write back if we actually changed something
  if ! diff -q "${target}" "${tmpfile}" > /dev/null 2>&1; then
    cp "${tmpfile}" "${target}"
    echo "[SOMA-UNINSTALL] Stripped soma-v2 anchored blocks from ${target}"
  fi
  rm -f "${tmpfile}"
}

[[ -f "${HOME}/.claude/CLAUDE.md" ]] && strip_soma_blocks "${HOME}/.claude/CLAUDE.md"
[[ -f "${HOME}/.codex/AGENTS.md" ]]  && strip_soma_blocks "${HOME}/.codex/AGENTS.md"

# ── Phase 2: Strip _soma_managed entries from settings.json ─────────────────
echo "[SOMA-UNINSTALL] Phase 2: Strip _soma_managed entries from settings.json..."
if [[ -f "${HOME}/.claude/settings.json" ]]; then
  node "${REPO_ROOT}/install/merge-settings.cjs" \
    --target="${HOME}/.claude/settings.json" \
    --uninstall
else
  echo "[SOMA-UNINSTALL] settings.json not found — skipping"
fi

# ── Phase 3: Remove SOMA framework directory ─────────────────────────────────
if [[ "${KEEP_SOMA_HOME}" != "1" ]]; then
  echo "[SOMA-UNINSTALL] Phase 3: Remove ${HOME}/.soma-v2..."
  rm -rf "${HOME}/.soma-v2"
fi

# ── Phase 4: Optional restore from backup ───────────────────────────────────
if [[ -n "${RESTORE_BACKUP}" ]]; then
  RESTORE_DIR="${HOME}/.soma-v2-backups/${RESTORE_BACKUP}"
  if [[ -d "${RESTORE_DIR}" ]]; then
    echo "[SOMA-UNINSTALL] Phase 4: Restoring backup ${RESTORE_BACKUP}..."
    [[ -f "${RESTORE_DIR}/settings.json" ]] && cp "${RESTORE_DIR}/settings.json" "${HOME}/.claude/settings.json"
    [[ -f "${RESTORE_DIR}/CLAUDE.md" ]]     && cp "${RESTORE_DIR}/CLAUDE.md" "${HOME}/.claude/CLAUDE.md"
    [[ -f "${RESTORE_DIR}/AGENTS.md" ]]     && cp "${RESTORE_DIR}/AGENTS.md" "${HOME}/.codex/AGENTS.md"
  else
    echo "[WARN] Backup dir not found: ${RESTORE_DIR}" >&2
  fi
fi

echo ""
echo "SOMA v2.1 uninstalled. Backups preserved at ${HOME}/.soma-v2-backups/"
