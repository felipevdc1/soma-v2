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
SYNTH_PROJECT="${SYNTH_HOME}/project"
ROLLBACK_HOME="/tmp/test-bruno-rollback-home"
ROLLBACK_PROJECT="${ROLLBACK_HOME}/project"
NO_CLAUDE_HOME="/tmp/test-bruno-no-claude-home"
NO_CLAUDE_PROJECT="${NO_CLAUDE_HOME}/project"
TERM_HOME="/tmp/test-bruno-term-home"
TERM_PROJECT="${TERM_HOME}/project"
BACKUP_HOME="/tmp/test-bruno-backup-home"
BACKUP_PROJECT="${BACKUP_HOME}/project"
TEST_BIN="/tmp/test-bruno-install-bin"
NODE_BIN="$(command -v node)"
DRY_HOME="/tmp/test-bruno-dry-home"
DRY_PROJECT="/tmp/test-bruno-dry-project"
DRY_BEFORE="/tmp/test-bruno-dry-before.tar"
DRY_AFTER="/tmp/test-bruno-dry-after.tar"

PASS=0
FAIL=0

pass() { echo "[PASS] $*"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $*" >&2; FAIL=$((FAIL + 1)); }

cleanup() {
  rm -rf "${SYNTH_HOME}" 2>/dev/null || true
  rm -rf "${ROLLBACK_HOME}" 2>/dev/null || true
  rm -rf "${NO_CLAUDE_HOME}" 2>/dev/null || true
  rm -rf "${TERM_HOME}" 2>/dev/null || true
  rm -rf "${BACKUP_HOME}" 2>/dev/null || true
  rm -rf "${TEST_BIN}" 2>/dev/null || true
  rm -rf "${DRY_HOME}" "${DRY_PROJECT}" 2>/dev/null || true
  rm -f "${DRY_BEFORE}" "${DRY_AFTER}" 2>/dev/null || true
}
trap cleanup EXIT

# ── Setup ────────────────────────────────────────────────────────────────────
echo ""
echo "[TEST] Setup synthetic env at ${SYNTH_HOME}"
cleanup

# ── Test -1: dry-run must not mutate an empty HOME ───────────────────────────
echo ""
echo "[TEST -1] --dry-run keeps an empty HOME byte-identical..."
mkdir -p "${DRY_HOME}" "${DRY_PROJECT}"
tar -cf "${DRY_BEFORE}" -C "${DRY_HOME}" .
(
  cd "${DRY_PROJECT}"
  HOME="${DRY_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh" --dry-run
) > "${DRY_PROJECT}/dry-run-output.log" 2>&1
tar -cf "${DRY_AFTER}" -C "${DRY_HOME}" .
if cmp -s "${DRY_BEFORE}" "${DRY_AFTER}"; then
  pass "-1/R-08: --dry-run left the empty HOME filesystem byte-identical"
else
  fail "-1/R-08: --dry-run mutated the empty HOME filesystem"
fi

mkdir -p "${SYNTH_HOME}/.claude"
mkdir -p "${SYNTH_PROJECT}/.soma"
# Simulate an upgrade ledger from before soma-run became a whole-file target:
# every older managed file is recorded, but soma-run is intentionally absent.
node -e "
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [repo, project] = process.argv.slice(1);
const targets = JSON.parse(fs.readFileSync(path.join(repo, 'core/adapters/claude/install-targets.json'), 'utf8'));
const installedFiles = Object.fromEntries(targets.entries
  .filter((entry) => entry.kind === 'file' && entry.source_path !== 'adapters/claude/commands/soma-run.md')
  .map((entry) => [entry.target_path, {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'core', entry.source_path))).digest('hex'),
    installedAt: '2026-01-01T00:00:00Z',
  }]));
fs.writeFileSync(path.join(project, '.soma/install-state.json'), JSON.stringify({ installedFiles }) + '\\n');
" "${REPO_ROOT}" "${SYNTH_PROJECT}"

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

# ── Test 0: --no-claude-md leaves the whole-file command untouched ──────────
echo ""
echo "[TEST 0] --no-claude-md preserves soma-run..."
mkdir -p "${NO_CLAUDE_HOME}/.claude/commands" "${NO_CLAUDE_PROJECT}/.soma"
cat > "${NO_CLAUDE_HOME}/.claude/commands/soma-run.md" <<'NO_CLAUDE_COMMAND_EOF'
# Custom command that --no-claude-md must not alter
NO_CLAUDE_COMMAND_EOF
cp "${NO_CLAUDE_HOME}/.claude/commands/soma-run.md" "${NO_CLAUDE_HOME}/pre-no-claude-soma-run.md"
printf '{"installedFiles":{}}\n' > "${NO_CLAUDE_PROJECT}/.soma/install-state.json"

