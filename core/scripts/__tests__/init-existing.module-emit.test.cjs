'use strict';
// @spec AC-04
// T-06: Module file emission — schema fields, front-matter content

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkProject(prefix = 'soma-emit') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function makeFile(dir, relpath, content = '// stub\n') {
  const full = path.join(dir, relpath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('module emit: .soma/modules/{name}.md has schema=soma-module/v1 (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(content.includes('schema: soma-module/v1'), 'schema field must be present');
});

test('module emit: status=hypothesis (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(content.includes('status: hypothesis'), 'status must be hypothesis');
});

test('module emit: source_confidence=low (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(content.includes('source_confidence: low'), 'source_confidence must be low');
});

test('module emit: owners=[] (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(content.includes('owners: []'), 'owners must be empty array');
});

test('module emit: last_verified=null (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(content.includes('last_verified: null'), 'last_verified must be null');
});

test('module emit: verification.command=null (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  assert.ok(content.includes('command: null'), 'verification.command must be null');
});

test('module emit: verification.files_checked contains detected paths (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  const content = fs.readFileSync(path.join(target, '.soma/modules/app.md'), 'utf8');
  // files_checked should include the detected file path
  assert.ok(content.includes('page.tsx'), 'files_checked must include detected file path');
});

test('module emit: .soma/project.md + .soma/CONTEXT.md + .soma/manifest.json created (AC-04)', (t) => {
  const target = mkProject();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  makeFile(target, 'src/app/page.tsx');
  execFileSync('node', [INIT, '--existing', target, '--json'], { encoding: 'utf8', cwd: SOMA_HOME });
  assert.ok(fs.existsSync(path.join(target, '.soma/project.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/CONTEXT.md')));
  assert.ok(fs.existsSync(path.join(target, '.soma/manifest.json')));
});
