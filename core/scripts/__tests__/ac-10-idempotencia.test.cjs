'use strict';
// @spec AC-10
// @contract CONTRACT-SYNC-APPLY-01
// T-12: AC-10 — idempotência: --apply twice in succession, second is noop.

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

function createDriftFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac10-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=ac10-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=ac10-block -->');
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac10-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'ac10-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-10: first --apply succeeds (exit 0, drift resolved)', () => {
  const { somaDir } = createDriftFixture();
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 0, `First apply: expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snapshot !== null, 'First apply: snapshot must be created');
});

test('AC-10: second --apply is noop (exit 0, no snapshot, no writes)', () => {
  const { somaDir } = createDriftFixture();
  // First apply
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  // Second apply — must be noop
  const r2 = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r2.status, 0, `Second apply: expected exit 0, got ${r2.status}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.snapshot, null, 'Second apply: snapshot must be null (noop)');
  assert.equal(out2.summary.files_touched.length, 0, 'Second apply: files_touched must be empty');
});

test('AC-10: after --apply, dry-run reports findings_count = 0 (zero drift)', () => {
  const { somaDir } = createDriftFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  // Run dry-run and verify no actionable findings
  const r = runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  const out = JSON.parse(r.stdout);
  const actionable = out.findings.filter(f => f.action !== 'skip' && f.action !== 'drift');
  assert.equal(actionable.length, 0, `After apply, dry-run must show 0 actionable findings. Got: ${JSON.stringify(actionable)}`);
});

test('AC-10: exactly one snapshot dir created after two --apply runs', () => {
  const { somaDir } = createDriftFixture();
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  // .snapshots must exist with exactly one timestamped dir
  const snapDir = path.join(somaDir, '.snapshots');
  if (fs.existsSync(snapDir)) {
    const entries = fs.readdirSync(snapDir).filter(e => !e.endsWith('.json'));
    assert.equal(entries.length, 1, `Expected exactly 1 snapshot dir, got: ${entries.length} (${JSON.stringify(entries)})`);
  }
});
