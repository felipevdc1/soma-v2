'use strict';
// @spec AC-08
// @contract CONTRACT-SYNC-APPLY-01
// T-10: AC-08 — ANCHOR_PARSE_ERROR when target has malformed anchor block.

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

function createBrokenAnchorFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac08-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  // Well-formed source
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=ac08-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=ac08-block -->');
  const targetFile = path.join(dir, 'target.md');
  // Target with broken anchor: start marker exists but no end marker
  fs.writeFileSync(targetFile,
    '# Target\n<!-- soma-v2:start id=ac08-block version=0.9 -->\n# Old content\n<!-- NO END MARKER -->\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac08-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac08-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-08: ANCHOR_PARSE_ERROR exits 1', () => {
  const { somaDir } = createBrokenAnchorFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test('AC-08: ANCHOR_PARSE_ERROR error.code === "ANCHOR_PARSE_ERROR"', () => {
  const { somaDir } = createBrokenAnchorFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'ANCHOR_PARSE_ERROR', `Expected ANCHOR_PARSE_ERROR, got: ${out.error?.code}`);
});

test('AC-08: ANCHOR_PARSE_ERROR — snapshot NOT written (D2 all-or-nothing)', () => {
  const { somaDir } = createBrokenAnchorFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snapshot, null, 'snapshot must be null on ANCHOR_PARSE_ERROR');
  assert.equal(fs.existsSync(path.join(somaDir, '.snapshots')), false,
    '.snapshots dir must not be created on ANCHOR_PARSE_ERROR');
});

test('AC-08: ANCHOR_PARSE_ERROR — source file untouched', () => {
  const { somaDir, targetFile } = createBrokenAnchorFixture();
  const shaBefore = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const shaAfter = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  assert.equal(shaAfter, shaBefore, 'Source must be untouched on ANCHOR_PARSE_ERROR');
});
