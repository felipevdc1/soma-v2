'use strict';
// @spec AC-09
// @contract CONTRACT-SYNC-APPLY-01
// T-11: AC-09 — manifest.json byte-stable across re-derivations.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function runSync(args) {
  return spawnSync('node', [SYNC, ...args], { env: { ...process.env }, encoding: 'utf8', timeout: 15000 });
}

function createMultiTargetFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac09-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const block1 = 'Block one.\n';
  const block2 = 'Block two.\n';
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=block-z version=1.0 -->\n${block1}<!-- soma-v2:end id=block-z -->\n` +
    `<!-- soma-v2:start id=block-a version=1.0 -->\n${block2}<!-- soma-v2:end id=block-a -->`);
  const target1 = path.join(dir, 'target-z.md');
  const target2 = path.join(dir, 'target-a.md');
  fs.writeFileSync(target1, '# TZ\nNo block.\n');
  fs.writeFileSync(target2, '# TA\nNo block.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [
      { block_id: 'block-z', source_doc: 'docs/source.md', target_path: target1, target_anchor_id: 'block-z' },
      { block_id: 'block-a', source_doc: 'docs/source.md', target_path: target2, target_anchor_id: 'block-a' }
    ]
  }));
  return { somaDir: dir };
}

function createFreshAndApply() {
  const { somaDir } = createMultiTargetFixture();
  // Re-create fixture in same dir as the targets need to drift again
  // Reinitialize the fixture to get fresh targets
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac09b-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const block1 = 'Block one.\n';
  const block2 = 'Block two.\n';
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=block-z version=1.0 -->\n${block1}<!-- soma-v2:end id=block-z -->\n` +
    `<!-- soma-v2:start id=block-a version=1.0 -->\n${block2}<!-- soma-v2:end id=block-a -->`);
  const target1 = path.join(dir, 'target-z.md');
  const target2 = path.join(dir, 'target-a.md');
  fs.writeFileSync(target1, '# TZ\nNo block.\n');
  fs.writeFileSync(target2, '# TA\nNo block.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [
      { block_id: 'block-z', source_doc: 'docs/source.md', target_path: target1, target_anchor_id: 'block-z' },
      { block_id: 'block-a', source_doc: 'docs/source.md', target_path: target2, target_anchor_id: 'block-a' }
    ]
  }));
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${dir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return { manifestPath: out.snapshot.manifest_path, manifestContent: fs.readFileSync(out.snapshot.manifest_path, 'utf8') };
}

test('AC-09: snapshot manifest.json is valid JSON with all required fields (BF-04 schema)', () => {
  const { manifestContent } = createFreshAndApply();
  const mf = JSON.parse(manifestContent);
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1',
    `schema must be soma-snapshot-manifest/v1 (BF-04), got: ${mf.schema}`);
  assert.ok(Array.isArray(mf.entries), 'manifest must have entries array (BF-04)');
  assert.ok(typeof mf.timestamp === 'string');
  assert.ok(typeof mf.total_bytes === 'number');
});

test('AC-09: snapshot manifest.json entries are sorted alphabetically by relative_path (BF-04)', () => {
  const { manifestContent } = createFreshAndApply();
  const mf = JSON.parse(manifestContent);
  const keys = mf.entries.map(f => f.relative_path);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted, `entries must be sorted by relative_path: ${JSON.stringify(keys)}`);
});

test('AC-09: snapshot manifest.json sha256_pre_write values are 64-char lowercase hex (BF-04)', () => {
  const { manifestContent } = createFreshAndApply();
  const mf = JSON.parse(manifestContent);
  for (const f of mf.entries) {
    assert.ok(/^[0-9a-f]{64}$/.test(f.sha256_pre_write),
      `sha256_pre_write must be 64-char lowercase hex: ${f.sha256_pre_write}`);
  }
});

test('AC-09: manifest.json is byte-stable — two calls with same content produce identical JSON string', () => {
  // snapshot lib must be deterministic: same content → same JSON output
  // We test by loading snapshot.cjs directly
  const snapshotLib = path.join(SOMA_HOME, 'scripts', 'lib', 'snapshot.cjs');
  // If snapshot.cjs doesn't exist yet, this test will fail (RED phase)
  assert.ok(fs.existsSync(snapshotLib), `snapshot.cjs must exist at: ${snapshotLib} (RED: not yet created)`);
  // Clear require cache to get fresh module (important for test isolation)
  delete require.cache[require.resolve(snapshotLib)];
  const snapshot = require(snapshotLib);
  // Call createManifest with same inputs twice, compare JSON
  // Use new-format fields (BF-04): still backward compat with old {adapter, path, sha256, size}
  const fakeFiles = [
    { adapter: 'codex', path: 'AGENTS.md', sha256: 'a'.repeat(64), size: 100 },
    { adapter: 'claude', path: 'CLAUDE.md', sha256: 'b'.repeat(64), size: 200 }
  ];
  const ts = '2026-05-02T10:00:00Z';
  const json1 = snapshot.createManifestJSON(fakeFiles, ts);
  const json2 = snapshot.createManifestJSON(fakeFiles, ts);
  assert.equal(json1, json2, 'createManifestJSON must be byte-stable for identical input');
  // Also verify new schema
  const mf = JSON.parse(json1);
  assert.equal(mf.schema, 'soma-snapshot-manifest/v1',
    `byte-stable JSON must use new schema (BF-04), got: ${mf.schema}`);
});
