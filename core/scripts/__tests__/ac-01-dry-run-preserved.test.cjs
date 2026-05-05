'use strict';
// @spec AC-01
// @contract CONTRACT-SYNC-APPLY-01
// T-03: AC-01 backward compat — sync without --apply preserves Phase 2 dry-run.
// RED phase: --apply not yet implemented → will fail on output.mode assertion when we add --apply support later,
// but this test is about backward compat being preserved AFTER --apply is added.
// In RED phase, --dry-run still required → most tests pass here. The key assertions:
// 1. mode === 'dry-run' in JSON output
// 2. .snapshots dir NOT created
// 3. exit code 0 or 1 (not 2) for valid dry-run

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
  return spawnSync('node', [SYNC, ...args], {
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 15000
  });
}

function createInsertFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac01-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0-test', files: []
  }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=ac01-block version=1.0 -->\n# Hello\n<!-- soma-v2:end id=ac01-block -->');
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'ac01-block', source_doc: 'docs/source.md',
      target_path: targetFile, target_anchor_id: 'ac01-block' }]
  }));
  return { somaDir: dir, targetFile };
}

test('AC-01: sync --dry-run without --apply still works (mode=dry-run, exit 0 or 1)', () => {
  const { somaDir } = createInsertFixture();
  const r = runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  // Must not be hard error
  assert.ok(r.status === 0 || r.status === 1, `Expected exit 0 or 1, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'dry-run', `mode must be dry-run, got: ${out.mode}`);
  // No snapshots dir created
  assert.equal(fs.existsSync(path.join(somaDir, '.snapshots')), false,
    '.snapshots must not be created by dry-run');
});

test('AC-01: sync --dry-run does not write to target file', () => {
  const { somaDir, targetFile } = createInsertFixture();
  const shaBefore = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  const shaAfter = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  assert.equal(shaAfter, shaBefore, 'dry-run must not modify target file');
});

test('AC-01: sync without any mode flags defaults to dry-run (BF-07)', () => {
  const { somaDir } = createInsertFixture();
  // BF-07 (Wave 2.A): removed hard error for missing --dry-run / --apply.
  // No-flags now silently defaults to --dry-run (exit 0 or 1).
  // Old assertion was "exit 2 (INVALID_ARGS)" — that contract was removed in BF-07.
  // TEST-STALE-FIX: updated from exit 2 → exit 0 or 1.
  const r = runSync([`--soma-home=${somaDir}`, '--json']);
  assert.ok(r.status === 0 || r.status === 1,
    `Expected exit 0 or 1 (dry-run default per BF-07), got ${r.status}`);
  // Output should be valid dry-run JSON (not an error)
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'dry-run', `Expected mode=dry-run when no flags provided, got: ${out.mode}`);
});

test('AC-01: --apply emits mode=apply (not dry-run) in JSON output', () => {
  const { somaDir } = createInsertFixture();
  // RED: --apply not yet accepted, will exit 2 or mode=dry-run — this MUST FAIL in RED
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  // In RED phase: exits 2 (invalid args) because --apply not recognized as valid mode
  // After GREEN: must exit 0/1 and mode === 'apply'
  assert.equal(r.status, 0, `Expected exit 0 with --apply and drift, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'apply', `Expected mode=apply, got: ${out.mode}`);
});
