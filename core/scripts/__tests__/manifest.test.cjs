'use strict';
/**
 * manifest.test.cjs — T-01 scaffold tests for manifest.cjs stub
 *
 * Verifies foundation behaviour: --help, unknown flags, unknown subverb,
 * mutual-exclusion guard, and stub success path.
 *
 * Test runner: node:test (NOT bun).
 *
 * @spec [SPEC:AC-10] [SPEC:AC-15]
 * @task T-01
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '..', 'manifest.cjs');

test('manifest.cjs --help exits 0 and mentions all flags', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--help']);
  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
  const out = r.stdout.toString();
  assert.match(out, /--dry-run/);
  assert.match(out, /--apply/);
  assert.match(out, /--filter/);
  assert.match(out, /--json/);
  assert.match(out, /--help/);
});

test('manifest.cjs unknown flag returns INVALID_ARGS exit 2', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--bogus']);
  assert.strictEqual(r.status, 2);
});

test('manifest.cjs unknown subverb returns UNKNOWN_SUBVERB exit 2', () => {
  const r = spawnSync('node', [SCRIPT, 'unknown']);
  assert.strictEqual(r.status, 2);
});

test('manifest.cjs baseline + --dry-run AND --apply mutually exclusive', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline', '--dry-run', '--apply']);
  assert.strictEqual(r.status, 2);
});

test('manifest.cjs baseline stub returns 0 with stub message', () => {
  const r = spawnSync('node', [SCRIPT, 'baseline']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout.toString(), /T-01 foundation|stub/i);
});
