// @spec AC-17
// @contract CONTRACT-011-01-sync-apply CONTRACT-011-02-rollback
'use strict';
/**
 * sandbox-enforcement.test.cjs — T-11 sandbox enforcement integration tests
 *
 * Covers AC-17: when SOMA_SAFE_PATHS_ONLY=1, ALL filesystem write operations
 * (snapshot creation, rollback restore) must verify target path is prefixed
 * with /tmp/soma-v2-test/. Violations throw SANDBOX_VIOLATION.
 *
 * Test matrix:
 *  1. snapshot.cjs: env=1 + safe path → succeeds
 *  2. snapshot.cjs: env=1 + unsafe path → throws SANDBOX_VIOLATION, zero side-effects
 *  3. snapshot.cjs: env unset → unsafe path succeeds (no guard)
 *  4. rollback.cjs: env=1 + manifest pointing outside sandbox → exit 1 + JSON + target UNCHANGED
 *  5. rollback.cjs: env=1 + manifest fully sandboxed → restore succeeds, exit 0
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const os       = require('node:os');
const crypto   = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { createSnapshot, assertSandboxPath } = require('../../scripts/lib/snapshot.cjs');

const SANDBOX_PREFIX  = '/tmp/soma-v2-test/';
const ROLLBACK_SCRIPT = path.join(__dirname, '../../scripts/rollback.cjs');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a temp dir under /tmp/soma-v2-test/ for safe sandbox tests.
 * @returns {string} absolute path to a fresh temp dir
 */
