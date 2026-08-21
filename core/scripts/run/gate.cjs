#!/usr/bin/env node
'use strict';
/**
 * run/gate.cjs — `soma run gate` (Spec 016, T-07)
 *
 * Two routes, sharing one file because both are "should the transition be
 * allowed" decisions on the same primitive:
 *
 *   soma run gate [--run <runId>] --step <STEP>
 *     Reads the step-report (CONTRACT-STEP-REPORT-01) of the step that
 *     immediately precedes <STEP> in STEP_ORDER, and decides:
 *       exit 0 — report present, valid, status "pass"
 *       exit 2 — report absent, "fail", "blocked", schema-invalid, or
 *                unreadable (corrupt JSON) — ALWAYS naming the cause.
 *     AC-10 invariant: no error/absence/unreadability path may ever exit 0.
 *     This file's [SPEC:AC-10] tag covers ONLY the "illegible artifact"
 *     slice (corrupt JSON). The "external check never runs" slice is T-15's
 *     (core/hooks/spec-test-traceability.cjs), already DONE — not touched here.
 *
 *   soma run gate [--run <runId>] --validate <taskId> --validator <agentName>
 *     Thin wrapper around run/validator-invariant.cjs's
 *     checkValidatorAssignment({ metadataPath, proposedValidator }), the
 *     executor≠validador invariant (AC-06). T-07 owns ONLY the routing and
 *     the module-absent error here — the invariant's own behavior (refuse
 *     when equal, accept when different) is T-11's module and T-11's test,
 *     against run/validator-invariant.cjs directly. That module does not
 *     exist yet (later wave); this route MUST still fail legibly, so the
 *     require is LAZY — inside this branch, never at top-of-file — exactly
 *     the VERB_NOT_IMPLEMENTED pattern run.cjs (T-01) already uses for the
 *     same reason: siblings from later waves are routinely missing when a
 *     Wave 2 [P] task runs.
 *
 * plan.md §"Superfície de CLI do `soma run`" (2026-08-16 addendum) is the
 * authority for both the CLI surface and this file/module split.
 *
 * @spec [SPEC:AC-02] [SPEC:AC-10]
 * @contract CONTRACT-STEP-REPORT-01
 * @task T-07
 */

const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./schema.cjs');
const { resolveSomaPaths, resolveRunIdFromLock } = require('./paths.cjs');
const { warnIfLegacy } = require('./legacy.cjs');

// ── Step order ──────────────────────────────────────────────────────────────
//
// Ordered sequence of REPORT-BEARING steps only — i.e. the `## N. STEP_X`
// headers of soma-run.md, EXCLUDING the two human-approval gates
// (AWAITING_SPEC_APPROVAL / AWAITING_DEPLOY_APPROVAL, which use /tmp markers
// per plan.md, not soma-step-report/v1 artifacts) and the non-STEP terminal
// states (Bootstrap, DEPLOY_EXECUTING, DONE).
//
// Source: `grep -n "^## [0-9]*\." core/adapters/claude/commands/soma-run.md`,
// cross-checked against quickstart.md — §1/§2 show STEP_2_TASKS's
// predecessor report is STEP_1C_TASKS (skipping GATE 1, which sits between
// them structurally but emits no report), and §4 shows STEP_4_WAVES follows
// STEP_3_FOUNDATION directly.
const STEP_ORDER = [
  'STEP_1A_SPECIFY',
  'STEP_1B_PLAN',
  'STEP_1C_TASKS',
  'STEP_2_TASKS',
  'STEP_3_FOUNDATION',
  'STEP_4_WAVES',
  'STEP_5_VALIDATE',
  'STEP_6_CONSOLIDATE',
  'STEP_7_INTEGRATE',
  'STEP_8_SONAR',
  'STEP_9_FIX_LOOP',
  'STEP_10_COMMIT',
];

// Mirrors contracts/emit-step-report.md's field table verbatim. Duplicated
// here rather than imported: the concrete soma-step-report/v1 descriptor is
// owned by whichever task emits the artifact (T-06, run/report.cjs) — this
// file is a CONSUMER of the contract, and Wave 2 [P] tasks must each work
// with siblings possibly absent from the working tree. schema.cjs's
// validate() is the shared generic engine this descriptor plugs into; the
// shape matches what CONTRACT-STEP-REPORT-01's own test (T-02) verifies
// independently.
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function fail(message, extra) {
  const payload = Object.assign({ error: 'GATE_BLOCKED', message }, extra || {});
  process.stderr.write(JSON.stringify(payload) + '\n');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { run: null, step: null, validate: null, validator: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') args.run = argv[++i];
    else if (a === '--step') args.step = argv[++i];
    else if (a === '--validate') args.validate = argv[++i];
    else if (a === '--validator') args.validator = argv[++i];
  }
  return args;
}

/**
 * Resolves the active runId: explicit --run wins; otherwise falls back to
 * `.soma.lock` at the project root — a PRE-EXISTING mechanism
 * (soma-run.md §0.3, `{sessionId, runId, startedAt}`), not something this
 * task invents (plan.md §"Superfície de CLI do `soma run`").
 *
 * The file-read/JSON-parse/shape check itself is shared via run/paths.cjs's
 * resolveRunIdFromLock() (Spec 016 K3 fixup — was a second, looser copy of
 * this same check, `lock.runId || null`, which let non-string/falsy-but-
 * present runId values through un-typechecked; now uses the strict rule).
 *
 * @returns {string|null} null when neither source resolves
 */
