/**
 * bootstrap-critical-drift.test.cjs — T-10 / AC-08
 * Critical findings → exit 1 + SCHEMA_VERSION_UNSUPPORTED/CRITICAL_DRIFT + critical_findings[].
 *
 * @spec AC-08
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
  fs.writeFileSync(path.join(modulesDir, 'mod.md'), [
    '---', 'schema: soma-module/v1', 'name: "Mod"', 'status: active',
    'source_confidence: medium', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/mod"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Mod',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-08: corrupted manifest schema exits 1', () => {
  const corruptHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-corrupt-'));
  // Wrong schema version
  const manifest = { schema: 'soma-manifest/v999', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(corruptHome, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(corruptHome, 'adapters'), { recursive: true });
  const project = createProjectWithSoma();

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: corruptHome },
    timeout: 10000,
  });
  assert.equal(result.status, 1, `Expected exit 1 for corrupt manifest. stderr: ${result.stderr}`);
});

test('AC-08: corrupted manifest has error_code SCHEMA_VERSION_UNSUPPORTED or INVALID_SOMA_HOME', () => {
  const corruptHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-corrupt-'));
  const manifest = { schema: 'soma-manifest/v999', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(corruptHome, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(corruptHome, 'adapters'), { recursive: true });
  const project = createProjectWithSoma();

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: corruptHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok(
    ['SCHEMA_VERSION_UNSUPPORTED', 'INVALID_SOMA_HOME', 'CRITICAL_DRIFT'].includes(out.error_code),
    `Expected schema/critical error code. Got: ${out.error_code}`
  );
});

test('AC-08: output schema is soma-bootstrap/v1 even on error path', () => {
  const corruptHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-corrupt2-'));
  const manifest = { schema: 'soma-manifest/v999', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(corruptHome, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(corruptHome, 'adapters'), { recursive: true });
  const project = createProjectWithSoma();

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: corruptHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, 'soma-bootstrap/v1');
});
