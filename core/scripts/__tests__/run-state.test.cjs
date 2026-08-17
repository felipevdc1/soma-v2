'use strict';
/**
 * run-state.test.cjs — integration test for `soma run state` (Spec 016, T-08)
 *
 * The contract-level assertions (superset, atomicity, append-only, legacy
 * mode) already live in contract-run-state.test.cjs (T-03) and are not
 * repeated here. This file covers behavior specific to this task's own
 * implementation choices that the contract test does not exercise:
 * `--set` transitions, runId resolution via `.soma.lock`, and the CLI's
 * own error paths.
 *
 * Article III: real filesystem, real temp dirs. Zero mocks.
 *
 * @task T-08
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const { resolveSomaPaths } = require(path.resolve(__dirname, '..', 'run', 'paths.cjs'));

function runRun(args, { cwd, env } = {}) {
  return spawnSync('node', [RUN_CLI, ...args], {
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

function makeLabProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-state-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

// @spec AC-03
test('T-08-01: --set transitions currentState and records previousState', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t08-set-01';
    runRun(['state', '--init', '--run', runId], { cwd: dir });
    const r = runRun(['state', '--run', runId, '--set', 'STEP_3_FOUNDATION'], { cwd: dir });
    assert.equal(r.status, 0, `--set must succeed. stderr: ${r.stderr}`);

    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.currentState, 'STEP_3_FOUNDATION');
    assert.equal(state.previousState, 'IDLE', 'previousState must capture what currentState was before this --set');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
test('T-08-02: --set without --run resolves the run via .soma.lock', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t08-lock-01';
    runRun(['state', '--init', '--run', runId], { cwd: dir });
    fs.writeFileSync(
      path.join(dir, '.soma.lock'),
      JSON.stringify({ sessionId: 'lock-session', runId, startedAt: new Date().toISOString() })
    );

    const r = runRun(['state', '--set', 'STEP_4_WAVES'], { cwd: dir });
    assert.equal(r.status, 0, `--set must resolve runId from .soma.lock when --run is omitted. stderr: ${r.stderr}`);

    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.currentState, 'STEP_4_WAVES');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
test('T-08-03: --set without --run and without a readable .soma.lock names both resolution paths and exits non-zero', () => {
  const dir = makeLabProject();
  try {
    const r = runRun(['state', '--set', 'DONE'], { cwd: dir });
    assert.notEqual(r.status, 0, 'must not succeed with no way to resolve runId');
    assert.ok(
      /--run/.test(r.stderr) && /\.soma\.lock/.test(r.stderr),
      `error must name both resolution paths (--run and .soma.lock). Got: ${r.stderr}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
test('T-08-04: --set on a run with no prior state file fails, naming the missing --init', () => {
  const dir = makeLabProject();
  try {
    const r = runRun(['state', '--run', 'run-never-initialized', '--set', 'STEP_2_TASKS'], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.ok(/--init/.test(r.stderr), `error must point at --init as the fix. Got: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
