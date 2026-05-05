/**
 * bootstrap-default-output.test.cjs — T-12 / AC-10
 * Default mode (no --quiet) emits human summary + JSON block.
 *
 * @spec AC-10
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

test('AC-10: default mode stdout starts with human-readable text (not raw JSON)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const firstChar = result.stdout.trim()[0];
  assert.notEqual(firstChar, '{', 'Default mode must not start with JSON — human summary comes first');
});

test('AC-10: default mode stdout contains JSON block at end', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  // Find JSON block — first { on its own line (the top-level object)
  const lines = result.stdout.split('\n');
  let jsonStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '{') { jsonStartIdx = i; break; }
  }
  assert.ok(jsonStartIdx >= 0, 'stdout must contain JSON block (line starting with {)');
  const jsonPart = lines.slice(jsonStartIdx).join('\n');
  let parsed;
  try {
    parsed = JSON.parse(jsonPart);
  } catch (e) {
    assert.fail(`Could not parse JSON block from stdout. Part: ${jsonPart.slice(0, 200)}`);
  }
  assert.equal(parsed.schema, 'soma-bootstrap/v1');
});

test('AC-10: default mode contains human status line', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();
  const result = spawnSync('node', [BOOTSTRAP], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  // Human output must mention project ready/drift/bootstrap
  const lower = result.stdout.toLowerCase();
  const hasHuman = lower.includes('ready') || lower.includes('drift') || lower.includes('bootstrap') || lower.includes('soma');
  assert.ok(hasHuman, `Expected human-readable content. Got: ${result.stdout.slice(0, 300)}`);
});
