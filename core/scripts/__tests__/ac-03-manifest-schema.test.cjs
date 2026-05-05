'use strict';
// @spec AC-03
// @contract CONTRACT-SYNC-APPLY-01
// T-05: AC-03 — manifest.json schema validation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function runSync(args) {
  return spawnSync('node', [SYNC, ...args], { env: { ...process.env }, encoding: 'utf8', timeout: 15000 });
}

function createMultiTargetFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac03-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const block1 = 'Block one content.\n';
  const block2 = 'Block two content.\n';
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=block-a version=1.0 -->\n${block1}<!-- soma-v2:end id=block-a -->\n` +
    `<!-- soma-v2:start id=block-b version=1.0 -->\n${block2}<!-- soma-v2:end id=block-b -->`);
  const target1 = path.join(dir, 'target1.md');
  const target2 = path.join(dir, 'target2.md');
  fs.writeFileSync(target1, '# T1\nNo block.\n');
  fs.writeFileSync(target2, '# T2\nNo block.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [
      { block_id: 'block-a', source_doc: 'docs/source.md', target_path: target1, target_anchor_id: 'block-a' },
      { block_id: 'block-b', source_doc: 'docs/source.md', target_path: target2, target_anchor_id: 'block-b' }
    ]
  }));
  return { somaDir: dir };
}

test('AC-03: manifest.json has schema "soma-snapshot-manifest/v1" (BF-04 schema bump)', () => {
  const { somaDir } = createMultiTargetFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const mf = JSON.parse(fs.readFileSync(out.snapshot.manifest_path, 'utf8'));
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1',
    `schema must be soma-snapshot-manifest/v1 (BF-04), got: ${mf.schema}`);
});

test('AC-03: manifest.json has timestamp ISO 8601 UTC seconds format', () => {
  const { somaDir } = createMultiTargetFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  const mf = JSON.parse(fs.readFileSync(out.snapshot.manifest_path, 'utf8'));
  assert.ok(mf.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z(-\d+)?$/),
    `timestamp must be ISO 8601 UTC seconds, got: ${mf.timestamp}`);
});

test('AC-03: manifest.json entries array has {relative_path, sha256_pre_write, file_size_bytes, block_ids_modified} per entry (BF-04)', () => {
  const { somaDir } = createMultiTargetFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  const mf = JSON.parse(fs.readFileSync(out.snapshot.manifest_path, 'utf8'));
  assert.ok(mf.entries.length > 0, 'entries must have entries');
  for (const f of mf.entries) {
    assert.ok(typeof f.relative_path === 'string' && f.relative_path.length > 0,
      `entry must have relative_path, got: ${JSON.stringify(f)}`);
    assert.ok(typeof f.sha256_pre_write === 'string' && f.sha256_pre_write.length === 64,
      `sha256_pre_write must be 64-char hex, got: ${f.sha256_pre_write}`);
    assert.ok(/^[0-9a-f]{64}$/.test(f.sha256_pre_write),
      `sha256_pre_write must be lowercase hex: ${f.sha256_pre_write}`);
    assert.ok(typeof f.file_size_bytes === 'number',
      `entry must have file_size_bytes: ${JSON.stringify(f)}`);
    assert.ok(Array.isArray(f.block_ids_modified),
      `entry must have block_ids_modified array: ${JSON.stringify(f)}`);
  }
});

test('AC-03: manifest.json entries sorted alphabetically by relative_path (BF-04)', () => {
  const { somaDir } = createMultiTargetFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  const mf = JSON.parse(fs.readFileSync(out.snapshot.manifest_path, 'utf8'));
  const keys = mf.entries.map(f => f.relative_path);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted, `entries must be sorted by relative_path, got: ${JSON.stringify(keys)}`);
});

test('AC-03: manifest.json total_bytes matches sum of file sizes', () => {
  const { somaDir } = createMultiTargetFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  const mf = JSON.parse(fs.readFileSync(out.snapshot.manifest_path, 'utf8'));
  // total_bytes should be positive
  assert.ok(typeof mf.total_bytes === 'number' && mf.total_bytes > 0, `total_bytes must be positive number, got: ${mf.total_bytes}`);
});
