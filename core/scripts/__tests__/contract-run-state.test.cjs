'use strict';
/**
 * contract-run-state.test.cjs — CONTRACT-RUN-STATE-02 (Spec 016, T-03)
 *
 * Contract under test: core/specs/016-artifact-gated-trilho/contracts/persist-run-state.md
 * The 7 cases below mirror that contract's "Contract Test Stub" 1:1.
 *
 * ⚠️ `soma run state` is NOT implemented yet — `core/scripts/run/state.cjs`
 * is T-08 (Wave 2, depends on this task). This suite is written against
 * the contract as it must behave ONCE T-08 (and, for case 6/7, later
 * tasks) land. Most assertions below are therefore expected to FAIL today
 * — that is the correct RED state for T-03. Do not "fix" this file to make
 * it pass; the fix belongs in T-08/T-09/T-16 or the hook.
 *
 * CLI shape assumed (`soma run state --init --run {runId}`, `soma run
 * report --run {runId} --step {STEP} --status {pass|fail} [--reason ..]`,
 * `soma run resume --run {runId}`) is not invented here — it is lifted
 * verbatim from core/specs/016-artifact-gated-trilho/quickstart.md
 * (sections 1, 3, 4, 8), which is the only place in the spec set that
 * pins the actual flags.
 *
 * Article III HARD: real fs, real child_process, real git repo (case 7).
 * Zero mocks.
 *
 * @task T-03
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const HOOK = path.resolve(REPO_ROOT, 'hooks', 'spec-completeness-gate.cjs');
const { resolveSomaPaths } = require(path.resolve(__dirname, '..', 'run', 'paths.cjs'));

// ── Helpers ──────────────────────────────────────────────────────────────

function runRun(args, { cwd, env } = {}) {
  return spawnSync('node', [RUN_CLI, ...args], {
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

/** Fresh, git-initialized fixture project. `.soma/` present unless told otherwise. */
function makeLabProject({ withSomaDir = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-contract-run-state-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'contract-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Contract Test'], { cwd: dir });
  if (withSomaDir) fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

// The literal field set of `soma-state/v1.0`, transcribed verbatim from
// core/adapters/claude/commands/soma-run.md:48-66 (§0.2 "Novo run — criar
// state inicial"). This is the ground truth for "same name, same
// semantics" (contract §Payload) — NOT the "20 campos" prose count, which
// this test independently found to disagree with a literal count of the
// same JSON block (23 top-level keys including $schema, 22 without).
// Divergence reported to the dispatcher rather than silently reconciled.
const V1_FIELD_NAMES = [
  '$schema', 'runId', 'sessionId', 'startedAt', 'currentState', 'previousState',
  'lastTransitionAt', 'featureSlug', 'specPath', 'planPath', 'tasksPath',
  'contractsDir', 'teammateNamePrefix', 'activeDispatchIds', 'failureCountsByStep',
  'fixLoopIterations', 'snapshots', 'humanGatesApproved', 'constitutionVersion',
  'constitutionSnapshotPath', 'lastSuccessfulState', 'baselineSha', 'pausedDiagnostic',
];

// ── 1. v2 is a superset of v1.0 ─────────────────────────────────────────

