/**
 * ac-16-preserve-edits.test.cjs — T-17
 * @spec AC-16
 * User edits to foundation_layers/tech_stack/expansion_layers in project.md
 * must be preserved after running doctor/sync (no rewrite).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac16-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapCustom(dir, content) {
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), content, 'utf8');
  return dir;
}

test('AC-16: project.md NOT modified after running --foundation-check', () => {
  const originalContent = [
    '---',
    'schema: soma-project/v1',
    'name: "custom-project"',
    'status: active',
    'foundation_layers: ["roots"]',
    'expansion_layers: ["trunk", "leaves"]',
    'tech_stack: [{"name":"Bun","version":"1.0","role":"runtime"}]',
    '---',
    '',
    '# Custom Project',
    '',
    'Custom content that must be preserved.',
  ].join('\n');

  const dir = bootstrapCustom(tmpProject(), originalContent);
  const projectMdPath = path.join(dir, '.soma', 'project.md');

  // Run foundation check
  runDoctor(['--foundation-check', '--json'], dir);

  // Check file unchanged
  const afterContent = fs.readFileSync(projectMdPath, 'utf8');
  assert.equal(afterContent, originalContent, 'project.md must not be modified by --foundation-check');
});

test('AC-16: running --foundation-check twice yields same result (idempotent)', () => {
  const dir = bootstrapCustom(tmpProject(), [
    '---',
    'schema: soma-project/v1',
    'name: "idempotent-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    '---',
    '',
    '# Idempotent Project',
  ].join('\n'));

  const result1 = runDoctor(['--foundation-check', '--json'], dir);
  const result2 = runDoctor(['--foundation-check', '--json'], dir);

  const out1 = JSON.parse(result1.stdout);
  const out2 = JSON.parse(result2.stdout);

  // Same criteria statuses
  for (let i = 0; i < 9; i++) {
    assert.equal(out1.criteria[i].status, out2.criteria[i].status,
      `Criterion ${i+1} status changed between runs: ${out1.criteria[i].status} → ${out2.criteria[i].status}`);
  }
});

test('AC-16: custom foundation_layers array preserved after doctor run', () => {
  const dir = bootstrapCustom(tmpProject(), [
    '---',
    'schema: soma-project/v1',
    'name: "custom-layers-project"',
    'status: active',
    'foundation_layers: ["roots"]',
    'expansion_layers: ["trunk", "leaves"]',
    '---',
    '',
    '# Custom Layers',
  ].join('\n'));

  runDoctor(['--foundation-check', '--json'], dir);

  // Read project.md and verify foundation_layers still has custom value
  const content = fs.readFileSync(path.join(dir, '.soma', 'project.md'), 'utf8');
  assert.ok(content.includes('["roots"]'), 'Custom foundation_layers must be preserved');
});
