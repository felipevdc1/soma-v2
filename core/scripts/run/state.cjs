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
 * @spec [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-08]
 * @task T-08
 */

const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./schema.cjs');
const { resolveSomaPaths, isLegacyProject, resolveRunIdFromLock } = require('./paths.cjs');

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

// ── Helpers ─────────────────────────────────────────────────────────────

/** Same convention as hooks/spec-completeness-gate.cjs's getSessionId(). */
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

/** mkdir .soma/ + warn, so a legacy project (AC-08) never hard-fails `state --init`. */
function warnIfLegacy(projectRoot) {
  if (!isLegacyProject(projectRoot)) return;
  process.stderr.write(
    'WARN: legacy project (no .soma/ directory found) — degraded mode, ' +
      'bootstrapping .soma/ automatically. Run "soma install" to adopt the ' +
      'full trilho. Ausência de .soma/ nunca é erro fatal (AC-08).\n'
  );
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
  return state;
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

// ── Library API (Spec 016 K1 fixup) ────────────────────────────────────────
//
// `soma run report` (run/report.cjs, T-06) is the verb responsible for
// appending to state.reports[] — plan.md's `soma-cli-surface` block assigns
// the write to `report`, not `state` — but the run-state file itself, its
// atomic-write convention, and its schema are all owned here. This function
// is the seam: report.cjs `require()`s it instead of duplicating any of
// state.cjs's file-format knowledge.
//
// Contract: it must never throw. Every failure mode — run not initialized,
// corrupt state file, malformed entry — comes back as
// `{ ok: false, code, message }` so the caller (report.cjs) can name the
// cause instead of the append failing silently (contracts/emit-step-
// report.md's "Side Effects" note: "a falha da ligação nunca pode sair 0
// silencioso").
//
// Append-only, same as T-03-04b already protects for decisions[]: this
// only ever pushes; it never rewrites or drops an existing reports[] entry.
//
// Design call (not written down anywhere — see "Surprises" in the K1
// report): `report` can legitimately run before anyone has called
// `state --init` for the run. CONTRACT-STEP-REPORT-01 (T-02, contract-step-
// report.test.cjs cases 1/2 — a file this fixup must not edit) fabricates
// only `.soma.lock` and calls `report` directly, deliberately never calling
// `state --init`, because at T-02 time `soma run state` (T-08) didn't exist
// yet. Making the append REQUIRE a pre-existing state file would turn that
// still-binding contract test red. So `appendReportEntry` ensures a state
// file exists — bootstrapping a fresh one (same shape `cmdInit` produces)
// when it's missing — rather than failing when the run was never
// explicitly `--init`-ed. This mirrors `--init`'s own idempotency: calling
// it explicitly later is still a safe no-op, per T-03-04b.
/**
 * @param {string} projectRoot
 * @param {string} runId
 * @returns {{ok: true, state: object} | {ok: false, code: string, message: string}}
 */
function ensureStateFile(projectRoot, runId) {
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);

  if (fs.existsSync(runStateFile)) {
    try {
      return { ok: true, state: JSON.parse(fs.readFileSync(runStateFile, 'utf8')) };
    } catch (err) {
      return {
        ok: false,
        code: 'CORRUPT_STATE',
        message: `${runStateFile} exists but is not valid JSON: ${err.message}`,
      };
    }
  }

  const state = freshState(runId);
  const { valid, violations } = validate(STATE_SCHEMA_V2, state);
  if (!valid) {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: `freshly-built state failed its own schema: ${JSON.stringify(violations)}`,
    };
  }
  writeStateAtomic(runStateFile, state);
  return { ok: true, state };
}

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.runId
 * @param {{step: string, status: string, path: string, finished_at: string}} args.entry
 * @returns {{ok: true, state: object} | {ok: false, code: string, message: string}}
 */
function appendReportEntry({ projectRoot, runId, entry }) {
  if (!runId) {
    return { ok: false, code: 'MISSING_RUN_ID', message: 'appendReportEntry requires a runId' };
  }
  if (!entry || typeof entry.step !== 'string' || entry.step.length === 0) {
    return {
      ok: false,
      code: 'INVALID_ENTRY',
      message: 'appendReportEntry requires entry.step to be a non-empty string',
    };
  }

  const ensured = ensureStateFile(projectRoot, runId);
  if (!ensured.ok) return ensured;
  const { state } = ensured;

  if (!Array.isArray(state.reports)) {
    return {
      ok: false,
      code: 'CORRUPT_STATE',
      message: `run-state for "${runId}" has no reports[] array to append to (got: ${typeof state.reports})`,
    };
  }

  const { runStateFile } = resolveSomaPaths(projectRoot, runId);

  // Append-only: push, never replace/filter/rewrite an existing entry.
  state.reports.push(entry);
  writeStateAtomic(runStateFile, state);

  return { ok: true, state };
}

// `require()`-ing this file (e.g. from run/report.cjs) must NOT run the CLI
// as a side effect — only invoking it directly (`node run/state.cjs ...`,
// which is how run.cjs's spawnSync delegates) fires main().
if (require.main === module) {
  main();
}

module.exports = { appendReportEntry };
