'use strict';
/**
 * run.test.cjs — T-01 RED/GREEN for the `soma run` primitive skeleton.
 *
 * Covers only the FOUNDATION surface (Spec 016):
 *   - core/scripts/run.cjs        thin dispatcher for the 5 verbs
 *   - core/scripts/run/schema.cjs hand-rolled schema validator (zero dep)
 *   - core/scripts/run/paths.cjs  .soma/ path resolution + legacy detection
 *
 * The verb modules themselves are
 * NOT implemented here — that's Wave 2 (T-06..T-10). This suite only proves
 * the dispatcher routes correctly and fails legibly when a verb module is
 * still missing, which is the exact situation Wave 2 tasks run under until
 * they land one by one.
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-03]
 * @task T-01
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const SOMA_CLI = path.resolve(__dirname, '..', 'soma.cjs');
const PATHS_MODULE = path.resolve(__dirname, '..', 'run', 'paths.cjs');
const SCHEMA_MODULE = path.resolve(__dirname, '..', 'run', 'schema.cjs');

function runRun(args = [], env = {}) {
  return spawnSync('node', [RUN_CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

function runSoma(args = [], env = {}) {
  return spawnSync('node', [SOMA_CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

// ── 1. `soma run --help` lists the 5 verbs ────────────────────────────────

test('T-01-01: soma run --help exits 0 and lists every internal verb', () => {
  const r = runRun(['--help']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  for (const verb of ['state', 'report', 'gate', 'resume', 'dispatch-record', 'checkpoint', 'handoff']) {
    assert.ok(output.includes(verb), `--help output missing verb: ${verb}. Output: ${output}`);
  }
});

// ── 2. `soma run` with no args lists the 5 verbs too ──────────────────────

test('T-01-02: soma run (no args) exits 0 and lists every internal verb', () => {
  const r = runRun([]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  for (const verb of ['state', 'report', 'gate', 'resume', 'dispatch-record', 'checkpoint', 'handoff']) {
    assert.ok(output.includes(verb), `no-args output missing verb: ${verb}. Output: ${output}`);
  }
});

// ── 3. Unknown verb → exit != 0, message names the verb ──────────────────

test('T-01-03: soma run frobnicate (unknown verb) exits non-zero and names it', () => {
  const r = runRun(['frobnicate']);
  assert.notEqual(r.status, 0, `Expected non-zero exit for unknown verb, got ${r.status}`);
  const output = r.stdout + r.stderr;
  assert.ok(output.includes('frobnicate'), `Output must name the unknown verb. Got: ${output}`);
});

// ── 4. Valid verb, module not yet implemented → legible error, no crash ──

test('T-01-04: valid verb with missing module exits non-zero with legible "not implemented", no MODULE_NOT_FOUND stack', () => {
  // All 5 verb modules are expected to be ABSENT at T-01 time (Wave 2 hasn't run).
  for (const verb of ['state', 'report', 'gate', 'resume', 'dispatch-record', 'checkpoint', 'handoff']) {
    const verbPath = path.join(path.dirname(RUN_CLI), 'run', `${verb}.cjs`);
    if (fs.existsSync(verbPath)) continue; // already implemented by a later wave — skip
    const r = runRun([verb]);
    assert.notEqual(r.status, 0, `Expected non-zero exit for unimplemented verb "${verb}", got ${r.status}`);
    const output = r.stdout + r.stderr;
    assert.ok(
      !output.includes('MODULE_NOT_FOUND') && !output.includes('Cannot find module'),
      `Must not leak a MODULE_NOT_FOUND stack trace for verb "${verb}". Got: ${output}`
    );
    assert.ok(
      /not implemented/i.test(output),
      `Output must legibly say "not implemented" for verb "${verb}". Got: ${output}`
    );
  }
});

// ── 5. `soma run` appears in `soma --help` ────────────────────────────────

test('T-01-05: soma --help (core copy) lists "run" in subcommands table', () => {
  const r = runSoma(['--help']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  // Match "run" as its own subcommand-table row, not a substring of e.g. "--dry-run".
  assert.ok(
    /^\s{2}run\s+\S/m.test(output),
    `--help output must list "run" as its own subcommand row. Got:\n${output}`
  );
});

// ── 6-10. schema.cjs — hand-rolled validator ──────────────────────────────

// Mirrors the real soma-step-report/v1 schema (contracts/emit-step-report.md)
// closely enough to exercise required / type / const / enum / requiredIf,
// without this test suite owning the real schema (that's T-06).
const STEP_REPORT_LIKE_SCHEMA = {
  fields: {
    schema: { type: 'string', required: true, const: 'soma-step-report/v1' },
    run_id: { type: 'string', required: true, minLength: 1 },
    step: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pass', 'fail', 'blocked'] },
    failure_reason: {
      type: 'string',
      requiredIf: (obj) => obj.status !== 'pass',
      minLength: 1,
    },
  },
};

function validObject(overrides = {}) {
  return {
    schema: 'soma-step-report/v1',
    run_id: 'run-260815-2340-a1b2c3',
    step: 'STEP_3_FOUNDATION',
    status: 'pass',
    ...overrides,
  };
}

test('T-01-06: schema.cjs — valid object produces zero violations', () => {
  const { validate } = require(SCHEMA_MODULE);
  const result = validate(STEP_REPORT_LIKE_SCHEMA, validObject());
  assert.equal(result.valid, true, `Expected valid, got violations: ${JSON.stringify(result.violations)}`);
  assert.deepEqual(result.violations, []);
});

test('T-01-07: schema.cjs — missing required field produces a violation naming the field', () => {
  const { validate } = require(SCHEMA_MODULE);
  const obj = validObject();
  delete obj.run_id;
  const result = validate(STEP_REPORT_LIKE_SCHEMA, obj);
  assert.equal(result.valid, false);
  const hit = result.violations.find((v) => v.field === 'run_id');
  assert.ok(hit, `Expected a violation naming field "run_id". Got: ${JSON.stringify(result.violations)}`);
});

test('T-01-08: schema.cjs — wrong literal value produces a violation', () => {
  const { validate } = require(SCHEMA_MODULE);
  const obj = validObject({ schema: 'soma-step-report/v2' });
  const result = validate(STEP_REPORT_LIKE_SCHEMA, obj);
  assert.equal(result.valid, false);
  const hit = result.violations.find((v) => v.field === 'schema');
  assert.ok(hit, `Expected a violation naming field "schema". Got: ${JSON.stringify(result.violations)}`);
});

test('T-01-09: schema.cjs — value outside a closed enum produces a violation', () => {
  const { validate } = require(SCHEMA_MODULE);
  const obj = validObject({ status: 'done' });
  const result = validate(STEP_REPORT_LIKE_SCHEMA, obj);
  assert.equal(result.valid, false);
  const hit = result.violations.find((v) => v.field === 'status');
  assert.ok(hit, `Expected a violation naming field "status". Got: ${JSON.stringify(result.violations)}`);
});

test('T-01-10: schema.cjs — conditionally required field: violates without it, valid with it', () => {
  const { validate } = require(SCHEMA_MODULE);

  const withoutReason = validObject({ status: 'fail' });
  const r1 = validate(STEP_REPORT_LIKE_SCHEMA, withoutReason);
  assert.equal(r1.valid, false, 'status=fail without failure_reason must be invalid');
  assert.ok(
    r1.violations.some((v) => v.field === 'failure_reason'),
    `Expected violation naming "failure_reason". Got: ${JSON.stringify(r1.violations)}`
  );

  const withReason = validObject({ status: 'fail', failure_reason: 'T-05 timed out' });
  const r2 = validate(STEP_REPORT_LIKE_SCHEMA, withReason);
  assert.equal(r2.valid, true, `status=fail WITH failure_reason must be valid. Got: ${JSON.stringify(r2.violations)}`);
});

// ── 11-13. paths.cjs — project path resolution ────────────────────────────

function makeProjectFixture({ withSomaDir }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t01-'));
  if (withSomaDir) {
    fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  }
  return dir;
}

test('T-01-11: paths.cjs — project with .soma/ resolves the expected subpaths', () => {
  const { resolveSomaPaths } = require(PATHS_MODULE);
  const projectRoot = makeProjectFixture({ withSomaDir: true });
  try {
    const runId = 'run-260815-2340-a1b2c3';
    const p = resolveSomaPaths(projectRoot, runId);
    assert.equal(p.somaDir, path.join(projectRoot, '.soma'));
    assert.equal(p.reportsDir, path.join(projectRoot, '.soma', 'reports'));
    assert.equal(p.dispatchesDir, path.join(projectRoot, '.soma', 'dispatches'));
    assert.equal(p.checkpointsDir, path.join(projectRoot, '.soma', 'checkpoints'));
    assert.equal(p.handoffsDir, path.join(projectRoot, '.soma', 'handoffs'));
    assert.equal(p.runCheckpointsDir, path.join(projectRoot, '.soma', 'checkpoints', runId));
    assert.equal(p.runHandoffsDir, path.join(projectRoot, '.soma', 'handoffs', runId));
    assert.equal(p.runStateFile, path.join(projectRoot, '.soma', `run-state-${runId}.json`));
    assert.equal(p.legacy, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('T-01-12: paths.cjs — project without .soma/ is detected as legacy', () => {
  const { isLegacyProject, resolveSomaPaths } = require(PATHS_MODULE);
  const projectRoot = makeProjectFixture({ withSomaDir: false });
  try {
    assert.equal(isLegacyProject(projectRoot), true);
    const p = resolveSomaPaths(projectRoot, 'run-x');
    assert.equal(p.legacy, true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('T-01-13: paths.cjs — no hardcoded /tmp; resolution follows the given projectRoot even under a relocated TMPDIR', () => {
  // Static guard: the module source must never hardcode the '/tmp' literal.
  const source = fs.readFileSync(PATHS_MODULE, 'utf8');
  assert.ok(!source.includes("'/tmp'") && !source.includes('"/tmp"'), 'run/paths.cjs must not hardcode the literal "/tmp"');

  // Functional guard: relocate TMPDIR, build a fixture project under the
  // relocated dir, and prove resolveSomaPaths still resolves relative to the
  // projectRoot it was given (not to some hardcoded /tmp path).
  const relocatedTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t01-relocated-'));
  try {
    const r = spawnSync(
      'node',
      ['-e', `
        const { resolveSomaPaths } = require(${JSON.stringify(PATHS_MODULE)});
        const fs = require('node:fs');
        const path = require('node:path');
        const os = require('node:os');
        // Under the relocated TMPDIR, os.tmpdir() must reflect it.
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t01-child-'));
        fs.mkdirSync(path.join(projectRoot, '.soma'));
        const p = resolveSomaPaths(projectRoot, 'run-y');
        process.stdout.write(JSON.stringify({ projectRoot, somaDir: p.somaDir, tmpdir: os.tmpdir() }));
      `],
      { env: { ...process.env, TMPDIR: relocatedTmp }, encoding: 'utf8', timeout: 15000 }
    );
    assert.equal(r.status, 0, `child process failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.ok(out.tmpdir.startsWith(relocatedTmp), `os.tmpdir() should reflect relocated TMPDIR. Got: ${out.tmpdir}`);
    assert.equal(out.somaDir, path.join(out.projectRoot, '.soma'), 'somaDir must derive from the given projectRoot, not a hardcoded /tmp');
  } finally {
    fs.rmSync(relocatedTmp, { recursive: true, force: true });
  }
});
