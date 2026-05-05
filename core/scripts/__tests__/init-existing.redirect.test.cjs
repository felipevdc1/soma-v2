'use strict';
// @spec AC-07
// T-09: .soma/ already-exists redirect

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-redirect') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('redirect: exit code 1 when .soma/ already exists (AC-07)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let exitCode = 0;
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) {
    exitCode = e.status;
  }
  assert.equal(exitCode, 1, 'exit code must be 1 (redirect, not hard error)');
});

test('redirect: mode=redirect in JSON output (AC-07)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let output = '';
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) {
    output = e.stdout;
  }
  const parsed = JSON.parse(output);
  assert.equal(parsed.mode, 'redirect');
});

test('redirect: error=ALREADY_INITIALIZED in JSON output (AC-07)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let output = '';
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) {
    output = e.stdout;
  }
  const parsed = JSON.parse(output);
  assert.equal(parsed.error, 'ALREADY_INITIALIZED');
});

test('redirect: suggested_commands include doctor and sync (AC-07)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  let output = '';
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) {
    output = e.stdout;
  }
  const parsed = JSON.parse(output);
  assert.ok(Array.isArray(parsed.suggested_commands), 'suggested_commands must be an array');
  assert.ok(parsed.suggested_commands.some(c => c.includes('doctor')), 'must suggest doctor');
  assert.ok(parsed.suggested_commands.some(c => c.includes('sync')), 'must suggest sync');
});

test('redirect: zero state change — no files written on redirect (AC-07)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  // Create .soma/ with a marker file
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true });
  fs.writeFileSync(path.join(target, '.soma', 'existing.txt'), 'existing');
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) { /* expected exit 1 */ }
  // Verify no new modules/ dir was created
  assert.ok(!fs.existsSync(path.join(target, '.soma/modules')), '.soma/modules must NOT be created on redirect');
  // Original file still present
  assert.ok(fs.existsSync(path.join(target, '.soma/existing.txt')), 'Existing .soma/ content must be untouched');
});
