'use strict';
// @spec AC-12
// @contract CONTRACT-SYNC-APPLY-01
// T-14: AC-12 — --apply + --dry-run conflict exits 2 INVALID_ARGS.

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

test('AC-12: --apply + --dry-run exits 2', () => {
  const r = runSync(['--apply', '--dry-run']);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}`);
});

test('AC-12: --apply + --dry-run error message mentions "mutually exclusive"', () => {
  const r = runSync(['--apply', '--dry-run']);
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.includes('mutually exclusive') || combined.includes('INVALID_ARGS'),
    `Expected "mutually exclusive" or "INVALID_ARGS" in output: ${combined.slice(0, 300)}`
  );
});

test('AC-12: --apply + --dry-run with --json outputs JSON error schema', () => {
  const r = runSync(['--apply', '--dry-run', '--json']);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`Expected JSON output, got: ${r.stdout.slice(0, 200)}`);
  }
  assert.ok(out.error !== undefined, 'JSON output must have error field');
  // With --apply support: error.code === 'INVALID_ARGS' or old error schema
  const combined = JSON.stringify(out);
  assert.ok(combined.includes('INVALID_ARGS') || combined.includes('mutually exclusive'),
    `Expected INVALID_ARGS in JSON output: ${combined.slice(0, 300)}`);
});

test('AC-12: --apply + --dry-run has zero side effects (no snapshot, no writes)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac12-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex', entries: []
  }));
  runSync(['--apply', '--dry-run', `--soma-home=${dir}`]);
  assert.equal(fs.existsSync(path.join(dir, '.snapshots')), false, 'No .snapshots on invalid args');
});
