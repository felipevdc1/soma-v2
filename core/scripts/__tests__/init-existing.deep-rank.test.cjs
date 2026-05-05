'use strict';
// @spec AC-05
// T-07: --deep git-history-ranked detection

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-deep') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('--deep: heuristic=H1 when .git/ present (AC-05)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/active/code.ts');
  execSync('git init && git add . && git -c user.email=t@t.com -c user.name=T commit -m initial', { cwd: target, stdio: 'ignore' });
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H1');
  assert.equal(parsed.git_repo_detected, true);
});

test('--deep: modules with ≥1 commit in 90d are emitted (AC-05)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/active/code.ts');
  makeFile(target, 'src/dormant/old.ts');
  execSync('git init && git add . && git -c user.email=t@t.com -c user.name=T commit -m initial', { cwd: target, stdio: 'ignore' });
  for (let i = 0; i < 5; i++) {
    makeFile(target, 'src/active/code.ts', `// v${i}\n`);
    execSync(`git add . && git -c user.email=t@t.com -c user.name=T commit -m "v${i}"`, { cwd: target, stdio: 'ignore' });
  }
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name);
  assert.ok(names.includes('active'), 'active module must be emitted');
  assert.ok(names.includes('dormant'), 'dormant module (initial commit counts) must be emitted');
});

test('--deep: commit_count_90d field present on modules (AC-05)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.ts');
  execSync('git init && git add . && git -c user.email=t@t.com -c user.name=T commit -m initial', { cwd: target, stdio: 'ignore' });
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.ok(parsed.modules.length > 0, 'At least one module must be emitted');
  assert.ok(typeof parsed.modules[0].commit_count_90d === 'number', 'commit_count_90d must be a number');
  assert.ok(parsed.modules[0].commit_count_90d >= 1, 'commit_count_90d must be >= 1');
});

test('--deep: deep_window_days=90 in output (AC-05 + NC-2)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.ts');
  execSync('git init && git add . && git -c user.email=t@t.com -c user.name=T commit -m initial', { cwd: target, stdio: 'ignore' });
  const out = execFileSync('node', [INIT, '--existing', target, '--deep', '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.deep_window_days, 90, 'deep_window_days must be hardcoded 90');
});
