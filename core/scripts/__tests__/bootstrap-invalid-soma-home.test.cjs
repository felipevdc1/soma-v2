/**
 * bootstrap-invalid-soma-home.test.cjs — T-06 / AC-04
 * Bootstrap exits 1 + INVALID_SOMA_HOME when SOMA_HOME missing or manifest invalid.
 *
 * @spec AC-04
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

test('AC-04: exits 1 with SOMA_HOME path missing', () => {
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: '/absolutely-nonexistent-soma-home-path' },
    timeout: 10000,
  });
  assert.equal(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'INVALID_SOMA_HOME');
});

test('AC-04: suggestion references onboarding.md', () => {
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: '/absolutely-nonexistent-soma-home-path' },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok(out.suggestion && out.suggestion.includes('onboarding'), 'suggestion must reference onboarding.md');
});

test('AC-04: exits 1 when manifest.json missing (SOMA_HOME dir exists but empty)', () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-emptyhome-'));
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: emptyHome },
    timeout: 10000,
  });
  assert.equal(result.status, 1, `Expected exit 1 with missing manifest. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'INVALID_SOMA_HOME');
});

test('AC-04: exits 1 when manifest.json invalid JSON', () => {
  const corruptHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-corrupted-'));
  fs.writeFileSync(path.join(corruptHome, 'manifest.json'), 'NOT VALID JSON { bad }', 'utf8');
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: corruptHome },
    timeout: 10000,
  });
  assert.equal(result.status, 1, `Expected exit 1 with corrupt manifest. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error_code, 'INVALID_SOMA_HOME');
});

test('AC-04: soma_home_attempted field present in error output', () => {
  const project = createProjectWithSoma();
  const missingPath = '/absolutely-nonexistent-soma-home-path';
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: missingPath },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok('soma_home_attempted' in out, 'soma_home_attempted must be present');
  assert.equal(out.soma_home_attempted, missingPath);
});
