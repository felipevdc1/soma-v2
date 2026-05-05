# Quickstart: Phase 5 Codex+Claude Bootloader Operational Install

**Feature ID:** 011-phase5-codex-claude-install
**Created:** 2026-05-02
**Audience:** The user (manual validation post-implementation)

---

## Prerequisites

- SOMA Phase 0-4 + [project B] Bucket D shipped (verify via `cd ~/.soma-v2 && node --test scripts/__tests__/*.test.cjs 2>&1 | tail -3` shows 671/673 baseline)
- `~/.soma-v2/scripts/sync.cjs` (Phase 4b) operational
- `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md` BACKED UP locally (`cp ~/.claude/CLAUDE.md ~/CLAUDE.md.pre-phase5-backup`)

---

## Sequence to validate each AC group

### Step 0 — Baseline capture (do this FIRST, before any apply)

```bash
# Capture pre-Phase 5 baseline
cd ~/.soma-v2
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/CLAUDE.md > /tmp/phase5-pre-baseline-shasum.txt
cat /tmp/phase5-pre-baseline-shasum.txt

# Verify SOMA test baseline still green
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -3
# Expected: 671 pass + 0 fail + 2 skipped

# Verify Claude install-targets populated (post-T-01)
cat ~/.soma-v2/adapters/claude/install-targets.json
# Expected: 3 entries with block.claude.CLAUDE_md.{cbm,hyd-v2,soma-stsd}
```

**Observe:** Backup files exist. Baseline shasum captured. Tests green.

---

### Step 1 — Validate dry-run default (AC-01)

```bash
# Run sync WITHOUT --apply (default dry-run)
soma sync --tool=claude

# Verify NO writes happened
shasum -a 256 ~/.claude/CLAUDE.md
# Expected: same sha256 as in /tmp/phase5-pre-baseline-shasum.txt
```

**Observe:** Output shows preview of 3 anchored blocks that WOULD be inserted. CLAUDE.md sha256 unchanged.

---

### Step 2 — Validate sandbox enforcement (AC-17)

```bash
# Force sandbox mode + try writing to real path → should reject
SOMA_SAFE_PATHS_ONLY=1 soma sync --apply --tool=claude

# Expected output: error "SANDBOX_VIOLATION" + zero writes
shasum -a 256 ~/.claude/CLAUDE.md
# Expected: still unchanged
```

**Observe:** Sandbox error emitted. Real CLAUDE.md untouched.

---

### Step 3 — Validate synthetic validation cycle (AC-15, AC-16)

```bash
# Run synthetic validation test in /tmp
cd ~/.soma-v2
SOMA_SAFE_PATHS_ONLY=1 node --test tests/phase5/synthetic-validation.test.cjs 2>&1 | tail -10

# Expected: All synthetic tests pass.
# Test output should include sha256 round-trip log entries (Article IV evidence).
```

**Observe:** Round-trip identity assertion passes. SHA256 of restored fixture == SHA256 pre-sync fixture. Article IV evidence visible in test output.

---

### Step 4 — Validate Codex apply canary (lower risk first) (AC-02, AC-04, AC-05, AC-06)

```bash
# Apply against real ~/.codex/AGENTS.md (and ~/AGENTS.md)
soma sync --apply --tool=codex

# Verify snapshot was created
ls -la ~/.soma-v2/.snapshots/ | tail -1
# Expected: New ISO-timestamped directory

SNAPSHOT_ID=$(ls -1t ~/.soma-v2/.snapshots/ | head -1)
echo "Snapshot ID: $SNAPSHOT_ID"

# Verify manifest exists with correct schema
cat ~/.soma-v2/.snapshots/$SNAPSHOT_ID/manifest.json | head -30

# Verify file perms (should be 0600 on snapshot files)
ls -la ~/.soma-v2/.snapshots/$SNAPSHOT_ID/codex/

# Verify anchored blocks injected in real files
grep -c "soma-v2:start" ~/.codex/AGENTS.md
# Expected: 3 (or 5 if both target paths injected)
```

