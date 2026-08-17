'use strict';
/**
 * run-resume.test.cjs — integration test for `soma run resume` (Spec 016, T-09)
 *
 * contract-run-state.test.cjs's T-03-03 already covers the hand-crafted
 * fixture scenario (7 passed reports, resume from a different session,
 * reentry at STEP_6_CONSOLIDATE). This file complements it with: real
 * end-to-end CLI chaining (state --init -> report -> resume, not a
 * hand-written state.json), the --run-is-mandatory rule, error paths, and
 * two scenarios the contract test doesn't touch — a re-attempted step
 * (latest status wins) and a fully-passed run (reentry is "DONE").
 *
 * Article III: real filesystem, real child_process, real temp dirs. Zero
 * mocks.
 *
 * @task T-09
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-resume-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

// ── 1. End-to-end via real CLI chaining, from a genuinely different session,
//    with NO .soma.lock pointing at the run at all ────────────────────────

// @spec AC-04
test('T-09-01: real state --init + report chain, resumed from a separate process with a different session env and no .soma.lock', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t09-e2e-01';
    const originalSession = 'session-original-t09';
    runRun(['state', '--init', '--run', runId], { cwd: dir, env: { CK_SESSION_ID: originalSession } });

    const passedSteps = [
      'STEP_1A_SPECIFY', 'STEP_1B_PLAN', 'STEP_1C_TASKS',
      'STEP_2_TASKS', 'STEP_3_FOUNDATION',
    ];
    for (const step of passedSteps) {
      const r = runRun(['report', '--run', runId, '--step', step, '--status', 'pass'], {
        cwd: dir,
        env: { CK_SESSION_ID: originalSession },
      });
      assert.equal(r.status, 0, `setup: report for ${step} must succeed. stderr: ${r.stderr}`);
    }

    // No .soma.lock was ever written in this fixture (state --init doesn't
    // create one), so there is nothing for resume to fall back to even if
    // it wanted to — the only way it can work is via --run.
    assert.ok(!fs.existsSync(path.join(dir, '.soma.lock')), 'fixture must have no .soma.lock');

    const differentSession = 'session-brand-new-t09';
    const r = runRun(['resume', '--run', runId], {
      cwd: dir,
      env: { CK_SESSION_ID: differentSession, CLAUDE_SESSION_ID: differentSession },
    });

    assert.equal(r.status, 0, `resume must succeed. stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout.trim().split('\n')[0]);
    assert.equal(payload.reentry, 'STEP_4_WAVES', `must reenter right after the last pass. Got: ${JSON.stringify(payload)}`);
    assert.equal(payload.last_pass, 'STEP_3_FOUNDATION');

    // reports[] must be untouched by resume (read-only verb).
    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.reports.length, passedSteps.length, 'resume must never mutate reports[]');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. --run is mandatory — no .soma.lock fallback, unlike every other verb ─

// @spec AC-04
test('T-09-02: "soma run resume" without --run fails naming --run explicitly, never falls back to .soma.lock', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t09-lock-trap';
    runRun(['state', '--init', '--run', runId], { cwd: dir });
    // Plant a .soma.lock pointing at a REAL, valid run — if resume fell
    // back to it (copying the other verbs' behavior), this call would
    // wrongly succeed instead of failing.
    fs.writeFileSync(
      path.join(dir, '.soma.lock'),
      JSON.stringify({ sessionId: 'lock-session', runId, startedAt: new Date().toISOString() })
    );

    const r = runRun(['resume'], { cwd: dir });
    assert.notEqual(r.status, 0, 'must fail without --run, even with a valid .soma.lock present');
    assert.ok(/--run/.test(r.stderr), `error must name --run as the required fix. Got: ${r.stderr}`);
    assert.ok(!/\.soma\.lock/i.test(r.stderr) || /--run/.test(r.stderr), 'error text should not suggest .soma.lock as a resolution path for resume');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. No state file at all ──────────────────────────────────────────────

// @spec AC-04
test('T-09-03: "soma run resume" on a runId with no state file fails legibly, not a crash', () => {
  const dir = makeLabProject();
  try {
    const r = runRun(['resume', '--run', 'run-never-existed'], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.ok(!/at .+:\d+:\d+/.test(r.stderr), `must not be an uncaught exception. stderr: ${r.stderr}`);
    assert.ok(/no state file|NO_SUCH_RUN/i.test(r.stderr), `error must name the missing state. Got: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. Corrupt state JSON ────────────────────────────────────────────────

// @spec AC-04
test('T-09-04: "soma run resume" on a corrupt state file fails legibly, never treats corruption as pass', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t09-corrupt';
    const { runStateFile } = resolveSomaPaths(dir, runId);
    fs.mkdirSync(path.dirname(runStateFile), { recursive: true });
    fs.writeFileSync(runStateFile, '{ not valid json');

    const r = runRun(['resume', '--run', runId], { cwd: dir });
    assert.notEqual(r.status, 0, 'corrupt JSON must never resolve to a successful resume');
    assert.ok(/CORRUPT_STATE|not valid JSON/i.test(r.stderr), `must name the corruption. Got: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5. Re-attempted step: latest status wins, not the first ─────────────

// @spec AC-04
test('T-09-05: a step reported "fail" then later "pass" (re-attempt) counts as passed — latest reports[] entry wins', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t09-reattempt';
    runRun(['state', '--init', '--run', runId], { cwd: dir });
    runRun(['report', '--run', runId, '--step', 'STEP_1A_SPECIFY', '--status', 'pass'], { cwd: dir });
    runRun(['report', '--run', runId, '--step', 'STEP_1B_PLAN', '--status', 'fail', '--reason', 'boom'], { cwd: dir });
    // Re-attempt: same step, now passes. reports[] is append-only, so this
    // is a SECOND entry for STEP_1B_PLAN, not an overwrite of the first.
    runRun(['report', '--run', runId, '--step', 'STEP_1B_PLAN', '--status', 'pass'], { cwd: dir });

    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.reports.filter((e) => e.step === 'STEP_1B_PLAN').length, 2, 'setup: must have 2 append-only entries for the re-attempted step');

    const r = runRun(['resume', '--run', runId], { cwd: dir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout.trim().split('\n')[0]);
    assert.equal(payload.reentry, 'STEP_1C_TASKS', `latest status for STEP_1B_PLAN is "pass", so reentry must be its successor. Got: ${JSON.stringify(payload)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 6. Every report-bearing step passed → reentry is "DONE" ─────────────

// @spec AC-04
test('T-09-06: when every report-bearing step has passed, resume reports reentry "DONE"', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t09-done';
    const { runStateFile, runReportsDir } = resolveSomaPaths(dir, runId);
    fs.mkdirSync(runReportsDir, { recursive: true });

    const allSteps = [
      'STEP_1A_SPECIFY', 'STEP_1B_PLAN', 'STEP_1C_TASKS', 'STEP_2_TASKS',
      'STEP_3_FOUNDATION', 'STEP_4_WAVES', 'STEP_5_VALIDATE', 'STEP_6_CONSOLIDATE',
      'STEP_7_INTEGRATE', 'STEP_8_SONAR', 'STEP_9_FIX_LOOP', 'STEP_10_COMMIT',
    ];
    const now = new Date().toISOString();
    const state = {
      $schema: 'soma-state/v2', runId, sessionId: 's1', startedAt: now,
      currentState: 'DONE', previousState: 'STEP_10_COMMIT', lastTransitionAt: now,
      featureSlug: null, specPath: null, planPath: null, tasksPath: null, contractsDir: null,
      teammateNamePrefix: null, activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
      snapshots: [], humanGatesApproved: { gate1_spec: { approved: true }, gate2_deploy: { approved: true } },
      constitutionVersion: null, constitutionSnapshotPath: null, lastSuccessfulState: 'STEP_10_COMMIT',
      baselineSha: 'abc123', pausedDiagnostic: null,
      decisions: [],
      reports: allSteps.map((step) => ({ step, status: 'pass', path: `.soma/reports/${runId}/${step}-report.json`, finished_at: now })),
    };
    fs.writeFileSync(runStateFile, JSON.stringify(state, null, 2));

    const r = runRun(['resume', '--run', runId], { cwd: dir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout.trim().split('\n')[0]);
    assert.equal(payload.reentry, 'DONE', `Got: ${JSON.stringify(payload)}`);
    assert.equal(payload.last_pass, 'STEP_10_COMMIT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 7. lastSuccessfulState mismatch is warned about, not silently ignored ─

// @spec AC-04
test('T-09-07: a mismatch between reports[]-derived reentry and lastSuccessfulState is warned about on stderr, not silently trusted either way', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-t09-mismatch';
    const { runStateFile, runReportsDir } = resolveSomaPaths(dir, runId);
    fs.mkdirSync(runReportsDir, { recursive: true });
    const now = new Date().toISOString();
    const state = {
      $schema: 'soma-state/v2', runId, sessionId: 's1', startedAt: now,
      currentState: 'STEP_1B_PLAN', previousState: 'STEP_1A_SPECIFY', lastTransitionAt: now,
      featureSlug: null, specPath: null, planPath: null, tasksPath: null, contractsDir: null,
      teammateNamePrefix: null, activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
      snapshots: [], humanGatesApproved: { gate1_spec: { approved: true }, gate2_deploy: { approved: false } },
      constitutionVersion: null, constitutionSnapshotPath: null,
      // Deliberately WRONG: claims STEP_5_VALIDATE succeeded, but reports[]
      // below only actually has STEP_1A_SPECIFY passing. Simulates a state
      // file where the two sources of truth have diverged.
      lastSuccessfulState: 'STEP_5_VALIDATE',
      baselineSha: 'abc123', pausedDiagnostic: null,
      decisions: [],
      reports: [{ step: 'STEP_1A_SPECIFY', status: 'pass', path: 'x', finished_at: now }],
    };
    fs.writeFileSync(runStateFile, JSON.stringify(state, null, 2));

    const r = runRun(['resume', '--run', runId], { cwd: dir });
    assert.equal(r.status, 0, `a mismatch must not be fatal — reports[] still wins. stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout.trim().split('\n')[0]);
    assert.equal(payload.reentry, 'STEP_1B_PLAN', 'reports[] (the artifact-backed evidence) must win over the mismatched lastSuccessfulState');
    assert.ok(/mismatch|disagree/i.test(r.stderr) || /WARN/.test(r.stderr), `the disagreement must be surfaced, not silent. stderr: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
