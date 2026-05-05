/**
 * AC-02: module add with existing slug returns MODULE_EXISTS exit 1
 * @spec AC-02
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac02-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-02: second add with same slug returns MODULE_EXISTS exit 1', () => {
  const projectPath = setupProject();
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r2 = runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r2.status, 1, `Expected exit 1. stderr: ${r2.stderr}`);
  const out = JSON.parse(r2.stdout);
  assert.equal(out.error.code, 'MODULE_EXISTS');
});

test('AC-02: source file is untouched after MODULE_EXISTS collision', () => {
  const projectPath = setupProject();
  const r1 = runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const originalContent = fs.readFileSync(JSON.parse(r1.stdout).module_path, 'utf8');
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const afterContent = fs.readFileSync(JSON.parse(r1.stdout).module_path, 'utf8');
  assert.equal(afterContent, originalContent, 'file content must be unchanged after MODULE_EXISTS');
});
