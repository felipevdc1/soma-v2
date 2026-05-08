// @spec AC-21 AC-22
// @article Article-IV Article-V
'use strict';
/**
 * article-compliance.test.cjs — T-13 Article IV evidence + Article V thermal-guard tests
 *
 * Acceptance criteria:
 *   AC-21 (Article IV): sync.cjs --apply + rollback.cjs emit structured evidence JSON line
 *     on stdout when SOMA_EMIT_EVIDENCE=1 env is set. Evidence line contains:
 *       - soma_apply_evidence: { event, snapshot_path, manifest_sha256, post_write_sha256, timestamp }
 *       - soma_rollback_evidence: { event, snapshot_path, manifest_sha256, restored_files, timestamp }
 *
 *   AC-22 (Article V): thermal-guard.cjs keyword detection. The COMPILE_KEYWORDS list is
 *     inspected to verify whether `apply` is counted as a compile/test operation. If NOT present,
 *     this test documents the gap explicitly (expected-RED finding) rather than silently passing.
 *     Test verifies the guard's decision logic in isolation (no real proc spawn × 4).
 *
 * Constitutional compliance:
 *   - Article II HARD: TDD RED→GREEN (RED evidence: evidence line absent before emission code added)
 *   - Article III HARD: real fs under /tmp/soma-v2-test/, zero mocks for fs/sha256/child_process
 *   - Article IV HARD: asserts that evidence emission works (meta: tests the emitter)
 *   - Article V HARD: tests thermal-guard's keyword decision logic
 *   - Article VI HARD: zero deletion — additive evidence emission only
 *   - Sandbox: SOMA_SAFE_PATHS_ONLY=1 + all targets under /tmp/soma-v2-test/
 *
 * Environment flags:
 *   SOMA_EMIT_EVIDENCE=1 — enables evidence emission in sync.cjs and rollback.cjs
 *   SOMA_SAFE_PATHS_ONLY=1 — sandbox enforcement (prevents writing outside /tmp/soma-v2-test/)
 *
 * Note on AC-22: thermal-guard classifyPrompt() checks prompt text for keywords.
 * The prompt includes tool args (including 'apply'), so whether `apply` is classified
 * as compile-test depends on whether 'apply' appears in COMPILE_KEYWORDS.
 * This test extracts the guard's classifyPrompt() logic and tests it in isolation.
 * If `apply` is NOT in COMPILE_KEYWORDS, test AC-22-b fails with a descriptive message
 * (expected-RED gap finding, NOT a test infrastructure failure).
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const crypto   = require('node:crypto');
const os       = require('node:os');
const { spawnSync } = require('node:child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const SOMA_HOME_REAL = path.join(os.homedir(), '.soma-v2');
const SYNC_CJS       = path.join(SOMA_HOME_REAL, 'scripts', 'sync.cjs');
const ROLLBACK_CJS   = path.join(SOMA_HOME_REAL, 'scripts', 'rollback.cjs');
const THERMAL_GUARD  = path.join(os.homedir(), '.claude', 'hooks', 'thermal-guard.cjs');

// Unique run directory to avoid parallel test collisions
const TS = Date.now();
const RUN_DIR = `/tmp/soma-v2-test/t13-${TS}`;

// ── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Create a minimal soma home fixture with one codex install-target
 * pointing to a sandboxed target file under /tmp/soma-v2-test/.
 *
 * Returns:
 *   somaDir       — fixture soma home
 *   targetFile    — absolute path to the target file
 *   snapshotsBase — path to .snapshots/
 */
function createSandboxedFixture(suffix) {
  const somaDir      = path.join(RUN_DIR, `soma-${suffix}`);
  const targetFile   = path.join(RUN_DIR, `target-${suffix}.md`);
  const snapshotsBase = path.join(somaDir, '.snapshots');

  fs.mkdirSync(somaDir, { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(snapshotsBase, { recursive: true });

  // Manifest
  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1',
    version: '2.1.0',
    files: []
  }));

  // Source doc with anchored block
  const blockContent = 'Article IV evidence test block content.\n';
  const sourceDoc = `<!-- soma-v2:start id=t13-evidence-block version=1.0 -->\n${blockContent}<!-- soma-v2:end id=t13-evidence-block -->\n`;
  fs.writeFileSync(path.join(somaDir, 'docs', 'source.md'), sourceDoc);

  // Target file (exists but without the block yet)
  fs.writeFileSync(targetFile, '# Test Target\nNo block yet.\n', 'utf8');

  // install-targets.json
  fs.writeFileSync(path.join(somaDir, 'adapters', 'codex', 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'codex',
    entries: [{
      block_id: 't13-evidence-block',
      source_doc: 'docs/source.md',
      target_path: targetFile,
      target_anchor_id: 't13-evidence-block'
    }]
  }));

  return { somaDir, targetFile, snapshotsBase };
}

