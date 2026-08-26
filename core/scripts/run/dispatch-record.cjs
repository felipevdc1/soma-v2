#!/usr/bin/env node
'use strict';
/**
 * run/dispatch-record.cjs — `soma run dispatch-record` (Spec 016, T-10)
 *
 * Materializes the dispatch-record artifact — prompt.md, output.md,
 * metadata.json — at:
 *
 *   {projectRoot}/.soma/dispatches/{runId}/{taskId}[/attempt-{n}]/
 *
 * See contracts/emit-dispatch-record.md (CONTRACT-DISPATCH-RECORD-03). This
 * file is the producer side; the invariant-check consumer side
 * (`checkValidatorAssignment`, AC-06) is `run/validator-invariant.cjs`,
 * T-11's file — NOT touched here.
 *
 * CLI surface — authority is contracts/emit-dispatch-record.md's own
 * "Superfície de CLI (fixada em 2026-08-15)" section. `--run` is OPTIONAL
 * on both subcommands (2026-08-17 correction, decided by the team lead):
 * the contract section originally required it while plan.md's general
 * `soma-cli-surface` block bracketed it optional for every verb including
 * dispatch-record. plan.md won — not by authority order, but by
 * coherence: report/state/gate all resolve `runId` from `.soma.lock` when
 * omitted, and plan.md's own note calls `resume` "the ONLY verb where
 * resolving from the lock would be wrong" — "only" excludes
 * dispatch-record. Resolution mirrors run/report.cjs exactly: explicit
 * `--run` wins, otherwise `paths.cjs`'s `resolveRunIdFromLock()`.
 *
 *   soma run dispatch-record begin [--run <runId>] --task <taskId> [--attempt <n>] --prompt-file <path>
 *   soma run dispatch-record end   [--run <runId>] --task <taskId> [--attempt <n>] --output-file <path> --metadata-file <path>
 *
 * - `begin` copies --prompt-file byte-for-byte into prompt.md, BEFORE the
 *   caller ever spawns the agent. `attempt` defaults to 1; attempt 1 lives
 *   directly under {taskId}/ (no attempt-1/ subdir); attempt >= 2 lives
 *   under {taskId}/attempt-{n}/, leaving prior attempts untouched
 *   (Article VI, zero deletion).
 * - `end` validates --metadata-file against soma-dispatch-record/v1 (model
 *   pinning is mandatory — Amendment 1.1.0), AND checks LOCAL coherence:
 *   metadata.run_id/task_id/attempt must match the effective --run/--task/
 *   --attempt of the invocation (contract's "O que end valida" — a
 *   provenance record that can lie about which task it belongs to is
 *   useless for the auditing this contract exists for). Does NOT validate
 *   that task_id exists in tasks.md (that's spec-lint's parsing to own) or
 *   that a run-state already exists for run_id (dispatch-record can predate
 *   state — the deliberate opposite of what report.cjs does). REJECT
 *   writes nothing at all (all-or-nothing: validate fully BEFORE any
 *   write). On success, writes output.md (byte-for-byte copy of
 *   --output-file) + metadata.json (the validated payload, pretty-printed)
 *   into the same dir `begin` used.
 *
 * Exit codes:
 *   0 — success
 *   2 — bad usage, missing files, or REJECT — always a legible reason on
 *       stderr naming the failing field/flag, never a stack trace
 *
 * @spec [SPEC:AC-05] [SPEC:AC-12]
 * @task T-10
 * @contract CONTRACT-DISPATCH-RECORD-03
 */

const fs = require('node:fs');
const path = require('node:path');

const { validate } = require('./schema.cjs');
const { resolveSomaPaths, resolveRunIdFromLock } = require('./paths.cjs');
const { assertSafeRunId, reserveRunIdentity } = require('./run-id.cjs');

const MAX_PROMPT_BYTES = 8000;
const MAX_OUTPUT_BYTES = 4000;
const MAX_ATTEMPT = 2;

// ── soma-dispatch-record/v1 (owned here, per schema.cjs's docstring: the 3
//    concrete schemas belong to the tasks that emit them — T-06/T-08/T-10) ─

const DISPATCH_RECORD_SCHEMA = {
  fields: {
    schema: { type: 'string', required: true, const: 'soma-dispatch-record/v1' },
    run_id: { type: 'string', required: true, minLength: 1 },
    task_id: { type: 'string', required: true, minLength: 1 },
    attempt: { type: 'number', required: true },
    model: { type: 'string', required: true, minLength: 1 },
    base_sha: { type: 'string', required: true, minLength: 1 },
    started_at: { type: 'string', required: true, minLength: 1 },
    finished_at: { type: 'string', required: true, minLength: 1 },
    ac_refs: { type: 'array', required: true },
    executor_agent: { type: 'string', required: true, minLength: 1 },
    result: { type: 'string', required: true, enum: ['done', 'failed', 'rejected'] },
  },
};