function mkSandboxTmp(suffix) {
  const base = `/tmp/soma-v2-test/t11-${suffix}-${Date.now()}`;
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/**
 * Create a temp dir outside the sandbox (under /tmp but NOT /tmp/soma-v2-test/).
 * @returns {string} absolute path
 */
function mkUnsafeTmp(suffix) {
  const base = `/tmp/t11-unsafe-${suffix}-${Date.now()}`;
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/**
 * Write a small temp file and return its path.
 * @param {string} dir
 * @param {string} name
 * @param {string} content
 * @returns {string}
 */
function writeFile(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/**
 * Compute sha256 hex of a file.
 * @param {string} filePath
 * @returns {string}
 */
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Build a minimal snapshot structure for rollback testing.
 * Creates: snapshotBase/{snapshotId}/{adapter}/{filename}  + manifest.json
 *
 * @param {object} opts
 * @param {string} opts.snapshotBase - directory that acts as .snapshots/
 * @param {string} opts.snapshotId  - timestamp key
 * @param {string} opts.adapter     - adapter name (e.g. 'claude')
 * @param {string} opts.filename    - filename within adapter dir
 * @param {string} opts.content     - file content (stored as snapshot copy)
 * @param {string} opts.targetPath  - absolute_path stored in manifest (the restore target)
 * @returns {{ snapDir: string, manifestPath: string }}
 */
function buildFakeSnapshot({ snapshotBase, snapshotId, adapter, filename, content, targetPath }) {
  const snapDir  = path.join(snapshotBase, snapshotId);
  const adpDir   = path.join(snapDir, adapter);
  fs.mkdirSync(adpDir, { recursive: true });

  const snapCopy = path.join(adpDir, filename);
  fs.writeFileSync(snapCopy, content, 'utf8');

  const sha256 = crypto.createHash('sha256').update(content).digest('hex');

  const manifest = {
    schema:      'soma-snapshot-manifest/v1',
    timestamp:   snapshotId,
    entries: [
      {
        relative_path:      `${adapter}/${filename}`,
        absolute_path:      targetPath,
        sha256_pre_write:   sha256,
        file_size_bytes:    Buffer.byteLength(content),
        block_ids_modified: []
      }
    ],
    total_bytes: Buffer.byteLength(content)
  };

  const manifestPath = path.join(snapDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { snapDir, manifestPath };
}

/**
 * Run rollback.cjs via spawnSync, returning { exitCode, stdout, parsed }.
 * @param {string[]} args
 * @param {object} envOverrides - env vars to merge with process.env
 * @returns {{ exitCode: number, stdout: string, parsed: object|null }}
 */
function runRollback(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [ROLLBACK_SCRIPT, ...args], {
    env:      { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout:  10000
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch (_) { /* raw stdout */ }
  return { exitCode: result.status, stdout: result.stdout, parsed };
}

// ── Test 1: snapshot.cjs — env=1 + safe path → succeeds ─────────────────────

test('T11-1: snapshot.cjs — SOMA_SAFE_PATHS_ONLY=1 + safe path → createSnapshot succeeds', (t) => {
  const snapshotBase = mkSandboxTmp('snap-safe');
  const sourceDir    = mkSandboxTmp('source-safe');
  const sourceFile   = writeFile(sourceDir, 'foo.md', '# hello sandbox');

  const prev = process.env.SOMA_SAFE_PATHS_ONLY;
  process.env.SOMA_SAFE_PATHS_ONLY = '1';
  try {
    const result = createSnapshot({
      snapshotsBase: snapshotBase,
      files: [
        {
          adapter:      'claude',
          targetPath:   sourceFile,   // safe: /tmp/soma-v2-test/...
          relativePath: 'foo.md',
          blockId:      'blk-1'
        }
      ]
    });

    // createSnapshot must succeed without throwing
    assert.ok(result.timestamp, 'timestamp must be set');
    assert.ok(result.snapDir.startsWith(snapshotBase), 'snapDir must be under snapshotBase');
    assert.ok(fs.existsSync(result.manifestPath), 'manifest.json must exist');
    assert.equal(result.files_count, 1, 'must snapshot 1 file');
  } finally {
    if (prev === undefined) delete process.env.SOMA_SAFE_PATHS_ONLY;
    else process.env.SOMA_SAFE_PATHS_ONLY = prev;
  }
});

// ── Test 2: snapshot.cjs — env=1 + unsafe path → throws SANDBOX_VIOLATION ───

test('T11-2: snapshot.cjs — SOMA_SAFE_PATHS_ONLY=1 + unsafe path → throws SANDBOX_VIOLATION, zero side-effects', (t) => {
  const snapshotBase = mkSandboxTmp('snap-unsafe');
  const unsafeDir    = mkUnsafeTmp('source');
  const unsafeFile   = writeFile(unsafeDir, 'secret.md', '# secret content');

  // Capture state before: how many dirs inside snapshotBase
  const beforeDirs = fs.readdirSync(snapshotBase);

  const prev = process.env.SOMA_SAFE_PATHS_ONLY;
  process.env.SOMA_SAFE_PATHS_ONLY = '1';
  try {
    let threw = false;
    let thrownErr = null;
    try {
      createSnapshot({
        snapshotsBase: snapshotBase,
        files: [
          {
            adapter:      'claude',
            targetPath:   unsafeFile,   // unsafe: NOT under /tmp/soma-v2-test/
            relativePath: 'secret.md',
            blockId:      'blk-unsafe'
          }
        ]
      });
    } catch (err) {
      threw    = true;
      thrownErr = err;
    }

    assert.ok(threw, 'createSnapshot must throw for unsafe path when env=1');
    assert.equal(thrownErr.code, 'SANDBOX_VIOLATION',
      `error.code must be SANDBOX_VIOLATION, got: ${thrownErr.code}`);
    assert.ok(thrownErr.message.includes('SANDBOX_VIOLATION'),
      'error.message must mention SANDBOX_VIOLATION');
    assert.ok(thrownErr.details, 'error.details must be set');
    assert.ok(thrownErr.details.attempted_path, 'details.attempted_path must be set');
    assert.equal(thrownErr.details.expected_prefix, '/tmp/soma-v2-test/',
      'details.expected_prefix must be /tmp/soma-v2-test/');

    // Zero side-effects: no new snapshot subdirectory created
    const afterDirs = fs.readdirSync(snapshotBase);
    assert.deepEqual(afterDirs, beforeDirs,
      'createSnapshot must leave snapshotBase unchanged on SANDBOX_VIOLATION');
  } finally {
    if (prev === undefined) delete process.env.SOMA_SAFE_PATHS_ONLY;
    else process.env.SOMA_SAFE_PATHS_ONLY = prev;
  }
});

// ── Test 3: snapshot.cjs — env unset → unsafe path succeeds ──────────────────

test('T11-3: snapshot.cjs — SOMA_SAFE_PATHS_ONLY unset → unsafe path is NOT blocked', (t) => {
  const snapshotBase = mkSandboxTmp('snap-noenv');
  const unsafeDir    = mkUnsafeTmp('source-noenv');
  const unsafeFile   = writeFile(unsafeDir, 'allowed.md', '# allowed without env');

  const prev = process.env.SOMA_SAFE_PATHS_ONLY;
  delete process.env.SOMA_SAFE_PATHS_ONLY;
  try {
    // Must NOT throw — guard is inactive when env not set
    let threw = false;
    try {
      createSnapshot({
        snapshotsBase: snapshotBase,
        files: [
          {
            adapter:      'claude',
            targetPath:   unsafeFile,
            relativePath: 'allowed.md'
          }
        ]
      });
    } catch (err) {
      if (err.code === 'SANDBOX_VIOLATION') threw = true;
      else throw err;   // re-throw unexpected errors
    }

    assert.ok(!threw, 'createSnapshot must NOT throw SANDBOX_VIOLATION when env unset');
  } finally {
    if (prev === undefined) delete process.env.SOMA_SAFE_PATHS_ONLY;
    else process.env.SOMA_SAFE_PATHS_ONLY = prev;
  }
});

// ── Test 4: rollback.cjs — env=1 + unsafe manifest → exit 1 + target UNCHANGED

test('T11-4: rollback.cjs — SOMA_SAFE_PATHS_ONLY=1 + manifest outside sandbox → exit 1, JSON error, target unchanged', (t) => {
  // Build snapshot base inside sandbox (snapshot itself is safe)
  const snapshotBase = mkSandboxTmp('rb-unsafe-snap');

  // Target file is OUTSIDE sandbox (simulates a real production path)
  const unsafeTargetDir  = mkUnsafeTmp('rb-target');
  const unsafeTargetFile = writeFile(unsafeTargetDir, 'production.md', '# original content\n');
  const originalSha = sha256File(unsafeTargetFile);

  const snapshotId = '2026-01-01T00:00:00Z';
  buildFakeSnapshot({
    snapshotBase,
    snapshotId,
    adapter:    'claude',
    filename:   'production.md',
    content:    '# restored content\n',
    targetPath: unsafeTargetFile   // points outside /tmp/soma-v2-test/
  });

  const { exitCode, parsed } = runRollback(
    [`--snapshot-id=${snapshotId}`, `--snapshot-base=${snapshotBase}`],
    { SOMA_SAFE_PATHS_ONLY: '1' }
  );

  // Must exit 1
  assert.equal(exitCode, 1, `rollback must exit 1 on SANDBOX_VIOLATION, got ${exitCode}`);

  // Must emit JSON with error=SANDBOX_VIOLATION
  assert.ok(parsed, 'stdout must be valid JSON');
  assert.equal(parsed.error, 'SANDBOX_VIOLATION',
    `parsed.error must be SANDBOX_VIOLATION, got: ${parsed.error}`);
  assert.ok(parsed.message, 'parsed.message must be set');
  assert.ok(parsed.details, 'parsed.details must be set');

  // Target file UNCHANGED (sha256 identical to before)
  const afterSha = sha256File(unsafeTargetFile);
  assert.equal(afterSha, originalSha,
    'target file must be byte-identical before and after aborted rollback');
});

// ── Test 5: rollback.cjs — env=1 + manifest fully sandboxed → exit 0, restored

test('T11-5: rollback.cjs — SOMA_SAFE_PATHS_ONLY=1 + manifest inside sandbox → restore succeeds, exit 0', (t) => {
  // Both snapshot base and restore target are inside sandbox
  const snapshotBase = mkSandboxTmp('rb-safe-snap');
  const targetDir    = mkSandboxTmp('rb-safe-target');
  const targetFile   = writeFile(targetDir, 'sandbox-target.md', '# modified content\n');

  const snapshotId     = '2026-01-02T00:00:00Z';
  const originalContent = '# original content before modification\n';

  buildFakeSnapshot({
    snapshotBase,
    snapshotId,
    adapter:    'claude',
    filename:   'sandbox-target.md',
    content:    originalContent,
    targetPath: targetFile   // INSIDE /tmp/soma-v2-test/
  });

  const { exitCode, parsed } = runRollback(
    [`--snapshot-id=${snapshotId}`, `--snapshot-base=${snapshotBase}`],
    { SOMA_SAFE_PATHS_ONLY: '1' }
  );

  // Must exit 0
  assert.equal(exitCode, 0, `rollback must exit 0 on success, got ${exitCode}`);

  // Must emit success JSON
  assert.ok(parsed, 'stdout must be valid JSON');
  assert.ok(['restored', 'no-op'].includes(parsed.status),
    `parsed.status must be restored or no-op, got: ${parsed.status}`);

  // Target file must now contain the restored (original) content
  const restoredContent = fs.readFileSync(targetFile, 'utf8');
  assert.equal(restoredContent, originalContent,
    'target file must be restored to original content');
});

// ── Test 6: assertSandboxPath helper API is exported ─────────────────────────

test('T11-6: assertSandboxPath is exported from snapshot.cjs and has correct signature', (t) => {
  assert.equal(typeof assertSandboxPath, 'function',
    'assertSandboxPath must be exported from snapshot.cjs');

  // When env unset: no-op for any path
  const prev = process.env.SOMA_SAFE_PATHS_ONLY;
  delete process.env.SOMA_SAFE_PATHS_ONLY;
  try {
    assert.doesNotThrow(
      () => assertSandboxPath('/tmp/other/path.md'),
      'assertSandboxPath must be no-op when env unset'
    );
  } finally {
    if (prev === undefined) delete process.env.SOMA_SAFE_PATHS_ONLY;
    else process.env.SOMA_SAFE_PATHS_ONLY = prev;
  }

  // When env=1: safe path passes
  process.env.SOMA_SAFE_PATHS_ONLY = '1';
  try {
    assert.doesNotThrow(
      () => assertSandboxPath('/tmp/soma-v2-test/foo.md'),
      'assertSandboxPath must not throw for safe path'
    );
  } finally {
    if (prev === undefined) delete process.env.SOMA_SAFE_PATHS_ONLY;
    else process.env.SOMA_SAFE_PATHS_ONLY = prev;
  }
});
