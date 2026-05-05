'use strict';
// @spec AC-01
// Integration test for init.cjs greenfield create (AC-01).
// Creates a real .soma/ structure in /tmp/ fixture and verifies correctness.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkFixture(prefix = 'soma-init-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runInit(args = []) {
  return spawnSync('node', [INIT, ...args], {
    encoding: 'utf8',
    timeout: 15000
  });
}

// ---- AC-01: Greenfield creates 5 files in .soma/ ----
// Note: AC-01 spec lists 4 template files; manifest.json is an additional infrastructure
// file created to enable doctor/sync compat (AC-07 requirement). Total = 5 .soma/ files.

test('greenfield: exit code 0', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
});

test('greenfield: creates all required files in .soma/', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const expectedFiles = [
    path.join(target, '.soma', 'project.md'),
    path.join(target, '.soma', 'CONTEXT.md'),
    path.join(target, '.soma', 'modules', 'index.md'),
    path.join(target, '.soma', 'installed-state.json'),
    path.join(target, '.soma', 'manifest.json')
  ];

  for (const f of expectedFiles) {
    assert.ok(fs.existsSync(f), `Expected file to exist: ${f}`);
  }
});

test('greenfield: .soma/ directory is created', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);
  assert.ok(fs.existsSync(path.join(target, '.soma')), '.soma/ directory must be created');
});

test('greenfield: no AGENTS.md created without --with-agents-md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);
  assert.ok(!fs.existsSync(path.join(target, 'AGENTS.md')), 'AGENTS.md must NOT be created without --with-agents-md');
});

test('greenfield: installed-state.json has correct schema', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const installedStatePath = path.join(target, '.soma', 'installed-state.json');
  assert.ok(fs.existsSync(installedStatePath), 'installed-state.json must exist');

  const raw = fs.readFileSync(installedStatePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    assert.fail(`installed-state.json is not valid JSON: ${raw.slice(0, 200)}`);
  }

  assert.equal(data.schema, 'soma-installed-state/v1', 'schema field must be soma-installed-state/v1');
  assert.equal(data.soma_version, '2.1.0-draft', 'soma_version must be 2.1.0-draft');
  assert.ok(typeof data.initialized_at === 'string', 'initialized_at must be a string');
  assert.ok(typeof data.last_init === 'string', 'last_init must be a string');
  assert.equal(data.agents_md_managed, false, 'agents_md_managed must be false without --with-agents-md');
});

test('greenfield: installed-state.json initialized_at is ISO8601 UTC', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const data = JSON.parse(fs.readFileSync(path.join(target, '.soma', 'installed-state.json'), 'utf8'));
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  assert.match(data.initialized_at, iso8601Regex, `initialized_at must be ISO8601: ${data.initialized_at}`);
});

test('greenfield: JSON output files_created matches actual created files', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  // Verify each file in files_created actually exists on disk
  for (const f of parsed.files_created) {
    assert.ok(fs.existsSync(f), `File listed in files_created must exist: ${f}`);
  }
  // 4 template-derived files + manifest.json infrastructure file = 5 total
  assert.equal(parsed.files_created.length, 5, 'Must report exactly 5 files created (4 template + manifest.json)');
});

test('greenfield: target_path in JSON output matches resolved path', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.target_path, path.resolve(target));
});

test('greenfield: soma_home in JSON output matches default soma home', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.soma_home, SOMA_HOME);
});
