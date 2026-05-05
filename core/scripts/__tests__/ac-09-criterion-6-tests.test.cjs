/**
 * ac-09-criterion-6-tests.test.cjs — T-11
 * @spec AC-09 + D5
 * Criterion 6: "testes passando"
 * Runs test_command from project.md via spawnSync shell:false.
 * Pass if exit 0. Skipped if field absent.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac09-') {
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
    ...(extras.test_command !== undefined ? [`test_command: "${extras.test_command}"`] : []),
    '---',
    '',
    '# Test Project',
  ];
  fs.writeFileSync(path.join(somaDir, 'project.md'), lines.join('\n'), 'utf8');
  return dir;
}

test('AC-09 criterion 6 SKIPPED: test_command absent from project.md', () => {
  const dir = bootstrapBase(tmpProject()); // no test_command
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  assert.equal(c6.status, 'skipped', `Expected criterion 6 skipped, got: ${JSON.stringify(c6)}`);
  assert.ok(c6.message.includes('test_command'), `Expected message to mention test_command. Got: ${c6.message}`);
});

test('AC-09 criterion 6 PASS: test_command "true" exits 0', () => {
  const dir = bootstrapBase(tmpProject(), { test_command: 'true' });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  assert.equal(c6.status, 'pass', `Expected criterion 6 pass for 'true' command, got: ${JSON.stringify(c6)}`);
});

test('AC-09 criterion 6 FAIL: test_command "false" exits non-0', () => {
  const dir = bootstrapBase(tmpProject(), { test_command: 'false' });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  assert.equal(c6.status, 'fail', `Expected criterion 6 fail for 'false' command, got: ${JSON.stringify(c6)}`);
});

test('AC-09 criterion 6 PASS: test_command node --version exits 0', () => {
  const dir = bootstrapBase(tmpProject(), { test_command: 'node --version' });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c6 = out.criteria.find(c => c.id === 6);
  assert.equal(c6.status, 'pass', `Expected criterion 6 pass for 'node --version', got: ${JSON.stringify(c6)}`);
});
