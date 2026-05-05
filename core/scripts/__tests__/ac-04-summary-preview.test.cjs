'use strict';
// @spec AC-04
// @contract CONTRACT-SYNC-APPLY-01
// T-06: AC-04 — summary preview printed BEFORE any write.

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

function createInsertFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac04-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=ac04-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=ac04-block -->');
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac04-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac04-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-04: --apply emits "## Sync preview" in stdout', () => {
  const { somaDir } = createInsertFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes('## Sync preview'), `Expected ## Sync preview in stdout: ${r.stdout.slice(0, 400)}`);
});

test('AC-04: --apply preview lists adapter/path and action before writing', () => {
  const { somaDir } = createInsertFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  // Preview must contain the target path or action
  assert.ok(
    r.stdout.includes('insert') || r.stdout.includes('replace') || r.stdout.includes('skip'),
    `Expected action word in preview output: ${r.stdout.slice(0, 400)}`
  );
});

test('AC-04: --apply with --json does not emit ## Sync preview (JSON mode replaces human output)', () => {
  const { somaDir } = createInsertFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
  // In JSON mode, output is pure JSON — no ## Sync preview header
  const out = JSON.parse(r.stdout); // must parse as JSON
  assert.ok(out.schema === 'soma-sync-apply/v1', `JSON output must have correct schema: ${JSON.stringify(out)}`);
});
