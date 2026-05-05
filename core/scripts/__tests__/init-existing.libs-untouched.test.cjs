'use strict';
// @spec AC-08
// T-10: Zero modification of Phase 2/3 libs (shasum pre/post check)

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');
const LIB_DIR = path.join(SOMA_HOME, 'scripts', 'lib');

const PROTECTED_LIBS = [
  'anchored-blocks.cjs',
  'manifest.cjs',
  'template-engine.cjs',
  'agents-md-injector.cjs'
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function mkProject(prefix = 'soma-libs') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('libs-untouched: Phase 2/3 libs sha256 unchanged after init --existing (AC-08)', (t) => {
  // Capture pre-state
  const before = {};
  for (const lib of PROTECTED_LIBS) {
    const p = path.join(LIB_DIR, lib);
    before[lib] = sha256File(p);
  }

  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  makeFile(target, 'src/components/btn.tsx');

  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });

  // Verify after-state
  for (const lib of PROTECTED_LIBS) {
    const p = path.join(LIB_DIR, lib);
    const after = sha256File(p);
    assert.equal(before[lib], after, `Phase 2/3 lib was modified: ${lib}`);
  }
});

test('libs-untouched: libs still have same sha after redirect path (AC-08)', (t) => {
  const before = {};
  for (const lib of PROTECTED_LIBS) {
    before[lib] = sha256File(path.join(LIB_DIR, lib));
  }

  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, '.soma'), { recursive: true }); // trigger redirect
  try {
    execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  } catch (e) { /* exit 1 expected */ }

  for (const lib of PROTECTED_LIBS) {
    const after = sha256File(path.join(LIB_DIR, lib));
    assert.equal(before[lib], after, `Phase 2/3 lib was modified on redirect path: ${lib}`);
  }
});
