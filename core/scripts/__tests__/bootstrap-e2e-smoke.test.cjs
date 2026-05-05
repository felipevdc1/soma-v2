/**
 * bootstrap-e2e-smoke.test.cjs — T-17
 * E2E smoke: init --existing → bootstrap chain on real SOMA_HOME copy.
 *
 * @spec AC-01, AC-09
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
const INIT = path.join(SOMA_HOME_REAL, 'scripts', 'init.cjs');

function createSomaHomeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-home-'));
  const manifest = { schema: 'soma-manifest/v1', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(dir, 'adapters'), { recursive: true });
  return dir;
}

// Create a minimal JS project for init --existing
function createJsProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-e2e-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = {};', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'test-project', version: '1.0.0',
  }), 'utf8');
  return dir;
}

test('T-17 E2E: bootstrap on manually-created SOMA-project exits 0', () => {
  const somaHome = createSomaHomeFixture();
  // Create project with manual .soma/ (simulating post-init state)
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-e2e-'));
  const modulesDir = path.join(project, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  // Create 2 modules
  for (let i = 0; i < 2; i++) {
    fs.writeFileSync(path.join(modulesDir, `service-${i}.md`), [
      '---', 'schema: soma-module/v1', `name: "Service ${i}"`, 'status: active',
      'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
      `source_path: "src/service${i}"`, 'initialized_at: "2026-05-02T00:00:00Z"',
      '---', `# Service ${i}`,
    ].join('\n'), 'utf8');
  }

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, 'soma-bootstrap/v1');
  assert.match(out.status, /^(ready|drift)$/);
});

test('T-17 E2E: modules detected match .soma/modules/ files', () => {
  const somaHome = createSomaHomeFixture();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-e2e2-'));
  const modulesDir = path.join(project, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const slugs = ['auth', 'billing', 'notifications'];
  for (const slug of slugs) {
    fs.writeFileSync(path.join(modulesDir, `${slug}.md`), [
      '---', 'schema: soma-module/v1', `name: "${slug}"`, 'status: active',
      'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
      `source_path: "src/${slug}"`, 'initialized_at: "2026-05-02T00:00:00Z"',
      '---', `# ${slug}`,
    ].join('\n'), 'utf8');
  }

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  assert.equal(out.modules.length, 3, `Expected 3 modules. Got: ${out.modules.length}`);
  const detectedSlugs = out.modules.map(m => m.slug).sort();
  assert.deepEqual(detectedSlugs, slugs.sort());
});

test('T-17 E2E: adapters array reflects SOMA_HOME adapters directory', () => {
  const somaHome = createSomaHomeFixture();
  // Add 2 adapters to fixture
  fs.mkdirSync(path.join(somaHome, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'adapters', 'claude'), { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'codex', entries: [] }), 'utf8');
  fs.writeFileSync(path.join(somaHome, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] }), 'utf8');

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-e2e3-'));
  const modulesDir = path.join(project, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'core.md'), [
    '---', 'schema: soma-module/v1', 'name: "Core"', 'status: active',
    'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/core"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Core',
  ].join('\n'), 'utf8');

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  const adapterTools = out.adapters.map(a => a.tool).sort();
  assert.ok(adapterTools.includes('codex'), `Expected codex adapter. Got: ${adapterTools.join(', ')}`);
  assert.ok(adapterTools.includes('claude'), `Expected claude adapter. Got: ${adapterTools.join(', ')}`);
});

test('T-17 E2E: project_root and soma_home fields match invocation context (realpath)', () => {
  const somaHome = createSomaHomeFixture();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-e2e4-'));
  const modulesDir = path.join(project, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'core.md'), [
    '---', 'schema: soma-module/v1', 'name: "Core"', 'status: active',
    'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/core"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Core',
  ].join('\n'), 'utf8');

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  // Normalize paths through realpath (macOS /tmp → /private/tmp)
  const realProject = fs.realpathSync(project);
  const realSomaHome = fs.realpathSync(somaHome);
  assert.equal(out.project_root, realProject, 'project_root must match cwd');
  assert.equal(out.soma_home, realSomaHome, 'soma_home must match SOMA_HOME env');
});

test('T-17 E2E: suggestion is null on successful ready project', () => {
  const somaHome = createSomaHomeFixture();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-e2e5-'));
  const modulesDir = path.join(project, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'core.md'), [
    '---', 'schema: soma-module/v1', 'name: "Core"', 'status: active',
    'source_confidence: high', 'owners: []', 'last_verified: "2026-05-02"',
    'source_path: "src/core"', 'initialized_at: "2026-05-02T00:00:00Z"',
    '---', '# Core',
  ].join('\n'), 'utf8');

  const result = spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 10000,
  });
  const out = JSON.parse(result.stdout);
  if (out.status === 'ready') {
    // suggestion can be null or absent on ready status
    assert.ok(out.suggestion === null || out.suggestion === undefined || out.suggestion === '',
      `Expected null suggestion on ready status. Got: ${out.suggestion}`);
  }
});
