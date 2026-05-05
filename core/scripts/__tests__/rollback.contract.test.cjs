'use strict';
/**
 * Contract tests: soma rollback --snapshot-id <ISO>
 *
 * @contract CONTRACT-011-02-rollback
 * @spec AC-07, AC-08, AC-09
 *
 * @phase RED (Article II HARD)
 * @impl_status not implemented (rollback.cjs not yet created)
 * @expected_failures
 *   - rollback.cjs file does not exist → spawnSync returns non-zero status + ENOENT/module error
 *   - All test assertions fail because no impl returns expected JSON shape
 * @green_phase implementation in T-07 (~/.soma-v2/scripts/rollback.cjs NEW)
 *
 * Article III HARD: all tests use real fs in /tmp/soma-v2-test/t03-* — zero mocks.
 * Sandbox: SOMA_SAFE_PATHS_ONLY=1 set in all tests; restore targets confined to
 *   /tmp/soma-v2-test/ prefix as required by contract sandbox precondition.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute sha256 hex of a file (Article III — real crypto, no mock).
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Compute sha256 hex of a buffer / string.
 */
function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a synthetic snapshot directory in /tmp/soma-v2-test/t03-{label}/.
 *
 * Returns { snapshotBase, snapshotDir, targetFile, snapshotCopy, manifest }.
 *
 * Layout (mirrors contract Manifest Schema):
 *   /tmp/soma-v2-test/t03-{label}/snapshots/{snapshot_id}/
 *     manifest.json
 *     claude/CLAUDE.md          ← copy of pre-write content
 *
 * The REAL target file lives at:
 *   /tmp/soma-v2-test/t03-{label}/targets/CLAUDE.md
 *
 * The snapshot manifest entry absolute_path points at the real target file.
 */
function buildSyntheticSnapshot({
  label,
  snapshotId = '2026-05-02T19-30-15Z',
  preWriteContent = 'Pre-write content line 1\nPre-write content line 2\n',
  currentContent = null,         // if null, target starts identical to preWriteContent
  manifestSchema = 'soma-snapshot-manifest/v1',
  corruptSnapshotCopy = false,   // set true → snapshot file content diverges from manifest sha256
  omitManifest = false,          // set true → manifest.json not created
  badManifestSchema = false,     // set true → schema field invalid
  sandboxViolatingTarget = false // set true → absolute_path points OUTSIDE /tmp/soma-v2-test/
}) {
  const base = `/tmp/soma-v2-test/t03-${label}`;
  const snapshotDir = path.join(base, 'snapshots', snapshotId, 'claude');
  const targetDir = path.join(base, 'targets');
  const snapshotCopy = path.join(snapshotDir, 'CLAUDE.md');

  // Real absolute target file: MUST be inside /tmp/soma-v2-test/ for SOMA_SAFE_PATHS_ONLY=1
  let targetFile;
  if (sandboxViolatingTarget) {
    // Contract: SANDBOX_VIOLATION when target outside /tmp/soma-v2-test/
    targetFile = path.join(os.homedir(), '.claude', 'CLAUDE.md.soma-test-NEVER-WRITTEN');
  } else {
    targetFile = path.join(targetDir, 'CLAUDE.md');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetFile, currentContent ?? preWriteContent, 'utf8');
  }

  // Create snapshot copy
  fs.mkdirSync(snapshotDir, { recursive: true });
  if (corruptSnapshotCopy) {
    // Snapshot file content does NOT match manifest sha256
    fs.writeFileSync(snapshotCopy, 'CORRUPTED — content different from manifest entry\n', 'utf8');
  } else {
    fs.writeFileSync(snapshotCopy, preWriteContent, 'utf8');
  }

  const sha256PreWrite = sha256Buf(Buffer.from(preWriteContent, 'utf8'));

  const manifestPath = path.join(base, 'snapshots', snapshotId, 'manifest.json');
  const manifest = {
    schema: badManifestSchema ? 'invalid-schema/v99' : manifestSchema,
    snapshot_id: snapshotId,
    created_by: 'soma sync --apply --tool=claude',
    created_at: '2026-05-02T19:30:15.123Z',
    tool: 'claude',
    entries: [
      {
        relative_path: 'claude/CLAUDE.md',
        absolute_path: targetFile,
        sha256_pre_write: sha256PreWrite,
        file_size_bytes: Buffer.byteLength(preWriteContent, 'utf8'),
        block_ids_modified: ['block.claude.CLAUDE_md.cbm']
      }
    ]
  };

  if (!omitManifest) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return { base, snapshotId, snapshotDir: path.join(base, 'snapshots', snapshotId), snapshotCopy, targetFile, manifest, sha256PreWrite };
}

