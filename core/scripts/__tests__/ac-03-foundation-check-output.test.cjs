/**
 * ac-03-foundation-check-output.test.cjs — T-05
 * @spec AC-03
 * Tests --foundation-check lists 9 criteria with status + per-criterion message.
 * JSON + human output formats.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac03-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapProject(dir) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Test Project',
  ].join('\n'), 'utf8');
  return dir;
}

test('AC-03: --foundation-check --json returns array of exactly 9 criteria', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.equal(out.criteria.length, 9);
});

test('AC-03: criteria ids are 1 through 9 in order', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  for (let i = 0; i < 9; i++) {
    assert.equal(out.criteria[i].id, i + 1, `Expected criterion ${i+1}, got id ${out.criteria[i].id}`);
  }
});

test('AC-03: criterion names match Bruno 9-criterion labels', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const names = out.criteria.map(c => c.name);
  // Check known names exist
  assert.ok(names.some(n => n.includes('padrões') || n.includes('padres')), `Missing criterion 1 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('API') || n.includes('rota')), `Missing criterion 2 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('leakage') || n.includes('vazamento')), `Missing criterion 3 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('hardcoded') || n.includes('zero')), `Missing criterion 4 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('dados') || n.includes('real')), `Missing criterion 5 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('teste') || n.includes('tests')), `Missing criterion 6 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('build')), `Missing criterion 7 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('IDE') || n.includes('erro')), `Missing criterion 8 name. Got: ${names}`);
  assert.ok(names.some(n => n.includes('stack') || n.includes('tech')), `Missing criterion 9 name. Got: ${names}`);
});

test('AC-03: human output (no --json) includes criterion listing', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check'], dir);
  // Human output should include "foundation" or criterion listing
  assert.ok(
    result.stdout.includes('foundation') || result.stdout.includes('criteria') || result.stdout.includes('[pass]') || result.stdout.includes('[fail]') || result.stdout.includes('[skipped]'),
    `Expected human output to include foundation check results. Got: ${result.stdout.slice(0, 400)}`
  );
});

test('AC-03: --json output includes project path field', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.ok(out.project, 'Expected project field in output');
  assert.ok(typeof out.project === 'string');
});

test('AC-03: summary pass+fail+skipped counts sum to 9', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const total = (out.summary.pass || 0) + (out.summary.fail || 0) + (out.summary.skipped || 0) + (out.summary['not-applicable'] || 0);
  assert.equal(total, 9, `Expected sum of all statuses to be 9, got ${total}`);
});
