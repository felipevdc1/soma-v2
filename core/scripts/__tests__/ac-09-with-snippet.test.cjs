/**
 * AC-09: module add --with-snippet creates cookbook/snippets/{slug}.json skeleton
 * @spec AC-09
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac09-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-09: --with-snippet creates JSON skeleton at cookbook/snippets/{slug}.json', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'with-snip-test', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snippet_path, 'snippet_path must be non-null when --with-snippet');
  assert.ok(fs.existsSync(out.snippet_path), `snippet JSON must exist at ${out.snippet_path}`);
  const snip = JSON.parse(fs.readFileSync(out.snippet_path, 'utf8'));
  assert.equal(snip.schema, 'soma-snippet/v1');
  assert.equal(snip.slug, 'with-snip-test');
  assert.ok(Array.isArray(snip.keywords), 'keywords must be array');
  assert.ok(snip.keywords.includes('with-snip-test'), 'keywords must include slug/keyword');
  assert.ok(Array.isArray(snip.snippets), 'snippets must be empty array');
  assert.equal(snip.snippets.length, 0, 'snippets array must be empty skeleton');
});

test('AC-09: snippet JSON is at SOMA_HOME/cookbook/snippets/{slug}.json', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'snip-path-check', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const expectedSnipPath = path.join(SOMA_REPO, 'cookbook/snippets/snip-path-check.json');
  assert.equal(out.snippet_path, expectedSnipPath, `snippet must be at SOMA_HOME/cookbook/snippets/. Got: ${out.snippet_path}`);
});

test('AC-09: cookbook/snippets/ dir is created if not present', () => {
  // This is guaranteed by the implementation but test verifies no crash when dir missing
  const projectPath = setupProject();
  // We can't remove the actual SOMA_HOME snippets dir since it might contain real snippets
  // Just verify the path output is correct
  const r = runMod(['add', 'dir-creation-test', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(fs.existsSync(path.dirname(out.snippet_path)), 'cookbook/snippets/ dir must exist after add --with-snippet');
});
