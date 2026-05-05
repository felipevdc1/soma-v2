# Quickstart: Soma Sync Apply Write-Mode (Phase 4b)

Manual validation steps for each AC after implementation. Run through these to confirm Phase 4b candidate-done.

---

## Prerequisites

```bash
# Confirm baseline pre-Phase-4b
cd ~/.soma-v2
node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5  # must show 315/315 + new Phase 4b tests
node --test ~/.claude/hooks/*.test.cjs 2>&1 | tail -5  # 47/47 (hooks/*.test.cjs subset)

# Capture shasum of canonical+libs
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/sync-apply-quickstart-before.txt
```

---

## Setup synthetic SOMA_HOME

For ALL tests below, work in a synthetic `/tmp` SOMA_HOME so real `~/.codex/AGENTS.md` is never at risk:

```bash
SOMA_HOME=/tmp/sync-apply-qs-$(date +%s)
mkdir -p "$SOMA_HOME"
node ~/.soma-v2/scripts/init.cjs --soma-home "$SOMA_HOME"  # bootstrap fresh project
# Manually drift: edit a target file to add divergent block content
```

---

## AC-01: dry-run preserved (no --apply)

```bash
node ~/.soma-v2/scripts/sync.cjs --soma-home "$SOMA_HOME" --json
```

**Expected:**
- `out.mode === 'dry-run'`
- `out.snapshot === null`
- `ls "$SOMA_HOME/.snapshots"` returns "No such file or directory"
- exit code 0 (or 1 if drift)

---

## AC-02 + AC-03: snapshot + manifest pre-write

```bash
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" --json
```

**Expected:**
- `out.snapshot.timestamp` matches ISO 8601 UTC seconds
- `out.snapshot.path` exists and contains `{adapter}/{path}` copies
- `out.snapshot.manifest_path` exists; `cat` it:
  - `schema: "soma-snapshot/v1"`
  - `files[]` ordered alphabetically by `{adapter}/{path}`
  - each file has `{adapter, path, sha256: <hex64 lowercase>}`
  - `total_bytes` matches sum of file sizes

---

## AC-04: summary preview before write

```bash
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" 2>&1 | head -20
```

**Expected:**
- stdout starts with `## Sync preview` BEFORE any "Writing..." log lines
- Lists each `{adapter}/{path}: {action}` (insert/replace/skip)

---

## AC-05: noop on already-synced

```bash
# Run --apply twice in succession; second should be noop
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" --json
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" --json | jq '.summary.by_action'
```

**Expected (second run):**
- `out.snapshot === null`
- `out.summary.files_touched` is empty array
- `by_action: { insert: 0, replace: 0, skip: N }`
- exit 0
- stdout contains "already in sync"

---

## AC-06: SNAPSHOT_CREATE_FAILED

```bash
chmod 0000 "$SOMA_HOME/.snapshots" 2>/dev/null || mkdir -p "$SOMA_HOME/.snapshots-readonly" && chmod 0000 "$SOMA_HOME/.snapshots-readonly"
# Force snapshot dir to fail creation (perms or readonly mount simulation)
SOMA_SNAPSHOTS_DIR="$SOMA_HOME/.snapshots-readonly" node ~/.soma-v2/scripts/sync.cjs --apply --json
```

**Expected:**
- exit 1
- `out.error.code === 'SNAPSHOT_CREATE_FAILED'`
- `~/.codex/AGENTS.md` shasum unchanged (D2 atomicity)

---

## AC-07: SOURCE_STALE

```bash
# Two-step: capture preview hash, mutate source, then attempt apply
# This requires runtime hook to inject mutation; manual quickstart simulation:
node ~/.soma-v2/scripts/sync.cjs --soma-home "$SOMA_HOME" --json > /tmp/preview.json
echo "rogue edit" >> "$SOMA_HOME/codex-target/AGENTS.md"
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" --json
```

**Expected:**
- exit 1
- `out.error.code === 'SOURCE_STALE'`
- snapshot dir NOT created
- source unchanged from rogue edit (Sonnet must implement two-phase shasum)

---

## AC-08: ANCHOR_PARSE_ERROR

```bash
# Corrupt the anchored block in target file
sed -i '' 's/<!-- soma-v2:start/<!-- BROKEN-MARKER/' "$SOMA_HOME/codex-target/AGENTS.md"
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" --json
```

**Expected:**
- exit 1
- `out.error.code === 'ANCHOR_PARSE_ERROR'`
- snapshot dir NOT created
- target file untouched (D2 all-or-nothing)

---

## AC-09: byte-stable manifest

```bash
# Run --apply with same input twice (re-create state between runs)
# Compare two manifest.json files byte-for-byte
diff /tmp/manifest-run1.json /tmp/manifest-run2.json
```

**Expected:** zero diff (same keys, same order, same hex64 values).

---

## AC-10: idempotência

```bash
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME"
node ~/.soma-v2/scripts/sync.cjs --soma-home "$SOMA_HOME" --json | jq '.findings_count'
```

**Expected:** `findings_count: 0` after first apply (re-run dry-run sees zero drift).

---

## AC-11: trap scenarios

Each trap fixture must exit 1 without source corruption. Run automated test:

```bash
node --test ~/.soma-v2/scripts/__tests__/ac-11-trap-scenarios.test.cjs
```

**Expected:** all 4 trap subtests pass; in each, source file SHA pre/post is identical.

---

## AC-12: --apply + --dry-run conflict

```bash
node ~/.soma-v2/scripts/sync.cjs --apply --dry-run; echo "exit=$?"
```

**Expected:** exit 2, stderr message `"--apply and --dry-run are mutually exclusive"`.

---

## D4: Local edits warn-loud

```bash
echo "// my own comment line" >> "$SOMA_HOME/codex-target/AGENTS.md"
node ~/.soma-v2/scripts/sync.cjs --apply --soma-home "$SOMA_HOME" --json | jq '.summary.warnings'
```

**Expected:**
- `warnings[0].code === 'LOCAL_EDITS_DETECTED'`
- snapshot dir created with full pre-state preserved
- exit 0 (sync continues, didn't abort)
- stdout contains "Local edits detected" warn line

Recovery test: copy snapshot back to source, verify byte-identical to pre-edit:
```bash
diff <(cat $SNAPSHOT_PATH/codex/AGENTS.md) <(cat "$SOMA_HOME/codex-target/AGENTS.md")
```

---

## Cleanup

```bash
rm -rf "$SOMA_HOME"
shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md \
  ~/.soma-v2/scripts/lib/anchored-blocks.cjs ~/.soma-v2/scripts/lib/manifest.cjs \
  ~/.soma-v2/scripts/lib/template-engine.cjs > /tmp/sync-apply-quickstart-after.txt
diff /tmp/sync-apply-quickstart-before.txt /tmp/sync-apply-quickstart-after.txt
# Expected: empty diff (real canonical+libs untouched throughout quickstart)
```

---

## Phase 4b candidate-done checklist

- [ ] All 12 ACs validated above
- [ ] D4 local edits warn-loud working
- [ ] 315/315 SOMA tests pass (post-4b cumulative count = 315 + N where N is Phase 4b additions)
- [ ] 48/48 hooks regression preserved
- [ ] 6 canonical+lib shasums diff empty
- [ ] Quickstart cleanup leaves zero residue in `~/.soma-v2/.snapshots/`
- [ ] Sonnet RED+GREEN commits visible in `/tmp/phase4b-work/` git log (Article II HARD via C-2 enforcement)
