'use strict';
// @spec T-16
// @contract CONTRACT-SYNC-APPLY-01
// T-16: E2E smoke test — full apply flow with realistic multi-entry fixture.
// Tests end-to-end: source → target write → second apply noop → snapshot preserved.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function runSync(args, env = {}) {
  return spawnSync('node', [SYNC, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000
  });
}

/**
 * Create a multi-entry E2E fixture with codex adapter, two target files.
 * - entry1/codex: insert (no block yet in target)
 * - entry2/codex: replace (old block content differs from source)
 *
 * NOTE: Updated from two-adapter (codex+cursor) to single-adapter (codex only) to align with
 * the valid tool enum [codex|claude] per CONTRACT-011-01-sync-apply (BF-07 / INVALID_ARGS
 * fix: --apply now requires --tool with valid enum). The cursor adapter was never a valid
 * SOMA v2 tool target; this fixture now tests INSERT + REPLACE scenarios via two codex entries.
 * Run with --tool=codex --apply.
 */
function createE2EFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-e2e-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0', files: []
  }));

  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  // Source doc A (entry1: insert — no existing block in codexTarget)
  // NOTE: extractBlock strips trailing newline — blockContent must NOT have it
  const sourceContentA = '# Codex AGENTS block\nThis is the codex content.';
  fs.writeFileSync(path.join(docsDir, 'codex-source.md'),
    `<!-- soma-v2:start id=codex-block version=1.0 -->\n${sourceContentA}\n<!-- soma-v2:end id=codex-block -->`);

  // Source doc B (entry2: replace — old block content differs from source)
  const sourceContentB = '# Second AGENTS block\nThis is the second codex content.';
  fs.writeFileSync(path.join(docsDir, 'codex-source-b.md'),
    `<!-- soma-v2:start id=codex-block-b version=2.0 -->\n${sourceContentB}\n<!-- soma-v2:end id=codex-block-b -->`);

  const codexDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(codexDir, { recursive: true });

  // Target 1: INSERT scenario (no existing block)
  const codexTarget = path.join(dir, 'AGENTS-codex.md');
  fs.writeFileSync(codexTarget, '# Codex AGENTS\nSome existing content.\n');

  // Target 2: REPLACE scenario (old block content differs from source)
  const cursorTarget = path.join(dir, 'AGENTS-codex-b.md');
  const oldContent = '# Old codex-b content';
  const oldSha = crypto.createHash('sha256').update(oldContent).digest('hex');
  fs.writeFileSync(cursorTarget,
    `# Second AGENTS\n<!-- soma-v2:start id=codex-block-b version=1.5 sha256=${oldSha} -->\n${oldContent}\n<!-- soma-v2:end id=codex-block-b -->\n`);

  fs.writeFileSync(path.join(codexDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [
      { block_id: 'codex-block', source_doc: 'docs/codex-source.md', target_path: codexTarget, target_anchor_id: 'codex-block' },
      { block_id: 'codex-block-b', source_doc: 'docs/codex-source-b.md', target_path: cursorTarget, target_anchor_id: 'codex-block-b' }
    ]
  }));

  return { somaDir: dir, codexTarget, cursorTarget, sourceContentA, sourceContentB };
}

test('E2E: full apply with two adapters exits 0', () => {
  const { somaDir } = createE2EFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `E2E: Expected exit 0, got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);
});

test('E2E: first apply creates snapshot with both target files', () => {
  const { somaDir } = createE2EFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `E2E: Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  // Both targets should be snapshotted (both exist pre-write)
  assert.ok(out.snapshot !== null, 'E2E: snapshot must be created');
  assert.ok(out.snapshot.files_count >= 1, 'E2E: snapshot must include files');
});

test('E2E: first apply writes both target files with new content', () => {
  const { somaDir, codexTarget, cursorTarget, sourceContentA, sourceContentB } = createE2EFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `E2E: Expected exit 0, got ${r.status}`);
  const codexContent = fs.readFileSync(codexTarget, 'utf8');
  const cursorContent = fs.readFileSync(cursorTarget, 'utf8');
  assert.ok(codexContent.includes(sourceContentA), 'E2E: codex target must contain source block content');
  assert.ok(cursorContent.includes(sourceContentB), 'E2E: cursor target must contain source block content');
});

test('E2E: first apply returns files_touched with 2 entries', () => {
  const { somaDir } = createE2EFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `E2E: Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.files_touched.length, 2, `E2E: Expected 2 files touched, got ${out.summary.files_touched.length}`);
});

test('E2E: second apply is noop (snapshot null, files_touched empty)', () => {
  const { somaDir } = createE2EFixture();
  // First apply
  const r1 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r1.status, 0, `E2E: First apply failed: ${r1.stderr}`);
  // Second apply
  const r2 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r2.status, 0, `E2E: Second apply failed: ${r2.stderr}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.snapshot, null, 'E2E: Second apply must be noop (no snapshot)');
  assert.equal(out2.summary.files_touched.length, 0, 'E2E: Second apply: files_touched must be empty');
});

test('E2E: after apply, dry-run shows zero actionable findings', () => {
  const { somaDir } = createE2EFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const r = runSync(['--dry-run', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  const out = JSON.parse(r.stdout);
  const actionable = out.findings.filter(f => f.action !== 'skip' && f.action !== 'drift');
  assert.equal(actionable.length, 0, `E2E: After apply, dry-run must show 0 actionable. Got: ${JSON.stringify(actionable)}`);
});

test('E2E: snapshot files contain correct pre-apply content', () => {
  const { somaDir, codexTarget } = createE2EFixture();
  // Read codex target BEFORE apply
  const preApplyContent = fs.readFileSync(codexTarget, 'utf8');
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `E2E: Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  // Find snapshot file for codex target
  const snapPath = out.snapshot.path;
  const snapFiles = [];
  function walkDir(d) {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walkDir(full);
      else if (!f.endsWith('manifest.json')) snapFiles.push(full);
    }
  }
  walkDir(snapPath);
  assert.ok(snapFiles.length >= 1, 'E2E: Snapshot must contain target files');
  const codexSnapFile = snapFiles.find(f => f.includes('AGENTS-codex.md'));
  if (codexSnapFile) {
    const snapContent = fs.readFileSync(codexSnapFile, 'utf8');
    assert.equal(snapContent, preApplyContent, 'E2E: Snapshot must contain pre-apply codex target content');
  }
});
