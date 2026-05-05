/**
 * bootstrap-output-schema.test.cjs — T-11 / AC-09
 * Full output schema validation per CONTRACT-BOOTSTRAP-01.
 *
 * @spec AC-09
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

function createProjectWithModules(count = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-proj-'));
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const statuses = ['active', 'hypothesis', 'deprecated'];
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(modulesDir, `module-${i}.md`), [
      '---', 'schema: soma-module/v1', `name: "Module ${i}"`, `status: ${statuses[i % 3]}`,
      'source_confidence: medium', 'owners: []', 'last_verified: "2026-05-02"',
      `source_path: "src/m${i}"`, 'initialized_at: "2026-05-02T00:00:00Z"',
      '---', `# Module ${i}`,
    ].join('\n'), 'utf8');
  }
  return dir;
}

test('AC-09: all required top-level fields present', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithModules(3);
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  const required = ['schema', 'status', 'soma_home', 'project_root', 'modules', 'adapters', 'findings', 'duration_ms'];
  for (const field of required) {
    assert.ok(field in out, `Missing required field: ${field}. Output keys: ${Object.keys(out).join(', ')}`);
  }
});

test('AC-09: modules array has correct shape (slug + status)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithModules(3);
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.equal(out.modules.length, 3, `Expected 3 modules. Got: ${out.modules.length}`);
  for (const mod of out.modules) {
    assert.ok(typeof mod.slug === 'string', `module.slug must be string. Got: ${typeof mod.slug}`);
    assert.ok(typeof mod.status === 'string', `module.status must be string. Got: ${typeof mod.status}`);
    assert.ok(['active', 'hypothesis', 'deprecated'].includes(mod.status),
      `module.status must be valid. Got: ${mod.status}`);
  }
});

test('AC-09: adapters array has correct shape (tool + install_targets_count)', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithModules(2);
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok(out.adapters.length >= 1, `Expected ≥1 adapter. Got: ${out.adapters.length}`);
  for (const adapter of out.adapters) {
    assert.ok(typeof adapter.tool === 'string', `adapter.tool must be string`);
    assert.ok(typeof adapter.install_targets_count === 'number', `adapter.install_targets_count must be number`);
  }
});

test('AC-09: duration_ms is a positive integer', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithModules(2);
  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.ok(Number.isInteger(out.duration_ms), 'duration_ms must be integer');
  assert.ok(out.duration_ms >= 0, 'duration_ms must be non-negative');
});
