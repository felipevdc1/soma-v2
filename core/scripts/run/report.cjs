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
 * Scope note (documented for the team lead, not left implicit): the
 * contract's "Side Effects" section also lists appending to `reports[]` in
 * the run-state (CONTRACT-RUN-STATE-02, owned by T-08) and a JSONL run-log
 * append. T-06's task line in tasks.md only says "emite ... validado ...
 * atomicamente, antes de qualquer transição" — it does not assign either of
 * those two side effects to this file, and `run/state.cjs` does not exist
 * yet in this worktree (T-08 is a sibling Wave 2 task, not a T-06
 * dependency). This module intentionally does NOT touch run-state or a
 * JSONL log. Wiring those is left to whichever task/step actually owns
 * them (T-08 and/or the T-18 WIRING pass) — reported as a surprise, not
 * silently done or silently skipped.
 *
 * Exit codes:
 *   0 — report written
 *   2 — bad usage (missing/invalid flag, unresolved run, self-validation
 *       failure) — always with a legible reason on stderr, never a stack
 *       trace
 *
 * @spec [SPEC:AC-01]
 * @task T-06
 * @contract CONTRACT-STEP-REPORT-01
 */

const fs = require('node:fs');
const path = require('node:path');

const { validate } = require('./schema.cjs');
const { resolveSomaPaths } = require('./paths.cjs');

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

/**
 * @param {string} projectRoot
 * @param {string|undefined} explicitRun
 * @returns {string} runId — never returns on failure, calls fail() and exits
 */
function resolveRunId(projectRoot, explicitRun) {
  if (explicitRun) return explicitRun;

  const lockPath = path.join(projectRoot, '.soma.lock');

  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (_err) {
    fail(
      'RUN_UNRESOLVED',
      `--run não foi informado e .soma.lock não está legível em ${lockPath}. Informe --run <runId> ou garanta um .soma.lock válido na raiz do projeto.`
    );
  }

  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (_err) {
    fail(
      'RUN_UNRESOLVED',
      `--run não foi informado e .soma.lock em ${lockPath} não é JSON válido. Informe --run <runId> explicitamente.`
    );
  }

  if (!lock || typeof lock.runId !== 'string' || lock.runId.length === 0) {
    fail(
      'RUN_UNRESOLVED',
      `--run não foi informado e .soma.lock em ${lockPath} não contém um runId válido. Informe --run <runId> explicitamente.`
    );
  }

  return lock.runId;
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
const runId = resolveRunId(projectRoot, args.run);

const nowIso = new Date().toISOString();
const payload = {
  schema: 'soma-step-report/v1',
  run_id: runId,
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

const { runReportsDir } = resolveSomaPaths(projectRoot, runId);
const filePath = path.join(runReportsDir, `${args.step}-report.json`);

writeAtomic(filePath, JSON.stringify(payload, null, 2) + '\n');

process.stdout.write(
  JSON.stringify({ ok: true, path: filePath, run_id: runId, step: args.step, status: args.status }) + '\n'
);
process.exit(0);
