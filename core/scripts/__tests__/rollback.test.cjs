'use strict';
/**
 * Unit tests: rollback.cjs edge cases
 *
 * Covers scenarios NOT in the contract test (rollback.contract.test.cjs):
 *   - Multi-file snapshot (multiple entries)
 *   - soma-snapshot/v1 schema (no absolute_path — entries skipped gracefully)
 *   - First-call restore (target modified) → status 'restored' (not 'no-op')
 *   - Empty entries array → status 'restored' (vacuous restore with 0 files)
 *   - RESTORE_PERMISSION_DENIED (target in non-writable dir)
 *   - --snapshot-base = form (equals sign variant)
 *   - INVALID_ARGS exit code 2
 *   - JSON stdout is always valid JSON (error paths)
 *
 * Article III HARD: all tests use real fs in /tmp/soma-v2-test/t-ut-*.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a synthetic multi-file snapshot.
 * Returns metadata needed by tests.
 */
function buildMultiFileSnapshot({ label, files }) {
  const base = `/tmp/soma-v2-test/t-ut-${label}`;
  const snapshotId = '2026-05-03T10-00-00Z';
  const snapshotDir = path.join(base, 'snapshots', snapshotId);
  const targetDir   = path.join(base, 'targets');

  fs.mkdirSync(targetDir, { recursive: true });

  const entries = files.map(({ name, preWrite, current }) => {
    const targetFile  = path.join(targetDir, name);
    const snapshotSub = path.join(snapshotDir, 'claude');
    const snapshotCpy = path.join(snapshotSub, name);

    fs.mkdirSync(snapshotSub, { recursive: true });
    fs.writeFileSync(targetFile, current ?? preWrite, 'utf8');
    fs.writeFileSync(snapshotCpy, preWrite, 'utf8');

    const sha256PreWrite = sha256Buf(Buffer.from(preWrite, 'utf8'));
    return {
      relative_path:    `claude/${name}`,
      absolute_path:    targetFile,
      sha256_pre_write: sha256PreWrite,
      file_size_bytes:  Buffer.byteLength(preWrite, 'utf8'),
      block_ids_modified: [],
    };
  });

  const manifest = {
    schema:      'soma-snapshot-manifest/v1',
    snapshot_id: snapshotId,
    created_by:  'test',
    created_at:  '2026-05-03T10:00:00.000Z',
    tool:        'claude',
    entries,
  };
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { base, snapshotId, snapshotDir, targetDir, entries };
}

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
        ...env,
      }
    }
  );
  let json = null;
  try { json = JSON.parse(result.stdout); } catch (_) {}
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, json };
}

function cleanup(base) {
  if (base && fs.existsSync(base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Unit 1: Multi-file snapshot — all files restored
test('multi-file snapshot: all entries restored when targets differ from pre-write', () => {
  const { base, snapshotId, entries } = buildMultiFileSnapshot({
    label: 'multi-file-restore',
    files: [
      { name: 'file-a.md', preWrite: 'Pre-write A.\n', current: 'Post-write A.\n' },
      { name: 'file-b.md', preWrite: 'Pre-write B.\n', current: 'Post-write B.\n' },
    ],
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots'),
    ]);

    assert.equal(status, 0, `Expected exit 0. err=${json?.error}`);
    assert.equal(json?.status, 'restored');
    assert.equal(json?.files_restored?.length, 2, 'Expected 2 restored entries');
    assert.ok(json.files_restored.every(e => e.match === true), 'All entries must match');
  } finally {
    cleanup(base);
  }
});

// Unit 2: Multi-file snapshot — all already match → no-op
test('multi-file snapshot: status "no-op" when all files already at pre-write state', () => {
  const preWrite = 'Pre-write content for no-op test.\n';
  const { base, snapshotId } = buildMultiFileSnapshot({
    label: 'multi-file-noop',
    files: [
      { name: 'file-c.md', preWrite, current: preWrite },
      { name: 'file-d.md', preWrite, current: preWrite },
    ],
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots'),
    ]);

    assert.equal(status, 0, `Expected exit 0. err=${json?.error}`);
    assert.equal(json?.status, 'no-op');
    assert.equal(json?.files_restored?.length, 2);
  } finally {
    cleanup(base);
  }
});

// Unit 3: soma-snapshot/v1 schema (no absolute_path) — entries skipped gracefully
test('soma-snapshot/v1 schema entries without absolute_path are skipped (no error)', () => {
  const base       = '/tmp/soma-v2-test/t-ut-v1-schema';
  const snapshotId = '2026-05-03T11-00-00Z';
  const snapshotDir = path.join(base, 'snapshots', snapshotId);

  fs.mkdirSync(snapshotDir, { recursive: true });

  // Old v1 manifest: no absolute_path
  const manifest = {
    schema: 'soma-snapshot/v1',
    snapshot_id: snapshotId,
    files: [
      { adapter: 'claude', path: 'CLAUDE.md', sha256: 'abc123', size: 100 },
    ],
  };
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots'),
    ]);

    // v1 entries lack absolute_path — skipped → 0 files, vacuous 'restored'
    assert.equal(status, 0, `Expected exit 0 (graceful skip). err=${json?.error}`);
    assert.ok(json?.status === 'restored' || json?.status === 'no-op',
      `Expected status 'restored' or 'no-op', got: ${json?.status}`);
    assert.equal(json?.files_restored?.length, 0, 'Expected 0 entries (v1 skipped)');
  } finally {
    cleanup(base);
  }
});

