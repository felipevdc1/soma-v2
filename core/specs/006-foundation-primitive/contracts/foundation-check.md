# Contract: Tool Call — soma doctor --foundation-check

**Contract ID:** CONTRACT-FOUNDATION-CHECK-01
**spec_ref:** [SPEC:AC-01..AC-17]
**Created:** 2026-05-02
**Type:** internal tool / CLI command (extension of `soma doctor` from Phase 2/4c)

---

## Tool Name

```
soma doctor --foundation-check [--gate] [--soma-home <path>] [--project <path>] [--json]
```

CLI entry: `node ~/.soma-v2/scripts/doctor.cjs --foundation-check [--gate]`

---

## Description

Extension of `soma doctor` (Phase 2 + 4c) that evaluates Bruno's 9-criterion "fundação sólida" checklist for SOMA-enabled projects with foundation/expansion layers configured. Per-criterion pass/fail/skipped status. `--gate` mode enforces ALL 9 must pass for binary success (D4 Bruno P6). Read-only command — no source mutation.

---

## Arguments

```json
{
  "--foundation-check": {
    "type": "flag",
    "required": true,
    "description": "Enables Phase 4d foundation checklist evaluation"
  },
  "--gate": {
    "type": "flag",
    "required": false,
    "description": "Gate mode: emits 'fundação sólida o suficiente?' rhetorical line + binary exit code (0 if all 9 pass; 1 if any fail). Per D7."
  },
  "--soma-home": { "type": "path", "required": false, "description": "Override SOMA_HOME (defaults env or ~/.soma-v2)" },
  "--project": { "type": "path", "required": false, "description": "Project dir containing `.soma/project.md` (defaults to cwd)" },
  "--json": { "type": "flag", "required": false, "description": "Structured JSON output instead of human-readable" }
}
```

---

## Output

### Success (`--foundation-check` standalone, no `--gate`)
```json
{
  "schema": "soma-foundation-check/v1",
  "project": "/path/to/project",
  "foundation_layers": ["roots", "trunk"],
  "expansion_layers": ["leaves"],
  "criteria": [
    { "id": 1, "name": "padrões claros", "status": "pass", "message": "1 ADR file detected: docs/architecture-decisions/0001-stack-choice.md" },
    { "id": 2, "name": "rotas + APIs definidas", "status": "pass", "message": "All 2 trunk modules have ≥1 contract reference" },
    { "id": 3, "name": "zero data leakage", "status": "fail", "message": "module 'auth' (trunk) imports module 'reports' (leaves) at src/auth/handler.ts:15" },
    { "id": 4, "name": "zero hardcoded", "status": "fail", "message": "2 hits in foundation source: src/auth/config.ts:8 (hardcoded URL); src/core/db.ts:23 (absolute path)" },
    { "id": 5, "name": "tudo dados reais", "status": "pass", "message": "No fixtures detected in productive paths" },
    { "id": 6, "name": "testes passando", "status": "pass", "message": "test_command exit 0 (12.4s)" },
    { "id": 7, "name": "build limpo", "status": "skipped", "message": "build_command not configured in project.md" },
    { "id": 8, "name": "IDE sem erro", "status": "pass", "message": "typecheck + lint exit 0 (3.1s)" },
    { "id": 9, "name": "tech stack bem definida", "status": "pass", "message": "tech_stack array with 4 entries" }
  ],
  "summary": {
    "total": 9,
    "pass": 6,
    "fail": 2,
    "skipped": 1,
    "foundation_done": false
  },
  "error": null
}
```

### Success (`--gate` mode)
Same JSON shape PLUS final stdout line BEFORE process exit:
```
fundação sólida o suficiente?
```
Exit code 0 if `summary.foundation_done === true` (all 9 pass), exit 1 otherwise.

### Legacy state (D6 — no foundation_layers in project.md)
```json
{
  "schema": "soma-foundation-check/v1",
  "project": "/path/to/project",
  "foundation_layers": null,
  "expansion_layers": null,
  "criteria": [],
  "summary": null,
  "warnings": [
    {
      "code": "FOUNDATION_NOT_CONFIGURED",
      "message": "foundation_layers not configured in .soma/project.md; assume project in expansion phase only — use `soma init --foundation` to set up Phase 4d primitive"
    }
  ],
  "error": null
}
```

**Error codes:**

