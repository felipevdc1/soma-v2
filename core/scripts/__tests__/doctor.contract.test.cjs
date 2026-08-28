'use strict';
// @spec AC-06
// @contract CONTRACT-DOCTOR-01
// Contract tests for scripts/doctor.cjs — Wave 1 RED phase
// These tests MUST fail before doctor.cjs is implemented.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const DOCTOR = path.join(SOMA_HOME, 'scripts', 'doctor.cjs');

// Helper: create minimal fixture soma_home for testing
function createFixture(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-doctor-fixture-'));
  const somaDir = path.join(dir, '.soma-v2');

  // Copy real soma-v2 structure (manifest + docs + adapters)
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  return { dir, somaDir };
}

// Helper: run doctor with given args + optional somaHome override
function runDoctor(args = [], somaHomeOverride = null) {
  const allArgs = ['scripts/doctor.cjs', ...args];
  if (somaHomeOverride) allArgs.push(`--soma-home=${somaHomeOverride}`);
  return spawnSync('node', allArgs, {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });
}

// ----- JSON schema contract tests -----

test('doctor: --json output has required top-level fields (tool/mode/soma_home/summary/findings)', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json'], somaDir);

  assert.ok(result.stdout.length > 0, `Expected stdout, got stderr: ${result.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`doctor --json output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }

  assert.equal(parsed.tool, 'doctor');
  assert.equal(parsed.mode, 'check');
  assert.ok(typeof parsed.soma_home === 'string', 'soma_home must be string');
  assert.ok(parsed.summary !== undefined, 'summary must exist');
  assert.ok(Array.isArray(parsed.findings), 'findings must be array');
});

test('doctor: summary has required fields (total_findings/by_kind/by_severity)', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json'], somaDir);

  const parsed = JSON.parse(result.stdout);
  const { summary } = parsed;

  assert.ok(typeof summary.total_findings === 'number', 'summary.total_findings must be number');
  assert.ok(summary.by_kind !== undefined, 'summary.by_kind must exist');
  assert.ok(summary.by_severity !== undefined, 'summary.by_severity must exist');
});

test('doctor: each finding has kind/severity/target_path/target_anchor_id/message fields', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json'], somaDir);

  const parsed = JSON.parse(result.stdout);
  for (const finding of parsed.findings) {
    assert.ok(typeof finding.kind === 'string', `finding.kind must be string: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.severity === 'string', `finding.severity must be string: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.message === 'string', `finding.message must be string: ${JSON.stringify(finding)}`);
  }
});

test('doctor: jq empty exits 0 (valid JSON)', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json'], somaDir);

  const jqResult = spawnSync('jq', ['empty'], {
    input: result.stdout,
    encoding: 'utf8'
  });
  assert.equal(jqResult.status, 0, `jq empty failed: ${jqResult.stderr}`);
});

// ----- Args contract tests -----

test('doctor: accepts --json flag without error', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json'], somaDir);
  assert.notEqual(result.status, 2, `Expected non-2 exit, got 2 with stderr: ${result.stderr}`);
});

test('doctor: accepts --soma-home flag', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json', `--soma-home=${somaDir}`]);
  assert.notEqual(result.status, 2, `Expected non-2 exit: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.soma_home, somaDir);
});

test('doctor: --json --quiet returns INVALID_ARGS (exit code 2)', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--json', '--quiet'], somaDir);
  assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);
  // Output should mention INVALID_ARGS or error
  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('INVALID_ARGS') || combined.includes('exclusive') || combined.includes('Cannot use'),
    `Expected INVALID_ARGS in output, got: ${combined.slice(0, 200)}`
  );
});

test('doctor: --quiet --verbose returns INVALID_ARGS (exit code 2)', () => {
  const { somaDir } = createFixture();
  const result = runDoctor(['--quiet', '--verbose'], somaDir);
  assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);
});

// ----- Exit code contract tests -----

test('doctor: exit code 1 when drift detected', () => {
  const { dir, somaDir } = createFixture();
  const driftTarget = path.join(dir, 'missing-AGENTS.md');
  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  targets.entries = [{
    block_id: 'block.codex.AGENTS.hyd-v2',
    source_doc: 'docs/hyd-v2.md',
    target_path: driftTarget,
    target_anchor_id: 'block.codex.AGENTS.hyd-v2'
  }];
  fs.writeFileSync(targetsPath, JSON.stringify(targets));
  const result = runDoctor(['--json'], somaDir);
  assert.equal(result.status, 1, `Expected exit 1 with a fixture drift, got ${result.status}`);
});

test('doctor: exit code 0 when no drifts (fixture with all in sync)', () => {
  // Create minimal fixture that has no install-targets entries → zero drifts
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-doctor-insync-'));
  const somaDir = path.join(dir, '.soma-v2');
  fs.mkdirSync(path.join(somaDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'claude'), { recursive: true });

  // Minimal manifest
  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1',
    version: '2.1.0-test',
    files: []
  }));

  // Install-targets with zero entries
  const emptyTargets = { schema: 'soma-install-targets/v1', tool: 'codex', entries: [] };
  fs.writeFileSync(path.join(somaDir, 'adapters', 'codex', 'install-targets.json'), JSON.stringify(emptyTargets));
  fs.writeFileSync(
    path.join(somaDir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] })
  );

  const result = runDoctor(['--json', `--soma-home=${somaDir}`]);
  assert.equal(result.status, 0, `Expected exit 0 with no entries, got ${result.status}. stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.total_findings, 0);
});

test('doctor: exit code 2 when manifest missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-doctor-nomfest-'));
  const somaDir = path.join(dir, '.soma-v2-empty');
  fs.mkdirSync(somaDir);
  const result = runDoctor(['--json', `--soma-home=${somaDir}`]);
  assert.equal(result.status, 2, `Expected exit 2 for missing manifest, got ${result.status}`);
});
