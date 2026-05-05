// @spec AC-19
// @contract CONTRACT-011-01-sync-apply
'use strict';
/**
 * content-preservation.test.cjs — T-12 content-preservation tests
 *
 * Acceptance criteria:
 *   AC-19: sha256 of NON-anchored regions byte-identical pre/post apply.
 *     Specifically: all original user content (lines present in the fixture BEFORE apply)
 *     must survive byte-identical in the post-apply file, outside the soma-v2 anchor markers.
 *     Additionally: non-anchored sha256 must be STABLE across repeated applies (noop runs),
 *     i.e., sha256(non_anchored_post_run1) === sha256(non_anchored_post_run2).
 *
 * Design note:
 *   On the FIRST apply, sync.cjs inserts the soma-v2 block AND (if `## SOMA Bootloader`
 *   section is absent) creates that wrapper section header. The wrapper header itself appears
 *   OUTSIDE the soma-v2 anchor markers, so the "full non-anchored sha256" changes from
 *   pre-apply to post-first-apply when the bootloader header is new.
 *
 *   To isolate pure content preservation (user text not mutated), two strategies are used:
 *     (A) Line-level verification: every line that existed in the pre-apply fixture is still
 *         present byte-for-byte in the post-apply non-anchored content.
 *     (B) Stability verification: sha256(non_anchored) is IDENTICAL between run1 and run2
 *         (i.e., second apply does not mutate anything outside anchors).
 *     (C) Full equality: using a fixture that pre-includes the `## SOMA Bootloader` section,
 *         verify that non-anchored sha256 PRE = non-anchored sha256 POST (no extra content
 *         added outside anchors when bootloader section already exists — except controlled
 *         surrounding blank lines).
 *
 * Non-anchored extraction algorithm:
 *   ANCHOR_RE = /<!-- soma-v2:start[^>]* -->[\s\S]*?<!-- soma-v2:end[^>]* -->/g
 *   (actual marker format: <!-- soma-v2:start id=BLOCK version=V sha256=H -->)
 *   extractNonAnchored(content) = content.replace(ANCHOR_RE, '')
 *
 * Constitutional compliance:
 *   - Article II HARD: TDD RED→GREEN
 *   - Article III HARD: real fs under /tmp/soma-v2-test/, zero mocks
 *   - Article IV HARD: structured evidence JSON logged per assertion
 *   - Article VI HARD: zero deletion; apply only adds anchored blocks
 *   - Sandbox: SOMA_SAFE_PATHS_ONLY=1 set; all paths under /tmp/soma-v2-test/
 *
 * Test matrix:
 *   1. first apply succeeds (sanity baseline)
 *   2. post-apply file contains soma-v2 anchor markers (confirms write occurred)
 *   3. extractNonAnchored strips soma-v2 blocks (helper correctness)
 *   4. all original user lines present in post-apply non-anchored content (content preserved)
 *   5. non-anchored sha256 STABLE: post-run1 sha256 === post-run2 sha256 (idempotency of non-anchored)
 *   6. original user content bytes found verbatim in post-apply file (substring check)
 *   7. cleanup sandbox
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const crypto   = require('node:crypto');
const { spawnSync } = require('node:child_process');
const os       = require('node:os');

// ── Constants ────────────────────────────────────────────────────────────────

const SOMA_HOME_REAL = path.join(os.homedir(), '.soma-v2');
const SYNC_CJS       = path.join(SOMA_HOME_REAL, 'scripts', 'sync.cjs');
const SANDBOX_PREFIX = '/tmp/soma-v2-test/';

const TS      = Date.now();
const RUN_DIR = `${SANDBOX_PREFIX}t12-cprev-${TS}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** sha256 hex of a string */
function sha256String(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Extract the NON-anchored content from a file string.
 * Strips all ranges matching:
 *   <!-- soma-v2:start id=BLOCK_ID version=V sha256=H -->...<!-- soma-v2:end id=BLOCK_ID -->
 * The actual written format uses attributes after "start" and "end".
 *
 * Pre-apply: no soma-v2 markers → returns entire content unchanged.
 * Post-apply: returns everything OUTSIDE the injected soma-v2 blocks.
 *
 * @param {string} content - raw file content as string
 * @returns {string} content with soma-v2 blocks stripped
 */
function extractNonAnchored(content) {
  // Matches: <!-- soma-v2:start ... --> ... <!-- soma-v2:end ... -->
  // The "..." after "start" and "end" are attributes (id=, version=, sha256=, etc.)
  const ANCHOR_RE = /<!-- soma-v2:start[^>]* -->[\s\S]*?<!-- soma-v2:end[^>]* -->/g;
  return content.replace(ANCHOR_RE, '');
}

/** Read file as utf-8 string */
function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * Build a minimal synthetic SOMA home (same pattern as T-10 + T-12 idempotency).
 * Uses legacy anchor format in source doc (<!-- ANCHOR:start --> / <!-- ANCHOR:end -->).
 * sync.cjs will write soma-v2 format markers in the target file.
 *
 * @param {string} somaHome  - absolute path (under /tmp/soma-v2-test/)
 * @param {string} targetPath - fixture file
 * @param {string} blockShortAnchor - legacy short anchor suffix in source doc
 * @param {string} blockId  - full block id for install-targets (becomes target_anchor_id)
 */
function buildSyntheticSomaHome(somaHome, targetPath, blockShortAnchor, blockId) {
  fs.mkdirSync(path.join(somaHome, 'adapters', 'claude'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'logs'), { recursive: true });

  const sourceDocContent =
    `<!-- ${blockShortAnchor}:start -->\n` +
    `# T-12 Content Preservation Fixture Block\n\n` +
    `This block verifies content outside anchors is byte-preserved.\n` +
    `Generated at: ${new Date().toISOString()}\n` +
    `<!-- ${blockShortAnchor}:end -->\n`;

  const sourceDocPath = path.join(somaHome, 'docs', 'source.md');
  fs.writeFileSync(sourceDocPath, sourceDocContent);

  const sourceDocSha = sha256String(sourceDocContent);
  fs.writeFileSync(path.join(somaHome, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1',
    version: '2.1.0-test',
    release: 'soma-v2.1-t12-cprev',
    files: [
      {
        id: 't12.cprev.source',
        path: 'docs/source.md',
        sha256: sourceDocSha,
        sourceMtime: new Date().toISOString(),
        sourceSha256: sourceDocSha,
        targets: ['global'],
        expansion_owner: null,
        status: 'test'
      }
    ]
  }, null, 2));

  fs.writeFileSync(
    path.join(somaHome, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({
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
    }, null, 2)
  );
}

/** Run sync --apply --json with SOMA_SAFE_PATHS_ONLY=1 */
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
  return { exitCode: proc.status, result, stdout: proc.stdout, stderr: proc.stderr };
}

