'use strict';
/**
 * issue-11-legacy-upgrade-handler.test.cjs
 * @spec Issue #11 / D-013-10
 *
 * Verifies that `sync --apply` upgrades legacy markers (<!-- shortname:start --> / <!-- shortname:end -->)
 * to the anchored soma-v2 format (<!-- soma-v2:start id=... version=1.0 sha256=HEX --> / <!-- soma-v2:end id=... -->).
 *
 * Previously: sync --apply reported "Already in sync. Nothing to apply." while doctor showed 2 drifts.
 * Root cause: computeEntryAction returned action:'drift' with message containing
 *   "lacks id/version/sha256 attributes" — the actionable filter only included
 *   drift with "manual edit detected", so legacy-upgrade drifts were silently skipped.
 *
 * Fix (D-013-10): extend actionable filter + write logic to handle legacy-upgrade drift.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function runSync(args, env = {}) {
  return spawnSync('node', [SYNC, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000
  });
}

/**
 * Create a sandbox fixture with a target file that has legacy markers (<!-- hyd-v2:start --> style).
 * The anchor_id is a full dotted id like 'block.codex.AGENTS.hyd-v2' — the legacy shortname is 'hyd-v2'.
 *
 * Structure:
 *   somaDir/manifest.json
 *   somaDir/docs/source.md  — source with soma-v2 anchored block (hyd-v2 content)
 *   somaDir/adapters/codex/install-targets.json
 *   targetFile              — target with legacy <!-- hyd-v2:start --> markers (NOT soma-v2 anchored)
 */
function createLegacyUpgradeFixture(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-issue11-'));

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0', files: []
  }));

  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const anchorId = opts.anchorId || 'block.codex.AGENTS.hyd-v2';
  const shortName = anchorId.split('.').pop(); // 'hyd-v2'

  // Source doc: anchored soma-v2 block with the new content
  const sourceContent = opts.sourceContent || '# HYD v2 Cognitive Discipline\n\nUse HYD v2 as default.';
  const sourceDocContent = [
    `<!-- soma-v2:start id=${anchorId} version=1.0 -->`,
    sourceContent,
    `<!-- soma-v2:end id=${anchorId} -->`
  ].join('\n');
  fs.writeFileSync(path.join(docsDir, 'source.md'), sourceDocContent);

  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });

  // Target file with LEGACY markers (no id/version/sha256 attributes)
  const legacyContent = opts.legacyContent || '# HYD v2 (legacy content, same as source)';
  const targetFile = path.join(dir, 'AGENTS.md');
  const targetInitial = [
    '# Agent Operating Rules',
    '',
    `<!-- ${shortName}:start -->`,
    legacyContent,
    `<!-- ${shortName}:end -->`,
    '',
    '# Other content'
  ].join('\n');
  fs.writeFileSync(targetFile, targetInitial);

  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'codex',
    entries: [{
      block_id: anchorId,
      source_doc: 'docs/source.md',
      target_path: targetFile,
      target_anchor_id: anchorId
    }]
  }));

  return { somaDir: dir, targetFile, anchorId, shortName, sourceContent };
}

// ─── RED tests — these should FAIL before the fix ───────────────────────────

