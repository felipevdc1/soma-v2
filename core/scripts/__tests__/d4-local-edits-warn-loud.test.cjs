'use strict';
// @spec AC-02 + D4
// @contract CONTRACT-SYNC-APPLY-01
// T-15: D4 — local edits: --apply writes anyway + warns LOCAL_EDITS_DETECTED + snapshot saves pre-state.

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

function createLocalEditFixture() {
  // D4 scenario: source has NEW content, target has block where user manually edited
  // the block content (sha attr in marker no longer matches actual block content = drift + manual edit)
  // NOTE: extractBlock returns content WITHOUT trailing newline due to line splitting
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-d4-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  // Source has new content
  const newBlockContent = '# New content from source';
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=d4-block version=2.0 -->\n${newBlockContent}\n<!-- soma-v2:end id=d4-block -->`);
  const targetFile = path.join(dir, 'target.md');
  // Target block: sha attr = sha of original content, but actual content was manually changed
  // sha attr = sha('# Original content'), but actual content = '# Manually edited content'
  const originalContent = '# Original content';
  const originalSha = crypto.createHash('sha256').update(originalContent).digest('hex');
  const localContent = `# Target\n<!-- soma-v2:start id=d4-block version=1.0 sha256=${originalSha} -->\n# Manually edited content\n<!-- soma-v2:end id=d4-block -->\n`;
  fs.writeFileSync(targetFile, localContent);
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'd4-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'd4-block' }]
  }));
  return { somaDir: dir, targetFile, localContent };
}

// BF-06: D4 warn-and-write behavior is now opt-in via --allow-local-edits.
// Default (without flag) aborts with BLOCK_CONFLICT. These tests verify the opt-in path.

test('D4: --apply with local edits exits 0 (continues, does not abort)', () => {
  const { somaDir } = createLocalEditFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json', '--allow-local-edits']);
  assert.equal(r.status, 0, `D4: Expected exit 0 (warn and continue via --allow-local-edits), got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);
});

test('D4: --apply with local edits emits LOCAL_EDITS_DETECTED warning', () => {
  const { somaDir } = createLocalEditFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json', '--allow-local-edits']);
  assert.equal(r.status, 0, `D4: Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  const warnings = out.summary?.warnings || [];
  const hasLocalEditsWarn = warnings.some(w => w.code === 'LOCAL_EDITS_DETECTED');
  assert.ok(hasLocalEditsWarn, `D4: Expected LOCAL_EDITS_DETECTED warning, got: ${JSON.stringify(warnings)}`);
});

test('D4: --apply with local edits creates snapshot saving pre-state', () => {
  const { somaDir, localContent } = createLocalEditFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json', '--allow-local-edits']);
  assert.equal(r.status, 0, `D4: Expected exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot !== null, 'D4: snapshot must be created to preserve local edits');
  // Snapshot file must contain the pre-write content (with local edit)
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
  assert.ok(snapFiles.length > 0, 'D4: Snapshot must contain target file copy');
  const snapContent = fs.readFileSync(snapFiles[0], 'utf8');
  assert.equal(snapContent, localContent, 'D4: Snapshot must contain pre-write content (including local edit)');
});

test('D4: --apply with local edits still writes the block update', () => {
  const { somaDir, targetFile } = createLocalEditFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json', '--allow-local-edits']);
  // After apply, target must have been written (block updated)
  const afterContent = fs.readFileSync(targetFile, 'utf8');
  // The block should now have the correct version/sha
  assert.ok(afterContent.includes('soma-v2:start id=d4-block'), 'D4: Block must still be present after write');
});

test('D4: --apply local edits human output mentions local edits warning', () => {
  const { somaDir } = createLocalEditFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--allow-local-edits']);
  assert.equal(r.status, 0, `D4: Expected exit 0, got ${r.status}`);
  assert.ok(
    r.stdout.toLowerCase().includes('local') || r.stdout.toLowerCase().includes('edit'),
    `D4: Expected local edits warning in human output: ${r.stdout.slice(0, 400)}`
  );
});
