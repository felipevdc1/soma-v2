# Quickstart: SOMA v2.2 Install — Manual Verification

**Feature:** 015-soma-install
**Use case:** validate install command end-to-end after implementation completes (post-Wave 6, pre-merge).

---

## Prerequisites

- Node v22+ installed on host (verify: `node --version`)
- soma-v2 source repo at `/Users/felipevdc1/Documents/- projetos claude code/soma-v2/`
- Working directory clean (`git status --short` returns nothing in soma-v2)
- All Wave 1-6 tasks DONE in tasks.md

---

## Test 1 — Greenfield install (AC-01, AC-16)

```bash
# Setup
mkdir -p /tmp/soma-test-fresh && cd /tmp/soma-test-fresh && git init

# Run install
node "/Users/felipevdc1/Documents/- projetos claude code/soma-v2/core/scripts/soma.cjs" install . --tool=claude

# Verify
echo "exit: $?"   # MUST be 0
ls -la .soma/                      # MUST contain manifest.json + install-state.json + (lock removed)
test -f manifest.json && echo "✅ manifest.json" || echo "❌ FAIL"
test -f .soma/install-state.json && echo "✅ install-state.json" || echo "❌ FAIL"
[ "$(grep -c '<!-- soma-v2:start' CLAUDE.md)" -eq 1 ] && echo "✅ exactly 1 anchored block" || echo "❌ FAIL"

# Inspect state file
cat .soma/install-state.json | jq '.status'   # MUST be "complete"
cat .soma/install-state.json | jq '.harness'  # MUST be "claude"
```

**Expected output:** all 4 PASS lines + state.status="complete".

---

## Test 2 — Idempotent re-run clean (AC-02)

```bash
# Run install AGAIN in same dir
cd /tmp/soma-test-fresh
node ".../core/scripts/soma.cjs" install . --tool=claude

# Verify
echo "exit: $?"   # MUST be 0
[ "$(grep -c '<!-- soma-v2:start' CLAUDE.md)" -eq 1 ] && echo "✅ no duplicate block" || echo "❌ FAIL"

# Dry-run check
node ".../core/scripts/soma.cjs" install . --tool=claude --dry-run | grep -q "no changes" && echo "✅ dry-run says no changes" || echo "❌ FAIL"
```

---

## Test 3 — Drift detection abort (AC-03, AC-14, AC-19) [Layer 6 BF-06]

```bash
cd /tmp/soma-test-fresh

# Simulate user editing inside anchored block
echo "USER EDIT INSIDE BLOCK" >> CLAUDE.md   # crude — moves edit OUTSIDE block; better:
# Use sed to insert text between soma-v2:start and soma-v2:end markers:
sed -i.bak '/soma-v2:start/a\
USER MANUAL EDIT INSIDE ANCHORED BLOCK
' CLAUDE.md

# Run install — MUST abort exit 2
node ".../core/scripts/soma.cjs" install . --tool=claude
echo "exit: $?"   # MUST be 2

# Verify error message has 5 elements (AC-19)
node ".../core/scripts/soma.cjs" install . --tool=claude 2>&1 | grep -q "BF-06 ABORT" && echo "✅ BF-06 ABORT prefix"
node ".../core/scripts/soma.cjs" install . --tool=claude 2>&1 | grep -q "Block ID:" && echo "✅ block ID"
node ".../core/scripts/soma.cjs" install . --tool=claude 2>&1 | grep -q "Expected:" && echo "✅ expected sha"
node ".../core/scripts/soma.cjs" install . --tool=claude 2>&1 | grep -q "Actual:" && echo "✅ actual sha"
node ".../core/scripts/soma.cjs" install . --tool=claude 2>&1 | grep -q "soma rollback" && echo "✅ recovery hint"
```

---

## Test 4 — Path com espaço + hyphen leading (AC-06)

```bash
mkdir -p "/tmp/- soma test fresh hyphen" && cd "/tmp/- soma test fresh hyphen" && git init
node ".../core/scripts/soma.cjs" install . --tool=claude
echo "exit: $?"   # MUST be 0 (argv parser handled space + hyphen correctly)
```

---

## Test 5 — Custom CLAUDE.md merge (AC-07) — hydra-like fixture