/**
 * Invoke rollback.cjs via spawnSync. Returns { stdout, stderr, status, json }.
 * json is the parsed JSON output (or null if stdout is not valid JSON).
 */
function runRollback(args = [], env = {}) {
  const result = spawnSync(
    'node',
    ['scripts/rollback.cjs', ...args],
    {
      cwd: SOMA_HOME,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        SOMA_SAFE_PATHS_ONLY: '1',
        ...env
      }
    }
  );

  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch (_) { /* stdout not JSON — will be asserted per test */ }

  return { stdout: result.stdout, stderr: result.stderr, status: result.status, json };
}

/**
 * Clean up a test base dir.
 */
function cleanup(base) {
  if (base && fs.existsSync(base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

// Test 1: AC-07 + AC-08 — successful restore round-trip
// @spec AC-07 AC-08
// @contract CONTRACT-011-02-rollback
test('rollback restores file to pre-write sha256 state (AC-07, AC-08)', () => {
  const { base, snapshotId, snapshotDir, targetFile, sha256PreWrite } = buildSyntheticSnapshot({
    label: 'restore-round-trip',
    preWriteContent: 'Pre-write SOMA content — sha256 round-trip target.\n',
    currentContent: 'Post-write SOMA content — file was modified by sync --apply.\n'
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: rollback.cjs not implemented → will fail here
    assert.equal(status, 0, `Expected exit 0 on successful restore. stderr: ${json?.error ?? ''}`);
    assert.equal(json?.status, 'restored',
      `Expected status "restored", got: ${JSON.stringify(json)}`);

    assert.ok(Array.isArray(json?.files_restored) && json.files_restored.length === 1,
      `Expected files_restored array with 1 entry: ${JSON.stringify(json)}`);

    const entry = json.files_restored[0];
    assert.equal(entry.match, true,
      `Expected match=true (sha256 round-trip success): ${JSON.stringify(entry)}`);
    assert.equal(entry.expected_sha256, sha256PreWrite,
      `expected_sha256 must equal sha256_pre_write from manifest`);
    assert.equal(entry.actual_sha256_post_restore, sha256PreWrite,
      `actual_sha256_post_restore must equal sha256_pre_write (round-trip identity AC-08)`);

    // Verify actual file on disk (Article III — real fs check)
    const actualSha = sha256File(targetFile);
    assert.equal(actualSha, sha256PreWrite,
      `File on disk sha256 must equal sha256_pre_write post-rollback (AC-08 round-trip identity)`);
  } finally {
    cleanup(base);
  }
});

// Test 2: AC-08 — sha256 round-trip identity (explicit post-restore disk check)
// @spec AC-08
// @contract CONTRACT-011-02-rollback
test('post-restore file sha256 equals sha256_pre_write from manifest (AC-08)', () => {
  const preWrite = 'Deterministic pre-write content for sha256 identity check.\nLine 2.\n';
  const { base, snapshotId, targetFile, sha256PreWrite } = buildSyntheticSnapshot({
    label: 'sha256-identity',
    preWriteContent: preWrite,
    currentContent: 'This content is DIFFERENT — should be overwritten by rollback.\n'
  });

  try {
    runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: rollback.cjs not implemented → file won't be restored
    // This assertion verifies the disk state after rollback (Article III real fs)
    const diskSha = sha256File(targetFile);
    assert.equal(diskSha, sha256PreWrite,
      `AC-08: post-restore disk sha256 (${diskSha}) must equal sha256_pre_write (${sha256PreWrite})`);
  } finally {
    cleanup(base);
  }
});

// Test 3: AC-09 — SNAPSHOT_NOT_FOUND error
// @spec AC-09
// @contract CONTRACT-011-02-rollback
test('SNAPSHOT_NOT_FOUND when snapshot-id does not exist (AC-09)', () => {
  const base = `/tmp/soma-v2-test/t03-snapshot-not-found`;
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', '2099-01-01T00-00-00Z',   // non-existent id
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: will fail because rollback.cjs does not exist
    assert.notEqual(status, 0, 'Expected non-zero exit on SNAPSHOT_NOT_FOUND');
    assert.equal(json?.error, 'SNAPSHOT_NOT_FOUND',
      `Expected error=SNAPSHOT_NOT_FOUND, got: ${JSON.stringify(json)}`);
    assert.ok(typeof json?.message === 'string' && json.message.length > 0,
      `Expected non-empty message: ${JSON.stringify(json)}`);
    assert.ok(json?.details?.snapshot_id_searched === '2099-01-01T00-00-00Z',
      `Expected details.snapshot_id_searched in response: ${JSON.stringify(json)}`);
  } finally {
    cleanup(base);
  }
});

// Test 4: AC-09 — MANIFEST_MISSING error
// @spec AC-09
// @contract CONTRACT-011-02-rollback
test('MANIFEST_MISSING when snapshot dir exists but manifest.json absent (AC-09)', () => {
  const { base, snapshotId } = buildSyntheticSnapshot({
    label: 'manifest-missing',
    omitManifest: true
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: will fail because rollback.cjs does not exist
    assert.notEqual(status, 0, 'Expected non-zero exit on MANIFEST_MISSING');
    assert.equal(json?.error, 'MANIFEST_MISSING',
      `Expected error=MANIFEST_MISSING, got: ${JSON.stringify(json)}`);
  } finally {
    cleanup(base);
  }
});

// Test 5: AC-09 — MANIFEST_SCHEMA_INVALID error
// @spec AC-09
// @contract CONTRACT-011-02-rollback
test('MANIFEST_SCHEMA_INVALID when manifest.json schema field is wrong (AC-09)', () => {
  const { base, snapshotId } = buildSyntheticSnapshot({
    label: 'manifest-schema-invalid',
    badManifestSchema: true
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: will fail because rollback.cjs does not exist
    assert.notEqual(status, 0, 'Expected non-zero exit on MANIFEST_SCHEMA_INVALID');
    assert.equal(json?.error, 'MANIFEST_SCHEMA_INVALID',
      `Expected error=MANIFEST_SCHEMA_INVALID, got: ${JSON.stringify(json)}`);
  } finally {
    cleanup(base);
  }
});

// Test 6: AC-09 — ROLLBACK_VERIFICATION_FAILED when snapshot file is corrupted
// @spec AC-09
// @contract CONTRACT-011-02-rollback
test('ROLLBACK_VERIFICATION_FAILED when snapshot file sha256 mismatches manifest (AC-09)', () => {
  const { base, snapshotId } = buildSyntheticSnapshot({
    label: 'verification-failed',
    corruptSnapshotCopy: true   // snapshot file content diverges from manifest sha256_pre_write
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: will fail because rollback.cjs does not exist
    assert.notEqual(status, 0, 'Expected non-zero exit on ROLLBACK_VERIFICATION_FAILED');
    assert.equal(json?.error, 'ROLLBACK_VERIFICATION_FAILED',
      `Expected error=ROLLBACK_VERIFICATION_FAILED, got: ${JSON.stringify(json)}`);
    assert.ok(typeof json?.details?.expected_sha256 === 'string',
      `Expected details.expected_sha256 in response: ${JSON.stringify(json)}`);
    assert.ok(typeof json?.details?.actual_sha256_post_restore === 'string',
      `Expected details.actual_sha256_post_restore in response: ${JSON.stringify(json)}`);
    assert.ok(typeof json?.details?.recovery_guidance === 'string',
      `Expected details.recovery_guidance in response: ${JSON.stringify(json)}`);
  } finally {
    cleanup(base);
  }
});

// Test 7: AC-07 — INVALID_ARGS when --snapshot-id missing
// @spec AC-09
// @contract CONTRACT-011-02-rollback
test('INVALID_ARGS when --snapshot-id argument is missing (AC-09)', () => {
  // Run with no args at all
  const { status, json } = runRollback([]);

  // @phase RED: will fail because rollback.cjs does not exist
  assert.notEqual(status, 0, 'Expected non-zero exit when --snapshot-id missing');
  assert.equal(json?.error, 'INVALID_ARGS',
    `Expected error=INVALID_ARGS, got: ${JSON.stringify(json)}`);
});

// Test 8: Idempotency — second rollback with same snapshot-id is no-op
// @spec AC-07
// @contract CONTRACT-011-02-rollback
test('second rollback with same snapshot-id is no-op when file already matches (AC-07 idempotency)', () => {
  const preWrite = 'Idempotency test pre-write content.\n';
  const { base, snapshotId, sha256PreWrite } = buildSyntheticSnapshot({
    label: 'idempotent',
    preWriteContent: preWrite,
    // currentContent left null → file already matches pre-write (already restored state)
    currentContent: preWrite  // file already at pre-write state = no-op scenario
  });

  try {
    // First call — should restore (or no-op if already matching)
    runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // Second call — file already matches sha256_pre_write → expect status "no-op"
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: will fail because rollback.cjs does not exist
    assert.equal(status, 0,
      `Expected exit 0 on idempotent no-op. stderr: ${json?.error ?? ''}`);
    assert.equal(json?.status, 'no-op',
      `Expected status "no-op" on second rollback when files already match: ${JSON.stringify(json)}`);
  } finally {
    cleanup(base);
  }
});

// Test 9: SANDBOX_VIOLATION — SOMA_SAFE_PATHS_ONLY=1 + target outside /tmp/soma-v2-test/
// @spec AC-09 AC-17
// @contract CONTRACT-011-02-rollback
test('SANDBOX_VIOLATION when SOMA_SAFE_PATHS_ONLY=1 and restore target outside /tmp/soma-v2-test/ (AC-09)', () => {
  // Snapshot manifest absolute_path points outside /tmp/soma-v2-test/ prefix
  const { base, snapshotId } = buildSyntheticSnapshot({
    label: 'sandbox-violation',
    sandboxViolatingTarget: true  // absolute_path = ~/.claude/CLAUDE.md.soma-test-NEVER-WRITTEN
  });

  try {
    const { status, json } = runRollback(
      ['--snapshot-id', snapshotId, '--snapshot-base', path.join(base, 'snapshots')],
      { SOMA_SAFE_PATHS_ONLY: '1' }  // explicitly set in env override (already set in runRollback default)
    );

    // @phase RED: will fail because rollback.cjs does not exist
    assert.notEqual(status, 0, 'Expected non-zero exit on SANDBOX_VIOLATION');
    assert.equal(json?.error, 'SANDBOX_VIOLATION',
      `Expected error=SANDBOX_VIOLATION, got: ${JSON.stringify(json)}`);

    // Verify real file was NOT written (Article VI zero deletion — sandbox enforcement)
    const violatingPath = path.join(os.homedir(), '.claude', 'CLAUDE.md.soma-test-NEVER-WRITTEN');
    assert.ok(!fs.existsSync(violatingPath),
      `SANDBOX_VIOLATION: target file must NOT be written: ${violatingPath}`);
  } finally {
    cleanup(base);
  }
});

// Test 10: response shape — successful restore includes required output fields
// @spec AC-07 AC-08
// @contract CONTRACT-011-02-rollback
test('successful restore response includes all required output fields (AC-07, AC-08)', () => {
  const { base, snapshotId } = buildSyntheticSnapshot({
    label: 'response-shape',
    preWriteContent: 'Response shape test content.\n',
    currentContent: 'Modified content — different from pre-write.\n'
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots')
    ]);

    // @phase RED: will fail because rollback.cjs does not exist
    assert.equal(status, 0, `Expected exit 0. stderr: ${json?.error ?? ''}`);

    // Required top-level fields per contract Output section
    assert.ok(typeof json?.status === 'string', 'response.status must be string');
    assert.equal(json?.snapshot_id, snapshotId, 'response.snapshot_id must match requested id');
    assert.ok(Array.isArray(json?.files_restored), 'response.files_restored must be array');
    assert.ok(typeof json?.duration_ms === 'number', 'response.duration_ms must be number');

    // Required per-file fields
    const entry = json.files_restored[0];
    assert.ok(typeof entry?.path === 'string', 'entry.path must be string');
    assert.ok(typeof entry?.expected_sha256 === 'string', 'entry.expected_sha256 must be string');
    assert.ok(typeof entry?.actual_sha256_post_restore === 'string', 'entry.actual_sha256_post_restore must be string');
    assert.ok(typeof entry?.match === 'boolean', 'entry.match must be boolean');
  } finally {
    cleanup(base);
  }
});
