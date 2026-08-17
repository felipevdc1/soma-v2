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
 * "Superfície de CLI (fixada em 2026-08-15)" section, promoted to contract
 * specifically so T-10/T-11 implement against the same form instead of each
 * inventing one. NOTE this diverges from plan.md's general
 * `soma-cli-surface` block, which brackets `--run` as optional for every
 * verb including dispatch-record ("regra geral"): the contract's own
 * section does NOT bracket `--run` here, and the contract test (T-04) never
 * omits it. Followed the contract's more specific, more recently-fixed
 * section — flagged as a surprise in the task report, not resolved
 * silently.
 *
 *   soma run dispatch-record begin --run <runId> --task <taskId> [--attempt <n>] --prompt-file <path>
 *   soma run dispatch-record end   --run <runId> --task <taskId> [--attempt <n>] --output-file <path> --metadata-file <path>
 *
 * - `begin` copies --prompt-file byte-for-byte into prompt.md, BEFORE the
 *   caller ever spawns the agent. `attempt` defaults to 1; attempt 1 lives
 *   directly under {taskId}/ (no attempt-1/ subdir); attempt >= 2 lives
 *   under {taskId}/attempt-{n}/, leaving prior attempts untouched
 *   (Article VI, zero deletion).
 * - `end` validates --metadata-file against soma-dispatch-record/v1 (model
 *   pinning is mandatory — Amendment 1.1.0). REJECT writes nothing at all
 *   (all-or-nothing: validate fully BEFORE any write). On success, writes
 *   output.md (byte-for-byte copy of --output-file) + metadata.json (the
 *   validated payload, pretty-printed) into the same dir `begin` used.
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
const { resolveSomaPaths } = require('./paths.cjs');

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

  if (!args.run) fail('MISSING_ARG', '--run é obrigatório');
  if (!args.task) fail('MISSING_ARG', '--task é obrigatório');
  if (!args.promptFile) fail('MISSING_ARG', '--prompt-file é obrigatório');

  const attempt = resolveAttempt(args.attempt);
  const promptBytes = readSourceBytes('--prompt-file', args.promptFile);

  const dir = recordDir(projectRoot, args.run, args.task, attempt);
  const promptPath = path.join(dir, 'prompt.md');
  writeAtomic(promptPath, promptBytes);

  process.stdout.write(
    JSON.stringify({ ok: true, path: promptPath, run_id: args.run, task_id: args.task, attempt }) + '\n'
  );
  process.exit(0);
}

// ── end ───────────────────────────────────────────────────────────────

function cmdEnd(argv, projectRoot) {
  const args = parseFlags(argv, ['--run', '--task', '--attempt', '--output-file', '--metadata-file']);

  if (!args.run) fail('MISSING_ARG', '--run é obrigatório');
  if (!args.task) fail('MISSING_ARG', '--task é obrigatório');
  if (!args.outputFile) fail('MISSING_ARG', '--output-file é obrigatório');
  if (!args.metadataFile) fail('MISSING_ARG', '--metadata-file é obrigatório');

  const attempt = resolveAttempt(args.attempt);

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

  const { valid, violations } = validate(DISPATCH_RECORD_SCHEMA, metadata);
  const extraViolations = [];
  if (valid && !(Number.isInteger(metadata.attempt) && metadata.attempt >= 1)) {
    extraViolations.push({
      field: 'attempt',
      message: `field "attempt" must be an integer >= 1, got ${JSON.stringify(metadata.attempt)}`,
    });
  }
  const allViolations = [...violations, ...extraViolations];

  if (allViolations.length > 0) {
    fail(
      'DISPATCH_RECORD_REJECTED',
      `metadata inválido, nada foi escrito: ${JSON.stringify(allViolations)}`
    );
  }

  // ── Only now: read the output source bytes and write both artifacts.
  const outputBytes = readSourceBytes('--output-file', args.outputFile);

  const dir = recordDir(projectRoot, args.run, args.task, attempt);
  const outputPath = path.join(dir, 'output.md');
  const metadataPath = path.join(dir, 'metadata.json');

  writeAtomic(outputPath, outputBytes);
  writeAtomic(metadataPath, JSON.stringify(metadata, null, 2) + '\n');

  process.stdout.write(
    JSON.stringify({ ok: true, outputPath, metadataPath, run_id: args.run, task_id: args.task, attempt }) + '\n'
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
