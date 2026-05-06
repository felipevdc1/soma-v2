'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lib = require('../lib/migrate.cjs');

test('extractMcpContentFromLab: extracts content between legacy markers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, [
    '<!-- codebase-memory-mcp:start -->',
    '# Codebase Knowledge Graph',
    'MCP doc content here',
    '<!-- codebase-memory-mcp:end -->',
    '',
    '<!-- hyd-v2:start -->',
    'unrelated',
    '<!-- hyd-v2:end -->',
  ].join('\n'));
  const content = lib.extractMcpContentFromLab(fixture);
  assert.match(content, /# Codebase Knowledge Graph/);
  assert.match(content, /MCP doc content here/);
  assert.doesNotMatch(content, /<!-- codebase-memory-mcp:start -->/, 'must exclude markers');
  assert.doesNotMatch(content, /unrelated/, 'must not include other blocks');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: returns null if no marker present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, '# Some other doc\nNo legacy markers here.');
  const content = lib.extractMcpContentFromLab(fixture);
  assert.equal(content, null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: returns null if file missing', () => {
  const content = lib.extractMcpContentFromLab('/nonexistent/path');
  assert.equal(content, null);
});

test('deleteLegacyBlock: removes markers + content cleanly', () => {
  const input = [
    '# Header',
    '',
    '<!-- codebase-memory-mcp:start -->',
    'Content to delete',
    '<!-- codebase-memory-mcp:end -->',
    '',
    '# After',
  ].join('\n');
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.doesNotMatch(result, /codebase-memory-mcp:start/);
  assert.doesNotMatch(result, /codebase-memory-mcp:end/);
  assert.doesNotMatch(result, /Content to delete/);
  assert.match(result, /# Header/);
  assert.match(result, /# After/);
});

test('deleteLegacyBlock: no-op if marker not present', () => {
  const input = '# Header\nNo markers here.';
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.equal(result, input);
});
