/**
 * contract-foundation-check.test.cjs — T-02
 * Contract test stub for CONTRACT-FOUNDATION-CHECK-01
 *
 * @spec AC-01..AC-17
 * @contract CONTRACT-FOUNDATION-CHECK-01
 *
 * This file tests the contract shape of `soma doctor --foundation-check`.
 * Tests are intentionally thin stubs verifying the CLI surface exists and
 * returns the correct JSON schema shape. Full AC coverage in per-AC test files.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME_REPO = process.env.SOMA_HOME_REPO || path.join(os.homedir(), '.soma-v2');
const SCRATCH_REPO = path.resolve(__dirname, '../..');

function tmpProject(prefix = 'soma-contract-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runDoctor(args, projectDir) {
  const cwd = fs.existsSync(path.join(SCRATCH_REPO, 'scripts/doctor.cjs'))
    ? SCRATCH_REPO
    : SOMA_HOME_REPO;
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd,
    encoding: 'utf8',
  });
}

/**
 * Bootstrap a minimal SOMA project dir with .soma/project.md
 */
function bootstrapProject(dir, extras = {}) {
  const somaDir = path.join(dir, '.soma');
  const modulesDir = path.join(somaDir, 'modules');
  fs.mkdirSync(somaDir, { recursive: true });
  fs.mkdirSync(modulesDir, { recursive: true });

  const projectMd = [
    '---',
    'schema: soma-project/v1',
    'name: "test-project"',
    'status: active',
    ...(extras.foundation_layers ? [`foundation_layers: ${JSON.stringify(extras.foundation_layers)}`] : []),
    ...(extras.expansion_layers ? [`expansion_layers: ${JSON.stringify(extras.expansion_layers)}`] : []),
    ...(extras.tech_stack ? [`tech_stack: ${JSON.stringify(extras.tech_stack)}`] : []),
    ...(extras.decisions ? [`decisions: ${JSON.stringify(extras.decisions)}`] : []),
    ...(extras.test_command !== undefined ? [`test_command: "${extras.test_command}"`] : []),
    ...(extras.build_command !== undefined ? [`build_command: "${extras.build_command}"`] : []),
    ...(extras.typecheck_command !== undefined ? [`typecheck_command: "${extras.typecheck_command}"`] : []),
    ...(extras.lint_command !== undefined ? [`lint_command: "${extras.lint_command}"`] : []),
    '---',
    '',
    '# Test Project',
  ].join('\n');
  fs.writeFileSync(path.join(somaDir, 'project.md'), projectMd, 'utf8');
  return dir;
}

// --------------------------------------------------------------------------
// CONTRACT SHAPE TESTS
// --------------------------------------------------------------------------

test('CONTRACT: --foundation-check flag is recognized (not INVALID_ARGS)', () => {
  const dir = bootstrapProject(tmpProject());
  const result = runDoctor(['--foundation-check', '--json'], dir);
  // Should NOT exit with code 2 (INVALID_ARGS) — the flag must be recognized
  assert.notEqual(result.status, 2, `Expected flag to be recognized, got exit ${result.status}. stderr: ${result.stderr}`);
});

test('CONTRACT: --foundation-check --json returns schema soma-foundation-check/v1', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, 'soma-foundation-check/v1', `Expected schema soma-foundation-check/v1, got: ${out.schema}`);
});

test('CONTRACT: output has project, foundation_layers, expansion_layers, criteria, summary fields', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.ok('project' in out, 'Missing field: project');
  assert.ok('foundation_layers' in out, 'Missing field: foundation_layers');
  assert.ok('expansion_layers' in out, 'Missing field: expansion_layers');
  assert.ok('criteria' in out, 'Missing field: criteria');
  assert.ok('summary' in out, 'Missing field: summary');
});

test('CONTRACT: criteria array has 9 elements when foundation configured', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.equal(out.criteria.length, 9, `Expected 9 criteria, got ${out.criteria.length}`);
});

test('CONTRACT: each criterion has id, name, status, message fields', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  for (const c of out.criteria) {
    assert.ok('id' in c, `Criterion missing id: ${JSON.stringify(c)}`);
    assert.ok('name' in c, `Criterion missing name: ${JSON.stringify(c)}`);
    assert.ok('status' in c, `Criterion missing status: ${JSON.stringify(c)}`);
    assert.ok('message' in c, `Criterion missing message: ${JSON.stringify(c)}`);
  }
});

test('CONTRACT: criterion status values are valid (pass|fail|skipped|not-applicable)', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  const valid = new Set(['pass', 'fail', 'skipped', 'not-applicable']);
  for (const c of out.criteria) {
    assert.ok(valid.has(c.status), `Invalid status "${c.status}" for criterion ${c.id}`);
  }
});

test('CONTRACT: summary has total=9, pass, fail, skipped, foundation_done fields', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);
  assert.equal(out.summary.total, 9);
  assert.ok('pass' in out.summary, 'summary missing pass');
  assert.ok('fail' in out.summary, 'summary missing fail');
  assert.ok('skipped' in out.summary, 'summary missing skipped');
  assert.ok('foundation_done' in out.summary, 'summary missing foundation_done');
});

test('CONTRACT: legacy state (no foundation_layers) returns FOUNDATION_NOT_CONFIGURED warning, null summary', () => {
  const dir = bootstrapProject(tmpProject()); // no foundation_layers
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}`);
  const out = JSON.parse(result.stdout);
  assert.equal(out.foundation_layers, null);
  assert.equal(out.summary, null);
  const warn = (out.warnings || []).find(w => w.code === 'FOUNDATION_NOT_CONFIGURED');
  assert.ok(warn, 'Expected FOUNDATION_NOT_CONFIGURED warning');
});

test('CONTRACT: --gate mode emits "fundação sólida o suficiente?" stdout line', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['roots', 'trunk'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--gate'], dir);
  assert.ok(
    result.stdout.includes('fundação sólida o suficiente?'),
    `Expected rhetorical gate sentence in stdout. Got: ${result.stdout}`
  );
});

test('CONTRACT: INVALID_LAYER returns error code and exit 1', () => {
  const dir = bootstrapProject(tmpProject(), {
    foundation_layers: ['custom-layer'],
    expansion_layers: ['leaves'],
  });
  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 1);
  const out = JSON.parse(result.stdout);
  assert.ok(out.error && out.error.code === 'INVALID_LAYER', `Expected INVALID_LAYER error, got: ${JSON.stringify(out.error)}`);
});
