/**
 * AC-12: reserved slug rejection — manifest, snapshots, evidence, modules, cookbook, config
 * @spec AC-12
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

const RESERVED = ['manifest', 'snapshots', 'evidence', 'modules', 'cookbook', 'config'];

test('AC-12: all 6 reserved slugs return RESERVED_SLUG exit 1', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac12-'));
  for (const slug of RESERVED) {
    const r = runMod(['add', slug, `--soma-home=${SOMA_REPO}`, `--project=${tmpDir}`, '--json']);
    assert.equal(r.status, 1, `Expected exit 1 for reserved slug "${slug}". Got ${r.status}. stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, 'RESERVED_SLUG', `Expected RESERVED_SLUG for "${slug}", got ${out.error.code}`);
  }
});

test('AC-12: reserved slug check is case-insensitive (MANIFEST → reserved)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac12b-'));
  const r = runMod(['add', 'MANIFEST', `--soma-home=${SOMA_REPO}`, `--project=${tmpDir}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1. Got ${r.status}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'RESERVED_SLUG');
});

test('AC-12: no file created after RESERVED_SLUG rejection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac12c-'));
  fs.mkdirSync(path.join(tmpDir, '.soma/modules'), { recursive: true });
  runMod(['add', 'manifest', `--soma-home=${SOMA_REPO}`, `--project=${tmpDir}`, '--json']);
  assert.ok(!fs.existsSync(path.join(tmpDir, '.soma/modules/manifest.md')), 'manifest.md must not be created');
});
