'use strict';
// @spec AC-02
// Integration tests for init.cjs redirect behavior when .soma/ already exists.
// Verifies: exit 1, correct JSON schema, zero file modification.

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

function computeFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ---- AC-02: Re-run redirect tests ----

test('redirect: exit code 1 when .soma/ exists (empty)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  assert.equal(result.status, 1, `Expected exit 1, got ${result.status}`);
});

test('redirect: exit code 1 when .soma/ exists (populated from prior init)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // First init
  runInit([target]);
  assert.ok(fs.existsSync(path.join(target, '.soma')), '.soma/ must exist after first init');

  // Second init
  const result = runInit([target, '--json']);
  assert.equal(result.status, 1, `Expected exit 1 on re-run, got ${result.status}`);
});

test('redirect: JSON mode=redirect', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, 'redirect');
});

test('redirect: JSON error=ALREADY_INITIALIZED', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.error, 'ALREADY_INITIALIZED');
});

test('redirect: message contains doctor suggestion', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.message.includes('doctor'), `redirect message must mention doctor: "${parsed.message}"`);
});

test('redirect: message contains sync suggestion', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.message.includes('sync'), `redirect message must mention sync: "${parsed.message}"`);
});

test('redirect: suggested_commands is array with 2 entries', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed.suggested_commands), 'suggested_commands must be array');
  assert.equal(parsed.suggested_commands.length, 2, 'suggested_commands must have 2 entries');
});

test('redirect: suggested_commands[0] references doctor.cjs', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.suggested_commands[0].includes('doctor.cjs'),
    `First suggested_command must reference doctor.cjs: "${parsed.suggested_commands[0]}"`
  );
});

test('redirect: suggested_commands[1] references sync.cjs --dry-run', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.suggested_commands[1].includes('sync.cjs'),
    `Second suggested_command must reference sync.cjs: "${parsed.suggested_commands[1]}"`
  );
  assert.ok(
    parsed.suggested_commands[1].includes('--dry-run'),
    `Second suggested_command must include --dry-run: "${parsed.suggested_commands[1]}"`
  );
});

test('redirect: zero file modification (shasum check on existing files)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Create .soma/ with a sentinel file
  const somaDir = path.join(target, '.soma');
  fs.mkdirSync(somaDir, { recursive: true });
  const sentinelPath = path.join(somaDir, 'sentinel.txt');
  fs.writeFileSync(sentinelPath, 'do-not-touch');
  const shaBefore = computeFileSha256(sentinelPath);

  // Also put a file in target root
  const rootSentinel = path.join(target, 'root-file.txt');
  fs.writeFileSync(rootSentinel, 'root-do-not-touch');
  const rootShaBefore = computeFileSha256(rootSentinel);

  // Run redirect (without flags and with --with-agents-md)
  runInit([target, '--json']);
  runInit([target, '--with-agents-md', '--json']);

  const shaAfter = computeFileSha256(sentinelPath);
  const rootShaAfter = computeFileSha256(rootSentinel);

  assert.equal(shaBefore, shaAfter, 'sentinel.txt must not be modified on redirect');
  assert.equal(rootShaBefore, rootShaAfter, 'root-file.txt must not be modified on redirect');
});

test('redirect: no new files created in target (directory listing unchanged)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const beforeItems = fs.readdirSync(target).sort();

  runInit([target]);

  const afterItems = fs.readdirSync(target).sort();
  assert.deepEqual(beforeItems, afterItems, 'directory listing must be unchanged after redirect');
});

test('redirect: JSON output is valid JSON (jq empty)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);

  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed: ${jqResult.stderr}`);
});
