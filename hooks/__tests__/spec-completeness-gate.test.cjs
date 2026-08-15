#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'spec-completeness-gate.cjs');
const SESSION = 'test-scg-' + process.pid;

function stateFile() { return path.join(os.tmpdir(), `soma-state-${SESSION}.json`); }
function bypassMarker() { return path.join(os.tmpdir(), `soma-spec-bypass-${SESSION}.marker`); }

function run(command, extraEnv = {}) {
  const input = JSON.stringify({ tool_input: { command } });
  return spawnSync(process.execPath, [HOOK], {
    input,
    env: { ...process.env, CK_SESSION_ID: SESSION, ...extraEnv },
    encoding: 'utf-8',
  });
}

function writeState(specPath, tasksPath) {
  fs.writeFileSync(stateFile(), JSON.stringify({ specPath, tasksPath }));
}

function cleanup() {
  for (const f of [stateFile(), bypassMarker()]) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLEAN_SPEC = `
AC-1: User can log in
AC-2: User can log out
`;

const SPEC_WITH_MARKERS = `
AC-1: User can log in [NEEDS CLARIFICATION: which provider?]
AC-2: User can log out [NEEDS CLARIFICATION: session timeout?]
`;

const TASKS_ALL_COVERED = `
- Implement login [SPEC:AC-1]
- Implement logout [SPEC:AC-2]
`;

const TASKS_PARTIAL = `
- Implement login [SPEC:AC-1]
`;

// ── Tests ────────────────────────────────────────────────────────────────────

test('1. no state file → pass', () => {
  cleanup();
  const r = run('git commit -m "feat: x"');
  assert.equal(r.status, 0, 'should exit 0');
});

test('2. state + spec with 2 markers → block exit 2', (t) => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  fs.writeFileSync(spec, SPEC_WITH_MARKERS);
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  fs.unlinkSync(spec);
  cleanup();
  assert.equal(r.status, 2, 'should block');
  assert.match(r.stderr, /SPEC INCOMPLETE: 2 markers? open/);
});

test('3. state + clean spec + all ACs covered → allow', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  const tasks = path.join(os.tmpdir(), `tasks-scg-${SESSION}.md`);
  fs.writeFileSync(spec, CLEAN_SPEC);
  fs.writeFileSync(tasks, TASKS_ALL_COVERED);
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  fs.unlinkSync(spec);
  fs.unlinkSync(tasks);
  cleanup();
  assert.equal(r.status, 0, 'should allow');
});

test('4. state + clean spec + 1 uncovered AC → block with AC ID', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  const tasks = path.join(os.tmpdir(), `tasks-scg-${SESSION}.md`);
  fs.writeFileSync(spec, CLEAN_SPEC);
  fs.writeFileSync(tasks, TASKS_PARTIAL);
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  fs.unlinkSync(spec);
  fs.unlinkSync(tasks);
  cleanup();
  assert.equal(r.status, 2, 'should block');
  assert.match(r.stderr, /AC-2/);
});

test('5. git commit --amend --no-edit → pass (exempt)', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  fs.writeFileSync(spec, SPEC_WITH_MARKERS);
  writeState(spec, null);
  const r = run('git commit --amend --no-edit');
  fs.unlinkSync(spec);
  cleanup();
  assert.equal(r.status, 0, 'should be exempt');
});

test('6. bypass marker exists → allow + marker consumed', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  fs.writeFileSync(spec, SPEC_WITH_MARKERS);
  writeState(spec, null);
  fs.writeFileSync(bypassMarker(), '');
  const r = run('git commit -m "feat: bypass"');
  fs.unlinkSync(spec);
  cleanup();
  assert.equal(r.status, 0, 'should allow via bypass');
  assert.equal(fs.existsSync(bypassMarker()), false, 'marker should be consumed');
});

test('7. malformed state JSON → fail-open with stderr warning', () => {
  cleanup();
  fs.writeFileSync(stateFile(), '{invalid json}');
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, 'should fail-open');
  assert.match(r.stderr, /WARN/);
});
