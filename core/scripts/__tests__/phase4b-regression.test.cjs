'use strict';
// @spec T-17
// @contract CONTRACT-SYNC-APPLY-01
// T-17: Phase 4b regression — verify Phase 2 (dry-run) behavior still works
// after Phase 4b (--apply) extension. Bridge test using ~/.soma-v2.

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

// Create minimal fixture (insert target) for regression checks
function createRegressionFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-p4b-reg-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0', files: []
  }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const blockContent = '# Regression test block';
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    `<!-- soma-v2:start id=reg-block version=1.0 -->\n${blockContent}\n<!-- soma-v2:end id=reg-block -->`);
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block here.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'reg-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'reg-block' }]
  }));
  return { somaDir: dir, targetFile };
}

// ---- Phase 2 dry-run regression ----

test('REGRESSION: Phase 2 dry-run still works (exits 1 when drift exists)', () => {
  const { somaDir } = createRegressionFixture();
  const r = runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  assert.equal(r.status, 1, `REGRESSION: dry-run should exit 1 on drift, got ${r.status}`);
});

test('REGRESSION: Phase 2 dry-run --json output has findings + summary', () => {
  const { somaDir } = createRegressionFixture();
  const r = runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`REGRESSION: dry-run must emit valid JSON: ${r.stdout.slice(0, 200)}`);
  }
  assert.ok(Array.isArray(out.findings), 'REGRESSION: dry-run must have findings array');
  assert.ok(out.summary !== undefined, 'REGRESSION: dry-run must have summary');
  assert.ok(out.findings.length > 0, 'REGRESSION: dry-run must have at least one finding');
});

test('REGRESSION: Phase 2 dry-run does NOT create .snapshots dir', () => {
  const { somaDir } = createRegressionFixture();
  runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  assert.equal(fs.existsSync(path.join(somaDir, '.snapshots')), false,
    'REGRESSION: dry-run must never create .snapshots dir');
});

test('REGRESSION: Phase 2 dry-run does NOT modify target files', () => {
  const { somaDir, targetFile } = createRegressionFixture();
  const before = fs.readFileSync(targetFile, 'utf8');
  runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  const after = fs.readFileSync(targetFile, 'utf8');
  assert.equal(after, before, 'REGRESSION: dry-run must not modify target files');
});

test('REGRESSION: Phase 2 dry-run with --verbose still works', () => {
  const { somaDir } = createRegressionFixture();
  const r = runSync(['--dry-run', '--verbose', `--soma-home=${somaDir}`]);
  // --verbose flag should not crash; exit 1 (drift) or 0 (none)
  assert.ok(r.status === 0 || r.status === 1, `REGRESSION: dry-run --verbose should exit 0 or 1, got ${r.status}`);
});

test('REGRESSION: no flags defaults to dry-run (BF-07 — not exit 2)', () => {
  // TEST-STALE-FIX: BF-07 (Wave 2.A) removed "no mode = INVALID_ARGS exit 2".
  // No-flags now defaults to --dry-run silently (exit 0 or 1 based on findings).
  const { somaDir } = createRegressionFixture();
  const r = runSync([`--soma-home=${somaDir}`, '--json']);
  assert.ok(r.status === 0 || r.status === 1,
    `REGRESSION: no mode flags should exit 0 or 1 (dry-run default per BF-07), got ${r.status}`);
});

// ---- Phase 4b --apply does not corrupt existing Phase 2 output ----

test('REGRESSION: --apply does not alter dry-run output schema for same fixture', () => {
  const { somaDir } = createRegressionFixture();
  // Run apply first
  runSync(['--apply', '--tool=codex', `--soma-home=${somaDir}`, '--json']);
  // Run dry-run on now-synced state
  const r = runSync(['--dry-run', `--soma-home=${somaDir}`, '--json']);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`REGRESSION: dry-run after apply must emit valid JSON: ${r.stdout.slice(0, 200)}`);
  }
  assert.ok(Array.isArray(out.findings), 'REGRESSION: post-apply dry-run must still have findings array');
  assert.equal(out.mode, 'dry-run', 'REGRESSION: mode must be dry-run');
});

test('REGRESSION: snapshot.cjs createSnapshot is importable and has correct exports', () => {
  const snapLib = require(path.join(SOMA_HOME, 'scripts', 'lib', 'snapshot.cjs'));
  assert.ok(typeof snapLib.createSnapshot === 'function', 'snapshot.cjs must export createSnapshot');
  assert.ok(typeof snapLib.createManifestJSON === 'function', 'snapshot.cjs must export createManifestJSON');
  assert.ok(typeof snapLib.generateTimestamp === 'function', 'snapshot.cjs must export generateTimestamp');
  assert.ok(typeof snapLib.toISO8601Seconds === 'function', 'snapshot.cjs must export toISO8601Seconds');
});
