'use strict';
/**
 * phase5-e2e.test.cjs — T-15: Phase 5 E2E full sync→rollback lifecycle
 *
 * Tests the complete SOMA sync→conflict→rollback→re-apply cycle on a
 * synthetic /tmp fixture. Uses soma.cjs dispatcher (T-14) for all commands.
 *
 * Article II HARD: RED phase — tests fail until soma.cjs + full infra is wired.
 * Article III HARD: real fs in /tmp/soma-v2-test/<random>/. Zero mocks.
 * Article IV HARD: Evidence logged per apply step (SOMA_EMIT_EVIDENCE=1).
 * Sandbox HARD: SOMA_SAFE_PATHS_ONLY=1 in ALL test invocations.
 *
 * 7 lifecycle steps — each is a separate sub-test.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-13]
 * @task T-15
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SOMA_CLI = path.join(SOMA_HOME, 'scripts', 'soma.cjs');

// ── Sandbox env ────────────────────────────────────────────────────────────────

const BASE_ENV = {
  ...process.env,
  SOMA_SAFE_PATHS_ONLY: '1',
  SOMA_EMIT_EVIDENCE:   '1',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sha256Str(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Run the soma CLI dispatcher.
 * @param {string[]} args
 * @param {object} envOverrides optional extra env vars
 * @returns spawnSync result
 */
function runSoma(args = [], envOverrides = {}) {
  return spawnSync('node', [SOMA_CLI, ...args], {
    env: { ...BASE_ENV, ...envOverrides },
    encoding: 'utf8',
    timeout: 30000,
  });
}

/**
 * Parse multi-line stdout where each line (or block of lines) may be
 * independent JSON objects (evidence line + main result, each as single-line
 * or pretty-printed JSON). Returns array of parsed objects.
 *
 * Strategy: try to parse each line individually first (single-line JSON).
 * For pretty-printed multi-line JSON, accumulate lines until we get a
 * parseable complete object (brace-depth tracking).
 */
function parseMultilineJson(stdout) {
  if (!stdout || !stdout.trim()) return [];

  const results = [];
  let buffer = '';
  let depth = 0;

  for (const line of stdout.split('\n')) {
    buffer += (buffer ? '\n' : '') + line;

    // Track brace/bracket depth to detect complete JSON objects
    for (const ch of line) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }

    if (depth <= 0 && buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        results.push(parsed);
        buffer = '';
        depth = 0;
      } catch (_) {
        // Not complete yet — or invalid; try next line
        if (depth <= 0) {
          // Depth is 0 but didn't parse — reset buffer for next JSON value
          buffer = '';
          depth = 0;
        }
      }
    }
  }

  // Try to parse any remaining buffer
  if (buffer.trim()) {
    try { results.push(JSON.parse(buffer.trim())); } catch (_) {}
  }

  return results;
}

// ── Fixture factory ────────────────────────────────────────────────────────────

/**
 * Create a minimal synthetic SOMA home under /tmp/soma-v2-test/ for sandbox.
 *
 * Structure:
 *   <dir>/
 *     manifest.json
 *     docs/
 *       claude-source.md       (source doc with anchored block)
 *     adapters/claude/
 *       install-targets.json
 *   <targetFile> at /tmp/soma-v2-test/<suffix>/CLAUDE.md
 *
 * The block content is:
 *   # SOMA Bootloader (managed by soma sync)
 *   Hello from the source block.
 *
 * @returns {{ somaDir, targetFile, blockContent, blockId }}
 */