test('issue-11: sync --apply on legacy markers exits 0', () => {
  const { somaDir } = createLegacyUpgradeFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test('issue-11: sync --apply upgrades legacy markers to anchored format (start marker)', () => {
  const { somaDir, targetFile, anchorId } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  // B2: assert full exact form including version=1.0 — absence of version breaks idempotency
  // (extractBlock would not classify block as anchored on next run without version attribute)
  const sha256Pattern = new RegExp(
    `<!-- soma-v2:start id=${anchorId.replace(/\./g, '\\.')} version=1\\.0 sha256=[0-9a-f]{64} -->`
  );
  assert.ok(
    sha256Pattern.test(content),
    `Expected anchored start marker with version=1.0 and sha256 in target. Got:\n${content}`
  );
});

test('issue-11: sync --apply upgrades legacy markers — end marker has anchored format', () => {
  const { somaDir, targetFile, anchorId } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  assert.ok(
    content.includes(`<!-- soma-v2:end id=${anchorId} -->`),
    `Expected anchored end marker in target. Got:\n${content}`
  );
});

test('issue-11: sync --apply upgrades legacy markers — start marker has version=1.0 and sha256 attribute', () => {
  const { somaDir, targetFile, anchorId } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  // B2: must include version=1.0 — a regression that drops 'version' would break idempotency
  assert.ok(
    /<!-- soma-v2:start id=[^\s]+ version=1\.0 sha256=[0-9a-f]{64} -->/.test(content),
    `Expected version=1.0 and sha256 attribute in start marker. Got:\n${content}`
  );
});

test('issue-11: sync --apply upgrades legacy markers — source content written into block', () => {
  const { somaDir, targetFile, sourceContent } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  assert.ok(
    content.includes(sourceContent),
    `Expected source block content in target after upgrade. Got:\n${content}`
  );
});

test('issue-11: sync --apply on legacy markers returns files_touched with 1 entry', () => {
  const { somaDir } = createLegacyUpgradeFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(
    out.summary.files_touched.length,
    1,
    `Expected 1 file touched, got ${out.summary.files_touched.length}: ${JSON.stringify(out.summary.files_touched)}`
  );
});

test('issue-11: sync --apply on legacy markers creates a snapshot', () => {
  const { somaDir } = createLegacyUpgradeFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot !== null, 'Expected snapshot to be created for legacy upgrade');
});

// ─── Idempotency — second apply must be noop ─────────────────────────────────

test('issue-11: idempotency — second sync --apply after upgrade is noop', () => {
  const { somaDir } = createLegacyUpgradeFixture();
  // First apply: upgrades legacy → anchored
  const r1 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r1.status, 0, `First apply failed: ${r1.stderr}`);
  // Second apply: must detect already-synced (anchored markers now match)
  const r2 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r2.status, 0, `Second apply failed: ${r2.stderr}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.snapshot, null, 'Second apply must be noop (no snapshot)');
  assert.equal(out2.summary.files_touched.length, 0, 'Second apply: files_touched must be empty');
});

// ─── Legacy markers with content different from source ────────────────────────

test('issue-11: upgrade handles legacy block with different content from source', () => {
  const { somaDir, targetFile, anchorId, sourceContent } = createLegacyUpgradeFixture({
    legacyContent: '# Old stale content from Phase 2'
  });
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  // After upgrade, content should be source content (not the old stale legacy content)
  assert.ok(content.includes(sourceContent),
    `After upgrade, target must contain source content. Got:\n${content}`);
  assert.ok(!content.includes('# Old stale content from Phase 2'),
    `After upgrade, target must NOT contain old legacy content. Got:\n${content}`);
});

// ─── Surrounding content preserved ───────────────────────────────────────────

test('issue-11: upgrade preserves surrounding file content outside the legacy block', () => {
  const { somaDir, targetFile } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  assert.ok(content.includes('# Agent Operating Rules'),
    `Surrounding content before block must be preserved. Got:\n${content}`);
  assert.ok(content.includes('# Other content'),
    `Surrounding content after block must be preserved. Got:\n${content}`);
});

// ─── B2: version=1.0 assertion (regression guard) ────────────────────────────

test('issue-11(B2): upgraded start marker contains exact version=1.0 attribute', () => {
  const { somaDir, targetFile, anchorId } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  // Full exact form: <!-- soma-v2:start id=<anchorId> version=1.0 sha256=<HEX> -->
  const expectedExact = new RegExp(
    `<!-- soma-v2:start id=${anchorId.replace(/\./g, '\\.')} version=1\\.0 sha256=[0-9a-f]{64} -->`
  );
  assert.ok(
    expectedExact.test(content),
    `Expected start marker with version=1.0 in exact form. Got:\n${content}`
  );
});

test('issue-11(B2): start marker regex includes version=1.0 requirement', () => {
  const { somaDir, targetFile } = createLegacyUpgradeFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const content = fs.readFileSync(targetFile, 'utf8');
  // Strict regex matching version=1.0 explicitly
  assert.ok(
    /<!-- soma-v2:start id=[^\s]+ version=1\.0 sha256=[0-9a-f]{64} -->/.test(content),
    `Expected start marker matching strict version=1.0 regex. Got:\n${content}`
  );
});

// ─── B1: orphan legacy start marker (no matching end) → detectLegacyParseError ─
//
// writeLegacyUpgrade is not exported for general use, but is available for testing
// via SOMA_TEST_EXPORTS=1. The orphan condition (start without end) cannot be
// triggered via the integration path because computeEntryAction routes orphans to
// 'insert' (extractBlock returns found:false when end marker is absent). B1's guard
// is defense-in-depth for future code paths or race conditions.

const SYNC_WITH_EXPORTS = path.join(os.homedir(), '.soma-v2', 'scripts', 'sync.cjs');
process.env.SOMA_TEST_EXPORTS = '1';
const { detectLegacyParseError, writeLegacyUpgrade } = require(SYNC_WITH_EXPORTS);
delete process.env.SOMA_TEST_EXPORTS;

test('issue-11(B1): detectLegacyParseError returns null when start+end both present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-b1-clean-'));
  const f = path.join(dir, 'target.md');
  fs.writeFileSync(f, '# header\n<!-- hyd-v2:start -->\n# content\n<!-- hyd-v2:end -->\n# footer\n');
  const result = detectLegacyParseError(f, 'hyd-v2');
  assert.equal(result, null, `Expected null (no error) for complete start+end pair. Got: ${result}`);
});

test('issue-11(B1): detectLegacyParseError returns LEGACY_UPGRADE_MALFORMED for orphan start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-b1-orphan-'));
  const f = path.join(dir, 'target.md');
  fs.writeFileSync(f, '# header\n<!-- hyd-v2:start -->\n# content\n# footer\n');  // no end
  const result = detectLegacyParseError(f, 'hyd-v2');
  assert.ok(result !== null, 'Expected error string for orphan start marker');
  assert.ok(result.startsWith('LEGACY_UPGRADE_MALFORMED'),
    `Expected LEGACY_UPGRADE_MALFORMED prefix. Got: ${result}`);
  assert.ok(result.includes('"hyd-v2"'),
    `Expected shortname in error message. Got: ${result}`);
});

test('issue-11(B1): writeLegacyUpgrade throws LEGACY_UPGRADE_MALFORMED for orphan and file is unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-b1-write-'));
  const f = path.join(dir, 'target.md');
  const orphanContent = '# header\n<!-- hyd-v2:start -->\n# content\n# footer\n';  // no end
  fs.writeFileSync(f, orphanContent);

  let threw = false;
  let errorMessage = '';
  try {
    writeLegacyUpgrade(f, 'block.codex.AGENTS.hyd-v2', '# New content');
  } catch (err) {
    threw = true;
    errorMessage = err.message;
  }

  assert.ok(threw, 'writeLegacyUpgrade must throw for orphan start marker');
  assert.ok(errorMessage.startsWith('LEGACY_UPGRADE_MALFORMED'),
    `Expected LEGACY_UPGRADE_MALFORMED error. Got: ${errorMessage}`);

  // File must be unchanged on disk (no write occurred)
  const contentAfter = fs.readFileSync(f, 'utf8');
  assert.equal(contentAfter, orphanContent,
    `File must be unchanged after orphan error. Got:\n${contentAfter}`);
});

// ─── C1: shortname collision (multiple legacy blocks) → reject ────────────────
//
// writeLegacyUpgrade is the enforcement point. computeEntryAction with multiple
// legacy start+end pairs would return 'drift' for the first match only (extractBlock
// stops at first found block), so the guard lives in the write path itself.

test('issue-11(C1): writeLegacyUpgrade throws LEGACY_UPGRADE_AMBIGUOUS for multiple same-shortname legacy blocks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-c1-'));
  const f = path.join(dir, 'AGENTS.md');
  const shortName = 'hyd-v2';
  const ambiguousContent = [
    '# Section A',
    `<!-- ${shortName}:start -->`,
    '# First block with hyd-v2',
    `<!-- ${shortName}:end -->`,
    '',
    '# Section B',
    `<!-- ${shortName}:start -->`,
    '# Second block also with hyd-v2',
    `<!-- ${shortName}:end -->`,
    ''
  ].join('\n');
  fs.writeFileSync(f, ambiguousContent);

  let threw = false;
  let errorMessage = '';
  try {
    writeLegacyUpgrade(f, 'block.codex.AGENTS.hyd-v2', '# New content');
  } catch (err) {
    threw = true;
    errorMessage = err.message;
  }

  assert.ok(threw, 'writeLegacyUpgrade must throw for ambiguous shortname collision');
  assert.ok(errorMessage.startsWith('LEGACY_UPGRADE_AMBIGUOUS'),
    `Expected LEGACY_UPGRADE_AMBIGUOUS error. Got: ${errorMessage}`);
  assert.ok(errorMessage.includes('"hyd-v2"'),
    `Expected shortname in ambiguity message. Got: ${errorMessage}`);

  // File must be unchanged on disk (no write occurred)
  const contentAfter = fs.readFileSync(f, 'utf8');
  assert.equal(contentAfter, ambiguousContent,
    `File must be unchanged after ambiguity error. Got:\n${contentAfter}`);
});

// ─── C3: snapshot files_count >= 1 assertion ─────────────────────────────────

test('issue-11(C3): snapshot files_count >= 1 (upgrade target is in snapshot)', () => {
  const { somaDir } = createLegacyUpgradeFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot !== null, 'Expected snapshot to be created for legacy upgrade');
  assert.ok(
    out.snapshot.files_count >= 1,
    `Expected snapshot files_count >= 1 (upgrade target must be in snapshot). Got: ${out.snapshot.files_count}`
  );
});
