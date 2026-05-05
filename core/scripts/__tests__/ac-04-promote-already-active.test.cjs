/**
 * AC-04: module promote on already-active returns ALREADY_ACTIVE exit 1, no modification
 * @spec AC-04
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac04-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-04: promote on already-active module returns ALREADY_ACTIVE exit 1', () => {
  const projectPath = setupProject();
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'ALREADY_ACTIVE');
});

test('AC-04: file content unchanged after ALREADY_ACTIVE rejection', () => {
  const projectPath = setupProject();
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/auth-system.md');
  const beforeContent = fs.readFileSync(modulePath, 'utf8');
  runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const afterContent = fs.readFileSync(modulePath, 'utf8');
  assert.equal(afterContent, beforeContent, 'file must not be modified after ALREADY_ACTIVE');
});
