'use strict';
/**
 * BF-04 + BF-05 tests — snapshot.cjs schema bump + dedup
 *
 * @spec AC-05 (BF-04: schema soma-snapshot-manifest/v1; BF-05: dedup 1 entry/file)
 * @phase RED (before implementation) → GREEN (after snapshot.cjs changes)
 *
 * Coverage:
 *   BF-04: createManifestJSON produces soma-snapshot-manifest/v1 schema
 *   BF-04: entries array has relative_path, sha256_pre_write, file_size_bytes, block_ids_modified
 *   BF-04: readManifest reads soma-snapshot/v1 (old) → normalized
 *   BF-04: readManifest reads soma-snapshot-manifest/v1 (new) → normalized
 *   BF-04: readManifest throws MANIFEST_SCHEMA_INVALID on unknown schema
 *   BF-05: createSnapshot deduplicates — 1 manifest entry per unique relative_path
 *   BF-05: block_ids_modified aggregated from all same-path entries
 *   Backward compat: createManifestJSON accepts old format {adapter, path, sha256, size}
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SNAPSHOT_LIB = path.join(SOMA_HOME, 'scripts', 'lib', 'snapshot.cjs');

// ── helpers ──────────────────────────────────────────────────────────────────

let snapshotLib;
try {
  // Clear cache on require to get fresh module state during test runs
  delete require.cache[require.resolve(SNAPSHOT_LIB)];
  snapshotLib = require(SNAPSHOT_LIB);
} catch (e) {
  snapshotLib = null;
}

function getLib() {
  if (!snapshotLib) throw new Error('snapshot.cjs failed to load — likely RED phase issue');
  return snapshotLib;
}

function makeTmpDir(prefix = 'soma-bf0405-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256Buf(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ── BF-04: createManifestJSON schema bump ────────────────────────────────────

test('BF-04: createManifestJSON produces schema soma-snapshot-manifest/v1', () => {
  const { createManifestJSON } = getLib();
  const files = [
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'a'.repeat(64), size: 100 }
  ];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1',
    `schema must be soma-snapshot-manifest/v1, got: ${mf.schema}`);
});

test('BF-04: createManifestJSON uses entries array (not files)', () => {
  const { createManifestJSON } = getLib();
  const files = [
    { adapter: 'codex', path: 'AGENTS.md', sha256: 'b'.repeat(64), size: 200 }
  ];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.ok(Array.isArray(mf.entries), 'manifest must have entries array (not files)');
  assert.equal(mf.entries.length, 1, 'entries must have 1 entry');
});

test('BF-04: each entry has relative_path (adapter/path composite)', () => {
  const { createManifestJSON } = getLib();
  const files = [
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'c'.repeat(64), size: 150 }
  ];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  const entry = mf.entries[0];
  assert.equal(entry.relative_path, 'claude/CLAUDE.md',
    `relative_path must be {adapter}/{path}, got: ${entry.relative_path}`);
});

test('BF-04: each entry has sha256_pre_write (64-char hex)', () => {
  const { createManifestJSON } = getLib();
  const sha = 'd'.repeat(64);
  const files = [{ adapter: 'codex', path: 'AGENTS.md', sha256: sha, size: 300 }];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.equal(mf.entries[0].sha256_pre_write, sha,
    `sha256_pre_write must equal input sha256, got: ${mf.entries[0].sha256_pre_write}`);
  assert.ok(/^[0-9a-f]{64}$/.test(mf.entries[0].sha256_pre_write),
    'sha256_pre_write must be 64-char lowercase hex');
});

test('BF-04: each entry has file_size_bytes', () => {
  const { createManifestJSON } = getLib();
  const files = [{ adapter: 'claude', path: 'CLAUDE.md', sha256: 'e'.repeat(64), size: 9999 }];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.equal(mf.entries[0].file_size_bytes, 9999,
    `file_size_bytes must equal input size, got: ${mf.entries[0].file_size_bytes}`);
});

test('BF-04: each entry has block_ids_modified array (empty when not provided)', () => {
  const { createManifestJSON } = getLib();
  const files = [{ adapter: 'claude', path: 'CLAUDE.md', sha256: 'f'.repeat(64), size: 100 }];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.ok(Array.isArray(mf.entries[0].block_ids_modified),
    'block_ids_modified must be array');
  assert.equal(mf.entries[0].block_ids_modified.length, 0,
    'block_ids_modified must be empty when not provided');
});

test('BF-04: block_ids_modified populated when provided in input', () => {
  const { createManifestJSON } = getLib();
  const blockIds = ['block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2'];
  const files = [{
    relative_path: 'claude/CLAUDE.md',
    sha256_pre_write: 'a'.repeat(64),
    file_size_bytes: 500,
    block_ids_modified: blockIds
  }];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.deepEqual(mf.entries[0].block_ids_modified, blockIds,
    `block_ids_modified must match input: ${JSON.stringify(mf.entries[0].block_ids_modified)}`);
});

test('BF-04: entries sorted alphabetically by relative_path', () => {
  const { createManifestJSON } = getLib();
  const files = [
    { adapter: 'codex', path: 'AGENTS.md', sha256: 'z'.repeat(64), size: 100 },
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'a'.repeat(64), size: 200 }
  ];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  const paths = mf.entries.map(e => e.relative_path);
  const sorted = [...paths].sort();
  assert.deepEqual(paths, sorted,
    `entries must be sorted by relative_path, got: ${JSON.stringify(paths)}`);
});

test('BF-04: total_bytes is sum of file_size_bytes', () => {
  const { createManifestJSON } = getLib();
  const files = [
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'a'.repeat(64), size: 300 },
    { adapter: 'codex', path: 'AGENTS.md', sha256: 'b'.repeat(64), size: 700 }
  ];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.equal(mf.total_bytes, 1000,
    `total_bytes must be 300+700=1000, got: ${mf.total_bytes}`);
});

test('BF-04: createManifestJSON is byte-stable — identical input produces identical JSON', () => {
  const { createManifestJSON } = getLib();
  const files = [
    { adapter: 'codex', path: 'AGENTS.md', sha256: 'a'.repeat(64), size: 100 },
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'b'.repeat(64), size: 200 }
  ];
  const ts = '2026-05-03T10:00:00Z';
  const json1 = createManifestJSON(files, ts);
  const json2 = createManifestJSON(files, ts);
  assert.equal(json1, json2, 'createManifestJSON must be byte-stable for identical input');
});

// ── BF-04: readManifest backward compat ────────────────────────────────────

test('BF-04: readManifest exported from snapshot.cjs', () => {
  const lib = getLib();
  assert.ok(typeof lib.readManifest === 'function',
    'readManifest must be exported from snapshot.cjs');
});

test('BF-04: readManifest reads soma-snapshot/v1 (old schema) → normalized entries', () => {
  const { readManifest } = getLib();
  const tmpDir = makeTmpDir('soma-bf04-v1-');
  const mPath = path.join(tmpDir, 'manifest.json');
  const oldManifest = {
    schema: 'soma-snapshot/v1',
    timestamp: '2026-05-01T10:00:00Z',
    files: [
      { adapter: 'claude', path: 'CLAUDE.md', sha256: 'a'.repeat(64) },
      { adapter: 'codex', path: 'AGENTS.md', sha256: 'b'.repeat(64) }
    ],
    total_bytes: 5000
  };
  fs.writeFileSync(mPath, JSON.stringify(oldManifest, null, 2));

  const result = readManifest(mPath);
  assert.equal(result.schema, 'soma-snapshot/v1', 'schema must be preserved');
  assert.ok(Array.isArray(result.entries), 'result must have entries array');
  assert.equal(result.entries.length, 2, 'entries must have 2 items');
  // Normalize: relative_path = adapter/path
  assert.equal(result.entries[0].relative_path, 'claude/CLAUDE.md',
    `first entry relative_path, got: ${result.entries[0].relative_path}`);
  assert.equal(result.entries[0].sha256_pre_write, 'a'.repeat(64),
    'sha256_pre_write must be normalized from sha256');
  assert.ok(Array.isArray(result.entries[0].block_ids_modified),
    'block_ids_modified must be array (empty for v1)');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-04: readManifest reads soma-snapshot-manifest/v1 (new schema) → normalized entries', () => {
  const { readManifest } = getLib();
  const tmpDir = makeTmpDir('soma-bf04-v2-');
  const mPath = path.join(tmpDir, 'manifest.json');
  const newManifest = {
    schema: 'soma-snapshot-manifest/v1',
    timestamp: '2026-05-03T10:00:00Z',
    entries: [
      {
        relative_path: 'claude/CLAUDE.md',
        absolute_path: '/tmp/test/CLAUDE.md',
        sha256_pre_write: 'c'.repeat(64),
        file_size_bytes: 12345,
        block_ids_modified: ['block.claude.CLAUDE_md.cbm']
      }
    ],
    total_bytes: 12345
  };
  fs.writeFileSync(mPath, JSON.stringify(newManifest, null, 2));

  const result = readManifest(mPath);
  assert.equal(result.schema, 'soma-snapshot-manifest/v1');
  assert.ok(Array.isArray(result.entries), 'result must have entries array');
  assert.equal(result.entries[0].relative_path, 'claude/CLAUDE.md');
  assert.equal(result.entries[0].sha256_pre_write, 'c'.repeat(64));
  assert.equal(result.entries[0].file_size_bytes, 12345);
  assert.deepEqual(result.entries[0].block_ids_modified, ['block.claude.CLAUDE_md.cbm']);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-04: readManifest throws MANIFEST_SCHEMA_INVALID on unknown schema', () => {
  const { readManifest } = getLib();
  const tmpDir = makeTmpDir('soma-bf04-bad-');
  const mPath = path.join(tmpDir, 'manifest.json');
  fs.writeFileSync(mPath, JSON.stringify({ schema: 'invalid-schema/v99', files: [] }));

  assert.throws(
    () => readManifest(mPath),
    (err) => {
      assert.equal(err.code, 'MANIFEST_SCHEMA_INVALID',
        `Expected MANIFEST_SCHEMA_INVALID, got: ${err.code}`);
      return true;
    },
    'readManifest must throw MANIFEST_SCHEMA_INVALID for unknown schema'
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-04: readManifest throws MANIFEST_MISSING when file does not exist', () => {
  const { readManifest } = getLib();
  assert.throws(
    () => readManifest('/tmp/nonexistent-path/manifest.json'),
    (err) => {
      assert.equal(err.code, 'MANIFEST_MISSING',
        `Expected MANIFEST_MISSING, got: ${err.code}`);
      return true;
    },
    'readManifest must throw MANIFEST_MISSING when file not found'
  );
});

// ── BF-05: dedup in createSnapshot ───────────────────────────────────────────

test('BF-05: createSnapshot with 3 file entries for same path → 1 deduplicated manifest entry', () => {
  const { createSnapshot } = getLib();
  const tmpDir = makeTmpDir('soma-bf05-dedup-');
  const snapshotsBase = path.join(tmpDir, '.snapshots');
  const targetFile = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(targetFile, 'Pre-write content for dedup test.\n');

  // 3 entries all pointing to same file (simulates 3 install-targets entries for CLAUDE.md)
  const files = [
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.claude.CLAUDE_md.cbm' },
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.claude.CLAUDE_md.hyd-v2' },
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.claude.CLAUDE_md.soma-stsd' }
  ];

  const result = createSnapshot({ snapshotsBase, files, now: new Date('2026-05-03T10:00:00Z') });

  const mf = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(mf.entries.length, 1,
    `BF-05: must have 1 deduplicated entry, got ${mf.entries.length}: ${JSON.stringify(mf.entries.map(e => e.relative_path))}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-05: createSnapshot aggregates block_ids_modified from all same-path entries', () => {
  const { createSnapshot } = getLib();
  const tmpDir = makeTmpDir('soma-bf05-blockids-');
  const snapshotsBase = path.join(tmpDir, '.snapshots');
  const targetFile = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(targetFile, 'Pre-write content for block_ids test.\n');

  const files = [
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.claude.CLAUDE_md.cbm' },
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.claude.CLAUDE_md.hyd-v2' },
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.claude.CLAUDE_md.soma-stsd' }
  ];

  const result = createSnapshot({ snapshotsBase, files, now: new Date('2026-05-03T10:00:01Z') });

  const mf = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  const entry = mf.entries[0];
  assert.ok(Array.isArray(entry.block_ids_modified), 'block_ids_modified must be array');
  assert.equal(entry.block_ids_modified.length, 3,
    `Must aggregate 3 block_ids, got: ${JSON.stringify(entry.block_ids_modified)}`);
  assert.ok(entry.block_ids_modified.includes('block.claude.CLAUDE_md.cbm'), 'must include cbm');
  assert.ok(entry.block_ids_modified.includes('block.claude.CLAUDE_md.hyd-v2'), 'must include hyd-v2');
  assert.ok(entry.block_ids_modified.includes('block.claude.CLAUDE_md.soma-stsd'), 'must include soma-stsd');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-05: createSnapshot 2 files at same path + 1 different path → 2 deduplicated entries', () => {
  const { createSnapshot } = getLib();
  const tmpDir = makeTmpDir('soma-bf05-mixed-');
  const snapshotsBase = path.join(tmpDir, '.snapshots');
  const file1 = path.join(tmpDir, 'CLAUDE.md');
  const file2 = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(file1, 'Claude pre-write.\n');
  fs.writeFileSync(file2, 'Agents pre-write.\n');

  const files = [
    { adapter: 'claude', targetPath: file1, relativePath: 'CLAUDE.md', blockId: 'block.cbm' },
    { adapter: 'claude', targetPath: file1, relativePath: 'CLAUDE.md', blockId: 'block.hyd' },
    { adapter: 'codex', targetPath: file2, relativePath: 'AGENTS.md' }
  ];

  const result = createSnapshot({ snapshotsBase, files, now: new Date('2026-05-03T10:00:02Z') });

  const mf = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(mf.entries.length, 2,
    `Must have 2 deduplicated entries, got ${mf.entries.length}: ${JSON.stringify(mf.entries.map(e => e.relative_path))}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-05: dedup preserves sha256_pre_write (first occurrence wins)', () => {
  const { createSnapshot } = getLib();
  const tmpDir = makeTmpDir('soma-bf05-sha-');
  const snapshotsBase = path.join(tmpDir, '.snapshots');
  const targetFile = path.join(tmpDir, 'CLAUDE.md');
  const content = 'Content for sha256 preservation test.\n';
  fs.writeFileSync(targetFile, content);
  const expectedSha = sha256Buf(Buffer.from(content));

  const files = [
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block-1' },
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block-2' }
  ];

  const result = createSnapshot({ snapshotsBase, files, now: new Date('2026-05-03T10:00:03Z') });

  const mf = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(mf.entries[0].sha256_pre_write, expectedSha,
    `sha256_pre_write must match file content sha256`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Backward compat: old format inputs ───────────────────────────────────────

test('Backward compat: createManifestJSON accepts old {adapter, path, sha256, size} format', () => {
  const { createManifestJSON } = getLib();
  // Old-format input (what tests and old code may pass)
  const fakeFiles = [
    { adapter: 'codex', path: 'AGENTS.md', sha256: 'a'.repeat(64), size: 100 },
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'b'.repeat(64), size: 200 }
  ];
  const ts = '2026-05-03T10:00:00Z';
  // Must not throw, must produce valid JSON with new schema
  let json;
  assert.doesNotThrow(() => { json = createManifestJSON(fakeFiles, ts); });
  const mf = JSON.parse(json);
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1');
  assert.equal(mf.entries.length, 2);
  // entries sorted by relative_path: claude/CLAUDE.md < codex/AGENTS.md
  const agentsEntry = mf.entries.find(e => e.relative_path === 'codex/AGENTS.md');
  const claudeEntry = mf.entries.find(e => e.relative_path === 'claude/CLAUDE.md');
  assert.ok(agentsEntry, 'must have codex/AGENTS.md entry');
  assert.equal(agentsEntry.sha256_pre_write, 'a'.repeat(64));
  assert.equal(agentsEntry.file_size_bytes, 100);
  assert.ok(claudeEntry, 'must have claude/CLAUDE.md entry');
  assert.equal(claudeEntry.sha256_pre_write, 'b'.repeat(64));
  assert.equal(claudeEntry.file_size_bytes, 200);
});

test('Backward compat: createManifestJSON new format {relative_path, sha256_pre_write, file_size_bytes}', () => {
  const { createManifestJSON } = getLib();
  const files = [
    {
      relative_path: 'claude/CLAUDE.md',
      sha256_pre_write: 'c'.repeat(64),
      file_size_bytes: 500,
      block_ids_modified: ['block.cbm', 'block.hyd']
    }
  ];
  const json = createManifestJSON(files, '2026-05-03T10:00:00Z');
  const mf = JSON.parse(json);
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1');
  assert.equal(mf.entries[0].relative_path, 'claude/CLAUDE.md');
  assert.deepEqual(mf.entries[0].block_ids_modified, ['block.cbm', 'block.hyd']);
});

// ── SUPPORTED_SCHEMAS export ──────────────────────────────────────────────────

test('BF-04: SUPPORTED_SCHEMAS exported and includes both v1 schemas', () => {
  const lib = getLib();
  assert.ok(Array.isArray(lib.SUPPORTED_SCHEMAS), 'SUPPORTED_SCHEMAS must be exported as array');
  assert.ok(lib.SUPPORTED_SCHEMAS.includes('soma-snapshot/v1'),
    'SUPPORTED_SCHEMAS must include soma-snapshot/v1');
  assert.ok(lib.SUPPORTED_SCHEMAS.includes('soma-snapshot-manifest/v1'),
    'SUPPORTED_SCHEMAS must include soma-snapshot-manifest/v1');
});

// ── BF-08: createSnapshot must emit absolute_path per manifest entry ──────────
//
// Regression tests for BF-08: createSnapshot was building manifest entries without
// absolute_path, causing rollback.cjs to silently skip every entry (entry.absolute_path
// is undefined → rollback skips → no restore happens → round-trip identity fails).
//
// Fix: createSnapshot must populate absolute_path = path.resolve(targetPath) per entry.

test('BF-08 RED→GREEN: createSnapshot emits absolute_path per manifest entry', () => {
  const { createSnapshot } = getLib();
  const tmpDir = makeTmpDir('soma-bf08-abs-');
  const snapshotsBase = path.join(tmpDir, '.snapshots');
  const targetFile = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(targetFile, 'BF-08 regression content.\n');

  const files = [
    { adapter: 'claude', targetPath: targetFile, relativePath: 'CLAUDE.md', blockId: 'block.bf08' }
  ];

  const result = createSnapshot({ snapshotsBase, files, now: new Date('2026-05-03T12:00:00Z') });

  const mf = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.ok(mf.entries.length > 0, 'manifest must have at least 1 entry');
  const entry = mf.entries[0];

  // BF-08: absolute_path must be present and non-null/non-empty
  assert.ok(
    entry.absolute_path != null && entry.absolute_path !== '',
    `BF-08: manifest entry must have absolute_path, got: ${JSON.stringify(entry.absolute_path)}`
  );

  // absolute_path must be an absolute fs path (starts with /)
  assert.ok(
    path.isAbsolute(entry.absolute_path),
    `BF-08: absolute_path must be absolute, got: ${entry.absolute_path}`
  );

  // absolute_path must match the source targetPath (resolved)
  assert.equal(
    entry.absolute_path,
    path.resolve(targetFile),
    `BF-08: absolute_path must equal path.resolve(targetPath), got: ${entry.absolute_path}`
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BF-08 round-trip: createSnapshot then readManifest preserves absolute_path intact', () => {
  const { createSnapshot, readManifest } = getLib();
  const tmpDir = makeTmpDir('soma-bf08-rt-');
  const snapshotsBase = path.join(tmpDir, '.snapshots');
  const targetFile = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(targetFile, 'BF-08 round-trip content.\n');

  const files = [
    { adapter: 'codex', targetPath: targetFile, relativePath: 'AGENTS.md', blockId: 'block.bf08.rt' }
  ];

  const result = createSnapshot({ snapshotsBase, files, now: new Date('2026-05-03T12:00:01Z') });

  // Round-trip: read back via readManifest (the same function rollback.cjs uses)
  const manifest = readManifest(result.manifestPath);

  assert.ok(manifest.entries.length > 0, 'readManifest must return at least 1 entry');
  const entry = manifest.entries[0];

  // BF-08: absolute_path must survive the round-trip through readManifest
  assert.ok(
    entry.absolute_path != null && entry.absolute_path !== '',
    `BF-08 round-trip: absolute_path must survive readManifest, got: ${JSON.stringify(entry.absolute_path)}`
  );

  assert.equal(
    entry.absolute_path,
    path.resolve(targetFile),
    `BF-08 round-trip: absolute_path must match original targetPath after readManifest, got: ${entry.absolute_path}`
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
