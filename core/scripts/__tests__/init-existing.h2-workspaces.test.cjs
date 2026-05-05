'use strict';
// @spec AC-02
// T-04: H2 package.json workspaces detection

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-h2-ws') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('H2 workspaces: glob pattern packages/* detected (AC-02)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'monorepo',
    workspaces: ['packages/*']
  }));
  makeFile(target, 'packages/core/index.ts');
  makeFile(target, 'packages/utils/index.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.ok(names.includes('core'));
  assert.ok(names.includes('utils'));
});

test('H2 workspaces: direct path workspace (no glob) detected (AC-02)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'monorepo',
    workspaces: ['packages/foo', 'packages/bar']
  }));
  makeFile(target, 'packages/foo/index.ts');
  makeFile(target, 'packages/bar/index.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name).sort();
  assert.deepEqual(names, ['bar', 'foo']);
});

test('H2 workspaces: workspaces not detected when src/ exists (NC-1 src/-first) (AC-02)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // Both src/ AND workspaces — src/ wins per NC-1
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'hybrid',
    workspaces: ['packages/foo']
  }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'packages/foo/index.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name);
  assert.ok(names.includes('app'), 'src/ subdir must be detected');
  assert.ok(!names.includes('foo'), 'workspace must NOT be detected when src/ exists');
});

test('H2 workspaces: empty workspace path NOT emitted (AC-11 threshold)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'monorepo',
    workspaces: ['packages/empty', 'packages/full']
  }));
  fs.mkdirSync(path.join(target, 'packages/empty'), { recursive: true }); // empty
  makeFile(target, 'packages/full/index.ts');
  const out = execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const parsed = JSON.parse(out);
  const names = parsed.modules.map(m => m.name);
  assert.ok(!names.includes('empty'), 'Empty workspace must not be emitted');
  assert.ok(names.includes('full'));
});
