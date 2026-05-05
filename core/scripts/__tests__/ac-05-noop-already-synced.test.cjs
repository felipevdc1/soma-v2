'use strict';
// @spec AC-05
// @contract CONTRACT-SYNC-APPLY-01
// T-07: AC-05 — noop when already synced.

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

function createSyncedFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac05-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  // NOTE: extractBlock returns content WITHOUT trailing newline (line-based splitting)
  // So sha256 must be computed on content-without-trailing-newline
  const blockContent = '# Synced content'; // NO trailing \n — matches what extractBlock returns
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=ac05-block version=1.0 -->\n${blockContent}\n<!-- soma-v2:end id=ac05-block -->`);
  const targetFile = path.join(dir, 'target.md');
  // Compute correct sha256 and write target as already synced
  const sha = crypto.createHash('sha256').update(blockContent).digest('hex');
  fs.writeFileSync(targetFile,
    `# Target\n<!-- soma-v2:start id=ac05-block version=1.0 sha256=${sha} -->\n${blockContent}\n<!-- soma-v2:end id=ac05-block -->\n`);
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac05-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac05-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-05: --apply on already-synced state exits 0', () => {
  const { somaDir } = createSyncedFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0 on already-synced, got ${r.status}. stderr: ${r.stderr}`);
});

test('AC-05: --apply noop has null snapshot', () => {
  const { somaDir } = createSyncedFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snapshot, null, 'snapshot must be null on noop');
});

test('AC-05: --apply noop has empty files_touched', () => {
  const { somaDir } = createSyncedFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.files_touched.length, 0, 'files_touched must be empty on noop');
});

test('AC-05: --apply noop does not create .snapshots dir', () => {
  const { somaDir } = createSyncedFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(fs.existsSync(path.join(somaDir, '.snapshots')), false,
    '.snapshots must not be created on noop');
});

test('AC-05: --apply noop human output says "already in sync"', () => {
  const { somaDir } = createSyncedFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  assert.ok(r.stdout.includes('already in sync') || r.stdout.includes('Already in sync'),
    `Expected "already in sync" message, got: ${r.stdout.slice(0, 300)}`);
});
