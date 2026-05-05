# Contract: Tool Calls — soma module {add | promote | remove | deprecate} + doctor stale-hypothesis

**Contract ID:** CONTRACT-MODULE-CMDS-01
**spec_ref:** [SPEC:AC-01..AC-15]
**Created:** 2026-05-02
**Type:** internal tool / CLI command (4 subcommands of `soma module` + doctor extension)

---

## Tool Names

```
soma module add {keyword} [--with-snippet] [--soma-home <path>] [--json]
soma module promote {slug} [--soma-home <path>] [--json]
soma module remove {slug} [--yes|-y] [--soma-home <path>] [--json]
soma module deprecate {slug} [--soma-home <path>] [--json]
soma doctor [--soma-home <path>] [--json]   # extended w/ stale-hypothesis warnings (AC-08)
```

CLI entries: `node ~/.soma-v2/scripts/module.cjs {add|promote|remove|deprecate} ...` + `node ~/.soma-v2/scripts/doctor.cjs` (extended).

---

## Description

Cookbook commands para lifecycle de modules em `.soma/modules/`. `add` cria módulo em status `hypothesis` (D-C9 default). `promote` move hypothesis→active após human review. `remove` deleta. `deprecate` marca status `deprecated` preservando arquivo. `doctor` ganha warning quando module está em hypothesis há ≥90 dias (D-C9 stale-hypothesis pattern). Snippet JSON companion (Bruno C-1) é opt-in via `--with-snippet` em add (D3 lazy creation).

---

## Arguments

### `module add`
```json
{
  "{keyword}": { "type": "string", "required": true, "description": "human-readable module name; converted to slug per AC-11", "example": "auth-system" },
  "--with-snippet": { "type": "flag", "required": false, "description": "Also creates ~/.soma-v2/cookbook/snippets/{slug}.json skeleton (AC-09)" },
  "--soma-home": { "type": "path", "required": false, "description": "Override SOMA_HOME (defaults to env or ~/.soma-v2)" },
  "--json": { "type": "flag", "required": false, "description": "Structured JSON output" }
}
```

### `module promote` / `remove` / `deprecate`
```json
{
  "{slug}": { "type": "string", "required": true, "description": "kebab-case module slug from .soma/modules/{slug}.md", "example": "auth-system" },
  "--yes" / "-y": { "type": "flag", "required": false, "description": "(remove only) skip confirmation prompt for non-interactive use (D1)" },
  "--soma-home": { "type": "path", "required": false },
  "--json": { "type": "flag", "required": false }
}
```

**Slug derivation rules (AC-11):**
1. Lowercase
2. Replace non-alphanumeric chars with `-`
3. Collapse `--` runs
4. Trim leading/trailing `-`
5. Reject if empty after derivation OR matches reserved name (AC-12: `manifest`, `snapshots`, `evidence`, `modules`, `cookbook`, `config`)

---

## Output

### `module add` success
```json
{
  "schema": "soma-module-add/v1",
  "slug": "auth-system",
  "module_path": "/path/to/.soma/modules/auth-system.md",
  "snippet_path": null,
  "status": "hypothesis",
  "initialized_at": "2026-05-02T14:30:45Z",
  "error": null
}
```

### `module add --with-snippet` success
Same as above with `"snippet_path": "/path/to/cookbook/snippets/auth-system.json"`.

### `module promote` success
```json
{
  "schema": "soma-module-promote/v1",
  "slug": "auth-system",
  "from_status": "hypothesis",
  "to_status": "active",
  "promoted_at": "2026-05-02T14:30:45Z",
  "error": null
}
```

### `module remove` success
```json
{
  "schema": "soma-module-remove/v1",
  "slug": "auth-system",
  "deleted": ["/path/.soma/modules/auth-system.md", "/path/cookbook/snippets/auth-system.json"],
  "error": null
}
```

### `module deprecate` success
```json
{
  "schema": "soma-module-deprecate/v1",
  "slug": "auth-system",
  "from_status": "active",
  "to_status": "deprecated",
  "deprecated_at": "2026-05-02T14:30:45Z",
  "error": null
}
```

### `doctor` with stale-hypothesis findings (AC-08)
```json
{
  "schema": "soma-doctor/v1",
  "findings_count": 2,
  "findings": [
    { "severity": "warning", "code": "stale_hypothesis", "module": "auth-system", "age_days": 92, "initialized_at": "2026-02-01T10:00:00Z" },
    { "severity": "warning", "code": "stale_hypothesis", "module": "billing", "age_days": 105 }
  ],
  "error": null
}
```

**Error codes:**

| Code | When | Exit |
|---|---|---|
| `INVALID_ARGS` | missing required keyword/slug, malformed flags | 2 |
| `MODULE_EXISTS` | `add` w/ slug already present (AC-02) | 1 |
| `MODULE_NOT_FOUND` | `promote/remove/deprecate` with non-existent slug (AC-05) | 1 |
| `ALREADY_ACTIVE` | `promote` on already-active module (AC-04) | 1 |
| `RESERVED_SLUG` | derived slug matches reserved name (AC-12) | 1 |
| `INVALID_SLUG` | slug derivation produces empty result OR escapes `.soma/modules/` | 1 |
| `SCHEMA_INVALID` | `promote` finds front-matter with breaking manual edits (D4) | 1 |
| `MANIFEST_MISSING` | SOMA_HOME has no manifest.json | 2 |

