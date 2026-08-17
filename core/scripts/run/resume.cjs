#!/usr/bin/env node
'use strict';
/**
 * run/resume.cjs — `soma run resume` (Spec 016, T-09)
 *
 * Reconstitutes a run's reentry point from durable artifacts — the
 * append-only `reports[]` ledger in `soma-state/v2`, cross-checked against
 * `lastSuccessfulState` — never from the `sessionId` of the session that
 * created the run. That's the whole point of AC-04: a run interrupted in
 * one Claude Code session (now dead) has to be resumable from a brand new
 * one, purely by reading what's on disk.
 *
 * CLI surface (plan.md's `soma-cli-surface` block, authoritative):
 *
 *   soma run resume --run <runId>
 *
 * `--run` is MANDATORY here — the ONE verb in `soma run` that does not
 * fall back to `.soma.lock` when omitted (plan.md:69): "retomar acontece
 * de outra sessão, possivelmente com o lock apontando para outro run ou
 * ausente. Pedir o runId é o que torna o AC-04 possível." Resolving via
 * the lock would silently defeat the exact property AC-04 requires.
 *
 * This module is READ-ONLY. It never writes to the state file (or
 * anything else) — resume only REPORTS where a run should reenter; making
 * that transition happen is a separate `soma run state --set <STATE>`
 * call, owned by whoever drives the orchestration (T-18's wiring), not by
 * this verb. This is also what trivially satisfies "não re-executa
 * steps já concluídos": resume.cjs doesn't execute or call anything, it
 * only reads and computes.
 *
 * Algorithm (contract: "reconstitui o run a partir de reports[] +
 * lastSuccessfulState", persist-run-state.md's Consumers table):
 *   1. Walk the known report-bearing STEP_ORDER (same 12-step list
 *      gate.cjs uses — duplicated here, not imported: gate.cjs is a
 *      sibling task's closed file, and Wave 2's own convention is each
 *      verb keeps its own copy of small closed constants rather than
 *      force a shared-import dependency across parallel tasks — see
 *      report.cjs's/gate.cjs's own duplicated STEP_REPORT_SCHEMA).
 *   2. For each step, take the LATEST reports[] entry for that step (later
 *      entries override earlier ones — reports[] is append-only, so a
 *      step re-entered after an earlier failure has more than one entry,
 *      and the most recent one is the true current status).
 *   3. The reentry point is the FIRST step, in order, whose latest status
 *      is not "pass" (or that has no report at all). Everything before it
 *      is "already concluded" and must not be re-run.
 *   4. Cross-check against `lastSuccessfulState`: if it disagrees with
 *      what reports[] alone implies, warn (not fatal) — a mismatch
 *      between the two sources of truth is exactly the prose-vs-evidence
 *      class of defect this whole spec exists to catch, and staying
 *      quiet about it would repeat that mistake here.
 *
 * @spec [SPEC:AC-04]
 * @contract CONTRACT-RUN-STATE-02
 * @task T-09
 */

const fs = require('node:fs');
const { resolveSomaPaths } = require('./paths.cjs');

// Mirrors gate.cjs's STEP_ORDER verbatim (report-bearing steps only,
// excluding the two human-approval gates and the non-STEP terminal
// states) — see that file's own comment for the source/cross-check.
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

function fail(code, message) {
  process.stderr.write(JSON.stringify({ error: code, message }) + '\n');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { run: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') args.run = argv[++i];
  }
  return args;
}

/**
 * @param {Array<{step: string, status: string}>} reports
 * @returns {Map<string, string>} step -> latest status, later entries win
 */
function latestStatusByStep(reports) {
  const latest = new Map();
  for (const entry of reports) {
    if (entry && typeof entry.step === 'string') {
      latest.set(entry.step, entry.status);
    }
  }
  return latest;
}

/**
 * @param {Map<string, string>} latest
 * @returns {{ reentry: string, lastPass: string|null }}
 *   reentry is a STEP_ORDER member, or 'DONE' when every report-bearing
 *   step has already passed. lastPass is the last step found with status
 *   "pass" walking in order, or null when none has.
 */
function reentryFromReports(latest) {
  let lastPass = null;
  for (const step of STEP_ORDER) {
    if (latest.get(step) !== 'pass') {
      return { reentry: step, lastPass };
    }
    lastPass = step;
  }
  return { reentry: 'DONE', lastPass };
}

/**
 * @param {string|null} lastSuccessfulState
 * @returns {string|null} what lastSuccessfulState alone implies as the next
 *   step, or null when lastSuccessfulState is absent or not a recognized
 *   STEP_ORDER member (nothing to cross-check against)
 */
function reentryFromLastSuccessfulState(lastSuccessfulState) {
  if (!lastSuccessfulState) return null;
  const idx = STEP_ORDER.indexOf(lastSuccessfulState);
  if (idx === -1) return null;
  return idx === STEP_ORDER.length - 1 ? 'DONE' : STEP_ORDER[idx + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const { run: runId } = parseArgs(argv);

  if (!runId) {
    fail(
      'MISSING_RUN_ID',
      '"soma run resume" requires --run <runId> explicitly — resolving via .soma.lock would ' +
        'defeat AC-04 (resuming from a different session, possibly with no lock or a lock ' +
        'pointing at a different run)'
    );
  }

  const projectRoot = process.cwd();
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);

  if (!fs.existsSync(runStateFile)) {
    fail(
      'NO_SUCH_RUN',
      `no state file at ${runStateFile} — nothing to resume for run "${runId}"`
    );
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
  } catch (err) {
    fail('CORRUPT_STATE', `${runStateFile} exists but is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(state.reports)) {
    fail('CORRUPT_STATE', `${runStateFile}'s reports[] is not an array — cannot reconstitute a reentry point`);
  }

  const latest = latestStatusByStep(state.reports);
  const { reentry, lastPass } = reentryFromReports(latest);

  // Cross-check against lastSuccessfulState — a mismatch is a signal, not a
  // silent pass-through. Never fatal: reports[] (the artifact-backed
  // evidence) is the authoritative source per the contract's own ordering
  // ("a partir de reports[] + lastSuccessfulState"), lastSuccessfulState is
  // the secondary corroboration.
  const expectedFromLastSuccessful = reentryFromLastSuccessfulState(state.lastSuccessfulState);
  if (expectedFromLastSuccessful !== null && expectedFromLastSuccessful !== reentry) {
    process.stderr.write(
      `WARN: reports[] implies reentry at ${reentry}, but lastSuccessfulState ` +
        `("${state.lastSuccessfulState}") implies ${expectedFromLastSuccessful} — the two sources ` +
        `of truth disagree. Trusting reports[] (the artifact-backed evidence).\n`
    );
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      run_id: runId,
      reentry,
      last_pass: lastPass,
      session_id: process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || null,
    }) + '\n'
  );
  process.stdout.write(
    `soma run resume: run "${runId}" reenters at ${reentry} (last pass: ${lastPass || 'none'})\n`
  );
  process.exit(0);
}

main();
