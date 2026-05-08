#!/usr/bin/env node
'use strict';
/**
 * manifest.cjs — SOMA v2.1.4 manifest tooling.
 *
 * Supports: baseline subverb.
 *
 * Usage:
 *   node manifest.cjs baseline [--dry-run] [--apply] [--filter <value>] [--json] [--help]
 *
 * Exit codes:
 *   0 — ok / help / dry-run / apply success
 *   2 — invalid args (INVALID_ARGS, UNKNOWN_SUBVERB) or manifest error (MANIFEST_MISSING, MANIFEST_INVALID)
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-10] [SPEC:AC-13] [SPEC:AC-14] [SPEC:AC-15]
 * @task T-03
 */

const fs      = require('node:fs');
const path    = require('node:path');
const os      = require('node:os');
const crypto  = require('node:crypto');

const { loadManifest } = require('./lib/manifest.cjs');

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
  process.stdout.write('  baseline    Compute or apply manifest baseline\n\n');
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
 * @param {string} code  - error code (e.g. INVALID_ARGS, UNKNOWN_SUBVERB, MANIFEST_MISSING, MANIFEST_INVALID)
 * @param {string} message
 */
function emitError(code, message) {
  process.stderr.write(JSON.stringify({ error: code, message }) + '\n');
  process.exit(2);
}

// ── sha256 helper ─────────────────────────────────────────────────────────────

/**
 * Compute sha256 hex digest of a Buffer.
 * @param {Buffer} buf
 * @returns {string}
 */
function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── Core baseline ─────────────────────────────────────────────────────────────

/**
 * Run the baseline computation (dry-run or apply).
 *
 * @param {object} opts
 * @param {string} opts.somaHome       - path to SOMA home directory
 * @param {'dry-run'|'apply'} opts.mode - operation mode
 * @param {boolean} opts.json          - emit JSON output instead of human-readable
 * @param {string|null} opts.filter    - literal filter value (T-04 will implement matching; stored as-is)
 * @param {boolean} opts.isDefaultMode - true when neither --dry-run nor --apply was given (hint emission)
 */
function runBaseline({ somaHome, mode, json, filter, isDefaultMode }) {
  const manifestPath = path.join(somaHome, 'manifest.json');

  // Load manifest — throws typed errors (MANIFEST_MISSING / MANIFEST_INVALID)
  let manifest;
  try {
    manifest = loadManifest(somaHome);
  } catch (err) {
    emitError(err.code || 'MANIFEST_INVALID', err.message);
  }

  const files = manifest.files || [];

  // Apply filter: exact-match against entry.id OR entry.path (D-014-2 lock — no glob/regex).
  // A glob-like value such as 'adapters/*' is treated as a LITERAL string and will match 0 entries
  // unless some entry has that exact id or path.
  const entriesToProcess = (filter !== null && filter !== undefined && filter !== '')
    ? files.filter(e => e.id === filter || e.path === filter)
    : files;

  const entriesRebaseled = [];
  const entriesSkipped   = [];
  let entriesClean = 0;

  for (const entry of entriesToProcess) {
    const labPath = path.join(somaHome, entry.path);
    let actualBuf;
    try {
      actualBuf = fs.readFileSync(labPath);
    } catch (err) {
      // T-07 will handle ENOENT gracefully (skip + warn + exit 0).
      // For now, propagate so the process exits non-zero.
      throw err;
    }

    const actualSha = sha256hex(actualBuf);

    if (actualSha !== entry.sha256) {
      entriesRebaseled.push({
        id:         entry.id,
        path:       entry.path,
        old_sha256: entry.sha256,
        new_sha256: actualSha,
      });
    } else {
      entriesClean++;
    }
  }

  // Apply mode: atomic write iff there are stale entries (idempotency: skip write if none)
  if (mode === 'apply' && entriesRebaseled.length > 0) {
    const rebaseledById = Object.fromEntries(
      entriesRebaseled.map(e => [e.id, e.new_sha256])
    );

    // Build updated files array — only change sha256, preserve all other fields (incl. sourceSha256)
    const newFiles = files.map(f => {
      const newSha = rebaseledById[f.id];
      if (newSha !== undefined) {
        return { ...f, sha256: newSha };
      }
      return f;
    });

    const newManifest = { ...manifest, files: newFiles };

    // Atomic write: write to .tmp then rename (matches sync.cjs convention)
    const tmpPath = manifestPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(newManifest, null, 2) + '\n');
    fs.renameSync(tmpPath, manifestPath);
  }

  // ── Output ────────────────────────────────────────────────────────────────

  const result = {
    schema:               'soma-manifest-baseline/v1',
    mode,
    manifest_path:        manifestPath,
    snapshot_path:        null,              // T-06 will wire createSnapshot()
    entries_considered:   entriesToProcess.length,
    entries_rebaseled:    entriesRebaseled,
    entries_skipped:      entriesSkipped,
    entries_clean:        entriesClean,
    filter_applied:       filter || null,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    // Human-readable output
    const count = entriesRebaseled.length;

    if (count === 0) {
      process.stdout.write(`0 stale entries. Manifest is clean.\n`);
    } else {
      process.stdout.write(
        `${count} stale ${count === 1 ? 'entry' : 'entries'} found:\n`
      );
      for (const e of entriesRebaseled) {
        process.stdout.write(
          `  ${e.id} (${e.path}): ${e.old_sha256.slice(0, 8)}... → ${e.new_sha256.slice(0, 8)}...\n`
        );
      }
    }

    if (mode === 'apply' && count > 0) {
      process.stdout.write(
        `Updated ${count} ${count === 1 ? 'entry' : 'entries'} in manifest.\n`
      );
    }

    // Default-mode hint: no explicit --dry-run or --apply flag → remind user about --apply
    if (isDefaultMode) {
      process.stdout.write(`Hint: pass --apply to write the updated manifest.\n`);
    }
  }

  process.exit(0);
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

// baseline subverb — real implementation (T-03)
const somaHome = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');

// Determine mode: apply if --apply; dry-run otherwise
const isDefaultMode = !flags.dryRun && !flags.apply;
const mode          = flags.apply ? 'apply' : 'dry-run';

runBaseline({
  somaHome,
  mode,
  json:          flags.json,
  filter:        flags.filter,
  isDefaultMode,
});
