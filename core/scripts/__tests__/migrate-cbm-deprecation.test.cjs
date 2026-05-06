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

test('renameAnchor: changes ID + sha256 in soma-v2 anchor markers', () => {
  const input = [
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=oldhash -->',
    'block content',
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->',
  ].join('\n');
  const result = lib.renameAnchor(input, 'block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2', 'newhash');
  assert.match(result, /id=block\.claude\.CLAUDE_md\.hyd-v2/);
  assert.match(result, /sha256=newhash/);
  assert.doesNotMatch(result, /id=block\.claude\.CLAUDE_md\.cbm/);
  assert.match(result, /block content/, 'inner content preserved');
});

test('renameAnchor: no-op if oldId not present', () => {
  const input = '# No anchor here\nplain text';
  const result = lib.renameAnchor(input, 'block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2', 'newhash');
  assert.equal(result, input);
});

test('atomicWrite: writes via tmp + rename', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const target = path.join(tmpDir, 'output.md');
  fs.writeFileSync(target, 'old content');
  lib.atomicWrite(target, 'new content');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new content');
  // verify no .tmp leftover
  const leftovers = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0, 'no .tmp leftover after rename');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('atomicWrite: throws on permission failure (parent ENOENT)', () => {
  assert.throws(() => lib.atomicWrite('/nonexistent-dir/file.md', 'content'));
});

test('createMigrationSnapshot: creates snapshot dir with files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  const file1 = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(file1, 'claude content');
  const snapshotId = lib.createMigrationSnapshot(somaHome, [file1]);
  assert.match(snapshotId, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z-cbm-deprecation$/);
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  assert.ok(fs.existsSync(snapshotDir));
  // verify file content snapshot exists
  const snapshots = fs.readdirSync(snapshotDir);
  assert.ok(snapshots.length > 0, 'snapshot files written');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('rollbackFromSnapshot: restores files from snapshot', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  const snapshotId = '2026-05-06T20:00:00Z-cbm-deprecation';
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  // Create snapshot of CLAUDE.md
  fs.writeFileSync(path.join(snapshotDir, 'CLAUDE.md.snapshot'), 'original content');
  const target = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(target, 'mutated content');
  // Manifest mapping snapshot files → restore targets
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify({
    files: { 'CLAUDE.md.snapshot': target }
  }));
  lib.rollbackFromSnapshot(somaHome, snapshotId);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original content');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