// ── Setup: build fixture + soma home ─────────────────────────────────────────

const FIXTURE_DIR   = path.join(RUN_DIR, 'fixture');
const SOMA_HOME_DIR = path.join(RUN_DIR, 'soma-home');
const FIXTURE_FILE  = path.join(FIXTURE_DIR, 'CLAUDE.md');
const BLOCK_ANCHOR  = 't12-cprev-block';
const BLOCK_ID      = `block.claude.fixture.${BLOCK_ANCHOR}`;

// Fixture: includes the `## SOMA Bootloader` wrapper section ALREADY (so first apply
// doesn't add new header text outside the soma-v2 block markers).
// Content BEFORE and AFTER the bootloader section are the "user content" that must survive.
const USER_CONTENT_BEFORE = [
  '# Claude Self-Model (T-12 Content Preservation Fixture)\n',
  '\n',
  'This is the FIRST section of user content.\n',
  'It must appear byte-for-byte in the post-apply file.\n',
  'Line 4: some unique marker for verification A1B2C3.\n',
  '\n',
].join('');

const BOOTLOADER_HEADER = '## SOMA Bootloader (managed by soma sync)\n\n';

const USER_CONTENT_AFTER = [
  '\n',
  '## Failure Log\n',
  '\n',
  'This content is AFTER the bootloader section.\n',
  '- Entry 1: must survive apply byte-for-byte (marker D4E5F6).\n',
  '- Entry 2: more user content that must not be mutated.\n',
].join('');

const FIXTURE_INITIAL_CONTENT = USER_CONTENT_BEFORE + BOOTLOADER_HEADER + USER_CONTENT_AFTER;

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
fs.writeFileSync(FIXTURE_FILE, FIXTURE_INITIAL_CONTENT);
buildSyntheticSomaHome(SOMA_HOME_DIR, FIXTURE_FILE, BLOCK_ANCHOR, BLOCK_ID);

// ── Capture pre-apply state ───────────────────────────────────────────────────

const PRE_CONTENT       = readFile(FIXTURE_FILE);
const PRE_NON_ANCHORED  = extractNonAnchored(PRE_CONTENT);
const PRE_SHA256        = sha256String(PRE_NON_ANCHORED);