**Observe:** Snapshot created with manifest. 0600 perms on snapshot files. New soma-v2 anchors visible in AGENTS.md. OLD markers preserved (coexist mode default).

---

### Step 5 — Validate doctor migration warning (AC-10, AC-11)

```bash
# Doctor should report migration_needed=true (because OLD markers in AGENTS.md still present from pre-Phase 5)
soma doctor --check-migration

# Expected output: 
# - migration_needed: true
# - old_markers_detected: 3+
# - WARNING level (not ERROR)
# - exit_code: 0
```

**Observe:** Doctor surfaces migration need with WARNING level. Exit 0 (non-fatal). OLD markers and new soma-v2 anchors COEXIST in AGENTS.md.

---

### Step 6 — (Optional) Validate migration replace (AC-12)

```bash
# Convert OLD markers to soma-v2 v2 anchors em-place
soma sync --apply --tool=codex --migrate

# Verify OLD markers replaced
grep -c "<!-- codebase-memory-mcp:start" ~/.codex/AGENTS.md
# Expected: 0

grep -c "soma-v2:start id=block.codex.AGENTS.codebase-memory-mcp" ~/.codex/AGENTS.md
# Expected: 1+ (depending on target_path)

# Verify rollback path preserved (NEW snapshot created with OLD content backed up)
ls -1t ~/.soma-v2/.snapshots/ | head -1
```

**Observe:** OLD markers gone, new soma-v2 anchors present. New snapshot preserves OLD content.

---

### Step 7 — Validate Claude apply (CRITICAL — real CLAUDE.md write) (AC-03)

**STOP before this step. Verify Step 3 synthetic validation passed AND the user ACKs proceeding.**

```bash
# Final sanity check: dry-run Claude one more time
soma sync --tool=claude

# If output looks correct, proceed with apply
soma sync --apply --tool=claude

# Verify NEW section appended in CLAUDE.md
grep -A 2 "## SOMA Bootloader" ~/.claude/CLAUDE.md
# Expected: section header + 3 anchored blocks

# Verify positioned BEFORE ## Failure Log
grep -n "## SOMA Bootloader\|## Failure Log" ~/.claude/CLAUDE.md
# Expected: SOMA Bootloader line < Failure Log line

# Verify content preservation outside anchored blocks (AC-19)
# Compute sha256 of CLAUDE.md MINUS soma-v2 anchored regions
# (manual check or via test helper)
```

**Observe:** New section visible in CLAUDE.md, positioned correctly. Failure Modes / MemPalace / Voxel theme content unchanged.

---

### Step 8 — Validate conflict detection (AC-13, AC-14)

```bash
# Manually edit content INSIDE a soma-v2 block in CLAUDE.md (e.g., add a typo)
# Then re-apply

soma sync --apply --tool=claude

# Expected: error "BLOCK_CONFLICT" + zero writes
# Output should include: file path + block_id + expected/actual sha256 + resolution_guidance
```

**Observe:** Sync aborts. CLAUDE.md unchanged. Error message tells the user how to resolve (rollback or re-extract).

---

### Step 9 — Validate rollback (AC-07, AC-08, AC-09)

```bash
# List snapshots
ls -1t ~/.soma-v2/.snapshots/

# Pick a recent snapshot ID (e.g., from Step 4 Codex apply)
SNAPSHOT_ID="<paste ISO timestamp here>"

# Rollback
soma rollback --snapshot-id $SNAPSHOT_ID

# Verify file restored to pre-snapshot state
shasum -a 256 ~/.codex/AGENTS.md
# Compare against /tmp/phase5-pre-baseline-shasum.txt

# Test idempotent rollback (run again, should report no-op)
soma rollback --snapshot-id $SNAPSHOT_ID
# Expected: status: "no-op"

# Test error path: invalid snapshot ID
soma rollback --snapshot-id "non-existent-id"
# Expected: error "SNAPSHOT_NOT_FOUND"
```

