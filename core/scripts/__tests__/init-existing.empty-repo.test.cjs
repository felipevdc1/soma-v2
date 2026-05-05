'use strict';
// @spec AC-10
// T-12: Empty/no-source repo handling

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-empty') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('empty repo: modules_detected=0 and message="no modules inferred" (AC-10)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // Empty dir — no source files
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.modules_detected, 0);
  assert.equal(parsed.message, 'no modules inferred');
});

test('empty repo: exit code 0 (AC-10)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // execFileSync throws on non-zero; this test passes if no exception
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(out.length > 0);
});

test('empty repo: .soma/modules/index.md still created (AC-10)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/index.md')), '.soma/modules/index.md must exist even on empty repo');
});

test('empty repo: .soma/project.md created even with no modules (AC-10)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(fs.existsSync(path.join(target, '.soma/project.md')));
});

test('empty repo: no .soma/modules/{name}.md files created (AC-10)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const modulesDir = path.join(target, '.soma/modules');
  const mdFiles = fs.readdirSync(modulesDir).filter(f => f !== 'index.md');
  assert.equal(mdFiles.length, 0, 'No module files should exist for empty repo');
});
