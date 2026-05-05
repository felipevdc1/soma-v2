#!/usr/bin/env bash
# install/docker-test.sh — Phase 6.8: cross-platform container test
#
# Validates that install.sh runs cleanly on fresh Linux (Docker node:22-bookworm):
#   Phase 1: install.sh first run in fresh /root HOME
#   Phase 2: smoke pack (verify-portability.cjs --mode=ci)
#   Phase 3: idempotency re-run + sha256 check on settings.json
#   Phase 4: post-install shasum sample of installed files
#   Phase 5: structure smoke (directories, hook count, output-style)
#
# D-P6-11: Claude CLI is intentionally absent in container.
#   verify-portability.cjs --mode=ci skips gate2/3/4/5/6/7/8 (all require live
#   Claude Code session). Only gate1/9/10/11/12 execute:
#     gate1  — VERSION == plugin.json version
#     gate9  — output-styles/soma-voxel.md exists
#     gate10 — plugin.json is valid JSON
#     gate11 — constitution.md v1.0.0 + no DRAFT
#     gate12 — zero personal identifier leaks in published files
#
# Colima (virtiofs/VZ) note: colima mounts $HOME but NOT /tmp.
#   If REPO_ROOT is under /tmp (common for worktrees), the script copies
#   the repo to DOCKER_REPO_TMP ($HOME/.soma-docker-build-tmp) before
#   running the container. Set DOCKER_REPO_TMP to skip this.
#
# Usage:
#   cd /path/to/soma-v2 && bash install/docker-test.sh
#   REPO_ROOT=/path/to/soma-v2 bash install/docker-test.sh
#   LOG_DIR=/tmp/mydir bash install/docker-test.sh

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG_DIR="${LOG_DIR:-/tmp/soma-v2-docker-test}"
TIMESTAMP=$(date +%s)
LOG_FILE="${LOG_DIR}/docker-run-${TIMESTAMP}.log"
CLEANUP_DOCKER_COPY=0

mkdir -p "${LOG_DIR}"

echo "[SOMA-DOCKER] Phase 6.8: Container test (node:22-bookworm)"
echo "[SOMA-DOCKER] REPO_ROOT: ${REPO_ROOT}"
echo "[SOMA-DOCKER] Log: ${LOG_FILE}"
echo ""

# ── Preflight: Docker availability ───────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "[SOMA-DOCKER] ERROR: Docker not found on PATH." >&2
  echo "[SOMA-DOCKER] Install Docker Desktop / Colima and retry." >&2
  exit 1
fi

echo "[SOMA-DOCKER] Docker: $(docker --version)"

if ! docker info &>/dev/null; then
  echo "[SOMA-DOCKER] ERROR: Docker daemon not running." >&2
  echo "[SOMA-DOCKER] Try: colima start   OR   open Docker Desktop" >&2
  exit 1
fi

# ── Colima virtiofs workaround ────────────────────────────────────────────────
# Colima with VZ+virtiofs only mounts $HOME into the VM, not /tmp.
# If REPO_ROOT is not under $HOME, copy it to a temp dir inside $HOME
# so the volume mount is accessible in the container.

DOCKER_MOUNT_ROOT="${REPO_ROOT}"

if [[ "${REPO_ROOT}" != "${HOME}"* ]]; then
  DOCKER_REPO_TMP="${HOME}/.soma-docker-build-tmp"
  echo "[SOMA-DOCKER] REPO_ROOT is outside \$HOME (colima virtiofs limitation)."
  echo "[SOMA-DOCKER] Copying repo to ${DOCKER_REPO_TMP} for volume mount..."
  rm -rf "${DOCKER_REPO_TMP}"
  cp -r "${REPO_ROOT}" "${DOCKER_REPO_TMP}"
  DOCKER_MOUNT_ROOT="${DOCKER_REPO_TMP}"
  CLEANUP_DOCKER_COPY=1
  echo "[SOMA-DOCKER] Copy done: ${DOCKER_MOUNT_ROOT}"
  echo ""
fi

# ── Pull image ────────────────────────────────────────────────────────────────

echo "[SOMA-DOCKER] Pulling node:22-bookworm (uses cache if already present)..."
docker pull node:22-bookworm

echo ""
echo "[SOMA-DOCKER] Starting container run..."
START_TS=$(date +%s)

# ── Container inner script ───────────────────────────────────────────────────
# NOTE: Variables referencing the outer shell must be passed via -e or
# embedded in the -c string. We embed nothing from host — all paths are
# /repo (the mounted volume) or /root (the container's fresh HOME).

docker run --rm \
  -v "${DOCKER_MOUNT_ROOT}:/repo:ro" \
  -e HOME=/root \
  node:22-bookworm bash -c '
set -euo pipefail

echo ""
echo "=== Container info ==="
echo "  OS:   $(uname -s) $(uname -m)"
echo "  Node: $(node -v)"
echo "  User: $(whoami), HOME: ${HOME}"
echo ""