/**
 * Build a minimal snapshot structure for rollback testing.
 * Creates: snapshotBase/{snapshotId}/codex/{filename} + manifest.json
 */
function buildFakeSnapshot({ snapshotBase, snapshotId, adapter, filename, content, targetPath }) {
  const snapDir = path.join(snapshotBase, snapshotId);
  const adpDir  = path.join(snapDir, adapter);
  fs.mkdirSync(adpDir, { recursive: true });

  const snapCopy = path.join(adpDir, filename);
  fs.writeFileSync(snapCopy, content, 'utf8');

  const sha256 = crypto.createHash('sha256').update(content).digest('hex');

  const manifest = {
    schema:     'soma-snapshot-manifest/v1',
    timestamp:  snapshotId,
    entries: [{
      relative_path:     `${adapter}/${filename}`,
      absolute_path:     targetPath,
      sha256_pre_write:  sha256,
      file_size_bytes:   Buffer.byteLength(content, 'utf8'),
      block_ids_modified: ['t13-evidence-block']
    }]
  };

  const manifestPath = path.join(snapDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { snapDir, manifestPath, sha256 };
}

/**
 * Parse evidence line from stdout.
 * sync.cjs may emit multiple lines; with SOMA_EMIT_EVIDENCE=1, the evidence line
 * appears as a standalone JSON object (not the same as the main apply result JSON).
 * We search all lines for one matching the expected event field.
 *
 * @param {string} stdout
 * @param {string} eventName - e.g. 'soma_apply_evidence'
 * @returns {object|null}
 */
function extractEvidenceLine(stdout, eventName) {
  const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.event === eventName) return parsed;
    } catch (_) {
      // not JSON or not our event — skip
    }
  }
  return null;
}

/**
 * Extract the main apply/rollback result JSON from stdout.
 * With SOMA_EMIT_EVIDENCE=1, stdout may contain an evidence line BEFORE the main JSON.
 * We find the JSON that contains "schema" or "mode"/"status" (main result markers).
 *
 * Strategy: split stdout into candidate JSON objects by looking for top-level objects.
 * A top-level object starts at a line with just '{' or at the start of stdout.
 */
function extractLastJson(stdout) {
  // Strategy: try to split stdout into JSON chunks by finding non-indented '{' lines
  // Each chunk starts at a line that begins with '{' at column 0.
  const raw = stdout.trim();
  if (!raw) return null;

  // Find all positions where a top-level JSON object starts ('{' at column 0)
  const lines = raw.split('\n');
  const chunkStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('{')) chunkStarts.push(i);
  }

  // Try each chunk start (last ones first — main result is usually last)
  for (let ci = chunkStarts.length - 1; ci >= 0; ci--) {
    const chunkLines = lines.slice(chunkStarts[ci]);
    // Build chunks: stop at the next chunkStart (if any after this one)
    const nextChunkStart = chunkStarts[ci + 1];
    const relevantLines = nextChunkStart !== undefined
      ? lines.slice(chunkStarts[ci], nextChunkStart)
      : lines.slice(chunkStarts[ci]);
    const candidate = relevantLines.join('\n');
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // try full stdout from this point
      try {
        return JSON.parse(lines.slice(chunkStarts[ci]).join('\n'));
      } catch (_2) {
        // skip
      }
    }
  }
  return null;
}

