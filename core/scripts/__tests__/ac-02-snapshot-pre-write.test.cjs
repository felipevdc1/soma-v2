'use strict';
// @spec AC-02
// @contract CONTRACT-SYNC-APPLY-01
// T-04: AC-02 — snapshot pre-write, created BEFORE source modification.

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac02-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  // NOTE: extractBlock returns content WITHOUT trailing newline (line-based splitting)
  // So sha256 must be computed on content-without-trailing-newline
  const newBlockContent = '# New source content'; // no trailing newline (what extractBlock returns)
  const oldBlockContent = '# Old content'; // no trailing newline
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=ac02-block version=1.0 -->\n${newBlockContent}\n<!-- soma-v2:end id=ac02-block -->`);
  const targetFile = path.join(dir, 'target.md');
  // Target with old content (sha256 of old content as extracted by extractBlock)
  const oldSha = crypto.createHash('sha256').update(oldBlockContent).digest('hex');
  fs.writeFileSync(targetFile,
    `# Target\n<!-- soma-v2:start id=ac02-block version=0.9 sha256=${oldSha} -->\n${oldBlockContent}\n<!-- soma-v2:end id=ac02-block -->\n`);
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac02-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac02-block' }]
  }));
  return { somaDir: dir, targetFile, originalContent: fs.readFileSync(targetFile, 'utf8') };
}

test('AC-02: --apply with drift creates .snapshots/{ISO}/{adapter}/{filename} before write', () => {
  const { somaDir, targetFile, originalContent } = createDriftFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot !== null, 'snapshot must not be null');
  // Verify snapshot file contains pre-write content
  const snapPath = out.snapshot.path;
  assert.ok(fs.existsSync(snapPath), `Snapshot dir must exist: ${snapPath}`);
  // Find snapshot files
  const snapFiles = [];
  function walkDir(d) {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walkDir(full);
      else if (!f.endsWith('manifest.json')) snapFiles.push(full);
    }
  }
  walkDir(snapPath);
  assert.ok(snapFiles.length > 0, 'Snapshot must contain at least one file copy');
  // Snapshot content must match pre-write content
  const snapContent = fs.readFileSync(snapFiles[0], 'utf8');
  assert.equal(snapContent, originalContent, 'Snapshot content must be pre-write original');
});

test('AC-02: snapshot dir created with permissions 0700 (user-only)', () => {
  const { somaDir } = createDriftFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  const snapPath = out.snapshot.path;
  const stat = fs.statSync(snapPath);
  const mode = stat.mode & 0o777;
  assert.equal(mode, 0o700, `Snapshot dir must have mode 0700, got ${mode.toString(8)}`);
});

test('AC-02: source file is modified after snapshot (not before)', () => {
  const { somaDir, targetFile, originalContent } = createDriftFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  // After apply, source must be different (modified)
  const afterContent = fs.readFileSync(targetFile, 'utf8');
  assert.notEqual(afterContent, originalContent, 'Source file must be modified by --apply');
});