---

## Side Effects

- `add`: creates `.soma/modules/{slug}.md` from `templates/project/.soma/modules/module.md.tmpl`. Optionally creates `cookbook/snippets/{slug}.json` skeleton (AC-09).
- `promote`: rewrites front-matter of `.soma/modules/{slug}.md` (status field + adds `promoted_at`, `last_verified`). Body preserved.
- `remove`: deletes `.soma/modules/{slug}.md` + `cookbook/snippets/{slug}.json` if exists. Confirmation prompt unless `--yes` (D1).
- `deprecate`: rewrites front-matter (status field + `deprecated_at`). File preserved on disk.
- `doctor` extension: adds findings to existing scan output (does not modify findings_count semantics; warnings additive).
- **Snippet creation** uses `~/.soma-v2/cookbook/snippets/` (NEW dir created on first add --with-snippet).

---

## Idempotency

- **`add`**: not idempotent — second call w/ same slug returns MODULE_EXISTS (AC-02)
- **`promote`**: not idempotent — second call returns ALREADY_ACTIVE (AC-04)
- **`remove`**: idempotent — re-run on already-removed slug exits 0 with warning "module not found" (no error since target state achieved)
- **`deprecate`**: not idempotent — second call returns "already deprecated" warning (similar to ALREADY_ACTIVE)
- **`doctor`**: read-only, fully idempotent (no thermal-guard impact)

---

## Contract Test Stub

```javascript
// @spec AC-01..AC-15
// @contract CONTRACT-MODULE-CMDS-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-module-')); }
function runMod(args, env = {}) {
  return spawnSync('node', ['scripts/module.cjs', ...args], {
    cwd: process.env.SOMA_HOME_REPO || `${os.homedir()}/.soma-v2`,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('AC-01: module add creates .soma/modules/{slug}.md from template', () => {
  const home = tmpHome();
  /* setup synthetic .soma/ via init.cjs */
  const r = runMod(['add', 'auth-system', '--soma-home', home, '--json']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'auth-system');
  assert.equal(out.status, 'hypothesis');
  assert.ok(fs.existsSync(out.module_path));
  const content = fs.readFileSync(out.module_path, 'utf8');
  assert.ok(content.includes('schema: soma-module/v1'));
  assert.ok(content.includes('status: hypothesis'));
});

test('AC-02: module add w/ existing slug returns MODULE_EXISTS', () => {
  /* setup: pre-create modules/auth-system.md, run add again */
});

test('AC-03+AC-04: promote hypothesis→active; second promote returns ALREADY_ACTIVE', () => {
  /* full lifecycle test */
});

test('AC-05: promote non-existent slug returns MODULE_NOT_FOUND', () => { /* ... */ });

test('AC-06: remove deletes module + snippet, prompt skipped w/ --yes', () => { /* ... */ });

test('AC-07: deprecate updates front-matter status, file preserved', () => { /* ... */ });

test('AC-08: doctor surfaces stale-hypothesis warning for modules ≥90d old', () => {
  /* setup: create module with initialized_at = 91 days ago, run doctor */
});

test('AC-09+AC-10: --with-snippet creates JSON skeleton; without flag, no JSON', () => { /* ... */ });

test('AC-11: slug derivation rules (lowercase, kebab, trim, collapse)', () => {
  /* table-driven: "Auth System" → "auth-system", "foo  bar!" → "foo-bar", etc. */
});

test('AC-12: reserved slugs rejected with RESERVED_SLUG', () => {
  for (const reserved of ['manifest', 'snapshots', 'evidence', 'modules', 'cookbook', 'config']) {
    const r = runMod(['add', reserved]);
    assert.equal(r.status, 1);
  }
});

test('AC-13: init --existing detected modules populate via module add (not direct write)', () => {
  /* integration test: simulate Phase 4a output, run module add for each detected, verify .soma/modules/ populated */
});

test('AC-14: module-cookbook.md preserved (449 bytes original) + appended Phase 4c section', () => {
  const orig = fs.readFileSync(`${process.env.HOME}/.soma-v2/docs/module-cookbook.md`, 'utf8');
  assert.ok(orig.includes('## Cookbook commands (Phase 4c)'));  // section appended
  assert.ok(orig.includes('Status:** stub-redirect'));  // original 449b preserved
});

test('AC-15: backward compat — 315/315 SOMA + 48/48 hooks + 6 shasums match', () => { /* regression test */ });

test('D4: promote with breaking manual edits in front-matter aborts SCHEMA_INVALID', () => { /* ... */ });
```

---

## Notes

- TDD HARD per Article II + C-2 enforcement: dispatch sets `SOMA_RED_PHASE_STRICT=1` env. RED commit MUST be separate from GREEN per `validateRedPhase` algorithm.
- Existing `~/.soma-v2/scripts/doctor.cjs` (Phase 2) is the extension target for AC-08. Other commands ship as new `scripts/module.cjs` + new helper `scripts/lib/module-store.cjs`.
- Module template at `~/.soma-v2/templates/project/.soma/modules/module.md.tmpl` (Phase 4a deliverable) is canonical source — `module add` instantiates it; do NOT inline new templates.
- `~/.soma-v2/docs/module-cookbook.md` (449 bytes stub-redirect) appended with section "## Cookbook commands (Phase 4c)" per D2; original 449 bytes preserved verbatim above the new section.
