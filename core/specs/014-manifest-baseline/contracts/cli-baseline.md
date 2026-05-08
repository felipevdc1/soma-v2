# Contract: Tool Call — `soma manifest baseline`

**Contract ID:** CONTRACT-014-CLI-BASELINE-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-10] [SPEC:AC-11] [SPEC:AC-12] [SPEC:AC-13] [SPEC:AC-14] [SPEC:AC-15] [SPEC:AC-16] [SPEC:AC-17]
**Created:** 2026-05-08
**Type:** internal tool (CLI subcommand)

---

## Tool Name

```
soma manifest baseline
```

(Implementation: `core/scripts/manifest.cjs` parses `baseline` as first positional arg, dispatched from `core/scripts/soma.cjs`.)

---

## Description

Recompute `manifest.json files[].sha256` entries from current lab content, treating lab as source-of-truth (lab → manifest, not vice versa). Resolves `source_staleness` drift findings reported by `doctor.cjs`. Default mode is dry-run (preview); `--apply` writes the updated manifest atomically with a snapshot taken before write.

---

## Arguments

```json
{
  "--dry-run": {
    "type": "boolean",
    "required": false,
    "description": "Preview entries that would be re-baselined; no filesystem mutation. Default behavior if neither --dry-run nor --apply passed.",
    "example": "--dry-run"
  },
  "--apply": {
    "type": "boolean",
    "required": false,
    "description": "Write updated manifest.json atomically (tmp→rename) after taking a snapshot. Mutually exclusive with --dry-run.",
    "example": "--apply"
  },
  "--filter": {
    "type": "string",
    "required": false,
    "description": "Restrict baseline to entries whose `id` or `path` field exactly matches the value. NO glob/regex support (D-014-2). Empty match = exit 0 with 'no entries matched'.",
    "example": "--filter core.soma-stsd"
  },
  "--json": {
    "type": "boolean",
    "required": false,
    "description": "Emit structured JSON output (schema soma-manifest-baseline/v1) instead of human-readable text.",
    "example": "--json"
  },
  "--help": {
    "type": "boolean",
    "required": false,
    "description": "Print usage and exit 0.",
    "example": "--help"
  }
}
```

**Argument constraints:**

| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--dry-run` | boolean flag | no | Mutually exclusive with `--apply` |
| `--apply` | boolean flag | no | Mutually exclusive with `--dry-run` |
| `--filter` | string | no | Exact-match against `entry.id` OR `entry.path`. Glob NOT supported. |
| `--json` | boolean flag | no | Compatible with both modes |
| `--help` | boolean flag | no | Short-circuits all other args |

**Default behavior** (no `--dry-run` / `--apply`): dry-run mode + emit hint reminding user to pass `--apply` to write changes (AC-15).

---

## Output

**Success — Human-readable (default):**

```
SOMA manifest baseline — /Users/felipevdc1/.soma-v2/manifest.json [dry-run]

Considered: 15 entries
Stale:      3 entries
Skipped:    0 entries
Clean:      12 entries

Stale entries:
  core.soma-stsd                docs/soma-stsd.md            c2cec032 → 1dd1ed2e
  adapter.codex.AGENTS          adapters/codex/AGENTS.md     e2491c85 → 5ab1ef02
  adapter.global.AGENTS         adapters/_global/AGENTS.md   ac9f5463 → 1d5f63b0

