# Quickstart: v2.1.4 — `soma manifest baseline`

Manual validation steps to exercise the new `soma manifest baseline` subcommand after implementation lands. Run from the repo root: `/Users/felipevdc1/Documents/- projetos claude code/soma-v2/`.

---

## 1. Environment Setup

```bash
# Confirm repo HEAD is on feature/014-manifest-baseline branch
git checkout feature/014-manifest-baseline
git log --oneline -1

# Run automated test suite first (sanity check)
node --test core/scripts/__tests__/manifest.test.cjs
node --test core/scripts/__tests__/manifest-baseline-doctor.test.cjs
node --test core/scripts/__tests__/source-sha-immutable.test.cjs
node --test core/scripts/__tests__/frozen-libs-invariant-014.test.cjs

# Verify frozen libs untouched
shasum -a 256 core/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs
# Expected baselines (from f3c2f0b):
#   anchored-blocks.cjs: 6db9bbcb...
#   manifest.cjs:        08a0f164...
#   template-engine.cjs: f13ae144...

# Sync lab + take pre-baseline snapshot for safety
rsync -a core/ ~/.soma-v2/
cp ~/.soma-v2/manifest.json /tmp/manifest-pre-baseline-$(date +%s).json
```

---

## 2. Exercise Each AC

### AC-01 (dry-run lists stale entries, no mutation)

```bash
# Snapshot manifest sha BEFORE
PRE_SHA=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')

# Run dry-run
node ~/.soma-v2/scripts/manifest.cjs baseline --dry-run
# Expected output: lists 3 stale entries (core.soma-stsd, adapter.codex.AGENTS, adapter.global.AGENTS)
# Exit code 0

# Verify no mutation
POST_SHA=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')
[[ "$PRE_SHA" == "$POST_SHA" ]] && echo "AC-01 PASS: manifest unchanged" || echo "AC-01 FAIL"
```

### AC-02 + AC-09 (apply writes manifest atomically + creates snapshot)

```bash
# Apply mode
node ~/.soma-v2/scripts/manifest.cjs baseline --apply
# Expected output:
#   - "Snapshot created at /Users/.../~/.soma-v2/.snapshots/{ts}.tar.gz"
#   - "Wrote ~/.soma-v2/manifest.json with 3 entries re-baselined"
# Exit code 0

# Verify manifest mutated
NEW_SHA=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')
[[ "$NEW_SHA" != "$POST_SHA" ]] && echo "AC-02 PASS: manifest updated"

# Verify snapshot exists
ls ~/.soma-v2/.snapshots/ | tail -1
```

### AC-03 (post-apply doctor exits 0, 0 drift findings)

```bash
node ~/.soma-v2/scripts/doctor.cjs
echo "Exit: $?"
# Expected: exit 0, output reports 0 source_staleness drift findings (only the previously-existing pre-existing non-014 findings, if any, remain)
```

### AC-04 + AC-05 (filter exact-match by id / by path)

```bash
# Reset to stale state (restore from snapshot or re-stash a stale manifest fixture)
cp /tmp/manifest-pre-baseline-*.json ~/.soma-v2/manifest.json

# Filter by id
node ~/.soma-v2/scripts/manifest.cjs baseline --apply --filter core.soma-stsd
# Expected: only "core.soma-stsd" entry re-baselined; other 2 stale entries remain stale

node ~/.soma-v2/scripts/doctor.cjs | grep "drift" | wc -l
# Expected: 2 (codex.AGENTS + global.AGENTS still stale)

# Reset and filter by path
cp /tmp/manifest-pre-baseline-*.json ~/.soma-v2/manifest.json
node ~/.soma-v2/scripts/manifest.cjs baseline --apply --filter "adapters/codex/AGENTS.md"
# Expected: only that entry re-baselined; 2 others (soma-stsd + global.AGENTS) remain stale
```

### AC-06 + AC-10 (JSON output + --help)

```bash
# JSON output schema
node ~/.soma-v2/scripts/manifest.cjs baseline --dry-run --json | jq .schema
# Expected: "soma-manifest-baseline/v1"

node ~/.soma-v2/scripts/manifest.cjs baseline --dry-run --json | jq '.entries_rebaseled | length'
# Expected: 3 (or whatever stale count is)

# Help
node ~/.soma-v2/scripts/manifest.cjs baseline --help
# Expected: usage docs all flags, exit 0
echo "Exit: $?"
```

### AC-13 (idempotency)

```bash
# First apply
node ~/.soma-v2/scripts/manifest.cjs baseline --apply
SHA1=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')

# Second apply immediately
node ~/.soma-v2/scripts/manifest.cjs baseline --apply
SHA2=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')

# Output of 2nd run should report "0 entries to re-baseline"
[[ "$SHA1" == "$SHA2" ]] && echo "AC-13 PASS: idempotent (manifest byte-identical)"
```

### AC-15 (default mode is dry-run + hint)

