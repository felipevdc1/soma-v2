#!/usr/bin/env bash
# install.sh - global, durable SOMA installer
# Usage: bash install.sh [--dry-run] [--no-codex] [--no-claude-md] [--force-overwrite]

set -euo pipefail
trap '' PIPE

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKUP_ROOT="${HOME}/.soma-v2-backups"
GLOBAL_LEDGER="${HOME}/.soma-v2/.soma/install-state.json"
DRY_RUN=0
NO_CODEX=${NO_CODEX:-0}
NO_CLAUDE_MD=${NO_CLAUDE_MD:-0}
FORCE_OVERWRITE=${FORCE_OVERWRITE:-0}
TRANSACTION_JOURNAL=""
TRANSACTION_DIR=""
TRANSACTION_COMMITTED=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-codex) NO_CODEX=1 ;;
    --no-claude-md) NO_CLAUDE_MD=1 ;;
    --force-overwrite) FORCE_OVERWRITE=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ -n "${SOMA_INSTALL_FAULT_AFTER:-}" || -n "${SOMA_INSTALL_CRASH_AFTER:-}" ]]; then
  if [[ "${SOMA_INSTALL_TESTING:-0}" != "1" ]]; then
    echo "ERROR: install fault injection requires SOMA_INSTALL_TESTING=1" >&2
    exit 2
  fi
fi

echo "[SOMA] Phase 0: read-only recovery and preflight"

NODE_VER="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [[ "${NODE_VER}" -lt 22 ]]; then
  echo "ERROR: Need Node v22+ (found: ${NODE_VER:-none})" >&2
  exit 1
fi

PLATFORM="$("${REPO_ROOT}/install/platform-detect.sh")"
echo "[SOMA] Platform: ${PLATFORM}"