(
  cd "${NO_CLAUDE_PROJECT}"
  HOME="${NO_CLAUDE_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh" --no-claude-md
)

if cmp -s "${NO_CLAUDE_HOME}/.claude/commands/soma-run.md" "${NO_CLAUDE_HOME}/pre-no-claude-soma-run.md"; then
  pass "0/R-07: --no-claude-md did not move or alter soma-run.md"
else
  fail "0/R-07: --no-claude-md changed soma-run.md before sync could own it"
fi

# ── Test 1: Fresh install ────────────────────────────────────────────────────
echo ""
echo "[TEST 1] Fresh install..."

(
  cd "${SYNTH_PROJECT}"
  HOME="${SYNTH_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh"
) 2>&1 | grep -v "^\[DRY-RUN\]" | tail -30

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
CANONICAL_SOMA_RUN="${SYNTH_HOME}/.soma-v2/adapters/claude/commands/soma-run.md"
BACKED_UP_SOMA_RUN=$(find "${SYNTH_HOME}/.soma-v2-backups" -path '*/claude/commands/soma-run.md' -type f -print -quit)
if cmp -s "${SYNTH_HOME}/.claude/commands/soma-run.md" "${CANONICAL_SOMA_RUN}" && \
   [[ -n "${BACKED_UP_SOMA_RUN}" ]] && \
   cmp -s "${BACKED_UP_SOMA_RUN}" "${SYNTH_HOME}/pre-rollout-soma-run.md"; then
  pass "1g/R-06: soma-run canonical installed; custom pre-state recoverable at ${BACKED_UP_SOMA_RUN}"
else
  fail "1g/R-06: soma-run rollout did not preserve custom pre-state while installing canonical bytes"
fi

LEDGER_OK=$(node -e "
const fs = require('fs');
const crypto = require('crypto');
const state = JSON.parse(fs.readFileSync('${SYNTH_PROJECT}/.soma/install-state.json', 'utf8'));
const actual = crypto.createHash('sha256').update(fs.readFileSync('${SYNTH_HOME}/.claude/commands/soma-run.md')).digest('hex');
const entry = state.installedFiles && state.installedFiles['~/.claude/commands/soma-run.md'];
if (entry && entry.sha256 === actual) process.stdout.write('ok'); else process.exit(1);
" 2>&1)
if [[ "${LEDGER_OK}" == "ok" ]]; then
  pass "1h/R-07: sync registered soma-run.md with its installed hash"
else
  fail "1h/R-07: soma-run.md is canonical but absent or wrong in installedFiles"
fi

SYNC_SECOND=$(cd "${SYNTH_PROJECT}" && HOME="${SYNTH_HOME}" node "${SYNTH_HOME}/.soma-v2/scripts/soma.cjs" sync --apply --tool=claude 2>&1)
if [[ $? -eq 0 ]]; then
  pass "1i/R-07: second sync exits 0 after installer-owned rollout"
else
  fail "1i/R-07: second sync failed after installer rollout — ${SYNC_SECOND}"
fi

# ── Test 2: Re-install idempotency ───────────────────────────────────────────
echo ""
echo "[TEST 2] Re-install (idempotency check)..."

SHA_PRE=$(shasum -a 256 "${SYNTH_HOME}/.claude/settings.json" | awk '{print $1}')

(
  cd "${SYNTH_PROJECT}"
  HOME="${SYNTH_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh" --no-claude-md
) 2>&1 | tail -5

SHA_POST=$(shasum -a 256 "${SYNTH_HOME}/.claude/settings.json" | awk '{print $1}')

if [[ "${SHA_PRE}" == "${SHA_POST}" ]]; then
  pass "2: settings.json sha256 IDENTICAL pre/post 2nd install (${SHA_PRE})"
else
  fail "2: settings.json sha changed on 2nd install — idempotency broken"
  echo "  pre:  ${SHA_PRE}"
  echo "  post: ${SHA_POST}"
fi

# ── Test 2b: a Phase 7 failure restores the protected command ───────────────
echo ""
echo "[TEST 2b] Phase 7 rollback..."
mkdir -p "${ROLLBACK_HOME}/.claude/commands" "${ROLLBACK_PROJECT}/.soma"
cat > "${ROLLBACK_HOME}/.claude/commands/soma-run.md" <<'ROLLBACK_COMMAND_EOF'
# Custom command that must survive a failed Phase 7 sync
ROLLBACK_COMMAND_EOF
cp "${ROLLBACK_HOME}/.claude/commands/soma-run.md" "${ROLLBACK_HOME}/pre-failure-soma-run.md"
node -e "
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [repo, project] = process.argv.slice(1);
const targets = JSON.parse(fs.readFileSync(path.join(repo, 'core/adapters/claude/install-targets.json'), 'utf8'));
const installedFiles = Object.fromEntries(targets.entries
  .filter((entry) => entry.kind === 'file' && entry.source_path !== 'adapters/claude/commands/soma-run.md')
  .map((entry) => [entry.target_path, {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'core', entry.source_path))).digest('hex'),
    installedAt: '2026-01-01T00:00:00Z',
  }]));
