#!/usr/bin/env node
'use strict';
/**
 * install.cjs — SOMA v2.2 canonical install pipeline (T-01 skeleton)
 *
 * Orchestrates full SOMA project installation in a target directory by
 * composing `soma init`, `soma manifest baseline`, and `soma sync --apply`
 * in an idempotent fail-loud pipeline.
 *
 * NOTE: This is the T-01 FOUNDATION SCAFFOLD — argv parsing stub only.
 *       No orchestration logic yet (T-07 through T-17 implement that).
 *       Stub returns exit 0 on valid invocation, exit 1 on usage error.
 *
 * Usage:
 *   node install.cjs <project-path> [flags]
 *
 * Flags:
 *   --tool=<claude|codex|both>  Harness adapter (default: claude)
 *   --dry-run                   Preview only, no mutations
 *   --merge-claude-md           Preserve free-text CLAUDE.md + append anchor
 *   --replace-claude-md         Snapshot + replace CLAUDE.md with anchor only
 *   --force-resync              Bypass sha-mismatch abort
 *   --allow-local-edits         Pass-through escape hatch for sync drift
 *
 * Exit codes:
 *   0 — success (or dry-run preview complete)
 *   1 — usage error (missing path, invalid flags, mutual exclusion)
 *   2 — hard error (drift, partial-fail, lockfile contention, etc.) [T-07+]
 *
 * Constraints:
 *   --merge-claude-md and --replace-claude-md are mutually exclusive → exit 1
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05]
 * @spec [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09]
 * @contract CONTRACT-01 (core/specs/015-soma-install/contracts/install-cli.md)
 * @plan    core/specs/015-soma-install/plan.md
 * @task    T-01 (foundation scaffold — stub only)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve a raw project-path to an absolute path.
 *
 * Applies path.resolve() so downstream tasks (T-08..T-17) always receive an
 * absolute path, regardless of whether the caller passed a relative path.
 *
 * @param {string} rawPath  Raw project-path from parseArgs
 * @returns {string}        Absolute resolved path
 */
function resolveProjectPath(rawPath) {
  return path.resolve(rawPath);
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

/**
 * Parse process.argv (already sliced to user args) into structured flags.
 *
 * Handles:
 *   - Positional: first non-flag arg = project-path
 *   - Boolean flags: --dry-run, --merge-claude-md, --replace-claude-md,
 *                    --force-resync, --allow-local-edits
 *   - Value flags:  --tool=<value>
 *   - Quoted paths with spaces or leading hyphens (Node already handles this
 *     since argv is pre-split by the shell; no special treatment needed here)
 *
 * @param {string[]} argv  Slice of process.argv after the script name
 * @returns {{ projectPath: string|null, flags: object, errors: string[] }}
 */
function parseArgs(argv) {
  const flags = {
    tool: 'claude',
    dryRun: false,
    mergeClaudioMd: false,
    replaceClaudioMd: false,
    forceResync: false,
    allowLocalEdits: false,
  };
  const errors = [];
  let projectPath = null;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--merge-claude-md') {
      flags.mergeClaudioMd = true;
    } else if (arg === '--replace-claude-md') {
      flags.replaceClaudioMd = true;
    } else if (arg === '--force-resync') {
      flags.forceResync = true;
    } else if (arg === '--allow-local-edits') {
      flags.allowLocalEdits = true;
    } else if (arg.startsWith('--tool=')) {
      const value = arg.slice('--tool='.length);
      const valid = ['claude', 'codex', 'both'];
      if (!valid.includes(value)) {
        errors.push(`--tool must be one of: ${valid.join(', ')}. Got: "${value}"`);
      } else {
        flags.tool = value;
      }
    } else if (arg.startsWith('--')) {
      errors.push(`Unknown flag: ${arg}`);
    } else if (projectPath === null) {
      // First non-flag arg is the project path.
      // Note: paths with spaces or leading hyphens are handled transparently
      // because the shell quotes them before passing to Node (AC-06).
      projectPath = arg;
    } else {
      errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  // Mutual exclusion: --merge-claude-md + --replace-claude-md
  if (flags.mergeClaudioMd && flags.replaceClaudioMd) {
    errors.push('--merge-claude-md and --replace-claude-md are mutually exclusive');
  }

  return { projectPath, flags, errors };
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function printUsage() {
  process.stderr.write(
    'usage: soma install <project-path> [--tool=<claude|codex|both>] ' +
    '[--dry-run] [--merge-claude-md | --replace-claude-md] ' +
    '[--force-resync] [--allow-local-edits]\n'
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Main entry point. Accepts an argv array (pre-sliced, without node/script).
 * Returns exit code (caller must call process.exit).
 *
 * @param {string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  const { projectPath, flags, errors } = parseArgs(argv);

  // Validation: missing project-path
  if (projectPath === null && errors.length === 0) {
    printUsage();
    return 1;
  }

  // Validation: flag errors (including mutual exclusion)
  if (errors.length > 0) {
    for (const err of errors) {
      process.stderr.write(`soma install: ${err}\n`);
    }
    printUsage();
    return 1;
  }

  // T-07: Resolve project-path to absolute (downstream tasks need absolute path).
  const projectPathAbs = resolveProjectPath(projectPath);

  // T-07: Validate that project-path exists and is a directory.
  // CONTRACT-01: "project-path … Must exist."
  if (!fs.existsSync(projectPathAbs) || !fs.statSync(projectPathAbs).isDirectory()) {
    process.stderr.write(
      `soma install: project-path does not exist or is not a directory: "${projectPathAbs}"\n` +
      `  Ensure the directory exists before running soma install.\n`
    );
    return 1;
  }

  // T-07: --tool=codex|both sanity check — Codex requires ~/.codex/ to exist.
  // CONTRACT-01: "Codex requires ~/.codex/ to exist; aborts with hint if missing."
  if (flags.tool === 'codex' || flags.tool === 'both') {
    const codexDir = path.join(os.homedir(), '.codex');
    if (!fs.existsSync(codexDir)) {
      process.stderr.write(
        `soma install: --tool=${flags.tool} requires Codex CLI to be installed.\n` +
        `  Missing: ~/.codex/ — Codex CLI config directory not found.\n` +
        `  Install Codex CLI first, or use --tool=claude to proceed without Codex.\n`
      );
      return 2;
    }
  }

  // T-01 STUB: argv parsing + path validation complete.
  // Orchestration pipeline implemented in T-08 through T-17.
  // Return exit 0 to signal valid invocation with valid project-path.
  void projectPathAbs; // consumed by T-08+ pipeline stages
  void flags; // used in future tasks
  return 0;
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const exitCode = main(process.argv.slice(2));
  process.exit(exitCode);
}

// ── Module exports (for testability) ─────────────────────────────────────────

module.exports = { main, parseArgs, resolveProjectPath };
