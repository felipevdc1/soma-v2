#!/usr/bin/env bash
# synthetic-env.test.sh — validate install.sh + uninstall.sh in an isolated env
# Proves 3 invariants:
#   1. Fresh install: SOMA installed, user config (env + custom hook) preserved
#   2. Re-install (idempotency): settings.json sha256 IDENTICAL pre/post 2nd install
#   3. Uninstall: user config preserved, all SOMA-managed entries removed, .soma-v2 gone
#
# Usage: bash install/__tests__/synthetic-env.test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SYNTH_HOME="/tmp/test-bruno-home"

PASS=0
FAIL=0

pass() { echo "[PASS] $*"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $*" >&2; FAIL=$((FAIL + 1)); }

cleanup() {
  rm -rf "${SYNTH_HOME}" 2>/dev/null || true
}
trap cleanup EXIT

# ── Setup ────────────────────────────────────────────────────────────────────
echo ""
echo "[TEST] Setup synthetic env at ${SYNTH_HOME}"
cleanup
mkdir -p "${SYNTH_HOME}/.claude"

# Seed: unmanaged command that the rollout will replace. Keep an exact
# pre-state outside the target so the canary can prove Phase 1 backed it up.
mkdir -p "${SYNTH_HOME}/.claude/commands"
cat > "${SYNTH_HOME}/.claude/commands/soma-run.md" <<'SOMA_RUN_EOF'
# Custom local soma run

This is an unmanaged pre-rollout command and must be recoverable byte-for-byte.
SOMA_RUN_EOF
cp "${SYNTH_HOME}/.claude/commands/soma-run.md" "${SYNTH_HOME}/pre-rollout-soma-run.md"

# Seed: existing settings.json with user env + custom hook
cat > "${SYNTH_HOME}/.claude/settings.json" <<'SETTINGS_EOF'
{
  "env": {
    "USER_PRECONFIG": "baseline"
  },
  "permissions": {
    "allow": ["Read"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{"command": "user-custom.sh"}]
      }
    ]
  }
}
SETTINGS_EOF

# Seed: minimal CLAUDE.md
echo "# Bruno's existing CLAUDE.md (placeholder)" > "${SYNTH_HOME}/.claude/CLAUDE.md"

echo "[TEST] Baseline seeded."

# ── Test 1: Fresh install ────────────────────────────────────────────────────
echo ""
echo "[TEST 1] Fresh install..."

HOME="${SYNTH_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 NO_CLAUDE_MD=1 \
  bash "${REPO_ROOT}/install.sh" 2>&1 | grep -v "^\[DRY-RUN\]" | tail -30

# 1a: .soma-v2 created
if [[ -d "${SYNTH_HOME}/.soma-v2" ]]; then
  pass "1a: ${SYNTH_HOME}/.soma-v2 created"
else
  fail "1a: ${SYNTH_HOME}/.soma-v2 not created"
fi

# 1b: hooks directory populated
if [[ -d "${SYNTH_HOME}/.claude/hooks" ]]; then
  HOOK_COUNT=$(find "${SYNTH_HOME}/.claude/hooks" -name "*.cjs" | wc -l | tr -d ' ')
  pass "1b: hooks installed (${HOOK_COUNT} .cjs files)"
else
  fail "1b: hooks directory not created"
fi

# 1c: output-style installed
if [[ -f "${SYNTH_HOME}/.claude/output-styles/soma-voxel.md" ]]; then
  pass "1c: output-style soma-voxel.md installed"
else
  fail "1c: output-styles/soma-voxel.md missing"
fi

