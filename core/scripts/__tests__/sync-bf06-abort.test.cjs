'use strict';
/**
 * sync-bf06-abort.test.cjs — T-04 RED phase
 *
 * Contract: [CONTRACT:03] sync.cjs BF-06 abort behavior
 * Spec ref: [SPEC:AC-14] [SPEC:AC-19] [SPEC:AC-03]
 *
 * Article II HARD: RED phase — cases 2+4 must FAIL until T-17 implements the fix.
 * Article III HARD: real fs / real child_process, no mocks.
 *
 * Fixture: real fs in /tmp/soma-test-bf06-{pid}/
 * Uses core/scripts/lib/anchored-blocks.cjs for sha256 computation (READ-ONLY frozen lib).
 *
 * Test cases:
 *   S1: sha match → proceed (exit 0 + write OK)           [GREEN — should pass now]
 *   S2: sha mismatch no flag → ABORT                      [RED until T-17: exits 1 not 2]
 *   S3: sha mismatch + --allow-local-edits → proceed warn [GREEN — should pass now]
 *   S4: AC-19 5-element error msg structure               [RED until T-17: format mismatch]
 *
 * @spec [SPEC:AC-14] [SPEC:AC-19] [CONTRACT:03]
 * @task T-04
 * @green_phase T-17 (sync.cjs BF-06 fix: exit 2 + AC-19 error msg format)
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// ── Frozen lib import (READ-ONLY — do not modify) ────────────────────────────
const { computeBlockSha256 } = require('../lib/anchored-blocks.cjs');

// ── Paths ─────────────────────────────────────────────────────────────────────

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC_CJS = path.join(SOMA_HOME, 'scripts', 'sync.cjs');
const FIXTURE_BASE = `/tmp/soma-test-bf06-${process.pid}`;

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build a minimal soma fixture dir under FIXTURE_BASE/{name}/.
 * Returns { somaDir, targetFile }.
 *
 * Structure:
 *   somaDir/
 *     manifest.json
 *     adapters/codex/install-targets.json   ← points to targetFile
 *     docs/source.md                        ← contains block with sourceContent
 *
 * The targetFile (outside somaDir) contains an anchored block with attrs
 * sha256={anchorSha} but actual content = targetContent.
 *
 * @param {string} name - unique fixture name
 * @param {object} opts
 * @param {string} opts.sourceContent - block content in source doc
 * @param {string} opts.targetContent - actual block content in target file (inside markers)
 * @param {string} opts.anchorSha - sha256 value stored in start marker attr (may differ from targetContent sha)
 */
function createFixture(name, { sourceContent, targetContent, anchorSha }) {
  const fixtureDir = path.join(FIXTURE_BASE, name);
  const somaDir = path.join(fixtureDir, 'soma-home');
  const targetFile = path.join(fixtureDir, 'target.md');

  // Create directory structure
  const adapterDir = path.join(somaDir, 'adapters', 'codex');
  const docsDir = path.join(somaDir, 'docs');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  // manifest.json (minimal valid)
  fs.writeFileSync(
    path.join(somaDir, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] })
  );

  // Source doc with block content (no sha attr — source marker format)
  fs.writeFileSync(
    path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=bf06-block version=1.0 -->\n${sourceContent}\n<!-- soma-v2:end id=bf06-block -->`
  );

  // install-targets.json pointing to target file
  fs.writeFileSync(
    path.join(adapterDir, 'install-targets.json'),
    JSON.stringify({
      schema: 'soma-install-targets/v1',
      tool: 'codex',
      entries: [{
        block_id: 'bf06-block',
        source_doc: 'docs/source.md',
        target_path: targetFile,
        target_anchor_id: 'bf06-block'
      }]
    })
  );

  // Target file with anchored block where sha attr = anchorSha, content = targetContent
  fs.writeFileSync(
    targetFile,
    `# Target file\n<!-- soma-v2:start id=bf06-block version=1.0 sha256=${anchorSha} -->\n${targetContent}\n<!-- soma-v2:end id=bf06-block -->\n`
  );

  return { somaDir, targetFile };
}

/**
 * Run sync.cjs with given args.
 * Always sets SOMA_SAFE_PATHS_ONLY=0 (fixture targets ARE under /tmp which is safe,
 * but we don't want sandbox guard to interfere with BF-06 tests).
 */
