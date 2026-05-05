'use strict';
// @spec AC-03
// T-05: H2 framework dirs detection + NC-1 src/-first priority rule

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-h2-fw') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('H2 framework: detects app/components/lib at root when no src/ (AC-03)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'app/page.tsx');
  makeFile(target, 'components/button.tsx');
  makeFile(target, 'lib/utils.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['app', 'components', 'lib']);
});

test('H2 framework: detects pages/api at root (AC-03)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'pages/index.tsx');
  makeFile(target, 'api/route.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.ok(names.includes('pages'));
  assert.ok(names.includes('api'));
});

test('H2 framework: NC-1 src/-first — framework dirs at root ignored when src/ present (AC-03)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/btn.tsx');
  makeFile(target, 'app/legacy.tsx');    // root framework dir — must be ignored
  makeFile(target, 'pages/index.tsx');  // root framework dir — must be ignored
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  // ONLY src/ subdirs
  assert.deepEqual(names, ['app', 'components']);
  // NOT pages (root)
  assert.ok(!names.includes('pages'), 'root pages/ must be ignored when src/ exists');
});

test('H2 framework: non-framework root dirs NOT detected (AC-03 boundary)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // Only non-framework dirs at root (no src/, no workspaces)
  makeFile(target, 'scripts/build.ts');
  makeFile(target, 'config/tsconfig.json');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  // scripts/ and config/ are not in framework list
  assert.equal(parsed.summary.modules_detected, 0);
  assert.equal(parsed.message, 'no modules inferred');
});
