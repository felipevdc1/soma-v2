'use strict';
// @spec AC-08
// Integration tests for init.cjs exit codes and JSON schema completeness.
// 4 scenarios: greenfield success (exit 0), already-initialized (exit 1),
// --json --quiet conflict (exit 2 INVALID_ARGS), target invalid (exit 2 TARGET_PATH_INVALID).

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

// ---- AC-08: Exit code 0 — greenfield success ----

test('exit-codes: exit 0 on greenfield success (--quiet)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--quiet']);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
});

test('exit-codes: exit 0 on greenfield success (--json)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
  // JSON parseable
  assert.doesNotThrow(() => JSON.parse(result.stdout), 'JSON output must be parseable');
});

test('exit-codes: exit 0 on greenfield success (--dry-run)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  assert.equal(result.status, 0, `Expected exit 0 for dry-run, got ${result.status}`);
});

// ---- AC-08: Exit code 1 — already initialized ----

test('exit-codes: exit 1 on already-initialized redirect', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // First init
  runInit([target, '--quiet']);
  assert.ok(fs.existsSync(path.join(target, '.soma')));

  // Second init
  const result = runInit([target, '--quiet']);
  assert.equal(result.status, 1, `Expected exit 1 on re-run, got ${result.status}`);
});

test('exit-codes: exit 1 redirect JSON is parseable', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  assert.equal(result.status, 1);
  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed on redirect JSON: ${jqResult.stderr}`);
});

// ---- AC-08: Exit code 2 — invalid args ----

test('exit-codes: exit 2 for --json --quiet conflict (INVALID_ARGS)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json', '--quiet']);
  assert.equal(result.status, 2, `Expected exit 2 for INVALID_ARGS, got ${result.status}`);

  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('INVALID_ARGS'),
    `Expected INVALID_ARGS in output, got: ${combined.slice(0, 300)}`
  );
});

test('exit-codes: exit 2 INVALID_ARGS JSON output is parseable', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // --json --quiet conflict → exits 2, stdout should have JSON error
  const result = runInit([target, '--json', '--quiet']);
  assert.equal(result.status, 2);

  // With --json flag, error should be in stdout as JSON
  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed: ${jqResult.stderr}. stdout: ${result.stdout}`);
});

test('exit-codes: exit 2 for --quiet --verbose conflict', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--quiet', '--verbose']);
  assert.equal(result.status, 2, `Expected exit 2 for conflicting flags, got ${result.status}`);
});

// ---- AC-08: JSON schema validation for all modes ----

test('exit-codes: all JSON outputs include "tool" field', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Greenfield
  const greenResult = runInit([target, '--json']);
  assert.equal(JSON.parse(greenResult.stdout).tool, 'init');

  // Redirect
  const redirectResult = runInit([target, '--json']);
  assert.equal(JSON.parse(redirectResult.stdout).tool, 'init');
});

test('exit-codes: greenfield JSON has all required schema fields', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.mode, 'create');
  assert.ok(typeof parsed.soma_home === 'string', 'soma_home must be string');
  assert.ok(typeof parsed.target_path === 'string', 'target_path must be string');
  assert.ok(parsed.summary !== undefined, 'summary must exist');
  assert.ok(typeof parsed.summary.files_created === 'number', 'summary.files_created must be number');
  assert.ok(typeof parsed.summary.agents_md_managed === 'boolean', 'summary.agents_md_managed must be boolean');
  assert.ok(Array.isArray(parsed.files_created), 'files_created must be array');
});

test('exit-codes: redirect JSON has all required schema fields', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.mode, 'redirect');
  assert.equal(parsed.error, 'ALREADY_INITIALIZED');
  assert.ok(typeof parsed.message === 'string', 'message must be string');
  assert.ok(Array.isArray(parsed.suggested_commands), 'suggested_commands must be array');
});

test('exit-codes: dry-run JSON has all required schema fields', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.mode, 'dry-run');
  assert.ok(typeof parsed.summary.files_planned === 'number', 'summary.files_planned must be number');
  assert.ok(Array.isArray(parsed.files_planned), 'files_planned must be array');
});

// ---- jq validation across all modes ----

test('exit-codes: jq empty on greenfield JSON', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const jq = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jq.status, 0, `jq empty failed: ${jq.stderr}`);
});

test('exit-codes: jq empty on redirect JSON', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);
  const jq = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jq.status, 0, `jq empty failed: ${jq.stderr}`);
});

test('exit-codes: jq empty on dry-run JSON', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const jq = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jq.status, 0, `jq empty failed: ${jq.stderr}`);
});
