# Contract: Tool Call — soma sync --apply

**Contract ID:** CONTRACT-SYNC-APPLY-01
**spec_ref:** [SPEC:AC-01..AC-12]
**Created:** 2026-05-02
**Type:** internal tool / CLI command

---

## Tool Name

```
soma sync --apply
```

CLI entry: `node ~/.soma-v2/scripts/sync.cjs --apply [--soma-home <path>] [--json]`

---

## Description

Apply pending sync changes to adapter target files (e.g. `~/.codex/AGENTS.md`, `~/AGENTS.md`) — writes anchored blocks per install-targets schema v1, after creating a full-file snapshot of pre-write state for rollback. All-or-nothing transactional commit (D2): validate ALL targets pre-write, abort entire run if any check fails.

---

## Arguments

```json
{
  "--apply": {
    "type": "flag",
    "required": false,
    "description": "Toggle write mode. Without this flag, sync stays dry-run-only (Phase 2 behavior preserved per AC-01).",
    "example": "soma sync --apply"
  },
  "--soma-home": {
    "type": "string (path)",
    "required": false,
    "description": "Override SOMA_HOME location. Defaults to env SOMA_HOME or ~/.soma-v2.",
    "example": "--soma-home /tmp/soma-test"
  },
  "--json": {
    "type": "flag",
    "required": false,
    "description": "Emit structured JSON output instead of human-readable preview (D5: same schema for success+error; error field populated only in failure).",
    "example": "soma sync --apply --json"
  },
  "--dry-run": {
    "type": "flag",
    "required": false,
    "description": "Mutually exclusive with --apply (AC-12: exits 2 INVALID_ARGS if both passed).",
    "example": "soma sync --dry-run"
  }
}
```

**Argument constraints:**

| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--apply` | flag | no | Mutually exclusive with `--dry-run` (AC-12) |
| `--soma-home` | path | no | Must resolve to existing dir with valid manifest.json |
| `--json` | flag | no | Independent toggle; combinable with `--apply` |
| `--dry-run` | flag | no | Mutually exclusive with `--apply` |

---

## Output

**Success (with `--apply`, drift detected, write completed):**
```json
{
  "schema": "soma-sync-apply/v1",
  "mode": "apply",
  "snapshot": {
    "timestamp": "2026-05-02T14:30:45Z",
    "path": "~/.soma-v2/.snapshots/2026-05-02T14:30:45Z/",
    "manifest_path": "~/.soma-v2/.snapshots/2026-05-02T14:30:45Z/manifest.json",
    "files_count": 3,
    "total_bytes": 30724
  },
  "summary": {
    "by_action": { "insert": 1, "replace": 2, "skip": 0 },
    "files_touched": [
      { "adapter": "codex", "path": "AGENTS.md", "action": "replace" },
      { "adapter": "claude", "path": "CLAUDE.md", "action": "insert" }
    ],
    "warnings": []
  },
  "error": null
}
```

**Success (with `--apply`, already synced — AC-05 noop):**
```json
{
  "schema": "soma-sync-apply/v1",
  "mode": "apply",
  "snapshot": null,
  "summary": {
    "by_action": { "insert": 0, "replace": 0, "skip": 3 },
    "files_touched": [],
    "warnings": []
  },
  "error": null
}
```

**Success (with `--apply`, local edits detected — D4 warn-and-continue):**
```json
{
  "schema": "soma-sync-apply/v1",
  "mode": "apply",
  "snapshot": { /* as above */ },
  "summary": {
    "by_action": { "insert": 0, "replace": 1, "skip": 0 },
    "files_touched": [{ "adapter": "codex", "path": "AGENTS.md", "action": "replace" }],
    "warnings": [
      {
        "code": "LOCAL_EDITS_DETECTED",
        "adapter": "codex",
        "path": "AGENTS.md",
        "message": "File has been modified outside SOMA since last snapshot. Pre-state preserved at .snapshots/2026-05-02T14:30:45Z/codex/AGENTS.md"
      }
    ]
  },
  "error": null
}
```

**Error (any abort path):**
```json
{
  "schema": "soma-sync-apply/v1",
  "mode": "apply",
  "snapshot": null,
  "summary": null,
  "error": {
    "code": "SOURCE_STALE",
    "message": "Source file ~/.codex/AGENTS.md changed between dry-run and apply phase",
    "details": { "expected_sha256": "abc...", "actual_sha256": "def..." }
  }
}
```

**Error codes:**

| Code | When | Exit |
|---|---|---|
| `INVALID_ARGS` | `--apply` and `--dry-run` both passed (AC-12) | 2 |
| `SNAPSHOT_CREATE_FAILED` | Cannot create `.snapshots/{ISO}/` dir (perms, disk full) (AC-06) | 1 |
| `SOURCE_STALE` | Source shasum changed between preview and write (AC-07) | 1 |
| `ANCHOR_PARSE_ERROR` | Anchored block parse failure in any target file (AC-08) | 1 |
| `MANIFEST_MISSING` | SOMA_HOME has no manifest.json | 2 |
| `INVALID_TARGET` | install-targets path escapes SOMA_HOME (`..`) | 2 |

---

## Side Effects

- **Writes:** `~/.soma-v2/.snapshots/{ISO}/{adapter}/{path}` for each target file (full-file copy pre-write per AC-02)
- **Writes:** `~/.soma-v2/.snapshots/{ISO}/manifest.json` (per AC-03 byte-stable schema)
- **Writes:** target files declared in install-targets v1 (e.g. `~/.codex/AGENTS.md`, `~/AGENTS.md`) — anchored blocks replaced/inserted
- **Reads only:** SOMA_HOME canonical sources (constitution, AGENTS sources). NEVER modified by sync.
- **Permissions:** snapshot dirs created with mode 0700 (NFR Security)
- **Atomicity:** all writes happen after pre-validation passes (D2 all-or-nothing)

---

## Idempotency

- **Idempotent:** yes (AC-10)
- **If called twice in already-synced state:** second call is noop — returns `by_action: { skip: N }`, no snapshot dir created (AC-05)
- **If called twice in drift state (consecutive runs):** first call writes snapshot+changes; second call noop (since first already synced source). Two snapshot dirs are NOT created for same logical state.

---

## Contract Test Stub

```javascript
// @spec AC-01..AC-12
// @contract CONTRACT-SYNC-APPLY-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-apply-')); }
function runSync(args, env = {}) {
  return spawnSync('node', ['scripts/sync.cjs', ...args], {
    cwd: process.env.SOMA_HOME_REPO || `${os.homedir()}/.soma-v2`,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('AC-01: sync without --apply preserves Phase 2 dry-run (no writes, no snapshot)', () => {
  const home = tmpHome();
  /* setup synthetic SOMA_HOME with drift */
  const r = runSync(['--soma-home', home, '--json']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'dry-run');
  assert.equal(fs.existsSync(path.join(home, '.snapshots')), false);
});

test('AC-12: --apply + --dry-run together exits 2 INVALID_ARGS', () => {
  const r = runSync(['--apply', '--dry-run']);
  assert.equal(r.status, 2);
  // assert error.code === 'INVALID_ARGS'
});

test('AC-02+AC-03: --apply with drift creates snapshot + manifest pre-write', () => {
  const home = tmpHome();
  /* setup SOMA_HOME with drift in fake AGENTS.md */
  const r = runSync(['--apply', '--soma-home', home, '--json']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z(-\d+)?$/));
  assert.ok(fs.existsSync(out.snapshot.manifest_path));
  const mf = JSON.parse(fs.readFileSync(out.snapshot.manifest_path, 'utf8'));
  assert.equal(mf.schema, 'soma-snapshot/v1');
  assert.ok(Array.isArray(mf.files));
});

test('AC-05: --apply on already-synced state is noop', () => {
  const home = tmpHome();
  /* setup SOMA_HOME with no drift */
  const r = runSync(['--apply', '--soma-home', home, '--json']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snapshot, null);
  assert.equal(out.summary.files_touched.length, 0);
});

test('AC-06: --apply with unwritable .snapshots/ aborts SNAPSHOT_CREATE_FAILED, source untouched', () => {
  const home = tmpHome();
  /* setup .snapshots/ with mode 0000 */
  const r = runSync(['--apply', '--soma-home', home, '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SNAPSHOT_CREATE_FAILED');
});

test('AC-07: --apply when source changed between preview+write aborts SOURCE_STALE', () => {
  /* race condition simulation via two-phase setup */
});

test('AC-08: --apply with corrupted anchor block aborts ANCHOR_PARSE_ERROR, source untouched', () => {
  /* setup AGENTS.md with malformed soma-v2 anchor */
});

test('AC-09: manifest.json byte-stable across re-runs', () => {
  /* compute manifest twice, byte-compare */
});

test('AC-10: --apply twice in succession: second is noop (idempotência)', () => {
  /* run --apply twice in drift state, verify second is noop */
});

test('AC-11: trap scenarios in /tmp synthetic — accidental --apply with no targets, missing snapshot, stale source, parse error', () => {
  /* 4 trap fixtures, all exit 1 with no source corruption */
});

test('D4: --apply with local edits detected → write + warn loud', () => {
  /* user-edited AGENTS.md, run --apply, verify snapshot saves pre-state, warning emitted */
});
```

---

## Notes

- This contract demands TDD HARD per Article II + C-2 enforcement. Implementation dispatch sets `SOMA_RED_PHASE_STRICT=1` env during test runs. RED phase commit MUST be separate from GREEN per `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase`.
- Existing `scripts/sync.cjs` (Phase 2, ~230L) is the extension target. New helper expected: `scripts/lib/snapshot.cjs` for snapshot create + manifest emit + byte-stable hash. Library files in `scripts/lib/` have shasum baseline locked (Phase 4b adds NEW lib only; existing 3 libs untouched).