**Observe:** Restore round-trip identity verified. Idempotent. Errors handled cleanly.

---

### Step 10 — Validate idempotency (AC-18)

```bash
# Re-apply with no source changes
soma sync --apply --tool=claude

# Expected: dry-run preview reports "no diff" + writes_executed: 0 (or no-op marker)
```

**Observe:** Sync detects no changes, performs no writes.

---

### Step 11 — Validate bootstrap install_targets_count (AC-20)

```bash
soma bootstrap

# Expected output: install_targets_count = 8 (Codex 5 + Claude 3)
# Per-tool breakdown shown
```

**Observe:** Bootstrap reports 8 total install targets. Adapter discovery works.

---

## Cleanup / revert (if needed)

```bash
# Restore CLAUDE.md from manual backup
cp ~/CLAUDE.md.pre-phase5-backup ~/.claude/CLAUDE.md

# OR rollback via snapshot
soma rollback --snapshot-id <first-claude-apply-snapshot>

# Remove all Phase 5 snapshots (if you want clean state)
# WARNING: only after confirming no rollback needed
rm -rf ~/.soma-v2/.snapshots/2026-05-02T*

# Verify CLAUDE.md restored to baseline
shasum -a 256 ~/.claude/CLAUDE.md
# Compare against /tmp/phase5-pre-baseline-shasum.txt
```

---

## Success criteria checklist

After running all 11 steps:

- [ ] Step 0: baseline captured, tests 671/673 green
- [ ] Step 1: dry-run default, no writes (AC-01)
- [ ] Step 2: sandbox enforcement rejects (AC-17)
- [ ] Step 3: synthetic /tmp validation cycle passes with sha256 round-trip (AC-15, AC-16)
- [ ] Step 4: Codex apply creates snapshot + manifest + 0600 perms + anchors in AGENTS.md (AC-02, AC-04, AC-05, AC-06)
- [ ] Step 5: doctor surfaces migration warning, exit 0 (AC-10, AC-11)
- [ ] Step 6 (optional): --migrate replaces OLD markers em-place (AC-12)
- [ ] Step 7: Claude apply injects ## SOMA Bootloader BEFORE ## Failure Log (AC-03)
- [ ] Step 8: conflict detection aborts on user manual edit (AC-13, AC-14)
- [ ] Step 9: rollback round-trip identity + idempotent + error paths (AC-07, AC-08, AC-09)
- [ ] Step 10: idempotent re-apply no-op (AC-18)
- [ ] Step 11: bootstrap install_targets_count=8 (AC-20)
- [ ] Final: SOMA cumulative tests pass (671 + Phase 5 ≥40 = ≥710 total)

---

## Troubleshooting

**Q: `sync --apply` fails with `SNAPSHOT_FAILED` — disk full?**
A: Check `df -h ~/.soma-v2/`. Snapshots can grow if not pruned. Delete old snapshots manually if confirmed safe.

**Q: `rollback` reports `ROLLBACK_VERIFICATION_FAILED` — what now?**
A: Snapshot file may be corrupt. Check `shasum -a 256 ~/.soma-v2/.snapshots/{id}/{path}` vs manifest entry. If snapshot corrupt, fall back to manual backup (`~/CLAUDE.md.pre-phase5-backup`).

**Q: `doctor` shows migration_needed=true but I don't want to migrate — is that bad?**
A: No. Coexist mode is functional. OLD markers and new soma-v2 anchors live side-by-side. Migrate only if you want a clean single-format file.

**Q: Where do logs live?**
A: `~/.soma-v2/logs/sync-{YYYY-MM-DD}.jsonl` and `~/.soma-v2/logs/rollback-{YYYY-MM-DD}.jsonl`. JSONL format, parseable line-by-line.

**Q: How do I prune old snapshots?**
A: Out of scope for Phase 5. Manual: `rm -rf ~/.soma-v2/.snapshots/{old-ISO}`. Phase 6+ will add `soma snapshot prune --older-than {N}d` command.
