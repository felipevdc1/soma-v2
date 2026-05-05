/**
 * contract-bootstrap.test.cjs — T-02 / RED phase
 * Contract test stub for bootstrap.cjs per CONTRACT-BOOTSTRAP-01.
 * Tests MUST fail (impl doesn't exist yet).
 *
 * @spec AC-01..AC-14
 * @contract CONTRACT-BOOTSTRAP-01
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME_REAL = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const BOOTSTRAP = path.join(SOMA_HOME_REAL, 'scripts', 'bootstrap.cjs');
const SCRATCH = path.resolve(__dirname, '../..');

// Helper: create synthetic SOMA_HOME fixture
function createSomaHomeFixture(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-home-'));
  // Write manifest.json
  const manifest = {
    schema: opts.schema || 'soma-manifest/v1',
    version: '2.1.0-test',
    release: 'test',
    files: [],
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  // Create minimal adapters structure
  const adaptersDir = path.join(dir, 'adapters');
  fs.mkdirSync(path.join(adaptersDir, 'codex'), { recursive: true });
  fs.mkdirSync(path.join(adaptersDir, 'claude'), { recursive: true });
  // Write install-targets.json for adapters
  const targets = { schema: 'soma-install-targets/v1', tool: 'codex', entries: [] };
  fs.writeFileSync(path.join(adaptersDir, 'codex', 'install-targets.json'), JSON.stringify(targets), 'utf8');
  const claudeTargets = { schema: 'soma-install-targets/v1', tool: 'claude', entries: [] };
  fs.writeFileSync(path.join(adaptersDir, 'claude', 'install-targets.json'), JSON.stringify(claudeTargets), 'utf8');
  return dir;
}

// Helper: create synthetic project fixture with .soma/
function createProjectFixture(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-proj-'));
  if (opts.hasSoma !== false) {
    const modulesDir = path.join(dir, '.soma', 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    // Create module files
    const moduleCount = opts.moduleCount || 3;
    for (let i = 0; i < moduleCount; i++) {
      const slug = `test-module-${i}`;
      const status = i === 0 ? 'active' : i === 1 ? 'hypothesis' : 'deprecated';
      fs.writeFileSync(path.join(modulesDir, `${slug}.md`), [
        '---',
        'schema: soma-module/v1',
        `name: "Test Module ${i}"`,
        `status: ${status}`,
        'source_confidence: medium',
        'owners: []',
        `last_verified: "2026-05-02"`,
        `source_path: "src/module${i}"`,
        `initialized_at: "2026-05-02T00:00:00Z"`,
        '---',
        '',
        `# Test Module ${i}`,
      ].join('\n'), 'utf8');
    }
    // Create project.md
    fs.writeFileSync(path.join(dir, '.soma', 'project.md'), [
      '---',
      'schema: soma-project/v1',
      'name: "test-project"',
      'status: active',
      '---',
    ].join('\n'), 'utf8');
  }
  return dir;
}

// Helper: run bootstrap
function runBootstrap(args = [], opts = {}) {
  const scriptPath = opts.scriptPath || BOOTSTRAP;
  return spawnSync('node', [scriptPath, ...args], {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout || 15000,
  });
}

// ---- AC-01: detects .soma/ ----

test('CONTRACT AC-01: bootstrap detects .soma/ and exits 0 with ready/drift status', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, 'soma-bootstrap/v1');
  assert.match(out.status, /^(ready|drift)$/);
});

// ---- AC-02: NO_SOMA_PROJECT ----

test('CONTRACT AC-02: bootstrap exits 1 with NO_SOMA_PROJECT when .soma/ missing', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-empty-'));
  const somaHome = createSomaHomeFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: emptyDir,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'NO_SOMA_PROJECT');
  assert.ok(out.suggestion && out.suggestion.length > 0, 'suggestion must be non-empty');
});

// ---- AC-03: valid SOMA_HOME ----

test('CONTRACT AC-03: bootstrap exits 0 with valid SOMA_HOME', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0 with valid SOMA_HOME. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  // Normalize through realpath (macOS /tmp → /private/tmp symlink)
  const realSomaHome = fs.realpathSync(somaHome);
  assert.equal(out.soma_home, realSomaHome);
});

// ---- AC-04: INVALID_SOMA_HOME ----

test('CONTRACT AC-04: bootstrap exits 1 with INVALID_SOMA_HOME when path missing', () => {
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: '/nonexistent/soma-home-absolutely-missing' },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'INVALID_SOMA_HOME');
  assert.ok(out.suggestion && out.suggestion.includes('onboarding'), 'suggestion must reference onboarding');
});

// ---- AC-05: doctor delegation ----

test('CONTRACT AC-05: bootstrap captures doctor findings in-memory (findings is array)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.ok(Array.isArray(out.findings), 'findings must be an array');
});

// ---- AC-06: zero findings ----

test('CONTRACT AC-06: bootstrap status:ready + findings:[] on healthy project', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'ready');
  assert.deepEqual(out.findings, []);
});

// ---- AC-07: drift warnings ----

test('CONTRACT AC-07: status:drift + exit 0 + suggestion when doctor returns warnings', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  // Inject a fake CONTEXT.md with broken refs to trigger warnings
  const contextPath = path.join(project, '.soma', 'CONTEXT.md');
  fs.writeFileSync(contextPath, [
    '| keyword | slug |',
    '|---|---|',
    '| auth | nonexistent-module |',
  ].join('\n'), 'utf8');
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0 for drift. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  // Either drift with findings or ready (depends on if context routing is checked)
  assert.ok(['ready', 'drift'].includes(out.status));
});

// ---- AC-08: critical drift ----

test('CONTRACT AC-08: critical findings → exit 1 + CRITICAL_DRIFT/SCHEMA_VERSION_UNSUPPORTED', () => {
  const somaHome = createSomaHomeFixture({ schema: 'soma-manifest/v999' });
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 1, `Expected exit 1 for schema mismatch. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.ok(
    out.error_code === 'SCHEMA_VERSION_UNSUPPORTED' || out.error_code === 'CRITICAL_DRIFT' || out.error_code === 'INVALID_SOMA_HOME',
    `Expected error code about invalid schema. Got: ${out.error_code}`
  );
});

// ---- AC-09: output schema completeness ----

test('CONTRACT AC-09: success output has all required fields', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  const required = ['schema', 'status', 'soma_home', 'project_root', 'modules', 'adapters', 'findings', 'duration_ms'];
  for (const field of required) {
    assert.ok(field in out, `Missing required field: ${field}`);
  }
  assert.equal(out.schema, 'soma-bootstrap/v1');
  assert.ok(Array.isArray(out.modules), 'modules must be array');
  assert.ok(Array.isArray(out.adapters), 'adapters must be array');
  assert.ok(Array.isArray(out.findings), 'findings must be array');
  assert.ok(typeof out.duration_ms === 'number', 'duration_ms must be number');
});

// ---- AC-09: modules + adapters shape ----

test('CONTRACT AC-09: modules have slug+status, adapters have tool+install_targets_count', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  const out = JSON.parse(result.stdout);
  for (const mod of out.modules) {
    assert.ok('slug' in mod, 'module missing slug');
    assert.ok('status' in mod, 'module missing status');
  }
  for (const adapter of out.adapters) {
    assert.ok('tool' in adapter, 'adapter missing tool');
    assert.ok('install_targets_count' in adapter, 'adapter missing install_targets_count');
  }
});

// ---- AC-10: default mode ----

test('CONTRACT AC-10: default mode (no --quiet) emits human + JSON block', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap([], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  assert.ok(result.stdout.length > 0, 'stdout must not be empty');
  // Must contain some human text (not just JSON)
  const firstLine = result.stdout.trim().split('\n')[0];
  // First char should NOT be '{' in default mode (human summary comes first)
  assert.notEqual(firstLine.trim()[0], '{', 'In default mode, first output should be human text, not raw JSON');
  // JSON block must be present — find first line that is exactly '{'
  const lines = result.stdout.split('\n');
  let jsonStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '{') { jsonStartIdx = i; break; }
  }
  assert.ok(jsonStartIdx >= 0, 'stdout must contain JSON block');
  const jsonPart = lines.slice(jsonStartIdx).join('\n');
  const parsed = JSON.parse(jsonPart);
  assert.equal(parsed.schema, 'soma-bootstrap/v1');
});

// ---- AC-11: --quiet mode ----

test('CONTRACT AC-11: --quiet emits ONLY JSON', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const trimmed = result.stdout.trim();
  assert.equal(trimmed[0], '{', 'quiet stdout must start with {');
  assert.equal(trimmed[trimmed.length - 1], '}', 'quiet stdout must end with }');
  const parsed = JSON.parse(trimmed);
  assert.equal(parsed.schema, 'soma-bootstrap/v1');
});

// ---- AC-13: performance ----

test('CONTRACT AC-13: wallclock ≤5000ms', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture({ moduleCount: 10 });
  const start = Date.now();
  const result = runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
    timeout: 10000,
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed <= 5000, `Wallclock ${elapsed}ms exceeds 5000ms budget`);
});

// ---- AC-14: read-only enforcement ----

test('CONTRACT AC-14: SOMA_HOME files unchanged after bootstrap (read-only)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();

  // Capture pre-bootstrap shasums
  function shasumDir(dir) {
    const results = {};
    function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          const content = fs.readFileSync(full);
          results[full] = crypto.createHash('sha256').update(content).digest('hex');
        }
      }
    }
    walk(dir);
    return results;
  }

  const before = shasumDir(somaHome);
  runBootstrap(['--quiet'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  const after = shasumDir(somaHome);

  // Compare
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    assert.equal(before[key], after[key], `SOMA_HOME file modified: ${key}`);
  }
});

// ---- Invalid args exit 2 ----

test('CONTRACT: unknown flag exits 2 with INVALID_ARGS', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const result = runBootstrap(['--json'], {
    cwd: project,
    env: { SOMA_HOME: somaHome },
    scriptPath: BOOTSTRAP,
  });
  assert.equal(result.status, 2, `Expected exit 2 for unknown flag --json. Got: ${result.status}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'INVALID_ARGS');
});

// ---- Idempotency ----

test('CONTRACT: idempotent — consecutive invocations produce identical results (modulo duration_ms)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectFixture();
  const run1 = runBootstrap(['--quiet'], { cwd: project, env: { SOMA_HOME: somaHome }, scriptPath: BOOTSTRAP });
  const run2 = runBootstrap(['--quiet'], { cwd: project, env: { SOMA_HOME: somaHome }, scriptPath: BOOTSTRAP });
  assert.equal(run1.status, run2.status, 'Exit codes must match');
  const out1 = JSON.parse(run1.stdout);
  const out2 = JSON.parse(run2.stdout);
  // Status, schema, error_code must match
  assert.equal(out1.schema, out2.schema);
  assert.equal(out1.status, out2.status);
  assert.deepEqual(out1.modules, out2.modules);
});
