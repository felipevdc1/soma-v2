'use strict';
/**
 * snapshot.cjs — SOMA v2.1 snapshot helper
 *
 * Responsibilities:
 *   1. Generate ISO 8601 UTC timestamps with collision suffix (D3)
 *   2. Create per-run snapshot directories with mode 0700 (NFR security)
 *   3. Full-file copy of target files before modification (AC-02, AD-03)
 *   4. Byte-stable manifest.json emission (AC-03, AC-09)
 *
 * Phase 5 additions (BF-04 + BF-05):
 *   - Schema bump: soma-snapshot/v1 → soma-snapshot-manifest/v1 with richer entry fields
 *     (relative_path, sha256_pre_write, file_size_bytes, block_ids_modified[])
 *   - Dedup in createSnapshot: 1 manifest entry per unique file path, aggregating block_ids_modified
 *   - readManifest: reads and normalises both v1 schema versions (backward compat)
 *   - SUPPORTED_SCHEMAS: exported constant for rollback.cjs (T-07)
 *
 * All functions are pure/deterministic where possible.
 * Zero external dependencies — Node stdlib only.
 *
 * @module snapshot
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---- Sandbox enforcement (AC-17) ----

const SANDBOX_ALLOWED_PREFIX = '/tmp/soma-v2-test/';

/**
 * Assert that the given target path is allowed under the current sandbox policy.
 *
 * When env `SOMA_SAFE_PATHS_ONLY=1` is set, ALL filesystem write targets MUST be
 * prefixed with `/tmp/soma-v2-test/`. If violated, throws a structured error with
 * code `SANDBOX_VIOLATION` and a `details` object — callers should NOT catch and
 * swallow this; it must propagate to abort the operation entirely.
 *
 * When the env var is unset or any value other than `"1"`, this is a no-op.
 *
 * Exported so that rollback.cjs and other callers can reuse the same guard without
 * duplicating the policy logic.
 *
 * @param {string} targetPath - absolute (or resolvable) path to validate
 * @throws {Error} with code `SANDBOX_VIOLATION` and `details.{attempted_path, expected_prefix}`
 *   if SOMA_SAFE_PATHS_ONLY=1 and targetPath is not inside the allowed prefix
 *
 * @spec AC-17
 * @contract CONTRACT-011-01-sync-apply CONTRACT-011-02-rollback
 */
function assertSandboxPath(targetPath) {
  if (process.env.SOMA_SAFE_PATHS_ONLY !== '1') return;

  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(SANDBOX_ALLOWED_PREFIX)) {
    const err = new Error(
      `SANDBOX_VIOLATION: write target "${resolved}" is not inside the allowed sandbox prefix "${SANDBOX_ALLOWED_PREFIX}". ` +
      `Set SOMA_SAFE_PATHS_ONLY=1 only when all target paths are under /tmp/soma-v2-test/.`
    );
    err.code    = 'SANDBOX_VIOLATION';
    err.details = {
      attempted_path:  resolved,
      expected_prefix: SANDBOX_ALLOWED_PREFIX
    };
    throw err;
  }
}

// ---- Schema registry (BF-04) ----

/**
 * Schemas supported by readManifest().
 * rollback.cjs (T-07) must accept both.
 * @type {string[]}
 */
const SUPPORTED_SCHEMAS = ['soma-snapshot/v1', 'soma-snapshot-manifest/v1'];

// ---- Timestamp generation (D3) ----

/**
 * Generate ISO 8601 UTC timestamp with seconds precision.
 * Format: YYYY-MM-DDTHH:MM:SSZ
 * @param {Date} [now] - Date to use (default: new Date())
 * @returns {string}
 */
