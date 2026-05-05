'use strict';
// @spec AC-07
// @contract CONTRACT-SYNC-APPLY-01
// T-09: AC-07 — SOURCE_STALE when source mutated between preview and write.
// Note: "source" in AC-07 means the TARGET file being written (the adapter dest),
// not the SOMA source doc. The stale check is: source file sha256 captured at
// preview time, re-checked at write time. If changed → SOURCE_STALE.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac07-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=ac07-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=ac07-block -->');
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac07-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac07-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-07: SOURCE_STALE via STALE_SHA_INJECT env → exits 1', () => {
  // We implement SOURCE_STALE detection via an env var hook for testing:
  // SOMA_TEST_STALE_TARGET=<path> causes sync to see a stale sha256 mismatch.
  // Implementation: sync captures sha256 of target at preview, then re-checks before write.
  // For testability, we inject a fake "expected sha" via env that won't match.
  const { somaDir, targetFile } = createFixture();
  const r = spawnSync('node', [SYNC, '--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json'], {
    env: { ...process.env, SOMA_TEST_INJECT_STALE: targetFile },
    encoding: 'utf8', timeout: 15000
  });
  assert.equal(r.status, 1, `Expected exit 1 on SOURCE_STALE, got ${r.status}. stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SOURCE_STALE', `Expected SOURCE_STALE, got: ${out.error?.code}`);
});

test('AC-07: SOURCE_STALE — snapshot NOT created', () => {
  const { somaDir, targetFile } = createFixture();
  const r = spawnSync('node', [SYNC, '--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json'], {
    env: { ...process.env, SOMA_TEST_INJECT_STALE: targetFile },
    encoding: 'utf8', timeout: 15000
  });
  assert.equal(r.status, 1, `Expected exit 1, got ${r.status}`);
  assert.equal(fs.existsSync(path.join(somaDir, '.snapshots')), false,
    'Snapshot dir must not be created on SOURCE_STALE');
});

test('AC-07: SOURCE_STALE — source file untouched', () => {
  const { somaDir, targetFile } = createFixture();
  const shaBefore = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  spawnSync('node', [SYNC, '--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json'], {
    env: { ...process.env, SOMA_TEST_INJECT_STALE: targetFile },
    encoding: 'utf8', timeout: 15000
  });
  const shaAfter = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  assert.equal(shaAfter, shaBefore, 'Source file must be untouched on SOURCE_STALE');
});
