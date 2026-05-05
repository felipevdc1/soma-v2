# Contract: Tool Call — soma init --existing

**Contract ID:** CONTRACT-INIT-EXISTING-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09] [SPEC:AC-10] [SPEC:AC-11] [SPEC:AC-12]
**Created:** 2026-05-01
**Type:** internal CLI tool (Node script invoked via `node ~/.soma-v2/scripts/init.cjs --existing`)

---

## Tool Name

```
node ~/.soma-v2/scripts/init.cjs --existing [path] [flags]
```

---

## Description

Module-inference branch of the SOMA init CLI. Detects modules in a pre-existing project via filesystem scanning (H2 default) or git-history-ranked filesystem scanning (`--deep` H1 mode), then materializes `.soma/` directory structure with one stub `.soma/modules/{name}.md` per detected module (status `hypothesis`, source_confidence `low`). Distinct from the greenfield `init` (Phase 3 D3 lock): `--existing` does NOT inject AGENTS.md bootloader (`--with-agents-md` flag is NOT supported in this branch). Detects existing `.soma/` and redirects to `doctor`/`sync --dry-run` matching Phase 3 idempotence pattern (D1 lock).

---

## Arguments

```json
{
  "--existing": {
    "type": "boolean",
    "required": true,
    "description": "Mandatory flag to invoke this branch. Without it, init.cjs runs greenfield (Phase 3) behavior.",
    "example": "--existing"
  },
  "path": {
    "type": "string",
    "required": false,
    "description": "Target project directory (must already exist with source code). Default: cwd. NOT created — must be a real existing project.",
    "example": "${HOME}/Documents/projetos claude code/[project F]"
  },
  "--deep": {
    "type": "boolean",
    "required": false,
    "description": "Opt-in: rank H2 results by git commit count in last 90 days; only modules with ≥1 commit in window are emitted. Hardcoded 90d (NC-2 lock). Falls back automatically to H2 with warning if .git/ absent.",
    "example": "--deep"
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
    "description": "Show per-module detection rationale (heuristic that matched, files inspected, commit count when --deep)",
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
| `--existing` | boolean flag | yes | mandatory; absent invokes Phase 3 greenfield branch (separate contract CONTRACT-INIT-01) |
| `path` | string positional | no | must be valid filesystem path; resolves via `path.resolve`; rejected if escapes `$HOME` via `..` traversal beyond cwd; MUST exist (rejected with `TARGET_PATH_NOT_FOUND` if missing) |
| `--deep` | boolean flag | no | independent of other flags; warns + fallback when `.git/` absent (exit 0, NOT exit 1 per AC-06) |
| `--json` | boolean flag | no | mutually exclusive with `--quiet` (returns INVALID_ARGS) |
| `--quiet` | boolean flag | no | mutually exclusive with `--verbose` and `--json` |
| `--verbose` | boolean flag | no | mutually exclusive with `--quiet` |
| `--soma-home` | string | no | must be valid directory containing `templates/project/.soma/modules/module.md.tmpl`; falls back to `$HOME/.soma-v2` |
| `--with-agents-md` | NOT SUPPORTED | n/a | rejected with `INVALID_ARGS` if combined with `--existing` (per spec Out-of-Scope) |

---

## Output

**Success — modules detected (H2 default, `--json` flag):**
```json
{
  "tool": "init",
  "branch": "existing",
  "mode": "create",
  "soma_home": "${SOMA_HOME}",
  "target_path": "${HOME}/Documents/projetos claude code/[project F]",
  "heuristic": "H2",
  "summary": {
    "modules_detected": 5,
    "modules_emitted": 5,
    "files_created": 9
  },
  "modules": [
    { "name": "app", "files_count": 23, "source_path": "src/app/", "source_confidence": "low" },
    { "name": "components", "files_count": 47, "source_path": "src/components/", "source_confidence": "low" },
    { "name": "lib", "files_count": 12, "source_path": "src/lib/", "source_confidence": "low" },
    { "name": "scripts", "files_count": 4, "source_path": "scripts/", "source_confidence": "low" },
    { "name": "config", "files_count": 3, "source_path": "config/", "source_confidence": "low" }
  ],
  "files_created": [
    "/.../.soma/project.md",
    "/.../.soma/CONTEXT.md",
    "/.../.soma/manifest.json",
    "/.../.soma/modules/index.md",
    "/.../.soma/modules/app.md",
    "/.../.soma/modules/components.md",
    "/.../.soma/modules/lib.md",
    "/.../.soma/modules/scripts.md",
    "/.../.soma/modules/config.md"
  ]
}
```

**Success — `--deep` mode (`--json` flag):**
```json
{
  "tool": "init",
  "branch": "existing",
  "mode": "create",
  "heuristic": "H1",
  "deep_window_days": 90,
  "git_repo_detected": true,
  "summary": {
    "modules_detected": 5,
    "modules_emitted": 3,
    "modules_filtered_out_no_commits": 2,
    "files_created": 7
  },
  "modules": [
    { "name": "app", "files_count": 23, "source_path": "src/app/", "commit_count_90d": 47, "source_confidence": "low" },
    { "name": "components", "files_count": 47, "source_path": "src/components/", "commit_count_90d": 12, "source_confidence": "low" },
    { "name": "lib", "files_count": 12, "source_path": "src/lib/", "commit_count_90d": 3, "source_confidence": "low" }
  ],
  "modules_filtered_out": [
    { "name": "scripts", "reason": "0 commits in 90d window" },
    { "name": "config", "reason": "0 commits in 90d window" }
  ]
}
```

**Success — `--deep` fallback (no .git/, `--json` flag, AC-06):**
```json
{
  "tool": "init",
  "branch": "existing",
  "mode": "create",
  "heuristic": "H2",
  "deep_requested": true,
  "git_repo_detected": false,
  "warnings": [
    "no git history available, falling back to filesystem heuristic"
  ],
  "summary": {
    "modules_detected": 5,
    "modules_emitted": 5,
    "files_created": 9
  },
  "modules": [
    /* same shape as H2 default */
  ]
}
```

**Success — empty/no-source repo (AC-10):**
```json
{
  "tool": "init",
  "branch": "existing",
  "mode": "create",
  "heuristic": "H2",
  "summary": {
    "modules_detected": 0,
    "modules_emitted": 0,
    "files_created": 4
  },
  "modules": [],
  "message": "no modules inferred",
  "files_created": [
    "/.../.soma/project.md",
    "/.../.soma/CONTEXT.md",
    "/.../.soma/manifest.json",
    "/.../.soma/modules/index.md"
  ]
}
```

**Redirect — already initialized (`--json` flag, AC-07):**
```json
{
  "tool": "init",
  "branch": "existing",
  "mode": "redirect",
  "target_path": "/.../some-project",
  "error": "ALREADY_INITIALIZED",
  "message": "project already initialized at /.../some-project; run `node ~/.soma-v2/scripts/doctor.cjs --soma-home .../.soma` to check health, or `node ~/.soma-v2/scripts/sync.cjs --dry-run --soma-home .../.soma` to preview drift",
  "suggested_commands": [
    "node ~/.soma-v2/scripts/doctor.cjs --soma-home /.../some-project/.soma",
    "node ~/.soma-v2/scripts/sync.cjs --dry-run --soma-home /.../some-project/.soma"
  ]
}
```

**Success (default human output):**
```
SOMA init --existing — /.../dashboard-escala-independente

