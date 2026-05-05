/**
 * ac-17-legacy-state.test.cjs — T-18
 * @spec AC-17 + D6
 * Legacy state: project without foundation_layers configured.
 * Behavior: warning FOUNDATION_NOT_CONFIGURED + skip foundation-check + exit 0.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac17-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapLegacy(dir) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "legacy-project"',
    'status: active',
    '---',
    '',
    '# Legacy Project',
    '',
    'Pre-Phase-4d project without foundation_layers.',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-17 D6: legacy project exits 0 (non-blocking)', () => {
  const dir = bootstrapLegacy(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 0, `Expected exit 0 for legacy project. Got: ${result.status}. stderr: ${result.stderr}`);
});

test('AC-17 D6: legacy project returns FOUNDATION_NOT_CONFIGURED warning', () => {
  const dir = bootstrapLegacy(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const warn = (out.warnings || []).find(w => w.code === 'FOUNDATION_NOT_CONFIGURED');
  assert.ok(warn, `Expected FOUNDATION_NOT_CONFIGURED warning. Got warnings: ${JSON.stringify(out.warnings)}`);
});

test('AC-17 D6: legacy project warning message mentions soma init --foundation', () => {
  const dir = bootstrapLegacy(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const warn = (out.warnings || []).find(w => w.code === 'FOUNDATION_NOT_CONFIGURED');
  assert.ok(warn, 'Expected warning');
  assert.ok(
    warn.message.includes('soma init --foundation') || warn.message.includes('foundation'),
    `Expected message to mention 'soma init --foundation'. Got: ${warn.message}`
  );
});

test('AC-17 D6: legacy project has null foundation_layers and null summary', () => {
  const dir = bootstrapLegacy(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.equal(out.foundation_layers, null, 'Expected foundation_layers null for legacy project');
  assert.equal(out.summary, null, 'Expected summary null for legacy project');
});

test('AC-17 D6: legacy project has empty criteria array (no check run)', () => {
  const dir = bootstrapLegacy(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.deepEqual(out.criteria, [], `Expected empty criteria array. Got: ${JSON.stringify(out.criteria)}`);
});

test('AC-17 D6: legacy project human output warns about foundation_layers not configured', () => {
  const dir = bootstrapLegacy(tmpProject());
  const result = runDoctor(['--foundation-check'], dir);
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('foundation_layers') || result.stdout.includes('FOUNDATION_NOT_CONFIGURED') || result.stdout.includes('expansion phase'),
    `Expected legacy warning in human output. Got: ${result.stdout}`
  );
});
