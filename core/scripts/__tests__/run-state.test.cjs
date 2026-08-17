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
const { appendReport } = require(path.resolve(__dirname, '..', 'run', 'state.cjs'));

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

// ── Module API: appendReport() — added for T-06 to call, per team lead's
// gap report (plan.md:16 / contracts/emit-step-report.md's "Side Effects"
// assign appending to reports[] to CONTRACT-RUN-STATE-02, but nothing
// wires report.cjs -> state.cjs). This file only proves the primitive
// works; the actual T-06 -> T-08 wiring is a separate task.

// @spec AC-03
test('T-08-05: appendReport() requires the module, not the CLI subprocess, and never triggers process.exit as a side effect of require()', () => {
  // If this test file itself is still running after the top-level
  // `require('../run/state.cjs')`, the require.main guard held. If the
  // guard were missing, `main()` would have called process.exit() while
  // loading this file, and node --test would never have reached this
  // assertion at all.
  assert.equal(typeof appendReport, 'function');
});

// @spec AC-03
test('T-08-06: appendReport() appends a new reports[] entry, with a path derived from {runId, step}', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t08-append-01';
    runRun(['state', '--init', '--run', runId], { cwd: dir });

    const finishedAt = new Date().toISOString();
    const result = appendReport({
      projectRoot: dir,
      runId,
      step: 'STEP_1A_SPECIFY',
      status: 'pass',
      finishedAt,
    });

    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
    assert.deepEqual(result.entry, {
      step: 'STEP_1A_SPECIFY',
      status: 'pass',
      path: `.soma/reports/${runId}/STEP_1A_SPECIFY-report.json`,
      finished_at: finishedAt,
    });

    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.reports.length, 1);
    assert.deepEqual(state.reports[0], result.entry);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
test('T-08-07: appendReport() is append-only across two calls for different steps — neither entry overwrites the other', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t08-append-02';
    runRun(['state', '--init', '--run', runId], { cwd: dir });

    const r1 = appendReport({ projectRoot: dir, runId, step: 'STEP_1A_SPECIFY', status: 'pass', finishedAt: new Date().toISOString() });
    const r2 = appendReport({ projectRoot: dir, runId, step: 'STEP_1B_PLAN', status: 'pass', finishedAt: new Date().toISOString() });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.reports.length, 2, `expected 2 accumulated entries, got: ${JSON.stringify(state.reports)}`);
    const steps = state.reports.map((e) => e.step);
    assert.deepEqual(steps, ['STEP_1A_SPECIFY', 'STEP_1B_PLAN']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
test('T-08-08: appendReport() on a run with no state file returns { ok:false, reason } instead of throwing', () => {
  const dir = makeLabProject();
  try {
    const result = appendReport({
      projectRoot: dir,
      runId: 'run-never-initialized',
      step: 'STEP_1A_SPECIFY',
      status: 'pass',
      finishedAt: new Date().toISOString(),
    });
    assert.equal(result.ok, false);
    assert.ok(/--init/.test(result.reason), `reason must point at --init as the fix. Got: ${result.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
test('T-08-09: appendReport() rejects an invalid status instead of writing garbage to the ledger', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t08-append-invalid-01';
    runRun(['state', '--init', '--run', runId], { cwd: dir });

    const result = appendReport({
      projectRoot: dir,
      runId,
      step: 'STEP_1A_SPECIFY',
      status: 'done', // not in the pass|fail|blocked enum
      finishedAt: new Date().toISOString(),
    });
    assert.equal(result.ok, false, 'an out-of-enum status must be rejected, not silently accepted');

    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.reports.length, 0, 'the rejected entry must not have reached the ledger');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
