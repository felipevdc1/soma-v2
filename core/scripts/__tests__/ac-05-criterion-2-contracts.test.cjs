/**
 * ac-05-criterion-2-contracts.test.cjs — T-07
 * @spec AC-05
 * Criterion 2: "rotas + APIs definidas zero ambiguidade"
 * Pass if each trunk module has ≥1 contract file in specs/{slug}/contracts/*.md
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-ac05-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function bootstrapBase(dir) {
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

function writeModule(dir, slug, layer) {
  const modulesDir = path.join(dir, '.soma', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, `${slug}.md`), [
    '---',
    'schema: soma-module/v1',
    `name: "${slug}"`,
    'status: active',
    'source_confidence: high',
    'owners: []',
    'last_verified: null',
    'source_path: "src/"',
    'initialized_at: "2026-01-01T00:00:00.000Z"',
    `layer: ${layer}`,
    '---',
    '',
    `# ${slug}`,
  ].join('\n'), 'utf8');
}

function writeContract(dir, specSlug, content) {
  const contractsDir = path.join(dir, 'specs', specSlug, 'contracts');
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.writeFileSync(path.join(contractsDir, `${specSlug}-contract.md`), content, 'utf8');
}

test('AC-05 criterion 2 PASS: trunk module covered by contract file', () => {
  const dir = bootstrapBase(tmpProject());
  writeModule(dir, 'auth', 'trunk');
  // Contract references auth module
  writeContract(dir, 'auth-api', `# Auth API Contract\nspec_ref: auth\n\n## Endpoints\n- POST /auth/login`);

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c2 = out.criteria.find(c => c.id === 2);
  assert.equal(c2.status, 'pass', `Expected criterion 2 pass, got: ${JSON.stringify(c2)}`);
});

test('AC-05 criterion 2 FAIL: trunk module with no contract file', () => {
  const dir = bootstrapBase(tmpProject());
  writeModule(dir, 'auth', 'trunk');
  // No contracts written

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c2 = out.criteria.find(c => c.id === 2);
  assert.equal(c2.status, 'fail', `Expected criterion 2 fail, got: ${JSON.stringify(c2)}`);
  assert.ok(c2.message.includes('auth'), `Expected message to mention uncovered module. Got: ${c2.message}`);
});

test('AC-05 criterion 2 PASS (not-applicable): no trunk modules = trivially satisfied', () => {
  const dir = bootstrapBase(tmpProject());
  writeModule(dir, 'reports', 'leaves'); // only leaves modules

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c2 = out.criteria.find(c => c.id === 2);
  // No trunk modules → pass or not-applicable
  assert.ok(
    c2.status === 'pass' || c2.status === 'not-applicable',
    `Expected pass or not-applicable when no trunk modules. Got: ${JSON.stringify(c2)}`
  );
});

test('AC-05 criterion 2: message mentions uncovered modules on fail', () => {
  const dir = bootstrapBase(tmpProject());
  writeModule(dir, 'payments', 'trunk');
  writeModule(dir, 'billing', 'trunk');
  // No contracts

  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const c2 = out.criteria.find(c => c.id === 2);
  assert.equal(c2.status, 'fail');
  assert.ok(c2.message.includes('payments') || c2.message.includes('billing'), `Expected uncovered module names in message. Got: ${c2.message}`);
});
