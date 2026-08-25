#!/usr/bin/env bash
# End-to-end canary for the global transactional installer.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/soma-global-synthetic.XXXXXX")"
HOME_ROOT="${SANDBOX}/home"
PROJECT_A="${SANDBOX}/worktree-a"
PROJECT_B="${SANDBOX}/worktree-b"
DRY_HOME="${SANDBOX}/dry-home"
PASS=0
FAIL=0

cleanup() { rm -rf "${SANDBOX}"; }
trap cleanup EXIT

pass() { echo "[PASS] $*"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $*" >&2; FAIL=$((FAIL + 1)); }
hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

mkdir -p "${HOME_ROOT}/.claude" "${PROJECT_A}" "${PROJECT_B}" "${DRY_HOME}"

echo "[TEST] dry-run is pure"
printf 'sentinel\n' > "${DRY_HOME}/sentinel"
DRY_BEFORE="$(hash_file "${DRY_HOME}/sentinel")"
(
  cd "${PROJECT_A}"
  HOME="${DRY_HOME}" NO_CODEX=1 SOMA_INSTALL_TESTING=1 \
    bash "${REPO_ROOT}/install.sh" --dry-run
) > "${SANDBOX}/dry.log" 2>&1
if [[ "$(hash_file "${DRY_HOME}/sentinel")" == "${DRY_BEFORE}" ]] && \
   [[ ! -e "${DRY_HOME}/.soma-v2" ]] && [[ ! -e "${DRY_HOME}/.soma-v2-backups" ]]; then
  pass "dry-run did not create or mutate HOME paths"
else
  fail "dry-run changed HOME"
fi

cat > "${HOME_ROOT}/.claude/settings.json" <<'JSON'
{
  "env": { "USER_PRECONFIG": "baseline" },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "command": "user-custom.sh" }] }
    ]
  }
}
JSON
printf '# user CLAUDE bytes\n' > "${HOME_ROOT}/.claude/CLAUDE.md"

echo "[TEST] --no-claude-md still installs whole files"
(
  cd "${PROJECT_A}"
  HOME="${HOME_ROOT}" NO_CODEX=1 SOMA_INSTALL_TESTING=1 \
    bash "${REPO_ROOT}/install.sh" --no-claude-md
) > "${SANDBOX}/first.log" 2>&1

GLOBAL_LEDGER="${HOME_ROOT}/.soma-v2/.soma/install-state.json"
if [[ -f "${GLOBAL_LEDGER}" ]] && [[ ! -e "${PROJECT_A}/.soma/install-state.json" ]]; then
  pass "global ledger exists and project ledger is absent"
else
  fail "ledger landed outside ~/.soma-v2/.soma"
fi

if [[ "$(< "${HOME_ROOT}/.claude/CLAUDE.md")" == "# user CLAUDE bytes" ]] && \
   [[ -f "${HOME_ROOT}/.claude/commands/soma-run.md" ]]; then
  pass "--no-claude-md preserved the block target and installed whole files"
else
  fail "--no-claude-md behavior is wrong"
fi

USER_CONFIG_OK="$(node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const custom = (value.hooks?.PreToolUse || []).some((entry) =>
  entry._soma_managed !== true && entry.hooks?.some((hook) => hook.command === "user-custom.sh")
);
if (value.env?.USER_PRECONFIG === "baseline" && custom) process.stdout.write("ok");
' "${HOME_ROOT}/.claude/settings.json")"
if [[ "${USER_CONFIG_OK}" == "ok" ]]; then
  pass "settings merge preserved user env and hook"
else
  fail "settings merge lost user config"
fi

CORE_MTIME="$(stat -f %m "${HOME_ROOT}/.soma-v2/scripts/soma.cjs" 2>/dev/null || stat -c %Y "${HOME_ROOT}/.soma-v2/scripts/soma.cjs")"
CORE_HASH="$(hash_file "${HOME_ROOT}/.soma-v2/scripts/soma.cjs")"
LEDGER_MTIME="$(stat -f %m "${GLOBAL_LEDGER}" 2>/dev/null || stat -c %Y "${GLOBAL_LEDGER}")"
LEDGER_HASH="$(hash_file "${GLOBAL_LEDGER}")"

echo "[TEST] second project directory converges without rewrites"
(
  cd "${PROJECT_B}"
  HOME="${HOME_ROOT}" NO_CODEX=1 SOMA_INSTALL_TESTING=1 \
    bash "${REPO_ROOT}/install.sh" --no-claude-md
) > "${SANDBOX}/second.log" 2>&1

CORE_MTIME_AFTER="$(stat -f %m "${HOME_ROOT}/.soma-v2/scripts/soma.cjs" 2>/dev/null || stat -c %Y "${HOME_ROOT}/.soma-v2/scripts/soma.cjs")"
LEDGER_MTIME_AFTER="$(stat -f %m "${GLOBAL_LEDGER}" 2>/dev/null || stat -c %Y "${GLOBAL_LEDGER}")"
if [[ "$(hash_file "${HOME_ROOT}/.soma-v2/scripts/soma.cjs")" == "${CORE_HASH}" ]] && \
   [[ "${CORE_MTIME_AFTER}" == "${CORE_MTIME}" ]] && \
   [[ "$(hash_file "${GLOBAL_LEDGER}")" == "${LEDGER_HASH}" ]] && \
   [[ "${LEDGER_MTIME_AFTER}" == "${LEDGER_MTIME}" ]] && \
   [[ ! -e "${PROJECT_B}/.soma/install-state.json" ]]; then
  pass "second install from another directory performed no asset or ledger rewrite"
else
  fail "second install rewrote core/ledger or created a project ledger"
fi

if [[ ! -e "${HOME_ROOT}/.soma-v2-backups/.active-transaction.json" ]]; then
  pass "successful commit released the active pointer"
else
  fail "successful install left an active transaction pointer"
fi

TOTAL=$((PASS + FAIL))
echo "Results: ${PASS}/${TOTAL} PASS, ${FAIL} FAIL"
[[ "${FAIL}" -eq 0 ]]
