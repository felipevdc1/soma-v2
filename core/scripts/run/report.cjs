#!/usr/bin/env node
'use strict';
/**
 * run/report.cjs — `soma run report` (Spec 016, T-06)
 *
 * Emits an artifact validated against `soma-step-report/v1` to
 * `{projectRoot}/.soma/reports/{runId}/{step}-report.json`, atomically
 * (write tmp → rename), before any state transition happens. See
 * contracts/emit-step-report.md — this file is the producer side of
 * CONTRACT-STEP-REPORT-01.
 *
 * CLI surface (fixed in plan.md §"Superfície de CLI do `soma run`"):
 *
 *   soma run report [--run <runId>] --step <STEP> --status pass|fail|blocked [--reason <texto>]
 *
 * `--run` is optional: when omitted, the active run is resolved from
 * `.soma.lock` at the project root (a PRE-EXISTING mechanism — soma-run.md
 * §0.3, fields {sessionId, runId, startedAt} — not invented here).
 *
 * Side effect (K1 fixup, 2026-08-16): after the report artifact is written
 * atomically, this module appends the corresponding entry to state.reports[]
 * via run/state.cjs's `appendReport()` — CONTRACT-STEP-REPORT-01's "Side
 * Effects" (b), owned by the `report` verb per plan.md:16 ("grava em
 * .soma/reports/{runId}/ e atualiza reports[] no run-state"). `appendReport`
 * is T-08's module API (state.cjs owns the run-state file format and the
 * entry's `path` computation; this file only calls it, never touches the
 * JSON directly, and never recomputes the entry path itself). The JSONL
 * run-log append (side effect (c)) remains undecided — no contract, no
 * schema — and is still NOT implemented here.
 *
 * Exit codes:
 *   0 — report written AND reports[] append succeeded
 *   2 — bad usage (missing/invalid flag, unresolved run, self-validation
 *       failure), OR the reports[] append failed — always with a legible
 *       reason on stderr, never a stack trace, never a silent 0
 *
 * @spec [SPEC:AC-01]
 * @task T-06
 * @contract CONTRACT-STEP-REPORT-01
 */

const fs = require('node:fs');
const path = require('node:path');

const { validate } = require('./schema.cjs');
const { resolveSomaPaths, resolveRunIdFromLock } = require('./paths.cjs');
const { appendReport, readExactRunState } = require('./state.cjs');
const { assertSafeRunId } = require('./run-id.cjs');
const { warnIfLegacy } = require('./legacy.cjs');

// ── soma-step-report/v1 (owned here, per schema.cjs's module doc: the 3
//    concrete schemas belong to the tasks that emit them, not to T-01) ────

const STEP_REPORT_SCHEMA = {
  fields: {
    schema: { type: 'string', required: true, const: 'soma-step-report/v1' },
    run_id: { type: 'string', required: true, minLength: 1 },
    step: { type: 'string', required: true, minLength: 1 },
    status: { type: 'string', required: true, enum: ['pass', 'fail', 'blocked'] },
    started_at: { type: 'string', required: true, minLength: 1 },
    finished_at: { type: 'string', required: true, minLength: 1 },
    artifacts: { type: 'array', required: true },
    metrics: { type: 'object', required: true },
    notes: { type: 'string', required: true },
    failure_reason: {
      type: 'string',
      requiredIf: (obj) => obj.status !== 'pass',
      minLength: 1,
    },
  },
};

const VALID_STATUSES = ['pass', 'fail', 'blocked'];
const KNOWN_FLAGS = ['--run', '--step', '--status', '--reason'];

// ── stderr error helper — same JSON-on-stderr / exit-2 convention run.cjs
//    already uses for UNKNOWN_VERB / VERB_NOT_IMPLEMENTED ────────────────

function fail(errorCode, message) {
  process.stderr.write(JSON.stringify({ error: errorCode, message }) + '\n');
  process.exit(2);
}

// ── Arg parsing ───────────────────────────────────────────────────────────

/**
 * @param {string[]} argv
 * @returns {{run?: string, step?: string, status?: string, reason?: string}}
 *          never returns on error — calls fail() and exits
 */
function parseArgs(argv) {
  const args = {};
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!KNOWN_FLAGS.includes(token)) {
      unknown.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || KNOWN_FLAGS.includes(value)) {
      fail('MISSING_FLAG_VALUE', `a flag ${token} exige um valor`);
    }
    args[key] = value;
    i++;
  }

  if (unknown.length > 0) {
    fail('UNKNOWN_ARGS', `argumento(s) desconhecido(s): ${unknown.join(', ')}`);
  }

  return args;
}

// ── .soma.lock resolution — pre-existing mechanism, not invented here ────
//
// Shape/read/parse checking itself lives in run/paths.cjs's
// resolveRunIdFromLock() (Spec 016 K3 fixup — was triplicated across
// report/gate/state, each with a different rule; this file's three-distinct-
// reasons messaging is preserved here, on top of the shared strict check).

/**
 * @param {string} projectRoot
 * @param {string|undefined} explicitRun
 * @returns {string} runId — never returns on failure, calls fail() and exits
 */
