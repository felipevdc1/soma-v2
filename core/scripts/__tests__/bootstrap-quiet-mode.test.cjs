/**
 * bootstrap-quiet-mode.test.cjs — T-13 / AC-11
 * --quiet flag emits ONLY JSON on stdout.
 *
 * @spec AC-11
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
  fs.writeFileSync(path.join(modulesDir, 'auth.md'), [
    '---', 'schema: soma-module/v1', 'name: "Auth"', 'status: active',
    'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/auth"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Auth',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-11: --quiet stdout starts with {', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const trimmed = result.stdout.trim();
  assert.equal(trimmed[0], '{', `--quiet stdout must start with {. Got: ${trimmed.slice(0, 50)}`);
});

test('AC-11: --quiet stdout ends with }', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const trimmed = result.stdout.trim();
  assert.equal(trimmed[trimmed.length - 1], '}', `--quiet stdout must end with }`);
});

test('AC-11: --quiet stdout is valid JSON with soma-bootstrap/v1 schema', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (e) {
    assert.fail(`--quiet output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }
  assert.equal(parsed.schema, 'soma-bootstrap/v1');
});

test('AC-11: --quiet stdout has no human-readable header lines', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const lines = result.stdout.trim().split('\n');
  // All lines except the outer JSON wrapper should be JSON-internal
  // Key check: first line must be '{' or '{'..., not plain text
  assert.equal(lines[0].trim()[0], '{', `First stdout line in --quiet must be JSON. Got: ${lines[0]}`);
});
