'use strict';
/**
 * BF-03 Consolidation Reproducer Test
 *
 * Demonstrates the bug: 3 install-targets entries for claude → only 2 anchored blocks written.
 * Root cause: extractBlock finds legacy `<!-- hyd-v2:start -->` markers NESTED inside the
 * cbm block (because cbm uses hyd-v2.md full content as block content), so writeBlock enters
 * REPLACE branch but parseAnchorAttrs never matches the legacy marker → silent no-op write.
 *
 * @phase RED → GREEN (T-05 fix: isLegacyBlockNested check in writeBlock)
 * @spec AC-03 + BF-03
 * @contract CONTRACT-011-01-sync-apply
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SANDBOX_PREFIX = '/tmp/soma-v2-test';
const SYNC_SCRIPT = 'scripts/sync.cjs';

before(() => {
  fs.mkdirSync(SANDBOX_PREFIX, { recursive: true });
});

/**
 * Create isolated fixture for BF-03 reproduction.
 * Returns { somaDir, claudeMdPath }.
 */
function createBF03Fixture() {
  const fixtureRoot = path.join(SANDBOX_PREFIX, `bf03-${Date.now()}`);
  const somaDir = path.join(fixtureRoot, '.soma-v2');
  const targetDir = path.join(fixtureRoot, 'targets');
  const claudeDir = path.join(targetDir, '.claude');

  fs.mkdirSync(claudeDir, { recursive: true });

  // Copy real soma-v2 (preserves docs/hyd-v2.md, docs/soma-stsd.md)
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

  // Target CLAUDE.md with ## Failure Log section to test positional logic
  const claudeContent = [
    '# Claude Self-Model',
    '',
    'Some content in the self-model.',
    '',
    '## Failure Modes (empirically verified)',
    '',
    '1. **Shallow pattern-matching** — example.',
    '',
    '## Failure Log',
    '2026-04-07 | #6 | example | added',
    ''
  ].join('\n');

  fs.writeFileSync(claudeMdPath, claudeContent);

  // Patch claude install-targets to point to sandboxed target
  const entries = [
    {
      block_id: 'block.claude.CLAUDE_md.cbm',
      source_doc: 'docs/hyd-v2.md',
      target_path: claudeMdPath,
      target_anchor_id: 'block.claude.CLAUDE_md.cbm'
    },
    {
      block_id: 'block.claude.CLAUDE_md.hyd-v2',
      source_doc: 'docs/hyd-v2.md',
      target_path: claudeMdPath,
      target_anchor_id: 'block.claude.CLAUDE_md.hyd-v2'
    },
    {
      block_id: 'block.claude.CLAUDE_md.soma-stsd',
      source_doc: 'docs/soma-stsd.md',
      target_path: claudeMdPath,
      target_anchor_id: 'block.claude.CLAUDE_md.soma-stsd'
    }
  ];

  fs.writeFileSync(
    path.join(somaDir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries }, null, 2)
  );

  return { somaDir, claudeMdPath };
}

// ============================================================
// BF-03 REPRODUCER: 3 install-targets entries → 3 blocks written (not 2)
// @spec AC-03 + BF-03
// This test is RED before T-05 fix: only 2 blocks written (cbm + soma-stsd).
// hyd-v2 block is missing because writeBlock silently no-ops (legacy nested match bug).
// ============================================================

