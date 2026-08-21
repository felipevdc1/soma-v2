#!/usr/bin/env node
'use strict';
/**
 * run/state.cjs — `soma run state` (Spec 016, T-08)
 *
 * Persists `soma-state/v2` to `{projectRoot}/.soma/run-state-{runId}.json`.
 * Migration, not greenfield: v1.0 lived at `/tmp/soma-state-{sessionId}.json`
 * (soma-run.md §0.2) — v2 moves the artifact into the project and keys it by
 * `runId` instead of `sessionId`, which is what makes `resume` possible from
 * a different session (AC-04). v2 is a STRICT SUPERSET of v1.0: every v1.0
 * field survives with the same name and shape; two fields are added
 * (`decisions[]`, `reports[]`, both append-only ledgers).
 *
 * Contract: core/specs/016-artifact-gated-trilho/contracts/persist-run-state.md
 *
 * CLI surface (authority: plan.md's `soma-cli-surface` block):
 *   soma run state --init --run <runId>
 *   soma run state [--run <runId>] --set <STATE>
 *
 * `--init` is idempotent: on a run that already has a state file, it is a
 * no-op (exit 0, file untouched) — this is what keeps `decisions[]`/
 * `reports[]` append-only across a repeated `--init` (see T-03-04b). It
 * never resets an existing run back to fresh-bootstrap defaults.
 *
 * `--set` is the only writer of `currentState` after `--init`. `--run` is
 * optional here and, per plan.md's "regra geral", resolved from the
 * project's `.soma.lock` when omitted (pre-existing mechanism,
 * soma-run.md §0.3 — not invented by this task).
 *
 * Module API (in addition to the CLI): `appendReport()`, exported for
 * `require('./state.cjs')` by whichever verb owns emitting the step report
 * (today: run/report.cjs, T-06). See its docstring below for the exact
 * signature — this is the append-side of CONTRACT-STEP-REPORT-01's Side
 * Effects ("Faz append da entrada correspondente em reports[] do
 * run-state"), a gap the contract itself does not assign a caller for.
 * This file only EXPOSES the primitive; it does not call OUT to
 * report.cjs or any other verb — wiring the two together is a separate
 * task's job.
 *
 * @spec [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-08]
 * @task T-08
 */

const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./schema.cjs');
const { resolveSomaPaths, resolveRunIdFromLock } = require('./paths.cjs');
const { warnIfLegacy } = require('./legacy.cjs');
const { sweepExpiredArtifacts } = require('./retention.cjs');

// ── soma-state/v2 schema (owned by T-08, per run/schema.cjs's docstring) ──
// Only the fields whose type is unambiguous (never legitimately null) are
// declared here — schema.cjs's validator does not support union types, and
// several v1.0 fields (previousState, specPath, ...) are nullable by design.
// Modeling those would produce false violations on their normal null state,
// so this schema intentionally checks only what it can check soundly.
const STATE_SCHEMA_V2 = {
  fields: {
    $schema: { type: 'string', required: true, const: 'soma-state/v2' },
    runId: { type: 'string', required: true, minLength: 1 },
    sessionId: { type: 'string', required: true, minLength: 1 },
    startedAt: { type: 'string', required: true },
    currentState: { type: 'string', required: true },
    lastTransitionAt: { type: 'string', required: true },
    activeDispatchIds: { type: 'array', required: true },
    failureCountsByStep: { type: 'object', required: true },
    fixLoopIterations: { type: 'number', required: true },
    snapshots: { type: 'array', required: true },
    humanGatesApproved: { type: 'object', required: true },
    decisions: { type: 'array', required: true },
    reports: { type: 'array', required: true },
  },
};