echo "=== Installing apt prerequisites ==="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync git 2>&1 | grep -v "^debconf" || true
echo "  rsync: $(rsync --version | head -1)"
echo "  git:   $(git --version)"
echo ""

echo "=== Verifying /repo mount ==="
ls /repo/install.sh > /dev/null || { echo "ERROR: /repo mount empty or install.sh missing"; exit 1; }
echo "  /repo/install.sh: EXISTS"
echo "  /repo files: $(ls /repo | wc -l | tr -d " ")"
echo ""

echo "=== Copying /repo to /work (writable workspace) ==="
mkdir -p /work
rsync -a /repo/ /work/
chmod -R u+w /work
echo "  /work/install.sh: $(test -f /work/install.sh && echo EXISTS || echo MISSING)"
cd /work

echo ""
echo "=== Phase 1: install.sh first run ==="
HOME=/root FORCE_OVERWRITE=1 NO_CODEX=1 NO_CLAUDE_MD=1 bash install.sh
INSTALL_EXIT=$?
echo "[Phase 1] exit: ${INSTALL_EXIT}"

echo ""
echo "=== Phase 2: smoke pack (--mode=ci) ==="
node install/verify-portability.cjs --mode=ci
SMOKE_EXIT=$?
echo "[Phase 2] smoke pack exit: ${SMOKE_EXIT}"

echo ""
echo "=== Phase 3: idempotency re-run ==="
SHA_PRE=$(sha256sum /root/.claude/settings.json | awk "{print \$1}")
echo "[Phase 3] settings.json SHA pre:  ${SHA_PRE}"

HOME=/root FORCE_OVERWRITE=1 NO_CODEX=1 NO_CLAUDE_MD=1 bash install.sh 2>&1 | tail -5

SHA_POST=$(sha256sum /root/.claude/settings.json | awk "{print \$1}")
echo "[Phase 3] settings.json SHA post: ${SHA_POST}"

if [ "${SHA_PRE}" = "${SHA_POST}" ]; then
  echo "[Phase 3] IDEMPOTENCY: PASS (sha256 identical: ${SHA_PRE})"
else
  echo "[Phase 3] IDEMPOTENCY: FAIL (sha changed)"
  echo "  pre:  ${SHA_PRE}"
  echo "  post: ${SHA_POST}"
  SMOKE_EXIT=1
fi

echo ""
echo "=== Phase 4: post-install shasum sample ==="
echo "-- .cjs files (first 15) --"
find /root/.soma-v2 -type f -name "*.cjs" | sort | head -15 | while IFS= read -r f; do sha256sum "$f"; done
echo "-- .json files (first 5) --"
find /root/.soma-v2 -type f -name "*.json" | sort | head -5 | while IFS= read -r f; do sha256sum "$f"; done

echo ""
echo "=== Phase 5: structure smoke ==="
SOMA_EXISTS=$(test -d /root/.soma-v2 && echo "YES" || echo "NO")
HOOKS_EXISTS=$(test -d /root/.claude/hooks && echo "YES" || echo "NO")
HOOK_COUNT=$(find /root/.claude/hooks -name "*.cjs" 2>/dev/null | wc -l | tr -d " ")
OVOX=$(test -f /root/.claude/output-styles/soma-voxel.md && echo "EXISTS" || echo "MISSING")
CMDS_COUNT=$(find /root/.claude/commands -name "*.md" 2>/dev/null | wc -l | tr -d " ")
echo "  .soma-v2 dir:          ${SOMA_EXISTS}"
echo "  .claude/hooks dir:     ${HOOKS_EXISTS}"
echo "  hooks/*.cjs count:     ${HOOK_COUNT}"
echo "  soma-voxel.md:         ${OVOX}"
echo "  commands/*.md count:   ${CMDS_COUNT}"

echo ""
echo "=== Container run summary ==="
echo "  install exit:   ${INSTALL_EXIT}"
echo "  smoke pack:     ${SMOKE_EXIT}"
echo "  idempotency:    $([ "${SHA_PRE}" = "${SHA_POST}" ] && echo PASS || echo FAIL)"

exit "${SMOKE_EXIT}"
' 2>&1 | tee "${LOG_FILE}"

DOCKER_EXIT="${PIPESTATUS[0]}"
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

# ── Cleanup copy if we made one ───────────────────────────────────────────────
if [[ "${CLEANUP_DOCKER_COPY}" == "1" ]]; then
  rm -rf "${HOME}/.soma-docker-build-tmp"
  echo "[SOMA-DOCKER] Cleaned up temp copy."
fi

echo ""
echo "[SOMA-DOCKER] Elapsed: ${ELAPSED}s"
echo "[SOMA-DOCKER] Docker exit: ${DOCKER_EXIT}"
echo "[SOMA-DOCKER] Full log: ${LOG_FILE}"

exit "${DOCKER_EXIT}"