Heuristic: H2 (filesystem)
5 modules detected, 5 emitted

CREATED  .soma/project.md
CREATED  .soma/CONTEXT.md
CREATED  .soma/manifest.json
CREATED  .soma/modules/index.md
CREATED  .soma/modules/app.md           (23 files in src/app/)
CREATED  .soma/modules/components.md    (47 files in src/components/)
CREATED  .soma/modules/lib.md           (12 files in src/lib/)
CREATED  .soma/modules/scripts.md       (4 files in scripts/)
CREATED  .soma/modules/config.md        (3 files in config/)

9 files created. All modules status=hypothesis (per D-C9 — promote via human review).

Next: review .soma/modules/{name}.md docs and `soma module promote {name}` for verified ones.
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
| `ALREADY_INITIALIZED` | Target path already contains `.soma/` directory (exit 1, semantic redirect not error) |
| `TARGET_PATH_INVALID` | Path escapes `$HOME` via `..`, or is unreadable |
| `TARGET_PATH_NOT_FOUND` | Path doesn't exist (init --existing requires real project, doesn't auto-create) |
| `TEMPLATE_MISSING` | `templates/project/.soma/modules/module.md.tmpl` missing in `$SOMA_HOME` |
| `TEMPLATE_PARSE_ERROR` | Template content cannot be processed (placeholder substitution failed) |
| `INVALID_ARGS` | Conflicting flags (e.g., `--json --quiet`, `--with-agents-md` combined with `--existing`) |
| `IO_ERROR` | Filesystem write failure (permission, disk full, etc.) |

