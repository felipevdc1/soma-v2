'use strict';
// @spec AC-05
// Integration tests for placeholder substitution correctness.
// Verifies: no {{}} remain in any output file, PROJECT_NAME = basename, ISO8601_DATE = ISO8601 UTC.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function mkFixture(prefix = 'soma-init-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runInit(args = []) {
  return spawnSync('node', [INIT, ...args], {
    encoding: 'utf8',
    timeout: 15000
  });
}

// ---- AC-05: No remaining placeholders in output files ----

test('placeholders: no {{}} remains in project.md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const content = fs.readFileSync(path.join(target, '.soma', 'project.md'), 'utf8');
  assert.ok(!content.includes('{{'), `project.md must not contain remaining {{: ${content.slice(0, 200)}`);
});

test('placeholders: no {{}} remains in CONTEXT.md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const content = fs.readFileSync(path.join(target, '.soma', 'CONTEXT.md'), 'utf8');
  assert.ok(!content.includes('{{'), `CONTEXT.md must not contain remaining {{: ${content.slice(0, 200)}`);
});

test('placeholders: no {{}} remains in modules/index.md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const content = fs.readFileSync(path.join(target, '.soma', 'modules', 'index.md'), 'utf8');
  assert.ok(!content.includes('{{'), `modules/index.md must not contain remaining {{: ${content.slice(0, 200)}`);
});

test('placeholders: no {{}} remains in AGENTS.md (--with-agents-md)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(!content.includes('{{'), `AGENTS.md must not contain remaining {{: ${content.slice(0, 200)}`);
});

// ---- PROJECT_NAME substitution ----

test('placeholders: PROJECT_NAME replaced by basename in project.md', (t) => {
  const target = mkFixture('soma-init-test');
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const projectName = path.basename(target);
  const content = fs.readFileSync(path.join(target, '.soma', 'project.md'), 'utf8');
  assert.ok(
    content.includes(projectName),
    `project.md must contain basename "${projectName}". Got: ${content.slice(0, 200)}`
  );
});

test('placeholders: PROJECT_NAME replaced by basename in CONTEXT.md', (t) => {
  const target = mkFixture('soma-init-test');
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const projectName = path.basename(target);
  const content = fs.readFileSync(path.join(target, '.soma', 'CONTEXT.md'), 'utf8');
  assert.ok(
    content.includes(projectName),
    `CONTEXT.md must contain basename "${projectName}"`
  );
});

test('placeholders: PROJECT_NAME replaced by basename in modules/index.md', (t) => {
  const target = mkFixture('soma-init-test');
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const projectName = path.basename(target);
  const content = fs.readFileSync(path.join(target, '.soma', 'modules', 'index.md'), 'utf8');
  assert.ok(
    content.includes(projectName),
    `modules/index.md must contain basename "${projectName}"`
  );
});

test('placeholders: PROJECT_NAME replaced by basename in AGENTS.md (--with-agents-md)', (t) => {
  const target = mkFixture('soma-init-test');
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const projectName = path.basename(target);
  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(
    content.includes(projectName),
    `AGENTS.md must contain basename "${projectName}"`
  );
});

// ---- ISO8601_DATE substitution ----

test('placeholders: ISO8601_DATE replaced by ISO8601 UTC string in project.md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const content = fs.readFileSync(path.join(target, '.soma', 'project.md'), 'utf8');
  // Find any ISO8601 timestamp
  const matches = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g);
  assert.ok(matches && matches.length > 0, `project.md must contain ISO8601 UTC timestamp. Got: ${content}`);
  // Each match must satisfy the regex
  for (const m of matches) {
    assert.match(m, ISO8601_REGEX, `Timestamp "${m}" must match ISO8601 regex`);
  }
});

test('placeholders: ISO8601_DATE replaced by ISO8601 UTC string in CONTEXT.md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const content = fs.readFileSync(path.join(target, '.soma', 'CONTEXT.md'), 'utf8');
  const matches = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g);
  assert.ok(matches && matches.length > 0, `CONTEXT.md must contain ISO8601 UTC timestamp`);
});

test('placeholders: ISO8601_DATE replaced by ISO8601 UTC string in modules/index.md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target]);

  const content = fs.readFileSync(path.join(target, '.soma', 'modules', 'index.md'), 'utf8');
  const matches = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g);
  assert.ok(matches && matches.length > 0, `modules/index.md must contain ISO8601 UTC timestamp`);
});

// ---- grep-L-equivalent: confirm all files placeholders-free ----

test('placeholders: all .soma/ output files are free of {{}} (recursive check)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const filesToCheck = [
    path.join(target, '.soma', 'project.md'),
    path.join(target, '.soma', 'CONTEXT.md'),
    path.join(target, '.soma', 'modules', 'index.md'),
    path.join(target, 'AGENTS.md')
  ];

  for (const f of filesToCheck) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(
      !content.includes('{{'),
      `File ${path.relative(target, f)} must not contain remaining {{ placeholder. Content: ${content.slice(0, 200)}`
    );
  }
});
