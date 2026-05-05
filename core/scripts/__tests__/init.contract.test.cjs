'use strict';
// @spec AC-01,02,03,04,05,06,07,08
// @contract CONTRACT-INIT-01
// Contract tests for scripts/init.cjs — Wave 1 RED phase.
// These tests MUST fail before init.cjs is implemented.

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

// ---- JSON schema contract tests ----

test('init: --json output has required top-level fields (tool/mode/soma_home/target_path/summary/files_created)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);

  assert.ok(result.stdout.length > 0, `Expected stdout, got stderr: ${result.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`init --json output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }

  assert.equal(parsed.tool, 'init');
  assert.equal(parsed.mode, 'create');
  assert.ok(typeof parsed.soma_home === 'string', 'soma_home must be string');
  assert.ok(typeof parsed.target_path === 'string', 'target_path must be string');
  assert.ok(parsed.summary !== undefined, 'summary must exist');
  assert.ok(Array.isArray(parsed.files_created), 'files_created must be array');
});

test('init: greenfield creates exactly 5 files (4 template + manifest.json, summary.files_created === 5)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  // 4 template-derived files + manifest.json (needed for doctor/sync compat per AC-07)
  assert.equal(parsed.summary.files_created, 5);
  assert.equal(parsed.summary.agents_md_managed, false);
  assert.equal(parsed.files_created.length, 5);
  assert.equal(result.status, 0);
});

test('init: files_created paths end with expected .soma/ files (including manifest.json)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const parsed = JSON.parse(result.stdout);

  const expectedSuffixes = [
    '.soma/project.md',
    '.soma/CONTEXT.md',
    '.soma/modules/index.md',
    '.soma/installed-state.json',
    '.soma/manifest.json'
  ];
  for (const suffix of expectedSuffixes) {
    assert.ok(
      parsed.files_created.some(f => f.endsWith(suffix)),
      `Expected file ending with ${suffix} in files_created: ${JSON.stringify(parsed.files_created)}`
    );
  }
});

// ---- --with-agents-md schema ----

test('init: --with-agents-md creates 6 files (5 .soma/ + AGENTS.md, agents_md_managed true)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--with-agents-md', '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.summary.agents_md_managed, true);
  assert.equal(parsed.summary.agents_md_action, 'create');
  // 5 .soma/ files (4 template + manifest.json) + AGENTS.md = 6 total
  assert.equal(parsed.files_created.length, 6);
  assert.equal(result.status, 0);
});

// ---- redirect mode schema ----

test('init: detects existing .soma/ and emits redirect JSON (exit 1)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Pre-create .soma/
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });

  const result = runInit([target, '--json']);

  assert.equal(result.status, 1, `Expected exit 1, got ${result.status}`);

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`redirect --json output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }

  assert.equal(parsed.mode, 'redirect');
  assert.equal(parsed.error, 'ALREADY_INITIALIZED');
  assert.ok(parsed.message.includes('doctor'), 'redirect message must mention doctor');
  assert.ok(parsed.message.includes('sync'), 'redirect message must mention sync');
  assert.ok(Array.isArray(parsed.suggested_commands), 'suggested_commands must be array');
  assert.equal(parsed.suggested_commands.length, 2, 'suggested_commands must have 2 entries');
});

test('init: redirect preserves zero file modification (shasum check)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Pre-create .soma/ with a file
  const somaDir = path.join(target, '.soma');
  fs.mkdirSync(somaDir, { recursive: true });
  const sentinelFile = path.join(somaDir, 'sentinel.txt');
  fs.writeFileSync(sentinelFile, 'do not modify');

  // Capture sha before
  const shaBefore = require('node:crypto').createHash('sha256').update(fs.readFileSync(sentinelFile)).digest('hex');

  runInit([target, '--json']);

  const shaAfter = require('node:crypto').createHash('sha256').update(fs.readFileSync(sentinelFile)).digest('hex');
  assert.equal(shaBefore, shaAfter, 'sentinel file must not be modified on redirect');
});

// ---- --dry-run schema ----

test('init: --dry-run emits mode "dry-run" JSON with files_planned (exit 0)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);

  assert.equal(result.status, 0, `Expected exit 0 for dry-run, got ${result.status}`);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.mode, 'dry-run');
  assert.ok(typeof parsed.summary.files_planned === 'number', 'summary.files_planned must be number');
  assert.ok(Array.isArray(parsed.files_planned), 'files_planned must be array');
  // 4 template files + manifest.json = 5
  assert.equal(parsed.files_planned.length, 5);
});

test('init: --dry-run zero side effects (no files created)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const before = fs.readdirSync(target);
  runInit([target, '--dry-run', '--json']);
  const after = fs.readdirSync(target);

  assert.deepEqual(before, after, '.soma/ must not be created after --dry-run');
});

// ---- Invalid args ----

test('init: --json --quiet returns INVALID_ARGS (exit 2)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json', '--quiet']);
  assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);

  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('INVALID_ARGS'),
    `Expected INVALID_ARGS in output, got: ${combined.slice(0, 300)}`
  );
});

test('init: --quiet --verbose returns INVALID_ARGS (exit 2)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--quiet', '--verbose']);
  assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);
});

// ---- jq validation ----

test('init: --json output is valid JSON (jq empty exits 0) for greenfield', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--json']);
  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed: ${jqResult.stderr}`);
});

test('init: --json output is valid JSON for redirect mode', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--json']);
  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed on redirect JSON: ${jqResult.stderr}`);
});

test('init: --json output is valid JSON for dry-run mode', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed on dry-run JSON: ${jqResult.stderr}`);
});

// ---- Exit codes ----

test('init: exit code 0 on greenfield success (--quiet)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--quiet']);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
});

test('init: exit code 1 on already-initialized redirect', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  const result = runInit([target, '--quiet']);
  assert.equal(result.status, 1, `Expected exit 1, got ${result.status}`);
});

test('init: --soma-home flag is accepted (uses alternative soma home)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Use real soma home but pass explicitly
  const result = runInit([target, '--json', `--soma-home=${SOMA_HOME}`]);
  assert.ok(result.status === 0 || result.status === 1, `Expected 0 or 1, got ${result.status}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.soma_home, SOMA_HOME);
});
