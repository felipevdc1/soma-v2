'use strict';
/**
 * Integration tests: BF-06 conflict detection (abort vs allow).
 * @spec AC-13 AC-14 BF-06
 * @phase GREEN (T-09)
 * @contract CONTRACT-011-01-sync-apply
 *
 * Covers:
 *   1. Default (no --allow-local-edits): BLOCK_CONFLICT abort on sha256 mismatch
 *   2. Opt-in (--allow-local-edits): warn-and-write behavior preserved
 *   3. sha256 mismatch detection: expected_sha256 vs actual_sha256 in error details
 *   4. Structured error output: error.code, error.details.block_id, .expected_sha256, .actual_sha256
 *   5. Zero writes on abort: target file unchanged after BLOCK_CONFLICT
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC_SCRIPT = path.join(SOMA_HOME, 'scripts', 'sync.cjs');
const SANDBOX_PREFIX = '/tmp/soma-v2-test';

// ---- Helpers ----

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function runSync(somaDir, extraArgs = []) {
  const result = spawnSync(
    'node',
    [SYNC_SCRIPT, '--json', `--soma-home=${somaDir}`, ...extraArgs],
    {
      cwd: SOMA_HOME,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env }
    }
  );
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch (_) {}
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, parsed };
}

/**
 * Create a minimal soma fixture with a pre-written target that has a manually edited block.
 * Returns { somaDir, targetFile, originalSha, editedContent }.
 */
function createConflictFixture(name) {
  const dir = path.join(SANDBOX_PREFIX, `conflict-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });

  // Create manifest.json
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] })
  );

  // Create source doc
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const blockContent = '# Original block content from source\n\nThis is the SOMA-managed content.';
  fs.writeFileSync(
    path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=test-block version=1.0 -->\n${blockContent}\n<!-- soma-v2:end id=test-block -->`
  );

  // Create adapter install-targets
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(
    path.join(adapterDir, 'install-targets.json'),
    JSON.stringify({
      schema: 'soma-install-targets/v1',
      tool: 'codex',
      entries: [{
        block_id: 'test-block',
        source_doc: 'docs/source.md',
        target_path: targetFile,
        target_anchor_id: 'test-block'
      }]
    })
  );

  return { somaDir: dir, targetFile, blockContent };
}

before(() => {
  fs.mkdirSync(SANDBOX_PREFIX, { recursive: true });
});

// ============================================================
// Test 1: BLOCK_CONFLICT abort — default behavior (no --allow-local-edits)
// @spec AC-13
// ============================================================

test('BF-06: default --apply aborts with BLOCK_CONFLICT on sha256 mismatch', () => {
  const { somaDir, targetFile, blockContent } = createConflictFixture('abort-default');

  // First apply: insert block
  const r1 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r1.status, 0, `First apply must succeed. stderr: ${r1.stderr}`);
  assert.ok(fs.existsSync(targetFile), 'Target file must exist after first apply');

  // Simulate user manually editing INSIDE the block
  let content = fs.readFileSync(targetFile, 'utf8');
  content = content.replace(blockContent, blockContent + '\n<!-- MANUAL EDIT by user -->');
  fs.writeFileSync(targetFile, content);

  const shaAfterEdit = sha256(fs.readFileSync(targetFile));

  // Second apply WITHOUT --allow-local-edits: MUST abort
  const r2 = runSync(somaDir, ['--apply', '--tool=codex']);

  assert.equal(r2.status, 1,
    `Expected exit 1 (BLOCK_CONFLICT), got ${r2.status}. stdout: ${r2.stdout.slice(0, 400)}`);
  assert.ok(r2.parsed, 'Expected JSON output on BLOCK_CONFLICT');
  assert.equal(r2.parsed.error?.code, 'BLOCK_CONFLICT',
    `Expected error.code=BLOCK_CONFLICT, got: ${JSON.stringify(r2.parsed.error)}`);

  // Zero writes: target file must be unchanged (sha must match post-edit state)
  const shaAfterAbort = sha256(fs.readFileSync(targetFile));
  assert.equal(shaAfterAbort, shaAfterEdit,
    'Target file must NOT be modified when BLOCK_CONFLICT abort triggered (zero writes)');
});

// ============================================================
// Test 2: Opt-in --allow-local-edits: warn-and-write preserved
// @spec BF-06 backward compat
// ============================================================

