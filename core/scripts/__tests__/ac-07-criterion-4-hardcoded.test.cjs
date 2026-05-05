/**
 * ac-07-criterion-4-hardcoded.test.cjs — T-09
 * @spec AC-07 + D1
 * Criterion 4: "zero hardcoded" — Bruno strict 0 HARD
 * Regex patterns for credentials, absolute paths, hardcoded URLs.
 * ANY match in foundation source files = fail.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac07-') {
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

test('AC-07 criterion 4 PASS: clean foundation source file — no hardcoded patterns', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/config.ts', [
    'const apiUrl = process.env.API_URL;',
    'const dbPath = process.env.DB_PATH;',
    'export { apiUrl, dbPath };',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/config.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'pass', `Expected criterion 4 pass, got: ${JSON.stringify(c4)}`);
});

test('AC-07 criterion 4 FAIL + D1: hardcoded URL "http://localhost" in foundation source', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/config.ts', [
    'const API_URL = "http://localhost:3000";',
    'export { API_URL };',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/config.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'fail', `Expected criterion 4 fail for hardcoded URL, got: ${JSON.stringify(c4)}`);
  // D1: message must include path:line
  assert.ok(c4.message.includes('config.ts'), `Expected path in message. Got: ${c4.message}`);
});

test('AC-07 criterion 4 FAIL + D1: hardcoded credential "password=" in foundation source', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/auth/db.ts', [
    'const password = "supersecret123";',
    'export default { password };',
  ].join('\n'));
  writeModule(dir, 'auth', 'trunk', ['src/auth/db.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'fail', `Expected criterion 4 fail for hardcoded credential, got: ${JSON.stringify(c4)}`);
  assert.ok(c4.message.includes('db.ts'), `Expected path in message. Got: ${c4.message}`);
});

test('AC-07 criterion 4 FAIL + D1: absolute path "/Users/" in foundation source', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/loader.ts', [
    'const configPath = "/Users/felipevdc/config.json";',
    'export { configPath };',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/loader.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'fail', `Expected criterion 4 fail for absolute path, got: ${JSON.stringify(c4)}`);
  assert.ok(c4.message.includes('loader.ts'), `Expected path in message. Got: ${c4.message}`);
});

test('AC-07 criterion 4 FAIL + D1: api_key hardcoded in foundation source', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/client.ts', [
    'const api_key = "sk-abc123def456";',
    'export { api_key };',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/client.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'fail', `Expected criterion 4 fail for api_key, got: ${JSON.stringify(c4)}`);
});

test('AC-07 criterion 4: message includes line number for each hit', () => {
  const dir = bootstrapBase(tmpProject());
  writeSourceFile(dir, 'src/core/config.ts', [
    '// clean line 1',
    'const secret = "my-secret-value";',  // line 2
    '// clean line 3',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/config.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'fail');
  // Message should mention line number
  assert.ok(
    c4.message.includes(':2') || c4.message.includes('line 2') || c4.message.includes('secret'),
    `Expected line reference in message. Got: ${c4.message}`
  );
});

test('AC-07 criterion 4 PASS: only leaves modules have hardcoded values (not checked)', () => {
  const dir = bootstrapBase(tmpProject());
  // Hardcoded in a LEAVES module — should NOT trigger criterion 4 (only checks foundation)
  writeSourceFile(dir, 'src/reports/constants.ts', [
    'const API_URL = "http://localhost:8080";',
  ].join('\n'));
  writeModule(dir, 'reports', 'leaves', ['src/reports/constants.ts']);
  // Foundation module is clean
  writeSourceFile(dir, 'src/core/config.ts', [
    'const url = process.env.URL;',
  ].join('\n'));
  writeModule(dir, 'core', 'roots', ['src/core/config.ts']);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'pass', `Criterion 4 should only check foundation modules. Got: ${JSON.stringify(c4)}`);
});

test('AC-07 criterion 4 PASS (not-applicable): no foundation modules with source_files', () => {
  const dir = bootstrapBase(tmpProject());
  writeModule(dir, 'reports', 'leaves'); // no source_files

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.ok(
    c4.status === 'pass' || c4.status === 'not-applicable',
    `Expected pass or not-applicable. Got: ${JSON.stringify(c4)}`
  );
});