```bash
# Reset stale state first
cp /tmp/manifest-pre-baseline-*.json ~/.soma-v2/manifest.json

# Run with NO mode flag
node ~/.soma-v2/scripts/manifest.cjs baseline
# Expected: dry-run output + hint "pass --apply to write the updated manifest"
# Manifest unchanged
PRE=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')
node ~/.soma-v2/scripts/manifest.cjs baseline > /dev/null
POST=$(shasum -a 256 ~/.soma-v2/manifest.json | awk '{print $1}')
[[ "$PRE" == "$POST" ]] && echo "AC-15 PASS: default-mode is dry-run"
```

### AC-16 (lab file ENOENT skip + warn + exit 0)

```bash
# Setup: temporarily move a lab file referenced by manifest
mv ~/.soma-v2/docs/soma-stsd.md /tmp/soma-stsd.md.backup

# Run baseline
node ~/.soma-v2/scripts/manifest.cjs baseline --dry-run
echo "Exit: $?"
# Expected: warning "lab file missing: docs/soma-stsd.md (skipped)"
# Other stale entries (codex.AGENTS, global.AGENTS) still listed
# Exit code 0

# Restore
mv /tmp/soma-stsd.md.backup ~/.soma-v2/docs/soma-stsd.md
```

### AC-11 + AC-12 (manifest missing / invalid)

```bash
# Test MANIFEST_MISSING
mv ~/.soma-v2/manifest.json /tmp/manifest.json.bk
node ~/.soma-v2/scripts/manifest.cjs baseline
echo "Exit: $?"
# Expected: error "MANIFEST_MISSING", exit 2
mv /tmp/manifest.json.bk ~/.soma-v2/manifest.json

# Test MANIFEST_INVALID
echo '{"schema":"WRONG"}' > /tmp/bad-manifest.json
SOMA_HOME=/tmp node ~/.soma-v2/scripts/manifest.cjs baseline 2>&1
echo "Exit: $?"
# Expected: error "MANIFEST_INVALID", exit 2 (only valid if SOMA_HOME=/tmp/somehow has manifest.json — adjust test setup)
```

### AC-07 + AC-08 (frozen libs + sourceSha256 invariants)

```bash
# Frozen libs untouched (after running all baseline ops)
shasum -a 256 core/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs
# Compare to baselines — must match f3c2f0b values

# sourceSha256 unchanged after apply
node ~/.soma-v2/scripts/manifest.cjs baseline --apply
jq '.files[] | select(.id == "core.soma-stsd") | .sourceSha256' ~/.soma-v2/manifest.json
# Expected: "3e6a1a8f6c4f0c8dadef714990e292c13b28ae7db16a23701759e8d4e01b384c" (unchanged)
```

### AC-17 (filter literal-string, no glob)

```bash
node ~/.soma-v2/scripts/manifest.cjs baseline --dry-run --filter "adapters/*" --json | jq '.entries_rebaseled | length'
# Expected: 0 (no entry has id or path literally equal to "adapters/*")
echo "Exit: $?"
# Expected: 0
```

---

## 3. Cleanup / Revert

```bash
# Restore pre-baseline manifest if needed
cp /tmp/manifest-pre-baseline-*.json ~/.soma-v2/manifest.json

# OR restore via soma rollback (uses snapshot from createSnapshot)
ls ~/.soma-v2/.snapshots/
node ~/.soma-v2/scripts/rollback.cjs <snapshot-id>

# Re-confirm doctor state
node ~/.soma-v2/scripts/doctor.cjs

# Clean up temp files
rm /tmp/manifest-pre-baseline-*.json
rm /tmp/soma-stsd.md.backup 2>/dev/null
rm /tmp/manifest.json.bk 2>/dev/null
rm /tmp/bad-manifest.json 2>/dev/null
```

---

## 4. Smoke Test (T-13)

```bash
# Full e2e on real ~/.soma-v2/
PRE_DRIFT=$(node ~/.soma-v2/scripts/doctor.cjs --json 2>&1 | jq '.summary.drift_count // 0')
node ~/.soma-v2/scripts/manifest.cjs baseline --apply
POST_DRIFT=$(node ~/.soma-v2/scripts/doctor.cjs --json 2>&1 | jq '.summary.drift_count // 0')

[[ "$PRE_DRIFT" -ge 3 ]] && [[ "$POST_DRIFT" -eq 0 ]] && echo "SMOKE PASS: drift went $PRE_DRIFT → 0"
```

---

## What to Observe

| Pass signal | Fail signal |
|---|---|
| Dry-run lists 3 stale entries, manifest sha unchanged | Dry-run mutates manifest |
| Apply writes manifest + creates snapshot path | Apply skips snapshot OR partial write |
| Post-apply doctor exit 0, 0 source_staleness | Doctor still reports drift |
| `--filter` exact-match restricts to 1 entry | `--filter` matches multiple via implicit glob |
| `--json` schema = `soma-manifest-baseline/v1` | Schema name mismatch |
| Frozen libs sha256 unchanged | ANY frozen lib byte differs |
| `sourceSha256` field unchanged post-apply | `sourceSha256` mutated (D-014 violation) |
| 2nd apply = no-op + byte-identical manifest | 2nd apply reports stale entries |
