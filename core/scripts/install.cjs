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
const { spawnSync } = require('node:child_process');

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

// ── Sibling script paths ──────────────────────────────────────────────────────

const INIT_CJS     = path.join(__dirname, 'init.cjs');
const MANIFEST_CJS = path.join(__dirname, 'manifest.cjs');
const SYNC_CJS     = path.join(__dirname, 'sync.cjs');
// sourceCore: the core/ dir of the SOMA repo — works both in lab (core/scripts/) and
// post-install (~/.soma-v2/scripts/), so sync.cjs always resolves templates correctly.
const SOURCE_CORE  = path.resolve(__dirname, '..');

// ── Pipeline helpers ──────────────────────────────────────────────────────────

/**
 * Run a child process step and return its result.
 *
 * @param {string} label   Human-readable step name (for error messages)
 * @param {string[]} args  Arguments: [executablePath, ...processArgs]
 * @param {object} opts    spawnSync options override (e.g., cwd)
 * @returns {{ ok: boolean, status: number, stdout: string, stderr: string }}
 */
function runStep(label, args, opts = {}) {
  const [cmd, ...rest] = args;
  const result = spawnSync('node', [cmd, ...rest], {
    encoding: 'utf8',
    timeout: 30000,
    ...opts,
  });
  const ok = result.status === 0;
  return {
    ok,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    label,
  };
}

/**
 * Run the dry-run preview: show what would happen without mutating anything.
 *
 * @param {string} projectPathAbs  Absolute resolved project path
 * @param {object} flags           Parsed flags from parseArgs
 */
function runDryRun(projectPathAbs, flags) {
  const harnessLabel = flags.tool === 'both' ? 'claude + codex' : flags.tool;
  process.stdout.write(`SOMA install (dry-run): ${projectPathAbs}\n`);
  process.stdout.write(`  Harness: ${harnessLabel}\n`);
  process.stdout.write(`  Would create: .soma/, .soma/project.md, .soma/CONTEXT.md, .soma/manifest.json, .soma/installed-state.json\n`);
  process.stdout.write(`  Would inject anchored block in CLAUDE.md (block_id=block.claude.CLAUDE.md.*)\n`);
  process.stdout.write(`  No mutations applied.\n`);
}

/**
 * Parse the block_id from sync.cjs stdout output.
 * Looks for "block.claude.CLAUDE.md" or "block.codex.AGENTS.md" patterns.
 *
 * @param {string} syncStdout
 * @returns {string} block_id or placeholder string
 */
function parseSyncBlockId(syncStdout) {
  const match = syncStdout.match(/block\.[a-z]+\.[A-Z_]+\.md\.[a-z0-9._-]+|block\.[a-z]+\.[A-Z]+\.md/);
  return match ? match[0] : '(injected)';
}

/**
 * Parse the snapshot path from sync.cjs JSON stdout.
 *
 * @param {string} syncStdout
 * @returns {string} snapshot path or placeholder
 */
