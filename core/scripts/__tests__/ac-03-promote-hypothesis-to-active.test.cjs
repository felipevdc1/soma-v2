/**
 * AC-03: module promote updates hypothesis→active, adds promoted_at/last_verified, body preserved
 * @spec AC-03
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac03-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-03: promote hypothesis→active updates front-matter status', () => {
  const projectPath = setupProject();
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.from_status, 'hypothesis');
  assert.equal(out.to_status, 'active');
  assert.ok(out.promoted_at, 'promoted_at must be populated');
  assert.equal(out.error, null);
  // Verify file updated
  const modulePath = path.join(projectPath, '.soma/modules/auth-system.md');
  const content = fs.readFileSync(modulePath, 'utf8');
  assert.ok(content.includes('status: active'), 'file must show status: active');
  assert.ok(content.match(/promoted_at: "\d{4}-\d{2}-\d{2}T/), 'file must have promoted_at ISO');
  assert.ok(content.match(/last_verified: "\d{4}-\d{2}-\d{2}T/), 'file must have last_verified ISO');
});

test('AC-03: promote preserves markdown body content', () => {
  const projectPath = setupProject();
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/auth-system.md');
  const beforeContent = fs.readFileSync(modulePath, 'utf8');
  // Find body (after closing ---) in original
  const bodyStart = beforeContent.indexOf('---', 3) + 3;
  const beforeBody = beforeContent.slice(bodyStart);
  runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const afterContent = fs.readFileSync(modulePath, 'utf8');
  const afterBodyStart = afterContent.indexOf('---', 3) + 3;
  const afterBody = afterContent.slice(afterBodyStart);
  assert.equal(afterBody, beforeBody, 'markdown body must be preserved verbatim after promote');
});
