#!/usr/bin/env node
'use strict';
/**
 * run.cjs — `soma run` thin dispatcher (Spec 016, T-01)
 *
 * Routes `soma run <verb> [args...]` to `core/scripts/run/{verb}.cjs`, the
 * same delegation pattern soma.cjs already uses for top-level subcommands.
 *
 * Each verb lives in its own module under run/.
 *
 * Usage:
 *   soma run --help                 → list the verbs, exit 0
 *   soma run                        → same as --help, exit 0
 *   soma run <verb> [args...]       → delegate to run/<verb>.cjs
 *   soma run <unknown-verb>         → JSON UNKNOWN_VERB on stderr, exit 2
 *   soma run <verb-not-yet-built>   → JSON VERB_NOT_IMPLEMENTED on stderr,
 *                                     exit 2 — NEVER a MODULE_NOT_FOUND
 *                                     stack trace. Wave 2 tasks run with
 *                                     sibling verb modules still missing;
 *                                     this has to fail legibly for them.
 *
 * Exit codes:
 *   0 — help / no-args usage
 *   2 — unknown verb, or verb not yet implemented
 *   other — passthrough from the delegated verb script
 *
 * @spec [SPEC:AC-01] [SPEC:AC-03]
 * @task T-01
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ── Verb registry ─────────────────────────────────────────────────────────────

const VERBS = [
  { name: 'state', desc: 'Persist soma-state/v2 run-state to {project}/.soma/run-state-{runId}.json' },
  { name: 'report', desc: 'Emit a validated soma-step-report/v1 for the step that just concluded' },
  { name: 'gate', desc: "Check the previous step's report and decide whether the transition is allowed" },
  { name: 'resume', desc: 'Resume a run from the last step with a report status "pass"' },
  { name: 'dispatch-record', desc: 'Materialize prompt.md/output.md/metadata.json for a dispatched task' },
  { name: 'checkpoint', desc: 'Publish an immutable checkpoint derived from durable run evidence' },
  { name: 'handoff', desc: 'Publish an immutable handoff for exact cross-session resume' },
];

const VALID_NAMES = VERBS.map(v => v.name);

// ── Usage text ────────────────────────────────────────────────────────────────

function printUsage() {
  process.stdout.write(`Usage: soma run <verb> [args...]\n\n`);
  process.stdout.write(`Verbs:\n`);
  const maxLen = Math.max(...VERBS.map(v => v.name.length));
  for (const { name, desc } of VERBS) {
    process.stdout.write(`  ${name.padEnd(maxLen + 2)}${desc}\n`);
  }
  process.stdout.write(`\nOptions:\n`);
  process.stdout.write(`  --help    Show this usage message\n`);
  process.stdout.write(`\nExamples:\n`);
  process.stdout.write(`  soma run report --step STEP_3_FOUNDATION --status pass\n`);
  process.stdout.write(`  soma run gate --step STEP_4_WAVES\n`);
  process.stdout.write(`  soma run resume --run run-260815-2340-a1b2c3\n`);
  process.stdout.write(`  soma run checkpoint --run run-260815-2340-a1b2c3 --input-file checkpoint.json\n`);
  process.stdout.write(`  soma run handoff --run run-260815-2340-a1b2c3\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

// No args, or --help/-h → usage + exit 0
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
  printUsage();
  process.exit(0);
}

const verbName = argv[0];
const verb = VERBS.find(v => v.name === verbName);

if (!verb) {
  const errOut = JSON.stringify({
    error: 'UNKNOWN_VERB',
    verb: verbName,
    valid: VALID_NAMES,
  });
  process.stderr.write(errOut + '\n');
  process.exit(2);
}

const scriptPath = path.join(__dirname, 'run', `${verb.name}.cjs`);

// Verb is known but its module hasn't landed yet (Wave 2 task not run in
// this working tree). Check existence BEFORE requiring/spawning it — this
// is what keeps the failure legible instead of a MODULE_NOT_FOUND stack.
if (!fs.existsSync(scriptPath)) {
  const errOut = JSON.stringify({
    error: 'VERB_NOT_IMPLEMENTED',
    verb: verb.name,
    message: `soma run ${verb.name} is not implemented yet (${scriptPath} not found)`,
  });
  process.stderr.write(errOut + '\n');
  process.exit(2);
}

// Delegate to the verb script via spawnSync — same convention as soma.cjs.
const childArgs = argv.slice(1);
const result = spawnSync('node', [scriptPath, ...childArgs], { stdio: 'inherit' });

if (result.status !== null) {
  process.exit(result.status);
} else if (result.signal) {
  process.stderr.write(`soma run: child process killed by signal ${result.signal}\n`);
  process.exit(1);
} else {
  process.exit(0);
}
