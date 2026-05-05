/**
 * D4: module promote with breaking manual edits in front-matter aborts SCHEMA_INVALID
 * @spec AC-03 + D4
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
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-d4-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

test('D4: promote with unknown extra fields in front-matter returns SCHEMA_INVALID', () => {
  const projectPath = setupProject();
  runMod(['add', 'broken-yaml', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/broken-yaml.md');
  const content = fs.readFileSync(modulePath, 'utf8');
  // Inject unknown field into front-matter
  const corrupted = content.replace(/^---\n/, '---\nrogue_field: "this-is-unknown"\n');
  fs.writeFileSync(modulePath, corrupted, 'utf8');
  const r = runMod(['promote', 'broken-yaml', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1 for SCHEMA_INVALID. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SCHEMA_INVALID');
});

test('D4: file is UNTOUCHED after SCHEMA_INVALID rejection', () => {
  const projectPath = setupProject();
  runMod(['add', 'broken-yaml2', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/broken-yaml2.md');
  const content = fs.readFileSync(modulePath, 'utf8');
  const corrupted = content.replace(/^---\n/, '---\nrogue_field: "unknown"\n');
  fs.writeFileSync(modulePath, corrupted, 'utf8');
  runMod(['promote', 'broken-yaml2', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const afterContent = fs.readFileSync(modulePath, 'utf8');
  assert.equal(afterContent, corrupted, 'file must be untouched after SCHEMA_INVALID');
});

test('D4: promote with missing required key returns SCHEMA_INVALID', () => {
  const projectPath = setupProject();
  runMod(['add', 'missing-key', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/missing-key.md');
  const content = fs.readFileSync(modulePath, 'utf8');
  // Remove required 'initialized_at' key
  const corrupted = content.replace(/initialized_at: "[^"]*"\n/, '');
  fs.writeFileSync(modulePath, corrupted, 'utf8');
  const r = runMod(['promote', 'missing-key', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1 for missing required key. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SCHEMA_INVALID');
});

test('D4: promote with malformed YAML (broken front-matter delimiter) returns SCHEMA_INVALID', () => {
  const projectPath = setupProject();
  runMod(['add', 'malformed-yaml', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const modulePath = path.join(projectPath, '.soma/modules/malformed-yaml.md');
  // Corrupt the closing --- delimiter of front-matter
  const content = fs.readFileSync(modulePath, 'utf8');
  const secondDash = content.indexOf('---', 4);
  const corrupted = content.slice(0, secondDash) + '-X-' + content.slice(secondDash + 3);
  fs.writeFileSync(modulePath, corrupted, 'utf8');
  const r = runMod(['promote', 'malformed-yaml', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1 for malformed YAML. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SCHEMA_INVALID');
});
