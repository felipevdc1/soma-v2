# Contract: Tool Call — soma bootstrap

**Contract ID:** CONTRACT-BOOTSTRAP-01
**spec_ref:** [SPEC:AC-01..AC-14]
**Created:** 2026-05-02
**Type:** internal tool / CLI command (single command, two output modes)

---

## Tool Name

```
soma bootstrap [--quiet] [--soma-home <path>]
```

CLI entry: `node ~/.soma-v2/scripts/bootstrap.cjs`

---

## Description

Validates a SOMA-enabled project for daily use: detects `.soma/` in cwd, validates `SOMA_HOME` (default `~/.soma-v2/`), delegates to `doctor --check-context-routing` for drift detection, and emits a "ready/drift/error" summary including detected modules and adapter inventory. Read-only: zero modifications to `SOMA_HOME` (Adapter Contract Cláusula B HARD).

---

## Arguments

```json
{
  "--quiet": {
    "type": "flag",
    "required": false,
    "description": "Emit ONLY the JSON payload on stdout (no human-readable summary). Orchestrator-friendly mode (D1 lock).",
    "default": false
  },
  "--soma-home": {
    "type": "path",
    "required": false,
    "description": "Override SOMA_HOME path. Falls back to env var SOMA_HOME, then ~/.soma-v2/ (D2 lock).",
    "default": "$SOMA_HOME or ~/.soma-v2"
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `--quiet` | flag | no | boolean toggle |
| `--soma-home` | path | no | absolute or `~`-expandable; must exist + readable |

**Mutually exclusive flag combinations:** none.

---

## Output

### Success path (exit 0): `status: "ready"` OR `status: "drift"`

```json
{
  "schema": "soma-bootstrap/v1",
  "status": "ready",
  "soma_home": "/Users/x/.soma-v2",
  "project_root": "/path/to/cloned-repo",
  "modules": [
    {"slug": "auth-system", "status": "active"},
    {"slug": "billing", "status": "hypothesis"}
  ],
  "adapters": [
    {"tool": "codex", "install_targets_count": 5},
    {"tool": "claude", "install_targets_count": 0}
  ],
  "findings": [],
  "duration_ms": 1247,
  "suggestion": null
}
```

When `status: "drift"` (warnings only — exit 0):
- `findings: [...]` populated with non-critical warnings (drift, stale-hypothesis, missing optional fields)
- `suggestion`: `"Run 'soma sync --apply' to remediate drift findings"` (D3 lock — report-only, no auto-prompt)

### Error path (exit 1): `status: "error"`

```json
{
  "schema": "soma-bootstrap/v1",
  "status": "error",
  "error_code": "INVALID_SOMA_HOME",
  "message": "SOMA_HOME at /Users/x/.soma-v2 is missing or manifest.json is not parseable.",
  "suggestion": "See ~/.soma-v2/docs/onboarding.md or set SOMA_HOME env var to a valid path.",
  "soma_home_attempted": "/Users/x/.soma-v2",
  "duration_ms": 12
}
```

When `status: "error"` AND `error_code: "CRITICAL_DRIFT"`:
- `critical_findings: [...]` populated with critical entries from doctor (manifest corrupt, schema invalid, unrecoverable drift)
- exit code 1

### Invalid args (exit 2):

```json
{
  "schema": "soma-bootstrap/v1",
  "status": "error",
  "error_code": "INVALID_ARGS",
  "message": "Unknown flag: --json. Did you mean --quiet?",
  "duration_ms": 3
}
```

### Error codes:

| Code | Exit | When |
|---|---|---|
| `NO_SOMA_PROJECT` | 1 | cwd lacks `.soma/` directory (AC-02) |
| `INVALID_SOMA_HOME` | 1 | SOMA_HOME missing OR `manifest.json` missing/unparseable (AC-04) |
| `MODULES_MISSING` | 1 | `.soma/` exists but `.soma/modules/` empty — D4 lock (run `soma init --existing`) |
| `SCHEMA_VERSION_UNSUPPORTED` | 1 | `manifest.schema` ≠ `"soma-manifest/v1"` — D8 lock |
| `CRITICAL_DRIFT` | 1 | doctor returns ≥1 critical-severity findings (AC-08) |
| `INVALID_ARGS` | 2 | unknown flag, wrong type, mutually-exclusive violation |

---

## Side Effects

- **None** — read-only on `SOMA_HOME` (Cláusula B Adapter Contract HARD enforcement)
- **None** — read-only on `.soma/` (current project)
- Stdout: human-readable summary + JSON block (default) OR pure JSON (`--quiet`)
- Stderr: structured logs (debug info, timing, internal warnings) — never machine-parsed payload

Read-only is enforced by AC-14 integration test (sha256 of every `~/.soma-v2/` file pre/post bootstrap MUST match).

---

## Idempotency

- **Idempotent:** yes
- **If called twice in succession:** identical output (assuming no concurrent SOMA_HOME or .soma/ modification between invocations)
- Bootstrap performs no writes; repeated invocations cost only filesystem reads + doctor delegation overhead

---

## Performance contract

- **Wallclock:** ≤5000ms p95 for well-formed project (~10 modules, valid SOMA_HOME) — AC-13
- Excludes module inference (D4: bootstrap delegates to existing `.soma/modules/` only, no H1+H2 re-run)
- Excludes network (no external calls in v1)

---

## Schema version

```
"schema": "soma-bootstrap/v1"
```

`v1` is the only supported version in this MVP. Future schema evolution gated on user demand.

---

## Contract Test Stub

```javascript
// @spec AC-01..AC-14
// @contract CONTRACT-BOOTSTRAP-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('bootstrap detects .soma/ and exits 0 with ready status', () => {
  // setup: create /tmp fixture with valid .soma/ + valid SOMA_HOME
  const result = spawnSync('node', ['~/.soma-v2/scripts/bootstrap.cjs', '--quiet'], {
    cwd: '/tmp/soma-bootstrap-fixture-{slug}',
    env: { ...process.env, SOMA_HOME: '/tmp/soma-bootstrap-fixture-{slug}/soma-home' }
  });
  const out = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(out.schema, 'soma-bootstrap/v1');
  assert.match(out.status, /^(ready|drift)$/);
});

