'use strict';
/**
 * run-legacy-mode.test.cjs — AC-08 integration test (Spec 016, T-14)
 *
 * Proves the three `.soma/`-touching verbs (`state`, `report`, `gate`) all
 * warn identically on a legacy project (no `.soma/`) and none of them
 * crashes — the gap the team lead's dispatch named: `state.cjs` already
 * warned (T-08), `report.cjs`/`gate.cjs` didn't, so AC-08 coverage was
 * partial and silent before this task.
 *
 * "Never a fatal error" is read here as "never an uncaught exception / node
 * stack trace" — NOT "never a non-zero exit". `gate`'s pre-existing "report
 * ausente" exit 2 and `report`'s pre-existing "state not initialized" exit
 * 2 are legible, intentional `fail()` calls (JSON reason on stderr) that
 * exist independently of legacy status; AC-08 protects against the
 * crash-on-missing-directory class of bug, not against those designed
 * blocking paths.
 *
 * Article III: real filesystem, real temp dirs, real child_process. Zero
 * mocks.
 *
 * @spec AC-08
 * @task T-14
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');

function runRun(args, { cwd } = {}) {
  return spawnSync('node', [RUN_CLI, ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    timeout: 15000,
  });
}

/** Fresh project, git-initialized, deliberately WITHOUT `.soma/` — pre-v3, never ran `soma install`. */
function makeLegacyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-legacy-mode-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function noStackTrace(text) {
  // Node's uncaught-exception stack traces always include a "    at " frame
  // line and typically a "Node.js v" version banner. A legible fail() JSON
  // error never does.
  return !/^\s*at .+\(.*:\d+:\d+\)/m.test(text) && !/Node\.js v\d/.test(text);
}

// ── 1. state --init on a legacy project warns and self-heals ──────────────