fs.writeFileSync(path.join(project, '.soma/install-state.json'), JSON.stringify({ installedFiles }) + '\\n');
" "${REPO_ROOT}" "${ROLLBACK_PROJECT}"
cp "${ROLLBACK_PROJECT}/.soma/install-state.json" "${ROLLBACK_PROJECT}/pre-failure-install-state.json"
cat > "${ROLLBACK_HOME}/.claude/CLAUDE.md" <<'CONFLICT_EOF'
<!-- soma-v2:start id=block.claude.CLAUDE_md.hyd-v2 version=1.0 sha256=deadbeef -->
tampered block that forces Phase 7 to fail
<!-- soma-v2:end id=block.claude.CLAUDE_md.hyd-v2 -->
CONFLICT_EOF

set +e
(
  cd "${ROLLBACK_PROJECT}"
  HOME="${ROLLBACK_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh"
) > "${ROLLBACK_HOME}/install-output.log" 2>&1
ROLLBACK_STATUS=$?
set -e
ROLLBACK_BACKUP=$(find "${ROLLBACK_HOME}/.soma-v2-backups" -path '*/claude/commands/soma-run.md' -type f -print -quit)
if [[ "${ROLLBACK_STATUS}" -ne 0 ]] && \
   cmp -s "${ROLLBACK_HOME}/.claude/commands/soma-run.md" "${ROLLBACK_HOME}/pre-failure-soma-run.md" && \
   cmp -s "${ROLLBACK_PROJECT}/.soma/install-state.json" "${ROLLBACK_PROJECT}/pre-failure-install-state.json" && \
   [[ -n "${ROLLBACK_BACKUP}" ]] && \
   cmp -s "${ROLLBACK_BACKUP}" "${ROLLBACK_HOME}/pre-failure-soma-run.md"; then
  pass "2b/R-08: late Phase 7 conflict restores command and ledger bytes, and preserves backup"
else
  fail "2b/R-08: late-conflict rollback failed (status=${ROLLBACK_STATUS}, backup=${ROLLBACK_BACKUP:-missing})"
  tail -30 "${ROLLBACK_HOME}/install-output.log" >&2
fi

# ── Test 2c: SIGTERM during Phase 7 restores command + ledger ──────────────
echo ""
echo "[TEST 2c] Phase 7 SIGTERM rollback..."
mkdir -p "${TERM_HOME}/.claude/commands" "${TERM_PROJECT}/.soma" "${TEST_BIN}"
printf '# Command before SIGTERM\n' > "${TERM_HOME}/.claude/commands/soma-run.md"
node -e "
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [repo, project] = process.argv.slice(1);
const targets = JSON.parse(fs.readFileSync(path.join(repo, 'core/adapters/claude/install-targets.json'), 'utf8'));
const installedFiles = Object.fromEntries(targets.entries
  .filter((entry) => entry.kind === 'file' && entry.source_path !== 'adapters/claude/commands/soma-run.md')
  .map((entry) => [entry.target_path, {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'core', entry.source_path))).digest('hex'),
    installedAt: '2026-01-01T00:00:00Z',
  }]));