function createE2EFixture() {
  const suffix = crypto.randomBytes(6).toString('hex');
  // somaDir MUST be under /tmp/soma-v2-test/ for sandbox compliance
  const somaDir = `/tmp/soma-v2-test/e2e-${suffix}`;
  const targetFile = path.join(somaDir, 'targets', 'CLAUDE.md');

  fs.mkdirSync(path.join(somaDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'claude'), { recursive: true });
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });

  // manifest.json
  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1',
    version: '2.1.0-e2e-test',
    files: []
  }));

  // Source doc with anchored block
  const blockId = 'block.claude.CLAUDE_md.cbm';
  // NOTE: extractBlock strips trailing newline — blockContent must NOT have trailing \n
  const blockContent = '# SOMA Bootloader (managed by soma sync)\nHello from the source block.';
  const sourceDoc = `<!-- soma-v2:start id=${blockId} version=1.0 -->\n${blockContent}\n<!-- soma-v2:end id=${blockId} -->`;
  fs.writeFileSync(path.join(somaDir, 'docs', 'claude-source.md'), sourceDoc);

  // Target file — starts as plain markdown (no block yet — INSERT scenario)
  const initialContent = '# Claude CLAUDE.md\nExisting content before sync.\n';
  fs.writeFileSync(targetFile, initialContent);

  // install-targets.json for claude adapter
  // wrapper_section + position_before are optional (use defaults from sync.cjs TOOL_DEFAULTS.claude)
  fs.writeFileSync(path.join(somaDir, 'adapters', 'claude', 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'claude',
    entries: [
      {
        block_id:        blockId,
        source_doc:      'docs/claude-source.md',
        target_path:     targetFile,
        target_anchor_id: blockId,
      }
    ]
  }));

  return { somaDir, targetFile, blockContent, blockId, initialContent };
}

// ── Shared state (populated across steps) ────────────────────────────────────

let state = {};

// ── Lifecycle test ─────────────────────────────────────────────────────────────

