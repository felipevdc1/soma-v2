'use strict';
// @spec AC-07
// Integration tests: exit codes for doctor and sync in 3 fixture states

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

// ---- Fixture helpers ----

/** Create a fixture with DRIFT present (D1/D2: ~/AGENTS.md missing blocks) */
function createDriftFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-exit-drift-'));
  const somaDir = path.join(dir, '.soma-v2');
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
  const realCodexAgents = path.join(os.homedir(), '.codex', 'AGENTS.md');
  if (fs.existsSync(realCodexAgents)) {
    fs.copyFileSync(realCodexAgents, path.join(dir, '.codex', 'AGENTS.md'));
  }
  // AGENTS.md without the required blocks
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Basic rules only\n');

  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const patched = targets.entries.map(e => ({
    ...e,
    target_path: e.target_path === '~/.codex/AGENTS.md'
      ? path.join(dir, '.codex', 'AGENTS.md')
      : e.target_path === '~/AGENTS.md'
        ? path.join(dir, 'AGENTS.md')
        : e.target_path
  }));
  fs.writeFileSync(targetsPath, JSON.stringify({ ...targets, entries: patched }, null, 2));
  return { dir, somaDir };
}

/** Create a fixture with everything IN SYNC (no entries) */
function createInSyncFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-exit-insync-'));
  const somaDir = path.join(dir, '.soma-v2');
  fs.mkdirSync(path.join(somaDir, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'claude'), { recursive: true });

  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0-test', files: []
  }));
  fs.writeFileSync(path.join(somaDir, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'codex', entries: [] }));
  fs.writeFileSync(path.join(somaDir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] }));

  return { dir, somaDir };
}

/** Create a fixture with HARD ERROR (no manifest.json) */
function createErrorFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-exit-error-'));
  const somaDir = path.join(dir, '.soma-v2-empty');
  fs.mkdirSync(somaDir);
  return { dir, somaDir };
}

function runDoctor(somaDir, extraArgs = []) {
  return spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`, ...extraArgs], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });
}

function runSync(somaDir, extraArgs = []) {
  return spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`, ...extraArgs], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });
}

// ---- DOCTOR exit codes ----

test('doctor: exit code 1 when drift present', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);
  assert.equal(result.status, 1,
    `Expected exit 1 (drift), got ${result.status}. stderr: ${result.stderr}`);
});

test('doctor: exit code 0 when no drifts (all in sync)', () => {
  const { somaDir } = createInSyncFixture();
  const result = runDoctor(somaDir);
  assert.equal(result.status, 0,
    `Expected exit 0 (in sync), got ${result.status}. stderr: ${result.stderr}`);
});

test('doctor: exit code 2 when manifest missing (hard error)', () => {
  const { somaDir } = createErrorFixture();
  const result = runDoctor(somaDir);
  assert.equal(result.status, 2,
    `Expected exit 2 (hard error), got ${result.status}`);
});

test('doctor: exit code 2 when INVALID_ARGS (--json --quiet)', () => {
  const { somaDir } = createInSyncFixture();
  const result = runDoctor(somaDir, ['--quiet']);
  assert.equal(result.status, 2,
    `Expected exit 2 (INVALID_ARGS with --json --quiet), got ${result.status}`);
});

test('doctor: exit code 2 when manifest.json is invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-exit-badjson-'));
  const somaDir = path.join(dir, '.soma-v2');
  fs.mkdirSync(somaDir);
  fs.writeFileSync(path.join(somaDir, 'manifest.json'), 'not valid json {{{');
  const result = runDoctor(somaDir);
  assert.equal(result.status, 2,
    `Expected exit 2 (invalid JSON manifest), got ${result.status}`);
});

// ---- SYNC exit codes ----

test('sync --dry-run: exit code 1 when actionable findings (insert/drift)', () => {
  const { somaDir } = createDriftFixture();
  const result = runSync(somaDir);
  assert.equal(result.status, 1,
    `Expected exit 1 (actionable findings), got ${result.status}. stderr: ${result.stderr}`);
});

test('sync --dry-run: exit code 0 when all entries skip (everything in sync)', () => {
  const { somaDir } = createInSyncFixture();
  const result = runSync(somaDir);
  assert.equal(result.status, 0,
    `Expected exit 0 (all skip), got ${result.status}. stderr: ${result.stderr}`);
});

test('sync --dry-run: exit code 2 when manifest missing (hard error)', () => {
  const { somaDir } = createErrorFixture();
  const result = runSync(somaDir);
  assert.equal(result.status, 2,
    `Expected exit 2 (hard error), got ${result.status}`);
});

// BF-07 (Wave 2.A): "Phase 2 enforcement" test DELETED.
// Rationale: BF-07 explicitly removed the hard error for missing --dry-run / --apply.
// No-flags now defaults to dry-run (exit 0 or 1). The previous "exit 2" contract
// was removed. Deleting this test per Article VI (test contradicted locked BF-07 contract).

test('sync --dry-run: exit code 2 when --json --verbose (INVALID_ARGS)', () => {
  const { somaDir } = createInSyncFixture();
  const result = spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', '--verbose', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });
  assert.equal(result.status, 2,
    `Expected exit 2 (--json --verbose INVALID_ARGS), got ${result.status}`);
});

// ---- Semantic consistency ----

test('doctor: JSON output .summary.total_findings > 0 correlates with exit 1', () => {
  const { somaDir } = createDriftFixture();
  const result = runDoctor(somaDir);
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.ok(parsed.summary.total_findings > 0,
    `Exit 1 but total_findings is 0`);
});

test('sync: JSON output .summary.by_action actionable count > 0 correlates with exit 1', () => {
  const { somaDir } = createDriftFixture();
  const result = runSync(somaDir);
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  const actionableCount = parsed.summary.by_action.insert +
    parsed.summary.by_action.replace +
    parsed.summary.by_action.drift;
  assert.ok(actionableCount > 0,
    `Exit 1 but no actionable findings: ${JSON.stringify(parsed.summary.by_action)}`);
});
