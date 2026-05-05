'use strict';
// @spec AC-06
// T-08: --deep no-git fallback

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-dfallback') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('--deep fallback: heuristic=H2 when no .git/ present (AC-06)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx'); // no git init
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H2', 'heuristic must be H2 when no .git/');
});

test('--deep fallback: git_repo_detected=false (AC-06)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.git_repo_detected, false);
});

test('--deep fallback: warning message contains "no git history" (AC-06)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.warnings), 'warnings must be an array');
  assert.ok(parsed.warnings.some(w => w.includes('no git history')), 'warning must mention "no git history"');
});

test('--deep fallback: exit 0 (NOT exit 1) when no .git/ (AC-06)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  // execFileSync only throws on non-zero exit — success here means exit 0
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(out.length > 0, 'should produce JSON output on exit 0');
});

test('--deep fallback: H2 modules are still emitted on fallback (AC-06)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/lib/utils.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.ok(parsed.modules.length >= 2, 'H2 modules must still be emitted on fallback');
});