test('bootstrap exits 1 with NO_SOMA_PROJECT when .soma/ missing', () => {
  const result = spawnSync('node', ['~/.soma-v2/scripts/bootstrap.cjs', '--quiet'], {
    cwd: '/tmp/no-soma-fixture'
  });
  assert.equal(result.status, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'NO_SOMA_PROJECT');
});

test('bootstrap is idempotent across consecutive invocations', () => {
  // call twice
  // assert outputs match (modulo duration_ms)
});

test('AC-14 read-only: SOMA_HOME shasums identical pre/post bootstrap', () => {
  // shasum -a 256 of every ~/.soma-v2/ file before
  // run bootstrap
  // shasum after; assert empty diff
});
```

---

## Tracebility

| AC | Output field | Test |
|---|---|---|
| AC-01 | `status: "ready"` w/ valid project | bootstrap-detects-soma-dir.test |
| AC-02 | `error_code: "NO_SOMA_PROJECT"` | bootstrap-no-soma-project.test |
| AC-03 | `status: "ready"` w/ valid SOMA_HOME | bootstrap-valid-soma-home.test |
| AC-04 | `error_code: "INVALID_SOMA_HOME"` | bootstrap-invalid-soma-home.test |
| AC-05 | doctor delegation captured | bootstrap-delegates-doctor.test |
| AC-06 | `findings: []` + `status: "ready"` | bootstrap-zero-findings.test |
| AC-07 | warnings + `status: "drift"` + suggestion | bootstrap-drift-warnings.test |
| AC-08 | `critical_findings[]` + `error_code: "CRITICAL_DRIFT"` + exit 1 | bootstrap-critical-drift.test |
| AC-09 | `modules[] adapters[] findings[] duration_ms` schema | bootstrap-output-schema.test |
| AC-10 | human + JSON block default | bootstrap-default-output.test |
| AC-11 | `--quiet` emits ONLY JSON | bootstrap-quiet-mode.test |
| AC-12 | onboarding.md exists + 3+ errors documented | onboarding-doc.test |
| AC-13 | wallclock ≤5000ms | bootstrap-perf.test |
| AC-14 | shasum integrity preserved | bootstrap-readonly.test |
