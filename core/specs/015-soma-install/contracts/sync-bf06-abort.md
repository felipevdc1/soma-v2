# Contract: Internal — sync.cjs BF-06 abort behavior

**Contract ID:** CONTRACT-03
**spec_ref:** [SPEC:AC-14] [SPEC:AC-19] [SPEC:AC-03]
**Created:** 2026-05-09
**Type:** internal contract (sync.cjs path D4 LOCAL_EDITS_DETECTED branch)

---

## Scope

Layer 6 surgical fix to `core/scripts/sync.cjs` line ~482-489 path D4 (LOCAL_EDITS_DETECTED branch). Closes Spec 011 AC-13 (abort behavior) + AC-14 (error message guidance).

---

## Pre-fix Behavior (BUG)

```javascript
// path D4 - LOCAL_EDITS_DETECTED
console.warn(`BF-06: sha mismatch in ${file} block ${blockId}. Overwriting.`);
// ... writes anyway
```

Result: drift silently lost; user edits clobbered without their knowledge. Contradicts code comment ("BF-06: Pre-write conflict scan — abort on sha256 mismatch") AND Spec 011 AC-13.

---

## Post-fix Behavior (Contract)

```javascript
// path D4 - LOCAL_EDITS_DETECTED
if (allowLocalEdits) {
  console.warn(`BF-06: sha mismatch in ${file} block ${blockId}. Overwriting (--allow-local-edits).`);
  // ... writes anyway (escape hatch preserved)
} else {
  process.stderr.write(formatBf06AbortMsg({
    file,
    blockId,
    expectedSha,
    actualSha,
    snapshotId
  }));
  process.exit(2);
}
```

---

## Error Message Format (AC-19 — 5 elements MUST appear)

```
BF-06 ABORT: anchored block sha256 mismatch detected.

  File:        {target_file_absolute_path}
  Block ID:    {block_id}
  Expected:    {sha_from_manifest}
  Actual:      {sha_of_current_block_content}

  Recovery options:
    (1) Rollback to pre-edit state:
        soma rollback --snapshot-id {snapshot_id}

    (2) Re-extract your edits to source doc + re-sync:
        Inspect block content, decide what to keep, re-run soma sync --apply

    (3) Intentional drift override (use when you accept current in-block state):
        soma sync --apply --allow-local-edits
```

5 grep-verifiable elements:
1. Target file path (absolute)
2. Block ID
3. Expected sha256
4. Actual sha256
5. Resolution guidance naming all 3 options

---

## Test Cases (AC-14 + AC-19)

`core/scripts/__tests__/sync-bf06-abort.test.js` MUST cover:

1. **sha match → proceed:** Given block sha matches manifest, when sync --apply runs, then exit 0 + write completes
2. **sha mismatch no flag → abort:** Given block sha mismatch, when sync --apply runs (no flags), then exit 2 + stderr matches all 5 elements via grep
3. **sha mismatch with --allow-local-edits → proceed warning:** Given block sha mismatch + flag set, when sync --apply runs, then exit 0 + stderr contains "Overwriting" warning + write completes

Plus AC-19 specific extension:
4. **error msg structure:** stderr output passes 5 separate grep assertions for the elements above

---

## Function Signature

```javascript
// core/scripts/sync.cjs (or extracted helper)
function formatBf06AbortMsg({file, blockId, expectedSha, actualSha, snapshotId}) {
  return `BF-06 ABORT: ...`;  // see format above
}

// Used in path D4:
if (currentBlockSha !== manifestEntry.sha256 && !allowLocalEdits) {
  process.stderr.write(formatBf06AbortMsg({...}));
  process.exit(2);
}
```

---

## Invariants

- BF-06 abort MUST produce exit 2 (NOT 1, NOT 0)
- error message MUST contain ALL 5 elements (file, blockId, expectedSha, actualSha, 3-option recovery)
- `--allow-local-edits` flag MUST preserve existing escape hatch behavior (no breaking change)
- sync.cjs comment MUST match behavior post-fix (update if diverges)
- frozen libs (`anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) MUST remain byte-identical
