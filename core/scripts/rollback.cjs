#!/usr/bin/env node
'use strict';
/**
 * rollback.cjs — SOMA v2.1 rollback CLI (T-07)
 *
 * Usage:
 *   node rollback.cjs --snapshot-id <ISO-timestamp> [--snapshot-base <path>]
 *
 * Restores files from a SOMA auto-snapshot to their pre-write state,
 * with sha256 verification per manifest entry. Idempotent.
 *
 * Exit codes:
 *   0 — success (restored or no-op)
 *   1 — fatal error (SNAPSHOT_NOT_FOUND, MANIFEST_MISSING, etc.)
 *   2 — invalid args (INVALID_ARGS)
 *
 * @spec AC-07, AC-08, AC-09
 * @contract CONTRACT-011-02-rollback
 */

const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os   = require('node:os');

const { readManifest, assertSandboxPath } = require('./lib/snapshot.cjs');

// ── Constants ────────────────────────────────────────────────────────────────

const SOMA_HOME              = path.join(os.homedir(), '.soma-v2');
const DEFAULT_SNAPSHOTS_BASE = path.join(SOMA_HOME, '.snapshots');

// ── Arg parsing ──────────────────────────────────────────────────────────────

/**
 * Parse process.argv-style array.
 * Supports: --snapshot-id <val>, --snapshot-base <val> (and = forms).
 * @param {string[]} argv
 * @returns {{ flags: object, errors: string[] }}
 */
function parseArgs(argv) {
  const flags = {
    snapshotId:   null,
    snapshotBase: DEFAULT_SNAPSHOTS_BASE,
  };
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--snapshot-id' && i + 1 < argv.length) {
      flags.snapshotId = argv[++i];
    } else if (arg.startsWith('--snapshot-id=')) {
      flags.snapshotId = arg.slice('--snapshot-id='.length);
    } else if (arg === '--snapshot-base' && i + 1 < argv.length) {
      flags.snapshotBase = argv[++i];
    } else if (arg.startsWith('--snapshot-base=')) {
      flags.snapshotBase = arg.slice('--snapshot-base='.length);
    }
    // Unknown flags silently ignored (forward-compat)
  }

  if (!flags.snapshotId) {
    errors.push('--snapshot-id is required');
  }

  return { flags, errors };
}

// ── Crypto helpers ───────────────────────────────────────────────────────────

/**
 * Compute sha256 hex digest of file at filePath.
 * @param {string} filePath
 * @returns {string} hex digest
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── Output helpers ───────────────────────────────────────────────────────────

/**
 * Emit JSON error to stdout and exit.
 * @param {string} code  — error code constant
 * @param {string} message — human-readable message
 * @param {object|null} details — structured details (optional)
 * @param {number} exitCode — process exit code (default 1)
 */
function exitError(code, message, details, exitCode = 1) {
  const payload = { error: code, message };
  if (details != null) payload.details = details;
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(exitCode);
}

// ── Log append ───────────────────────────────────────────────────────────────

/**
 * Append JSONL entry to ~/.soma-v2/logs/rollback-{date}.jsonl.
 * Non-fatal: log failures are silently swallowed.
 * @param {object} entry
 */