```bash
mkdir -p /tmp/soma-test-merge && cd /tmp/soma-test-merge && git init

# Create CLAUDE.md with hydra-like content (free text, no anchors)
cat > CLAUDE.md <<'EOF'
# My Project — Custom Rules

## Stack & Convencoes

Bun + TypeScript. Commits conventional.

## SOMA Discipline

Este repo e SOMA-managed. Constitution authoritative em ~/.claude/constitution.md.
EOF

CLAUDE_BEFORE_SHA=$(shasum -a 256 CLAUDE.md | awk '{print $1}')
echo "CLAUDE.md before sha: $CLAUDE_BEFORE_SHA"

# Run install with --merge-claude-md
node ".../core/scripts/soma.cjs" install . --tool=claude --merge-claude-md
echo "exit: $?"   # MUST be 0

# Verify original lines preserved
grep -q "Stack & Convencoes" CLAUDE.md && echo "✅ original heading preserved"
grep -q "Bun + TypeScript" CLAUDE.md && echo "✅ original content preserved"
[ "$(grep -c '<!-- soma-v2:start' CLAUDE.md)" -eq 1 ] && echo "✅ anchored block injected once"
```

---

## Test 6 — Cross-harness skill activation smoke (AC-10)

**Manual procedure** (requires Claude Code session):

1. Open new Claude Code session in directory `/tmp/soma-test-skill` (empty, no `.soma/`)
2. Type prompt: `"instalar o SOMA neste projeto"`
3. Verify agent response:
   - Contains literal string `soma install` (or invocation path)
   - Does NOT contain instruction "edit CLAUDE.md manually"
   - Bash tool was invoked (visible in tool output)
4. Document transcript snippet to PR description

**Codex equivalent** (when Codex env available — deferred per spec NCL-1 partial):
- Same procedure in Codex CLI session
- Verify backbone CLI literal `node ~/.soma-v2/scripts/soma.cjs install` matches Claude

---

## Test 7 — Slash command guard (AC-12)

```bash
cd /tmp/soma-test-skill   # NO .soma/ here

# Open Claude Code session, invoke /soma-run
# Verify: command body contains warning naming "soma install" remediation
# OR: command aborts with exit message
```

---

## Test 8 — Frozen libs invariant (AC-17)

```bash
cd "/Users/felipevdc1/Documents/- projetos claude code/soma-v2"

shasum -a 256 core/scripts/lib/anchored-blocks.cjs   # MUST start with 6db9bbcb
shasum -a 256 core/scripts/lib/manifest.cjs          # MUST start with 08a0f164
shasum -a 256 core/scripts/lib/template-engine.cjs   # MUST start with f13ae144
```

---

## Test 9 — `.no-execute` deletion (AC-13)

```bash
cd "/Users/felipevdc1/Documents/- projetos claude code/soma-v2"

# Source confirms removed
test ! -f core/.no-execute && echo "✅ source .no-execute deleted"

# Lab confirms removed
test ! -f ~/.soma-v2/.no-execute && echo "✅ lab .no-execute deleted"

# No consumers
[ "$(grep -rn '\.no-execute' core/ ~/.claude/hooks/ 2>/dev/null | wc -l)" -eq 0 ] && echo "✅ zero consumers"
```

---

## Test 10 — Hydra retroactive (AC-07 real-world, POST-MERGE only)

**ONLY run after v2.2 PR merged to soma-v2 main + Felipe explicit go.**

```bash
HYDRA_PATH="/Users/felipevdc1/Documents/- projetos claude code/hydra"
cd "$HYDRA_PATH"

# Snapshot pre-state
cp CLAUDE.md /tmp/hydra-claude-before.md
git status --short  # ensure clean

# Run install with merge flag
node ~/.soma-v2/scripts/soma.cjs install "$HYDRA_PATH" --tool=claude --merge-claude-md

# Verify
echo "exit: $?"  # MUST be 0
diff /tmp/hydra-claude-before.md "$HYDRA_PATH/CLAUDE.md" > /tmp/hydra-claude.diff
[ "$(grep -c '^<' /tmp/hydra-claude.diff)" -eq 0 ] && echo "✅ no original lines removed"
grep -q "soma-v2:start" "$HYDRA_PATH/CLAUDE.md" && echo "✅ anchored block injected"
test -d "$HYDRA_PATH/.soma/" && echo "✅ .soma/ dir created"

# If all PASS → commit hydra changes in separate PR (Wave 7 T-36)
cd "$HYDRA_PATH"
git add .soma/ manifest.json CLAUDE.md
git status --short  # review
# git commit -m "chore: install SOMA v2.2 via soma install --merge-claude-md"
# git push origin main
```

---

## Cleanup

```bash
rm -rf /tmp/soma-test-fresh /tmp/soma-test-merge /tmp/soma-test-skill "/tmp/- soma test fresh hyphen"
rm /tmp/hydra-claude-before.md /tmp/hydra-claude.diff   # if hydra test ran
```

---

## What success looks like

- Tests 1-9: all PASS (run before merge to soma-v2 main)
- Test 10: PASS post-merge in hydra repo (separate PR)
- SONAR audit Step 8 (Wave 7 T-35): zero CRITICAL findings, all 19 ACs traced to passing tests
- Felipe Gate #2 deploy approval → release v2.2.0 + tag
