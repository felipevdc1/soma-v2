/**
 * ac-13-non-blocking.test.cjs — T-15
 * @spec AC-13
 * Standalone --foundation-check exits 0 even with criteria failures.
 * Gate mode (--gate) is where blocking happens.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac13-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapBroken(dir) {
  // Project with no ADRs, no tech_stack — criteria 1 + 9 will fail
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "broken-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Broken Project',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-13: --foundation-check exits 0 even when criteria fail', () => {
  const dir = bootstrapBroken(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 0, `Expected exit 0 for standalone --foundation-check, got: ${result.status}. stderr: ${result.stderr}`);
});

test('AC-13: --foundation-check JSON output has criteria with failures but exit 0', () => {
  const dir = bootstrapBroken(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const failCount = out.criteria.filter(c => c.status === 'fail').length;
  assert.ok(failCount > 0, 'Expected at least one failing criterion');
  assert.equal(result.status, 0, 'Must still exit 0');
});

test('AC-13: foundation_done false in summary when any criterion fails', () => {
  const dir = bootstrapBroken(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.equal(out.summary.foundation_done, false, 'Expected foundation_done false');
});

test('AC-13: standalone --foundation-check summary.fail reflects actual fail count', () => {
  const dir = bootstrapBroken(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const criteriaFails = out.criteria.filter(c => c.status === 'fail').length;
  assert.equal(out.summary.fail, criteriaFails, 'summary.fail must match actual criteria fail count');
});