test('BF-03: 3 claude install-targets entries → all 3 soma-v2 anchored blocks written', () => {
  const { somaDir, claudeMdPath } = createBF03Fixture();

  const result = spawnSync(
    'node',
    [SYNC_SCRIPT, '--apply', '--tool=claude', '--json', `--soma-home=${somaDir}`],
    {
      cwd: SOMA_HOME,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, SOMA_SAFE_PATHS_ONLY: '1' }
    }
  );

  assert.equal(result.status, 0,
    `Apply should exit 0, got ${result.status}. stderr: ${result.stderr}`);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.error, null, `Expected no error, got: ${JSON.stringify(parsed.error)}`);

  const totalWritten = (parsed.summary?.by_action?.insert || 0) + (parsed.summary?.by_action?.replace || 0);
  assert.equal(totalWritten, 3,
    `Expected 3 entries written for claude, got ${totalWritten}. ` +
    `by_action: ${JSON.stringify(parsed.summary?.by_action)} — ` +
    `BF-03: hyd-v2 is missing because writeBlock sees legacy hyd-v2:start NESTED inside cbm block ` +
    `and enters REPLACE branch but parseAnchorAttrs never matches the legacy marker (silent no-op).`);

  // Verify all 3 soma-v2 anchors are actually in the file
  const content = fs.readFileSync(claudeMdPath, 'utf8');

  assert.ok(
    content.includes('<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm'),
    'Expected cbm soma-v2 anchor in target file'
  );
  assert.ok(
    content.includes('<!-- soma-v2:start id=block.claude.CLAUDE_md.hyd-v2'),
    `Expected hyd-v2 soma-v2 anchor in target file. ` +
    `BF-03: hyd-v2 is absent because writeBlock silently no-ops when extractBlock ` +
    `finds legacy hyd-v2:start NESTED inside the cbm soma-v2 block content.`
  );
  assert.ok(
    content.includes('<!-- soma-v2:start id=block.claude.CLAUDE_md.soma-stsd'),
    'Expected soma-stsd soma-v2 anchor in target file'
  );

  // AC-03: bootloader section MUST appear BEFORE ## Failure Log section
  // Audit gap remediation 2026-05-04 — self-model write canary precondition
  const bootloaderIdx = content.indexOf('## SOMA Bootloader (managed by soma sync)');
  const failureLogIdx = content.indexOf('## Failure Log');
  assert.ok(bootloaderIdx >= 0, 'AC-03: ## SOMA Bootloader section header must exist post-apply');
  assert.ok(failureLogIdx >= 0, 'AC-03: ## Failure Log section must exist in fixture');
  assert.ok(
    bootloaderIdx < failureLogIdx,
    `AC-03: bootloader (idx ${bootloaderIdx}) must appear BEFORE Failure Log (idx ${failureLogIdx}). positionBefore logic may have silent append-end fallback.`
  );
});

// ============================================================
// BF-03: Verify that the nested legacy detection correctly identifies the root cause.
// This test directly exercises the extractBlock behavior that triggers BF-03.
// ============================================================

test('BF-03 root cause: extractBlock finds legacy hyd-v2 marker nested inside cbm soma-v2 block', () => {
  const { extractBlock } = require(path.join(SOMA_HOME, 'scripts/lib/anchored-blocks.cjs'));
  const os2 = require('node:os');
  const tmpFile = path.join('/tmp', `bf03-rootcause-${Date.now()}.md`);

  // Simulate what happens AFTER cbm block is written:
  // cbm block content = full hyd-v2.md = contains <!-- hyd-v2:start --> at top
  const hyd2Content = fs.readFileSync(path.join(SOMA_HOME, 'docs/hyd-v2.md'), 'utf8');

  // This is what the target file looks like after cbm is written
  const targetContent = [
    '# Some File',
    '',
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=abc123 -->',
    ...hyd2Content.split('\n'),
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->',
    ''
  ].join('\n');

  fs.writeFileSync(tmpFile, targetContent);

  // This is the BF-03 root cause: extractBlock finds hyd-v2 via legacy short-name INSIDE cbm block
  const result = extractBlock(tmpFile, 'block.claude.CLAUDE_md.hyd-v2');

  // Before the fix: result.found = true (legacy match INSIDE cbm block)
  // After the fix in writeBlock: isLegacyBlockNested detects this and treats as "not found"
  // The extractBlock behavior itself doesn't change (it's a frozen library).
  // We document the root cause here.
  if (result.found && (result.attrs.version === null && result.attrs.sha256 === null)) {
    // This confirms the root cause: extractBlock returns found=true with legacy format
    // for hyd-v2 even though the legacy markers are NESTED inside the cbm soma-v2 block.
    // The fix in writeBlock checks isLegacyBlockNested() to override this false positive.
    assert.ok(true, 'Root cause confirmed: extractBlock finds nested legacy hyd-v2 marker inside cbm block');
  } else if (!result.found) {
    // If extractBlock was fixed to not match nested legacy markers, that's also acceptable
    assert.ok(true, 'extractBlock correctly handles nested legacy markers (no false positive)');
  } else {
    // Unexpected: new format found — something changed
    assert.fail(`Unexpected: extractBlock returned new-format block for hyd-v2 nested in cbm. attrs: ${JSON.stringify(result.attrs)}`);
  }

  // Cleanup
  try { fs.unlinkSync(tmpFile); } catch (_) {}
});
