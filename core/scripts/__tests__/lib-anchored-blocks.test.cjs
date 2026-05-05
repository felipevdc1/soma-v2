'use strict';
// @spec AC-01
// Unit tests for scripts/lib/anchored-blocks.cjs

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseAnchorAttrs,
  computeBlockSha256,
  extractBlock
} = require('../lib/anchored-blocks.cjs');

// Helper to create temp file
function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ab-'));
  const p = path.join(dir, 'test.md');
  fs.writeFileSync(p, content);
  return p;
}

// --- parseAnchorAttrs ---

test('parseAnchorAttrs: parses valid soma-v2:start marker', () => {
  const line = '<!-- soma-v2:start id=block.codex.AGENTS.hyd-v2 version=2.1.0-draft sha256=abc123 -->';
  const result = parseAnchorAttrs(line);
  assert.ok(result);
  assert.equal(result.id, 'block.codex.AGENTS.hyd-v2');
  assert.equal(result.version, '2.1.0-draft');
  assert.equal(result.sha256, 'abc123');
});

test('parseAnchorAttrs: returns null for non-soma-v2 marker', () => {
  const line = '<!-- codebase-memory-mcp:start -->';
  assert.equal(parseAnchorAttrs(line), null);
});

test('parseAnchorAttrs: returns null for soma-v2:end marker', () => {
  const line = '<!-- soma-v2:end id=block.codex.AGENTS.hyd-v2 -->';
  assert.equal(parseAnchorAttrs(line), null);
});

test('parseAnchorAttrs: handles missing version/sha256 attrs', () => {
  const line = '<!-- soma-v2:start id=core.constitution -->';
  const result = parseAnchorAttrs(line);
  assert.ok(result);
  assert.equal(result.id, 'core.constitution');
  assert.equal(result.version, null);
  assert.equal(result.sha256, null);
});

test('parseAnchorAttrs: returns null for regular text line', () => {
  assert.equal(parseAnchorAttrs('# Some heading'), null);
  assert.equal(parseAnchorAttrs(''), null);
  assert.equal(parseAnchorAttrs('plain text'), null);
});

test('parseAnchorAttrs: handles id with dots', () => {
  const line = '<!-- soma-v2:start id=block.codex.AGENTS.soma-stsd version=2.1.0-draft sha256=deadbeef -->';
  const r = parseAnchorAttrs(line);
  assert.equal(r.id, 'block.codex.AGENTS.soma-stsd');
});

// --- computeBlockSha256 ---

test('computeBlockSha256: returns hex string of length 64', () => {
  const hash = computeBlockSha256('hello world');
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('computeBlockSha256: deterministic — same input same output', () => {
  const content = '# HYD v2\nSome content\n';
  assert.equal(computeBlockSha256(content), computeBlockSha256(content));
});

test('computeBlockSha256: different content → different hash', () => {
  assert.notEqual(computeBlockSha256('abc'), computeBlockSha256('xyz'));
});

test('computeBlockSha256: empty string', () => {
  const hash = computeBlockSha256('');
  assert.equal(hash.length, 64);
});

// --- extractBlock ---

test('extractBlock: extracts soma-v2 format block successfully', () => {
  const content = `before
<!-- soma-v2:start id=block.test.foo version=2.1.0 sha256=aabbcc -->
# Foo
Content here.
<!-- soma-v2:end id=block.test.foo -->
after
`;
  const p = tmpFile(content);
  const result = extractBlock(p, 'block.test.foo');
  assert.equal(result.found, true);
  assert.ok(result.content.includes('# Foo'));
  assert.ok(result.content.includes('Content here.'));
  assert.equal(result.attrs.id, 'block.test.foo');
  assert.equal(result.attrs.version, '2.1.0');
  assert.equal(result.attrs.sha256, 'aabbcc');
});

test('extractBlock: extracts legacy format block (name:start / name:end)', () => {
  const content = `<!-- hyd-v2:start -->
# HYD v2
Legacy content.
<!-- hyd-v2:end -->
`;
  const p = tmpFile(content);
  const result = extractBlock(p, 'hyd-v2');
  assert.equal(result.found, true);
  assert.ok(result.content.includes('# HYD v2'));
  assert.equal(result.attrs.id, 'hyd-v2');
  assert.equal(result.attrs.version, null);
  assert.equal(result.attrs.sha256, null);
});

test('extractBlock: returns found=false when block not in file', () => {
  const content = '# No anchors here\nJust text.';
  const p = tmpFile(content);
  const result = extractBlock(p, 'block.nonexistent');
  assert.equal(result.found, false);
});

test('extractBlock: returns found=false for nonexistent file', () => {
  const result = extractBlock('/tmp/soma-v2-no-such-file-12345.md', 'any.block');
  assert.equal(result.found, false);
});

test('extractBlock: start without matching end returns found=false', () => {
  const content = `<!-- soma-v2:start id=block.orphan.foo version=1.0 sha256=xx -->
content without end
`;
  const p = tmpFile(content);
  const result = extractBlock(p, 'block.orphan.foo');
  assert.equal(result.found, false);
});

test('extractBlock: finds correct block when multiple blocks present', () => {
  const content = `<!-- soma-v2:start id=block.a version=1.0 sha256=aaa -->
block A content
<!-- soma-v2:end id=block.a -->

<!-- soma-v2:start id=block.b version=1.0 sha256=bbb -->
block B content
<!-- soma-v2:end id=block.b -->
`;
  const p = tmpFile(content);
  const ra = extractBlock(p, 'block.a');
  const rb = extractBlock(p, 'block.b');
  assert.equal(ra.found, true);
  assert.ok(ra.content.includes('block A content'));
  assert.equal(rb.found, true);
  assert.ok(rb.content.includes('block B content'));
});

test('extractBlock: legacy block id with dots', () => {
  const content = `<!-- block.codex.AGENTS.hyd-v2:start -->
dot.id content
<!-- block.codex.AGENTS.hyd-v2:end -->
`;
  const p = tmpFile(content);
  const result = extractBlock(p, 'block.codex.AGENTS.hyd-v2');
  assert.equal(result.found, true);
  assert.ok(result.content.includes('dot.id content'));
});

test('extractBlock: soma-v2 block with missing id attr returns not found', () => {
  const content = `<!-- soma-v2:start version=1.0 -->
no id attr
<!-- soma-v2:end id=block.no-id -->
`;
  const p = tmpFile(content);
  // No match because parseAnchorAttrs returns null for missing id
  const result = extractBlock(p, 'block.no-id');
  assert.equal(result.found, false);
});
