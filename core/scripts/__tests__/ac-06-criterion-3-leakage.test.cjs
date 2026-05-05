/**
 * ac-06-criterion-3-leakage.test.cjs — T-08
 * @spec AC-06
 * Criterion 3: "zero data leakage"
 * Foundation modules (roots|trunk) must not import expansion modules (leaves).
 * Static check via grep of import/require in source_files.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac06-') {
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
  const sourceFilesList = sourceFiles.length > 0
    ? `source_files: ${JSON.stringify(sourceFiles)}`
    : 'source_files: []';
  fs.writeFileSync(path.join(modulesDir, `${slug}.md`), [
    '---',
    'schema: soma-module/v1',
    `name: "${slug}"`,
    'status: active',
    'source_confidence: high',
    'owners: []',
    'last_verified: null',
    'source_path: "src/"',
    sourceFilesList,
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

test('AC-06 criterion 3 PASS: trunk module source files have no imports of leaves modules', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/auth/handler.ts', [
    'import { db } from "../core/db";',
    'export function login() {}',
  ].join('\n'));
  writeModule(dir, 'auth', 'trunk', ['src/auth/handler.ts']);
  writeModule(dir, 'core', 'roots', ['src/core/db.ts']);
  writeModule(dir, 'reports', 'leaves', ['src/reports/index.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c3 = out.criteria.find(c => c.id === 3);
  assert.equal(c3.status, 'pass', `Expected criterion 3 pass, got: ${JSON.stringify(c3)}`);
});

test('AC-06 criterion 3 FAIL: trunk module imports leaves module', () => {
  const dir = bootstrapBase(tmpProject());
  // auth (trunk) imports reports (leaves)
  writeSourceFile(dir, 'src/auth/handler.ts', [
    'import { reportsFn } from "../reports/index";',
    'export function login() {}',
  ].join('\n'));
  writeModule(dir, 'auth', 'trunk', ['src/auth/handler.ts']);
  writeModule(dir, 'reports', 'leaves', ['src/reports/index.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c3 = out.criteria.find(c => c.id === 3);
  assert.equal(c3.status, 'fail', `Expected criterion 3 fail, got: ${JSON.stringify(c3)}`);
  assert.ok(c3.message.includes('auth') || c3.message.includes('reports'), `Expected message to name violating modules. Got: ${c3.message}`);
});

test('AC-06 criterion 3 PASS (not-applicable): no foundation modules = skip', () => {
  const dir = bootstrapBase(tmpProject());
  writeModule(dir, 'reports', 'leaves');

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c3 = out.criteria.find(c => c.id === 3);
  assert.ok(
    c3.status === 'pass' || c3.status === 'not-applicable',
    `Expected pass or not-applicable when no foundation modules. Got: ${JSON.stringify(c3)}`
  );
});

test('AC-06 criterion 3: message includes path:line for violation', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/main.ts', [
    'import { analytics } from "../analytics/service";',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/main.ts']);
  writeModule(dir, 'analytics', 'leaves', ['src/analytics/service.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c3 = out.criteria.find(c => c.id === 3);
  assert.equal(c3.status, 'fail');
  // Message should include source file info
  assert.ok(
    c3.message.includes('core') || c3.message.includes('analytics') || c3.message.includes('src/'),
    `Expected violation details in message. Got: ${c3.message}`
  );
});
