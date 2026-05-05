/**
 * AC-05: module promote on non-existent slug returns MODULE_NOT_FOUND exit 1
 * @spec AC-05
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_REPO = path.join(os.homedir(), '.soma-v2');

function runMod(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/module.cjs'), ...args], {
    cwd: SOMA_REPO, env: { ...process.env, ...env }, encoding: 'utf8'
  });
}

test('AC-05: promote non-existent slug returns MODULE_NOT_FOUND exit 1', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac05-'));
  fs.mkdirSync(path.join(tmpDir, '.soma/modules'), { recursive: true });
  const r = runMod(['promote', 'nonexistent-slug', `--soma-home=${SOMA_REPO}`, `--project=${tmpDir}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'MODULE_NOT_FOUND');
});

test('AC-05: remove non-existent slug is idempotent (exit 0 with warning)', () => {
  // Per spec idempotency section: remove on already-removed exits 0
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac05b-'));
  fs.mkdirSync(path.join(tmpDir, '.soma/modules'), { recursive: true });
  const r = runMod(['remove', 'nonexistent-slug', `--soma-home=${SOMA_REPO}`, `--project=${tmpDir}`, '--yes', '--json']);
  // Idempotent remove: exit 0 (target state = not-present is already achieved)
  assert.equal(r.status, 0, `Expected exit 0 for idempotent remove. stderr: ${r.stderr}`);
});
