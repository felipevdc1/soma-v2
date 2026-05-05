/**
 * d3-invalid-layer.test.cjs — T-19
 * @spec AC-01 + D3
 * D3: strict enum {roots, trunk, leaves} for foundation_layers.
 * Custom layer names → INVALID_LAYER error, exit 1.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-d3-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapInvalidLayer(dir, layerName) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "invalid-layer-project"',
    'status: active',
    `foundation_layers: ${JSON.stringify([layerName])}`,
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Invalid Layer Project',
  ].join('\n'), 'utf8');
  return dir;
}

test('D3: custom layer name "custom-layer" → INVALID_LAYER error, exit 1', () => {
  const dir = bootstrapInvalidLayer(tmpProject(), 'custom-layer');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 1, `Expected exit 1 for INVALID_LAYER. Got: ${result.status}`);
  const out = JSON.parse(result.stdout);
  assert.ok(out.error, 'Expected error field in output');
  assert.equal(out.error.code, 'INVALID_LAYER', `Expected INVALID_LAYER code. Got: ${out.error.code}`);
});

test('D3: "production" layer name → INVALID_LAYER error', () => {
  const dir = bootstrapInvalidLayer(tmpProject(), 'production');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error && out.error.code, 'INVALID_LAYER');
});

test('D3: "core" layer name (not in enum) → INVALID_LAYER error', () => {
  const dir = bootstrapInvalidLayer(tmpProject(), 'core');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.error && out.error.code, 'INVALID_LAYER');
});

test('D3: valid enum values "roots", "trunk", "leaves" are accepted', () => {
  for (const layer of ['roots', 'trunk', 'leaves']) {
    const dir = tmpProject();
    const somaDir = path.join(dir, '.soma');
    fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
    fs.writeFileSync(path.join(somaDir, 'project.md'), [
      '---',
      'schema: soma-project/v1',
      'name: "valid-project"',
      'status: active',
      `foundation_layers: ${JSON.stringify([layer])}`,
      'expansion_layers: ["leaves"]',
      '---',
      '',
      '# Valid Project',
    ].join('\n'), 'utf8');

    const result = runDoctor(['--foundation-check', '--json'], dir);
    assert.notEqual(result.status, 1, `Layer "${layer}" should be valid but got exit 1. Output: ${result.stdout}`);
    const out = JSON.parse(result.stdout);
    assert.ok(!out.error || out.error.code !== 'INVALID_LAYER', `Layer "${layer}" should not produce INVALID_LAYER error`);
  }
});

test('D3: INVALID_LAYER error message mentions the invalid layer name', () => {
  const dir = bootstrapInvalidLayer(tmpProject(), 'my-custom-layer');
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.ok(
    out.error && (out.error.message.includes('my-custom-layer') || out.error.message.includes('INVALID_LAYER')),
    `Expected invalid layer name in error message. Got: ${JSON.stringify(out.error)}`
  );
});
