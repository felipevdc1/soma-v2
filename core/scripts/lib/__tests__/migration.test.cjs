'use strict';
/**
 * Unit tests for scripts/lib/migration.cjs
 *
 * Tests pure detection logic (detectOldMarkersInContent) and file scanning
 * (scanFilesForOldMarkers) with real tmp fixtures — no mocks.
 *
 * @phase GREEN (T-08)
 * @spec AC-10 AC-11
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectOldMarkersInContent,
  scanFilesForOldMarkers,
  resolveScanPaths,
} = require('../migration.cjs');

// ── detectOldMarkersInContent ─────────────────────────────────────────────────

test('detectOldMarkersInContent: empty string returns []', () => {
  assert.deepEqual(detectOldMarkersInContent(''), []);
});

test('detectOldMarkersInContent: no markers in plain text returns []', () => {
  const content = '# Heading\n\nJust some text without any markers.\n';
  assert.deepEqual(detectOldMarkersInContent(content), []);
});

test('detectOldMarkersInContent: detects single OLD marker with correct name', () => {
  const content = [
    '<!-- codebase-memory-mcp:start -->',
    'content line 1',
    'content line 2',
    '<!-- codebase-memory-mcp:end -->',
  ].join('\n');

  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 1);
  assert.equal(results[0].marker_name, 'codebase-memory-mcp');
});

test('detectOldMarkersInContent: detects multiple OLD markers', () => {
  const content = [
    '<!-- cbm:start -->',
    'cbm content',
    '<!-- cbm:end -->',
    '<!-- hyd-v2:start -->',
    'hyd content',
    '<!-- hyd-v2:end -->',
    '<!-- soma-stsd:start -->',
    'stsd content',
    '<!-- soma-stsd:end -->',
  ].join('\n');

  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 3);
  const names = results.map(r => r.marker_name);
  assert.ok(names.includes('cbm'));
  assert.ok(names.includes('hyd-v2'));
  assert.ok(names.includes('soma-stsd'));
});

test('detectOldMarkersInContent: soma-v2 start marker NOT detected as OLD', () => {
  const content = [
    '<!-- soma-v2:start id=block.codex.AGENTS.cbm version=1 sha256=aabb -->',
    'new format content',
    '<!-- soma-v2:end id=block.codex.AGENTS.cbm -->',
  ].join('\n');

  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 0, 'soma-v2 anchors must NOT be counted as OLD markers');
});

test('detectOldMarkersInContent: mixed content counts only OLD markers', () => {
  const content = [
    '<!-- soma-stsd:start -->',
    'OLD marker content.',
    '<!-- soma-stsd:end -->',
    '<!-- soma-v2:start id=block.codex.AGENTS.cbm version=1 sha256=aabb -->',
    'soma-v2 new format.',
    '<!-- soma-v2:end id=block.codex.AGENTS.cbm -->',
  ].join('\n');

  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 1, 'Only 1 OLD marker (soma-stsd), not the soma-v2 anchor');
  assert.equal(results[0].marker_name, 'soma-stsd');
});

test('detectOldMarkersInContent: byte_position_start is index of start marker', () => {
  const prefix = '# Header\n\n';
  const content = `${prefix}<!-- cbm:start -->\ncontent\n<!-- cbm:end -->`;

  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 1);
  assert.equal(results[0].byte_position_start, prefix.length);
});

test('detectOldMarkersInContent: byte_position_end covers full end marker', () => {
  const content = '<!-- cbm:start -->\ncontent\n<!-- cbm:end -->';
  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 1);
  // byte_position_end should be at or after the end tag
  assert.ok(results[0].byte_position_end > results[0].byte_position_start);
  const endTag = '<!-- cbm:end -->';
  const expectedEnd = content.indexOf(endTag) + endTag.length;
  assert.equal(results[0].byte_position_end, expectedEnd);
});

test('detectOldMarkersInContent: start with no matching end — still reports marker', () => {
  const content = '<!-- orphan:start -->\nno end marker here';
  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 1);
  assert.equal(results[0].marker_name, 'orphan');
});

test('detectOldMarkersInContent: marker names with hyphens and digits are detected', () => {
  const content = '<!-- my-tool-v2:start -->\ncontent\n<!-- my-tool-v2:end -->';
  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 1);
  assert.equal(results[0].marker_name, 'my-tool-v2');
});

test('detectOldMarkersInContent: soma-v2 name excluded even in strict pattern', () => {
  // If somehow <!-- soma-v2:start --> appeared without attrs (malformed old-style)
  // it must still be excluded by name check
  const content = '<!-- soma-v2:start -->\ncontent\n<!-- soma-v2:end -->';
  const results = detectOldMarkersInContent(content);
  assert.equal(results.length, 0, 'soma-v2 name must always be excluded');
});

// ── scanFilesForOldMarkers ─────────────────────────────────────────────────────

test('scanFilesForOldMarkers: empty path list returns migration_needed=false', () => {
  const result = scanFilesForOldMarkers([]);
  assert.equal(result.migration_needed, false);
  assert.equal(result.old_markers_detected, 0);
  assert.deepEqual(result.scanned_files, []);
});

test('scanFilesForOldMarkers: non-existent file is skipped silently', () => {
  const result = scanFilesForOldMarkers(['/tmp/soma-migration-test-nonexistent-file.md']);
  assert.equal(result.migration_needed, false);
  assert.equal(result.old_markers_detected, 0);
  assert.equal(result.scanned_files.length, 1, 'File path should appear in scanned_files even if unreadable');
});

test('scanFilesForOldMarkers: clean file returns migration_needed=false', () => {
  const tmpFile = path.join(os.tmpdir(), `soma-mig-test-clean-${Date.now()}.md`);
  const content = [
    '<!-- soma-v2:start id=block.codex.AGENTS.cbm version=1 sha256=aabb -->',
    'soma-v2 content',
    '<!-- soma-v2:end id=block.codex.AGENTS.cbm -->',
  ].join('\n');
  fs.writeFileSync(tmpFile, content, 'utf8');

  try {
    const result = scanFilesForOldMarkers([tmpFile]);
    assert.equal(result.migration_needed, false);
    assert.equal(result.old_markers_detected, 0);
    assert.ok(result.scanned_files.includes(tmpFile));
    assert.equal(result.old_markers_by_file, undefined, 'old_markers_by_file absent when no OLD markers');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('scanFilesForOldMarkers: file with OLD markers returns migration_needed=true', () => {
  const tmpFile = path.join(os.tmpdir(), `soma-mig-test-old-${Date.now()}.md`);
  const content = [
    '<!-- codebase-memory-mcp:start -->',
    'legacy content',
    '<!-- codebase-memory-mcp:end -->',
  ].join('\n');
  fs.writeFileSync(tmpFile, content, 'utf8');

  try {
    const result = scanFilesForOldMarkers([tmpFile]);
    assert.equal(result.migration_needed, true);
    assert.equal(result.old_markers_detected, 1);
    assert.ok(result.old_markers_by_file, 'old_markers_by_file must be present');
    assert.ok(result.old_markers_by_file[tmpFile], 'File key must exist in old_markers_by_file');
    assert.equal(result.old_markers_by_file[tmpFile].length, 1);
    assert.equal(result.old_markers_by_file[tmpFile][0].marker_name, 'codebase-memory-mcp');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('scanFilesForOldMarkers: migration_command_hint present when migration_needed=true', () => {
  const tmpFile = path.join(os.tmpdir(), `soma-mig-test-hint-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, '<!-- cbm:start -->\ncontent\n<!-- cbm:end -->', 'utf8');

  try {
    const result = scanFilesForOldMarkers([tmpFile]);
    assert.equal(result.migration_needed, true);
    assert.ok(typeof result.migration_command_hint === 'string' && result.migration_command_hint.length > 0);
    assert.ok(result.migration_command_hint.includes('soma sync'));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('scanFilesForOldMarkers: counts markers across multiple files', () => {
  const tmpFile1 = path.join(os.tmpdir(), `soma-mig-test-multi1-${Date.now()}.md`);
  const tmpFile2 = path.join(os.tmpdir(), `soma-mig-test-multi2-${Date.now()}.md`);

  fs.writeFileSync(tmpFile1, '<!-- cbm:start -->\nc\n<!-- cbm:end -->\n<!-- hyd-v2:start -->\nc\n<!-- hyd-v2:end -->', 'utf8');
  fs.writeFileSync(tmpFile2, '<!-- soma-stsd:start -->\nc\n<!-- soma-stsd:end -->', 'utf8');

  try {
    const result = scanFilesForOldMarkers([tmpFile1, tmpFile2]);
    assert.equal(result.migration_needed, true);
    assert.equal(result.old_markers_detected, 3); // 2 in file1 + 1 in file2
    assert.equal(result.scanned_files.length, 2);
  } finally {
    fs.unlinkSync(tmpFile1);
    fs.unlinkSync(tmpFile2);
  }
});

// ── resolveScanPaths ──────────────────────────────────────────────────────────

test('resolveScanPaths: SOMA_MIGRATION_SCAN_PATHS overrides defaults', () => {
  const saved = process.env.SOMA_MIGRATION_SCAN_PATHS;
  const savedSafe = process.env.SOMA_SAFE_PATHS_ONLY;
  process.env.SOMA_MIGRATION_SCAN_PATHS = '/tmp/a.md:/tmp/b.md';
  delete process.env.SOMA_SAFE_PATHS_ONLY;

  try {
    const paths = resolveScanPaths();
    assert.deepEqual(paths, ['/tmp/a.md', '/tmp/b.md']);
  } finally {
    if (saved !== undefined) process.env.SOMA_MIGRATION_SCAN_PATHS = saved;
    else delete process.env.SOMA_MIGRATION_SCAN_PATHS;
    if (savedSafe !== undefined) process.env.SOMA_SAFE_PATHS_ONLY = savedSafe;
    else delete process.env.SOMA_SAFE_PATHS_ONLY;
  }
});

test('resolveScanPaths: SOMA_SAFE_PATHS_ONLY=1 with no override returns []', () => {
  const savedPaths = process.env.SOMA_MIGRATION_SCAN_PATHS;
  const savedSafe = process.env.SOMA_SAFE_PATHS_ONLY;
  delete process.env.SOMA_MIGRATION_SCAN_PATHS;
  process.env.SOMA_SAFE_PATHS_ONLY = '1';

  try {
    const paths = resolveScanPaths();
    assert.deepEqual(paths, [], 'Safe mode with no override must return empty (skip real paths)');
  } finally {
    if (savedPaths !== undefined) process.env.SOMA_MIGRATION_SCAN_PATHS = savedPaths;
    else delete process.env.SOMA_MIGRATION_SCAN_PATHS;
    if (savedSafe !== undefined) process.env.SOMA_SAFE_PATHS_ONLY = savedSafe;
    else delete process.env.SOMA_SAFE_PATHS_ONLY;
  }
});