Hint: pass --apply to write the updated manifest.
```

**Success — JSON (`--json`):**

```json
{
  "schema": "soma-manifest-baseline/v1",
  "mode": "dry-run",
  "manifest_path": "/Users/felipevdc1/.soma-v2/manifest.json",
  "snapshot_path": null,
  "entries_considered": 15,
  "entries_rebaseled": [
    {
      "id": "core.soma-stsd",
      "path": "docs/soma-stsd.md",
      "old_sha256": "c2cec032f33aa554c9b6786d66551d57c099baf4142309de4e5d7ab1024f9601",
      "new_sha256": "1dd1ed2e6720..."
    }
  ],
  "entries_skipped": [],
  "entries_clean": 12,
  "filter_applied": null
}
```

In `apply` mode, `snapshot_path` is the absolute path to the snapshot created before write.

**Error:**

```json
{
  "schema": "soma-manifest-baseline/v1",
  "error": "MANIFEST_MISSING",
  "message": "manifest.json not found at /Users/felipevdc1/.soma-v2/manifest.json"
}
```

**Error codes:**

| Code | When | Exit |
|---|---|---|
| `MANIFEST_MISSING` | `manifest.json` does not exist in `~/.soma-v2/` (passthrough from `lib/manifest.cjs::loadManifest`) | 2 |
| `MANIFEST_INVALID` | `manifest.json` exists but fails schema validation (not `soma-manifest/v1` or missing `files` array) | 2 |
| `INVALID_ARGS` | `--dry-run` and `--apply` both passed, or unknown flag | 2 |
| `SNAPSHOT_FAILURE` | Apply mode could not create snapshot via `sync.cjs::createSnapshot()` | 2 |
| `WRITE_FAILURE` | Atomic write (tmp→rename) failed | 2 |

**Exit codes (success/non-error):**

| Exit | Meaning |
|---|---|
| 0 | Operation completed; in dry-run, may include stale entries (informational, not failure). Apply mode: write succeeded OR no stale entries. |
| 0 (skip path) | Lab file missing for an entry (AC-16, D-014-1) — entry skipped with warning, other entries proceed. Run still exits 0 if all other entries handled cleanly. |

---

## Side Effects

**Dry-run mode:**
- None — read-only (does NOT count toward thermal-guard compile/test limit per Article V).

**Apply mode:**
- Writes `~/.soma-v2/manifest.json` (atomic: tmp file → rename)
- Creates snapshot at `~/.soma-v2/.snapshots/{TS}.tar.gz` (or path determined by `sync.cjs::createSnapshot()`) BEFORE manifest write
- Updates entry `sha256` field for stale entries; `sourceSha256` field is NEVER mutated (D-014, AC-08)

---

## Idempotency

- **Idempotent:** yes (D-014 + AC-13)
- **If called twice in succession** (no intervening lab changes):
  - Dry-run twice: both runs report identical stale entries (or zero); no mutation
  - Apply twice: 1st run baselines stale entries; 2nd run reports "0 stale entries" + exits 0; manifest.json byte-identical pre/post 2nd run

---

## Contract Test Stub

```javascript
// @spec AC-01,02,06,10,11,12,13,14,15,16,17
// @contract CONTRACT-014-CLI-BASELINE-01
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test('manifest baseline --help exits 0 with usage', () => {
  const r = spawnSync('node', ['core/scripts/manifest.cjs', 'baseline', '--help']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout.toString(), /--dry-run|--apply|--filter|--json/);
});

test('manifest baseline --dry-run lists stale entries without mutation', () => {
  // Setup: fixture manifest with 1 stale entry under /tmp/soma-baseline-test-{run}/
  // ...
  const r = spawnSync('node', ['core/scripts/manifest.cjs', 'baseline', '--dry-run', '--json'], {
    env: { ...process.env, SOMA_HOME: fixtureSomaHome }
  });
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout.toString());
  assert.strictEqual(out.schema, 'soma-manifest-baseline/v1');
  assert.strictEqual(out.mode, 'dry-run');
  assert.strictEqual(out.entries_rebaseled.length, 1);
  // Verify no mutation:
  const manifestSha = sha256(fs.readFileSync(path.join(fixtureSomaHome, 'manifest.json')));
  assert.strictEqual(manifestSha, fixtureManifestSha); // unchanged
});

test('manifest baseline --apply writes atomically + creates snapshot', () => {
  // ... apply mode creates snapshot path, mutates manifest, exit 0
});

test('manifest baseline --apply --filter <id> only re-baselines matching entry', () => {
  // AC-04: filter by id
});

test('manifest baseline --apply is idempotent', () => {
  // AC-13: 2nd run = no-op + manifest byte-identical
});

test('manifest baseline --filter "adapters/*" treats as literal (no glob)', () => {
  // AC-17, D-014-2: literal exact match, no glob expansion
});

test('manifest baseline returns MANIFEST_MISSING when manifest.json absent', () => {
  // AC-11
});

test('manifest baseline skips entry whose lab path is ENOENT', () => {
  // AC-16, D-014-1: skip-with-warning, exit 0 if others clean
});

test('manifest baseline post-apply makes doctor exit 0 with 0 source_staleness findings', () => {
  // AC-03 — integration test invoking doctor.cjs after apply
});
```
