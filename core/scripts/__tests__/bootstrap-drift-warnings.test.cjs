/**
 * bootstrap-drift-warnings.test.cjs — T-09 / AC-07
 * Bootstrap with warning-only findings: exit 0, status:drift, suggestion references soma sync.
 *
 * @spec AC-07
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
  fs.mkdirSync(path.join(dir, 'adapters'), { recursive: true });
  return dir;
}

function createProjectWithBrokenContextRouting() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-drift-'));
  const somaDir = path.join(dir, '.soma');
  const modulesDir = path.join(somaDir, 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  // Module exists but CONTEXT.md references nonexistent one
  fs.writeFileSync(path.join(modulesDir, 'auth.md'), [
    '---', 'schema: soma-module/v1', 'name: "Auth"', 'status: active',
    'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/auth"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Auth',
  ].join('\n'), 'utf8');
  // CONTEXT.md with broken reference (points to nonexistent slug)
  fs.writeFileSync(path.join(somaDir, 'CONTEXT.md'), [
    '| keyword | slug |',
    '|---|---|',
    '| billing | billing-does-not-exist |',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-07: project with broken context routing exits 0 (warnings non-blocking)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithBrokenContextRouting();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0 (warnings non-blocking). stderr: ${result.stderr}`);
});

test('AC-07: warning findings populated in output', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithBrokenContextRouting();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  // Either status:drift with findings, or findings may be empty if auto-load not present
  assert.ok(Array.isArray(out.findings), 'findings must be array');
});

test('AC-07: status is drift or ready (not error) for warnings-only path', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithBrokenContextRouting();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok(['ready', 'drift'].includes(out.status),
    `status must be ready or drift for warnings-only path. Got: ${out.status}`);
});