function appendLog(entry) {
  try {
    const logsDir = path.join(SOMA_HOME, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(logsDir, `rollback-${today}.jsonl`);
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (_) {
    // Non-fatal — ignore
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startMs = Date.now();
  const { flags, errors } = parseArgs(process.argv.slice(2));

  // ── INVALID_ARGS ──────────────────────────────────────────────────────────

  if (errors.length > 0) {
    exitError('INVALID_ARGS', errors.join('; '), { errors }, 2);
  }

  const { snapshotId, snapshotBase } = flags;
  const snapshotDir = path.join(snapshotBase, snapshotId);

  // ── SNAPSHOT_NOT_FOUND ────────────────────────────────────────────────────

  if (!fs.existsSync(snapshotDir) || !fs.statSync(snapshotDir).isDirectory()) {
    let availableSnapshots = [];
    try {
      if (fs.existsSync(snapshotBase)) {
        availableSnapshots = fs.readdirSync(snapshotBase)
          .filter(f => {
            try { return fs.statSync(path.join(snapshotBase, f)).isDirectory(); }
            catch (_) { return false; }
          })
          .sort();
      }
    } catch (_) { /* best-effort */ }

    exitError(
      'SNAPSHOT_NOT_FOUND',
      `No snapshot directory found at ${snapshotBase}/${snapshotId}`,
      { snapshot_id_searched: snapshotId, available_snapshots: availableSnapshots }
    );
  }

  // ── Read manifest (readManifest throws MANIFEST_MISSING / MANIFEST_SCHEMA_INVALID) ──

  const manifestPath = path.join(snapshotDir, 'manifest.json');
  let manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (err) {
    exitError(
      err.code || 'MANIFEST_MISSING',
      err.message,
      err.details || null
    );
  }

  // ── Per-entry restore loop ────────────────────────────────────────────────

  const filesResult = [];

  for (const entry of manifest.entries) {
    const targetPath = entry.absolute_path;

    if (!targetPath) {
      // soma-snapshot/v1 entries lack absolute_path — cannot restore; skip silently.
      continue;
    }

    // ── SANDBOX_VIOLATION (AC-17) ───────────────────────────────────────────
    // Delegate to shared assertSandboxPath from snapshot.cjs.
    // Atomic: throws on first violation → no entries restored.
    try {
      assertSandboxPath(targetPath);
    } catch (err) {
      if (err.code === 'SANDBOX_VIOLATION') {
        exitError(
          'SANDBOX_VIOLATION',
          err.message,
          err.details || null
        );
      }
      throw err;  // unexpected error — re-throw
    }

    const snapshotCopyPath = path.join(snapshotDir, entry.relative_path);
    const expectedSha      = entry.sha256_pre_write;

    // ── Snapshot copy integrity check (always — detects corrupt backups) ────
    //
    // We verify sha256(snapshot_copy) === sha256_pre_write BEFORE any restore
    // attempt. This catches corrupted backups even when the target file already
    // happens to match the expected hash (idempotent state).
    let snapshotCopySha;
    try {
      snapshotCopySha = sha256File(snapshotCopyPath);
    } catch (err) {
      // Snapshot copy file is missing — treat as verification failure.
      exitError(
        'ROLLBACK_VERIFICATION_FAILED',
        `Snapshot backup file not readable at ${snapshotCopyPath}: ${err.message}`,
        {
          file: targetPath,
          expected_sha256: expectedSha,
          actual_sha256_post_restore: null,
          recovery_guidance:
            `1. Verify snapshot files at ${snapshotDir}/ are intact (sha256 each), ` +
            `2. If snapshot corrupt, recover from earlier snapshot, ` +
            `3. If snapshot OK, manually restore by \`cp\` from snapshot path.`
        }
      );
    }

    if (snapshotCopySha !== expectedSha) {
      // Snapshot backup is corrupt — report ROLLBACK_VERIFICATION_FAILED.
      exitError(
        'ROLLBACK_VERIFICATION_FAILED',
        'Restored file sha256 does not match snapshot manifest entry. Possible disk corruption or partial restore.',
        {
          file: targetPath,
          expected_sha256: expectedSha,
          actual_sha256_post_restore: snapshotCopySha,
          recovery_guidance:
            `1. Verify snapshot files at ${snapshotDir}/ are intact (sha256 each), ` +
            `2. If snapshot corrupt, recover from earlier snapshot, ` +
            `3. If snapshot OK, manually restore by \`cp\` from snapshot path.`
        }
      );
    }

    // ── Idempotency check ───────────────────────────────────────────────────
    let currentSha = null;
    try {
      currentSha = sha256File(targetPath);
    } catch (_) {
      // Target missing — will be restored below.
    }

    if (currentSha === expectedSha) {
      // File already matches pre-write state — skip restore.
      filesResult.push({
        path: targetPath,
        expected_sha256:           expectedSha,
        actual_sha256_post_restore: currentSha,
        match:  true,
        _action: 'no-op',
      });
      continue;
    }

    // ── Restore: copy snapshot file → target ────────────────────────────────
    let snapshotContent;
    try {
      snapshotContent = fs.readFileSync(snapshotCopyPath);
    } catch (err) {
      exitError(
        'ROLLBACK_VERIFICATION_FAILED',
        `Cannot read snapshot backup file ${snapshotCopyPath}: ${err.message}`,
        {
          file: targetPath,
          expected_sha256: expectedSha,
          actual_sha256_post_restore: null,
          recovery_guidance:
            `1. Verify snapshot files at ${snapshotDir}/ are intact (sha256 each), ` +
            `2. If snapshot corrupt, recover from earlier snapshot, ` +
            `3. If snapshot OK, manually restore by \`cp\` from snapshot path.`
        }
      );
    }

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, snapshotContent);
    } catch (err) {
      exitError(
        'RESTORE_PERMISSION_DENIED',
        `Cannot write to restore target ${targetPath}: ${err.message}`,
        { file: targetPath, error: err.message }
      );
    }

    // ── Post-restore verification ───────────────────────────────────────────
    let postSha;
    try {
      postSha = sha256File(targetPath);
    } catch (err) {
      exitError(
        'ROLLBACK_VERIFICATION_FAILED',
        `Cannot read restored file for verification ${targetPath}: ${err.message}`,
        {
          file: targetPath,
          expected_sha256: expectedSha,
          actual_sha256_post_restore: null,
          recovery_guidance:
            `1. Verify snapshot files at ${snapshotDir}/ are intact (sha256 each), ` +
            `2. If snapshot corrupt, recover from earlier snapshot, ` +
            `3. If snapshot OK, manually restore by \`cp\` from snapshot path.`
        }
      );
    }

    if (postSha !== expectedSha) {
      exitError(
        'ROLLBACK_VERIFICATION_FAILED',
        'Restored file sha256 does not match snapshot manifest entry. Possible disk corruption or partial restore.',
        {
          file: targetPath,
          expected_sha256: expectedSha,
          actual_sha256_post_restore: postSha,
          recovery_guidance:
            `1. Verify snapshot files at ${snapshotDir}/ are intact (sha256 each), ` +
            `2. If snapshot corrupt, recover from earlier snapshot, ` +
            `3. If snapshot OK, manually restore by \`cp\` from snapshot path.`
        }
      );
    }

    filesResult.push({
      path: targetPath,
      expected_sha256:           expectedSha,
      actual_sha256_post_restore: postSha,
      match:   true,
      _action: 'restored',
    });
  }

  // ── Build response ────────────────────────────────────────────────────────

  const durationMs = Date.now() - startMs;
  const allNoOp    = filesResult.length > 0 && filesResult.every(f => f._action === 'no-op');
  const status     = allNoOp ? 'no-op' : 'restored';

  // Strip internal _action field before output
  const filesRestored = filesResult.map(({ path: p, expected_sha256, actual_sha256_post_restore, match }) => ({
    path: p,
    expected_sha256,
    actual_sha256_post_restore,
    match,
  }));

  const response = {
    status,
    snapshot_id:    snapshotId,
    files_restored: filesRestored,
    duration_ms:    durationMs,
  };

  // ---- Article IV evidence emission (AC-21) ----
  // Emits a structured JSON line BEFORE the main rollback result JSON.
  // Only active when SOMA_EMIT_EVIDENCE=1 env is set (additive, does NOT affect
  // existing callers that parse stdout as JSON — those callers do not set this env).
  //
  // Evidence line schema:
  //   { event: "soma_rollback_evidence", snapshot_path, manifest_sha256,
  //     restored_files: [{ path, post_restore_sha256 }], timestamp }
  //
  // @spec AC-21
  // @article Article-IV
  if (process.env.SOMA_EMIT_EVIDENCE === '1') {
    try {
      // Compute manifest_sha256: sha256 of manifest.json content
      let manifestSha256 = null;
      if (fs.existsSync(manifestPath)) {
        const manifestContent = fs.readFileSync(manifestPath);
        manifestSha256 = crypto.createHash('sha256').update(manifestContent).digest('hex');
      }

      // Build restored_files with post_restore_sha256 (reuse filesResult internal data)
      const restoredFilesEvidence = filesResult.map(entry => ({
        path:               entry.path,
        post_restore_sha256: entry.actual_sha256_post_restore,
      }));

      const evidenceLine = {
        event:          'soma_rollback_evidence',
        snapshot_path:  snapshotDir,
        manifest_sha256: manifestSha256,
        restored_files: restoredFilesEvidence,
        timestamp:      new Date().toISOString(),
      };
      process.stdout.write(JSON.stringify(evidenceLine) + '\n');
    } catch (_) {
      // Non-fatal: evidence emission failure must not abort the rollback operation
    }
  }

  process.stdout.write(JSON.stringify(response, null, 2) + '\n');

  appendLog({
    schema:         'soma-rollback-log/v1',
    snapshot_id:    snapshotId,
    files_restored: filesRestored.length,
    duration_ms:    durationMs,
    exit_code:      0,
    timestamp:      new Date().toISOString(),
  });

  process.exit(0);
}

main();