function runSync(args) {
  return spawnSync('node', [SYNC_CJS, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, SOMA_SAFE_PATHS_ONLY: '0' }
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

after(() => {
  try {
    fs.rmSync(FIXTURE_BASE, { recursive: true, force: true });
  } catch (_) { /* best-effort, /tmp is ephemeral */ }
});

// ── S1: sha match → proceed (exit 0 + write OK) ──────────────────────────────
// [GREEN — expected to pass now]
// When the sha attr in the block marker matches the actual block content sha256,
// BF-06 conflict detection returns null → sync proceeds normally.
// Source has different content → action=replace → apply writes and exits 0.

test('T-04-S1: sha attr matches actual content → sync --apply exits 0 (no abort)', () => {
  const originalContent = '# Original content';
  const originalSha = computeBlockSha256(originalContent);
  // sha attr matches actual content → no BF-06 conflict
  const { somaDir, targetFile } = createFixture('s1-match', {
    sourceContent: '# Updated source content',
    targetContent: originalContent,
    anchorSha: originalSha  // attr sha == actual content sha → no conflict
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);
  assert.equal(
    r.status, 0,
    `T-04-S1: Expected exit 0 (sha match → no conflict, apply proceeds). Got ${r.status}.\nstderr: ${r.stderr}\nstdout: ${r.stdout}`
  );
  // Verify target file was actually written (block updated from source)
  const after = fs.readFileSync(targetFile, 'utf8');
  assert.ok(
    after.includes('# Updated source content'),
    `T-04-S1: Expected target to be updated with source content after apply.\nTarget content: ${after}`
  );
});

// ── S2: sha mismatch no flag → ABORT ─────────────────────────────────────────
// [RED until T-17]
// @expected_failure Contract requires exit 2; current sync.cjs exits 1.
// When block sha attr != actual content sha256 AND --allow-local-edits not set,
// sync must exit 2 (ABORT) with zero writes.

test('T-04-S2: sha mismatch without --allow-local-edits → exits 2 (ABORT) [RED until T-17]', () => {
  const originalContent = '# Original content';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir, targetFile } = createFixture('s2-mismatch-abort', {
    sourceContent: '# New source content',
    targetContent: '# Manually edited content',  // differs from originalSha
    anchorSha: originalSha  // attr sha != actual content sha → BF-06 conflict
  });

  const beforeContent = fs.readFileSync(targetFile, 'utf8');
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);

  // T-17 will fix: contract requires exit 2, current behavior exits 1
  assert.equal(
    r.status, 2,
    `T-04-S2: Expected exit 2 (BF-06 ABORT — sha mismatch, no --allow-local-edits). Got ${r.status}.\n` +
    `[RED: T-17 must fix sync.cjs exit code from 1 to 2]\nstderr: ${r.stderr}\nstdout: ${r.stdout}`
  );

  // Zero writes: target file must be unchanged after abort
  const afterContent = fs.readFileSync(targetFile, 'utf8');
  assert.equal(
    afterContent, beforeContent,
    `T-04-S2: Target file must be unchanged after BF-06 abort (zero writes).\n` +
    `Before: ${beforeContent}\nAfter: ${afterContent}`
  );
});

// ── S3: sha mismatch + --allow-local-edits → proceed with warning ─────────────
// [GREEN — expected to pass now]
// With --allow-local-edits flag, BF-06 conflict gate is bypassed →
// sync proceeds, writes the block, emits LOCAL_EDITS_DETECTED warning.

test('T-04-S3: sha mismatch with --allow-local-edits → exits 0 + emits overwrite warning [GREEN]', () => {
  const originalContent = '# Original content';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir, targetFile } = createFixture('s3-allow-local-edits', {
    sourceContent: '# New source content',
    targetContent: '# Manually edited content',
    anchorSha: originalSha  // attr sha != actual content sha → conflict, but flag bypasses it
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--allow-local-edits']);

  assert.equal(
    r.status, 0,
    `T-04-S3: Expected exit 0 (--allow-local-edits bypasses BF-06 abort). Got ${r.status}.\nstderr: ${r.stderr}\nstdout: ${r.stdout}`
  );

  // Verify some overwrite warning is emitted (stderr or stdout)
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.toLowerCase().includes('overwriting') ||
    combined.toLowerCase().includes('local') ||
    combined.toLowerCase().includes('edit') ||
    combined.includes('LOCAL_EDITS_DETECTED'),
    `T-04-S3: Expected overwrite/local-edits warning in output.\nCombined output: ${combined.slice(0, 600)}`
  );

  // File must have been written (block updated with source content)
  const afterContent = fs.readFileSync(targetFile, 'utf8');
  assert.ok(
    afterContent.includes('# New source content'),
    `T-04-S3: Target must be updated with source content when --allow-local-edits is set.\nTarget: ${afterContent}`
  );
});

// ── S4: AC-19 5-element error message structure ───────────────────────────────
// [RED until T-17]
// @expected_failure Current error format uses different labels/structure.
// When BF-06 abort triggers (case S2), stderr MUST contain all 5 required elements:
//   1. Target file absolute path
//   2. block_id
//   3. "Expected:" sha256
//   4. "Actual:" sha256
//   5. "soma rollback" OR "--allow-local-edits" OR "re-extract" recovery hint

test('T-04-S4-elem1: BF-06 abort stderr contains target file absolute path [RED until T-17]', () => {
  const originalContent = '# Original content for elem1';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir, targetFile } = createFixture('s4-elem1', {
    sourceContent: '# New source',
    targetContent: '# Manually edited for elem1',
    anchorSha: originalSha
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);

  // Must have exited with error (1 or 2 — exit code test is S2's concern)
  assert.ok(
    r.status !== 0,
    `T-04-S4-elem1: Expected non-zero exit for BF-06 abort. Got ${r.status}.`
  );

  // AC-19 element 1: target file absolute path in stderr
  // [RED until T-17: current format emits 'file: <path>' but not as standalone path on its own line]
  assert.ok(
    r.stderr.includes(targetFile),
    `T-04-S4-elem1: Expected absolute target path "${targetFile}" in stderr.\n` +
    `[RED: T-17 must emit AC-19 format with absolute path]\nstderr: ${r.stderr}`
  );
});

test('T-04-S4-elem2: BF-06 abort stderr contains block_id [RED until T-17 — verify format]', () => {
  const originalContent = '# Original content for elem2';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir } = createFixture('s4-elem2', {
    sourceContent: '# New source',
    targetContent: '# Manually edited for elem2',
    anchorSha: originalSha
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);

  assert.ok(r.status !== 0, `T-04-S4-elem2: Expected non-zero exit for BF-06 abort. Got ${r.status}.`);

  // AC-19 element 2: block_id in stderr
  assert.ok(
    r.stderr.includes('bf06-block'),
    `T-04-S4-elem2: Expected block_id "bf06-block" in stderr.\nstderr: ${r.stderr}`
  );
});

test('T-04-S4-elem3: BF-06 abort stderr contains "Expected:" sha256 label [RED until T-17]', () => {
  const originalContent = '# Original content for elem3';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir } = createFixture('s4-elem3', {
    sourceContent: '# New source',
    targetContent: '# Manually edited for elem3',
    anchorSha: originalSha
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);

  assert.ok(r.status !== 0, `T-04-S4-elem3: Expected non-zero exit for BF-06 abort. Got ${r.status}.`);

  // AC-19 element 3: "Expected:" label (not "expected_sha256:")
  // [RED until T-17: current format emits "expected_sha256:" not "Expected:"]
  assert.ok(
    r.stderr.includes('Expected:'),
    `T-04-S4-elem3: Expected "Expected:" label in stderr (AC-19 format).\n` +
    `[RED: T-17 must change label from "expected_sha256:" to "Expected:"]\nstderr: ${r.stderr}`
  );

  // Also verify the expected sha value appears in stderr
  assert.ok(
    r.stderr.includes(originalSha),
    `T-04-S4-elem3: Expected sha256 value "${originalSha.slice(0, 16)}..." in stderr.\nstderr: ${r.stderr}`
  );
});

test('T-04-S4-elem4: BF-06 abort stderr contains "Actual:" sha256 label [RED until T-17]', () => {
  const tamperedContent = '# Manually edited for elem4';
  const tamperedSha = computeBlockSha256(tamperedContent);
  const originalContent = '# Original content for elem4';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir } = createFixture('s4-elem4', {
    sourceContent: '# New source',
    targetContent: tamperedContent,
    anchorSha: originalSha  // attr sha = original, actual = tampered
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);

  assert.ok(r.status !== 0, `T-04-S4-elem4: Expected non-zero exit for BF-06 abort. Got ${r.status}.`);

  // AC-19 element 4: "Actual:" label (not "actual_sha256:")
  // [RED until T-17: current format emits "actual_sha256:" not "Actual:"]
  assert.ok(
    r.stderr.includes('Actual:'),
    `T-04-S4-elem4: Expected "Actual:" label in stderr (AC-19 format).\n` +
    `[RED: T-17 must change label from "actual_sha256:" to "Actual:"]\nstderr: ${r.stderr}`
  );

  // Also verify the actual sha value appears in stderr
  assert.ok(
    r.stderr.includes(tamperedSha),
    `T-04-S4-elem4: Expected actual sha256 value "${tamperedSha.slice(0, 16)}..." in stderr.\nstderr: ${r.stderr}`
  );
});

test('T-04-S4-elem5: BF-06 abort stderr contains recovery hint (soma rollback / --allow-local-edits / re-extract) [RED until T-17]', () => {
  const originalContent = '# Original content for elem5';
  const originalSha = computeBlockSha256(originalContent);
  const { somaDir } = createFixture('s4-elem5', {
    sourceContent: '# New source',
    targetContent: '# Manually edited for elem5',
    anchorSha: originalSha
  });

  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);

  assert.ok(r.status !== 0, `T-04-S4-elem5: Expected non-zero exit for BF-06 abort. Got ${r.status}.`);

  // AC-19 element 5: recovery hint must name at least one of:
  //   "soma rollback", "--allow-local-edits", "re-extract"
  // Note: "force-resync" REMOVED in v2.2.0 — "--allow-local-edits" is the legitimate override flag.
  // [RED until T-17: current format has "resolution:" field with partial guidance but lacks these exact keywords]
  const hasRecoveryHint =
    r.stderr.includes('soma rollback') ||
    r.stderr.includes('--allow-local-edits') ||
    r.stderr.includes('re-extract');

  assert.ok(
    hasRecoveryHint,
    `T-04-S4-elem5: Expected recovery hint containing "soma rollback", "--allow-local-edits", or "re-extract" in stderr.\n` +
    `[RED: T-17 must add AC-19 recovery options to BF-06 abort message]\nstderr: ${r.stderr}`
  );
});