node -e '
const fs = require("fs");
const path = require("path");
const home = process.argv[1];
if (!path.isAbsolute(home)) throw new Error("HOME must be absolute");
const homeStat = fs.lstatSync(home);
if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) throw new Error("HOME must be a real directory");
for (const candidate of [".claude", ".codex", ".soma-v2", ".soma-v2-backups"].map((name) => path.join(home, name))) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`no existing ancestor for ${candidate}`);
    current = parent;
  }
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe ancestor for ${candidate}: ${current}`);
  fs.accessSync(current, fs.constants.W_OK);
}
' "${HOME}"

if ! node "${REPO_ROOT}/install/check-mcp-deps.cjs"; then
  echo "[WARN] optional MCP dependency check reported missing integrations" >&2
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "[WARN] Claude CLI not found; soma audit will be unavailable" >&2
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  if ! RECOVERY_RESULT="$(node "${REPO_ROOT}/install/global-transaction.cjs" recover --backup-root "${BACKUP_ROOT}" --dry-run)"; then
    echo "${RECOVERY_RESULT}" >&2
    exit 3
  fi
else
  if ! RECOVERY_RESULT="$(node "${REPO_ROOT}/install/global-transaction.cjs" recover --backup-root "${BACKUP_ROOT}")"; then
    echo "${RECOVERY_RESULT}" >&2
    exit 3
  fi
fi
echo "[SOMA] Recovery: ${RECOVERY_RESULT}"

# This legacy detector remains a read-only diagnostic. Transactional adoption
# below makes the ownership decision for every declared whole-file target.
# T08C_COLLISION_DETECT_BEGIN
HOOKS_TARGET="${HOME}/.claude/hooks"
if [[ -d "${HOOKS_TARGET}" ]]; then
  COLLISIONS=$(node "${REPO_ROOT}/install/detect-collisions.cjs" \
    --target="${HOOKS_TARGET}" \
    --soma-list="${REPO_ROOT}/install/soma-hooks-map.json" \
    --soma-dir="${REPO_ROOT}/core/hooks")
else
  COLLISIONS=""
fi
# T08C_COLLISION_DETECT_END
if [[ -n "${COLLISIONS}" ]]; then
  echo "[SOMA] Whole-file ownership candidates detected; transactional adoption will decide:"
  echo "${COLLISIONS}"
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  case "${RECOVERY_RESULT}" in
    *'"status":"PENDING"'*)
      echo "[DRY-RUN] Pending transaction reported; no recovery or install attempted"
      exit 0
      ;;
  esac
  set +e
  DRY_SYNC_OUTPUT="$(node "${REPO_ROOT}/core/scripts/sync.cjs" --dry-run --json --files-only \
    --tool=claude --soma-home="${REPO_ROOT}/core" --ledger-root="${HOME}/.soma-v2")"
  DRY_SYNC_STATUS=$?
  set -e
  if [[ "${DRY_SYNC_STATUS}" -gt 1 ]]; then
    echo "${DRY_SYNC_OUTPUT}" >&2
    exit "${DRY_SYNC_STATUS}"
  fi
  echo "${DRY_SYNC_OUTPUT}"
  node "${REPO_ROOT}/install/merge-settings.cjs" \
    --target="${HOME}/.claude/settings.json" \
    --map="${REPO_ROOT}/install/soma-hooks-map.json" \
    --dry-run
  echo "[DRY-RUN] Would prepare, apply, verify and commit a durable global transaction"
  exit 0
fi

# When a global ledger already exists, validate ownership before snapshotting a
# new candidate. Exit 1 means planned source updates; only drift is blocking.
if [[ -e "${GLOBAL_LEDGER}" ]]; then
  set +e
  PREFLIGHT_JSON="$(node "${REPO_ROOT}/core/scripts/sync.cjs" --dry-run --json --files-only \
    --tool=claude --soma-home="${REPO_ROOT}/core" --ledger-root="${HOME}/.soma-v2")"
  PREFLIGHT_STATUS=$?
  set -e
  if [[ "${PREFLIGHT_STATUS}" -gt 1 ]]; then
    echo "${PREFLIGHT_JSON}" >&2
    exit "${PREFLIGHT_STATUS}"
  fi
  printf '%s' "${PREFLIGHT_JSON}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const result = JSON.parse(input);
  const drift = (result.findings || []).filter((finding) => finding.kind === "file" && finding.action === "drift");
  if (drift.length) {
    process.stderr.write(`GLOBAL_OWNERSHIP_CONFLICT: ${drift.map((finding) => finding.target_path).join(", ")}\n`);
    process.exitCode = 2;
  }
});
'
fi

SOURCE_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || true)"
if [[ ! "${SOURCE_SHA}" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  SOURCE_SHA="$(node -e '
const crypto = require("crypto");
const fs = require("fs");
process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "${REPO_ROOT}/core/manifest.json")"
fi

PREPARE_ARGS=(prepare --repo-root "${REPO_ROOT}" --home "${HOME}" --backup-root "${BACKUP_ROOT}" --source-sha "${SOURCE_SHA}")
[[ "${NO_CODEX}" == "1" ]] && PREPARE_ARGS+=(--no-codex)
[[ "${NO_CLAUDE_MD}" == "1" ]] && PREPARE_ARGS+=(--no-claude-md)
TRANSACTION_JSON="$(node "${REPO_ROOT}/install/global-transaction.cjs" "${PREPARE_ARGS[@]}")"
TRANSACTION_JOURNAL="$(printf '%s' "${TRANSACTION_JSON}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => process.stdout.write(JSON.parse(input).journal_path));
')"
TRANSACTION_DIR="$(dirname "${TRANSACTION_JOURNAL}")"
echo "[SOMA] PREPARED: ${TRANSACTION_JOURNAL}"

transaction_abort() {
  local status="$1"
  trap - EXIT INT TERM
  if [[ "${TRANSACTION_COMMITTED}" != "1" && -n "${TRANSACTION_JOURNAL}" ]]; then
    echo "[SOMA] Rolling back transaction after status ${status}" >&2
    if ! node "${REPO_ROOT}/install/global-transaction.cjs" rollback --transaction "${TRANSACTION_JOURNAL}" >/dev/null; then
      echo "RECOVERY_BLOCKED: rollback failed for ${TRANSACTION_JOURNAL}" >&2
      exit 70
    fi
  fi
  [[ "${status}" -ne 0 ]] || status=1
  exit "${status}"
}
trap 'transaction_abort $?' EXIT
trap 'transaction_abort 130' INT
trap 'transaction_abort 143' TERM

maybe_fault() {
  local state="$1"
  if [[ "${SOMA_INSTALL_FAULT_AFTER:-}" == "${state}" ]]; then
    echo "[SOMA TEST] injected exit after ${state}" >&2
    exit 97
  fi
  case "${SOMA_INSTALL_CRASH_AFTER:-}" in
    "${state}"|"KILL:${state}") kill -KILL "$$" ;;
    "INT:${state}") kill -INT "$$" ;;
    "TERM:${state}") kill -TERM "$$" ;;
  esac
}

advance_state() {
  local state="$1"
  node "${REPO_ROOT}/install/global-transaction.cjs" advance --transaction "${TRANSACTION_JOURNAL}" --to "${state}" >/dev/null
  echo "[SOMA] ${state}"
  maybe_fault "${state}"
}

maybe_fault PREPARED

PREVIOUS_ROOT="$(printf '%s' "${TRANSACTION_JSON}" | node -e '
const path = require("path");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const journal = JSON.parse(input);
  const target = path.join(journal.home, ".soma-v2");
  const snapshot = journal.snapshots.find((entry) => entry.target_path === target);
  if (snapshot && snapshot.existed) process.stdout.write(snapshot.snapshot_path);
});
')"

if [[ ! -e "${GLOBAL_LEDGER}" ]]; then
  if [[ -z "${PREVIOUS_ROOT}" ]]; then
    PREVIOUS_ROOT="${TRANSACTION_DIR}/previous-empty"
    EMPTY_PREVIOUS_TOOLS=(claude)
    [[ "${NO_CODEX}" == "1" ]] || EMPTY_PREVIOUS_TOOLS+=(codex)
    node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const tools = process.argv.slice(2);
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
  schema: "soma-manifest/v1", version: "empty", files: []
}, null, 2) + "\n");
for (const tool of tools) {
  const adapter = path.join(root, "adapters", tool);
  fs.mkdirSync(adapter, { recursive: true });
  fs.writeFileSync(path.join(adapter, "install-targets.json"), JSON.stringify({
    schema: "soma-install-targets/v1", tool, entries: []
  }, null, 2) + "\n");
}
' "${PREVIOUS_ROOT}" "${EMPTY_PREVIOUS_TOOLS[@]}"
  fi
  ADOPTION_ARGS=(--apply --tool=claude --soma-home="${REPO_ROOT}/core" \
    --ledger-root="${HOME}/.soma-v2" --adopt-from="${PREVIOUS_ROOT}" \
    --transaction-journal="${TRANSACTION_JOURNAL}")
  [[ "${FORCE_OVERWRITE}" == "1" ]] && ADOPTION_ARGS+=(--allow-new-target-overwrite)
  node "${REPO_ROOT}/core/scripts/sync.cjs" "${ADOPTION_ARGS[@]}"
  if [[ "${NO_CODEX}" != "1" ]]; then
    node "${REPO_ROOT}/core/scripts/sync.cjs" --apply --tool=codex \
      --soma-home="${REPO_ROOT}/core" --ledger-root="${HOME}/.soma-v2" \
      --adopt-from="${PREVIOUS_ROOT}" --transaction-journal="${TRANSACTION_JOURNAL}"
  fi
fi
advance_state ADOPTED

STAGED_CORE="${TRANSACTION_DIR}/staged-core"
mkdir -p "${STAGED_CORE}"
rsync -a "${REPO_ROOT}/core/" "${STAGED_CORE}/"
mkdir -p "${HOME}/.soma-v2"
rsync -a --checksum --no-times "${STAGED_CORE}/" "${HOME}/.soma-v2/"
advance_state CORE_COPIED

node "${HOME}/.soma-v2/scripts/soma.cjs" sync --apply --files-only --tool=claude --soma-home="${HOME}/.soma-v2" --ledger-root="${HOME}/.soma-v2"
mkdir -p "${HOME}/.claude/templates" "${HOME}/.claude/output-styles"
rsync -a --checksum --no-times "${REPO_ROOT}/templates/" "${HOME}/.claude/templates/"
rsync -a --checksum --no-times "${REPO_ROOT}/output-styles/" "${HOME}/.claude/output-styles/"
advance_state FILES_SYNCED

STAGED_SETTINGS="${TRANSACTION_DIR}/settings.json"
if [[ -f "${HOME}/.claude/settings.json" ]]; then
  cp "${HOME}/.claude/settings.json" "${STAGED_SETTINGS}"
else
  printf '{}\n' > "${STAGED_SETTINGS}"
fi
node "${REPO_ROOT}/install/merge-settings.cjs" \
  --target="${STAGED_SETTINGS}" \
  --map="${REPO_ROOT}/install/soma-hooks-map.json"
mkdir -p "${HOME}/.claude"
if [[ ! -f "${HOME}/.claude/settings.json" ]] || ! cmp -s "${STAGED_SETTINGS}" "${HOME}/.claude/settings.json"; then
  cp "${STAGED_SETTINGS}" "${HOME}/.claude/settings.json"
fi
advance_state SETTINGS_MERGED

if [[ "${NO_CLAUDE_MD}" != "1" ]]; then
  node "${HOME}/.soma-v2/scripts/sync.cjs" --apply --tool=claude \
    --soma-home="${HOME}/.soma-v2" --ledger-root="${HOME}/.soma-v2"
fi
if [[ "${NO_CODEX}" != "1" ]]; then
  node "${HOME}/.soma-v2/scripts/sync.cjs" --apply --tool=codex \
    --soma-home="${HOME}/.soma-v2" --ledger-root="${HOME}/.soma-v2"
fi
advance_state ANCHORS_SYNCED

VERIFY_CLAUDE_ARGS=(--dry-run --tool=claude --soma-home="${HOME}/.soma-v2" --ledger-root="${HOME}/.soma-v2")
[[ "${NO_CLAUDE_MD}" == "1" ]] && VERIFY_CLAUDE_ARGS+=(--files-only)
node "${HOME}/.soma-v2/scripts/sync.cjs" "${VERIFY_CLAUDE_ARGS[@]}"
if [[ "${NO_CODEX}" != "1" ]]; then
  node "${HOME}/.soma-v2/scripts/sync.cjs" --dry-run --tool=codex \
    --soma-home="${HOME}/.soma-v2" --ledger-root="${HOME}/.soma-v2"
fi

node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const [home, somaHome] = process.argv.slice(1);
const manifest = JSON.parse(fs.readFileSync(path.join(somaHome, "adapters", "claude", "install-targets.json"), "utf8"));
const ledger = JSON.parse(fs.readFileSync(path.join(somaHome, ".soma", "install-state.json"), "utf8"));
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const entry of manifest.entries.filter((item) => item.kind === "file")) {
  const source = path.join(somaHome, entry.source_path);
  const target = path.join(home, entry.target_path.slice(2));
  const expected = hash(source);
  if (!fs.existsSync(target) || hash(target) !== expected || ledger.installedFiles?.[entry.target_path]?.sha256 !== expected) {
    throw new Error(`target/ledger verification failed: ${entry.target_path}`);
  }
}
' "${HOME}" "${HOME}/.soma-v2"

set +e
DOCTOR_JSON="$(node "${HOME}/.soma-v2/scripts/soma.cjs" doctor --json --soma-home="${HOME}/.soma-v2")"
DOCTOR_STATUS=$?
set -e
printf '%s' "${DOCTOR_JSON}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const [noCodex, noClaudeMd] = process.argv.slice(1);
  const result = JSON.parse(input);
  const blockers = (result.findings || []).filter((finding) => {
    if (["ok", "warning"].includes(finding.severity)) return false;
    if (noCodex === "1" && finding.adapter === "codex") return false;
    if (noClaudeMd === "1" && finding.adapter === "claude" && finding.kind !== "file_drift") return false;
    return true;
  });
  if (blockers.length) {
    process.stderr.write(`doctor failed requested adapters: ${JSON.stringify(blockers)}\n`);
    process.exitCode = 1;
  }
});
' "${NO_CODEX}" "${NO_CLAUDE_MD}"
if [[ "${DOCTOR_STATUS}" -gt 1 ]]; then
  echo "${DOCTOR_JSON}" >&2
  exit "${DOCTOR_STATUS}"
fi

advance_state VERIFIED
node "${REPO_ROOT}/install/global-transaction.cjs" advance --transaction "${TRANSACTION_JOURNAL}" --to COMMITTED >/dev/null
TRANSACTION_COMMITTED=1
trap - EXIT INT TERM

echo "[SOMA] COMMITTED"
echo "SOMA v2.1 installed from ${REPO_ROOT}"
echo "Backup: ${TRANSACTION_DIR}"