// A `reports[]` entry (CONTRACT-RUN-STATE-02's Payload example), validated
// on the way in so a malformed append can never reach durable state.
const REPORT_ENTRY_SCHEMA = {
  fields: {
    step: { type: 'string', required: true, minLength: 1 },
    status: { type: 'string', required: true, enum: ['pass', 'fail', 'blocked'] },
    path: { type: 'string', required: true, minLength: 1 },
    finished_at: { type: 'string', required: true, minLength: 1 },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

/** Same convention as core/hooks/spec-completeness-gate.cjs's getSessionId(). */
function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function fail(code, message) {
  process.stderr.write(JSON.stringify({ error: code, message }) + '\n');
  process.exit(2);
}

/** Write JSON atomically: tmp sibling file + rename (house convention, e.g. core/scripts/manifest.cjs). */
function writeStateAtomic(runStateFile, state) {
  fs.mkdirSync(path.dirname(runStateFile), { recursive: true });
  const tmpPath = runStateFile + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmpPath, runStateFile);
}

/**
 * Fresh soma-state/v2, mirroring the v1.0 "Novo run" bootstrap shape
 * (soma-run.md §0.2:37-57) plus the two v2 ledgers.
 */
function freshState(runId) {
  const now = new Date().toISOString();
  return {
    $schema: 'soma-state/v2',
    runId,
    sessionId: getSessionId(),
    startedAt: now,
    currentState: 'IDLE',
    previousState: null,
    lastTransitionAt: now,
    featureSlug: null,
    specPath: null,
    planPath: null,
    tasksPath: null,
    contractsDir: null,
    teammateNamePrefix: null,
    activeDispatchIds: [],
    failureCountsByStep: {},
    fixLoopIterations: 0,
    snapshots: [],
    humanGatesApproved: { gate1_spec: { approved: false }, gate2_deploy: { approved: false } },
    constitutionVersion: null,
    constitutionSnapshotPath: null,
    lastSuccessfulState: null,
    baselineSha: null,
    pausedDiagnostic: null,
    decisions: [],
    reports: [],
  };
}

/**
 * Resolve `runId` from `--run`, falling back to `.soma.lock` when omitted
 * (plan.md:53 — "regra geral"). Returns null when neither resolves.
 *
 * The shape check this used to do inline (`typeof === 'string' && length >
 * 0`) is now shared via run/paths.cjs's resolveRunIdFromLock() (Spec 016 K3
 * fixup) — this file's own rule was the strictest of the three duplicates
 * that existed, and is the one the shared function adopted.
 */
function resolveRunId(explicitRunId, projectRoot) {
  if (explicitRunId) return explicitRunId;
  const result = resolveRunIdFromLock(projectRoot);
  return result.status === 'ok' ? result.runId : null;
}

// ── Verbs ───────────────────────────────────────────────────────────────

function cmdInit(runId, projectRoot) {
  if (!runId) fail('MISSING_RUN_ID', '"soma run state --init" requires --run <runId>');

  warnIfLegacy(projectRoot);
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);

  if (fs.existsSync(runStateFile)) {
    // Idempotent: an existing run is never reset back to fresh-bootstrap
    // defaults — that would silently wipe decisions[]/reports[] (T-03-04b).
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    } catch (err) {
      fail('CORRUPT_STATE', `${runStateFile} exists but is not valid JSON: ${err.message}`);
    }
    process.stdout.write(
      `soma run state: run "${runId}" already initialized at ${runStateFile} (no-op)\n`
    );
    return existing;
  }

  const state = freshState(runId);
  const { valid, violations } = validate(STATE_SCHEMA_V2, state);
  if (!valid) {
    fail('INVALID_STATE', `freshly-built state failed its own schema: ${JSON.stringify(violations)}`);
  }
  writeStateAtomic(runStateFile, state);
  process.stdout.write(`soma run state: initialized run "${runId}" at ${runStateFile}\n`);
  return state;
}

function cmdSet(runId, newState, projectRoot) {
  if (!newState) fail('MISSING_STATE', '"soma run state --set" requires a state value');

  const resolvedRunId = resolveRunId(runId, projectRoot);
  if (!resolvedRunId) {
    fail(
      'MISSING_RUN_ID',
      '"soma run state --set" needs a runId: pass --run <runId> explicitly, or have a ' +
        'readable .soma.lock at the project root to resolve the active run'
    );
  }

  warnIfLegacy(projectRoot);
  const { runStateFile } = resolveSomaPaths(projectRoot, resolvedRunId);
  if (!fs.existsSync(runStateFile)) {
    fail(
      'NO_SUCH_RUN',
      `no state file at ${runStateFile} — run "soma run state --init --run ${resolvedRunId}" first`
    );
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
  } catch (err) {
    fail('CORRUPT_STATE', `${runStateFile} exists but is not valid JSON: ${err.message}`);
  }

  state.previousState = state.currentState;
  state.currentState = newState;
  state.lastTransitionAt = new Date().toISOString();

  writeStateAtomic(runStateFile, state);
  process.stdout.write(
    `soma run state: run "${resolvedRunId}" transitioned ${state.previousState} -> ${state.currentState}\n`
  );

  // AC-12 gatilho: o único lugar onde um run atinge DONE é aqui. A sweep
  // é oportunista (varre TODOS os runs DONE do projeto, não só este) e
  // nunca lança nem muda o exit code deste comando — sweepExpiredArtifacts()
  // nunca throws (mesmo contrato de appendReport()). Ver run/retention.cjs.
  if (state.currentState === 'DONE') {
    const sweep = sweepExpiredArtifacts({ projectRoot });
    if (sweep.swept.length > 0 || sweep.errors.length > 0) {
      process.stderr.write(
        `soma run state: retention sweep — swept ${sweep.swept.length}, errors ${sweep.errors.length}` +
          (sweep.errors.length > 0 ? `: ${JSON.stringify(sweep.errors)}` : '') +
          '\n'
      );
    }
  }

  return state;
}

