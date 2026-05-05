/**
 * bootstrap-detect-soma.test.cjs — T-03 / AC-01
 * Bootstrap detects .soma/ in cwd and advances to Step 2.
 * RED phase — fails before bootstrap.cjs exists.
 *
 * @spec AC-01
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME_REAL = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const BOOTSTRAP = path.join(SOMA_HOME_REAL, 'scripts', 'bootstrap.cjs');

function createSomaHomeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-home-'));
  const manifest = { schema: 'soma-manifest/v1', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(dir, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'adapters', 'claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'codex', entries: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] }), 'utf8');
  return dir;
}

function createProjectWithSoma(moduleCount = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-proj-'));
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  for (let i = 0; i < moduleCount; i++) {
    fs.writeFileSync(path.join(modulesDir, `module-${i}.md`), [
      '---', 'schema: soma-module/v1', `name: "Module ${i}"`, 'status: active',
      'source_confidence: medium', 'owners: []', 'last_verified: "2026-05-02"',
      `source_path: "src/m${i}"`, 'initialized_at: "2026-05-02T00:00:00Z"',
      '---', `# Module ${i}`,
    ].join('\n'), 'utf8');
  }
  return dir;
}

test('AC-01: bootstrap with .soma/ exits 0 (project detected)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
});

test('AC-01: bootstrap with .soma/ outputs valid soma-bootstrap/v1 JSON', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  let out;
  try {
    out = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`stdout is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }
  assert.equal(out.schema, 'soma-bootstrap/v1');
  assert.match(out.status, /^(ready|drift)$/);
});

test('AC-01: project_root in output matches cwd (realpath)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  // Normalize both paths through realpath (macOS /tmp is symlink to /private/tmp)
  const realProject = fs.realpathSync(project);
  const realRoot = fs.existsSync(out.project_root) ? fs.realpathSync(out.project_root) : out.project_root;
  assert.equal(realRoot, realProject);
});
