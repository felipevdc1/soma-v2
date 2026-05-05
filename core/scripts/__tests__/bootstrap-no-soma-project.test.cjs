/**
 * bootstrap-no-soma-project.test.cjs — T-04 / AC-02
 * Bootstrap exits 1 + error_code NO_SOMA_PROJECT when cwd lacks .soma/
 *
 * @spec AC-02
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

test('AC-02: exits 1 when .soma/ is missing', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-nosoma-'));
  const somaHome = createSomaHomeFixture();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: emptyDir,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
});

test('AC-02: error_code is NO_SOMA_PROJECT', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-nosoma-'));
  const somaHome = createSomaHomeFixture();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: emptyDir,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  let out;
  try {
    out = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`stdout is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }
  assert.equal(out.error_code, 'NO_SOMA_PROJECT');
});

test('AC-02: suggestion field references soma init', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-nosoma-'));
  const somaHome = createSomaHomeFixture();
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: emptyDir,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok(out.suggestion && out.suggestion.length > 0, 'suggestion must be non-empty');
  assert.ok(
    out.suggestion.includes('init') || out.suggestion.includes('soma'),
    `suggestion should reference soma init. Got: ${out.suggestion}`
  );
});
