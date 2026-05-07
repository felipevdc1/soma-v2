#!/usr/bin/env bash
# install.sh — SOMA v2.1 idempotent installer
# Usage:
#   bash install.sh [--dry-run] [--no-codex] [--no-claude-md] [--force-overwrite]
# Env overrides:
#   HOME=...           — override home dir (used for synthetic env tests)
#   FORCE_OVERWRITE=1  — skip collision prompt (auto-rename colliders to .bak)
#   NO_CODEX=1         — skip codex/AGENTS.md injection
#   NO_CLAUDE_MD=1     — skip CLAUDE.md bootloader injection

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%s)
BACKUP_DIR="${HOME}/.soma-v2-backups/${TS}"

# ── Parse flags ─────────────────────────────────────────────────────────────
DRY_RUN=0
NO_CODEX=${NO_CODEX:-0}
NO_CLAUDE_MD=${NO_CLAUDE_MD:-0}
FORCE_OVERWRITE=${FORCE_OVERWRITE:-0}

for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=1 ;;
    --no-codex)       NO_CODEX=1 ;;
    --no-claude-md)   NO_CLAUDE_MD=1 ;;
    --force-overwrite) FORCE_OVERWRITE=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] $*"
  else
    eval "$@"
  fi
}

# ── Phase 0: Pre-flight checks ───────────────────────────────────────────────
echo "[SOMA] Phase 0: Pre-flight checks..."

PLATFORM=$("${REPO_ROOT}/install/platform-detect.sh")
echo "[SOMA] Platform: ${PLATFORM}"

NODE_VER=$(node -v 2>/dev/null | sed 's/v//; s/\..*//')
if [[ "${NODE_VER:-0}" -lt 22 ]]; then
  echo "ERROR: Need Node v22+ (found: ${NODE_VER:-none})" >&2
  exit 1
fi

# Permissions test — use $HOME (supports HOME override for synthetic env)
mkdir -p "${HOME}/.claude" 2>/dev/null
if ! touch "${HOME}/.claude/.soma-perm-test" 2>/dev/null; then
  echo "ERROR: ${HOME}/.claude/ not writable. Aborting." >&2
  exit 1
fi
rm -f "${HOME}/.claude/.soma-perm-test"

# Phase 0.5: MCP dependency check (warn-and-continue)
node "${REPO_ROOT}/install/check-mcp-deps.cjs" || true

# Phase 0.6: Claude CLI auth (soft warning)
if ! command -v claude &>/dev/null; then
  echo "[WARN] Claude CLI not found — 'soma audit' will be unavailable"
fi

# ── Phase 0.7: cbm/legacy marker detection (Spec 013 AC-11) ─────────────────
LAB_CLAUDE="$HOME/.claude/CLAUDE.md"
LAB_CODEX="$HOME/.codex/AGENTS.md"
LAB_HOME="$HOME/AGENTS.md"

NEEDS_MIGRATION=0
for FILE in "$LAB_CLAUDE" "$LAB_CODEX" "$LAB_HOME"; do
  if [ -f "$FILE" ]; then
    if grep -qE 'id=block\.[^\.]+\..*\.cbm|<!-- codebase-memory-mcp:start -->' "$FILE" 2>/dev/null; then
      NEEDS_MIGRATION=1
      break
    fi
  fi
done

if [ "$NEEDS_MIGRATION" -eq 1 ]; then
  echo "[SOMA] cbm/legacy markers detected. Running cbm migration first..."
  node "${REPO_ROOT}/core/scripts/migrate-cbm-deprecation.cjs" || {
    echo "ERROR: cbm migration failed. Aborting install. Inspect snapshot in ${HOME}/.soma-v2/.snapshots/" >&2
    exit 1
  }
fi

# ── Phase 1: Backup ──────────────────────────────────────────────────────────
echo "[SOMA] Phase 1: Backup..."
run "mkdir -p \"${BACKUP_DIR}\""
[[ -f "${HOME}/.claude/settings.json" ]] && run "cp \"${HOME}/.claude/settings.json\" \"${BACKUP_DIR}/\""
[[ -f "${HOME}/.claude/CLAUDE.md" ]]     && run "cp \"${HOME}/.claude/CLAUDE.md\" \"${BACKUP_DIR}/\""
[[ -f "${HOME}/.codex/AGENTS.md" ]]      && run "cp \"${HOME}/.codex/AGENTS.md\" \"${BACKUP_DIR}/\""
if [[ -d "${HOME}/.soma-v2" ]]; then
  run "tar czf \"${BACKUP_DIR}/dot-soma-v2.tgz\" -C \"${HOME}\" .soma-v2"
fi

# ── Phase 1.5: Hook collision detection ─────────────────────────────────────
echo "[SOMA] Phase 1.5: Hook collision detection..."
HOOKS_TARGET="${HOME}/.claude/hooks"
if [[ -d "${HOOKS_TARGET}" ]]; then
  COLLISIONS=$(node "${REPO_ROOT}/install/detect-collisions.cjs" \
    --target="${HOOKS_TARGET}" \
    --soma-list="${REPO_ROOT}/install/soma-hooks-map.json" 2>/dev/null || echo "")
else
  COLLISIONS=""
fi

if [[ -n "${COLLISIONS}" && "${FORCE_OVERWRITE}" != "1" && -t 0 ]]; then
  echo "[COLLISION] Custom-modified hooks found in ${HOOKS_TARGET}/:"
  echo "${COLLISIONS}"
  read -rp "Install SOMA versions anyway (custom moves to .bak)? [y/N] " ans
  [[ "${ans}" == "y" ]] || { echo "Aborted by user"; exit 1; }
  while IFS= read -r collision_file; do
    [[ -f "${collision_file}" ]] && mv "${collision_file}" "${collision_file}.pre-soma-${TS}.bak"
  done <<< "${COLLISIONS}"
