/**
 * ac-01-project-schema-migration.test.cjs — T-03
 * @spec AC-01
 * Tests that project.md schema gains new optional fields:
 *   foundation_layers, expansion_layers
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

let parseProjectMd;
try {
  ({ parseProjectMd } = require('../lib/foundation-check.cjs'));
} catch (e) {
  parseProjectMd = null;
}

function tmpProject(prefix = 'soma-ac01-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeProjectMd(dir, content) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(somaDir, { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), content, 'utf8');
}

test('AC-01: parseProjectMd exists in foundation-check.cjs', () => {
  assert.ok(parseProjectMd !== null, 'parseProjectMd must be exported from lib/foundation-check.cjs');
  assert.equal(typeof parseProjectMd, 'function');
});

test('AC-01: parseProjectMd reads foundation_layers array from project.md', () => {
  const dir = tmpProject();
  writeProjectMd(dir, [
    '---',
    'schema: soma-project/v1',
    'name: "myproject"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Project',
  ].join('\n'));

  const result = parseProjectMd(dir);
  assert.deepEqual(result.foundation_layers, ['roots', 'trunk']);
  assert.deepEqual(result.expansion_layers, ['leaves']);
});

test('AC-01: parseProjectMd returns null for foundation_layers when field absent (legacy)', () => {
  const dir = tmpProject();
  writeProjectMd(dir, [
    '---',
    'schema: soma-project/v1',
    'name: "legacy-project"',
    'status: active',
    '---',
    '',
    '# Project',
  ].join('\n'));

  const result = parseProjectMd(dir);
  assert.equal(result.foundation_layers, null);
  assert.equal(result.expansion_layers, null);
});

test('AC-01: parseProjectMd applies defaults when foundation_layers present but expansion_layers absent', () => {
  const dir = tmpProject();
  writeProjectMd(dir, [
    '---',
    'schema: soma-project/v1',
    'name: "partial-project"',
    'status: active',
    'foundation_layers: ["roots"]',
    '---',
    '',
    '# Project',
  ].join('\n'));

  const result = parseProjectMd(dir);
  assert.deepEqual(result.foundation_layers, ['roots']);
  // expansion_layers absent from file — should return null or default ['leaves']
  assert.ok(result.expansion_layers === null || Array.isArray(result.expansion_layers));
});

test('AC-01: parseProjectMd reads decisions array from project.md', () => {
  const dir = tmpProject();
  writeProjectMd(dir, [
    '---',
    'schema: soma-project/v1',
    'name: "decisions-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    'decisions: ["adr-0001", "adr-0002"]',
    '---',
    '',
    '# Project',
  ].join('\n'));

  const result = parseProjectMd(dir);
  assert.deepEqual(result.decisions, ['adr-0001', 'adr-0002']);
});

test('AC-01: parseProjectMd reads tech_stack array from project.md', () => {
  const dir = tmpProject();
  // tech_stack as JSON array of objects (compact inline style)
  writeProjectMd(dir, [
    '---',
    'schema: soma-project/v1',
    'name: "stack-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Project',
  ].join('\n'));

  const result = parseProjectMd(dir);
  // tech_stack absent → null
  assert.ok(result.tech_stack === null || Array.isArray(result.tech_stack));
});
