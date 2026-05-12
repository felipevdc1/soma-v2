/**
 * bootstrap-index-filter.test.cjs — C-fu-2
 * enumerateModules() must exclude index.md from module count (D-C9).
 *
 * @spec C-fu-2
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

// Minimal SOMA_HOME fixture (no adapters needed — bootstrap still runs module enumeration)
function createSomaHomeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-idxf-home-'));
  const manifest = { schema: 'soma-manifest/v1', version: '2.1.0-test', release: 'test', files: [] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(path.join(dir, 'adapters', 'claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] }),
    'utf8'
  );
  return dir;
}

function makeModuleMd(name, status = 'active') {
  return [
    '---',
    'schema: soma-module/v1',
    `name: ${name}`,
    `status: ${status}`,
    'source_confidence: high',
    'owners: []',
    'last_verified: 2026-05-12',
    'source_path: src/',
    'initialized_at: 2026-05-12T00:00:00Z',
    '---',
    `# ${name}`,
  ].join('\n');
}

/**
 * Create a project with the given set of .md filenames in .soma/modules/.
 * Returns the project dir.
 */
function createProjectWithModuleFiles(fileNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bs-idxf-proj-'));
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  for (const fname of fileNames) {
    const slug = fname.replace(/\.md$/, '');
    fs.writeFileSync(path.join(modulesDir, fname), makeModuleMd(slug), 'utf8');
  }
  return dir;
}

function runBootstrap(projectDir, somaHome) {
  return spawnSync('node', [BOOTSTRAP, '--quiet'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: somaHome },
    timeout: 15000,
  });
}

function cleanup(dir) {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── C-fu-2 tests ─────────────────────────────────────────────────────────────

test('C-fu-2: enumerateModules excludes index.md — 4 files (app, components, lib, index.md) → 3 modules', () => {
  const somaHome = createSomaHomeFixture();
  const project = createProjectWithModuleFiles(['app.md', 'components.md', 'lib.md', 'index.md']);

  try {
    const result = runBootstrap(project, somaHome);
    assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);

    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch (e) {
      assert.fail(`Expected JSON output. Got: ${result.stdout.slice(0, 300)}\nstderr: ${result.stderr}`);
    }

    const moduleCount = parsed.modules?.length ?? parsed.modules?.count ?? -1;
    // Bootstrap JSON output has modules array (CONTRACT-BOOTSTRAP-01)
    const modules = parsed.modules;
    assert.ok(Array.isArray(modules), `Expected modules to be an array. Got: ${JSON.stringify(parsed.modules)}`);
    assert.equal(
      modules.length,
      3,
      `Expected 3 modules (index.md excluded). Got ${modules.length}: ${JSON.stringify(modules.map(m => m.slug || m.name))}`
    );

    // Verify index is not in the list
    const slugs = modules.map(m => m.slug || m.name);
    assert.ok(!slugs.includes('index'), `index must not appear in modules list. Got: ${JSON.stringify(slugs)}`);
  } finally {
    cleanup(project);
    cleanup(somaHome);
  }
});

test('C-fu-2: index.md presence does NOT affect module count — 3 non-index modules + index.md → still 3', () => {
  const somaHome = createSomaHomeFixture();
  // Same modules, WITH index.md
  const projectWith = createProjectWithModuleFiles(['auth.md', 'billing.md', 'users.md', 'index.md']);
  // Same modules, WITHOUT index.md
  const projectWithout = createProjectWithModuleFiles(['auth.md', 'billing.md', 'users.md']);

  try {
    const resultWith = runBootstrap(projectWith, somaHome);
    const resultWithout = runBootstrap(projectWithout, somaHome);

    assert.equal(resultWith.status, 0, `Expected exit 0 (with index). stderr: ${resultWith.stderr}`);
    assert.equal(resultWithout.status, 0, `Expected exit 0 (without index). stderr: ${resultWithout.stderr}`);

    const parsedWith = JSON.parse(resultWith.stdout);
    const parsedWithout = JSON.parse(resultWithout.stdout);

    const countWith = parsedWith.modules?.length;
    const countWithout = parsedWithout.modules?.length;

    assert.equal(
      countWith,
      countWithout,
      `Module count must be the same whether index.md is present or not. With: ${countWith}, Without: ${countWithout}`
    );
    assert.equal(countWith, 3, `Expected 3 modules in both cases. Got: ${countWith}`);
  } finally {
    cleanup(projectWith);
    cleanup(projectWithout);
    cleanup(somaHome);
  }
});

test('C-fu-2: case-sensitive — Index.md (capital I) is still treated as a module', () => {
  const somaHome = createSomaHomeFixture();
  // Index.md (capital I) should be included as a normal module
  const project = createProjectWithModuleFiles(['auth.md', 'billing.md', 'Index.md']);

  try {
    const result = runBootstrap(project, somaHome);
    assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout);
    const modules = parsed.modules;
    assert.ok(Array.isArray(modules), 'Expected modules array');
    assert.equal(
      modules.length,
      3,
      `Expected 3 modules (Index.md with capital I is a module). Got ${modules.length}: ${JSON.stringify(modules.map(m => m.slug || m.name))}`
    );
  } finally {
    cleanup(project);
    cleanup(somaHome);
  }
});
