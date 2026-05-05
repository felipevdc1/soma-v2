/**
 * ac-11-criterion-8-ide.test.cjs — T-13
 * @spec AC-11 + D5
 * Criterion 8: "IDE sem erro"
 * Runs typecheck_command + lint_command. Pass if both exit 0. Skipped if both absent.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac11-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapBase(dir, extras = {}) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  const lines = [
    '---',
    'schema: soma-project/v1',
    'name: "test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    ...(extras.typecheck_command !== undefined ? [`typecheck_command: "${extras.typecheck_command}"`] : []),
    ...(extras.lint_command !== undefined ? [`lint_command: "${extras.lint_command}"`] : []),
    '---',
    '',
    '# Test Project',
  ];
  fs.writeFileSync(path.join(somaDir, 'project.md'), lines.join('\n'), 'utf8');
  return dir;
}

test('AC-11 criterion 8 SKIPPED: both typecheck_command and lint_command absent', () => {
  const dir = bootstrapBase(tmpProject()); // no commands
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c8 = out.criteria.find(c => c.id === 8);
  assert.equal(c8.status, 'skipped', `Expected criterion 8 skipped, got: ${JSON.stringify(c8)}`);
});

test('AC-11 criterion 8 PASS: typecheck "true" + lint "true" both exit 0', () => {
  const dir = bootstrapBase(tmpProject(), {
    typecheck_command: 'true',
    lint_command: 'true',
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c8 = out.criteria.find(c => c.id === 8);
  assert.equal(c8.status, 'pass', `Expected criterion 8 pass, got: ${JSON.stringify(c8)}`);
});

test('AC-11 criterion 8 FAIL: typecheck "false" fails (lint passes)', () => {
  const dir = bootstrapBase(tmpProject(), {
    typecheck_command: 'false',
    lint_command: 'true',
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c8 = out.criteria.find(c => c.id === 8);
  assert.equal(c8.status, 'fail', `Expected criterion 8 fail when typecheck fails, got: ${JSON.stringify(c8)}`);
});

test('AC-11 criterion 8 FAIL: lint "false" fails (typecheck passes)', () => {
  const dir = bootstrapBase(tmpProject(), {
    typecheck_command: 'true',
    lint_command: 'false',
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c8 = out.criteria.find(c => c.id === 8);
  assert.equal(c8.status, 'fail', `Expected criterion 8 fail when lint fails, got: ${JSON.stringify(c8)}`);
});

test('AC-11 criterion 8 PASS: only typecheck_command present and passes', () => {
  const dir = bootstrapBase(tmpProject(), {
    typecheck_command: 'true',
    // no lint_command
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c8 = out.criteria.find(c => c.id === 8);
  // With only typecheck configured and passing, should be pass
  assert.equal(c8.status, 'pass', `Expected criterion 8 pass when only typecheck configured, got: ${JSON.stringify(c8)}`);
});