// ── Module API ─────────────────────────────────────────────────────────
//
// appendReport({ projectRoot, runId, step, status, finishedAt }) -> { ok, reason?, state?, entry? }
//
// The append-side of CONTRACT-STEP-REPORT-01's Side Effects ("Faz append
// da entrada correspondente em reports[] do run-state"). Callable via
// `require('./state.cjs').appendReport(...)`.
//
// Design:
//   - Computes `path` itself (relative to `projectRoot`, via
//     `resolveSomaPaths` + the `${step}-report.json` naming convention) —
//     single source of truth for where a step's report lives, so a caller
//     only needs to know {runId, step}, never the artifact's path
//     construction rule. `run/report.cjs` (T-06) derives the same absolute
//     path from the same `resolveSomaPaths` call, so the two can never
//     drift relative to each other.
//   - `finishedAt` is REQUIRED, not defaulted — it must mirror the report
//     artifact's own `finished_at` exactly (the ledger entry describes an
//     artifact that already exists; minting a fresh timestamp here would
//     silently diverge from it).
//   - APPEND-ONLY: always pushes a new entry, never mutates or removes an
//     existing one — including on re-entry into the same step (the
//     contract: "o histórico de tentativas vive em reports[]").
//   - NEVER throws and NEVER calls process.exit — this runs inside a
//     caller's process. Every failure path returns
//     `{ ok: false, reason: <legible string> }` so the caller can decide
//     how loud to be; it must never fail silently (`0` violations read as
//     success is exactly the failure mode this run-state persists to
//     prevent).
//
// @spec [SPEC:AC-03]
// @contract CONTRACT-STEP-REPORT-01 CONTRACT-RUN-STATE-02
function appendReport({ projectRoot, runId, step, status, finishedAt }) {
  if (!projectRoot || !runId) {
    return { ok: false, reason: 'appendReport requires projectRoot and runId' };
  }
  if (!step || !status || !finishedAt) {
    return { ok: false, reason: 'appendReport requires step, status, and finishedAt' };
  }

  const { runStateFile, runReportsDir } = resolveSomaPaths(projectRoot, runId);
  if (!fs.existsSync(runStateFile)) {
    return {
      ok: false,
      reason: `no state file at ${runStateFile} — run "soma run state --init --run ${runId}" first`,
    };
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `${runStateFile} exists but is not valid JSON: ${err.message}` };
  }
  if (!Array.isArray(state.reports)) {
    return {
      ok: false,
      reason: `${runStateFile}'s reports[] is not an array — refusing to append to corrupt state`,
    };
  }

  const entry = {
    step,
    status,
    path: path.relative(projectRoot, path.join(runReportsDir, `${step}-report.json`)),
    finished_at: finishedAt,
  };
  const { valid, violations } = validate(REPORT_ENTRY_SCHEMA, entry);
  if (!valid) {
    return { ok: false, reason: `report entry failed validation: ${JSON.stringify(violations)}` };
  }

  state.reports = [...state.reports, entry]; // append-only — never overwrite an existing entry
  writeStateAtomic(runStateFile, state);
  return { ok: true, state, entry };
}

// ── CLI ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { init: false, run: null, set: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--init') {
      args.init = true;
    } else if (arg === '--run') {
      args.run = argv[++i];
    } else if (arg === '--set') {
      args.set = argv[++i];
    }
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);
  const { init, run, set } = parseArgs(argv);
  const projectRoot = process.cwd();

  if (init && set) {
    fail('CONFLICTING_FLAGS', '"soma run state" takes either --init or --set, not both');
  } else if (init) {
    cmdInit(run, projectRoot);
  } else if (set) {
    cmdSet(run, set, projectRoot);
  } else {
    fail('MISSING_VERB_FLAG', 'usage: soma run state --init --run <runId> | soma run state [--run <runId>] --set <STATE>');
  }
  process.exit(0);
}

// Only auto-run the CLI when invoked directly (`node state.cjs ...` / via
// run.cjs's spawnSync delegation). A plain `require('./state.cjs')` — e.g.
// from run/report.cjs calling appendReport() — must NOT trigger argv
// parsing or process.exit() inside the caller's own process.
if (require.main === module) {
  main();
}

module.exports = { appendReport };
