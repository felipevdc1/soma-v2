# Contract: Tool Call — soma sync --apply

**Contract ID:** CONTRACT-011-01-sync-apply
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-13] [SPEC:AC-18] [SPEC:AC-19]
**Created:** 2026-05-02
**Type:** internal CLI command (extension of existing Phase 4b sync)

---

## Tool Name

```
soma sync [--apply] --tool=<codex|claude> [--migrate]
```

---

## Description

Inject anchored blocks from `~/.soma-v2/adapters/{tool}/install-targets.json` into target bootloader files (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/CLAUDE.md`). Without `--apply`, dry-run preview only (no writes). With `--apply`, atomic write with auto-snapshot pré-write per AC-04.

---

## Arguments

```json
{
  "apply": {
    "type": "boolean",
    "required": false,
    "default": false,
    "description": "If true, execute writes. If false (default), dry-run preview only.",
    "example": true
  },
  "tool": {
    "type": "string",
    "required": true,
    "enum": ["codex", "claude"],
    "description": "Adapter to sync. Determines source install-targets.json + valid target paths.",
    "example": "claude"
  },
  "migrate": {
    "type": "boolean",
    "required": false,
    "default": false,
    "description": "If true, OLD-format markers replaced em-place by soma-v2 v2 anchors at same byte position. If false (default), OLD markers preserved (coexist mode).",
    "example": false
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--apply` | flag | no | Default false (dry-run). Mutually exclusive with `--dry-run` (which is implicit default) |
| `--tool` | enum | yes | Must be `codex` OR `claude`. Other values reject with INVALID_ARGS |
| `--migrate` | flag | no | Only meaningful when `--apply` set. With dry-run, shows migration preview |

**Sandbox precondition:** If env `SOMA_SAFE_PATHS_ONLY=1` is set, all target paths in install-targets.json MUST be prefixed with `/tmp/soma-v2-test/`. Else reject with SANDBOX_VIOLATION.

---

## Output

**Success (dry-run, AC-01):**
```json
{
  "mode": "dry-run",
  "tool": "claude",
  "entries_count": 3,
  "preview": [
    {
      "block_id": "block.claude.CLAUDE_md.cbm",
      "target_path": "~/.claude/CLAUDE.md",
      "operation": "insert|replace",
      "diff_excerpt": "<insert anchored block at line 587 (before ## Failure Log)>"
    }
  ],
  "writes_executed": 0
}
```

**Success (apply, AC-02 / AC-03):**
```json
{
  "mode": "apply",
  "tool": "claude",
  "snapshot_id": "2026-05-02T19-30-15Z",
  "snapshot_path": "~/.soma-v2/.snapshots/2026-05-02T19-30-15Z",
  "entries_written": 3,
  "files_modified": ["~/.claude/CLAUDE.md"],
  "post_write_sha256": {"~/.claude/CLAUDE.md": "abc123..."},
  "duration_ms": 1247
}
```

**Error (conflict detection, AC-13/AC-14):**
```json
{
  "error": "BLOCK_CONFLICT",
  "message": "User manually edited content inside block.claude.CLAUDE_md.hyd-v2 in ~/.claude/CLAUDE.md between syncs. Aborting before write.",
  "details": {
    "file": "~/.claude/CLAUDE.md",
    "block_id": "block.claude.CLAUDE_md.hyd-v2",
    "expected_sha256": "old123...",
    "actual_sha256": "new456...",
    "resolution_guidance": "Inspect block, decide: (1) rollback to pre-edit state via `soma rollback --snapshot-id <prev-id>`, OR (2) re-extract content into source doc and re-sync."
  },
  "writes_executed": 0
}
```

**Error codes:**
| Code | When |
|---|---|
| `INVALID_ARGS` | `--tool` missing or not in enum |
| `SANDBOX_VIOLATION` | `SOMA_SAFE_PATHS_ONLY=1` set + target path outside `/tmp/soma-v2-test/` prefix |
| `SNAPSHOT_FAILED` | Snapshot creation failed (disk full, perms) — abort before any write |
| `BLOCK_CONFLICT` | sha256 of existing block content mismatch vs latest manifest entry — abort before write |
| `INSTALL_TARGETS_INVALID` | `install-targets.json` schema validation failed (missing required fields) |
| `SOURCE_DOC_NOT_FOUND` | Referenced source_doc path does not exist em SOMA_HOME |

---

## Side Effects

**Dry-run mode:**
- None — read-only (thermal-guard: does NOT count toward compile/test limit)

**Apply mode:**
- Writes snapshot files at `~/.soma-v2/.snapshots/{ISO}/{tool}/{file-relative-path}` (per AC-04, AC-06 user-only 0600 perms)
- Writes manifest at `~/.soma-v2/.snapshots/{ISO}/manifest.json` (per AC-05)
- Modifies target bootloader files (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/CLAUDE.md`) — anchored block inject/replace
- Appends log entry at `~/.soma-v2/logs/sync-{YYYY-MM-DD}.jsonl`

---

## Idempotency

- **Idempotent:** yes (per AC-18 — re-apply with no source changes = no-op)
- **If called twice:** Second call computes diff vs current state. If source_docs unchanged AND target bootloader unchanged → dry-run reports "no diff" + apply does zero writes (still creates empty snapshot for audit trail).

---

## Constitutional Compliance

- **Article II HARD** — Implementation MUST follow TDD RED→GREEN. C-2 enforcement via `SOMA_RED_PHASE_STRICT=1` env in dispatch.
- **Article III HARD** — Tests use real fs em `/tmp/phase5-validation/` fixtures. Zero mocks for fs/sha256/child_process.
- **Article IV HARD** — Apply test output MUST log: snapshot_path + manifest_sha256 + post_write_sha256.
- **Article V HARD** — Apply operations counted toward 3-simultaneous compile/test limit by thermal-guard hook.
- **Article VI HARD** — Zero deletion. OLD markers preserved (coexist) unless `--migrate` flag explicit (and even then, content backed up via auto-snapshot, recoverable via rollback).

---

## Contract Test Stub

```javascript
// @spec AC-01 AC-02 AC-03 AC-13 AC-18
// @contract CONTRACT-011-01-sync-apply
const { test } = require("node:test");
const assert = require("node:assert");

test("sync without --apply runs dry-run only (AC-01)", async () => {
  process.env.SOMA_SAFE_PATHS_ONLY = "1";
  const result = runSync(["--tool=claude"]);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.writes_executed, 0);
  // Assert target file sha256 unchanged post-run
});

test("sync --apply --tool=codex injects 5 entries (AC-02)", async () => {
  // Setup /tmp/soma-v2-test/codex-fixture/AGENTS.md
  const result = runSync(["--apply", "--tool=codex"]);
  assert.equal(result.entries_written, 5);
  assert.ok(result.snapshot_id);
});

test("sync --apply --tool=claude appends ## SOMA Bootloader before ## Failure Log (AC-03)", async () => {
  const result = runSync(["--apply", "--tool=claude"]);
  // Assert injected position is before "## Failure Log" anchor in fixture
});

test("BLOCK_CONFLICT when user edited inside anchored block (AC-13)", async () => {
  // Apply once, manually edit inside block, apply again
  const result = runSync(["--apply", "--tool=claude"]);
  assert.equal(result.error, "BLOCK_CONFLICT");
  assert.equal(result.writes_executed, 0);
});

test("idempotent re-apply with no changes (AC-18)", async () => {
  runSync(["--apply", "--tool=claude"]);
  const result2 = runSync(["--apply", "--tool=claude"]);
  // Assert second apply detects no diff, zero entries_written or no-op marker
});

test("SANDBOX_VIOLATION when SOMA_SAFE_PATHS_ONLY=1 + real path", async () => {
  process.env.SOMA_SAFE_PATHS_ONLY = "1";
  // install-targets points to ~/.claude/CLAUDE.md (outside /tmp/soma-v2-test/)
  const result = runSync(["--apply", "--tool=claude"]);
  assert.equal(result.error, "SANDBOX_VIOLATION");
});
```