// @spec AC-08
test('T-14-01: "soma run state --init" on a legacy project warns, exits 0, never a stack trace', () => {
  const dir = makeLegacyProject();
  try {
    assert.ok(!fs.existsSync(path.join(dir, '.soma')), 'fixture must start without .soma/');
    const r = runRun(['state', '--init', '--run', 'run-legacy-t14-01'], { cwd: dir });
    assert.equal(r.status, 0, `must exit 0, never fatal. stderr: ${r.stderr}`);
    assert.ok(/legac|legad/i.test(r.stderr), `must name the degradation. Got: ${r.stderr}`);
    assert.ok(noStackTrace(r.stderr), `must never be an uncaught exception. stderr: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. report --step on a legacy project, standalone (no prior --init) ────

// @spec AC-08
test('T-14-02: "soma run report" on a legacy project, called standalone (no prior state --init), warns and never crashes with a stack trace — even though the append-to-state step still fails legibly', () => {
  const dir = makeLegacyProject();
  try {
    const r = runRun(
      ['report', '--run', 'run-legacy-t14-02', '--step', 'STEP_1A_SPECIFY', '--status', 'pass'],
      { cwd: dir }
    );
    assert.ok(/legac|legad/i.test(r.stderr), `must name the degradation even standalone. Got: ${r.stderr}`);
    assert.ok(noStackTrace(r.stderr), `must never be an uncaught exception. stderr: ${r.stderr}`);
    // Pre-existing, non-legacy-specific behavior: report.cjs requires a
    // state file to append to (T-06's design, unchanged by T-14) — a
    // controlled exit 2 with a JSON reason, not a crash. Assert it stays
    // controlled, not that it magically succeeds (that would be a
    // different task's scope — see T-14's final report).
    if (r.status !== 0) {
      assert.doesNotThrow(() => JSON.parse(r.stderr.trim().split('\n').pop()), 'a non-zero exit must still be a legible JSON reason, not a raw crash');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. report --step on a legacy project AFTER state --init bootstrapped it ─

// @spec AC-08
test('T-14-03: "soma run report" succeeds end-to-end on a project that started legacy but was bootstrapped by a prior "state --init"', () => {
  const dir = makeLegacyProject();
  try {
    const runId = 'run-legacy-t14-03';
    const initR = runRun(['state', '--init', '--run', runId], { cwd: dir });
    assert.equal(initR.status, 0, `bootstrap must succeed. stderr: ${initR.stderr}`);
    assert.ok(fs.existsSync(path.join(dir, '.soma')), '.soma/ must exist after --init self-heals it');

    const reportR = runRun(
      ['report', '--run', runId, '--step', 'STEP_1A_SPECIFY', '--status', 'pass'],
      { cwd: dir }
    );
    assert.equal(reportR.status, 0, `report must succeed once .soma/ exists. stderr: ${reportR.stderr}`);
    // .soma/ already existed by the time report.cjs ran, so ITS OWN legacy
    // check correctly finds nothing to warn about — no double-warning.
    assert.ok(!/legac|legad/i.test(reportR.stderr), `no second legacy warning expected once .soma/ exists. Got: ${reportR.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. gate --step on a legacy project, standalone ─────────────────────────

// @spec AC-08
test('T-14-04: "soma run gate --step" on a legacy project warns and never crashes with a stack trace', () => {
  const dir = makeLegacyProject();
  try {
    const r = runRun(['gate', '--run', 'run-legacy-t14-04', '--step', 'STEP_1B_PLAN'], { cwd: dir });
    assert.ok(/legac|legad/i.test(r.stderr), `must name the degradation. Got: ${r.stderr}`);
    assert.ok(noStackTrace(r.stderr), `must never be an uncaught exception. stderr: ${r.stderr}`);
    // Pre-existing, non-legacy-specific behavior: no report exists to gate
    // on, so this blocks (exit 2) exactly as it would in a non-legacy
    // project missing the same report — a designed, legible block, not a
    // crash.
    assert.equal(r.status, 2, `must block legibly (report absent), not crash. stderr: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5. gate --validate on a legacy project ──────────────────────────────────

// @spec AC-08
test('T-14-05: "soma run gate --validate" on a legacy project warns and never crashes with a stack trace', () => {
  const dir = makeLegacyProject();
  try {
    const r = runRun(
      ['gate', '--run', 'run-legacy-t14-05', '--validate', 'T-99', '--validator', 'someone'],
      { cwd: dir }
    );
    assert.ok(/legac|legad/i.test(r.stderr), `must name the degradation. Got: ${r.stderr}`);
    assert.ok(noStackTrace(r.stderr), `must never be an uncaught exception. stderr: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 6. Consistency: all three verbs use the exact same warning text ────────

// @spec AC-08
test('T-14-06: the legacy warning text is identical across all three verbs (one shared helper, not three divergent copies)', () => {
  const dir1 = makeLegacyProject();
  const dir2 = makeLegacyProject();
  const dir3 = makeLegacyProject();
  try {
    const stateR = runRun(['state', '--init', '--run', 'run-legacy-t14-06a'], { cwd: dir1 });
    const reportR = runRun(['report', '--run', 'run-legacy-t14-06b', '--step', 'STEP_1A_SPECIFY', '--status', 'pass'], { cwd: dir2 });
    const gateR = runRun(['gate', '--run', 'run-legacy-t14-06c', '--step', 'STEP_1B_PLAN'], { cwd: dir3 });

    const extractWarning = (stderr) => (stderr.match(/WARN: legacy project.*$/m) || [null])[0];
    const w1 = extractWarning(stateR.stderr);
    const w2 = extractWarning(reportR.stderr);
    const w3 = extractWarning(gateR.stderr);

    assert.ok(w1 && w2 && w3, `all three must emit the WARN line. Got: state=${w1} report=${w2} gate=${w3}`);
    assert.equal(w1, w2, 'state and report must emit byte-identical warning text (shared helper)');
    assert.equal(w2, w3, 'report and gate must emit byte-identical warning text (shared helper)');
  } finally {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
    fs.rmSync(dir3, { recursive: true, force: true });
  }
});
