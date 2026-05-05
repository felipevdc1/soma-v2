/**
 * ac-10-criterion-7-build.test.cjs — T-12
 * @spec AC-10 + D5
 * Criterion 7: "build limpo"
 * Runs build_command. Pass if exit 0 AND stderr doesn't contain WARNING|warn.
 * Skipped if field absent.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac10-') {
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
    ...(extras.build_command !== undefined ? [`build_command: "${extras.build_command}"`] : []),
    '---',
    '',
    '# Test Project',
  ];
  fs.writeFileSync(path.join(somaDir, 'project.md'), lines.join('\n'), 'utf8');
  return dir;
}

test('AC-10 criterion 7 SKIPPED: build_command absent from project.md', () => {
  const dir = bootstrapBase(tmpProject()); // no build_command
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c7 = out.criteria.find(c => c.id === 7);
  assert.equal(c7.status, 'skipped', `Expected criterion 7 skipped, got: ${JSON.stringify(c7)}`);
  assert.ok(c7.message.includes('build_command'), `Expected message to mention build_command. Got: ${c7.message}`);
});

test('AC-10 criterion 7 PASS: build_command "true" exits 0 with no stderr warnings', () => {
  const dir = bootstrapBase(tmpProject(), { build_command: 'true' });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c7 = out.criteria.find(c => c.id === 7);
  assert.equal(c7.status, 'pass', `Expected criterion 7 pass, got: ${JSON.stringify(c7)}`);
});

test('AC-10 criterion 7 FAIL: build_command "false" exits non-0', () => {
  const dir = bootstrapBase(tmpProject(), { build_command: 'false' });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c7 = out.criteria.find(c => c.id === 7);
  assert.equal(c7.status, 'fail', `Expected criterion 7 fail for exit non-0, got: ${JSON.stringify(c7)}`);
});

test('AC-10 criterion 7 FAIL: build_command stderr contains "warning"', () => {
  // Use a node script that exits 0 but prints WARNING to stderr
  const dir = bootstrapBase(tmpProject());
  const warnScript = path.join(dir, 'build-with-warning.cjs');
  fs.writeFileSync(warnScript, 'process.stderr.write("WARNING: deprecated API\\n"); process.exit(0);', 'utf8');
  bootstrapBase(dir, { build_command: `node ${warnScript}` });
  // Re-write project.md with the warning script
  const somaDir = path.join(dir, '.soma');
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    `build_command: "node ${warnScript}"`,
    '---',
    '',
    '# Test Project',
  ].join('\n'), 'utf8');

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c7 = out.criteria.find(c => c.id === 7);
  assert.equal(c7.status, 'fail', `Expected criterion 7 fail when stderr has WARNING, got: ${JSON.stringify(c7)}`);
});
