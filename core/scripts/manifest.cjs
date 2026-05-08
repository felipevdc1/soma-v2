#!/usr/bin/env node
'use strict';
/**
 * manifest.cjs — SOMA v2.1.4 manifest tooling.
 *
 * Currently supports: baseline subverb (stub).
 * Real baseline logic is implemented in T-03+.
 *
 * Usage:
 *   node manifest.cjs baseline [--dry-run] [--apply] [--filter <value>] [--json] [--help]
 *
 * Exit codes:
 *   0 — ok / help / stub success
 *   2 — invalid args (INVALID_ARGS or UNKNOWN_SUBVERB)
 *
 * @spec [SPEC:AC-10] [SPEC:AC-15]
 * @task T-01
 */

// ── Arg parsing ───────────────────────────────────────────────────────────────

/**
 * Parse process.argv args for the manifest command.
 *
 * @param {string[]} argv - args after stripping 'node' and script path
 * @returns {{ subverb: string|null, flags: object, errors: string[] }}
 */
function parseArgs(argv) {
  const flags = {
    dryRun: false,
    apply:  false,
    filter: null,
    json:   false,
    help:   false,
  };
  const errors = [];
  let subverb = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--dry-run')  { flags.dryRun = true; }
    else if (arg === '--apply') { flags.apply  = true; }
    else if (arg === '--json')  { flags.json   = true; }
    else if (arg === '--help' || arg === '-h') { flags.help = true; }
    else if (arg === '--filter') {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags.filter = argv[++i];
      } else {
        errors.push('--filter requires a value');
      }
    }
    else if (arg.startsWith('--filter=')) {
      flags.filter = arg.slice('--filter='.length);
    }
    else if (arg.startsWith('--')) {
      errors.push(`Unknown flag: ${arg}`);
    }
    else if (subverb === null) {
      subverb = arg;
    }
    else {
      errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  // Mutually exclusive: --dry-run and --apply cannot be combined
  if (flags.dryRun && flags.apply) {
    errors.push('--dry-run and --apply are mutually exclusive');
  }

  return { subverb, flags, errors };
}

// ── Help text ─────────────────────────────────────────────────────────────────

function printHelp() {
  process.stdout.write('Usage: soma manifest <subverb> [options]\n\n');
  process.stdout.write('Subverbs:\n');
  process.stdout.write('  baseline    Compute or apply manifest baseline (stub in T-01)\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write('  --dry-run   Preview changes without writing (mutually exclusive with --apply)\n');
  process.stdout.write('  --apply     Write computed baseline to manifest (mutually exclusive with --dry-run)\n');
  process.stdout.write('  --filter    Filter entries by id or path (exact match)\n');
  process.stdout.write('  --json      Emit machine-readable JSON output\n');
  process.stdout.write('  --help      Show this usage message and exit 0\n');
}

// ── Error emitter ─────────────────────────────────────────────────────────────

/**
 * Emit a structured error to stderr (JSON) and exit 2.
 *
 * @param {string} code  - error code (e.g. INVALID_ARGS, UNKNOWN_SUBVERB)
 * @param {string} message
 */
function emitError(code, message) {
  process.stderr.write(JSON.stringify({ error: code, message }) + '\n');
  process.exit(2);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { subverb, flags, errors } = parseArgs(process.argv.slice(2));

// --help shortcut (before error checks per convention)
if (flags.help) {
  printHelp();
  process.exit(0);
}

// Arg errors → INVALID_ARGS exit 2
if (errors.length > 0) {
  emitError('INVALID_ARGS', errors.join('; '));
}

// No subverb → print help + exit 0
if (subverb === null) {
  printHelp();
  process.exit(0);
}

// Unknown subverb → UNKNOWN_SUBVERB exit 2
if (subverb !== 'baseline') {
  emitError('UNKNOWN_SUBVERB', `Unknown subverb: ${subverb}. Valid: baseline`);
}

// baseline subverb — stub (T-01 foundation; real logic in T-03+)
process.stdout.write('manifest baseline: stub (T-01 foundation, impl in T-03+)\n');
process.exit(0);
