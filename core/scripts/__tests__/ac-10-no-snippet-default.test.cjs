/**
 * AC-10: module add WITHOUT --with-snippet does NOT create snippet JSON (lazy/opt-in)
 * @spec AC-10
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

function setupProject() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac10-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-10: module add without --with-snippet does NOT create snippet JSON', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'no-snip-test', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snippet_path, null, 'snippet_path must be null when --with-snippet not used');
  const expectedSnipPath = path.join(SOMA_REPO, 'cookbook/snippets/no-snip-test.json');
  assert.ok(!fs.existsSync(expectedSnipPath), `snippet JSON must NOT exist at ${expectedSnipPath}`);
});

test('AC-10: snippet_path null is consistent across multiple adds without --with-snippet', () => {
  const projectPath = setupProject();
  const slugs = ['mod-a', 'mod-b', 'mod-c'];
  for (const slug of slugs) {
    const r = runMod(['add', slug, `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.snippet_path, null, `snippet_path must be null for ${slug}`);
  }
});