elif [[ -n "${COLLISIONS}" && "${FORCE_OVERWRITE}" == "1" ]]; then
  echo "[SOMA] FORCE_OVERWRITE=1 — renaming colliding hooks to .bak"
  while IFS= read -r collision_file; do
    [[ -f "${collision_file}" ]] && mv "${collision_file}" "${collision_file}.pre-soma-${TS}.bak"
  done <<< "${COLLISIONS}"
fi

# ── Phase 2: Copy framework core + token substitution ───────────────────────
echo "[SOMA] Phase 2: Copy core framework..."
run "mkdir -p \"${HOME}/.soma-v2\""
run "rsync -a \"${REPO_ROOT}/core/\" \"${HOME}/.soma-v2/\""

if [[ "${DRY_RUN}" != "1" ]]; then
  # BSD/GNU sed compat
  if [[ "${PLATFORM}" == "mac" ]]; then
    find "${HOME}/.soma-v2" -type f \( -name "*.md" -o -name "*.json" \) \
      -exec sed -i "" \
        -e "s|\${HOME}|${HOME}|g" \
        -e "s|\${SOMA_HOME}|${HOME}/.soma-v2|g" \
        -e "s|\${CLAUDE_HOME}|${HOME}/.claude|g" \
        -e "s|\${CODEX_HOME}|${HOME}/.codex|g" \
      {} +
  else
    find "${HOME}/.soma-v2" -type f \( -name "*.md" -o -name "*.json" \) \
      -exec sed -i \
        -e "s|\${HOME}|${HOME}|g" \
        -e "s|\${SOMA_HOME}|${HOME}/.soma-v2|g" \
        -e "s|\${CLAUDE_HOME}|${HOME}/.claude|g" \
        -e "s|\${CODEX_HOME}|${HOME}/.codex|g" \
      {} +
  fi
fi

# ── Phases 3–5: Hooks, commands, templates, output-styles ───────────────────
echo "[SOMA] Phase 3-5: Copy hooks / commands / templates / output-styles..."
run "mkdir -p \"${HOME}/.claude/hooks/lib\" \"${HOME}/.claude/commands\" \"${HOME}/.claude/templates\" \"${HOME}/.claude/output-styles\""
run "rsync -a \"${REPO_ROOT}/hooks/\" \"${HOME}/.claude/hooks/\""
run "rsync -a \"${REPO_ROOT}/commands/\" \"${HOME}/.claude/commands/\""
run "rsync -a \"${REPO_ROOT}/templates/\" \"${HOME}/.claude/templates/\""
run "rsync -a \"${REPO_ROOT}/output-styles/\" \"${HOME}/.claude/output-styles/\""

# ── Phase 6: Settings.json merge ────────────────────────────────────────────
echo "[SOMA] Phase 6: Settings.json merge..."
if [[ "${DRY_RUN}" == "1" ]]; then
  node "${REPO_ROOT}/install/merge-settings.cjs" \
    --target="${HOME}/.claude/settings.json" \
    --map="${REPO_ROOT}/install/soma-hooks-map.json" \
    --dry-run
else
  node "${REPO_ROOT}/install/merge-settings.cjs" \
    --target="${HOME}/.claude/settings.json" \
    --map="${REPO_ROOT}/install/soma-hooks-map.json"
fi

# ── Phase 7: CLAUDE.md bootloader injection ──────────────────────────────────
if [[ "${NO_CLAUDE_MD}" != "1" && "${DRY_RUN}" != "1" ]]; then
  echo "[SOMA] Phase 7: CLAUDE.md bootloader injection..."
  node "${HOME}/.soma-v2/scripts/soma.cjs" sync --apply --tool=claude 2>/dev/null || \
    echo "[WARN] soma sync --tool=claude had non-zero exit (may be expected on fresh install)"
fi

# ── Phase 8: AGENTS.md (Codex) ──────────────────────────────────────────────
if [[ "${NO_CODEX}" != "1" && -d "${HOME}/.codex" && "${DRY_RUN}" != "1" ]]; then
  echo "[SOMA] Phase 8: Codex AGENTS.md injection..."
  node "${HOME}/.soma-v2/scripts/soma.cjs" sync --apply --tool=codex 2>/dev/null || \
    echo "[WARN] soma sync --tool=codex had non-zero exit"
fi

# ── Phase 9: Verify ──────────────────────────────────────────────────────────
if [[ "${DRY_RUN}" != "1" ]]; then
  echo "[SOMA] Phase 9: Verification..."
  node "${HOME}/.soma-v2/scripts/soma.cjs" doctor 2>/dev/null || \
    echo "[WARN] doctor non-zero (expected in fresh install without live Claude Code)"
  node "${REPO_ROOT}/install/verify-portability.cjs" --mode=live || \
    echo "[WARN] verify-portability non-zero (gates requiring live session skipped)"
fi

# ── Phase 10: Summary ────────────────────────────────────────────────────────
USER_NAME=$(git config --global user.name 2>/dev/null || echo "${USER:-user}")
cat <<SUMMARY

SOMA v2.1 installed for ${USER_NAME}

Created by @o.felipecarneiro · Inspired by @zbrunomoreira

Privacy: SOMA writes local telemetry at ${HOME}/.claude/logs/
         No data sent externally. Disable: export INSIGHT_COUPLING_DISABLED=1

Next steps:
  1. Restart Claude Code (close + reopen)
  2. Try: /soma:run --help
  3. Read: ${HOME}/.soma-v2/docs/onboarding.md

Backup:    ${BACKUP_DIR}
Uninstall: bash ${REPO_ROOT}/uninstall.sh

SUMMARY