fs.writeFileSync(path.join(project, '.soma/install-state.json'), JSON.stringify({ installedFiles }) + '\\n');
" "${REPO_ROOT}" "${TERM_PROJECT}"
cp "${TERM_HOME}/.claude/commands/soma-run.md" "${TERM_HOME}/pre-term-soma-run.md"
cp "${TERM_PROJECT}/.soma/install-state.json" "${TERM_PROJECT}/pre-term-install-state.json"
cat > "${TEST_BIN}/node" <<NODE_WRAPPER_EOF
#!/usr/bin/env bash
if [[ "\${1:-}" == */.soma-v2/scripts/soma.cjs && "\${2:-}" == "sync" ]]; then
  "${NODE_BIN}" "\$@"
  status=\$?
  printf '%s\\n' "\${PPID}" > "${TERM_HOME}/phase7-sync-parent"
  touch "${TERM_HOME}/phase7-sync-finished"
  sleep 5
  exit "\${status}"
fi
exec "${NODE_BIN}" "\$@"
NODE_WRAPPER_EOF
chmod +x "${TEST_BIN}/node"

set +e
(
  cd "${TERM_PROJECT}"
  PATH="${TEST_BIN}:${PATH}" HOME="${TERM_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh"
) > "${TERM_HOME}/install-output.log" 2>&1 &
TERM_JOB=$!
for _ in $(seq 1 500); do
  [[ -f "${TERM_HOME}/phase7-sync-finished" ]] && break
  sleep 0.01
done
if [[ -f "${TERM_HOME}/phase7-sync-parent" ]]; then
  kill -TERM "$(< "${TERM_HOME}/phase7-sync-parent")"
fi
wait "${TERM_JOB}"
TERM_STATUS=$?
set -e
if [[ "${TERM_STATUS}" -ne 0 ]] && [[ -f "${TERM_HOME}/phase7-sync-finished" ]] && \
   cmp -s "${TERM_HOME}/.claude/commands/soma-run.md" "${TERM_HOME}/pre-term-soma-run.md" && \
   cmp -s "${TERM_PROJECT}/.soma/install-state.json" "${TERM_PROJECT}/pre-term-install-state.json"; then
  pass "2c/R-08: SIGTERM during Phase 7 exits non-zero and restores command + ledger bytes"
else
  fail "2c/R-08: SIGTERM rollback failed (status=${TERM_STATUS})"
  tail -30 "${TERM_HOME}/install-output.log" >&2
fi

# ── Test 2d: same-second installations keep independent backups ────────────
echo ""
echo "[TEST 2d] Same-second backup uniqueness..."
mkdir -p "${BACKUP_HOME}/.claude/commands" "${BACKUP_PROJECT}/.soma"
printf '{"installedFiles":{}}\n' > "${BACKUP_PROJECT}/.soma/install-state.json"
printf '# First backup bytes\n' > "${BACKUP_HOME}/.claude/commands/soma-run.md"
cat > "${TEST_BIN}/date" <<'DATE_WRAPPER_EOF'
#!/usr/bin/env bash
printf '1724457600\n'
DATE_WRAPPER_EOF
chmod +x "${TEST_BIN}/date"
(
  cd "${BACKUP_PROJECT}"
  PATH="${TEST_BIN}:${PATH}" HOME="${BACKUP_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh" --no-claude-md
) > "${BACKUP_HOME}/first-install.log" 2>&1
FIRST_BACKUP=$(find "${BACKUP_HOME}/.soma-v2-backups" -path '*/claude/commands/soma-run.md' -type f -print -quit)
printf '# Second backup bytes\n' > "${BACKUP_HOME}/.claude/commands/soma-run.md"
(
  cd "${BACKUP_PROJECT}"
  PATH="${TEST_BIN}:${PATH}" HOME="${BACKUP_HOME}" FORCE_OVERWRITE=1 NO_CODEX=1 SOMA_NO_PHASE9=1 \
    bash "${REPO_ROOT}/install.sh" --no-claude-md
) > "${BACKUP_HOME}/second-install.log" 2>&1
BACKUP_DIRS=( $(find "${BACKUP_HOME}/.soma-v2-backups" -mindepth 1 -maxdepth 1 -type d | sort) )
if [[ "${#BACKUP_DIRS[@]}" -eq 2 ]] && \
   cmp -s "${FIRST_BACKUP}" <(printf '# First backup bytes\n') && \
   find "${BACKUP_HOME}/.soma-v2-backups" -path '*/claude/commands/soma-run.md' ! -path "${FIRST_BACKUP}" -exec cmp -s {} <(printf '# Second backup bytes\n') \; -print -quit | grep -q .; then
  pass "2d/R-08: same-second installs create distinct backups without clobbering the first"
else
  fail "2d/R-08: same-second backup collision or clobber detected"
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