function resolveRunId(cliRun, projectRoot) {
  if (cliRun) return cliRun;
  const result = resolveRunIdFromLock(projectRoot);
  return result.status === 'ok' ? result.runId : null;
}

/**
 * @returns {{step: string}|{none: true}|{error: string}}
 */
function previousStep(step) {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1) {
    return { error: `step desconhecido "${step}" — esperado um de: ${STEP_ORDER.join(', ')}` };
  }
  if (idx === 0) {
    // First step in the sequence has no predecessor report to gate on.
    // Not exercised by any quickstart/contract example (a run always
    // starts here rather than being gated into it) — documented judgment
    // call, not a spec requirement: nothing to block on, so nothing blocks.
    return { none: true };
  }
  return { step: STEP_ORDER[idx - 1] };
}

// ── Route: --step ─────────────────────────────────────────────────────────

function runGateStep(args, projectRoot) {
  const runId = resolveRunId(args.run, projectRoot);
  if (!runId) {
    fail(
      `run não resolvido: informe --run <runId>, ou garanta .soma.lock legível em ${projectRoot} (soma-run.md §0.3)`
    );
    return;
  }

  const prev = previousStep(args.step);
  if (prev.error) {
    fail(prev.error);
    return;
  }
  if (prev.none) {
    process.exit(0);
    return;
  }

  const { runReportsDir } = resolveSomaPaths(projectRoot, runId);
  const reportPath = path.join(runReportsDir, `${prev.step}-report.json`);

  let raw;
  try {
    raw = fs.readFileSync(reportPath, 'utf8');
  } catch (_err) {
    fail(`report ausente para ${prev.step} (esperado em ${reportPath})`, { step: prev.step });
    return;
  }

  // AC-10: JSON corrompido é "não legível", uma causa distinta de "inválido
  // contra o schema" — checado ANTES da validação estrutural.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`report não legível: JSON corrompido em ${reportPath} (${err.message})`, { step: prev.step });
    return;
  }

  const result = validate(STEP_REPORT_SCHEMA, parsed);
  if (!result.valid) {
    const reasons = result.violations.map((v) => v.message).join('; ');
    fail(`report de ${prev.step} inválido contra soma-step-report/v1: ${reasons}`, {
      step: prev.step,
      violations: result.violations,
    });
    return;
  }

  if (parsed.status !== 'pass') {
    fail(`transição bloqueada: ${prev.step} terminou com status=${parsed.status} — ${parsed.failure_reason}`, {
      step: prev.step,
      status: parsed.status,
    });
    return;
  }

  process.exit(0);
}

// ── Route: --validate ────────────────────────────────────────────────────

function runGateValidate(args, projectRoot) {
  if (!args.validate || !args.validator) {
    fail('soma run gate --validate <taskId> exige --validator <agentName>');
    return;
  }

  // Lazy require, ON PURPOSE, only inside this branch: run/validator-
  // invariant.cjs is T-11's module (later wave). T-07 has to run correctly
  // with that sibling still missing — same reason run.cjs checks verb
  // modules with fs.existsSync before requiring them.
  let checkValidatorAssignment;
  try {
    ({ checkValidatorAssignment } = require('./validator-invariant.cjs'));
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      fail(
        'invariante executor≠validador ainda não implementado (run/validator-invariant.cjs não encontrado — T-11)',
        { code: 'VALIDATOR_INVARIANT_NOT_IMPLEMENTED' }
      );
      return;
    }
    fail(`falha ao carregar run/validator-invariant.cjs: ${err.message}`);
    return;
  }

  const runId = resolveRunId(args.run, projectRoot);
  if (!runId) {
    fail(
      `run não resolvido: informe --run <runId>, ou garanta .soma.lock legível em ${projectRoot} (soma-run.md §0.3)`
    );
    return;
  }

  const { runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
  const metadataPath = path.join(runDispatchesDir, args.validate, 'metadata.json');

  const { allowed, reason } = checkValidatorAssignment({
    metadataPath,
    proposedValidator: args.validator,
  });

  if (!allowed) {
    fail(reason || `atribuição recusada para a task ${args.validate}`, { taskId: args.validate });
    return;
  }

  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const projectRoot = process.cwd();

// AC-08 (T-14): warn when this project predates the trilho (no `.soma/`
// yet) — was previously only checked by state.cjs, silently missing here.
// gate.cjs never writes, so this call has no self-heal side effect at all;
// downstream, a legacy project with nothing to gate on still hits the
// pre-existing "report ausente" / VALIDATOR_INVARIANT_NOT_IMPLEMENTED
// exits below, which are legible fail()s, not the crash-on-missing-
// directory AC-08 exists to prevent.
warnIfLegacy(projectRoot);

if (args.validate) {
  runGateValidate(args, projectRoot);
} else if (args.step) {
  runGateStep(args, projectRoot);
} else {
  fail('soma run gate requer --step <STEP> ou --validate <taskId> --validator <agentName>');
}
