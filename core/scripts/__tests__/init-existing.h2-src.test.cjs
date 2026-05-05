'use strict';
// @spec AC-01
// T-03: H2 src/ subdirs detection integration tests

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-h2-src') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('H2 src/: detects 3 src/ subdirs as module candidates (AC-01)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/button.tsx');
  makeFile(target, 'src/lib/utils.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.heuristic, 'H2');
  assert.equal(parsed.branch, 'existing');
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['app', 'components', 'lib']);
  assert.ok(parsed.modules.every(m => m.source_path.startsWith('src/')));
  assert.ok(parsed.modules.every(m => m.files_count >= 1));
});

test('H2 src/: empty src/ subdir (0 files) NOT emitted as module (AC-01 + AC-11)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  fs.mkdirSync(path.join(target, 'src/empty'), { recursive: true }); // empty dir
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name);
  assert.ok(!names.includes('empty'), 'Empty dir must not be emitted as module');
  assert.ok(names.includes('app'));
});

test('H2 src/: blacklisted dirs in src/ are skipped', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/node_modules/dep/index.js'); // should be blacklisted
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name);
  assert.ok(!names.includes('node_modules'), 'node_modules must be blacklisted');
  assert.ok(names.includes('app'));
});

test('H2 src/: .soma/modules/{name}.md files created for each module', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/api/route.ts');
  makeFile(target, 'src/services/auth.ts');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/api.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/modules/services.md')));
});

test('H2 src/: source_path in JSON output uses src/ prefix', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/core/engine.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  assert.equal(parsed.modules[0].source_path, 'src/core/');
});
