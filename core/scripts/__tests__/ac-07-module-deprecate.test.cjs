/**
 * AC-07: module deprecate updates front-matter status=deprecated, file preserved
 * @spec AC-07
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac07-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-07: deprecate updates status to deprecated + adds deprecated_at', () => {
  const projectPath = setupProject();
  runMod(['add', 'legacy-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['deprecate', 'legacy-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.to_status, 'deprecated');
  assert.ok(out.deprecated_at, 'deprecated_at must be populated');
  assert.equal(out.error, null);
  // Verify file updated
  const modulePath = path.join(projectPath, '.soma/modules/legacy-mod.md');
  assert.ok(fs.existsSync(modulePath), 'file must still exist (not deleted)');
  const content = fs.readFileSync(modulePath, 'utf8');
  assert.ok(content.includes('status: deprecated'), 'file must show status: deprecated');
  assert.ok(content.match(/deprecated_at: "\d{4}-\d{2}-\d{2}T/), 'file must have deprecated_at ISO');
});

test('AC-07: deprecate preserves markdown body content', () => {
  const projectPath = setupProject();
  runMod(['add', 'legacy-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/legacy-mod.md');
  const beforeContent = fs.readFileSync(modulePath, 'utf8');
  const bodyStart = beforeContent.indexOf('---', 3) + 3;
  const beforeBody = beforeContent.slice(bodyStart);
  runMod(['deprecate', 'legacy-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const afterContent = fs.readFileSync(modulePath, 'utf8');
  const afterBodyStart = afterContent.indexOf('---', 3) + 3;
  const afterBody = afterContent.slice(afterBodyStart);
  assert.equal(afterBody, beforeBody, 'body must be preserved after deprecate');
});

test('AC-07: can deprecate an already-active module', () => {
  const projectPath = setupProject();
  runMod(['add', 'active-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  runMod(['promote', 'active-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['deprecate', 'active-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.from_status, 'active');
  assert.equal(out.to_status, 'deprecated');
});