---

## Side Effects

**Default mode (no `--dry-run` exists for `--existing` in Phase 4a — out of scope per spec):**
- Creates `$path/.soma/` directory
- Writes `$path/.soma/project.md` (from `templates/project/.soma/project.md.tmpl`, placeholders substituted including `{{PROJECT_NAME}}` from `path.basename(target_path)`)
- Writes `$path/.soma/CONTEXT.md` (from template)
- Writes `$path/.soma/manifest.json` (minimal `{schema:"soma-manifest/v1", files:[]}` — matching Phase 3 D6 algorithm; populated by future sync runs)
- Writes `$path/.soma/modules/index.md` (lists detected modules; empty list if AC-10)
- Writes one `$path/.soma/modules/{name}.md` per detected module (instantiated from `templates/project/.soma/modules/module.md.tmpl`, fields: `schema=soma-module/v1`, `status=hypothesis`, `source_confidence=low`, `owners=[]`, `last_verified=null`, `verification.command=null`, `verification.files_checked=[detected paths]`)
- Read-only access to `$path/**` (no execution of project commands, no install of deps) per spec Security NFR
- Read-only access to `$path/.git/` if present and `--deep` flag set
- thermal-guard: counts as 1 write-mode operation per invocation (no compilation, no test spawning)

**Redirect mode (already initialized):**
- **None.** Zero modification to `$path/.soma/` or any other path. Verified via shasum pre/post (per [SPEC:AC-07] + AC-08 Phase 2/3 libs untouched).

---

## Idempotency

- **Idempotent:** **conditional**.
  - Pre-existing project without `.soma/` → write-mode (NOT idempotent in classical sense; first call creates files, second call detects existing and redirects).
  - Re-run on already-initialized project → idempotent observable (same exit code 1, same redirect message, zero state change).
- **If called twice:** first call creates `.soma/` (exit 0), second call detects existing `.soma/` and returns redirect (exit 1) with no state mutation. Verified via shasum pre/post on second call.
- **Phase 4a deliberate omission**: no `--dry-run` mode for `--existing` (spec Out-of-Scope). Future Phase 4b sync write-mode covers preview-before-write pattern.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | success — modules detected and `.soma/` materialized (or AC-10 empty case with empty `.soma/modules/index.md`) |
| `1` | redirect — target path already initialized (`.soma/` exists); semantic non-error indicating "use sync, not init --existing" |
| `2` | hard error — invalid args, target path not found, template missing, IO failure, target path invalid |

---

## Contract Test Stub

