# Contract: Tool Call — soma rollback

**Contract ID:** CONTRACT-011-02-rollback
**spec_ref:** [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09] [SPEC:AC-15]
**Created:** 2026-05-02
**Type:** internal CLI command (NEW per Q5 lock)

---

## Tool Name

```
soma rollback --snapshot-id <ISO-timestamp>
```

---

## Description

Restore files from a SOMA auto-snapshot to their pre-write state, with sha256 verification per manifest entry. Restores idempotently (running twice on same snapshot-id is no-op if files already match).

---

## Arguments

```json
{
  "snapshot-id": {
    "type": "string",
    "required": true,
    "description": "ISO timestamp of the snapshot directory under ~/.soma-v2/.snapshots/. Format: YYYY-MM-DDTHH-MM-SSZ.",
    "example": "2026-05-02T19-30-15Z"
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--snapshot-id` | string | yes | Must match directory name in `~/.soma-v2/.snapshots/`. Format ISO 8601 UTC with `-` instead of `:`. |

**Sandbox precondition:** If env `SOMA_SAFE_PATHS_ONLY=1`, restore targets MUST be inside `/tmp/soma-v2-test/` prefix. Else reject with SANDBOX_VIOLATION.

---

## Output

**Success (AC-07, AC-08):**
```json
{
  "status": "restored",
  "snapshot_id": "2026-05-02T19-30-15Z",
  "files_restored": [
    {
      "path": "~/.claude/CLAUDE.md",
      "expected_sha256": "abc123...",
      "actual_sha256_post_restore": "abc123...",
      "match": true
    }
  ],
  "duration_ms": 412
}
```

**Error (snapshot not found, AC-09):**
```json
{
  "error": "SNAPSHOT_NOT_FOUND",
  "message": "No snapshot directory found at ~/.soma-v2/.snapshots/2026-05-02T19-30-15Z",
  "details": {
    "snapshot_id_searched": "2026-05-02T19-30-15Z",
    "available_snapshots": ["2026-05-01T14-22-08Z", "2026-05-02T17-15-44Z"]
  }
}
```

**Error (manifest sha256 mismatch post-restore, AC-09):**
```json
{
  "error": "ROLLBACK_VERIFICATION_FAILED",
  "message": "Restored file sha256 does not match snapshot manifest entry. Possible disk corruption or partial restore.",
  "details": {
    "file": "~/.claude/CLAUDE.md",
    "expected_sha256": "abc123...",
    "actual_sha256_post_restore": "xyz789...",
    "recovery_guidance": "1. Verify snapshot files at ~/.soma-v2/.snapshots/{ISO}/ are intact (sha256 each), 2. If snapshot corrupt, recover from earlier snapshot, 3. If snapshot OK, manually restore by `cp` from snapshot path."
  }
}
```

**Error codes:**
| Code | When |
|---|---|
| `INVALID_ARGS` | `--snapshot-id` missing or not ISO format |
| `SNAPSHOT_NOT_FOUND` | Directory `~/.soma-v2/.snapshots/{id}` does not exist |
| `MANIFEST_MISSING` | Snapshot dir exists but `manifest.json` missing or unparseable |
| `MANIFEST_SCHEMA_INVALID` | manifest.json schema does not match `soma-snapshot-manifest/v1` |
| `ROLLBACK_VERIFICATION_FAILED` | Post-restore sha256 mismatch vs manifest expected_sha256 |
| `SANDBOX_VIOLATION` | `SOMA_SAFE_PATHS_ONLY=1` + restore target outside `/tmp/soma-v2-test/` |
| `RESTORE_PERMISSION_DENIED` | Cannot write to target file path (perms or readonly mount) |

---

## Side Effects

- Writes (overwrites) target files listed in snapshot manifest, restoring to `sha256_pre_write` state.
- Appends log entry at `~/.soma-v2/logs/rollback-{YYYY-MM-DD}.jsonl` with `{schema, snapshot_id, files_restored, duration_ms, exit_code}`.
- Snapshot directory itself is NOT deleted (allows re-rollback if needed).

---

## Idempotency

- **Idempotent:** yes
- **If called twice with same snapshot-id:** Second call computes file sha256, compares to manifest expected. If already match (already-restored state), reports `status: "no-op"` without re-writing. If mismatch (something changed since last restore), restores again.

---

## Manifest Schema (referenced)

The rollback command reads `~/.soma-v2/.snapshots/{snapshot-id}/manifest.json`:

```json
{
  "schema": "soma-snapshot-manifest/v1",
  "snapshot_id": "2026-05-02T19-30-15Z",
  "created_by": "soma sync --apply --tool=claude",
  "created_at": "2026-05-02T19:30:15.123Z",
  "tool": "claude",
  "entries": [
    {
      "relative_path": "claude/CLAUDE.md",
      "absolute_path": "~/.claude/CLAUDE.md",
      "sha256_pre_write": "abc123...",
      "file_size_bytes": 24831,
      "block_ids_modified": [
        "block.claude.CLAUDE_md.cbm",
        "block.claude.CLAUDE_md.hyd-v2",
        "block.claude.CLAUDE_md.soma-stsd"
      ]
    }
  ]
}
```

---

## Constitutional Compliance

- **Article II HARD** — Implementation MUST follow TDD RED→GREEN. Rollback test cases written first, fail, then impl.
- **Article III HARD** — Tests use real fs at `/tmp/phase5-validation/`. Synthetic snapshot dirs created by test setUp; real ~/.soma-v2/.snapshots/ NEVER touched in test runs.
- **Article IV HARD** — Test output logs: snapshot_id + files_restored + post-restore sha256 list.
- **Article VI HARD** — Rollback is restorative, not destructive. Snapshot files preserved post-rollback.

---

## Contract Test Stub

```javascript
// @spec AC-07 AC-08 AC-09
// @contract CONTRACT-011-02-rollback
const { test } = require("node:test");
const assert = require("node:assert");

test("rollback restores file to pre-write state (AC-07, AC-08)", async () => {
  // Setup: synthetic snapshot at /tmp/soma-v2-test/snapshots/test-id-001/
  // Modify the target file to known different state
  const result = runRollback(["--snapshot-id", "test-id-001"]);
  assert.equal(result.status, "restored");
  // Post-restore sha256 == manifest expected_sha256
  assert.equal(result.files_restored[0].match, true);
});

test("SNAPSHOT_NOT_FOUND when snapshot-id does not exist (AC-09)", async () => {
  const result = runRollback(["--snapshot-id", "non-existent-id"]);
  assert.equal(result.error, "SNAPSHOT_NOT_FOUND");
});

test("ROLLBACK_VERIFICATION_FAILED when manifest sha256 mismatch post-restore (AC-09)", async () => {
  // Setup: snapshot with manifest sha256 but corrupted snapshot file content
  const result = runRollback(["--snapshot-id", "corrupted-snapshot"]);
  assert.equal(result.error, "ROLLBACK_VERIFICATION_FAILED");
});

test("idempotent rollback (AC-07)", async () => {
  runRollback(["--snapshot-id", "test-id-001"]);
  const result2 = runRollback(["--snapshot-id", "test-id-001"]);
  assert.equal(result2.status, "no-op");
});

test("SANDBOX_VIOLATION when restore target outside /tmp/soma-v2-test/", async () => {
  process.env.SOMA_SAFE_PATHS_ONLY = "1";
  // snapshot manifest points to ~/.claude/CLAUDE.md
  const result = runRollback(["--snapshot-id", "real-claude-snapshot"]);
  assert.equal(result.error, "SANDBOX_VIOLATION");
});
```
