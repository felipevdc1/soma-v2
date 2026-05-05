// @spec AC-15 AC-16
// @contract CONTRACT-011-01-sync-apply CONTRACT-011-02-rollback
'use strict';
/**
 * synthetic-validation.test.cjs — T-10 synthetic validation cycle test
 *
 * Acceptance criteria:
 *   AC-15: synthetic validation cycle (sync apply → rollback → sha256 round-trip identity)
 *   AC-16: validation evidence visible in test output (sha256 round-trip JSON log per Article IV)
 *
 * Two sub-tests:
 *   1. Round-trip identity: apply (modifies fixture) → rollback from synthetic snapshot → sha256 identity
 *   2. Partial-state simulation: apply → mutate externally → rollback → sha256 still matches pre
 *
 * Constitutional compliance:
 *   - Article II HARD: TDD RED→GREEN (RED evidence: initial run showed
 *     "sync --apply failed: manifest.json missing required 'files' array" + sha256 mismatch on 2nd run)
 *   - Article III HARD: real fs under /tmp/soma-v2-test/, zero mocks
 *   - Article IV HARD: structured synthetic_validation_evidence JSON logged per test (AC-16)
 *   - Article VI HARD: zero deletion; rollback is restorative
 *   - Sandbox: SOMA_SAFE_PATHS_ONLY=1 set for sync; rollback paths are under /tmp/soma-v2-test/
 *
 * Approach: synthetic snapshots are constructed manually in the test for isolation and
 * determinism (T-10 spec: "setup fixture cópia", "simulate SIGKILL mid-write (mock partial state)").
 * BF-08 fixed (2026-05-03): createSnapshot now emits absolute_path per entry natively, so the
 * manual workaround that injected absolute_path is no longer required for correctness — but is
 * preserved here for test isolation. See workaround note in createSyntheticSnapshot JSDoc.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

// ── Constants ────────────────────────────────────────────────────────────────

const SOMA_HOME_REAL = path.join(os.homedir(), '.soma-v2');
const SYNC_CJS       = path.join(SOMA_HOME_REAL, 'scripts', 'sync.cjs');
const ROLLBACK_CJS   = path.join(SOMA_HOME_REAL, 'scripts', 'rollback.cjs');
const FIXTURE_SRC    = path.join(os.homedir(), '.claude', 'CLAUDE.md');

// Unique run directories to avoid parallel test collisions
const TS = Date.now();
const RUN_A = `/tmp/soma-v2-test/t10-run-a-${TS}`;
const RUN_B = `/tmp/soma-v2-test/t10-run-b-${TS}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute sha256 hex of file contents.
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a synthetic SOMA home under runDir with:
 *   - adapters/claude/install-targets.json pointing to fixture at targetPath
 *   - docs/source.md with minimal anchored block (short anchor = 't10-block')
 *   - manifest.json with required files array (soma-manifest/v1)
 *   - .snapshots/ dir
 *
 * @param {string} runDir - base run directory (under /tmp/soma-v2-test/)
 * @param {string} targetPath - fixture file to use as sync target (must be absolute)
 * @returns {{ somaHome: string, blockId: string, sourceDocPath: string }}
 */
