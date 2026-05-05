# Contract: Tool Call — soma init

**Contract ID:** CONTRACT-INIT-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-08]
**Created:** 2026-05-01
**Type:** internal CLI tool (Node script invoked via `node ~/.soma-v2/scripts/init.cjs`)

---

## Tool Name

```
node ~/.soma-v2/scripts/init.cjs [path] [flags]
```

---

## Description

First write-mode CLI operation of the SOMA framework. Creates the `.soma/` directory structure in a target project from templates in `~/.soma-v2/templates/project/`, optionally injects an anchored bootloader block into the project's `AGENTS.md` (via `--with-agents-md` opt-in flag). Detects existing `.soma/` and redirects to `doctor`/`sync --dry-run` instead of mutating files (greenfield-only by design). Supports `--dry-run` preview mode that lists planned files without writing.

---

## Arguments

```json
{
  "path": {
    "type": "string",
    "required": false,
    "description": "Target project directory. Default: cwd. Created via mkdir -p if absent (parent must be writable).",
    "example": "/tmp/soma-sample-abc123"
  },
  "--with-agents-md": {
    "type": "boolean",
    "required": false,
    "description": "Opt-in: create or inject anchored bootloader block (id=project.AGENTS.bootloader) into $path/AGENTS.md. Default false.",
    "example": "--with-agents-md"
  },
  "--dry-run": {
    "type": "boolean",
    "required": false,
    "description": "Preview mode: list files that would be created without writing. Zero side effects.",
    "example": "--dry-run"
  },
  "--json": {
    "type": "boolean",
    "required": false,
    "description": "Emit machine-readable JSON to stdout instead of human summary",
    "example": "--json"
  },
  "--quiet": {
    "type": "boolean",
    "required": false,
    "description": "Suppress stdout in success cases. Errors still go to stderr.",
    "example": "--quiet"
  },
  "--verbose": {
    "type": "boolean",
    "required": false,
    "description": "Show per-file decision rationale (planned action, source template path, target path, content sha256)",
    "example": "--verbose"
  },
  "--soma-home": {
    "type": "string",
    "required": false,
    "description": "Override SOMA_HOME path (default ~/.soma-v2). Tests use to point at /tmp/ fixture.",
    "example": "/tmp/soma-test-abc/.soma-v2"
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `path` | string positional | no | must be valid filesystem path; resolves via `path.resolve`; rejected if escapes `$HOME` via `..` traversal beyond cwd |
| `--with-agents-md` | boolean flag | no | opt-in; default false (D2) |
| `--dry-run` | boolean flag | no | mutually compatible with `--with-agents-md`; previews but never writes |
| `--json` | boolean flag | no | mutually exclusive with `--quiet` (returns INVALID_ARGS) |
| `--quiet` | boolean flag | no | mutually exclusive with `--verbose` and `--json` |
| `--verbose` | boolean flag | no | mutually exclusive with `--quiet` |
| `--soma-home` | string | no | must be valid directory containing `templates/project/`; falls back to `$HOME/.soma-v2` |

---

## Output

**Success — greenfield create (`--json` flag):**
```json
{
  "tool": "init",
  "mode": "create",
  "soma_home": "${SOMA_HOME}",
  "target_path": "/tmp/soma-sample-abc123",
  "summary": {
    "files_created": 4,
    "agents_md_managed": false
  },
  "files_created": [
    "/tmp/soma-sample-abc123/.soma/project.md",
    "/tmp/soma-sample-abc123/.soma/CONTEXT.md",
    "/tmp/soma-sample-abc123/.soma/modules/index.md",
    "/tmp/soma-sample-abc123/.soma/installed-state.json"
  ]
}
```

**Success — `--with-agents-md` (`--json` flag):**
```json
{
  "tool": "init",
  "mode": "create",
  "soma_home": "${SOMA_HOME}",
  "target_path": "/tmp/soma-sample-abc123",
  "summary": {
    "files_created": 5,
    "agents_md_managed": true,
    "agents_md_action": "create"
  },
  "files_created": [
    "/tmp/soma-sample-abc123/.soma/project.md",
    "/tmp/soma-sample-abc123/.soma/CONTEXT.md",
    "/tmp/soma-sample-abc123/.soma/modules/index.md",
    "/tmp/soma-sample-abc123/.soma/installed-state.json",
    "/tmp/soma-sample-abc123/AGENTS.md"
  ]
}
```

(`agents_md_action` value: `"create"` if AGENTS.md was newly created, `"inject"` if pre-existing AGENTS.md had block injected.)

**Success — `--dry-run` (`--json` flag):**
```json
{
  "tool": "init",
  "mode": "dry-run",
  "soma_home": "${SOMA_HOME}",
  "target_path": "/tmp/soma-sample-abc123",
  "summary": {
    "files_planned": 4,
    "agents_md_managed": false
  },
  "files_planned": [
    "/tmp/soma-sample-abc123/.soma/project.md",
    "/tmp/soma-sample-abc123/.soma/CONTEXT.md",
    "/tmp/soma-sample-abc123/.soma/modules/index.md",
    "/tmp/soma-sample-abc123/.soma/installed-state.json"
  ]
}
```

**Redirect — already initialized (`--json` flag):**
```json
{
  "tool": "init",
  "mode": "redirect",
  "soma_home": "${SOMA_HOME}",
  "target_path": "/tmp/soma-sample-abc123",
  "error": "ALREADY_INITIALIZED",
  "message": "project already initialized at /tmp/soma-sample-abc123; run `node ~/.soma-v2/scripts/doctor.cjs --soma-home /tmp/soma-sample-abc123/.soma` to check health, or `node ~/.soma-v2/scripts/sync.cjs --dry-run --soma-home /tmp/soma-sample-abc123/.soma` to preview drift",
  "suggested_commands": [
    "node ~/.soma-v2/scripts/doctor.cjs --soma-home /tmp/soma-sample-abc123/.soma",
    "node ~/.soma-v2/scripts/sync.cjs --dry-run --soma-home /tmp/soma-sample-abc123/.soma"
  ]
}
```

**Success (default human output):**
```
SOMA init — /tmp/soma-sample-abc123

