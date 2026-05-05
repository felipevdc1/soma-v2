/**
 * ac-08-criterion-5-real-data.test.cjs — T-10
 * @spec AC-08
 * Criterion 5: "tudo dados reais"
 * No fixture indicators in productive paths (foundation source files).
 * Fixtures legitimate only in test paths.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac08-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapBase(dir) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Test Project',
  ].join('\n'), 'utf8');
  return dir;
}

function writeModule(dir, slug, layer, sourceFiles = []) {
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const sfList = sourceFiles.length > 0 ? `source_files: ${JSON.stringify(sourceFiles)}` : 'source_files: []';
  fs.writeFileSync(path.join(modulesDir, `${slug}.md`), [
    '---',
    'schema: soma-module/v1',
    `name: "${slug}"`,
    'status: active',
    'source_confidence: high',
    'owners: []',
    'last_verified: null',
    'source_path: "src/"',
    sfList,
    'initialized_at: "2026-01-01T00:00:00.000Z"',
    `layer: ${layer}`,
    '---',
    '',
    `# ${slug}`,
  ].join('\n'), 'utf8');
}

function writeSourceFile(dir, relPath, content) {
  const absPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

test('AC-08 criterion 5 PASS: no fixture files in productive paths', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/service.ts', 'export function doSomething() {}');
  writeModule(dir, 'core', 'roots', ['src/core/service.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c5 = out.criteria.find(c => c.id === 5);
  assert.equal(c5.status, 'pass', `Expected criterion 5 pass, got: ${JSON.stringify(c5)}`);
});

test('AC-08 criterion 5 FAIL: mock-* file in productive foundation source dir', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/mock-data.ts', 'export const mockUsers = [{ id: 1, name: "Test" }];');
  writeModule(dir, 'core', 'roots', ['src/core/service.ts', 'src/core/mock-data.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c5 = out.criteria.find(c => c.id === 5);
  assert.equal(c5.status, 'fail', `Expected criterion 5 fail for mock- file, got: ${JSON.stringify(c5)}`);
  assert.ok(c5.message.includes('mock-data.ts'), `Expected file name in message. Got: ${c5.message}`);
});

test('AC-08 criterion 5 FAIL: fake-* file in productive foundation source dir', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/auth/fake-session.ts', 'export const fakeSession = { token: "test" };');
  writeModule(dir, 'auth', 'trunk', ['src/auth/fake-session.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c5 = out.criteria.find(c => c.id === 5);
  assert.equal(c5.status, 'fail', `Expected criterion 5 fail for fake- file, got: ${JSON.stringify(c5)}`);
});

test('AC-08 criterion 5 PASS: mock files allowed in test paths (not source_files)', () => {
  const dir = bootstrapBase(tmpProject());
  // Fixture in test path — OK
  writeSourceFile(dir, '__tests__/fixtures/mock-user.ts', 'export const mockUser = { id: 1 };');
  writeSourceFile(dir, 'src/core/service.ts', 'export function getUser() {}');
  writeModule(dir, 'core', 'roots', ['src/core/service.ts']); // test fixture NOT in source_files

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c5 = out.criteria.find(c => c.id === 5);
  assert.equal(c5.status, 'pass', `Expected criterion 5 pass when fixtures only in test paths. Got: ${JSON.stringify(c5)}`);
});
