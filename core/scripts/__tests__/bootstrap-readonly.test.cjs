/**
 * bootstrap-readonly.test.cjs — T-16 / AC-14
 * SOMA_HOME sha256 sums identical pre/post bootstrap (read-only enforcement).
 *
 * @spec AC-14
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

function createSomaHomeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-home-'));
  const manifest = { schema: 'soma-manifest/v1', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(dir, 'adapters', 'codex'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'codex', entries: [] }), 'utf8');
  // Add a docs file to verify it's not modified
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'test.md'), '# Test\nSoma home test file.\n', 'utf8');
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

/**
 * Compute sha256 of every file in a directory tree.
 * Returns map: filepath → sha256hex
 */
function shasumDirectory(dir) {
  const map = {};
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const content = fs.readFileSync(full);
        map[full] = crypto.createHash('sha256').update(content).digest('hex');
      }
    }
  }
  walk(dir);
  return map;
}

test('AC-14: SOMA_HOME unchanged after successful bootstrap (success path)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithSoma();

  const before = shasumDirectory(somaHome);
  spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const after = shasumDirectory(somaHome);

  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  // No new files created
  for (const key of afterKeys) {
    assert.ok(beforeKeys.has(key), `New file created in SOMA_HOME: ${key}`);
  }
  // No files removed
  for (const key of beforeKeys) {
    assert.ok(afterKeys.has(key), `File removed from SOMA_HOME: ${key}`);
  }
  // No files modified
  for (const key of Object.keys(before)) {
    assert.equal(before[key], after[key], `SOMA_HOME file modified: ${key}`);
  }
});

test('AC-14: SOMA_HOME unchanged after error-path bootstrap (no .soma/ in project)', () => {
  const somaHome = createSomaHomeFixture();
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-nosoma-'));

  const before = shasumDirectory(somaHome);
  spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: emptyDir,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const after = shasumDirectory(somaHome);

  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  assert.equal(beforeKeys.length, afterKeys.length, 'File count in SOMA_HOME changed after error path');
  for (const key of beforeKeys) {
    assert.equal(before[key], after[key], `SOMA_HOME file modified on error path: ${key}`);
  }
});