CREATED  .soma/project.md
CREATED  .soma/CONTEXT.md
CREATED  .soma/modules/index.md
CREATED  .soma/installed-state.json
CREATED  AGENTS.md (with anchored bootloader)

5 files created. Project ready.

Next: `cd /tmp/soma-sample-abc123 && node ~/.soma-v2/scripts/doctor.cjs --soma-home .soma`
```

**Redirect (default human output):**
```
SOMA init — /tmp/soma-sample-abc123

REDIRECT  project already initialized.

Run one of:
  node ~/.soma-v2/scripts/doctor.cjs --soma-home /tmp/soma-sample-abc123/.soma
  node ~/.soma-v2/scripts/sync.cjs --dry-run --soma-home /tmp/soma-sample-abc123/.soma
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
| `ALREADY_INITIALIZED` | Target path already contains `.soma/` directory (exit 1, not error 2 — semantic redirect) |
| `TARGET_PATH_INVALID` | Path escapes `$HOME` via `..`, or parent directory not writable |
| `TEMPLATE_MISSING` | A template file expected in `$SOMA_HOME/templates/project/` is missing |
| `TEMPLATE_PARSE_ERROR` | Template content cannot be processed (placeholder substitution failed) |
| `AGENTS_MD_PARSE_ERROR` | Existing `AGENTS.md` contains malformed anchored markers preventing safe injection |
| `INVALID_ARGS` | Conflicting flags (e.g., `--json --quiet`, `--verbose --quiet`) |
| `IO_ERROR` | Filesystem write failure (permission, disk full, etc.) |

---

## Side Effects

**Default mode (no `--dry-run`):**
- Creates `$path/.soma/` directory
- Writes `$path/.soma/project.md` (from template, placeholders substituted)
- Writes `$path/.soma/CONTEXT.md` (from template)
- Writes `$path/.soma/modules/index.md` (from template)
- Writes `$path/.soma/installed-state.json` (schema soma-installed-state/v1)
- If `--with-agents-md`: creates or modifies `$path/AGENTS.md` (anchored block injected; content outside block preserved byte-for-byte)
- thermal-guard: counts as 1 write-mode operation per invocation (no compilation, no test spawning)

**`--dry-run` mode:**
- **None.** Zero filesystem writes. Verified via shasum pre/post run on any pre-existing files in `$path` (per [SPEC:AC-06]).

**Redirect mode (already initialized):**
- **None.** Zero modification to `.soma/` or `AGENTS.md`. Verified via shasum pre/post (per [SPEC:AC-02]).

---

## Idempotency

- **Idempotent:** **conditional**.
  - Greenfield → write-mode (NOT idempotent in classical sense; first call creates files, second call detects existing and redirects).
  - Re-run on already-initialized project → idempotent observable (same exit code 1, same redirect message, zero state change).
  - `--dry-run` mode → idempotent (always read-only, deterministic output).
- **If called twice greenfield:** first call creates `.soma/` (exit 0), second call detects existing `.soma/` and returns redirect (exit 1) with no state mutation.
- **If called twice with `--dry-run`:** identical output, identical exit code (no side effects either run).

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | success — greenfield create completed (or `--dry-run` preview emitted with no errors) |
| `1` | redirect — target path already initialized (`.soma/` exists); semantic non-error indicating "use sync, not init" |
| `2` | hard error — invalid args, template missing, IO failure, AGENTS.md parse error, target path invalid |

