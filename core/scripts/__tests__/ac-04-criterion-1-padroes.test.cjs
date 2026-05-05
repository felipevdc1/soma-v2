/**
 * ac-04-criterion-1-padroes.test.cjs — T-06
 * @spec AC-04
 * Criterion 1: "padrões claros"
 * Pass if ≥1 ADR file in docs/architecture-decisions/*.md
 * OR decisions array in project.md populated with ≥1 entry.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac04-') {
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
    ...(extras.decisions ? [`decisions: ${JSON.stringify(extras.decisions)}`] : []),
    '---',
    '',
    '# Test Project',
  ];
  fs.writeFileSync(path.join(somaDir, 'project.md'), lines.join('\n'), 'utf8');
  return dir;
}

test('AC-04 criterion 1 PASS via ADR file: ≥1 .md in docs/architecture-decisions/', () => {
  const dir = bootstrapBase(tmpProject());
  const adrDir = path.join(dir, 'docs', 'architecture-decisions');
  fs.mkdirSync(adrDir, { recursive: true });
  fs.writeFileSync(path.join(adrDir, '0001-stack-choice.md'), '# ADR-0001\n\nStack choice decision.', 'utf8');

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c1 = out.criteria.find(c => c.id === 1);
  assert.equal(c1.status, 'pass', `Expected criterion 1 pass, got: ${JSON.stringify(c1)}`);
  assert.ok(c1.message.includes('ADR') || c1.message.includes('0001'), `Expected message to mention ADR. Got: ${c1.message}`);
});

test('AC-04 criterion 1 PASS via decisions array: project.md decisions ≥1 entry', () => {
  const dir = bootstrapBase(tmpProject(), { decisions: ['adr-0001-stack-choice'] });
  // No ADR files — relies on decisions array
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c1 = out.criteria.find(c => c.id === 1);
  assert.equal(c1.status, 'pass', `Expected criterion 1 pass via decisions array, got: ${JSON.stringify(c1)}`);
});

test('AC-04 criterion 1 FAIL: no ADR files and no decisions array', () => {
  const dir = bootstrapBase(tmpProject()); // no ADR files, no decisions
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c1 = out.criteria.find(c => c.id === 1);
  assert.equal(c1.status, 'fail', `Expected criterion 1 fail, got: ${JSON.stringify(c1)}`);
});

test('AC-04 criterion 1 FAIL: empty decisions array and no ADR files', () => {
  const dir = bootstrapBase(tmpProject(), { decisions: [] });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c1 = out.criteria.find(c => c.id === 1);
  assert.equal(c1.status, 'fail', `Expected criterion 1 fail for empty decisions, got: ${JSON.stringify(c1)}`);
});

test('AC-04 criterion 1: message includes path info for ADR file detection', () => {
  const dir = bootstrapBase(tmpProject());
  const adrDir = path.join(dir, 'docs', 'architecture-decisions');
  fs.mkdirSync(adrDir, { recursive: true });
  fs.writeFileSync(path.join(adrDir, '0001-stack.md'), '# ADR-0001', 'utf8');
  fs.writeFileSync(path.join(adrDir, '0002-infra.md'), '# ADR-0002', 'utf8');

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c1 = out.criteria.find(c => c.id === 1);
  assert.equal(c1.status, 'pass');
  // Message should mention count
  assert.ok(c1.message.includes('2') || c1.message.includes('ADR'), `Expected message with count. Got: ${c1.message}`);
});