function resolveRunId(projectRoot, explicitRun) {
  if (explicitRun !== undefined) return explicitRun;

  const result = resolveRunIdFromLock(projectRoot);
  if (result.status === 'ok') return result.runId;

  const messages = {
    unreadable: `--run não foi informado e .soma.lock não está legível em ${result.lockPath}. Informe --run <runId> ou garanta um .soma.lock válido na raiz do projeto.`,
    invalid_json: `--run não foi informado e .soma.lock em ${result.lockPath} não é JSON válido. Informe --run <runId> explicitamente.`,
    invalid_run_id: `--run não foi informado e .soma.lock em ${result.lockPath} não contém um runId válido. Informe --run <runId> explicitamente.`,
  };
  fail('RUN_UNRESOLVED', messages[result.status]);
}

// ── Atomic write: write tmp → rename, per plan.md's storage convention ───

function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ── Main ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const args = parseArgs(argv);

if (!args.step) {
  fail('MISSING_ARG', '--step é obrigatório');
}

if (!args.status) {
  fail('MISSING_ARG', '--status é obrigatório');
}

if (!VALID_STATUSES.includes(args.status)) {
  fail(
    'INVALID_STATUS',
    `--status "${args.status}" inválido — deve ser um de: ${VALID_STATUSES.join(', ')}`
  );
}

if (args.status !== 'pass' && (!args.reason || args.reason.length === 0)) {
  fail(
    'MISSING_FAILURE_REASON',
    `--reason (failure_reason) é obrigatório quando --status é "${args.status}"`
  );
}

const projectRoot = process.cwd();

// AC-08 (T-14): warn when this project predates the trilho (no `.soma/`
// yet) — was previously only checked by state.cjs, silently missing here.
// See run/legacy.cjs's docstring for why this doesn't also mkdir: the
// atomic write below already creates `.soma/reports/{runId}/` regardless
// of legacy status, so this call's only job is naming the degradation.
warnIfLegacy(projectRoot);

const runId = resolveRunId(projectRoot, args.run);
let effectiveRunId;
try {
  effectiveRunId = assertSafeRunId(runId);
  readExactRunState({ projectRoot, runId: effectiveRunId, allowV2: true });
} catch (error) {
  if (error && error.code === 'ENOENT') {
    fail(
      'RUN_ID_IDENTITY_UNPROVABLE',
      `RUN_ID_IDENTITY_UNPROVABLE: no state file or exact state evidence for run "${runId}"`
    );
  }
  const code = error && error.code && /^RUN_ID_/.test(error.code)
    ? error.code
    : 'RUN_ID_MISMATCH';
  fail(code, error && error.message ? error.message : String(error));
}

const nowIso = new Date().toISOString();
const payload = {
  schema: 'soma-step-report/v1',
  run_id: effectiveRunId,
  step: args.step,
  status: args.status,
  started_at: nowIso,
  finished_at: nowIso,
  artifacts: [],
  metrics: {},
  notes: '',
};
if (args.status !== 'pass') {
  payload.failure_reason = args.reason;
}

// Defensive self-check — should never fire given the guards above, but the
// contract's own design constraint ("um report que valida contra o schema e
// descreve a coisa errada é falso-verde") cuts both ways: a report that
// fails its OWN schema must never reach disk either.
const selfCheck = validate(STEP_REPORT_SCHEMA, payload);
if (!selfCheck.valid) {
  fail(
    'REPORT_SELF_VALIDATION_FAILED',
    `payload de report construído internamente não valida: ${JSON.stringify(selfCheck.violations)}`
  );
}

const { runReportsDir } = resolveSomaPaths(projectRoot, effectiveRunId);
const filePath = path.join(runReportsDir, `${args.step}-report.json`);

writeAtomic(filePath, JSON.stringify(payload, null, 2) + '\n');

// K1: append the corresponding entry to state.reports[] — see the module
// docstring's "Side effect" note. Never a silent 0 on failure: the report
// artifact is already on disk at this point, so a broken link to the
// run-state has to say so loudly, naming both the artifact path and the
// append failure's cause. `finishedAt` is passed as the exact value just
// written into the report artifact (payload.finished_at) — appendReport()
// requires it verbatim, on purpose, so the ledger entry can never diverge
// from the artifact it describes. `path` is NOT passed: appendReport()
// computes it itself from {projectRoot, runId, step}, the same
// resolveSomaPaths + `${step}-report.json` convention this file uses for
// `filePath` above — one source of truth, so the two can't drift.
const appendResult = appendReport({
  projectRoot,
  runId: effectiveRunId,
  step: args.step,
  status: args.status,
  finishedAt: payload.finished_at,
});

if (!appendResult.ok) {
  fail(
    'REPORT_STATE_APPEND_FAILED',
    `report gravado em ${filePath}, mas falha ao atualizar reports[] no run-state: ${appendResult.reason}`
  );
}

process.stdout.write(
  JSON.stringify({ ok: true, path: filePath, run_id: effectiveRunId, step: args.step, status: args.status }) + '\n'
);
process.exit(0);