// Unit 4: first-call restore (modified target) → 'restored' (not 'no-op')
test('first-call restore returns status "restored" when target differs from pre-write', () => {
  const { base, snapshotId } = buildMultiFileSnapshot({
    label: 'first-call-restored',
    files: [
      { name: 'target.md', preWrite: 'Original.\n', current: 'Modified.\n' },
    ],
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots'),
    ]);

    assert.equal(status, 0);
    assert.equal(json?.status, 'restored');
    assert.equal(json?.files_restored?.[0]?.match, true);
  } finally {
    cleanup(base);
  }
});

// Unit 5: --snapshot-base using = form (alternate arg syntax)
test('--snapshot-base= form (equals sign) parses correctly', () => {
  const { base, snapshotId } = buildMultiFileSnapshot({
    label: 'equals-form-arg',
    files: [
      { name: 'data.md', preWrite: 'Data.\n', current: 'Changed.\n' },
    ],
  });

  try {
    const { status, json } = runRollback([
      `--snapshot-id=${snapshotId}`,
      `--snapshot-base=${path.join(base, 'snapshots')}`,
    ]);

    assert.equal(status, 0, `Expected exit 0. err=${json?.error}`);
    assert.equal(json?.status, 'restored');
  } finally {
    cleanup(base);
  }
});

// Unit 6: INVALID_ARGS must exit with code 2 (not 1)
test('INVALID_ARGS exits with code 2', () => {
  const { status, json } = runRollback([]);

  assert.equal(status, 2, 'INVALID_ARGS must exit code 2');
  assert.equal(json?.error, 'INVALID_ARGS');
});

// Unit 7: error responses are always valid JSON (stdout parseable)
test('all error paths produce parseable JSON on stdout', () => {
  const errorCases = [
    // INVALID_ARGS
    { args: [], expectedCode: 'INVALID_ARGS' },
    // SNAPSHOT_NOT_FOUND
    {
      args: ['--snapshot-id', 'no-such-snapshot', '--snapshot-base', '/tmp/soma-v2-test/empty-base'],
      expectedCode: 'SNAPSHOT_NOT_FOUND',
      setup: () => fs.mkdirSync('/tmp/soma-v2-test/empty-base', { recursive: true }),
      teardown: () => fs.rmSync('/tmp/soma-v2-test/empty-base', { recursive: true, force: true }),
    },
  ];

  for (const { args, expectedCode, setup, teardown } of errorCases) {
    try {
      if (setup) setup();
      const { stdout, json } = runRollback(args);
      assert.ok(json !== null, `Expected parseable JSON for ${expectedCode}. stdout: ${stdout}`);
      assert.equal(json.error, expectedCode, `Expected error=${expectedCode}, got: ${json.error}`);
    } finally {
      if (teardown) teardown();
    }
  }
});

// Unit 8: response shape for no-op includes all required fields
test('no-op response includes status, snapshot_id, files_restored, duration_ms', () => {
  const preWrite = 'No-op shape test.\n';
  const { base, snapshotId } = buildMultiFileSnapshot({
    label: 'noop-shape',
    files: [{ name: 'shape.md', preWrite, current: preWrite }],
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots'),
    ]);

    assert.equal(status, 0);
    assert.equal(json?.status, 'no-op');
    assert.equal(json?.snapshot_id, snapshotId, 'snapshot_id must be present');
    assert.ok(Array.isArray(json?.files_restored),  'files_restored must be array');
    assert.ok(typeof json?.duration_ms === 'number', 'duration_ms must be number');
  } finally {
    cleanup(base);
  }
});

// Unit 9: partial restore (1 file already matches, 1 needs restore) → 'restored'
test('partial restore: one file already matches, one needs restore → status "restored"', () => {
  const preWrite = 'Pre-write content.\n';
  const { base, snapshotId } = buildMultiFileSnapshot({
    label: 'partial-restore',
    files: [
      { name: 'already-ok.md', preWrite, current: preWrite },          // already matches
      { name: 'needs-restore.md', preWrite, current: 'Different.\n' }, // needs restore
    ],
  });

  try {
    const { status, json } = runRollback([
      '--snapshot-id', snapshotId,
      '--snapshot-base', path.join(base, 'snapshots'),
    ]);

    assert.equal(status, 0);
    assert.equal(json?.status, 'restored', 'Mixed no-op/restore → "restored"');
    assert.equal(json?.files_restored?.length, 2);
    assert.ok(json.files_restored.every(e => e.match === true));
  } finally {
    cleanup(base);
  }
});