// @spec AC-03
// @contract CONTRACT-RUN-STATE-02
test('T-03-01: soma run state --init produces soma-state/v2 carrying every v1.0 field, same name/shape', () => {
  const dir = makeLabProject({ withSomaDir: true });
  try {
    const runId = 'run-contract-superset-01';
    const r = runRun(['state', '--init', '--run', runId], { cwd: dir });
    const { runStateFile } = resolveSomaPaths(dir, runId);

    assert.ok(
      fs.existsSync(runStateFile),
      `expected ${runStateFile} to exist after "soma run state --init". Not implemented yet ` +
        `(exit ${r.status}, stderr: ${r.stderr}) — this is the expected RED for T-03.`
    );

    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));

    assert.equal(state.$schema, 'soma-state/v2', `$schema must be the literal "soma-state/v2". Got: ${state.$schema}`);
    for (const field of V1_FIELD_NAMES) {
      if (field === '$schema') continue; // value differs by design (v1.0 -> v2), presence already asserted above
      assert.ok(
        Object.prototype.hasOwnProperty.call(state, field),
        `v1.0 field "${field}" must survive in v2 with the same name (soma-run.md:48-66). Got keys: ${Object.keys(state).join(', ')}`
      );
    }

    // New v2 fields.
    assert.ok(Array.isArray(state.decisions), 'state.decisions must be an array (append-only ledger)');
    assert.ok(Array.isArray(state.reports), 'state.reports must be an array (append-only ledger)');

    // Semantics that are unambiguous from soma-run.md §0.2's fresh-bootstrap
    // shape, regardless of what currentState value --init chooses to start at.
    assert.equal(state.runId, runId, 'runId must equal the --run argument');
    assert.equal(typeof state.currentState, 'string', 'currentState must remain a string');
    assert.equal(state.previousState, null, 'previousState starts null on a fresh run, same as v1.0');
    assert.equal(state.pausedDiagnostic, null, 'pausedDiagnostic starts null on a fresh run, same as v1.0');
    assert.deepEqual(state.activeDispatchIds, [], 'activeDispatchIds starts empty, same as v1.0');
    assert.deepEqual(state.failureCountsByStep, {}, 'failureCountsByStep starts empty, same as v1.0');
    assert.deepEqual(state.snapshots, [], 'snapshots starts empty, same as v1.0');
    assert.equal(state.fixLoopIterations, 0, 'fixLoopIterations starts at 0, same as v1.0');
    assert.equal(typeof state.humanGatesApproved, 'object', 'humanGatesApproved must remain an object');
    assert.equal(typeof state.humanGatesApproved.gate1_spec.approved, 'boolean', 'gate1_spec.approved must remain boolean, same shape as v1.0');
    assert.equal(typeof state.humanGatesApproved.gate2_deploy.approved, 'boolean', 'gate2_deploy.approved must remain boolean, same shape as v1.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. Atomic write ──────────────────────────────────────────────────────

// @spec AC-03
// @contract CONTRACT-RUN-STATE-02
test('T-03-02a: run/state.cjs source uses the tmp-file + renameSync atomic write pattern', () => {
  const STATE_MODULE = path.resolve(__dirname, '..', 'run', 'state.cjs');
  assert.ok(
    fs.existsSync(STATE_MODULE),
    `expected ${STATE_MODULE} to exist (T-08). Not implemented yet — this is the expected RED for T-03.`
  );
  const src = fs.readFileSync(STATE_MODULE, 'utf8');
  assert.ok(
    /\.tmp/.test(src) && /renameSync/.test(src),
    'run/state.cjs must write via a .tmp sibling file + fs.renameSync (house convention, ' +
      'e.g. core/scripts/manifest.cjs:230-233), preserving the atomic-write behavior soma-run.md §0.2 already specifies'
  );
});

// @spec AC-03
// @contract CONTRACT-RUN-STATE-02
test('T-03-02b: repeated state writes never leave a reader looking at truncated/partial JSON, and no .tmp leftover survives a completed write', () => {
  const dir = makeLabProject({ withSomaDir: true });
  try {
    const runId = 'run-contract-atomic-01';
    const { runStateFile } = resolveSomaPaths(dir, runId);
    const ROUNDS = 5;
    let sawFile = false;

    for (let i = 0; i < ROUNDS; i++) {
      runRun(['state', '--init', '--run', runId], { cwd: dir });
      if (fs.existsSync(runStateFile)) {
        sawFile = true;
        const raw = fs.readFileSync(runStateFile, 'utf8');
        assert.doesNotThrow(
          () => JSON.parse(raw),
          `run-state file must always be complete, parseable JSON (tmp+rename atomicity) — ` +
            `got unparseable content on round ${i}: ${raw.slice(0, 200)}`
        );
      }
      assert.ok(
        !fs.existsSync(runStateFile + '.tmp'),
        `no .tmp leftover expected after round ${i} — a completed write must have consumed it via rename`
      );
    }

    assert.ok(
      sawFile,
      'expected "soma run state --init" to eventually produce the run-state file across the rounds ' +
        '(currently VERB_NOT_IMPLEMENTED — expected RED for T-03)'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. CONTEÚDO: resume from a DIFFERENT session reenters STEP_6, doesn't re-execute 1A..5 ─

// @spec AC-04
// @contract CONTRACT-RUN-STATE-02
test('T-03-03: CONTEUDO — resume reenters STEP_6_CONSOLIDATE from a session different than the one that created the run, without re-running 1A..5', () => {
  const dir = makeLabProject({ withSomaDir: true });
  try {
    const runId = 'run-contract-resume-01';
    const { runStateFile, runReportsDir } = resolveSomaPaths(dir, runId);
    fs.mkdirSync(runReportsDir, { recursive: true });

    // "1A..5" per the dispatcher's own step names (soma-run.md ## blocks 1-8):
    // STEP_1A_SPECIFY, STEP_1B_PLAN, STEP_1C_TASKS, STEP_2_TASKS,
    // STEP_3_FOUNDATION, STEP_4_WAVES, STEP_5_VALIDATE — all "pass".
    const passedSteps = [
      'STEP_1A_SPECIFY', 'STEP_1B_PLAN', 'STEP_1C_TASKS',
      'STEP_2_TASKS', 'STEP_3_FOUNDATION', 'STEP_4_WAVES', 'STEP_5_VALIDATE',
    ];
    const now = () => new Date().toISOString();
    const reportsEntries = passedSteps.map((step) => {
      const reportPath = path.join(runReportsDir, `${step}-report.json`);
      const report = {
        schema: 'soma-step-report/v1', run_id: runId, step, status: 'pass',
        started_at: now(), finished_at: now(), artifacts: [], metrics: {}, notes: '',
      };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      return { step, status: 'pass', path: path.relative(dir, reportPath), finished_at: report.finished_at };
    });

    const originalSessionId = 'session-A-original';
    const stateV2 = {
      $schema: 'soma-state/v2',
      runId, sessionId: originalSessionId, startedAt: now(),
      currentState: 'STEP_6_CONSOLIDATE', previousState: 'STEP_5_VALIDATE', lastTransitionAt: now(),
      featureSlug: '016-artifact-gated-trilho',
      specPath: 'core/specs/016-artifact-gated-trilho/spec.md',
      planPath: 'core/specs/016-artifact-gated-trilho/plan.md',
      tasksPath: 'core/specs/016-artifact-gated-trilho/tasks.md',
      contractsDir: 'core/specs/016-artifact-gated-trilho/contracts',
      teammateNamePrefix: 'soma-016-artifact-gated-trilho',
      activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0, snapshots: [],
      humanGatesApproved: { gate1_spec: { approved: true }, gate2_deploy: { approved: false } },
      constitutionVersion: '1.2.1', constitutionSnapshotPath: null,
      lastSuccessfulState: 'STEP_5_VALIDATE', baselineSha: 'd15f592', pausedDiagnostic: null,
      decisions: [],
      reports: reportsEntries,
    };
    fs.writeFileSync(runStateFile, JSON.stringify(stateV2, null, 2));

    // Resume from a session id that is DELIBERATELY different from the one
    // that created the run (AC-04: "sem depender do sessionId da sessão original").
    const differentSessionId = 'session-B-brand-new';
    const r = runRun(['resume', '--run', runId], {
      cwd: dir,
      env: { CK_SESSION_ID: differentSessionId, CLAUDE_SESSION_ID: differentSessionId },
    });

    assert.equal(
      r.status, 0,
      `resume from a different session must succeed (AC-04 says explicitly it must not depend ` +
        `on the original sessionId). Got exit ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`
    );
    const output = r.stdout + r.stderr;
    assert.ok(
      output.includes('STEP_6_CONSOLIDATE'),
      `resume must name STEP_6_CONSOLIDATE — the step after the last "pass" report — as the reentry point. Got: ${output}`
    );

    // Content check on the artifact itself, not just stdout wording: the
    // persisted reports[] for already-passed steps must be untouched —
    // resume reading them is not the same as re-running them, but at
    // minimum nothing should get duplicated or dropped by the resume call.
    const after = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(
      after.reports.length, passedSteps.length,
      `resume must not mutate the append-only reports[] ledger for already-passed steps. ` +
        `Expected ${passedSteps.length} entries, got ${after.reports.length}`
    );
    for (const step of passedSteps) {
      const matches = after.reports.filter((entry) => entry.step === step);
      assert.equal(matches.length, 1, `step "${step}" must appear exactly once in reports[] after resume (no re-execution duplicate). Got ${matches.length}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. decisions[] and reports[] are append-only ────────────────────────

// @spec AC-03
// @contract CONTRACT-RUN-STATE-02
test('T-03-04a: reports[] accumulates across two "soma run report" calls for different steps — second write does not overwrite the first', () => {
  const dir = makeLabProject({ withSomaDir: true });
  try {
    const runId = 'run-contract-append-01';
    runRun(['state', '--init', '--run', runId], { cwd: dir });
    runRun(['report', '--run', runId, '--step', 'STEP_1A_SPECIFY', '--status', 'pass'], { cwd: dir });
    runRun(['report', '--run', runId, '--step', 'STEP_1B_PLAN', '--status', 'pass'], { cwd: dir });

    const { runStateFile } = resolveSomaPaths(dir, runId);
    assert.ok(
      fs.existsSync(runStateFile),
      `expected run-state file to exist after --init + 2 report calls. Not implemented yet — ` +
        `expected RED for T-03. Path: ${runStateFile}`
    );
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.ok(Array.isArray(state.reports), 'state.reports must be an array');
    assert.equal(state.reports.length, 2, `expected 2 accumulated report entries (append-only), got ${state.reports.length}: ${JSON.stringify(state.reports)}`);
    const steps = state.reports.map((entry) => entry.step);
    assert.ok(
      steps.includes('STEP_1A_SPECIFY') && steps.includes('STEP_1B_PLAN'),
      `both step entries must survive, neither overwritten by the other. Got: ${JSON.stringify(steps)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-03
// @contract CONTRACT-RUN-STATE-02
test('T-03-04b: decisions[] is append-only — a pre-existing decision survives a second "soma run state --init" on the same run', () => {
  const dir = makeLabProject({ withSomaDir: true });
  try {
    const runId = 'run-contract-append-02';
    const { runStateFile } = resolveSomaPaths(dir, runId);

    // Seed a fixture as if one decision had already been recorded.
    const now = new Date().toISOString();
    const seeded = {
      $schema: 'soma-state/v2', runId, sessionId: 's1', startedAt: now,
      currentState: 'STEP_1B_PLAN', previousState: 'STEP_1A_SPECIFY', lastTransitionAt: now,
      featureSlug: null, specPath: null, planPath: null, tasksPath: null, contractsDir: null,
      teammateNamePrefix: null, activeDispatchIds: [], failureCountsByStep: {}, fixLoopIterations: 0,
      snapshots: [], humanGatesApproved: { gate1_spec: { approved: true }, gate2_deploy: { approved: false } },
      constitutionVersion: null, constitutionSnapshotPath: null, lastSuccessfulState: 'STEP_1A_SPECIFY',
      baselineSha: 'd15f592', pausedDiagnostic: null,
      decisions: [{ ts: now, actor: 'felipe', decision: 'gate1_approved', rationale: 'spec 016 aprovada sem cortes' }],
      reports: [],
    };
    fs.writeFileSync(runStateFile, JSON.stringify(seeded, null, 2));

    // A second write touching the same run must not wipe the seeded decision.
    const r = runRun(['state', '--init', '--run', runId], { cwd: dir });
    assert.equal(
      r.status, 0,
      `"soma run state --init" on an existing run must succeed (append-only merge, not a fatal error). ` +
        `Got exit ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}. Not implemented yet — this is the ` +
        `expected RED for T-03 (without this check, the test would pass vacuously today because the ` +
        `command fails and never touches the seeded file).`
    );

    const after = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.ok(Array.isArray(after.decisions), 'state.decisions must be an array');
    assert.equal(
      after.decisions.length, 1,
      `a second write on the same run must not drop the pre-existing decision (append-only). ` +
        `Got ${after.decisions.length} entries: ${JSON.stringify(after.decisions)}`
    );
    assert.equal(after.decisions[0].decision, 'gate1_approved', 'the surviving decision must still be the seeded one, unmodified');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5. Legacy mode ────────────────────────────────────────────────────────

// @spec AC-08
// @contract CONTRACT-RUN-STATE-02
test('T-03-05: project without .soma/ runs in legacy mode with a warning, never a fatal error', () => {
  const dir = makeLabProject({ withSomaDir: false });
  try {
    const runId = 'run-contract-legacy-01';
    const r = runRun(['state', '--init', '--run', runId], { cwd: dir });
    assert.equal(
      r.status, 0,
      `legacy mode must never be a fatal error (AC-08 / quickstart.md §8). Expected exit 0, got ${r.status}. stderr: ${r.stderr}`
    );
    const output = r.stdout + r.stderr;
    assert.ok(
      /legac|legad/i.test(output),
      `output must name the degradation with a warning mentioning "legacy"/"legado". Got: ${output}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 6. REGRESSION — spec-completeness-gate must keep finding specPath ───

// @spec AC-03
// @spec AC-11
// @contract CONTRACT-RUN-STATE-02
test('T-03-06: REGRESSION — spec-completeness-gate must keep blocking after state migrates from /tmp to .soma/', () => {
  const dir = makeLabProject({ withSomaDir: true });
  // sessionId comes from env (CK_SESSION_ID / CLAUDE_SESSION_ID), never stdin —
  // see hooks/spec-completeness-gate.cjs getSessionId(). Getting this wrong
  // makes the test pass without testing anything (has happened 2x already,
  // per the spec's discovery notes).
  const sessionId = `contract-t03-${process.pid}-${Date.now()}`;
  // os.tmpdir() on this Mac is NOT /tmp — never hardcode it.
  const oldStatePath = path.join(os.tmpdir(), `soma-state-${sessionId}.json`);
  let oldFileExists = false;
  try {
    // A real spec.md with an open [NEEDS CLARIFICATION marker — exactly
    // the class of thing this hook exists to block on commit.
    const specPath = path.join(dir, 'spec.md');
    fs.writeFileSync(specPath, [
      '# Spec: fixture',
      '',
      '## User Stories',
      '',
      'Como usuario, quero [NEEDS CLARIFICATION - qual metodo de auth?], pra algo.',
      '',
    ].join('\n'));

    function invokeHook(command) {
      return spawnSync('node', [HOOK], {
        cwd: dir,
        env: { ...process.env, CK_SESSION_ID: sessionId, CLAUDE_SESSION_ID: sessionId },
        input: JSON.stringify({ tool_input: { command } }),
        encoding: 'utf8',
        timeout: 15000,
      });
    }

    // ── Control: OLD location. The hook is unmodified and hardcodes
    // exactly this path today, so this MUST already block. If the control
    // fails, the test fixture is broken — not the migration.
    fs.writeFileSync(oldStatePath, JSON.stringify({ specPath }));
    oldFileExists = true;
    const control = invokeHook('git commit -m "control: old-path state, must block"');
    assert.equal(
      control.status, 2,
      `CONTROL failed — spec-completeness-gate should already block via the current /tmp path ` +
        `with an open marker present. Got exit ${control.status}. stderr: ${control.stderr}`
    );

    // ── Regression check: state now lives ONLY at the new .soma/ location
    // (what T-08 produces once it lands). Remove the old-path file so the
    // hook cannot fall back to it.
    fs.unlinkSync(oldStatePath);
    oldFileExists = false;
    const runId = 'run-contract-regression-01';
    const { runStateFile } = resolveSomaPaths(dir, runId);
    fs.writeFileSync(runStateFile, JSON.stringify({ $schema: 'soma-state/v2', runId, specPath }));

    const postMigration = invokeHook('git commit -m "post-migration: new-path only state, must still block"');
    assert.equal(
      postMigration.status, 2,
      'REGRESSION: spec-completeness-gate no longer blocks once state moves to .soma/ — it still ' +
        'hardcodes the old /tmp path (getSessionId()-keyed) and silently exits 0 when that file is ' +
        `absent, with NO warning at all. Got exit ${postMigration.status}. stdout: ${postMigration.stdout} ` +
        `stderr: ${postMigration.stderr}. This is the exact silent-degradation defect Spec 016 exists to ` +
        'kill (contracts/persist-run-state.md, consumer note on spec-completeness-gate.cjs).'
    );
  } finally {
    if (oldFileExists) { try { fs.unlinkSync(oldStatePath); } catch (_err) { /* best effort */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 7. .gitignore selective coverage ─────────────────────────────────────

// @spec AC-11
// @contract CONTRACT-RUN-STATE-02
test('T-03-07: .gitignore covers .soma/ runtime artifacts but leaves install-state.json tracked (T-16 not landed yet — expected to fail for the runtime patterns)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-contract-gitignore-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.copyFileSync(path.join(REPO_ROOT, '.gitignore'), path.join(dir, '.gitignore'));

    function isIgnored(relPath) {
      const r = spawnSync('git', ['check-ignore', relPath], { cwd: dir, encoding: 'utf8' });
      return r.status === 0;
    }

    const runtimePatterns = ['.soma/reports/', '.soma/dispatches/', '.soma/run-state-run-lab-001.json', '.soma.lock'];
    for (const p of runtimePatterns) {
      assert.ok(
        isIgnored(p),
        `.gitignore must ignore "${p}" under the "SOMA runtime artifacts" section (AC-11). It does ` +
          'not yet — T-16 has not landed, which is the expected RED for T-03.'
      );
    }

    // Expected to ALREADY pass, both now and after T-16 — no rule should
    // ever match install-state.json (distributed install flow depends on it).
    assert.ok(
      !isIgnored('.soma/install-state.json'),
      '.soma/install-state.json must NEVER be gitignored (AC-11)'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
