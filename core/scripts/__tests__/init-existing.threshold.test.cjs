'use strict';
// @spec AC-11
// T-13: ≥1 file threshold — single-file modules are valid

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-threshold') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('threshold: single-file module (1 file) is emitted (AC-11)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/single.ts'); // exactly 1 file
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.summary.modules_detected, 1, 'single-file module must be detected');
  assert.equal(parsed.modules[0].name, 'app');
  assert.equal(parsed.modules[0].files_count, 1);
});

test('threshold: module with 3 files is emitted (AC-11)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/a.ts');
  makeFile(target, 'src/app/b.ts');
  makeFile(target, 'src/app/c.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.modules[0].files_count, 3);
});

test('threshold: empty dir (0 files) NOT emitted as module (AC-11)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, 'src/empty-mod'), { recursive: true }); // 0 files
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name);
  assert.ok(!names.includes('empty-mod'), 'Empty dir must NOT be emitted as module');
});