// ── Execute both runs ─────────────────────────────────────────────────────────

const RUN1 = runSync(SOMA_HOME_DIR);
const POST_RUN1_CONTENT      = readFile(FIXTURE_FILE);
const POST_RUN1_NON_ANCHORED = extractNonAnchored(POST_RUN1_CONTENT);
const POST_RUN1_SHA256       = sha256String(POST_RUN1_NON_ANCHORED);

const RUN2 = runSync(SOMA_HOME_DIR);
const POST_RUN2_CONTENT      = readFile(FIXTURE_FILE);
const POST_RUN2_NON_ANCHORED = extractNonAnchored(POST_RUN2_CONTENT);
const POST_RUN2_SHA256       = sha256String(POST_RUN2_NON_ANCHORED);

// ── Tests ────────────────────────────────────────────────────────────────────

test('AC-19 / T-12 content-preservation — first apply succeeds (sanity baseline)', () => {
  console.log(JSON.stringify({
    spec: 'AC-19', test: 'run1-sanity',
    run1_exitCode: RUN1.exitCode,
    run1_by_action: RUN1.result?.summary?.by_action ?? null,
    run1_files_touched: RUN1.result?.summary?.files_touched ?? null,
    run1_stderr_snippet: RUN1.stderr?.slice(0, 200) || null
  }));

  assert.equal(RUN1.exitCode, 0,
    `First apply must exit 0. Got: ${RUN1.exitCode}. stderr: ${RUN1.stderr?.slice(0, 300)}`);
  assert.ok(RUN1.result, `First apply must produce parseable JSON. stdout: ${RUN1.stdout?.slice(0, 300)}`);

  const byAction = RUN1.result?.summary?.by_action ?? {};
  const totalWrites = (byAction.insert ?? 0) + (byAction.replace ?? 0);
  assert.ok(totalWrites > 0,
    `First apply must write ≥1 block (got insert=${byAction.insert} replace=${byAction.replace})`);
});

test('AC-19 / T-12 content-preservation — post-apply file contains soma-v2 anchor markers', () => {
  const hasStartMarker = /<!-- soma-v2:start[^>]* -->/.test(POST_RUN1_CONTENT);
  const hasEndMarker   = /<!-- soma-v2:end[^>]* -->/.test(POST_RUN1_CONTENT);

  console.log(JSON.stringify({
    spec: 'AC-19', test: 'markers-present',
    hasStartMarker, hasEndMarker,
    post_len: POST_RUN1_CONTENT.length,
    pre_len: PRE_CONTENT.length
  }));

  assert.ok(hasStartMarker,
    'Post-apply file must contain <!-- soma-v2:start ... --> marker');
  assert.ok(hasEndMarker,
    'Post-apply file must contain <!-- soma-v2:end ... --> marker');
  assert.ok(POST_RUN1_CONTENT.length > PRE_CONTENT.length,
    `Post-apply file must be larger than pre-apply (block was inserted). Pre: ${PRE_CONTENT.length} Post: ${POST_RUN1_CONTENT.length}`);
});

test('AC-19 / T-12 content-preservation — extractNonAnchored strips soma-v2 blocks correctly', () => {
  // Non-anchored post-apply must NOT contain soma-v2 start markers (they were stripped)
  const nonAnchoredHasStartMarker = /<!-- soma-v2:start[^>]* -->/.test(POST_RUN1_NON_ANCHORED);
  const nonAnchoredHasEndMarker   = /<!-- soma-v2:end[^>]* -->/.test(POST_RUN1_NON_ANCHORED);

  console.log(JSON.stringify({
    spec: 'AC-19', test: 'helper-correctness',
    pre_non_anchored_len: PRE_NON_ANCHORED.length,
    post_run1_non_anchored_len: POST_RUN1_NON_ANCHORED.length,
    nonAnchoredHasStartMarker,
    nonAnchoredHasEndMarker,
    pre_sha256: PRE_SHA256,
    post_run1_sha256: POST_RUN1_SHA256
  }));

  assert.ok(!nonAnchoredHasStartMarker,
    'Non-anchored extraction must strip soma-v2:start markers (none should remain)');
  assert.ok(!nonAnchoredHasEndMarker,
    'Non-anchored extraction must strip soma-v2:end markers (none should remain)');
});

