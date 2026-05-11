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
 *   --allow-local-edits         Pass-through escape hatch for sync drift (intentional override)
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
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * SOMA version string installed by this build.
 * Read from package.json — single source of truth post v2.2 bump.
 * Rationale: v2.2.0 introduces the project-bootloader block which embeds the version
 * string in <project>/CLAUDE.md at install time. A single hardcoded string would
 * diverge from package.json on future bumps. Reading dynamically prevents drift.
 * package.json lives at repo root (2 levels up from core/scripts/).
 */
const _pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
const SOMA_INSTALLED_VERSION = _pkg.version;

/** Stale lock threshold: 60 minutes in milliseconds. */
const STALE_LOCK_THRESHOLD_MS = 60 * 60 * 1000;

/** Valid status enum values per CONTRACT-02. */
const VALID_STATUSES = ['complete', 'partial-failed', 'drift-detected'];

/** Valid harness enum values per CONTRACT-02. */
const VALID_HARNESSES = ['claude', 'codex', 'both'];

/** ISO-8601 UTC pattern (Z suffix) required by CONTRACT-02. */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Semver prefix pattern per CONTRACT-02. */
const SEMVER_RE = /^\d+\.\d+\.\d+/;

/** Allowed top-level fields per CONTRACT-02 (additionalProperties: false). */
const ALLOWED_STATE_FIELDS = new Set([
  '$schema', 'status', 'timestamp', 'snapshotId', 'harness', 'installedVersion', 'lastError', 'blockIds',
]);

// ── CLAUDE.md detection helpers (T-14, T-15, T-16) ──────────────────────────

/**
 * Classify the state of a CLAUDE.md file for the custom-handling branch.
 *
 * Returns one of:
 *   'absent'      — file does not exist (greenfield)
 *   'anchor-only' — file exists and contains only soma-v2 anchor markers (no free-text before anchor)
 *   'free-text'   — file exists and has content WITHOUT soma-v2 anchor markers
 *   'mixed'       — file exists and has both free-text AND anchor markers (prior merge run)
 *
 * @param {string} claudeMdPath  Absolute path to CLAUDE.md
 * @returns {'absent' | 'anchor-only' | 'free-text' | 'mixed'}
 * @task T-14 T-15 T-16
 * @spec [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09]
 */
function classifyClaudeMd(claudeMdPath) {
  if (!fs.existsSync(claudeMdPath)) {
    return 'absent';
  }

  let content;
  try {
    content = fs.readFileSync(claudeMdPath, 'utf8');
  } catch (_) {
    return 'absent';
  }

  const hasAnchor = content.includes('<!-- soma-v2:start');

  // "free-text" = has content AND no anchors at all
  if (!hasAnchor && content.trim().length > 0) {
    return 'free-text';
  }

  if (hasAnchor) {
    // Check if there's meaningful free-text BEFORE the first anchor marker.
    // If the file starts with the anchor (possibly preceded only by whitespace), it's anchor-only.
    const firstAnchorIdx = content.indexOf('<!-- soma-v2:start');
    const beforeAnchor = content.slice(0, firstAnchorIdx).trim();
    return beforeAnchor.length > 0 ? 'mixed' : 'anchor-only';
  }

  // File exists but is empty — treat as absent (greenfield)
  return 'absent';
}

/**
 * Snapshot the original CLAUDE.md file before replacement (AC-08).
 *
 * Creates a snapshot directory at `~/.soma-v2/.snapshots/<ISO-timestamp>/`
 * and writes the original content as `CLAUDE.md.original`.
 * Emits "Original preserved at <snapDir>/" to stdout.
 *
 * @param {string} claudeMdPath  Absolute path to CLAUDE.md to snapshot
 * @returns {string}             Snapshot directory path
 * @throws {Error}               If snapshot directory or file cannot be created
 * @task T-15
 * @spec [SPEC:AC-08]
 */