test('BF-06: --allow-local-edits preserves warn-and-write behavior (no abort)', () => {
  const { somaDir, targetFile, blockContent } = createConflictFixture('allow-opt-in');

  // First apply
  const r1 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r1.status, 0, `First apply must succeed. stderr: ${r1.stderr}`);

  // Simulate manual edit inside block
  let content = fs.readFileSync(targetFile, 'utf8');
  content = content.replace(blockContent, blockContent + '\n<!-- MANUAL EDIT by user -->');
  fs.writeFileSync(targetFile, content);

  // Second apply WITH --allow-local-edits: must NOT abort
  const r2 = runSync(somaDir, ['--apply', '--tool=codex', '--allow-local-edits']);

  assert.equal(r2.status, 0,
    `Expected exit 0 with --allow-local-edits, got ${r2.status}. stdout: ${r2.stdout.slice(0, 400)}`);
  assert.ok(r2.parsed, 'Expected JSON output');
  assert.equal(r2.parsed.error, null,
    `Expected no error with --allow-local-edits, got: ${JSON.stringify(r2.parsed.error)}`);

  // LOCAL_EDITS_DETECTED warning must be present (backward compat behavior)
  const warnings = r2.parsed.summary?.warnings || [];
  const hasWarn = warnings.some(w => w.code === 'LOCAL_EDITS_DETECTED');
  assert.ok(hasWarn,
    `Expected LOCAL_EDITS_DETECTED warning with --allow-local-edits. Warnings: ${JSON.stringify(warnings)}`);
});

// ============================================================
// Test 3: Structured error includes sha256 details (AC-14)
// @spec AC-14
// ============================================================

test('BF-06: BLOCK_CONFLICT error includes block_id, expected_sha256, actual_sha256 (AC-14)', () => {
  const { somaDir, targetFile, blockContent } = createConflictFixture('sha256-details');

  // First apply
  const r1 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r1.status, 0, `First apply must succeed. stderr: ${r1.stderr}`);

  // Edit inside block
  let content = fs.readFileSync(targetFile, 'utf8');
  content = content.replace(blockContent, blockContent + '\n<!-- MANUAL EDIT: sha256 will mismatch -->');
  fs.writeFileSync(targetFile, content);

  // Second apply — must return structured BLOCK_CONFLICT with details
  const r2 = runSync(somaDir, ['--apply', '--tool=codex']);

  assert.equal(r2.status, 1, 'Expected exit 1');
  assert.ok(r2.parsed?.error, 'Expected error in output');
  assert.equal(r2.parsed.error.code, 'BLOCK_CONFLICT', 'Expected BLOCK_CONFLICT code');

  const details = r2.parsed.error.details;
  assert.ok(details, 'Expected error.details object');
  assert.ok(details.block_id, `Expected block_id in error.details, got: ${JSON.stringify(details)}`);
  assert.ok(details.expected_sha256, `Expected expected_sha256 in error.details`);
  assert.ok(details.actual_sha256, `Expected actual_sha256 in error.details`);
  assert.ok(details.resolution_guidance, `Expected resolution_guidance in error.details`);

  // sha256 values must differ (this is the mismatch we injected)
  assert.notEqual(details.expected_sha256, details.actual_sha256,
    'expected_sha256 and actual_sha256 must differ (that is the conflict)');

  // error message must mention block or file context
  assert.ok(
    r2.parsed.error.message?.toLowerCase().includes('block') ||
    r2.parsed.error.message?.toLowerCase().includes('conflict') ||
    r2.parsed.error.message?.toLowerCase().includes('abort'),
    `Error message must be descriptive. Got: ${r2.parsed.error.message}`
  );
});

// ============================================================
// Test 4: Summary has zero writes on BLOCK_CONFLICT
// @spec AC-13 — writes_executed=0
// ============================================================

test('BF-06: BLOCK_CONFLICT abort emits zero writes in summary', () => {
  const { somaDir, targetFile, blockContent } = createConflictFixture('zero-writes');

  // First apply
  const r1 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r1.status, 0, 'First apply must succeed');

  // Edit inside block
  let content = fs.readFileSync(targetFile, 'utf8');
  content = content.replace(blockContent, '# Overwritten by user manually');
  fs.writeFileSync(targetFile, content);

  // Second apply — abort path
  const r2 = runSync(somaDir, ['--apply', '--tool=codex']);

  assert.equal(r2.status, 1, 'Expected exit 1 on conflict');
  assert.ok(r2.parsed, 'Expected JSON output');
  assert.equal(r2.parsed.error?.code, 'BLOCK_CONFLICT', 'Expected BLOCK_CONFLICT');

  // Zero writes: summary.by_action.insert + replace must be 0
  const byAction = r2.parsed.summary?.by_action || {};
  const totalWritten = (byAction.insert || 0) + (byAction.replace || 0);
  assert.equal(totalWritten, 0,
    `Expected zero writes in summary, got: insert=${byAction.insert} replace=${byAction.replace}`);
});
