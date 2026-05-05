'use strict';
// @spec AC-06
// @contract CONTRACT-SYNC-APPLY-01
// T-08: AC-06 — SNAPSHOT_CREATE_FAILED, source untouched.

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

function createDriftFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac06-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const blockContent = '# Content\n';
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=ac06-block version=1.0 -->\n${blockContent}<!-- soma-v2:end id=ac06-block -->`);
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac06-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac06-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-06: SNAPSHOT_CREATE_FAILED exits 1', () => {
  const { somaDir, targetFile } = createDriftFixture();
  const snapDir = path.join(somaDir, '.snapshots');
  fs.mkdirSync(snapDir);
  fs.chmodSync(snapDir, 0o000);
  try {
    const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
    assert.equal(r.status, 1, `Expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
  } finally {
    fs.chmodSync(snapDir, 0o755);
  }
});

test('AC-06: SNAPSHOT_CREATE_FAILED error.code === "SNAPSHOT_CREATE_FAILED"', () => {
  const { somaDir, targetFile } = createDriftFixture();
  const snapDir = path.join(somaDir, '.snapshots');
  fs.mkdirSync(snapDir);
  fs.chmodSync(snapDir, 0o000);
  try {
    const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, 'SNAPSHOT_CREATE_FAILED', `Expected SNAPSHOT_CREATE_FAILED, got: ${out.error?.code}`);
  } finally {
    fs.chmodSync(snapDir, 0o755);
  }
});

test('AC-06: SNAPSHOT_CREATE_FAILED — source file untouched (D2 atomicity)', () => {
  const { somaDir, targetFile } = createDriftFixture();
  const shaBefore = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  const snapDir = path.join(somaDir, '.snapshots');
  fs.mkdirSync(snapDir);
  fs.chmodSync(snapDir, 0o000);
  try {
    runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
    const shaAfter = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
    assert.equal(shaAfter, shaBefore, 'Source must be untouched when SNAPSHOT_CREATE_FAILED');
  } finally {
    fs.chmodSync(snapDir, 0o755);
  }
});