```javascript
// @spec AC-01,02,03,04,05,06,07,08,09,10,11,12
// @contract CONTRACT-INIT-EXISTING-01
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function mkProject(prefix = 'soma-init-existing-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('init --existing: H2 detects src/ subdirs as modules (AC-01)', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/button.tsx');
  makeFile(target, 'src/lib/utils.ts');
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], {
    encoding: 'utf8',
    cwd: process.env.HOME + '/.soma-v2'
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.branch, 'existing');
  assert.equal(parsed.heuristic, 'H2');
  assert.equal(parsed.summary.modules_detected, 3);
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['app', 'components', 'lib']);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: detects package.json workspaces (AC-02)', () => {
  const target = mkProject();
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'monorepo-test',
    workspaces: ['packages/foo', 'packages/bar']
  }));
  makeFile(target, 'packages/foo/index.ts');
  makeFile(target, 'packages/bar/index.ts');
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.ok(names.includes('foo'));
  assert.ok(names.includes('bar'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: framework dirs detected when no src/ (AC-03)', () => {
  const target = mkProject();
  makeFile(target, 'app/page.tsx');
  makeFile(target, 'components/button.tsx');
  makeFile(target, 'lib/utils.ts');
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['app', 'components', 'lib']);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: src/-first when src/ AND framework dirs coexist (AC-03 + NC-1)', () => {
  const target = mkProject();
  // src/ exists with subdirs
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/btn.tsx');
  // framework dirs at root ALSO exist
  makeFile(target, 'app/legacy.tsx');
  makeFile(target, 'pages/index.tsx');
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  // src/-first: only src/ subdirs detected, NOT root app/ or pages/
  assert.deepEqual(names, ['app', 'components']);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: emitted module file has correct schema fields (AC-04)', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const moduleFile = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(moduleFile.includes('schema: soma-module/v1'));
  assert.ok(moduleFile.includes('status: hypothesis'));
  assert.ok(moduleFile.includes('source_confidence: low'));
  assert.ok(moduleFile.includes('owners: []'));
  assert.ok(moduleFile.includes('last_verified: null'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing --deep: ranks by git commit count (AC-05)', () => {
  const target = mkProject();
  makeFile(target, 'src/active/code.ts');
  makeFile(target, 'src/dormant/old.ts');
  execSync('git init && git add . && git -c user.email=test@t.com -c user.name=T commit -m initial', { cwd: target });
  // Touch active/ multiple times
  for (let i = 0; i < 5; i++) {
    makeFile(target, 'src/active/code.ts', `// v${i}\n`);
    execSync(`git add . && git -c user.email=test@t.com -c user.name=T commit -m "v${i}"`, { cwd: target });
  }
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--deep', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H1');
  const names = parsed.modules.map(m => m.name);
  assert.ok(names.includes('active'));
  // dormant only had initial commit, but that's ≥1 in 90d window — both should appear
  assert.ok(names.includes('dormant'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing --deep: fallback to H2 when no .git/ (AC-06)', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--deep', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H2');
  assert.equal(parsed.git_repo_detected, false);
  assert.ok(parsed.warnings.some(w => w.includes('no git history')));
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: detects existing .soma/ and redirects (exit 1) (AC-07)', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let exitCode = 0;
  try {
    execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status;
    const parsed = JSON.parse(e.stdout);
    assert.equal(parsed.mode, 'redirect');
    assert.equal(parsed.error, 'ALREADY_INITIALIZED');
  }
  assert.equal(exitCode, 1);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: zero modification of Phase 2/3 libs (AC-08)', () => {
  const libs = ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs'];
  const before = libs.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.HOME, '.soma-v2/scripts/lib', f))).digest('hex'));
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const after = libs.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.HOME, '.soma-v2/scripts/lib', f))).digest('hex'));
  assert.deepEqual(after, before);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: empty repo emits "no modules inferred" (AC-10)', () => {
  const target = mkProject();
  // No source files
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.modules_detected, 0);
  assert.equal(parsed.message, 'no modules inferred');
  // .soma/modules/index.md must still exist
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/index.md')));
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: ≥1 file threshold (single-file modules valid) (AC-11)', () => {
  const target = mkProject();
  makeFile(target, 'src/app/single.ts');  // exactly 1 file
  const out = execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.modules_detected, 1);
  assert.equal(parsed.modules[0].name, 'app');
  assert.equal(parsed.modules[0].files_count, 1);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: schema validation has zero Claude-specific primitives (AC-12)', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json'], { encoding: 'utf8' });
  const projectMd = fs.readFileSync(path.join(target, '.soma/project.md'), 'utf8');
  const moduleMd = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  const claudeSpecificPatterns = [
    /\/specify\b/, /\/plan-sdd\b/, /\/sonar-audit\b/, /\/soma-run\b/,
    /thermal-guard\.cjs/, /spec-completeness-gate\.cjs/, /skill_id:/i, /hook_id:/i
  ];
  for (const pattern of claudeSpecificPatterns) {
    assert.ok(!pattern.test(projectMd), `project.md contains Claude-specific primitive: ${pattern}`);
    assert.ok(!pattern.test(moduleMd), `module.md contains Claude-specific primitive: ${pattern}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing: --json + --quiet returns INVALID_ARGS', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  let exitCode = 0;
  try {
    execFileSync('node', ['scripts/init.cjs', '--existing', target, '--json', '--quiet'], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status;
    assert.ok((e.stderr || e.stdout).includes('INVALID_ARGS'));
  }
  assert.equal(exitCode, 2);
  fs.rmSync(target, { recursive: true, force: true });
});

test('init --existing + --with-agents-md: rejected as INVALID_ARGS', () => {
  const target = mkProject();
  makeFile(target, 'src/app/page.tsx');
  let exitCode = 0;
  try {
    execFileSync('node', ['scripts/init.cjs', '--existing', target, '--with-agents-md', '--json'], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status;
    assert.ok((e.stderr || e.stdout).includes('INVALID_ARGS'));
  }
  assert.equal(exitCode, 2);
  fs.rmSync(target, { recursive: true, force: true });
});
```

---

## Notes for implementation

- **Heuristic ordering**: when path has `src/` directory, H2 ONLY scans `src/*` subdirs (src/-first per NC-1). When path has no `src/` but has `package.json#workspaces`, H2 scans workspace paths. When neither, H2 scans root framework dirs (`app/`, `pages/`, `components/`, `lib/`, `api/`). These are mutually exclusive within a single invocation.
- **Blacklist (RESOLVED via D-C10+Q2)**: respect `.gitignore` of target project + hardcoded blacklist `['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache']`. Module candidate matching blacklist is silently filtered out.
- **`--deep` window**: hardcoded 90 days (NC-2). Compute via `git log --since="90 days ago" --pretty=format:"%H" -- {module_path}` per detected candidate. Count = number of resulting hashes. Filter `count >= 1` to emit.
- **Module name resolution**: `name = path.basename(detected_path)`. Collision detected (e.g., `lib/` in both src/ and root) → both emitted with path-based naming (`src-lib`, `root-lib`) per spec Out-of-Scope rule.
- **Template loading**: read `templates/project/.soma/modules/module.md.tmpl` from `$SOMA_HOME` per invocation. Falls back to `$HOME/.soma-v2`.
- **Manifest minimal**: `.soma/manifest.json = {schema:"soma-manifest/v1", files:[]}` (Phase 3 D6 algorithm; populated by sync). NOT manifest of detected modules — modules are tracked via `.soma/modules/index.md`.
- **AC-09 fixture suite**: `tests/fixtures/init-existing/` contains 3 synthetic projects (`framework-heavy/` Next.js shape, `cli-library/` flat src/, `monorepo/` workspaces). Each has companion `expected-modules.json` with ground-truth list. Test computes `hit_rate = |detected ∩ expected| / |expected|` and asserts `>= 0.6`.
- **Path resolution**: `path.resolve(target)` then validate that result doesn't escape via `..` outside `process.env.HOME` parent — reject with `TARGET_PATH_INVALID` if it does (security NFR).
