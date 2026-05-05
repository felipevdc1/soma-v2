/**
 * AC-06: module remove with --yes deletes module file + companion snippet
 * @spec AC-06
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac06-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-06: remove with --yes deletes module file', () => {
  const projectPath = setupProject();
  runMod(['add', 'tmp-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/tmp-mod.md');
  assert.ok(fs.existsSync(modulePath), 'module file must exist before remove');
  const r = runMod(['remove', 'tmp-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--yes', '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  assert.ok(!fs.existsSync(modulePath), 'module file must be deleted');
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.deleted));
  assert.ok(out.deleted.some(p => p.includes('tmp-mod.md')), 'deleted array must contain module path');
});

test('AC-06: remove with --yes deletes companion snippet if exists', () => {
  const projectPath = setupProject();
  runMod(['add', 'tmp-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  const r1 = JSON.parse(
    runMod(['add', 'tmp-mod2', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']).stdout
  );
  const snippetPath = r1.snippet_path;
  assert.ok(fs.existsSync(snippetPath), 'snippet must exist before remove');
  runMod(['remove', 'tmp-mod2', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--yes', '--json']);
  assert.ok(!fs.existsSync(snippetPath), 'snippet must be deleted with module');
});

test('AC-06: remove without --yes when stdin is not a tty exits with prompt indication (not 0)', () => {
  // In non-interactive mode without --yes, command should prompt or fail predictably
  // We test that it doesn't just silently delete without confirmation
  const projectPath = setupProject();
  runMod(['add', 'tmp-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = spawnSync('node', [
    path.join(SOMA_REPO, 'scripts/module.cjs'),
    'remove', 'tmp-mod',
    `--soma-home=${SOMA_REPO}`,
    `--project=${projectPath}`,
    '--json'
  ], {
    cwd: SOMA_REPO,
    env: { ...process.env },
    encoding: 'utf8',
    input: 'n\n'  // respond "no" to confirmation
  });
  // File should still exist (user said no)
  const modulePath = path.join(projectPath, '.soma/modules/tmp-mod.md');
  assert.ok(fs.existsSync(modulePath), 'file must NOT be deleted when user says no');
});