# 1d: SOMA hooks registered in settings.json
SOMA_EVENTS=$(node -e "
const s = JSON.parse(require('fs').readFileSync('${SYNTH_HOME}/.claude/settings.json','utf-8'));
const allEntries = Object.values(s.hooks || {}).flat();
const somaManaged = allEntries.filter(e => e._soma_managed === true);
const eventCount = Object.keys(s.hooks || {}).length;
if (somaManaged.length === 0) { console.error('NO SOMA ENTRIES'); process.exit(1); }
console.log(eventCount + ' events, ' + somaManaged.length + ' SOMA-managed entries');
" 2>&1)
if [[ $? -eq 0 ]]; then
  pass "1d: ${SOMA_EVENTS}"
else
  fail "1d: SOMA entries missing in settings.json — ${SOMA_EVENTS}"
fi

# 1e: User env preserved
USER_ENV_OK=$(node -e "
const s = JSON.parse(require('fs').readFileSync('${SYNTH_HOME}/.claude/settings.json','utf-8'));
if (s.env && s.env.USER_PRECONFIG === 'baseline') { console.log('ok'); } else { process.exit(1); }
" 2>&1)
if [[ "${USER_ENV_OK}" == "ok" ]]; then
  pass "1e: USER_PRECONFIG=baseline preserved"
else
  fail "1e: USER_PRECONFIG lost after install"
fi

# 1f: User custom hook preserved (not tagged _soma_managed)
CUSTOM_HOOK_OK=$(node -e "
const s = JSON.parse(require('fs').readFileSync('${SYNTH_HOME}/.claude/settings.json','utf-8'));
const userHooks = (s.hooks && s.hooks.PreToolUse || []).filter(
  e => !e._soma_managed && e.hooks && e.hooks.some(h => h.command === 'user-custom.sh')
);
if (userHooks.length === 1) { console.log('ok'); } else { process.exit(1); }
" 2>&1)
if [[ "${CUSTOM_HOOK_OK}" == "ok" ]]; then
  pass "1f: user-custom.sh hook preserved"
else
  fail "1f: user-custom.sh hook lost or mangled"
fi

# 1g / R-06: soma-run rollout installs canonical bytes AND retains a
# recoverable byte-identical pre-state in the Phase 1 backup tree.
CANONICAL_SOMA_RUN="${REPO_ROOT}/core/adapters/claude/commands/soma-run.md"
BACKED_UP_SOMA_RUN=$(find "${SYNTH_HOME}/.soma-v2-backups" -path '*/claude/commands/soma-run.md' -type f -print -quit)
if cmp -s "${SYNTH_HOME}/.claude/commands/soma-run.md" "${CANONICAL_SOMA_RUN}" && \
   [[ -n "${BACKED_UP_SOMA_RUN}" ]] && \
   cmp -s "${BACKED_UP_SOMA_RUN}" "${SYNTH_HOME}/pre-rollout-soma-run.md"; then
  pass "1g/R-06: soma-run canonical installed; custom pre-state recoverable at ${BACKED_UP_SOMA_RUN}"
else
  fail "1g/R-06: soma-run rollout did not preserve custom pre-state while installing canonical bytes"
fi

# ── Test 2: Re-install idempotency ───────────────────────────────────────────
echo ""
echo "[TEST 2] Re-install (idempotency check)..."

SHA_PRE=$(shasum -a 256 "${SYNTH_HOME}/.claude/settings.json" | awk '{print $1}')

HOME="${SYNTH_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 NO_CLAUDE_MD=1 \
  bash "${REPO_ROOT}/install.sh" 2>&1 | tail -5

SHA_POST=$(shasum -a 256 "${SYNTH_HOME}/.claude/settings.json" | awk '{print $1}')

if [[ "${SHA_PRE}" == "${SHA_POST}" ]]; then
  pass "2: settings.json sha256 IDENTICAL pre/post 2nd install (${SHA_PRE})"
else
  fail "2: settings.json sha changed on 2nd install — idempotency broken"
  echo "  pre:  ${SHA_PRE}"
  echo "  post: ${SHA_POST}"
fi

# ── Test 3: Uninstall ────────────────────────────────────────────────────────
echo ""
echo "[TEST 3] Uninstall..."

HOME="${SYNTH_HOME}" bash "${REPO_ROOT}/uninstall.sh" 2>&1 | tail -10

# 3a: user env preserved after uninstall
USER_ENV_POST=$(node -e "
const s = JSON.parse(require('fs').readFileSync('${SYNTH_HOME}/.claude/settings.json','utf-8'));
if (s.env && s.env.USER_PRECONFIG === 'baseline') { console.log('ok'); } else { process.exit(1); }
" 2>&1)
if [[ "${USER_ENV_POST}" == "ok" ]]; then
  pass "3a: USER_PRECONFIG=baseline preserved after uninstall"
else
  fail "3a: USER_PRECONFIG lost after uninstall"
fi

# 3b: user custom hook preserved after uninstall
CUSTOM_AFTER=$(node -e "
const s = JSON.parse(require('fs').readFileSync('${SYNTH_HOME}/.claude/settings.json','utf-8'));
const userHooks = (s.hooks && s.hooks.PreToolUse || []).filter(
  e => !e._soma_managed && e.hooks && e.hooks.some(h => h.command === 'user-custom.sh')
);
if (userHooks.length === 1) { console.log('ok'); } else { process.exit(1); }
" 2>&1)
if [[ "${CUSTOM_AFTER}" == "ok" ]]; then
  pass "3b: user-custom.sh hook preserved after uninstall"
else
  fail "3b: user-custom.sh hook lost after uninstall"
fi

# 3c: no _soma_managed entries remain
SOMA_REMAINING=$(node -e "
const s = JSON.parse(require('fs').readFileSync('${SYNTH_HOME}/.claude/settings.json','utf-8'));
const remaining = Object.values(s.hooks || {}).flat().filter(e => e._soma_managed === true);
console.log(remaining.length);
" 2>&1)
if [[ "${SOMA_REMAINING}" == "0" ]]; then
  pass "3c: all SOMA-managed entries removed (0 remaining)"
else
  fail "3c: ${SOMA_REMAINING} SOMA-managed entries still present after uninstall"
fi

# 3d: .soma-v2 removed
if [[ ! -d "${SYNTH_HOME}/.soma-v2" ]]; then
  pass "3d: ${SYNTH_HOME}/.soma-v2 removed"
else
  fail "3d: ${SYNTH_HOME}/.soma-v2 still present after uninstall"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
TOTAL=$((PASS + FAIL))
echo "Results: ${PASS}/${TOTAL} PASS, ${FAIL} FAIL"
if [[ "${FAIL}" -eq 0 ]]; then
  echo ""
  echo "ALL 3 INVARIANTS PASS"
  echo ""
  echo "  1. Fresh install: SOMA installed + user config coexist"
  echo "  2. Re-install: settings.json sha256 IDENTICAL (${SHA_PRE})"
  echo "  3. Uninstall: user config preserved, SOMA fully removed"
  echo "=========================================="
  exit 0
else
  echo "=========================================="
  exit 1
fi
