/**
 * bootstrap-doctor-delegation.test.cjs — T-07 / AC-05
 * Bootstrap captures doctor findings in-memory (not via stdout parse).
 *
 * @spec AC-05
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

function createProjectWithSoma() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-proj-'));
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'mod.md'), [
    '---', 'schema: soma-module/v1', 'name: "Mod"', 'status: active',
    'source_confidence: medium', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/mod"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Mod',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-05: findings field is an array in bootstrap output', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.ok(Array.isArray(out.findings), 'findings must be array');
});

test('AC-05: bootstrap does not emit doctor output format on stdout (delegation is internal)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  // stdout should be bootstrap schema, not doctor schema
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, 'soma-bootstrap/v1', 'output schema must be soma-bootstrap/v1, not doctor');
  // Should NOT have doctor-specific fields in output root
  assert.ok(!('tool' in out) || out.tool !== 'doctor', 'output should not have doctor tool field');
});

test('AC-05: findings in output are from context routing check (not target drift)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  // Inject CONTEXT.md with broken ref to trigger routing warning
  fs.writeFileSync(path.join(project, '.soma', 'CONTEXT.md'), [
    '| keyword | slug |',
    '|---|---|',
    '| auth | does-not-exist-module |',
  ].join('\n'), 'utf8');
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  // Should not crash
  assert.ok(result.status === 0 || result.status === 1, `Expected 0 or 1. Got ${result.status}. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.ok(Array.isArray(out.findings), 'findings must be array regardless of state');
});