| Code | When | Exit |
|---|---|---|
| `INVALID_ARGS` | Missing `--foundation-check` flag (validates entry point) | 2 |
| `PROJECT_NOT_FOUND` | `--project` path missing or no `.soma/` dir | 2 |
| `MANIFEST_INVALID` | `.soma/project.md` malformed YAML | 2 |
| `INVALID_LAYER` | Custom layer name in `foundation_layers` not in enum {roots,trunk,leaves} (per D3) | 1 |

---

## Side Effects

- **None** (read-only) — does NOT mutate `.soma/project.md`, source files, or any project state
- Spawns subprocesses for criteria 6/7/8 (`test_command`, `build_command`, `typecheck_command`, `lint_command`) via `spawnSync` with `shell: false` (D5 + Security NFR)
- Per Article V (Read-Only Tool — thermal-guard): does NOT count toward compile/test simultaneous limit (foundation-check itself is read; the spawned criteria 6/7/8 ARE compile/test workloads but invoked sequentially within doctor execution)

---

## Idempotency

- **Idempotent**: yes — multiple consecutive invocations return same result (deterministic)
- **--gate**: idempotent same way; exit code reflects current project state

---

## Contract Test Stub

```javascript
// @spec AC-01..AC-17
// @contract CONTRACT-FOUNDATION-CHECK-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tmpProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-foundation-')); }
function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: process.env.SOMA_HOME_REPO || `${os.homedir()}/.soma-v2`,
    encoding: 'utf8',
  });
}

test('AC-01+AC-02: project.md with foundation_layers/expansion_layers + module.layer field works', () => { /* ... */ });
test('AC-03: --foundation-check lists 9 criteria with status', () => { /* ... */ });
test('AC-04 criterion 1 pass: ≥1 ADR file detected', () => { /* ... */ });
test('AC-04 criterion 1 pass alt: decisions array populated', () => { /* ... */ });
test('AC-05 criterion 2 pass: trunk modules covered by contracts', () => { /* ... */ });
test('AC-06 criterion 3 fail: trunk imports leaves module', () => { /* ... */ });
test('AC-07 criterion 4 fail: hardcoded URL in foundation source', () => {
  /* setup: foundation source with `http://localhost:3000` hardcoded */
  /* expect status: fail, message: lists path:line of hit */
});
test('AC-07 criterion 4 strict: 0 HARD em todas categorias (D1)', () => { /* ... */ });
test('AC-08 criterion 5 pass: zero fixtures in productive paths', () => { /* ... */ });
test('AC-09 criterion 6: skipped when test_command absent', () => { /* ... */ });
test('AC-09 criterion 6 pass: test_command exits 0', () => { /* ... */ });
test('AC-10 criterion 7 fail: build_command stderr contains warning', () => { /* ... */ });
test('AC-11 criterion 8 pass: typecheck + lint both exit 0', () => { /* ... */ });
test('AC-12 criterion 9 pass: tech_stack array populated', () => { /* ... */ });
test('AC-13 standalone --foundation-check exits 0 even with criteria fail', () => { /* ... */ });
test('AC-14 Step 5 VALIDATE in foundation territory: critical findings', () => { /* deferred Phase 5+ integration test */ });
test('AC-15 --gate exit 0 when all 9 pass', () => { /* ... */ });
test('AC-15 --gate exit 1 when any criterion fails', () => { /* ... */ });
test('AC-15 --gate emits "fundação sólida o suficiente?" stdout line', () => { /* ... */ });
test('AC-16 user edits to foundation_layers/tech_stack preserved across doctor/sync', () => { /* ... */ });
test('AC-17 legacy state (no foundation_layers): warning + skip + exit 0', () => { /* ... */ });
test('D3: invalid layer name (custom string) returns INVALID_LAYER error', () => { /* ... */ });
test('Security: command injection in test_command rejected', () => {
  /* setup: test_command containing `;`, `&`, `|`, `$`, backticks */
  /* expect: rejected with clear error message OR escaped via shell:false argv */
});
```

---

## Notes

- TDD HARD per Article II + C-2: dispatch sets `SOMA_RED_PHASE_STRICT=1`
- Existing `~/.soma-v2/scripts/doctor.cjs` (Phase 2 + 4c, ~423 LOC after Phase 4c) is the extension target. New helper expected: `scripts/lib/foundation-check.cjs` for criterion verifiers (single-responsibility per AD pattern).
- `.soma/project.md` schema migration: NEW optional fields (`foundation_layers`, `expansion_layers`, `decisions`, `tech_stack`, `test_command`, `build_command`, `typecheck_command`, `lint_command`). Lenient — projects without fields skip foundation-check (D6).
- Module `.soma/modules/{slug}.md` front-matter NEW optional field `layer` (default `leaves`).