function snapshotClaudeMd(claudeMdPath) {
  const somaHome = process.env.SOMA_HOME
    ? path.resolve(process.env.SOMA_HOME)
    : path.join(os.homedir(), '.soma-v2');
  const snapshotsBase = path.join(somaHome, '.snapshots');

  // Generate ISO-8601 UTC timestamp for snapshot dir name
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const baseTs = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}Z`;

  // Collision-safe: append -{N} suffix if needed
  let ts = baseTs;
  let n = 2;
  while (fs.existsSync(path.join(snapshotsBase, ts))) {
    ts = `${baseTs}-${n}`;
    n++;
  }

  const snapDir = path.join(snapshotsBase, ts);
  fs.mkdirSync(snapDir, { recursive: true, mode: 0o700 });

  // Copy original CLAUDE.md as CLAUDE.md.original
  const originalContent = fs.readFileSync(claudeMdPath, 'utf8');
  const destFile = path.join(snapDir, 'CLAUDE.md.original');
  fs.writeFileSync(destFile, originalContent, 'utf8');

  process.stdout.write(`  Original preserved at ${snapDir}/\n`);

  return snapDir;
}

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

// ── Lockfile helpers (T-09) ───────────────────────────────────────────────────

/**
 * Check for an existing install lock and handle stale/fresh logic.
 * Does NOT write a new lock — only reads and reacts.
 *
 * Called BEFORE init.cjs so we catch contention even if .soma/ doesn't exist yet.
 * If .soma/ doesn't exist → no lock file possible → return immediately (no conflict).
 *
 * @param {string} projectPathAbs  Absolute project path
 * @spec [CONTRACT:05]
 * @task T-09
 */
function checkLockConflict(projectPathAbs) {
  const somaDir = path.join(projectPathAbs, '.soma');
  const lockFilePath = path.join(somaDir, 'install.lock');

  // If .soma/ doesn't exist, there's no lock — proceed.
  if (!fs.existsSync(lockFilePath)) {
    return;
  }

  let existingLock = null;
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    existingLock = JSON.parse(raw);
  } catch (_) {
    // Unparseable JSON → treat as stale
    existingLock = null;
  }

  if (existingLock && typeof existingLock === 'object' && existingLock.pid) {
    // Compute age from timestamp; if timestamp missing/invalid, treat as "now" (0ms age = fresh).
    let ageMs = 0; // default: treat as fresh (contention) if timestamp absent
    if (existingLock.timestamp) {
      const lockDate = new Date(existingLock.timestamp);
      if (!isNaN(lockDate.getTime())) {
        ageMs = Date.now() - lockDate.getTime();
      }
      // if lockDate is NaN (invalid timestamp), ageMs stays 0 = treat as fresh
    }

    if (ageMs < STALE_LOCK_THRESHOLD_MS) {
      // Fresh lock — contention
      const pid = existingLock.pid;
      const ts = existingLock.timestamp || existingLock.started || '(unknown)';
      process.stderr.write(
        `soma install: Install in progress (PID ${pid}, started ${ts}).\n` +
        `  Lock: ${lockFilePath}\n` +
        `  If the previous install crashed, delete the lock manually: rm "${lockFilePath}"\n`
      );
      process.exit(2);
    } else {
      // Stale lock — auto-clean with WARNING
      const pid = existingLock.pid;
      const ageMin = Math.round(ageMs / 60000);
      process.stderr.write(
        `soma install: WARNING Stale lock detected (PID ${pid}, age ${ageMin}min). Auto-cleaning.\n`
      );
      try { fs.rmSync(lockFilePath, { force: true }); } catch (_) {}
    }
  } else {
    // Unparseable / no pid → stale treatment
    process.stderr.write(
      `soma install: WARNING Stale or invalid lock file found. Auto-cleaning.\n`
    );
    try { fs.rmSync(lockFilePath, { force: true }); } catch (_) {}
  }
}

/**
 * Write the install lock file at <projectPathAbs>/.soma/install.lock.
 * Must only be called AFTER .soma/ exists (i.e., after init.cjs completes).
 * Also creates .soma/.gitignore listing install.lock (CONTRACT-05 Invariant).
 *
 * @param {string} projectPathAbs  Absolute project path
 * @spec [CONTRACT:05]
 * @task T-09
 */
function writeLock(projectPathAbs) {
  const somaDir = path.join(projectPathAbs, '.soma');
  const lockFilePath = path.join(somaDir, 'install.lock');

  fs.mkdirSync(somaDir, { recursive: true });

  const lockContent = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
  });
  fs.writeFileSync(lockFilePath, lockContent, { mode: 0o644 });

  // ── Ensure .soma/.gitignore covers install.lock (CONTRACT-05 Invariant) ─
  const gitignorePath = path.join(somaDir, '.gitignore');
  let gitignoreContent = '';
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  }
  if (!gitignoreContent.includes('install.lock')) {
    const append = gitignoreContent.endsWith('\n') ? 'install.lock\n' : '\ninstall.lock\n';
    fs.writeFileSync(gitignorePath, gitignoreContent + append, { mode: 0o644 });
  }

  return lockFilePath;
}

/**
 * Acquire the per-project install lock at <projectPathAbs>/.soma/install.lock.
 *
 * Two-phase: first check for existing lock conflict (works even when .soma/
 * doesn't exist yet), then write the new lock after init.cjs creates .soma/.
 *
 * For the lockfile contract tests (which call acquireLock directly with
 * .soma/ pre-created), this function does both check + write atomically.
 *
 * Lifecycle per CONTRACT-05:
 *   - If lock exists and age < 60min → stderr + process.exit(2).
 *   - If lock exists and age >= 60min (stale) → WARNING stderr + delete + proceed.
 *   - If lock missing/invalid → proceed.
 *   - Creates .soma/ if absent, then writes lock JSON.
 *   - Also creates .soma/.gitignore listing install.lock.
 *
 * @param {string} projectPathAbs  Absolute project path
 * @returns {string} absolute path to the lock file
 * @spec [CONTRACT:05]
 * @task T-09
 */
function acquireLock(projectPathAbs) {
  // Check for existing lock (handles stale/fresh logic, exits on contention)
  checkLockConflict(projectPathAbs);
  // Write new lock (creates .soma/ if needed for direct calls from tests)
  return writeLock(projectPathAbs);
}

/**
 * Release the install lock — idempotent fs.rmSync (ignores ENOENT).
 * Must be called in finally{} block to guarantee cleanup on any exit path.
 *
 * @param {string} projectPathAbs  Absolute project path
 * @spec [CONTRACT:05]
 * @task T-09
 */
function releaseLock(projectPathAbs) {
  const lockFilePath = path.join(projectPathAbs, '.soma', 'install.lock');
  fs.rmSync(lockFilePath, { force: true });
}

// ── State file writer (T-09) ──────────────────────────────────────────────────

/**
 * Validate a state object against CONTRACT-02 schema and throw on violation.
 * Validates: required fields, enum values, ISO-8601 format, semver pattern,
 * status-conditional invariants (complete→blockIds, errors→lastError),
 * and additionalProperties: false.
 *
 * @param {object} state
 * @throws {Error} on schema violation
 */
function validateInstallState(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('install-state: must be a non-null object');
  }

  // additionalProperties: false
  for (const key of Object.keys(state)) {
    if (!ALLOWED_STATE_FIELDS.has(key)) {
      throw new Error(`install-state: unknown field "${key}" (additionalProperties: false per CONTRACT-02)`);
    }
  }

  // Required fields
  const required = ['status', 'timestamp', 'snapshotId', 'harness', 'installedVersion'];
  for (const field of required) {
    if (!(field in state) || state[field] === null || state[field] === undefined) {
      throw new Error(`install-state: required field "${field}" is missing or null`);
    }
  }

  // status enum
  if (!VALID_STATUSES.includes(state.status)) {
    throw new Error(`install-state: status must be one of ${VALID_STATUSES.join('|')}. Got: "${state.status}"`);
  }

  // harness enum
  if (!VALID_HARNESSES.includes(state.harness)) {
    throw new Error(`install-state: harness must be one of ${VALID_HARNESSES.join('|')}. Got: "${state.harness}"`);
  }

  // timestamp ISO-8601 UTC
  if (!ISO_UTC_RE.test(state.timestamp)) {
    throw new Error(`install-state: timestamp must be ISO-8601 UTC (Z suffix) matching /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/. Got: "${state.timestamp}"`);
  }

  // snapshotId ISO-8601 UTC (same pattern as timestamp per CONTRACT-02)
  if (!ISO_UTC_RE.test(state.snapshotId)) {
    throw new Error(`install-state: snapshotId must be ISO-8601 UTC timestamp. Got: "${state.snapshotId}"`);
  }

  // installedVersion semver prefix
  if (!SEMVER_RE.test(state.installedVersion)) {
    throw new Error(`install-state: installedVersion must match semver N.N.N prefix. Got: "${state.installedVersion}"`);
  }

  // status=complete → non-empty blockIds (CONTRACT-02 §Invariants)
  if (state.status === 'complete') {
    if (!Array.isArray(state.blockIds) || state.blockIds.length === 0) {
      throw new Error(`install-state: status=complete requires non-empty blockIds array. Got: ${JSON.stringify(state.blockIds)}`);
    }
  }

  // status=partial-failed or drift-detected → non-empty lastError
  if (state.status === 'partial-failed' || state.status === 'drift-detected') {
    if (typeof state.lastError !== 'string' || state.lastError.length === 0) {
      throw new Error(`install-state: status=${state.status} requires non-empty lastError string. Got: ${JSON.stringify(state.lastError)}`);
    }
  }
}

/**
 * Write install-state.json atomically to <projectPathAbs>/.soma/install-state.json.
 *
 * Uses write-to-temp + rename for atomic semantics (CONTRACT-02 §Invariants).
 * File mode: 0644.
 *
 * @param {string} projectPathAbs  Absolute project path
 * @param {object} state           State object — must pass validateInstallState
 * @returns {string}               Absolute path to written state file
 * @spec [CONTRACT:02] [SPEC:AC-16]
 * @task T-09
 */
function writeInstallState(projectPathAbs, state) {
  // Validate schema first (throws on violation)
  validateInstallState(state);

  const somaDir = path.join(projectPathAbs, '.soma');
  fs.mkdirSync(somaDir, { recursive: true });

  const finalPath = path.join(somaDir, 'install-state.json');

  // Atomic write: write to .tmp.<random> then rename
  const tmpSuffix = Math.random().toString(36).slice(2, 10);
  const tmpPath = path.join(somaDir, `install-state.json.tmp.${tmpSuffix}`);

  const content = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(tmpPath, content, { mode: 0o644 });

  // Atomic rename (POSIX guarantees atomicity for same-filesystem rename)
  fs.renameSync(tmpPath, finalPath);

  return finalPath;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

/**
 * Parse process.argv (already sliced to user args) into structured flags.
 *
 * Handles:
 *   - Positional: first non-flag arg = project-path
 *   - Boolean flags: --dry-run, --merge-claude-md, --replace-claude-md,
 *                    --allow-local-edits
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
    '[--allow-local-edits]\n'
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
 * Parse ALL block_ids from sync.cjs stdout output.
 * Returns an array of all matched block_id strings.
 *
 * Extended in T-09 from single-match to global-match to capture all
 * blockIds for install-state.json (CONTRACT-02 §blockIds array).
 *
 * @param {string} syncStdout
 * @returns {string[]} array of block_ids (may be empty if none found)
 */
function parseSyncBlockIds(syncStdout) {
  const pattern = /block\.[a-z]+\.[A-Z_]+\.md\.[a-z0-9._-]+|block\.[a-z]+\.[A-Z]+\.md/g;
  const matches = syncStdout.match(pattern);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Parse the first block_id from sync.cjs stdout output.
 * Kept for backward compatibility with T-08 success output line.
 *
 * @param {string} syncStdout
 * @returns {string} block_id or placeholder string
 */
function parseSyncBlockId(syncStdout) {
  const ids = parseSyncBlockIds(syncStdout);
  return ids.length > 0 ? ids[0] : '(injected)';
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
 * Build a snapshotId from sync.cjs stdout, or fall back to a truncated ISO timestamp.
 * The snapshotId must match /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/ (CONTRACT-02).
 *
 * @param {string} syncStdout
 * @returns {string} snapshotId matching ISO-8601 UTC pattern
 */
function buildSnapshotId(syncStdout) {
  const snapshotPath = parseSyncSnapshotPath(syncStdout);
  // parseSyncSnapshotPath returns full path or fallback. Extract ISO timestamp portion.
  // Snapshot dirs are named like ~/.soma-v2/.snapshots/2026-05-09T14:49:55Z/
  const tsMatch = snapshotPath.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
  if (tsMatch) {
    return tsMatch[1];
  }
  // Fallback: current timestamp truncated to seconds with Z suffix
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Orchestrate the full greenfield install pipeline.
 *
 * Steps:
 *   1. init.cjs <projectPathAbs>               → creates .soma/
 *   2. [T-09] Write install.lock after .soma/ exists
 *   3. manifest.cjs baseline --apply            → SOMA source manifest baseline update
 *   4. sync.cjs --apply --tool=<tool>           → injects anchored block into CLAUDE.md / AGENTS.md
 *   5. [T-09] Write install-state.json (complete|partial-failed|drift-detected)
 *
 * On any non-zero child exit → writes state file (status=partial-failed) and returns 2.
 * T-09 adds: state file write (complete|partial-failed|drift-detected) + lock write post-init.
 * T-10 owns: idempotent re-run detection.
 * T-11 owns: full drift detection refinement.
 * T-13 owns: rollback on partial failure.
 *
 * @param {string} projectPathAbs  Absolute project path (validated, exists, is directory)
 * @param {object} flags           Parsed flags (tool, dryRun, etc.)
 * @returns {number} exit code (0 = success, 2 = pipeline failure)
 * @spec [SPEC:AC-01] [SPEC:AC-16] [CONTRACT:01] [CONTRACT:02]
 * @task T-08 T-09
 */
function orchestrate(projectPathAbs, flags) {
  // Shared snapshotId fallback (computed once, used in state file on any path)
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // ── Step 0: CLAUDE.md free-text detection + branching (T-14, T-15, T-16) ──
  // Detect if <project>/CLAUDE.md has free-text content (no anchor markers).
  // This MUST happen before any pipeline mutation so we can abort early (AC-09)
  // or snapshot before replacement (AC-08) with zero side-effects.
  //
  // Branch logic (only when claudeMdClass === 'free-text'):
  //   --replace-claude-md → snapshot + clear CLAUDE.md (sync will re-write anchor only)
  //   --merge-claude-md   → proceed normally (sync appends anchor after free-text)
  //   no flag             → exit 2 + stderr names both flags (AC-09)
  //
  // For 'absent', 'anchor-only', 'mixed' → proceed normally (existing paths).
  //
  // IMPORTANT: Only applies when install-state.json does NOT exist (first-time install
  // on a project with existing CLAUDE.md). If install-state.json exists, we're in a
  // partial-recovery or idempotent re-run path — proceed normally regardless of CLAUDE.md content.
  // This prevents false-positive "free-text" detection on SOMA-generated headings that remain
  // after the anchored block is stripped (e.g., "## SOMA Bootloader (managed by soma sync)").
  //
  // SKIP for codex: Step 0 protects free-text CLAUDE.md (Claude harness only).
  // For codex/AGENTS.md, classifier is deferred to v2.3 generalization.
  //
  // @task T-14 T-15 T-16
  // @spec [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09]
  const claudeMdPath = path.join(projectPathAbs, 'CLAUDE.md');
  // Only apply free-text detection when SOMA has NOT run before.
  // If .soma/ directory OR install-state.json exists, this is a re-run / recovery scenario.
  // In re-run scenarios, CLAUDE.md content may appear as free-text (SOMA heading without anchor)
  // due to partial strip — treat as 'anchor-only' (normal pipeline handles recovery).
  const somaDirExistsForStep0 = fs.existsSync(path.join(projectPathAbs, '.soma'));
  const stateFilePathForStep0 = path.join(projectPathAbs, '.soma', 'install-state.json');
  const hasSomaPriorState = somaDirExistsForStep0;
  // Fix-04: codex tool targets AGENTS.md, not CLAUDE.md.
  // Step 0 free-text classifier only applies to the Claude harness.
  // Deferred to v2.3 to generalize to AGENTS.md.
  const skipStep0ForCodex = (flags.tool === 'codex');
  const claudeMdClass = (hasSomaPriorState || skipStep0ForCodex) ? 'anchor-only' : classifyClaudeMd(claudeMdPath);

  if (claudeMdClass === 'free-text') {
    if (flags.replaceClaudioMd) {
      // AC-08: snapshot original, then clear CLAUDE.md so sync writes anchor-only content.
      // sync.cjs will create a fresh CLAUDE.md with just the anchored block.
      try {
        snapshotClaudeMd(claudeMdPath);
      } catch (snapErr) {
        process.stderr.write(
          `soma install: failed to snapshot CLAUDE.md before replacement: ${snapErr.message}\n`
        );
        return 2;
      }
      // Delete the free-text CLAUDE.md so sync treats it as a fresh greenfield write.
      try {
        fs.rmSync(claudeMdPath, { force: true });
      } catch (rmErr) {
        process.stderr.write(
          `soma install: failed to remove CLAUDE.md before replacement: ${rmErr.message}\n`
        );
        return 2;
      }
      // Fall through to normal pipeline (sync will create CLAUDE.md with anchor block).

    } else if (flags.mergeClaudioMd) {
      // AC-07: proceed normally — sync.cjs appends anchored block after existing content.
      // No special handling needed; the existing pipeline handles this correctly.

    } else {
      // AC-09: no flag provided — abort with clear error naming both flags.
      // Same behavior whether TTY or not: operator must explicitly choose their intent.
      process.stderr.write(
        `soma install: CLAUDE.md exists with free-text content (no SOMA anchor markers).\n` +
        `  To preserve and append: soma install <path> --merge-claude-md\n` +
        `  To snapshot and replace: soma install <path> --replace-claude-md\n` +
        `  Use --merge-claude-md to keep existing content and append the SOMA block.\n` +
        `  Use --replace-claude-md to snapshot the original and replace with SOMA block only.\n`
      );
      return 2;
    }
  }
  // For 'absent', 'anchor-only', 'mixed', or prior-install → proceed normally (no special handling needed).

  // ── Step 1: init.cjs ───────────────────────────────────────────────────────
  const initResult = runStep('init', [INIT_CJS, projectPathAbs]);
  if (!initResult.ok) {
    if (initResult.status === 1) {
      // init exit 1 = "already initialized" (REDIRECT). .soma/ already exists.
      // T-12: partial state recovery — .soma/ present but anchored block missing.
      // Log an indicator so tests (and humans) can confirm init was skipped.
      process.stdout.write(`soma install: init skipped: .soma/ exists, recovering missing block\n`);
    } else {
      // init exit 2 = hard error (template missing, IO failure, etc.)
      const errSummary = `init: ${(initResult.stderr || '').trim().slice(0, 200) || 'no output'}`;
      process.stderr.write(
        `soma install: init failed (exit ${initResult.status}) — ${errSummary}\n`
      );
      // T-09: write state=partial-failed before returning 2
      // .soma/ may not exist if init failed catastrophically — best-effort write.
      try {
        writeInstallState(projectPathAbs, {
          $schema: 'soma-install-state/v1',
          status: 'partial-failed',
          timestamp: now,
          snapshotId: now,
          harness: flags.tool,
          installedVersion: SOMA_INSTALLED_VERSION,
          lastError: errSummary,
        });
      } catch (_) {}
      return 2;
    }
  }

  // ── Step 1.5: Write install.lock after .soma/ exists ─────────────────────
  // T-09: .soma/ is now guaranteed to exist (created by init.cjs or pre-existing).
  // Write the lock file now so pipeline steps 2+3 run with lock held.
  // main() handles lock release in finally{}.
  writeLock(projectPathAbs);

  // ── Step 2: manifest.cjs baseline --apply ─────────────────────────────────
  const manifestResult = runStep('manifest-baseline', [MANIFEST_CJS, 'baseline', '--apply'], {
    cwd: projectPathAbs,
  });
  if (!manifestResult.ok) {
    const errSummary = `manifest baseline: ${(manifestResult.stderr || '').trim().slice(0, 200) || 'no output'}`;
    process.stderr.write(
      `soma install: manifest baseline failed (exit ${manifestResult.status}) — ${errSummary}\n`
    );
    // T-13: surface snapshot-id to stderr (AC-05 contract).
    // `now` is the ISO-8601 UTC timestamp computed at orchestrate() entry — this is the
    // snapshotId that will be written to install-state.json. Surfacing it to stderr lets
    // the caller (human or CI) reference this run when investigating partial-failed state.
    process.stderr.write(`soma install: partial-failed snapshot-id: ${now}\n`);
    // T-09: write state=partial-failed
    try {
      writeInstallState(projectPathAbs, {
        $schema: 'soma-install-state/v1',
        status: 'partial-failed',
        timestamp: now,
        snapshotId: now,
        harness: flags.tool,
        installedVersion: SOMA_INSTALLED_VERSION,
        lastError: errSummary,
      });
    } catch (_) {}
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
      // T-11: Drift detection — sync.cjs exit 2 is the canonical BF-06 drift signal
      // (T-17 fixed sync.cjs to exit 2 specifically for sha mismatch / BF-06 abort,
      //  as distinct from exit 1 which covers generic sync errors like missing targets).
      //
      // Priority: exit-code-first (structural, unambiguous), then text-pattern fallback
      // (for forward-compat with older sync builds or edge cases).
      //
      // IMPORTANT: sync.cjs stderr must NOT be swallowed — propagate it to our stderr
      // so AC-03 assertions ("soma rollback" / recovery hints) pass through to the caller.
      // The 5-element BF-06 message from sync.cjs (T-17) contains all required AC-03 hints.
      const syncStderr = syncResult.stderr || '';
      const syncStdout = syncResult.stdout || '';

      // Propagate sync.cjs stderr verbatim (unswallowed) for AC-03 / AC-19 recovery hint checks.
      if (syncStderr) {
        process.stderr.write(syncStderr);
      }

      const combinedSyncOut = syncStdout + syncStderr;
      const isDriftByExitCode = (syncResult.status === 2);
      const isDriftByText = (
        combinedSyncOut.includes('sha256 mismatch') ||
        combinedSyncOut.includes('sha mismatch') ||
        combinedSyncOut.includes('BF-06') ||
        combinedSyncOut.includes('LOCAL_EDITS_DETECTED')
      );
      const isDriftDetected = isDriftByExitCode || isDriftByText;

      const stateStatus = isDriftDetected ? 'drift-detected' : 'partial-failed';

      // Build errSummary from sync output (for lastError field in install-state.json).
      // Use sync stderr preferentially (has the structured BF-06 message); fall back to stdout.
      const errSummary = `sync-${tool}: ${(syncStderr || syncStdout).trim().slice(0, 200) || 'no output'}`;

      // Emit install-level context line to stderr (in addition to the propagated sync stderr above).
      process.stderr.write(
        `soma install: sync --apply --tool=${tool} failed (exit ${syncResult.status}) — status=${stateStatus}\n`
      );

      try {
        writeInstallState(projectPathAbs, {
          $schema: 'soma-install-state/v1',
          status: stateStatus,
          timestamp: now,
          snapshotId: now,
          harness: flags.tool,
          installedVersion: SOMA_INSTALLED_VERSION,
          lastError: errSummary,
        });
      } catch (_) {}
      return 2;
    }
    lastSyncStdout = syncResult.stdout;
  }

  // ── Step 3b: sync.cjs --apply --targets-file=install-targets.project.json ────
  // T-08bis: Inject project-bootloader block into <projectPathAbs>/CLAUDE.md (or AGENTS.md).
  // Runs AFTER user-globals sync (Step 3) with cwd=projectPathAbs so relative
  // target_path="CLAUDE.md" resolves to <projectPathAbs>/CLAUDE.md.
  // Passes SOMA_TEMPLATE_VARS env so project-bootloader.md {{placeholders}} are rendered.
  // @spec D5 (T-08bis) AC-01
  const projectSyncSnapshotId = buildSnapshotId(lastSyncStdout) || now;
  const manifestShaShort = (() => {
    // Compute short sha256 of <projectPathAbs>/.soma/manifest.json for {{manifest_sha_short}}
    const manifestPath = path.join(projectPathAbs, '.soma', 'manifest.json');
    try {
      const crypto = require('node:crypto');
      const buf = fs.readFileSync(manifestPath);
      return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
    } catch (_) {
      return '(unknown)';
    }
  })();

  const templateVars = {
    version: SOMA_INSTALLED_VERSION,
    // Fix-05: soma_home must be the INSTALLED location (~/.soma-v2), not SOURCE_CORE.
    // SOURCE_CORE is the repo source path (for lab use); the template renders
    // path references that users will use at runtime (post-install).
    soma_home: path.join(os.homedir(), '.soma-v2'),
    harness: flags.tool === 'both' ? 'claude+codex' : flags.tool,
    install_timestamp: now,
    manifest_sha_short: manifestShaShort,
    snapshot_id: projectSyncSnapshotId,
  };

  let lastProjectSyncStdout = '';
  for (const tool of toolsToSync) {
    const projectAdapterPath = path.join(SOURCE_CORE, 'adapters', tool, 'install-targets.project.json');
    if (!fs.existsSync(projectAdapterPath)) {
      // No project adapter for this tool — skip silently (codex may not have one yet)
      continue;
    }

    const projectSyncArgs = [
      SYNC_CJS,
      '--apply',
      `--tool=${tool}`,
      `--soma-home=${SOURCE_CORE}`,
      `--targets-file=${projectAdapterPath}`,
    ];
    if (flags.allowLocalEdits) projectSyncArgs.push('--allow-local-edits');

    const projectSyncResult = runStep(`project-sync-${tool}`, projectSyncArgs, {
      cwd: projectPathAbs,
      env: { ...process.env, SOMA_TEMPLATE_VARS: JSON.stringify(templateVars) },
    });
    if (!projectSyncResult.ok) {
      // T-11: Drift detection at project-level sync (same logic as Step 3 user-globals sync).
      // Project-level sync (Step 3b) writes blocks into <project>/CLAUDE.md.
      // When user edits inside the anchored block (sha mismatch), BF-06 fires here with exit 2.
      // This is a HARD failure (drift abort), not "non-fatal" — propagate exit 2 + drift state.
      //
      // IMPORTANT: propagate sync.cjs stderr verbatim (AC-03 requires "soma rollback" recovery hint).
      const projectSyncStderr = projectSyncResult.stderr || '';
      const projectSyncStdout = projectSyncResult.stdout || '';

      if (projectSyncStderr) {
        process.stderr.write(projectSyncStderr);
      }

      const combinedProjectSyncOut = projectSyncStdout + projectSyncStderr;
      const isProjectDriftByExitCode = (projectSyncResult.status === 2);
      const isProjectDriftByText = (
        combinedProjectSyncOut.includes('sha256 mismatch') ||
        combinedProjectSyncOut.includes('sha mismatch') ||
        combinedProjectSyncOut.includes('BF-06') ||
        combinedProjectSyncOut.includes('LOCAL_EDITS_DETECTED')
      );
      const isProjectDriftDetected = isProjectDriftByExitCode || isProjectDriftByText;

      const projectStateStatus = isProjectDriftDetected ? 'drift-detected' : 'partial-failed';
      const errSummary = `project-sync-${tool}: ${(projectSyncStderr || projectSyncStdout).trim().slice(0, 200) || 'no output'}`;

      process.stderr.write(
        `soma install: project sync --apply --tool=${tool} failed (exit ${projectSyncResult.status}) — status=${projectStateStatus}\n`
      );

      try {
        writeInstallState(projectPathAbs, {
          $schema: 'soma-install-state/v1',
          status: projectStateStatus,
          timestamp: now,
          snapshotId: projectSyncSnapshotId,
          harness: flags.tool,
          installedVersion: SOMA_INSTALLED_VERSION,
          lastError: errSummary,
        });
      } catch (_) {}
      return 2;
    }
    lastProjectSyncStdout = projectSyncResult.stdout;
  }

  // ── Step 4: Write success state + emit output (CONTRACT-01 format) ─────────
  const harnessLabel = flags.tool === 'both' ? 'claude + codex' : flags.tool;
  // Parse block IDs from both user-globals sync and project sync combined
  const combinedSyncStdout = lastSyncStdout + '\n' + lastProjectSyncStdout;
  const blockId = parseSyncBlockId(combinedSyncStdout);
  const allBlockIds = parseSyncBlockIds(combinedSyncStdout);
  const snapshotPath = parseSyncSnapshotPath(lastSyncStdout);
  const snapshotId = buildSnapshotId(lastSyncStdout);

  // T-09: Write state file (status=complete).
  // T-08bis: blockIds now includes project-bootloader block.
  const effectiveBlockIds = allBlockIds.length > 0 ? allBlockIds : ['(injected)'];
  try {
    writeInstallState(projectPathAbs, {
      $schema: 'soma-install-state/v1',
      status: 'complete',
      timestamp: now,
      snapshotId,
      harness: flags.tool,
      installedVersion: SOMA_INSTALLED_VERSION,
      blockIds: effectiveBlockIds,
    });
  } catch (stateErr) {
    // Non-fatal: install succeeded even if state write fails
    process.stderr.write(`soma install: WARNING failed to write install-state.json: ${stateErr.message}\n`);
  }

  process.stdout.write(`SOMA install complete: ${projectPathAbs}\n`);
  process.stdout.write(`  Harness: ${harnessLabel}\n`);
  process.stdout.write(`  .soma/ created\n`);
  process.stdout.write(`  manifest.json baseline captured\n`);
  process.stdout.write(`  CLAUDE.md anchored block injected (block_id=${blockId})\n`);
  process.stdout.write(`  Snapshot: ${snapshotPath}\n`);
  process.stdout.write(`  install-state.json status=complete\n`);

  return 0;
}

/**
 * orchestrateWithLock — wrapper for main() that runs orchestrate() with
 * the two-phase lock protocol. Lock check happened in main() before this call;
 * lock write happens inside orchestrate() after init.cjs creates .soma/.
 * Lock release happens in main()'s finally{} block.
 *
 * This thin wrapper exists so orchestrate() is still testable directly (by tests
 * that want to call it without main()'s lock-check preamble).
 */
function orchestrateWithLock(projectPathAbs, flags) {
  return orchestrate(projectPathAbs, flags);
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

  // T-08: --dry-run: preview only, no mutations.
  if (flags.dryRun) {
    runDryRun(projectPathAbs, flags);
    return 0;
  }

  // T-10: Idempotent re-run early exit (AC-02).
  //
  // If install-state.json exists with status=complete AND the anchored block
  // is still present in CLAUDE.md, the project is already fully installed.
  // Emit "no changes" and exit 0 without re-running the pipeline.
  //
  // Conditions for early exit:
  //   1. .soma/install-state.json exists + status === "complete"
  //   2. <projectPathAbs>/CLAUDE.md exists + contains <!-- soma-v2:start anchor
  //   3. T-11 drift gate: no soma-v2 block in CLAUDE.md has a sha256 mismatch.
  //      If any block sha differs from actual content → drift detected → fall through
  //      to full pipeline (sync.cjs will abort with BF-06 exit 2).
  //
  // If any condition fails, fall through to the full pipeline so the next run
  // repairs the installation or surfaces the drift error correctly.
  {
    const stateFilePath = path.join(projectPathAbs, '.soma', 'install-state.json');
    const claudeMdPath = path.join(projectPathAbs, 'CLAUDE.md');
    let earlyExit = false;
    try {
      if (fs.existsSync(stateFilePath) && fs.existsSync(claudeMdPath)) {
        const stateRaw = fs.readFileSync(stateFilePath, 'utf8');
        const state = JSON.parse(stateRaw);
        if (state && state.status === 'complete') {
          const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
          if (claudeMdContent.includes('<!-- soma-v2:start')) {
            // T-11 drift gate: check sha256 integrity of all anchored blocks in CLAUDE.md.
            // If any block's stored sha256 attr differs from its actual content sha →
            // drift detected → fall through to pipeline (sync BF-06 will abort with exit 2).
            const { parseAnchorAttrs, computeBlockSha256 } = require('./lib/anchored-blocks.cjs');
            const lines = claudeMdContent.split('\n');
            let hasDrift = false;
            for (let i = 0; i < lines.length; i++) {
              const attrs = parseAnchorAttrs(lines[i]);
              if (attrs && attrs.sha256) {
                // Found a soma-v2 start marker with stored sha256. Collect content until end.
                const endRe = new RegExp(`<!--\\s*soma-v2:end\\s+id=${attrs.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->`);
                const contentLines = [];
                let j = i + 1;
                while (j < lines.length && !endRe.test(lines[j])) {
                  contentLines.push(lines[j]);
                  j++;
                }
                // Compute actual content sha256
                const actualContent = contentLines.join('\n');
                const actualSha = computeBlockSha256(actualContent);
                if (actualSha !== attrs.sha256) {
                  // Sha mismatch → drift detected → do NOT take early exit
                  hasDrift = true;
                  break;
                }
              }
            }
            if (!hasDrift) {
              earlyExit = true;
            }
          }
        }
      }
    } catch (_) {
      // Any read/parse error → fall through to full pipeline
      earlyExit = false;
    }
    if (earlyExit) {
      process.stdout.write(`soma install: no changes — project already installed at ${projectPathAbs}\n`);
      return 0;
    }
  }

  // T-09: Two-phase lock protocol (CONTRACT-05).
  //
  // Phase A — Pre-init conflict check:
  //   Check if .soma/install.lock already exists (stale/fresh logic).
  //   If .soma/ doesn't exist yet (greenfield), there's no lock → proceed.
  //   If fresh lock found → process.exit(2) with contention message.
  //   If stale lock → WARNING + auto-clean + proceed.
  //   This must happen BEFORE any mutation (inc. before init.cjs creates .soma/).
  checkLockConflict(projectPathAbs);

  // Phase B — Post-init lock write:
  //   After conflict check clears, run orchestrate() which runs init.cjs first.
  //   init.cjs creates .soma/ (greenfield) or skips (existing .soma/).
  //   Then we write the lock file into .soma/ and proceed with manifest+sync.
  //   The lock is released in the finally{} block regardless of outcome.
  //
  // Note: there is a tiny window between conflict-check and lock-write where
  // a concurrent install could start. This is acceptable per CONTRACT-05 §Edge Cases
  // ("Lockfile is advisory, not RFC-strict"). The lock prevents the common case.
  try {
    return orchestrateWithLock(projectPathAbs, flags);
  } finally {
    releaseLock(projectPathAbs);
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const exitCode = main(process.argv.slice(2));
  process.exit(exitCode);
}

// ── Module exports (for testability) ─────────────────────────────────────────

module.exports = { main, parseArgs, resolveProjectPath, acquireLock, releaseLock, writeInstallState };
