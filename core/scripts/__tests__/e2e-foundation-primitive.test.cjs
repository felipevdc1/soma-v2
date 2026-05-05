/**
 * e2e-foundation-primitive.test.cjs — T-22
 * @spec CONTRACT-FOUNDATION-CHECK-01
 * E2E integration smoke: full happy path (all 9 pass) → --gate exit 0 →
 * break criterion 4 → --gate exit 1.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRATCH_REPO = path.resolve(__dirname, '../..');

function runDoctor(args, projectDir) {
  return spawnSync('node', ['scripts/doctor.cjs', ...args, '--project', projectDir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
  });
}

function buildAllPassProject(baseDir) {
  const dir = fs.mkdtempSync(path.join(baseDir || os.tmpdir(), 'soma-e2e-'));
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });

  // Criterion 1: ADR file
  const adrDir = path.join(dir, 'docs', 'architecture-decisions');
  fs.mkdirSync(adrDir, { recursive: true });
  fs.writeFileSync(path.join(adrDir, '0001-stack-choice.md'), '# ADR-0001: Stack Choice\n\nUse Node.js v22.', 'utf8');

  // Criterion 2: Contract for trunk module
  const contractsDir = path.join(dir, 'specs', 'auth-api', 'contracts');
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.writeFileSync(path.join(contractsDir, 'auth-contract.md'), '# Auth API Contract\nspec_ref: auth\n\n## Endpoints\n- POST /auth/login', 'utf8');

  // Criterion 3/4/5: Clean source files for foundation modules
  const srcCoreDir = path.join(dir, 'src', 'core');
  const srcAuthDir = path.join(dir, 'src', 'auth');
  fs.mkdirSync(srcCoreDir, { recursive: true });
  fs.mkdirSync(srcAuthDir, { recursive: true });
  fs.writeFileSync(path.join(srcCoreDir, 'service.ts'), [
    'const DB_URL = process.env.DATABASE_URL;',
    'export function init() { return DB_URL; }',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(srcAuthDir, 'handler.ts'), [
    'export function login(user: string, pass: string) {}',
  ].join('\n'), 'utf8');

  // project.md with all Phase 4d fields
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---',
    'schema: soma-project/v1',
    'name: "e2e-test-project"',
    'status: active',
    'foundation_layers: ["roots", "trunk"]',
    'expansion_layers: ["leaves"]',
    'tech_stack: [{"name":"Node.js","version":"22","role":"runtime"},{"name":"TypeScript","version":"5","role":"language"}]',
    'test_command: "true"',
    'build_command: "true"',
    'typecheck_command: "true"',
    'lint_command: "true"',
    '---',
    '',
    '# E2E Test Project',
  ].join('\n'), 'utf8');

  // roots module (core)
  fs.writeFileSync(path.join(somaDir, 'modules', 'core.md'), [
    '---',
    'schema: soma-module/v1',
    'name: "core"',
    'status: active',
    'source_confidence: high',
    'owners: []',
    'last_verified: null',
    'source_path: "src/"',
    'source_files: ["src/core/service.ts"]',
    'initialized_at: "2026-01-01T00:00:00.000Z"',
    'layer: roots',
    '---',
    '',
    '# core',
  ].join('\n'), 'utf8');

  // trunk module (auth) — has contract
  fs.writeFileSync(path.join(somaDir, 'modules', 'auth.md'), [
    '---',
    'schema: soma-module/v1',
    'name: "auth"',
    'status: active',
    'source_confidence: high',
    'owners: []',
    'last_verified: null',
    'source_path: "src/"',
    'source_files: ["src/auth/handler.ts"]',
    'initialized_at: "2026-01-01T00:00:00.000Z"',
    'layer: trunk',
    '---',
    '',
    '# auth',
  ].join('\n'), 'utf8');

  return dir;
}

// --------------------------------------------------------------------------
// HAPPY PATH: all 9 criteria pass
// --------------------------------------------------------------------------

test('E2E: all-pass project → all 9 criteria pass (foundation_done=true)', () => {
  const dir = buildAllPassProject();
  const result = runDoctor(['--foundation-check', '--json'], dir);

  assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);

  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, 'soma-foundation-check/v1');
  assert.equal(out.criteria.length, 9);

  const fails = out.criteria.filter(c => c.status === 'fail');
  assert.equal(fails.length, 0, `Expected 0 fails. Got: ${JSON.stringify(fails)}`);

  assert.equal(out.summary.foundation_done, true, 'Expected foundation_done=true');
});

test('E2E: all-pass project → --gate exits 0', () => {
  const dir = buildAllPassProject();
  const result = runDoctor(['--foundation-check', '--gate'], dir);
  assert.equal(result.status, 0, `Expected gate exit 0. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('fundação sólida o suficiente?'), 'Expected rhetorical sentence');
});

test('E2E: all-pass project → --gate --json exits 0 with JSON + rhetorical line', () => {
  const dir = buildAllPassProject();
  const result = runDoctor(['--foundation-check', '--gate', '--json'], dir);
  assert.equal(result.status, 0, `Expected gate exit 0. Got: ${result.status}`);
  assert.ok(result.stdout.includes('fundação sólida o suficiente?'), 'Expected rhetorical sentence');
});

// --------------------------------------------------------------------------
// BREAK criterion 4 → gate exit 1
// --------------------------------------------------------------------------

test('E2E: after breaking criterion 4 (hardcoded URL) → --gate exits 1', () => {
  const dir = buildAllPassProject();

  // Break: add hardcoded URL to foundation source file
  fs.writeFileSync(path.join(dir, 'src', 'core', 'config.ts'), [
    'const API_URL = "http://localhost:3000"; // hardcoded — should fail criterion 4',
    'export { API_URL };',
  ].join('\n'), 'utf8');

  // Add config.ts to module source_files
  const coreModulePath = path.join(dir, '.soma', 'modules', 'core.md');
  const coreContent = fs.readFileSync(coreModulePath, 'utf8');
  fs.writeFileSync(coreModulePath, coreContent.replace(
    'source_files: ["src/core/service.ts"]',
    'source_files: ["src/core/service.ts", "src/core/config.ts"]'
  ), 'utf8');

  const result = runDoctor(['--foundation-check', '--gate'], dir);
  assert.equal(result.status, 1, `Expected gate exit 1 after breaking criterion 4. Got: ${result.status}\nstdout: ${result.stdout}`);
  assert.ok(result.stdout.includes('fundação sólida o suficiente?'), 'Expected rhetorical sentence even on fail');
});

test('E2E: broken criterion 4 → --foundation-check (standalone) still exits 0 (non-blocking)', () => {
  const dir = buildAllPassProject();

  // Break criterion 4
  fs.writeFileSync(path.join(dir, 'src', 'core', 'secret.ts'), [
    'const secret = "my-api-secret-key";',
    'export { secret };',
  ].join('\n'), 'utf8');

  const coreModulePath = path.join(dir, '.soma', 'modules', 'core.md');
  const coreContent = fs.readFileSync(coreModulePath, 'utf8');
  fs.writeFileSync(coreModulePath, coreContent.replace(
    'source_files: ["src/core/service.ts"]',
    'source_files: ["src/core/service.ts", "src/core/secret.ts"]'
  ), 'utf8');

  const result = runDoctor(['--foundation-check', '--json'], dir);
  assert.equal(result.status, 0, `Standalone --foundation-check must exit 0 even with fails. Got: ${result.status}`);

  const out = JSON.parse(result.stdout);
  const c4 = out.criteria.find(c => c.id === 4);
  assert.equal(c4.status, 'fail', 'Criterion 4 should be fail');
});

// --------------------------------------------------------------------------
// Verify criterion names (contract compliance)
// --------------------------------------------------------------------------

test('E2E: criterion names match Bruno 9-criterion specification', () => {
  const dir = buildAllPassProject();
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);

  const expectedNames = [
    'padrões claros',
    'rotas + APIs definidas',
    'zero data leakage',
    'zero hardcoded',
    'tudo dados reais',
    'testes passando',
    'build limpo',
    'IDE sem erro',
    'tech stack bem definida',
  ];

  for (let i = 0; i < 9; i++) {
    assert.equal(out.criteria[i].id, i + 1);
    assert.ok(
      out.criteria[i].name.includes(expectedNames[i].split(' ')[0]),
      `Criterion ${i+1} name mismatch. Expected includes "${expectedNames[i]}". Got: "${out.criteria[i].name}"`
    );
  }
});

// --------------------------------------------------------------------------
// Verify output shape (contract compliance)
// --------------------------------------------------------------------------

test('E2E: output shape matches CONTRACT-FOUNDATION-CHECK-01 schema', () => {
  const dir = buildAllPassProject();
  const result = runDoctor(['--foundation-check', '--json'], dir);
  const out = JSON.parse(result.stdout);

  assert.equal(out.schema, 'soma-foundation-check/v1');
  assert.ok(typeof out.project === 'string');
  assert.ok(Array.isArray(out.foundation_layers));
  assert.ok(Array.isArray(out.expansion_layers));
  assert.ok(Array.isArray(out.criteria));
  assert.equal(out.criteria.length, 9);
  assert.ok(out.summary !== null);
  assert.ok('total' in out.summary);
  assert.ok('pass' in out.summary);
  assert.ok('fail' in out.summary);
  assert.ok('skipped' in out.summary);
  assert.ok('foundation_done' in out.summary);
  assert.ok(Array.isArray(out.warnings));
  assert.ok('error' in out);
});
