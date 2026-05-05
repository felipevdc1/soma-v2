# Contract: Tool Call — soma doctor

**Contract ID:** CONTRACT-DOCTOR-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-06] [SPEC:AC-07]
**Created:** 2026-05-01
**Type:** internal CLI tool (Node script invoked via `node ~/.soma-v2/scripts/doctor.cjs`)

---

## Tool Name

```
node ~/.soma-v2/scripts/doctor.cjs
```

---

## Description

Read-only health check that detects drift between `~/.soma-v2/manifest.json` + install-targets versus canonical sources (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `~/.claude/CLAUDE.md`) and lab files. Emits findings categorized by `kind`: `target_drift`, `source_staleness`, `lab_corruption`. Never mutates filesystem.

---

## Arguments

```json
{
  "--json": {
    "type": "boolean",
    "required": false,
    "description": "Emit findings as JSON to stdout instead of human-readable summary",
    "example": "--json"
  },
  "--quiet": {
    "type": "boolean",
    "required": false,
    "description": "Suppress non-actionable findings (kind=skip equivalent) in human output",
    "example": "--quiet"
  },
  "--verbose": {
    "type": "boolean",
    "required": false,
    "description": "Show all findings including OK statuses in human output",
    "example": "--verbose"
  },
  "--soma-home": {
    "type": "string",
    "required": false,
    "description": "Override SOMA_HOME path (default ~/.soma-v2). Used by tests with /tmp fixtures.",
    "example": "/tmp/soma-test-abc/.soma-v2"
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--json` | boolean flag | no | mutually exclusive with `--quiet`/`--verbose` (JSON always emits all) |
| `--quiet` | boolean flag | no | mutually exclusive with `--verbose` |
| `--verbose` | boolean flag | no | mutually exclusive with `--quiet` |
| `--soma-home` | string | no | must be valid directory; falls back to `$HOME/.soma-v2` |

---

## Output

**Success (`--json` flag):**
```json
{
  "tool": "doctor",
  "mode": "check",
  "soma_home": "${SOMA_HOME}",
  "summary": {
    "total_findings": 3,
    "by_kind": {"target_drift": 3, "source_staleness": 0, "lab_corruption": 0},
    "by_severity": {"missing": 2, "drift": 1, "ok": 0}
  },
  "findings": [
    {
      "kind": "target_drift",
      "severity": "missing",
      "target_path": "${HOME}/AGENTS.md",
      "target_anchor_id": "block.codex.AGENTS.soma-stsd",
      "source_doc": "docs/soma-stsd.md",
      "expected_sha256": "c2cec032f33aa554c9b6786d66551d57c099baf4142309de4e5d7ab1024f9601",
      "actual_sha256": null,
      "message": "Anchored block missing in target file"
    },
    {
      "kind": "target_drift",
      "severity": "missing",
      "target_path": "${HOME}/AGENTS.md",
      "target_anchor_id": "block.codex.AGENTS.codebase-memory-mcp",
      "source_doc": "docs/hyd-v2.md",
      "expected_sha256": "...",
      "actual_sha256": null,
      "message": "Anchored block missing in target file"
    },
    {
      "kind": "target_drift",
      "severity": "drift",
      "target_path": "${CODEX_HOME}/AGENTS.md",
      "target_anchor_id": "block.codex.AGENTS.hyd-v2",
      "source_doc": "docs/hyd-v2.md",
      "expected_sha256": "...",
      "actual_sha256": "(no anchor attributes)",
      "message": "Anchor markers exist but lack id/version/sha256 attributes"
    }
  ]
}
```

**Success (default human output):**
```
SOMA doctor — checking ~/.soma-v2 vs canonical sources

DRIFT: 3 finding(s)
  [missing]   ~/AGENTS.md ← block.codex.AGENTS.soma-stsd (sha256=c2cec032)
  [missing]   ~/AGENTS.md ← block.codex.AGENTS.codebase-memory-mcp (sha256=...)
  [drift]     ~/.codex/AGENTS.md @ block.codex.AGENTS.hyd-v2 — anchors lack id/version/sha256 attrs

Run `node ~/.soma-v2/scripts/sync.cjs --dry-run` to preview repair actions.
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
| `MANIFEST_MISSING` | `~/.soma-v2/manifest.json` not found |
| `MANIFEST_INVALID` | manifest.json is not parseable JSON or fails schema v1 check |
| `INSTALL_TARGETS_INVALID` | install-targets.json malformed |
| `SOURCE_UNREADABLE` | canonical source (e.g., `~/.codex/AGENTS.md`) referenced by install-targets but not readable (warning, not fatal — emits as finding instead of hard error) |
| `INVALID_ARGS` | conflicting flags (e.g., `--json --quiet`) |

---

## Side Effects

- **None — read-only.** doctor MUST NOT modify any file under any circumstance. Verified via shasum pre/post run on all canonical sources + entire `~/.soma-v2/` tree (per [SPEC:AC-02]).
- thermal-guard: does NOT count toward compile/test limit (no compilation, no test spawning).

---

## Idempotency

- **Idempotent:** yes (always; trivially since read-only).
- **If called twice:** returns identical output; identical exit code.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | zero drift findings (all `kind=ok` or `severity=ok`) |
| `1` | ≥1 drift finding (`severity=missing` OR `severity=drift`) |
| `2` | hard error (manifest missing/invalid, install-targets malformed, invalid args) |

---

## Contract Test Stub

```javascript
// @spec AC-01,02,06,07
// @contract CONTRACT-DOCTOR-01
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

test('doctor: --json output schema matches contract', () => {
  const out = execFileSync('node', ['scripts/doctor.cjs', '--json', '--soma-home=/tmp/soma-test-abc/.soma-v2'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.tool, 'doctor');
  assert.equal(parsed.mode, 'check');
  assert.ok(Array.isArray(parsed.findings));
  assert.ok(parsed.summary && typeof parsed.summary.total_findings === 'number');
});

test('doctor: detects exactly 3 known drifts in real ~/ fixture', () => {
  // setup: copy real manifest + sources into /tmp fixture, capture pre-shasum
  // run doctor against fixture
  // assert: 3 findings (D1: ~/AGENTS.md missing soma-stsd, D2: missing CBM, D3: codex/AGENTS.md anchors no attrs)
  // assert: 0 false positive findings
});

test('doctor: read-only contract — sources untouched (AC-02)', () => {
  // setup: capture shasum of all canonical sources
  // run doctor
  // assert: shasum -c returns OK for every source (zero modifications)
});

test('doctor: exit code 1 when drift detected', () => {
  // ...
});

test('doctor: exit code 0 when no drift', () => {
  // setup fixture with all targets in sync
  // ...
});

test('doctor: --json --quiet returns INVALID_ARGS', () => {
  // ...
});
```