// ── stderr error helper — same JSON-on-stderr / exit-2 convention run.cjs
//    and run/report.cjs already use ─────────────────────────────────────

function fail(errorCode, message) {
  process.stderr.write(JSON.stringify({ error: errorCode, message }) + '\n');
  process.exit(2);
}

// ── Arg parsing (per-subcommand known-flags list, mirrors report.cjs) ────

function parseFlags(argv, knownFlags) {
  const args = {};
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!knownFlags.includes(token)) {
      unknown.push(token);
      continue;
    }
    const key = token.replace(/^--/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined || knownFlags.includes(value)) {
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

// ── .soma.lock resolution — pre-existing mechanism, not invented here.
//    Mirrors run/report.cjs's resolveRunId() exactly (same messages, same
//    shared paths.cjs helper) so the two verbs behave identically for a
//    human typing the CLI by hand. ───────────────────────────────────────

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

function reserveExactRunIdentity(projectRoot, runId) {
  try {
    const exactRunId = assertSafeRunId(runId);
    reserveRunIdentity({ projectRoot, runId: exactRunId, allowNew: true });
    return exactRunId;
  } catch (error) {
    const code = error && error.code && /^RUN_ID_/.test(error.code)
      ? error.code
      : 'RUN_ID_IDENTITY_INSTALL_FAILED';
    fail(code, error && error.message ? error.message : String(error));
  }
}

/**
 * @param {string|undefined} raw the raw --attempt value, or undefined
 * @returns {number} defaults to 1; never returns on invalid input (fail()
 *          exits) — must be an integer >= 1
 */
function resolveAttempt(raw) {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    fail('INVALID_ATTEMPT', `--attempt "${raw}" inválido — deve ser um inteiro >= 1`);
  }
  return n;
}

function enforceBudget(field, bytes, limit) {
  if (bytes > limit) {
    fail('DISPATCH_BUDGET_EXCEEDED', `${field} excede o orçamento de ${limit} bytes: recebeu ${bytes} bytes`);
  }
}

/**
 * .soma/dispatches/{runId}/{taskId}[/attempt-{n}]/ — attempt 1 lives
 * directly under {taskId}/, attempt >= 2 under attempt-{n}/.
 */
function recordDir(projectRoot, runId, taskId, attempt) {
  const { runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
  const base = path.join(runDispatchesDir, taskId);
  return attempt >= 2 ? path.join(base, `attempt-${attempt}`) : base;
}

// ── Atomic write: write tmp → rename, per plan.md's storage convention.
//    Accepts a Buffer so callers doing byte-for-byte copies never go
//    through a string/encoding round-trip. ─────────────────────────────

function writeAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

/** Reads a source file as raw bytes — never as a string — so a copy is
 *  guaranteed byte-identical (unicode, trailing whitespace, missing final
 *  newline, all preserved). fail()s with a legible cause on read error. */
function readSourceBytes(flagName, filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    fail('SOURCE_FILE_UNREADABLE', `${flagName} "${filePath}" não é legível: ${err.message}`);
  }
}

// ── begin ─────────────────────────────────────────────────────────────

function cmdBegin(argv, projectRoot) {
  const args = parseFlags(argv, ['--run', '--task', '--attempt', '--prompt-file']);

  if (!args.task) fail('MISSING_ARG', '--task é obrigatório');
  if (!args.promptFile) fail('MISSING_ARG', '--prompt-file é obrigatório');

  const attempt = resolveAttempt(args.attempt);
  const promptBytes = readSourceBytes('--prompt-file', args.promptFile);
  if (attempt > MAX_ATTEMPT) {
    fail('DISPATCH_BUDGET_EXCEEDED', `--attempt excede o orçamento de ${MAX_ATTEMPT}: recebeu ${attempt}`);
  }
  enforceBudget('--prompt-file', promptBytes.length, MAX_PROMPT_BYTES);

  const runId = resolveRunId(projectRoot, args.run);
  const effectiveRunId = reserveExactRunIdentity(projectRoot, runId);
  const dir = recordDir(projectRoot, effectiveRunId, args.task, attempt);
  const promptPath = path.join(dir, 'prompt.md');
  writeAtomic(promptPath, promptBytes);

  process.stdout.write(
    JSON.stringify({ ok: true, path: promptPath, run_id: effectiveRunId, task_id: args.task, attempt }) + '\n'
  );
  process.exit(0);
}

