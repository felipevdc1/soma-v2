/**
 * AC-01: module add creates .soma/modules/{slug}.md from template with correct front-matter
 * @spec AC-01
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac01-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('AC-01: module add creates .soma/modules/{slug}.md from module.md.tmpl', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'auth-system');
  assert.equal(out.status, 'hypothesis');
  assert.ok(out.module_path, 'module_path must be present');
  assert.equal(out.error, null, 'error must be null on success');
  assert.ok(fs.existsSync(out.module_path), `module file must exist at ${out.module_path}`);
  const content = fs.readFileSync(out.module_path, 'utf8');
  assert.ok(content.includes('schema: soma-module/v1'), 'must have schema line');
  assert.ok(content.includes('status: hypothesis'), 'must have status: hypothesis');
  assert.ok(content.includes('name: "auth-system"'), 'must have correct name');
  assert.ok(content.match(/initialized_at: "\d{4}-\d{2}-\d{2}T/), 'must have ISO8601 initialized_at');
  assert.ok(content.includes('source_confidence: low'), 'must have source_confidence: low');
});

test('AC-01: module_path is inside .soma/modules/ of the project', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'billing', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.module_path.startsWith(path.join(projectPath, '.soma/modules/')),
    `module_path must be inside project .soma/modules/. Got: ${out.module_path}`);
});

test('AC-01: initialized_at is a valid ISO8601 timestamp', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'api-layer', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const content = fs.readFileSync(out.module_path, 'utf8');
  const match = content.match(/initialized_at: "([^"]+)"/);
  assert.ok(match, 'initialized_at must be present in front-matter');
  const d = new Date(match[1]);
  assert.ok(!isNaN(d.getTime()), `initialized_at must be valid date: ${match[1]}`);
});