function buildSyntheticSomaHome(runDir, targetPath) {
  const somaHome = path.join(runDir, 'soma-home');
  const blockId = 'block.claude.fixture.t10-block';
  const shortAnchor = 't10-block'; // suffix matched by extractBlock legacy format

  // Create directory structure
  fs.mkdirSync(path.join(somaHome, 'adapters', 'claude'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'logs'), { recursive: true });

  // Minimal source doc with anchored block (legacy format: <!-- t10-block:start -->)
  // extractBlock(source.md, 'block.claude.fixture.t10-block') → tries shortName 't10-block' → found
  const sourceDocContent = `<!-- ${shortAnchor}:start -->
# T-10 Synthetic Validation Block

This is synthetic content injected by the T-10 round-trip test.
Generated at: ${new Date().toISOString()}
<!-- ${shortAnchor}:end -->`;
  const sourceDocPath = path.join(somaHome, 'docs', 'source.md');
  fs.writeFileSync(sourceDocPath, sourceDocContent);

  // soma-manifest/v1 — requires schema + files[] array (validated by loadManifest)
  const sourceDocSha = crypto.createHash('sha256').update(sourceDocContent).digest('hex');
  const manifestContent = JSON.stringify({
    schema: 'soma-manifest/v1',
    version: '2.1.0-test',
    release: 'soma-v2.1-t10-synthetic',
    files: [
      {
        id: 't10.source',
        path: 'docs/source.md',
        sha256: sourceDocSha,
        sourceMtime: new Date().toISOString(),
        sourceSha256: sourceDocSha,
        targets: ['global'],
        expansion_owner: null,
        status: 'test'
      }
    ]
  }, null, 2);
  fs.writeFileSync(path.join(somaHome, 'manifest.json'), manifestContent);

  // install-targets.json: one entry pointing to fixture at targetPath
  // target_path is absolute (no ~ expansion needed), pointing to /tmp/soma-v2-test/
  const installTargets = {
    schema: 'soma-install-targets/v1',
    tool: 'claude',
    entries: [
      {
        block_id: blockId,
        source_doc: 'docs/source.md',
        target_path: targetPath,
        target_anchor_id: blockId
      }
    ]
  };
  fs.writeFileSync(
    path.join(somaHome, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify(installTargets, null, 2)
  );

  return { somaHome, blockId, sourceDocPath };
}

/**
 * Create a synthetic snapshot directory under snapshotsBase that rollback.cjs can consume.
 *
 * The current soma-snapshot-manifest/v1 emitted by createSnapshot does NOT include
 * absolute_path per entry. Rollback.cjs requires absolute_path to resolve restore targets.
 * For synthetic validation (T-10), we construct the snapshot manually with absolute_path
 * so rollback can restore the fixture to its pre-sync state.
 *
 * BF-08 fixed (2026-05-03): createSnapshot now emits absolute_path per entry natively.
 * This workaround (manual snapshot construction) is no longer strictly required for
 * end-to-end correctness — the real createSnapshot flow will populate absolute_path.
 * The synthetic approach is retained here for test isolation and determinism (T-10 spec:
 * "setup fixture cópia", "simulate SIGKILL mid-write"). Can be simplified in next iteration.
 *
 * @param {string} snapshotsBase - path to .snapshots/ dir
 * @param {string} targetPath - absolute path to the file being snapshotted
 * @param {string} adapter - adapter name (e.g. 'claude')
 * @param {Buffer} fileContent - file content BEFORE sync (pre-write state)
 * @returns {{ snapshotId: string, snapshotDir: string }}
 */
function createSyntheticSnapshot(snapshotsBase, targetPath, adapter, fileContent) {
  const now = new Date();
  // Format: YYYY-MM-DDTHH-MM-SSZ (dashes instead of colons for filesystem compat)
  const pad = (n) => String(n).padStart(2, '0');
  const snapshotId = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}Z`;

  const snapshotDir = path.join(snapshotsBase, snapshotId);
  const adapterDir = path.join(snapshotDir, adapter);
  fs.mkdirSync(adapterDir, { recursive: true, mode: 0o700 });

  // Copy file into snapshot
  const relativePath = `${adapter}/${path.basename(targetPath)}`;
  const snapshotCopyPath = path.join(snapshotDir, relativePath);
  fs.writeFileSync(snapshotCopyPath, fileContent);

  const sha256_pre_write = crypto.createHash('sha256').update(fileContent).digest('hex');
  const file_size_bytes = fileContent.length;

  // Manifest with absolute_path (required by rollback.cjs for restore target resolution)
  const manifest = {
    schema: 'soma-snapshot-manifest/v1',
    snapshot_id: snapshotId,
    created_by: 'soma sync --apply --tool=claude (synthetic T-10)',
    created_at: now.toISOString(),
    tool: adapter,
    entries: [
      {
        relative_path: relativePath,
        absolute_path: targetPath,
        sha256_pre_write,
        file_size_bytes,
        block_ids_modified: ['block.claude.fixture.t10-block']
      }
    ]
  };
  fs.writeFileSync(
    path.join(snapshotDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  return { snapshotId, snapshotDir };
}

/**
 * Run sync --apply against synthetic soma home. Returns parsed JSON result.
 * Uses SOMA_SAFE_PATHS_ONLY=1 (sandbox safe since target is under /tmp/soma-v2-test/).
 */
function runSync(somaHome) {
  const proc = spawnSync(
    'node',
    [SYNC_CJS, '--apply', '--json', '--tool=claude', `--soma-home=${somaHome}`],
    {
      env: { ...process.env, SOMA_SAFE_PATHS_ONLY: '1' },
      encoding: 'utf8',
      timeout: 30000
    }
  );
  let result = null;
  try { result = JSON.parse(proc.stdout); } catch (_) {}
  return { exitCode: proc.status, result, raw: proc.stdout + proc.stderr };
}

/**
 * Run rollback --snapshot-id against a snapshot.
 * Note: SOMA_SAFE_PATHS_ONLY=1 requires target paths inside /tmp/soma-v2-test/
 */
function runRollback(snapshotId, snapshotsBase) {
  const proc = spawnSync(
    'node',
    [ROLLBACK_CJS, `--snapshot-id=${snapshotId}`, `--snapshot-base=${snapshotsBase}`],
    {
      env: { ...process.env, SOMA_SAFE_PATHS_ONLY: '1' },
      encoding: 'utf8',
      timeout: 30000
    }
  );
  let result = null;
  try { result = JSON.parse(proc.stdout); } catch (_) {}
  return { exitCode: proc.status, result, raw: proc.stdout + proc.stderr };
}

/**
 * Cleanup helper.
 */
function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-test 1: Round-trip identity (AC-15)
//
// Flow:
//   1. Copy CLAUDE.md → fixture under /tmp/soma-v2-test/RUN_A/
//   2. Compute pre_sha256 of fixture
//   3. Create synthetic snapshot of fixture (pre-sync state)
//   4. Run sync --apply → modifies fixture (inserts t10-block anchor)
//   5. Run rollback --snapshot-id → restores fixture to pre-sync state
//   6. Compute post_sha256 → assert === pre_sha256 (AC-15)
//   7. Log Article IV evidence JSON (AC-16)
// ─────────────────────────────────────────────────────────────────────────────

test('T-10 / AC-15: round-trip identity — apply + rollback restores pre-sync sha256', async () => {
  // ── Setup ──────────────────────────────────────────────────────────────────
  fs.mkdirSync(RUN_A, { recursive: true });
  const fixtureTarget = path.join(RUN_A, 'CLAUDE.md.fixture');

  // Copy real CLAUDE.md as the fixture target file
  fs.copyFileSync(FIXTURE_SRC, fixtureTarget);

  // Compute pre-sync sha256 (before any apply)
  const pre_sha256 = sha256File(fixtureTarget);
  const preContent = fs.readFileSync(fixtureTarget);

  // Build synthetic soma home (adapters, source docs, manifest)
  const { somaHome } = buildSyntheticSomaHome(RUN_A, fixtureTarget);
  const snapshotsBase = path.join(somaHome, '.snapshots');

  // Create synthetic snapshot of the PRE-SYNC state (with absolute_path for rollback resolution)
  const { snapshotId } = createSyntheticSnapshot(snapshotsBase, fixtureTarget, 'claude', preContent);

  // ── Apply: sync modifies the fixture ─────────────────────────────────────
  const syncOut = runSync(somaHome);

  // sync may exit 0 (apply succeeded) or 1 (dry-run diff / other). Exit 0 required for apply.
  assert.ok(
    syncOut.exitCode === 0,
    `sync --apply failed (exit ${syncOut.exitCode}): ${syncOut.raw}`
  );

  // Verify fixture was actually modified (sha256 changed after apply)
  const post_apply_sha256 = sha256File(fixtureTarget);
  assert.notEqual(post_apply_sha256, pre_sha256,
    'sync --apply must have modified the fixture (sha256 unchanged — block not inserted)');

  // ── Rollback: restore fixture to pre-sync state ────────────────────────────
  const rollbackOut = runRollback(snapshotId, snapshotsBase);

  assert.ok(
    rollbackOut.exitCode === 0,
    `rollback failed (exit ${rollbackOut.exitCode}): ${rollbackOut.raw}`
  );
  assert.ok(
    rollbackOut.result &&
    (rollbackOut.result.status === 'restored' || rollbackOut.result.status === 'no-op'),
    `Expected status restored|no-op, got: ${rollbackOut.raw}`
  );

  // ── Round-trip identity assertion (AC-15) ──────────────────────────────────
  const post_sha256 = sha256File(fixtureTarget);

  // Article IV evidence: structured JSON log (AC-16)
  console.log(JSON.stringify({
    event: 'synthetic_validation_evidence',
    sub_test: 'round-trip-identity',
    pre_sha256,
    snapshot_id: snapshotId,
    post_apply_sha256,
    post_sha256,
    equal: pre_sha256 === post_sha256
  }));

  assert.equal(pre_sha256, post_sha256,
    'Round-trip identity FAILED: post-rollback sha256 differs from pre-sync sha256');

  // Additional: verify rollback metadata
  if (rollbackOut.result && rollbackOut.result.files_restored) {
    const entry = rollbackOut.result.files_restored[0];
    if (entry) {
      assert.equal(entry.match, true, 'rollback files_restored[0].match must be true');
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  cleanupDir(RUN_A);
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-test 2: Partial-state simulation (AC-15 edge case)
//
// Flow:
//   1. Copy CLAUDE.md → fixture under /tmp/soma-v2-test/RUN_B/
//   2. Compute pre_sha256 of fixture
//   3. Create synthetic snapshot of fixture (pre-sync state)
//   4. Run sync --apply → modifies fixture (inserts t10-block anchor)
//   5. EXTERNALLY MUTATE fixture (simulate SIGKILL/partial write between apply and rollback)
//   6. Run rollback → restores from SNAPSHOT COPY, not from mutated current state
//   7. Compute post_sha256 → assert === pre_sha256 (AC-15: rollback is snapshot-authoritative)
//   8. Log Article IV evidence JSON (AC-16)
// ─────────────────────────────────────────────────────────────────────────────

test('T-10 / AC-15: partial-state simulation — rollback after external mutation restores pre-sync sha256', async () => {
  // ── Setup ──────────────────────────────────────────────────────────────────
  fs.mkdirSync(RUN_B, { recursive: true });
  const fixtureTarget = path.join(RUN_B, 'CLAUDE.md.fixture');

  // Copy real CLAUDE.md as the fixture target file
  fs.copyFileSync(FIXTURE_SRC, fixtureTarget);

  // Compute pre-sync sha256
  const pre_sha256 = sha256File(fixtureTarget);
  const preContent = fs.readFileSync(fixtureTarget);

  // Build synthetic soma home
  const { somaHome } = buildSyntheticSomaHome(RUN_B, fixtureTarget);
  const snapshotsBase = path.join(somaHome, '.snapshots');

  // Create synthetic snapshot of PRE-SYNC state
  const { snapshotId } = createSyntheticSnapshot(snapshotsBase, fixtureTarget, 'claude', preContent);

  // ── Apply: sync modifies the fixture ─────────────────────────────────────
  const syncOut = runSync(somaHome);
  assert.ok(syncOut.exitCode === 0, `sync --apply failed (exit ${syncOut.exitCode}): ${syncOut.raw}`);

  // ── External mutation: append bytes to simulate partial state / SIGKILL mid-apply ─
  fs.appendFileSync(fixtureTarget,
    '\n\n# EXTERNAL MUTATION — simulating partial write / SIGKILL crash state\n');
  const mutated_sha256 = sha256File(fixtureTarget);

  // Verify mutation actually changed the file
  assert.notEqual(mutated_sha256, pre_sha256,
    'External mutation must produce a different sha256 than pre-sync');

  // ── Rollback after mutation: must restore from snapshot copy ─────────────
  const rollbackOut = runRollback(snapshotId, snapshotsBase);

  assert.ok(
    rollbackOut.exitCode === 0,
    `rollback after mutation failed (exit ${rollbackOut.exitCode}): ${rollbackOut.raw}`
  );
  assert.ok(
    rollbackOut.result &&
    (rollbackOut.result.status === 'restored' || rollbackOut.result.status === 'no-op'),
    `Expected status restored|no-op, got: ${rollbackOut.raw}`
  );

  // ── Round-trip identity assertion (AC-15) ──────────────────────────────────
  const post_sha256 = sha256File(fixtureTarget);

  // Article IV evidence: structured JSON log (AC-16)
  console.log(JSON.stringify({
    event: 'synthetic_validation_evidence',
    sub_test: 'partial-state-simulation',
    pre_sha256,
    snapshot_id: snapshotId,
    mutated_sha256,
    post_sha256,
    equal: pre_sha256 === post_sha256
  }));

  assert.equal(pre_sha256, post_sha256,
    'Partial-state rollback FAILED: post-rollback sha256 differs from pre-sync sha256 ' +
    '(rollback must restore from snapshot copy, not depend on current mutated state)');

  // Verify rollback metadata shows restored (not no-op, since file was mutated)
  assert.equal(
    rollbackOut.result && rollbackOut.result.status,
    'restored',
    'After external mutation, rollback must report status=restored (not no-op)'
  );

  if (rollbackOut.result && rollbackOut.result.files_restored) {
    const entry = rollbackOut.result.files_restored[0];
    if (entry) {
      assert.equal(entry.match, true, 'rollback files_restored[0].match must be true');
      assert.equal(entry.expected_sha256, pre_sha256,
        'rollback expected_sha256 must equal pre-sync sha256 (snapshot pre-write state)');
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  cleanupDir(RUN_B);
});
