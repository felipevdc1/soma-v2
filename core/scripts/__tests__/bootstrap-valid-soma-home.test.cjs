/**
 * bootstrap-valid-soma-home.test.cjs — T-05 / AC-03
 * Bootstrap validates SOMA_HOME with valid manifest and advances.
 *
 * @spec AC-03
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
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.mkdirSync(path.join(dir, 'adapters', 'codex'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'codex', entries: [] }), 'utf8');
  return dir;
}

function createProjectWithSoma() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-proj-'));
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'auth.md'), [
    '---', 'schema: soma-module/v1', 'name: "Auth"', 'status: active',
    'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/auth"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Auth',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-03: exits 0 with valid SOMA_HOME (manifest schema-valid)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0 with valid SOMA_HOME. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.match(out.status, /^(ready|drift)$/);
});

test('AC-03: soma_home field matches SOMA_HOME path (realpath)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  // Normalize through realpath (macOS /tmp → /private/tmp symlink)
  const realSomaHome = fs.realpathSync(somaHome);
  assert.equal(out.soma_home, realSomaHome);
});

test('AC-03: --soma-home flag overrides SOMA_HOME env var', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet', `--soma-home=${somaHome}`], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: '/nonexistent-should-be-overridden' },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0 with --soma-home flag. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  const realSomaHome = fs.realpathSync(somaHome);
  assert.equal(out.soma_home, realSomaHome);
});