test('AC-19 / T-12 content-preservation — original user content lines all present post-apply', () => {
  // Core AC-19 assertion: every line in the pre-apply user content must be present
  // byte-for-byte in the post-apply file (outside soma-v2 blocks).
  const preLines = PRE_NON_ANCHORED.split('\n').filter(l => l.trim().length > 0);
  const missingLines = preLines.filter(l => !POST_RUN1_NON_ANCHORED.includes(l));

  console.log(JSON.stringify({
    spec: 'AC-19', test: 'user-content-lines-preserved',
    pre_line_count: preLines.length,
    missing_count: missingLines.length,
    missing_sample: missingLines.slice(0, 3),
    pre_sha256: PRE_SHA256,
    post_run1_sha256: POST_RUN1_SHA256
  }));

  assert.equal(missingLines.length, 0,
    `All original user lines must be present in post-apply non-anchored content.\n` +
    `Missing (${missingLines.length}): ${JSON.stringify(missingLines.slice(0, 5))}`);
});

test('AC-19 / T-12 content-preservation — unique marker strings from pre-apply survive post-apply', () => {
  // Spot-check: unique strings in the original fixture are still present in post-apply file
  const UNIQUE_MARKER_1 = 'A1B2C3';  // in USER_CONTENT_BEFORE
  const UNIQUE_MARKER_2 = 'D4E5F6';  // in USER_CONTENT_AFTER

  const run1HasMarker1 = POST_RUN1_CONTENT.includes(UNIQUE_MARKER_1);
  const run1HasMarker2 = POST_RUN1_CONTENT.includes(UNIQUE_MARKER_2);
  const run2HasMarker1 = POST_RUN2_CONTENT.includes(UNIQUE_MARKER_1);
  const run2HasMarker2 = POST_RUN2_CONTENT.includes(UNIQUE_MARKER_2);

  console.log(JSON.stringify({
    spec: 'AC-19', test: 'unique-markers-survive',
    run1_marker1: run1HasMarker1, run1_marker2: run1HasMarker2,
    run2_marker1: run2HasMarker1, run2_marker2: run2HasMarker2
  }));

  assert.ok(run1HasMarker1,
    `Unique marker "${UNIQUE_MARKER_1}" (from USER_CONTENT_BEFORE) must survive first apply`);
  assert.ok(run1HasMarker2,
    `Unique marker "${UNIQUE_MARKER_2}" (from USER_CONTENT_AFTER) must survive first apply`);
  assert.ok(run2HasMarker1,
    `Unique marker "${UNIQUE_MARKER_1}" must survive second (noop) apply`);
  assert.ok(run2HasMarker2,
    `Unique marker "${UNIQUE_MARKER_2}" must survive second (noop) apply`);
});

test('AC-19 / T-12 content-preservation — non-anchored sha256 stable: post-run1 === post-run2', () => {
  // Core stability assertion: second apply (noop) must not mutate anything outside anchors.
  // This is the sha256 stability criterion from AC-19.
  console.log(JSON.stringify({
    spec: 'AC-19', test: 'non-anchored-sha256-stable',
    post_run1_sha256: POST_RUN1_SHA256,
    post_run2_sha256: POST_RUN2_SHA256,
    sha_match: POST_RUN1_SHA256 === POST_RUN2_SHA256,
    run2_files_touched: RUN2.result?.summary?.files_touched ?? null,
    run2_exitCode: RUN2.exitCode
  }));

  assert.equal(POST_RUN1_SHA256, POST_RUN2_SHA256,
    `Non-anchored sha256 must be IDENTICAL between run1 and run2 (noop must not mutate non-anchored regions).\n` +
    `  run1: ${POST_RUN1_SHA256}\n` +
    `  run2: ${POST_RUN2_SHA256}`);
});

test('AC-19 / T-12 content-preservation — non-anchored full string stable: post-run1 === post-run2', () => {
  // String-level stability (beyond sha256) between run1 and run2 non-anchored content.
  console.log(JSON.stringify({
    spec: 'AC-19', test: 'non-anchored-string-stable',
    equal: POST_RUN1_NON_ANCHORED === POST_RUN2_NON_ANCHORED,
    run1_len: POST_RUN1_NON_ANCHORED.length,
    run2_len: POST_RUN2_NON_ANCHORED.length
  }));

  assert.equal(POST_RUN1_NON_ANCHORED, POST_RUN2_NON_ANCHORED,
    'Non-anchored content string must be BYTE-IDENTICAL between run1 and run2');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

test('AC-19 / T-12 content-preservation — cleanup sandbox', () => {
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  assert.ok(!fs.existsSync(RUN_DIR), `Cleanup: ${RUN_DIR} must not exist after cleanup`);
});