---

## Contract Test Stub

```javascript
// @spec AC-01,02,03,04,05,06,07,08
// @contract CONTRACT-INIT-01
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function mkFixture(prefix = 'soma-init-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('init: --json output schema matches contract (greenfield)', () => {
  const target = mkFixture();
  const out = execFileSync('node', ['scripts/init.cjs', target, '--json'], { encoding: 'utf8', cwd: process.env.HOME + '/.soma-v2' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.mode, 'create');
  assert.equal(parsed.target_path, target);
  assert.equal(parsed.summary.files_created, 4);
  assert.equal(parsed.summary.agents_md_managed, false);
  assert.ok(Array.isArray(parsed.files_created));
  assert.equal(parsed.files_created.length, 4);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init: --with-agents-md schema (greenfield, no pre-existing AGENTS.md)', () => {
  const target = mkFixture();
  const out = execFileSync('node', ['scripts/init.cjs', target, '--with-agents-md', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.agents_md_managed, true);
  assert.equal(parsed.summary.agents_md_action, 'create');
  assert.equal(parsed.files_created.length, 5);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init: detects existing .soma/ and redirects (exit 1)', () => {
  const target = mkFixture();
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let exitCode = 0;
  try {
    execFileSync('node', ['scripts/init.cjs', target, '--json'], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status;
    const parsed = JSON.parse(e.stdout);
    assert.equal(parsed.mode, 'redirect');
    assert.equal(parsed.error, 'ALREADY_INITIALIZED');
    assert.ok(parsed.message.includes('doctor'));
    assert.ok(parsed.message.includes('sync'));
    assert.ok(Array.isArray(parsed.suggested_commands));
  }
  assert.equal(exitCode, 1);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init: --dry-run zero side effects', () => {
  const target = mkFixture();
  const before = fs.readdirSync(target);
  execFileSync('node', ['scripts/init.cjs', target, '--dry-run', '--json'], { encoding: 'utf8' });
  const after = fs.readdirSync(target);
  assert.deepEqual(before, after);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init: --json + --quiet returns INVALID_ARGS', () => {
  const target = mkFixture();
  let exitCode = 0;
  try {
    execFileSync('node', ['scripts/init.cjs', target, '--json', '--quiet'], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status;
    assert.ok((e.stderr || e.stdout).includes('INVALID_ARGS'));
  }
  assert.equal(exitCode, 2);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init: exit code 0 on greenfield success', () => {
  const target = mkFixture();
  let exitCode = 0;
  try { execFileSync('node', ['scripts/init.cjs', target, '--quiet'], { encoding: 'utf8' }); }
  catch (e) { exitCode = e.status; }
  assert.equal(exitCode, 0);
  fs.rmSync(target, { recursive: true, force: true });
});
```

---

## Notes for implementation

- **Template loading:** read templates from `$SOMA_HOME/templates/project/` per invocation (not bundled). Support `--soma-home` override pra fixtures.
- **Placeholder engine:** simple regex-based substitution (`{{PROJECT_NAME}}` → `path.basename(target_path)`, `{{ISO8601_DATE}}` → `new Date().toISOString()`). No Mustache/Handlebars — keep stdlib.
- **AGENTS.md injection algorithm:**
  1. If `--with-agents-md` not set → skip step entirely.
  2. If `$path/AGENTS.md` doesn't exist → render template `templates/project/AGENTS.md.tmpl`, substitute placeholders, compute sha256 of inline block content (between `<!-- soma-v2:start -->` and `<!-- soma-v2:end -->`), write file with sha256 attribute filled.
  3. If `$path/AGENTS.md` exists:
     - Parse via `lib/anchored-blocks.cjs` to detect any existing `project.AGENTS.bootloader` block.
     - If block exists → error `AGENTS_MD_PARSE_ERROR` with message "AGENTS.md already has bootloader block but .soma/ doesn't exist; manual cleanup required".
     - If no block → render template fragment (just the block markers + body), append to file separated by single blank line, compute sha256 of inline content, fill attribute.
- **`installed-state.json` schema (soma-installed-state/v1):**
  ```json
  {
    "schema": "soma-installed-state/v1",
    "soma_version": "2.1.0-draft",
    "initialized_at": "2026-05-01T12:34:56.789Z",
    "last_init": "2026-05-01T12:34:56.789Z",
    "agents_md_managed": false
  }
  ```
- **Path resolution:** `path.resolve(target)` then validate that result doesn't escape via `..` outside `process.env.HOME` parent — reject with `TARGET_PATH_INVALID` if it does (security NFR).