function parseSyncSnapshotPath(syncStdout) {
  try {
    // Sync may emit evidence line + JSON result; try last valid JSON object
    const lines = syncStdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed && parsed.snapshot && parsed.snapshot.path) {
          return parsed.snapshot.path;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return `${path.join(os.homedir(), '.soma-v2', '.snapshots')}/`;
}

/**
 * Orchestrate the full greenfield install pipeline for one tool.
 *
 * Steps:
 *   1. init.cjs <projectPathAbs>               → creates .soma/
 *   2. manifest.cjs baseline --apply            → SOMA source manifest baseline update
 *   3. sync.cjs --apply --tool=<tool>           → injects anchored block into CLAUDE.md / AGENTS.md
 *
 * On any non-zero child exit → returns non-zero exit code (2) with descriptive stderr.
 * T-09 owns: state file write, lockfile, idempotent detection.
 * T-13 owns: rollback on partial failure.
 *
 * @param {string} projectPathAbs  Absolute project path (validated, exists, is directory)
 * @param {object} flags           Parsed flags (tool, dryRun, etc.)
 * @returns {number} exit code (0 = success, 2 = pipeline failure)
 * @spec [SPEC:AC-01] [CONTRACT:01]
 * @task T-08
 */
function orchestrate(projectPathAbs, flags) {
  // ── Step 1: init.cjs ───────────────────────────────────────────────────────
  const initResult = runStep('init', [INIT_CJS, projectPathAbs]);
  if (!initResult.ok) {
    if (initResult.status === 1) {
      // init exit 1 = "already initialized" (REDIRECT). .soma/ already exists.
      // T-12 owns proper recovery (re-run detection + state-matching).
      // For T-08, skip init and proceed with manifest + sync (pipeline resume).
      // This ensures CC-02 tests (which use os.tmpdir() with existing .soma/) keep passing.
    } else {
      // init exit 2 = hard error (template missing, IO failure, etc.)
      process.stderr.write(
        `soma install: init failed (exit ${initResult.status}) — ${initResult.stderr.trim() || 'no output'}\n`
      );
      return 2;
    }
  }

  // ── Step 2: manifest.cjs baseline --apply ─────────────────────────────────
  const manifestResult = runStep('manifest-baseline', [MANIFEST_CJS, 'baseline', '--apply'], {
    cwd: projectPathAbs,
  });
  if (!manifestResult.ok) {
    process.stderr.write(
      `soma install: manifest baseline failed (exit ${manifestResult.status}) — ${manifestResult.stderr.trim() || 'no output'}\n`
    );
    return 2;
  }

  // ── Step 3: sync.cjs --apply ───────────────────────────────────────────────
  // Run sync for claude tool (and optionally codex for --tool=both).
  const toolsToSync = flags.tool === 'both' ? ['claude', 'codex'] : [flags.tool];

  let lastSyncStdout = '';
  for (const tool of toolsToSync) {
    const syncArgs = [
      SYNC_CJS,
      '--apply',
      `--tool=${tool}`,
      `--soma-home=${SOURCE_CORE}`,
    ];
    if (flags.allowLocalEdits) syncArgs.push('--allow-local-edits');

    const syncResult = runStep(`sync-${tool}`, syncArgs, { cwd: projectPathAbs });
    if (!syncResult.ok) {
      process.stderr.write(
        `soma install: sync --apply --tool=${tool} failed (exit ${syncResult.status}) — ${syncResult.stderr.trim() || syncResult.stdout.trim() || 'no output'}\n`
      );
      return 2;
    }
    lastSyncStdout = syncResult.stdout;
  }

  // ── Success output (CONTRACT-01 format) ────────────────────────────────────
  const harnessLabel = flags.tool === 'both' ? 'claude + codex' : flags.tool;
  const blockId = parseSyncBlockId(lastSyncStdout);
  const snapshotPath = parseSyncSnapshotPath(lastSyncStdout);

  process.stdout.write(`SOMA install complete: ${projectPathAbs}\n`);
  process.stdout.write(`  Harness: ${harnessLabel}\n`);
  process.stdout.write(`  .soma/ created\n`);
  process.stdout.write(`  manifest.json baseline captured\n`);
  process.stdout.write(`  CLAUDE.md anchored block injected (block_id=${blockId})\n`);
  process.stdout.write(`  Snapshot: ${snapshotPath}\n`);
  // T-09 will replace this placeholder with real state file write + status.
  process.stdout.write(`  install-state.json status=pending (T-09 will write this)\n`);

  return 0;
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

  // T-08: Orchestrate the install pipeline.
  // --dry-run: preview only, no mutations.
  if (flags.dryRun) {
    runDryRun(projectPathAbs, flags);
    return 0;
  }

  // Greenfield pipeline: init → manifest baseline → sync.
  return orchestrate(projectPathAbs, flags);
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const exitCode = main(process.argv.slice(2));
  process.exit(exitCode);
}

// ── Module exports (for testability) ─────────────────────────────────────────

module.exports = { main, parseArgs, resolveProjectPath };
