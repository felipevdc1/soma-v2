#!/usr/bin/env node
'use strict';
/**
 * soma.cjs — SOMA v2.1 unified CLI dispatcher (T-14)
 *
 * Routes `soma <subcommand> [args...]` to the corresponding script via
 * child_process.spawnSync. Exit code is passed through from the child.
 *
 * Usage:
 *   soma --help                     → print usage table, exit 0
 *   soma --version                  → print version, exit 0
 *   soma <subcmd> [args...]         → delegate to scripts/<subcmd>.cjs
 *   soma <unknown>                  → JSON UNKNOWN_SUBCOMMAND on stderr, exit 2
 *   soma (no args)                  → print usage, exit 0
 *
 * Exit codes:
 *   0 — ok / help / version / no-args usage
 *   1 — child script error (passthrough)
 *   2 — invalid args (UNKNOWN_SUBCOMMAND)
 *   other — passthrough from child
 *
 * @spec [SPEC:AC-07] [SPEC:AC-10] [SPEC:AC-20]
 * @task T-14
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

// ── Version ───────────────────────────────────────────────────────────────────

const VERSION = 'soma-v2.1';

// ── Subcommand registry ───────────────────────────────────────────────────────

/**
 * Maps each subcommand to its script filename and a 1-line description.
 * Order matters for --help display.
 */
const SUBCOMMANDS = [
  { name: 'bootstrap', script: 'bootstrap.cjs', desc: 'Validate current project against SOMA schema' },
  { name: 'init',      script: 'init.cjs',      desc: 'Initialize a new SOMA project or extend existing' },
  { name: 'install',   script: 'install.cjs',   desc: 'Install SOMA into a target project (init + baseline + sync)' },
  { name: 'doctor',    script: 'doctor.cjs',     desc: 'Detect drift, stale entries, and migration status' },
  { name: 'sync',      script: 'sync.cjs',       desc: 'Sync anchored blocks to target files (dry-run or --apply)' },
  { name: 'rollback',  script: 'rollback.cjs',   desc: 'Restore files from a pre-write snapshot' },
  { name: 'manifest',  script: 'manifest.cjs',   desc: 'Manage manifest baseline + future verbs' },
  { name: 'module',    script: 'module.cjs',     desc: 'Manage SOMA modules (add, remove, deprecate)' },
  { name: 'audit',     script: 'audit.cjs',      desc: 'Run audit checks across SOMA contexts' },
];

const VALID_NAMES = SUBCOMMANDS.map(s => s.name);

// ── Usage text ────────────────────────────────────────────────────────────────

function printUsage() {
  process.stdout.write(`Usage: soma <subcommand> [args...]\n\n`);
  process.stdout.write(`Subcommands:\n`);
  const maxLen = Math.max(...SUBCOMMANDS.map(s => s.name.length));
  for (const { name, desc } of SUBCOMMANDS) {
    process.stdout.write(`  ${name.padEnd(maxLen + 2)}${desc}\n`);
  }
  process.stdout.write(`\nOptions:\n`);
  process.stdout.write(`  --help       Show this usage message\n`);
  process.stdout.write(`  --version    Print version and exit\n`);
  process.stdout.write(`\nExamples:\n`);
  process.stdout.write(`  soma bootstrap\n`);
  process.stdout.write(`  soma sync --dry-run\n`);
  process.stdout.write(`  soma sync --apply --tool=claude\n`);
  process.stdout.write(`  soma rollback --snapshot-id 2026-05-03T10-00-00Z\n`);
  process.stdout.write(`  soma doctor --check-migration\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

// No args → usage + exit 0
if (argv.length === 0) {
  printUsage();
  process.exit(0);
}

const firstArg = argv[0];

// --help → usage + exit 0
if (firstArg === '--help' || firstArg === '-h') {
  printUsage();
  process.exit(0);
}

// --version → version + exit 0
if (firstArg === '--version' || firstArg === '-v') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// Resolve subcommand
const subcmd = SUBCOMMANDS.find(s => s.name === firstArg);

if (!subcmd) {
  // Unknown subcommand → JSON to stderr, exit 2
  const errOut = JSON.stringify({
    error:      'UNKNOWN_SUBCOMMAND',
    subcommand: firstArg,
    valid:      VALID_NAMES,
  });
  process.stderr.write(errOut + '\n');
  process.exit(2);
}

// Delegate to script via spawnSync
const scriptPath = path.join(__dirname, subcmd.script);
const childArgs  = argv.slice(1); // strip subcommand, pass rest verbatim

const result = spawnSync('node', [scriptPath, ...childArgs], {
  stdio: 'inherit',
});

// Propagate exit code (or signal)
if (result.status !== null) {
  process.exit(result.status);
} else if (result.signal) {
  // Child was killed by signal — exit with 1
  process.stderr.write(`soma: child process killed by signal ${result.signal}\n`);
  process.exit(1);
} else {
  process.exit(0);
}
