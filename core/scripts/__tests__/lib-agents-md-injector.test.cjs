'use strict';
// @spec AC-04 AC-05
// Unit tests for scripts/lib/agents-md-injector.cjs
// Covers: create-from-empty, append-to-existing-no-block, throw-when-block-already-present, blank-line-separator.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { injectBootloader, hasAnchorBlock, BLOCK_ID, BLOCK_VERSION } = require('../lib/agents-md-injector.cjs');
const { computeBlockSha256 } = require('../lib/anchored-blocks.cjs');

const SAMPLE_BLOCK_BODY = 'Detect whether this project has `.soma/`. If yes, read `.soma/CONTEXT.md`.\nNever claim done without evidence.';

// ---- hasAnchorBlock tests ----

test('agents-md-injector: hasAnchorBlock returns false for empty string', () => {
  assert.equal(hasAnchorBlock('', BLOCK_ID), false);
});

test('agents-md-injector: hasAnchorBlock returns false when no soma-v2 markers present', () => {
  const content = '# My Project\n\nSome content here.\n';
  assert.equal(hasAnchorBlock(content, BLOCK_ID), false);
});

test('agents-md-injector: hasAnchorBlock returns true when matching soma-v2:start marker present', () => {
  const content = `# My Project\n\n<!-- soma-v2:start id=${BLOCK_ID} version=2.1.0-draft sha256=abc123 -->\nbody\n<!-- soma-v2:end id=${BLOCK_ID} -->\n`;
  assert.equal(hasAnchorBlock(content, BLOCK_ID), true);
});

test('agents-md-injector: hasAnchorBlock returns false for different block ID', () => {
  const content = `<!-- soma-v2:start id=block.codex.AGENTS.hyd-v2 version=2.0 sha256=abc -->\nbody\n<!-- soma-v2:end id=block.codex.AGENTS.hyd-v2 -->\n`;
  assert.equal(hasAnchorBlock(content, BLOCK_ID), false);
});

// ---- injectBootloader: create from empty (existingContent = null) ----

test('agents-md-injector: create action when existingContent is null', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.equal(result.action, 'create');
});

test('agents-md-injector: created content contains soma-v2 start marker with correct id', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(result.newContent.includes(`id=${BLOCK_ID}`), 'start marker must contain block ID');
});

test('agents-md-injector: created content contains soma-v2 end marker', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(result.newContent.includes(`<!-- soma-v2:end id=${BLOCK_ID} -->`), 'end marker must be present');
});

test('agents-md-injector: created content blockSha256 is real sha256 of blockBody', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  const expectedSha = computeBlockSha256(SAMPLE_BLOCK_BODY);
  assert.equal(result.blockSha256, expectedSha);
  // Sha256 must be 64 hex chars
  assert.match(result.blockSha256, /^[a-f0-9]{64}$/, 'blockSha256 must be 64 hex chars');
});

test('agents-md-injector: created content sha256 attribute in marker is not FILL_AT_INSTALL', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(!result.newContent.includes('FILL_AT_INSTALL'), 'sha256 must not be literal FILL_AT_INSTALL');
});

test('agents-md-injector: created content sha256 attribute matches computed blockSha256', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(
    result.newContent.includes(`sha256=${result.blockSha256}`),
    'start marker sha256 attribute must match returned blockSha256'
  );
});

test('agents-md-injector: created content version attribute matches BLOCK_VERSION', () => {
  const result = injectBootloader({
    existingContent: null,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(result.newContent.includes(`version=${BLOCK_VERSION}`), 'version must be present in marker');
});

// ---- injectBootloader: append to existing (no block present) ----

test('agents-md-injector: inject action when existingContent has no block', () => {
  const existing = '# My Project\n\nSome content here.\n';
  const result = injectBootloader({
    existingContent: existing,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.equal(result.action, 'inject');
});

test('agents-md-injector: existing content is preserved byte-for-byte', () => {
  const existing = '# My Project Notes\n\nLine that must persist.\nAnother line.\n';
  const result = injectBootloader({
    existingContent: existing,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(result.newContent.startsWith(existing.trimEnd()), 'existing content must be preserved at start');
  assert.ok(result.newContent.includes('My Project Notes'), 'title line preserved');
  assert.ok(result.newContent.includes('Line that must persist.'), 'content line preserved');
  assert.ok(result.newContent.includes('Another line.'), 'content line preserved');
});

test('agents-md-injector: blank line separates existing content from injected block', () => {
  const existing = '# My Project\n\nContent.\n';
  const result = injectBootloader({
    existingContent: existing,
    blockBody: SAMPLE_BLOCK_BODY
  });
  // The block start marker must be preceded by at least one blank line
  const blockStart = `<!-- soma-v2:start id=${BLOCK_ID}`;
  const blockIdx = result.newContent.indexOf(blockStart);
  const beforeBlock = result.newContent.slice(0, blockIdx);
  assert.ok(beforeBlock.endsWith('\n\n'), `Expected blank line before block, got: ${JSON.stringify(beforeBlock.slice(-20))}`);
});

test('agents-md-injector: appended block contains correct markers', () => {
  const existing = '# My Project\n\nContent.\n';
  const result = injectBootloader({
    existingContent: existing,
    blockBody: SAMPLE_BLOCK_BODY
  });
  assert.ok(result.newContent.includes(`id=${BLOCK_ID}`));
  assert.ok(result.newContent.includes(`<!-- soma-v2:end id=${BLOCK_ID} -->`));
});

// ---- injectBootloader: throws when block already present ----

test('agents-md-injector: throws AGENTS_MD_PARSE_ERROR when block already present', () => {
  const existing = `# My Project\n\n<!-- soma-v2:start id=${BLOCK_ID} version=2.1.0-draft sha256=abc123 -->\nbody\n<!-- soma-v2:end id=${BLOCK_ID} -->\n`;
  assert.throws(
    () => injectBootloader({ existingContent: existing, blockBody: SAMPLE_BLOCK_BODY }),
    (err) => {
      assert.equal(err.code, 'AGENTS_MD_PARSE_ERROR');
      assert.ok(err.message.includes(BLOCK_ID));
      return true;
    }
  );
});

test('agents-md-injector: does not throw when existingContent is null even with block body present', () => {
  // null means file doesn't exist — never has a pre-existing block
  assert.doesNotThrow(() => {
    injectBootloader({ existingContent: null, blockBody: SAMPLE_BLOCK_BODY });
  });
});
