# Contract: Tool Call — soma sync --dry-run

**Contract ID:** CONTRACT-SYNC-DRYRUN-01
**spec_ref:** [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-06] [SPEC:AC-07]
**Created:** 2026-05-01
**Type:** internal CLI tool (Node script invoked via `node ~/.soma-v2/scripts/sync.cjs --dry-run`)

---

## Tool Name

```
node ~/.soma-v2/scripts/sync.cjs --dry-run
```

---

## Description

Read-only preview of repair edits per anchored block. Reads `~/.soma-v2/adapters/{tool}/install-targets.json` entries and reports per-entry intended action without applying anything. Phase 2 only supports `--dry-run` mode; write-mode is Phase 3+ and explicitly rejected without `--dry-run` flag.

---

## Arguments

```json
{
  "--dry-run": {
    "type": "boolean",
    "required": true,
    "description": "Phase 2 enforces dry-run-only. Without this flag, sync exits with INVALID_ARGS.",
    "example": "--dry-run"
  },
  "--json": {
    "type": "boolean",
    "required": false,
    "description": "Emit findings as JSON instead of human-readable summary",
    "example": "--json"
  },
  "--verbose": {
    "type": "boolean",
    "required": false,
    "description": "Show all entries including action=skip in human output (default suppresses skips)",
    "example": "--verbose"
  },
  "--soma-home": {
    "type": "string",
    "required": false,
    "description": "Override SOMA_HOME path. Used by tests with /tmp fixtures.",
    "example": "/tmp/soma-test-abc/.soma-v2"
  },
  "--tool": {
    "type": "string",
    "required": false,
    "description": "Filter to single adapter (codex|claude). Default: all adapters.",
    "example": "codex"
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--dry-run` | boolean flag | yes (Phase 2) | absent → INVALID_ARGS error |
| `--json` | boolean flag | no | mutually exclusive with `--verbose` (JSON always emits all) |
| `--verbose` | boolean flag | no | |
| `--soma-home` | string | no | must be valid directory |
| `--tool` | string | no | enum: codex, claude |

---

## Output

**Success (`--json` flag):**
```json
{
  "tool": "sync",
  "mode": "dry-run",
  "soma_home": "${SOMA_HOME}",
  "adapters_scanned": ["codex", "claude"],
  "summary": {
    "total_entries": 5,
    "by_action": {"insert": 2, "replace": 0, "skip": 3, "drift": 0}
  },
  "findings": [
    {
      "action": "insert",
      "adapter": "codex",
      "target_path": "${HOME}/AGENTS.md",
      "target_anchor_id": "block.codex.AGENTS.soma-stsd",
      "source_doc": "docs/soma-stsd.md",
      "expected_sha256": "c2cec032f33aa554c9b6786d66551d57c099baf4142309de4e5d7ab1024f9601",
      "actual_sha256": null,
      "message": "Would insert block at end of file (no existing anchors)"
    },
    {
      "action": "skip",
      "adapter": "codex",
      "target_path": "${CODEX_HOME}/AGENTS.md",
      "target_anchor_id": "block.codex.AGENTS.hyd-v2",
      "source_doc": "docs/hyd-v2.md",
      "expected_sha256": "883448797220...",
      "actual_sha256": "883448797220...",
      "message": "Already in sync"
    }
  ]
}
```

**Success (default human output, suppresses skip):**
```
SOMA sync --dry-run — previewing edits per anchored block

ACTIONS: 2 finding(s) (3 skip suppressed; --verbose to show all)
  [insert]    ~/AGENTS.md ← block.codex.AGENTS.soma-stsd (source: docs/soma-stsd.md, sha256=c2cec032)
  [insert]    ~/AGENTS.md ← block.codex.AGENTS.codebase-memory-mcp (source: docs/hyd-v2.md, sha256=...)

Run without --dry-run to apply (Phase 3+ — currently rejected; this is Phase 2 dry-run-only).
```

**Error:**
```json
{
  "error": "{ERROR_CODE}",
  "message": "{human-readable description}"
}
```

**Error codes:**
| Code | When |
|---|---|
| `INVALID_ARGS` | `--dry-run` not passed (Phase 2 enforces dry-run-only) |
| `MANIFEST_MISSING` | `~/.soma-v2/manifest.json` not found |
| `INSTALL_TARGETS_INVALID` | install-targets.json malformed or fails schema |
| `SOURCE_DOC_MISSING` | `source_doc` referenced by entry doesn't exist in lab `docs/` |
| `TARGET_UNREADABLE` | `target_path` exists but cannot be read (warning per-entry, not fatal) |

---

## Side Effects

- **None — read-only (dry-run mode).** sync --dry-run MUST NOT modify any file. Verified via shasum pre/post run on all canonical sources + entire `~/.soma-v2/` tree (per [SPEC:AC-04]).
- thermal-guard: does NOT count toward compile/test limit.

---

## Idempotency

- **Idempotent:** yes (always; read-only).
- **If called twice:** returns identical output; identical exit code.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | zero actionable findings (all `action=skip`) — everything in sync |
| `1` | ≥1 actionable finding (`action=insert` OR `replace` OR `drift`) — sync needed |
| `2` | hard error (`--dry-run` missing, manifest invalid, install-targets malformed) |

---

## Contract Test Stub

```javascript
// @spec AC-03,04,06,07
// @contract CONTRACT-SYNC-DRYRUN-01
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

test('sync: rejects without --dry-run flag (Phase 2)', () => {
  try {
    execFileSync('node', ['scripts/sync.cjs', '--soma-home=/tmp/soma-test-abc/.soma-v2'], { encoding: 'utf8' });
    assert.fail('expected non-zero exit');
  } catch (err) {
    assert.equal(err.status, 2);
    const out = JSON.parse(err.stdout || err.stderr);
    assert.equal(out.error, 'INVALID_ARGS');
  }
});

test('sync --dry-run: --json output schema matches contract', () => {
  const out = execFileSync('node', ['scripts/sync.cjs', '--dry-run', '--json', '--soma-home=/tmp/soma-test-abc/.soma-v2'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.tool, 'sync');
  assert.equal(parsed.mode, 'dry-run');
  assert.ok(Array.isArray(parsed.findings));
  parsed.findings.forEach(f => {
    assert.ok(['insert', 'replace', 'skip', 'drift'].includes(f.action));
    assert.ok(typeof f.target_path === 'string');
    assert.ok(typeof f.target_anchor_id === 'string');
  });
});

test('sync --dry-run: reports 2 inserts for ~/AGENTS.md (after D2 schema edit)', () => {
  // setup: fixture with codex/install-targets having 5 entries (3 ~/.codex/AGENTS.md + 2 duplicated for ~/AGENTS.md)
  // run sync --dry-run
  // assert: findings include 2 action=insert for target_path ending /AGENTS.md, target_anchor_id soma-stsd + codebase-memory-mcp
});

test('sync --dry-run: read-only contract — sources untouched (AC-04)', () => {
  // setup: shasum -a 256 of all canonical sources + ~/.soma-v2/ tree
  // run sync --dry-run
  // assert: shasum -c returns OK for everything
});

test('sync --dry-run: exit code 1 when actionable findings exist', () => {
  // ...
});

test('sync --dry-run: exit code 0 when all entries action=skip', () => {
  // ...
});
```