test('Phase 5 E2E — full sync→rollback lifecycle', async (t) => {

  // Create fixture fresh for this run
  const { somaDir, targetFile, blockContent, blockId, initialContent } = createE2EFixture();
  state = { somaDir, targetFile, blockContent, blockId, initialContent };

  // ── Step 1: Initial dry-run preview ──────────────────────────────────────

  await t.test('Step 1: dry-run preview exits 0 or 1 (findings), no writes, JSON has insert action', () => {
    const r = runSoma(['sync', '--dry-run', `--soma-home=${somaDir}`, '--tool=claude', '--json']);
    // sync.cjs exits 1 when there are actionable findings in dry-run mode (by spec).
    // Exit 0 means everything in sync. Both are valid — we test for "not exit 2" (error).
    assert.ok(
      r.status === 0 || r.status === 1,
      `Step 1: Expected exit 0 or 1, got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`
    );

    // Assert no writes: fixture sha256 unchanged
    const postSha = sha256File(targetFile);
    const preSha  = sha256Str(initialContent);
    assert.equal(postSha, preSha, `Step 1: Dry-run must not modify target. Post-sha: ${postSha}`);

    // Assert JSON output has by_action.insert ≥ 1 (we have an INSERT action)
    const parsed = parseMultilineJson(r.stdout);
    assert.ok(parsed.length >= 1, `Step 1: Expected JSON output. Got: ${r.stdout}`);
    // Find main result (not an evidence line)
    const mainResult = parsed.find(p => !p.event) || parsed[parsed.length - 1];
    const insertCount = mainResult.by_action?.insert ?? mainResult.summary?.by_action?.insert ?? 0;
    assert.ok(
      insertCount >= 1,
      `Step 1: Expected by_action.insert >= 1. Got: ${JSON.stringify(mainResult)}`
    );

    console.log(JSON.stringify({ step: 1, status: 'pass', dry_run_insert_count: insertCount }));
  });

  // ── Step 2: Apply with snapshot creation ────────────────────────────────

  await t.test('Step 2: apply exits 0, snapshot created, manifest schema correct, evidence emitted', () => {
    const r = runSoma(['sync', '--apply', `--soma-home=${somaDir}`, '--tool=claude', '--json']);
    assert.equal(r.status, 0, `Step 2: Expected exit 0, got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // Parse multi-line output (evidence line + main result)
    const parsed = parseMultilineJson(r.stdout);
    assert.ok(parsed.length >= 1, `Step 2: Expected at least 1 JSON line. Got: ${r.stdout}`);

    // Find main result: the sync-apply result (not the evidence line)
    const mainResult = parsed.find(p => p.schema === 'soma-sync-apply/v1') || parsed.find(p => !p.event) || parsed[parsed.length - 1];
    assert.ok(mainResult.snapshot, `Step 2: Expected snapshot object in result. Got: ${JSON.stringify(mainResult)}`);

    // snapshot.path is the snapDir (per sync.cjs snapshotOut schema)
    const snapDir = mainResult.snapshot?.path || mainResult.snapshot?.snap_dir || mainResult.snapshot?.snapDir;
    assert.ok(snapDir, `Step 2: Expected path in snapshot. Got: ${JSON.stringify(mainResult.snapshot)}`);
    assert.ok(fs.existsSync(snapDir), `Step 2: Snapshot dir must exist: ${snapDir}`);

    // Manifest schema check
    const manifestPath = path.join(snapDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), `Step 2: manifest.json must exist at ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schema, 'soma-snapshot-manifest/v1', `Step 2: Expected schema soma-snapshot-manifest/v1. Got: ${manifest.schema}`);
    // BF-08 check: entries have absolute_path field
    const entries = manifest.entries || [];
    assert.ok(entries.length >= 1, `Step 2: Manifest must have ≥1 entry`);
    for (const entry of entries) {
      assert.ok(entry.absolute_path, `Step 2: Each manifest entry must have absolute_path. Got: ${JSON.stringify(entry)}`);
    }

    // Evidence line check (Article IV)
    const evidenceLines = parsed.filter(p => p.event === 'soma_apply_evidence');
    assert.ok(evidenceLines.length >= 1, `Step 2: Expected soma_apply_evidence in output. Got: ${r.stdout}`);
    const evidence = evidenceLines[0];
    assert.ok(evidence.snapshot_path, `Step 2: Evidence must have snapshot_path`);
    assert.ok(evidence.manifest_sha256, `Step 2: Evidence must have manifest_sha256`);
    assert.ok(evidence.post_write_sha256, `Step 2: Evidence must have post_write_sha256`);

    // Capture snapshot_id (= timestamp field) for rollback in step 6
    // sync.cjs snapshotOut has: { timestamp, path, manifest_path, files_count, total_bytes }
    // rollback uses --snapshot-id=<timestamp> to find the dir: snapshotsBase/<timestamp>
    state.capturedSnapshotId = mainResult.snapshot?.timestamp || mainResult.snapshot?.snapshot_id;
    state.capturedSnapDir    = snapDir;
    state.postApplySha       = sha256File(targetFile);

    console.log(JSON.stringify({
      step: 2,
      status: 'pass',
      snapshot_path:    evidence.snapshot_path,
      manifest_sha256:  evidence.manifest_sha256,
      post_write_sha256: evidence.post_write_sha256,
      snapshot_id:      state.capturedSnapshotId,
    }));
  });

  // ── Step 3: Verify anchored blocks injected ──────────────────────────────

  await t.test('Step 3: target file contains soma-v2 anchor markers with correct sha256', () => {
    const content = fs.readFileSync(state.targetFile, 'utf8');

    // Assert start marker
    assert.ok(
      content.includes(`<!-- soma-v2:start id=${state.blockId}`),
      `Step 3: Expected start anchor in target. Got content snippet: ${content.slice(0, 500)}`
    );

    // Assert end marker
    assert.ok(
      content.includes(`<!-- soma-v2:end`),
      `Step 3: Expected end anchor in target. Got content snippet: ${content.slice(0, 500)}`
    );

    // Assert sha256 attribute matches actual block content
    // Extract sha256 from anchor tag
    const shaMatch = content.match(/<!-- soma-v2:start id=[^ ]+ version=[^ ]+ sha256=([a-f0-9]+)/);
    assert.ok(shaMatch, `Step 3: Expected sha256 attr in anchor marker. Got: ${content.slice(0, 500)}`);
    const anchorSha = shaMatch[1];
    const expectedSha = sha256Str(state.blockContent);
    assert.equal(anchorSha, expectedSha, `Step 3: Anchor sha256 must match block content sha256. Anchor: ${anchorSha}, Expected: ${expectedSha}`);

    console.log(JSON.stringify({ step: 3, status: 'pass', anchor_sha256: anchorSha }));
  });

  // ── Step 4: Simulate user manual edit inside anchored block ─────────────

  await t.test('Step 4: manually edit content inside anchored block (preserve markers)', () => {
    const content = fs.readFileSync(state.targetFile, 'utf8');

    // Find the block and modify content inside it (replace block content)
    // We do a surgical edit: append " EDITED" to a line inside the block
    const startMarkerRegex = /<!-- soma-v2:start[^\n]*\n/;
    const endMarkerRegex   = /<!-- soma-v2:end[^\n]*/;

    assert.ok(startMarkerRegex.test(content), `Step 4: Start marker must be present`);
    assert.ok(endMarkerRegex.test(content),   `Step 4: End marker must be present`);

    // Replace block body (between start marker and end marker) with modified content
    const edited = content.replace(
      /(<!-- soma-v2:start[^\n]*\n)([\s\S]*?)(<!-- soma-v2:end)/,
      (_, startMarker, body, endMarker) => {
        const editedBody = body.replace(/Hello from the source block\./, 'Hello from the source block. EDITED');
        return startMarker + editedBody + endMarker;
      }
    );

    assert.notEqual(edited, content, `Step 4: Edited content must differ from original`);
    fs.writeFileSync(state.targetFile, edited);
    state.postEditSha = sha256File(state.targetFile);

    console.log(JSON.stringify({ step: 4, status: 'pass', post_edit_sha256: state.postEditSha }));
  });

  // ── Step 5: Re-apply detects BLOCK_CONFLICT + aborts ────────────────────

  await t.test('Step 5: re-apply with manual edit detects BLOCK_CONFLICT, exits 1, no writes', () => {
    const shaBeforeReApply = sha256File(state.targetFile);

    const r = runSoma(['sync', '--apply', `--soma-home=${state.somaDir}`, '--tool=claude', '--json']);
    assert.equal(r.status, 1, `Step 5: Expected exit 1 for BLOCK_CONFLICT. Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // Assert JSON contains BLOCK_CONFLICT error
    // Parse stdout and stderr separately to avoid JSON parse errors from concatenation
    const parsedStdout = parseMultilineJson(r.stdout);
    const parsedStderr = parseMultilineJson(r.stderr);
    const allParsed = [...parsedStdout, ...parsedStderr];
    const hasConflict = allParsed.some(p => p.error?.code === 'BLOCK_CONFLICT' || (typeof p.error === 'string' && p.error === 'BLOCK_CONFLICT'));
    // Also check raw strings for non-JSON mode
    const rawHasConflict = (r.stdout + r.stderr).includes('BLOCK_CONFLICT');
    assert.ok(
      hasConflict || rawHasConflict,
      `Step 5: Expected BLOCK_CONFLICT in output. stdout: ${r.stdout.slice(0, 500)}, stderr: ${r.stderr.slice(0, 500)}`
    );

    // Assert fixture file unchanged from step-4 state (no writes on abort)
    const shaAfterReApply = sha256File(state.targetFile);
    assert.equal(shaAfterReApply, shaBeforeReApply, `Step 5: File must be unchanged after conflict abort. Before: ${shaBeforeReApply}, After: ${shaAfterReApply}`);

    console.log(JSON.stringify({ step: 5, status: 'pass', conflict_detected: true, file_unchanged: shaAfterReApply === shaBeforeReApply }));
  });

  // ── Step 6: Rollback restores pre-step-2 state ──────────────────────────

  await t.test('Step 6: rollback restores snapshot → pre-step-2 original fixture sha256', () => {
    assert.ok(state.capturedSnapshotId, `Step 6: Must have captured snapshot_id from step 2. State: ${JSON.stringify(state)}`);

    const r = runSoma(['rollback', `--snapshot-id=${state.capturedSnapshotId}`, `--snapshot-base=${path.join(state.somaDir, '.snapshots')}`]);
    assert.equal(r.status, 0, `Step 6: Expected exit 0, got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // Parse rollback JSON (may have evidence line + main result)
    const parsed = parseMultilineJson(r.stdout);
    assert.ok(parsed.length >= 1, `Step 6: Expected JSON output. Got: ${r.stdout}`);
    const mainResult = parsed[parsed.length - 1];

    // files_restored[].match = true
    const filesRestored = mainResult.files_restored || [];
    assert.ok(filesRestored.length >= 1, `Step 6: Expected ≥1 file in files_restored. Got: ${JSON.stringify(mainResult)}`);
    for (const f of filesRestored) {
      assert.ok(f.match === true, `Step 6: files_restored[].match must be true. Got: ${JSON.stringify(f)}`);
    }

    // ROLLBACK SEMANTICS: snapshot was taken JUST BEFORE step 2's apply (pre-write).
    // So rollback restores to original pre-step-2 state (the initialContent sha256).
    const postRollbackSha = sha256File(state.targetFile);
    const originalSha = sha256Str(state.initialContent);
    assert.equal(
      postRollbackSha, originalSha,
      `Step 6: Post-rollback sha256 must match pre-step-2 original fixture sha256. ` +
      `Post-rollback: ${postRollbackSha}, Original: ${originalSha}`
    );

    // Evidence check (Article IV)
    const evidenceLines = parsed.filter(p => p.event === 'soma_rollback_evidence');
    // Note: SOMA_EMIT_EVIDENCE=1 is set, but rollback evidence may not have manifest_sha256 if it only logs what was restored
    if (evidenceLines.length > 0) {
      const evidence = evidenceLines[0];
      console.log(JSON.stringify({
        step: 6,
        status: 'pass',
        snapshot_path:    evidence.snapshot_path,
        manifest_sha256:  evidence.manifest_sha256,
        post_write_sha256: { [state.targetFile]: postRollbackSha },
        post_rollback_sha256: postRollbackSha,
        matches_original: postRollbackSha === originalSha,
      }));
    } else {
      console.log(JSON.stringify({
        step: 6,
        status: 'pass',
        post_rollback_sha256: postRollbackSha,
        matches_original: postRollbackSha === originalSha,
      }));
    }
  });

  // ── Step 7: Re-apply succeeds (no conflict after rollback) ──────────────

  await t.test('Step 7: re-apply after rollback exits 0 (fresh insert, no conflict)', () => {
    // After rollback, target is back to original state (no block inserted).
    // So sync --apply should succeed again as a fresh insert.
    const r = runSoma(['sync', '--apply', `--soma-home=${state.somaDir}`, '--tool=claude', '--json']);
    assert.equal(r.status, 0, `Step 7: Expected exit 0 for re-apply after rollback. Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // Article IV evidence check
    const parsed = parseMultilineJson(r.stdout);
    const evidenceLines = parsed.filter(p => p.event === 'soma_apply_evidence');
    if (evidenceLines.length > 0) {
      const evidence = evidenceLines[0];
      const postWriteSha = sha256File(state.targetFile);
      console.log(JSON.stringify({
        step: 7,
        status: 'pass',
        snapshot_path:    evidence.snapshot_path,
        manifest_sha256:  evidence.manifest_sha256,
        post_write_sha256: evidence.post_write_sha256,
      }));
    } else {
      const postWriteSha = sha256File(state.targetFile);
      console.log(JSON.stringify({ step: 7, status: 'pass', post_write_sha256: { [state.targetFile]: postWriteSha } }));
    }

    // Verify block was re-injected
    const content = fs.readFileSync(state.targetFile, 'utf8');
    assert.ok(
      content.includes(`<!-- soma-v2:start id=${state.blockId}`),
      `Step 7: After re-apply, target must have block injected again. Content: ${content.slice(0, 500)}`
    );
  });

});