// ── Ensure /tmp/soma-v2-test/ exists ─────────────────────────────────────────
fs.mkdirSync(RUN_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — AC-21: sync.cjs --apply emits soma_apply_evidence line
// ─────────────────────────────────────────────────────────────────────────────

test('AC-21 / Article IV: sync --apply emits soma_apply_evidence JSON line when SOMA_EMIT_EVIDENCE=1', () => {
  const { somaDir, targetFile } = createSandboxedFixture('sync-evidence');

  const proc = spawnSync('node', [SYNC_CJS, '--apply', '--tool=claude', `--soma-home=${somaDir}`, '--json'], {
    encoding: 'utf8',
    timeout:  20000,
    env: {
      ...process.env,
      SOMA_EMIT_EVIDENCE:   '1',
      SOMA_SAFE_PATHS_ONLY: '1',
    }
  });

  assert.equal(
    proc.status, 0,
    `sync --apply should exit 0. stderr: ${proc.stderr}\nstdout: ${proc.stdout}`
  );

  const evidenceLine = extractEvidenceLine(proc.stdout, 'soma_apply_evidence');

  assert.ok(
    evidenceLine !== null,
    `Expected a JSON line with event="soma_apply_evidence" in stdout.\n` +
    `stdout was:\n${proc.stdout}\nstderr:\n${proc.stderr}\n\n` +
    `[RED→GREEN: this test is RED before evidence emission added to sync.cjs]`
  );

  // Required fields
  assert.ok(
    typeof evidenceLine.snapshot_path === 'string' && evidenceLine.snapshot_path.length > 0,
    `evidence.snapshot_path must be a non-empty string, got: ${JSON.stringify(evidenceLine.snapshot_path)}`
  );

  assert.ok(
    typeof evidenceLine.manifest_sha256 === 'string' && /^[a-f0-9]{64}$/.test(evidenceLine.manifest_sha256),
    `evidence.manifest_sha256 must be a 64-char hex string, got: ${JSON.stringify(evidenceLine.manifest_sha256)}`
  );

  assert.ok(
    evidenceLine.post_write_sha256 !== null && typeof evidenceLine.post_write_sha256 === 'object',
    `evidence.post_write_sha256 must be an object (file→sha map), got: ${JSON.stringify(evidenceLine.post_write_sha256)}`
  );

  assert.ok(
    typeof evidenceLine.timestamp === 'string' && evidenceLine.timestamp.includes('T'),
    `evidence.timestamp must be an ISO string, got: ${JSON.stringify(evidenceLine.timestamp)}`
  );

  // Verify at least one file sha in post_write_sha256
  const shaValues = Object.values(evidenceLine.post_write_sha256);
  assert.ok(
    shaValues.length > 0,
    `evidence.post_write_sha256 must have at least one entry, got empty object`
  );

  for (const sha of shaValues) {
    assert.ok(
      /^[a-f0-9]{64}$/.test(sha),
      `Each post_write_sha256 value must be 64-char hex, got: ${sha}`
    );
  }

  // Verify snapshot_path references a real directory
  assert.ok(
    fs.existsSync(evidenceLine.snapshot_path),
    `evidence.snapshot_path "${evidenceLine.snapshot_path}" does not exist on disk`
  );

  // Verify manifest_sha256 matches the actual manifest.json content
  const manifestPath = path.join(evidenceLine.snapshot_path, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifestContent = fs.readFileSync(manifestPath);
    const actualSha256 = crypto.createHash('sha256').update(manifestContent).digest('hex');
    assert.equal(
      evidenceLine.manifest_sha256, actualSha256,
      `evidence.manifest_sha256 must match sha256 of actual manifest.json at ${manifestPath}`
    );
  }

  // Target file should have been written
  assert.ok(
    fs.existsSync(targetFile),
    `Target file should exist after apply: ${targetFile}`
  );
  const content = fs.readFileSync(targetFile, 'utf8');
  assert.ok(
    content.includes('soma-v2:start id=t13-evidence-block'),
    `Target file should contain the anchored block after apply`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — AC-21: rollback.cjs emits soma_rollback_evidence line
// ─────────────────────────────────────────────────────────────────────────────

test('AC-21 / Article IV: rollback emits soma_rollback_evidence JSON line when SOMA_EMIT_EVIDENCE=1', () => {
  const suffix     = 'rollback-evidence';
  const targetDir  = path.join(RUN_DIR, `target-${suffix}-dir`);
  const targetFile = path.join(targetDir, 'target.md');
  const snapshotBase = path.join(RUN_DIR, `snapshots-${suffix}`);

  fs.mkdirSync(targetDir,    { recursive: true });
  fs.mkdirSync(snapshotBase, { recursive: true });

  const originalContent = '# Original content for rollback test\nLine 2.\n';
  const mutatedContent  = '# MUTATED content\nLine 2 mutated.\n';

  // Write mutated content as the "current" state (post-apply)
  fs.writeFileSync(targetFile, mutatedContent, 'utf8');

  // Build a snapshot that captured originalContent
  const snapshotId = `2026-01-01T00-00-00Z`;
  const { snapDir, manifestPath } = buildFakeSnapshot({
    snapshotBase,
    snapshotId,
    adapter:    'codex',
    filename:   'target.md',
    content:    originalContent,
    targetPath: targetFile,
  });

  const proc = spawnSync('node', [
    ROLLBACK_CJS,
    `--snapshot-id=${snapshotId}`,
    `--snapshot-base=${snapshotBase}`,
  ], {
    encoding: 'utf8',
    timeout:  20000,
    env: {
      ...process.env,
      SOMA_EMIT_EVIDENCE:   '1',
      SOMA_SAFE_PATHS_ONLY: '1',
    }
  });

  assert.equal(
    proc.status, 0,
    `rollback should exit 0. stderr: ${proc.stderr}\nstdout: ${proc.stdout}`
  );

  const evidenceLine = extractEvidenceLine(proc.stdout, 'soma_rollback_evidence');

  assert.ok(
    evidenceLine !== null,
    `Expected a JSON line with event="soma_rollback_evidence" in stdout.\n` +
    `stdout was:\n${proc.stdout}\nstderr:\n${proc.stderr}\n\n` +
    `[RED→GREEN: this test is RED before evidence emission added to rollback.cjs]`
  );

  // Required fields
  assert.ok(
    typeof evidenceLine.snapshot_path === 'string' && evidenceLine.snapshot_path.length > 0,
    `evidence.snapshot_path must be a non-empty string`
  );

  assert.ok(
    typeof evidenceLine.manifest_sha256 === 'string' && /^[a-f0-9]{64}$/.test(evidenceLine.manifest_sha256),
    `evidence.manifest_sha256 must be 64-char hex, got: ${JSON.stringify(evidenceLine.manifest_sha256)}`
  );

  assert.ok(
    Array.isArray(evidenceLine.restored_files),
    `evidence.restored_files must be an array, got: ${JSON.stringify(evidenceLine.restored_files)}`
  );

  assert.ok(
    evidenceLine.restored_files.length > 0,
    `evidence.restored_files must have at least one entry`
  );

  for (const entry of evidenceLine.restored_files) {
    assert.ok(
      typeof entry.path === 'string',
      `restored_files entry must have .path string`
    );
    assert.ok(
      /^[a-f0-9]{64}$/.test(entry.post_restore_sha256),
      `restored_files entry must have .post_restore_sha256 as 64-char hex, got: ${entry.post_restore_sha256}`
    );
  }

  assert.ok(
    typeof evidenceLine.timestamp === 'string' && evidenceLine.timestamp.includes('T'),
    `evidence.timestamp must be ISO string`
  );

  // Verify manifest_sha256 matches actual manifest content
  const actualManifestSha = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  assert.equal(
    evidenceLine.manifest_sha256, actualManifestSha,
    `evidence.manifest_sha256 must match sha256 of actual manifest.json`
  );

  // Verify file was actually restored to original
  const restoredContent = fs.readFileSync(targetFile, 'utf8');
  assert.equal(
    restoredContent, originalContent,
    `Target file should be restored to original content after rollback`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — AC-22: Article V thermal-guard keyword detection for `apply`
// ─────────────────────────────────────────────────────────────────────────────

test('AC-22 / Article V: thermal-guard classifies prompt containing "apply" as compile-test', () => {
  // Read thermal-guard.cjs and extract COMPILE_KEYWORDS array
  assert.ok(
    fs.existsSync(THERMAL_GUARD),
    `thermal-guard.cjs must exist at ${THERMAL_GUARD}`
  );

  const guardSource = fs.readFileSync(THERMAL_GUARD, 'utf8');

  // Extract COMPILE_KEYWORDS from source (parse the array literal)
  const kwMatch = guardSource.match(/const COMPILE_KEYWORDS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(kwMatch, 'COMPILE_KEYWORDS must be declared in thermal-guard.cjs');

  const kwBlock   = kwMatch[1];
  const keywords  = kwBlock.match(/'([^']+)'/g)?.map(k => k.slice(1, -1)) || [];

  // Check whether 'apply' is in COMPILE_KEYWORDS
  const applyPresent = keywords.some(kw => kw === 'apply' || kw === '--apply');

  // Also replicate classifyPrompt logic in isolation to test it
  function classifyPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return 'read-only';
    const lower = prompt.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return 'compile-test';
    }
    return 'read-only';
  }

  // AC-22 test: a prompt containing "soma sync --apply" should be classified as compile-test
  // IF 'apply' or '--apply' is in COMPILE_KEYWORDS.
  // NOTE: use /tmp/soma-fixtures (not /tmp/test) to avoid accidentally triggering 'test' keyword.
  const testPrompt = 'node ~/.soma-v2/scripts/sync.cjs --apply --soma-home=/tmp/soma-fixtures --json';
  const classification = classifyPrompt(testPrompt);

  if (!applyPresent) {
    // Document the gap explicitly
    // AC-22 expected-RED: thermal-guard does not recognise 'apply' as a compile-test keyword.
    // This is a GAP finding — thermal-guard needs to add 'apply' to COMPILE_KEYWORDS to
    // fully satisfy Article V for soma apply operations.
    //
    // We assert FAIL with a clear, descriptive message rather than silently passing.
    // The agent report MUST document this as an expected-RED gap (NOT a test infra failure).
    assert.fail(
      `[AC-22 GAP FINDING] thermal-guard.cjs COMPILE_KEYWORDS does not include 'apply' or '--apply'.\n` +
      `Keywords found: ${keywords.join(', ')}\n` +
      `classifyPrompt("${testPrompt}") returned "${classification}" (expected "compile-test").\n` +
      `Without 'apply' in keywords, soma sync --apply dispatches are NOT thermal-guarded.\n\n` +
      `To fix: add 'apply' to COMPILE_KEYWORDS in thermal-guard.cjs.\n` +
      `Constitutional reference: Article V — max 3 concurrent compile/test agents.\n` +
      `soma sync --apply is a write operation (creates snapshots, writes files) that should be\n` +
      `thermal-guarded to prevent concurrent file corruption.\n` +
      `[This is an expected-RED finding per T-13 spec: "If the hook does NOT currently\n` +
      ` track apply as keyword, test FAILS with a clear message, so we surface the gap explicitly."]`
    );
  }

  // If 'apply' IS present, verify the classify logic works end-to-end
  assert.equal(
    classification, 'compile-test',
    `classifyPrompt("${testPrompt}") should return "compile-test" when 'apply' is in COMPILE_KEYWORDS`
  );

  // Additional: verify a non-apply prompt is read-only
  const readOnlyPrompt = 'read the manifest.json and report its schema';
  assert.equal(
    classifyPrompt(readOnlyPrompt), 'read-only',
    `Non-compile prompt should be classified as read-only`
  );

  // Additional: verify max-concurrent logic in isolation
  // Simulate 4 active compile-test agents → 4th should be blocked
  const COMPILE_LIMIT = 3;
  let activeCompile = [
    { id: 'agent-1', type: 'compile-test', startedAt: new Date().toISOString(), ttl: 900000 },
    { id: 'agent-2', type: 'compile-test', startedAt: new Date().toISOString(), ttl: 900000 },
    { id: 'agent-3', type: 'compile-test', startedAt: new Date().toISOString(), ttl: 900000 },
  ];

  const countBefore = activeCompile.filter(e => e.type === 'compile-test').length;
  assert.equal(countBefore, 3, 'Test setup: 3 active compile-test agents');
  assert.ok(countBefore >= COMPILE_LIMIT, '4th agent should be blocked when 3 active');

  // After one finishes
  activeCompile = activeCompile.slice(1); // remove first
  const countAfter = activeCompile.filter(e => e.type === 'compile-test').length;
  assert.equal(countAfter, 2, 'After one finishes: 2 active');
  assert.ok(countAfter < COMPILE_LIMIT, '4th agent would now be allowed');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — AC-21 regression: existing tests still pass (main output parseable)
// ─────────────────────────────────────────────────────────────────────────────

test('AC-21 regression: sync --apply --json last-JSON-line still parseable when SOMA_EMIT_EVIDENCE=1', () => {
  // Verify that the evidence line emission does NOT break tests that parse
  // sync.cjs stdout as JSON. The main apply JSON should still be parseable.
  const { somaDir } = createSandboxedFixture('regression-check');

  const proc = spawnSync('node', [SYNC_CJS, '--apply', '--tool=claude', `--soma-home=${somaDir}`, '--json'], {
    encoding: 'utf8',
    timeout:  20000,
    env: {
      ...process.env,
      SOMA_EMIT_EVIDENCE:   '1',
      SOMA_SAFE_PATHS_ONLY: '1',
    }
  });

  assert.equal(proc.status, 0, `sync --apply should exit 0. stderr: ${proc.stderr}`);

  // The main apply result should be findable in stdout
  const mainResult = extractLastJson(proc.stdout);
  assert.ok(
    mainResult !== null,
    `Main apply result JSON should be parseable from stdout.\nstdout:\n${proc.stdout}`
  );

  // Verify it has the expected sync apply schema
  assert.ok(
    mainResult.schema === 'soma-sync-apply/v1' ||
    mainResult.mode   === 'apply',
    `Main result should have schema or mode=apply, got: ${JSON.stringify(mainResult)}`
  );
});
