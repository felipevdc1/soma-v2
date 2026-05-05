/**
 * ac-02-module-layer-field.test.cjs — T-04
 * @spec AC-02
 * Tests that module front-matter gains optional layer field.
 * Default: 'leaves' if absent.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let resolveModuleLayer;
try {
  ({ resolveModuleLayer } = require('../lib/foundation-check.cjs'));
} catch (e) {
  resolveModuleLayer = null;
}

function tmpProject(prefix = 'soma-ac02-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeModule(dir, slug, layerField) {
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  const lines = [
    '---',
    'schema: soma-module/v1',
    `name: "${slug}"`,
    'status: active',
    'source_confidence: high',
    'owners: []',
    'last_verified: null',
    'source_path: "src/"',
    'initialized_at: "2026-01-01T00:00:00.000Z"',
    ...(layerField !== undefined ? [`layer: ${layerField}`] : []),
    '---',
    '',
    `# ${slug}`,
  ];
  fs.writeFileSync(path.join(modulesDir, `${slug}.md`), lines.join('\n'), 'utf8');
}

test('AC-02: resolveModuleLayer exists in foundation-check.cjs', () => {
  assert.ok(resolveModuleLayer !== null, 'resolveModuleLayer must be exported from lib/foundation-check.cjs');
  assert.equal(typeof resolveModuleLayer, 'function');
});

test('AC-02: resolveModuleLayer returns "trunk" for module with layer: trunk', () => {
  const dir = tmpProject();
  writeModule(dir, 'auth', 'trunk');
  const layer = resolveModuleLayer(dir, 'auth');
  assert.equal(layer, 'trunk');
});

test('AC-02: resolveModuleLayer returns "roots" for module with layer: roots', () => {
  const dir = tmpProject();
  writeModule(dir, 'core', 'roots');
  const layer = resolveModuleLayer(dir, 'core');
  assert.equal(layer, 'roots');
});

test('AC-02: resolveModuleLayer returns "leaves" for module with layer: leaves', () => {
  const dir = tmpProject();
  writeModule(dir, 'reports', 'leaves');
  const layer = resolveModuleLayer(dir, 'reports');
  assert.equal(layer, 'leaves');
});

test('AC-02: resolveModuleLayer defaults to "leaves" when layer field absent', () => {
  const dir = tmpProject();
  writeModule(dir, 'analytics', undefined); // no layer field
  const layer = resolveModuleLayer(dir, 'analytics');
  assert.equal(layer, 'leaves', 'Default layer should be "leaves" when field absent');
});

test('AC-02: resolveModuleLayer returns raw value for module with unknown layer (D3 enforced at project.md level)', () => {
  // D3: INVALID_LAYER is checked at project.md level (foundation_layers field), not at module read level.
  // resolveModuleLayer returns the raw value — caller / runFoundationCheck validates.
  const dir = tmpProject();
  writeModule(dir, 'weird', 'custom-layer');
  // The function returns whatever is in the file — validation is done at orchestrator level
  const layer = resolveModuleLayer(dir, 'weird');
  // Should return a string (the raw value), not throw
  assert.ok(typeof layer === 'string', `Expected string layer value, got: ${typeof layer}`);
});
