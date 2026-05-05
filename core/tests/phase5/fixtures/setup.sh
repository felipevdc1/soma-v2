#!/usr/bin/env bash
# Phase 5 test fixture setup. Used by tests/phase5/*.test.cjs.
set -euo pipefail

FIXTURE_DIR="/tmp/phase5-validation"

echo "==> Setting up Phase 5 fixtures in ${FIXTURE_DIR}"

# Create fixture directory if not exists
mkdir -p "${FIXTURE_DIR}"

# Copy real AGENTS.md as fixture
cp -f "${HOME}/.codex/AGENTS.md" "${FIXTURE_DIR}/AGENTS.md.fixture"
AGENTS_SIZE=$(wc -c < "${FIXTURE_DIR}/AGENTS.md.fixture")
echo "Created ${FIXTURE_DIR}/AGENTS.md.fixture (${AGENTS_SIZE} bytes)"

# Copy real CLAUDE.md as fixture
cp -f "${HOME}/.claude/CLAUDE.md" "${FIXTURE_DIR}/CLAUDE.md.fixture"
CLAUDE_SIZE=$(wc -c < "${FIXTURE_DIR}/CLAUDE.md.fixture")
echo "Created ${FIXTURE_DIR}/CLAUDE.md.fixture (${CLAUDE_SIZE} bytes)"

# Compute sha256 baseline for both fixtures
shasum -a 256 "${FIXTURE_DIR}"/*.fixture > "${FIXTURE_DIR}/baseline.shasum"
echo "Created ${FIXTURE_DIR}/baseline.shasum"

echo "==> Phase 5 fixture setup complete."