// ── end ───────────────────────────────────────────────────────────────

function cmdEnd(argv, projectRoot) {
  const args = parseFlags(argv, ['--run', '--task', '--attempt', '--output-file', '--metadata-file']);

  if (!args.task) fail('MISSING_ARG', '--task é obrigatório');
  if (!args.outputFile) fail('MISSING_ARG', '--output-file é obrigatório');
  if (!args.metadataFile) fail('MISSING_ARG', '--metadata-file é obrigatório');

  const attempt = resolveAttempt(args.attempt);
  if (attempt > MAX_ATTEMPT) {
    fail('DISPATCH_BUDGET_EXCEEDED', `--attempt excede o orçamento de ${MAX_ATTEMPT}: recebeu ${attempt}`);
  }

  // ── Validate FIRST, write NOTHING until validation passes — this is what
  //    makes REJECT all-or-nothing (T-04-04): no partial output.md /
  //    metadata.json ever reaches disk.
  let raw;
  try {
    raw = fs.readFileSync(args.metadataFile, 'utf8');
  } catch (err) {
    fail('METADATA_FILE_UNREADABLE', `--metadata-file "${args.metadataFile}" não é legível: ${err.message}`);
  }

  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (err) {
    fail('METADATA_INVALID_JSON', `--metadata-file "${args.metadataFile}" não é JSON válido: ${err.message}`);
  }

  const outputBytes = readSourceBytes('--output-file', args.outputFile);
  enforceBudget('--output-file', outputBytes.length, MAX_OUTPUT_BYTES);
  const runId = resolveRunId(projectRoot, args.run);

  const { valid, violations } = validate(DISPATCH_RECORD_SCHEMA, metadata);
  const extraViolations = [];
  if (valid && !(Number.isInteger(metadata.attempt) && metadata.attempt >= 1)) {
    extraViolations.push({
      field: 'attempt',
      message: `field "attempt" must be an integer >= 1, got ${JSON.stringify(metadata.attempt)}`,
    });
  }

  // ── Local coherence (contract's "O que end valida" — 2026-08-17): the
  //    metadata payload must not be able to lie about which run/task/
  //    attempt it belongs to — that's the whole point of an artifact
  //    auditors trust. Checked regardless of the schema/attempt violations
  //    above so a REJECT names every mismatch at once, not one at a time.
  const coherenceViolations = [];
  if (metadata.run_id !== runId) {
    coherenceViolations.push({
      field: 'run_id',
      message: `metadata.run_id (${JSON.stringify(metadata.run_id)}) não casa com o --run efetivo (${JSON.stringify(runId)})`,
    });
  }
  if (metadata.task_id !== args.task) {
    coherenceViolations.push({
      field: 'task_id',
      message: `metadata.task_id (${JSON.stringify(metadata.task_id)}) não casa com o --task (${JSON.stringify(args.task)})`,
    });
  }
  if (metadata.attempt !== attempt) {
    coherenceViolations.push({
      field: 'attempt',
      message: `metadata.attempt (${JSON.stringify(metadata.attempt)}) não casa com o --attempt efetivo (${JSON.stringify(attempt)})`,
    });
  }

  const allViolations = [...violations, ...extraViolations, ...coherenceViolations];

  if (allViolations.length > 0) {
    fail(
      'DISPATCH_RECORD_REJECTED',
      `metadata inválido, nada foi escrito: ${JSON.stringify(allViolations)}`
    );
  }

  const effectiveRunId = reserveExactRunIdentity(projectRoot, runId);
  const dir = recordDir(projectRoot, effectiveRunId, args.task, attempt);
  const outputPath = path.join(dir, 'output.md');
  const metadataPath = path.join(dir, 'metadata.json');

  writeAtomic(outputPath, outputBytes);
  writeAtomic(metadataPath, JSON.stringify(metadata, null, 2) + '\n');

  process.stdout.write(
    JSON.stringify({ ok: true, outputPath, metadataPath, run_id: effectiveRunId, task_id: args.task, attempt }) + '\n'
  );
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const projectRoot = process.cwd();
  const subcommand = argv[0];

  if (subcommand === 'begin') {
    cmdBegin(argv.slice(1), projectRoot);
  } else if (subcommand === 'end') {
    cmdEnd(argv.slice(1), projectRoot);
  } else {
    fail(
      'UNKNOWN_SUBCOMMAND',
      `soma run dispatch-record "${subcommand}" desconhecido — use "begin" ou "end"`
    );
  }
}

main();