function toISO8601Seconds(now) {
  const d = now || new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/**
 * Generate a unique snapshot timestamp, appending -{N} suffix if collision.
 * @param {string} snapshotsBase - base .snapshots/ directory
 * @param {Date} [now] - optional Date for testability
 * @returns {string} unique ISO timestamp key (e.g. "2026-05-02T14:30:45Z" or "2026-05-02T14:30:45Z-2")
 */
function generateTimestamp(snapshotsBase, now) {
  const base = toISO8601Seconds(now);
  const candidate = path.join(snapshotsBase, base);
  if (!fs.existsSync(candidate)) return base;
  // Collision: append -{N} suffix
  let n = 2;
  while (true) {
    const ts = `${base}-${n}`;
    if (!fs.existsSync(path.join(snapshotsBase, ts))) return ts;
    n++;
  }
}

// ---- Manifest schema (BF-04, AC-03, AC-09) ----

/**
 * Create byte-stable manifest JSON string.
 * Entries sorted alphabetically by relative_path.
 *
 * Accepts both old-format entries ({adapter, path, sha256, size}) and
 * new-format entries ({relative_path, absolute_path, sha256_pre_write, file_size_bytes, block_ids_modified}).
 * Always emits schema soma-snapshot-manifest/v1.
 *
 * BF-08: absolute_path is now passed through when present in input entries so that
 * rollback.cjs can resolve restore targets without needing the original soma home context.
 *
 * @param {Array<object>} files - file entries (old or new format; see normaliseEntry below)
 * @param {string} timestamp - ISO 8601 UTC string
 * @returns {string} JSON string (deterministic)
 */
function createManifestJSON(files, timestamp) {
  // Normalise: support both old {adapter, path, sha256, size} and
  // new {relative_path, absolute_path, sha256_pre_write, file_size_bytes, block_ids_modified} formats
  // BF-08: absolute_path is forwarded when present; null/undefined entries omit the field.
  const normalised = files.map(f => {
    const entry = {
      relative_path: f.relative_path !== undefined
        ? f.relative_path
        : `${f.adapter}/${f.path}`,
      sha256_pre_write: f.sha256_pre_write !== undefined ? f.sha256_pre_write : f.sha256,
      file_size_bytes: f.file_size_bytes !== undefined ? f.file_size_bytes : (f.size || 0),
      block_ids_modified: f.block_ids_modified !== undefined ? f.block_ids_modified : []
    };
    // BF-08: carry absolute_path through when set (rollback.cjs restore target resolution)
    if (f.absolute_path != null) {
      entry.absolute_path = f.absolute_path;
    }
    return entry;
  });

  // Sort alphabetically by relative_path (deterministic)
  const sorted = [...normalised].sort((a, b) =>
    a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0
  );

  const total_bytes = sorted.reduce((sum, f) => sum + f.file_size_bytes, 0);

  const manifest = {
    schema: 'soma-snapshot-manifest/v1',
    timestamp,
    entries: sorted,
    total_bytes
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Read and normalise a snapshot manifest.json, supporting both schema versions.
 *
 * Returns a normalised structure regardless of which schema version the manifest uses.
 * Throws with structured error codes for rollback.cjs (T-07) to handle.
 *
 * @param {string} manifestPath - absolute path to manifest.json
 * @returns {{
 *   schema: string,
 *   timestamp: string,
 *   snapshot_id?: string,
 *   entries: Array<{
 *     relative_path: string,
 *     absolute_path: string|null,
 *     sha256_pre_write: string,
 *     file_size_bytes: number,
 *     block_ids_modified: string[]
 *   }>,
 *   total_bytes: number
 * }}
 * @throws {Error} with code 'MANIFEST_MISSING' if file not found or not parseable
 * @throws {Error} with code 'MANIFEST_SCHEMA_INVALID' if schema not in SUPPORTED_SCHEMAS
 */
function readManifest(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    const e = new Error(`Cannot read manifest at ${manifestPath}: ${err.message}`);
    e.code = 'MANIFEST_MISSING';
    throw e;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Cannot parse manifest JSON at ${manifestPath}: ${err.message}`);
    e.code = 'MANIFEST_MISSING';
    throw e;
  }

  if (!SUPPORTED_SCHEMAS.includes(parsed.schema)) {
    const e = new Error(
      `Unknown manifest schema: "${parsed.schema}". Supported: ${SUPPORTED_SCHEMAS.join(', ')}`
    );
    e.code = 'MANIFEST_SCHEMA_INVALID';
    e.details = { schema_found: parsed.schema, supported: SUPPORTED_SCHEMAS };
    throw e;
  }

  let entries;
  if (parsed.schema === 'soma-snapshot/v1') {
    // Old format: {files: [{adapter, path, sha256, size?}]}
    entries = (parsed.files || []).map(f => ({
      relative_path: `${f.adapter}/${f.path}`,
      absolute_path: null,  // v1 manifests did not store absolute_path
      sha256_pre_write: f.sha256,
      file_size_bytes: f.size || 0,
      block_ids_modified: []
    }));
  } else {
    // New format: soma-snapshot-manifest/v1
    // {entries: [{relative_path, absolute_path?, sha256_pre_write, file_size_bytes, block_ids_modified}]}
    entries = (parsed.entries || []).map(f => ({
      relative_path: f.relative_path,
      absolute_path: f.absolute_path || null,
      sha256_pre_write: f.sha256_pre_write,
      file_size_bytes: f.file_size_bytes || 0,
      block_ids_modified: f.block_ids_modified || []
    }));
  }

  return {
    schema: parsed.schema,
    timestamp: parsed.timestamp || null,
    snapshot_id: parsed.snapshot_id || null,
    entries,
    total_bytes: parsed.total_bytes || 0
  };
}

// ---- Core snapshot creation (AC-02, AC-06, BF-05) ----

/**
 * Create a full-file snapshot of target files before modification.
 * All-or-nothing: validates snapshot dir creation BEFORE copying files.
 *
 * BF-05: deduplicates manifest entries by {adapter}/{relativePath} key.
 * Multiple file entries for the same path produce ONE manifest entry with
 * block_ids_modified aggregated from all entries (Set union, no duplicates).
 *
 * @param {object} opts
 * @param {string} opts.snapshotsBase - base .snapshots/ dir (e.g. somaHome + '/.snapshots')
 * @param {Array<{
 *   adapter: string,
 *   targetPath: string,
 *   relativePath: string,
 *   blockId?: string
 * }>} opts.files
 *   - adapter: adapter name (e.g. 'codex')
 *   - targetPath: absolute path to target file
 *   - relativePath: relative path within adapter (e.g. 'AGENTS.md')
 *   - blockId: (optional) block ID being modified in this entry (for block_ids_modified)
 * @param {Date} [opts.now] - optional Date for timestamp generation
 * @returns {{ timestamp: string, snapDir: string, manifestPath: string, files_count: number, total_bytes: number }}
 * @throws {Error} with code 'SNAPSHOT_CREATE_FAILED' if dir/file operations fail
 */
function createSnapshot(opts) {
  const { snapshotsBase, files, now } = opts;

  // AC-17: pre-flight sandbox validation — validate ALL source paths BEFORE
  // any filesystem side-effect (mkdirSync / copyFileSync). This is an atomic
  // check: if ANY file violates the sandbox policy the entire operation is
  // aborted with zero side-effects.
  for (const fileInfo of files) {
    assertSandboxPath(fileInfo.targetPath);
  }

  // Ensure .snapshots base exists (or try to create it)
  try {
    fs.mkdirSync(snapshotsBase, { recursive: true, mode: 0o700 });
  } catch (err) {
    // If already exists but permissions are wrong, let the next step catch it
  }

  // Generate unique timestamp
  let timestamp;
  try {
    timestamp = generateTimestamp(snapshotsBase, now);
  } catch (err) {
    const e = new Error(`Failed to generate snapshot timestamp: ${err.message}`);
    e.code = 'SNAPSHOT_CREATE_FAILED';
    throw e;
  }

  const snapDir = path.join(snapshotsBase, timestamp);

  // Try to create the snapshot dir with 0700 permissions
  try {
    fs.mkdirSync(snapDir, { recursive: true, mode: 0o700 });
    // Explicitly chmod to 0700 (mkdirSync mode may be masked by umask)
    fs.chmodSync(snapDir, 0o700);
  } catch (err) {
    const e = new Error(`Cannot create snapshot directory ${snapDir}: ${err.message}`);
    e.code = 'SNAPSHOT_CREATE_FAILED';
    throw e;
  }

  // Copy each file into the snapshot, collect raw entries (may have duplicates)
  const rawEntries = [];

  for (const fileInfo of files) {
    const { adapter, targetPath, relativePath, blockId } = fileInfo;

    const destDir = path.join(snapDir, adapter);
    const destPath = path.join(destDir, relativePath);

    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      const e = new Error(`Cannot create snapshot subdir ${destDir}: ${err.message}`);
      e.code = 'SNAPSHOT_CREATE_FAILED';
      throw e;
    }

    let fileContent;
    try {
      fileContent = fs.readFileSync(targetPath);
    } catch (err) {
      // File doesn't exist yet (insert case) — skip snapshotting (nothing to preserve)
      continue;
    }

    try {
      fs.writeFileSync(destPath, fileContent);
    } catch (err) {
      const e = new Error(`Cannot write snapshot file ${destPath}: ${err.message}`);
      e.code = 'SNAPSHOT_CREATE_FAILED';
      throw e;
    }

    const sha256 = crypto.createHash('sha256').update(fileContent).digest('hex');

    rawEntries.push({
      relative_path: `${adapter}/${relativePath}`,
      // BF-08: populate absolute_path so rollback.cjs can resolve restore targets.
      // targetPath is already the absolute source path passed by the caller.
      absolute_path: path.resolve(targetPath),
      sha256_pre_write: sha256,
      file_size_bytes: fileContent.length,
      block_ids_modified: blockId ? [blockId] : []
    });
  }

  // BF-05: dedup — 1 manifest entry per unique relative_path
  // Multiple install-targets entries for the same file → single entry with aggregated block_ids
  const dedupMap = new Map();
  for (const entry of rawEntries) {
    if (dedupMap.has(entry.relative_path)) {
      const existing = dedupMap.get(entry.relative_path);
      // Aggregate block_ids_modified (Set union, preserve order, no duplicates)
      const merged = new Set([...existing.block_ids_modified, ...entry.block_ids_modified]);
      existing.block_ids_modified = Array.from(merged);
    } else {
      dedupMap.set(entry.relative_path, { ...entry });
    }
  }
  const manifestFiles = Array.from(dedupMap.values());

  // Write manifest.json (BF-04: soma-snapshot-manifest/v1 schema)
  const manifestPath = path.join(snapDir, 'manifest.json');
  const manifestJSON = createManifestJSON(manifestFiles, timestamp);
  try {
    fs.writeFileSync(manifestPath, manifestJSON);
  } catch (err) {
    const e = new Error(`Cannot write snapshot manifest ${manifestPath}: ${err.message}`);
    e.code = 'SNAPSHOT_CREATE_FAILED';
    throw e;
  }

  const manifestData = JSON.parse(manifestJSON);
  return {
    timestamp,
    snapDir,
    path: snapDir,
    manifestPath,
    files_count: manifestFiles.length,
    total_bytes: manifestData.total_bytes
  };
}

module.exports = {
  createSnapshot,
  createManifestJSON,
  readManifest,
  generateTimestamp,
  toISO8601Seconds,
  assertSandboxPath,
  SUPPORTED_SCHEMAS
};
