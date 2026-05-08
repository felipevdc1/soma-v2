'use strict';
// @spec AC-06
// @contract CONTRACT-SYNC-DRYRUN-01
// Contract tests for scripts/sync.cjs — Wave 1 RED phase
// These tests MUST fail before sync.cjs is implemented.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

// Synthetic ~/AGENTS.md fixture WITHOUT soma-v2 blocks → guarantees insert actions.
// Replacing real ~/AGENTS.md dependency: real file may be fully in-sync (all blocks present),
// which would produce exit 0 and break the "exit 1 when actionable" contract test.
const EMPTY_AGENTS_MD = '# Global Agent Operating Rules\n\nBasic rules only — missing CBM and soma-stsd blocks.\n';

// Helper: create fixture soma_home for testing
function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-fixture-'));
  const somaDir = path.join(dir, '.soma-v2');
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  // Patch codex install-targets to point ~/AGENTS.md entries at a fixture file WITHOUT blocks.
  // Guarantees insert actions regardless of real ~/AGENTS.md state.
  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  if (fs.existsSync(targetsPath)) {
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    // Write empty AGENTS.md fixture
    const fixtureAgentsMd = path.join(dir, 'fixture-AGENTS.md');
    fs.writeFileSync(fixtureAgentsMd, EMPTY_AGENTS_MD, 'utf8');
    const patchedEntries = targets.entries.map(e => {
      if (e.target_path === '~/AGENTS.md') return { ...e, target_path: fixtureAgentsMd };
      return e;
    });
    fs.writeFileSync(targetsPath, JSON.stringify({ ...targets, entries: patchedEntries }, null, 2));
  }

  return { dir, somaDir };
}

// Helper: run sync with given args
function runSync(args = [], somaHomeOverride = null) {
  const allArgs = ['scripts/sync.cjs', ...args];
  if (somaHomeOverride) allArgs.push(`--soma-home=${somaHomeOverride}`);
  return spawnSync('node', allArgs, {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });
}

// ----- --dry-run default behavior (BF-07) -----

test('sync: no flags defaults to dry-run (BF-07 — not INVALID_ARGS exit 2)', () => {
  // TEST-STALE-FIX: BF-07 (Wave 2.A) removed "no mode flag = INVALID_ARGS".
  // No-flags now silently defaults to --dry-run. Exit 0 or 1 (never 2 for this case).
  const { somaDir } = createFixture();
  const result = runSync([], somaDir);

  assert.ok(result.status === 0 || result.status === 1,
    `Expected exit 0 or 1 (dry-run default per BF-07), got ${result.status}`);

  // Output should be valid JSON with mode=dry-run
  const combined = result.stdout + result.stderr;
  assert.ok(combined.length > 0, 'Expected non-empty output');
});

test('sync: no-flags with --json produces valid dry-run output (BF-07)', () => {
  // BF-07: confirms no-flags + --json produces dry-run output (replaces old "error schema" test).
  const { somaDir } = createFixture();
  const result = runSync(['--json'], somaDir);

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`Expected valid JSON output from no-flags sync, got: ${result.stdout.slice(0, 200)}`);
  }
  assert.equal(parsed.mode, 'dry-run', `Expected mode=dry-run, got: ${parsed.mode}`);
});

// ----- JSON schema contract tests -----

test('sync --dry-run: --json output has required top-level fields', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json'], somaDir);

  assert.ok(result.stdout.length > 0, `Expected stdout, got stderr: ${result.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`sync --json output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }

  assert.equal(parsed.tool, 'sync');
  assert.equal(parsed.mode, 'dry-run');
  assert.ok(typeof parsed.soma_home === 'string', 'soma_home must be string');
  assert.ok(Array.isArray(parsed.adapters_scanned), 'adapters_scanned must be array');
  assert.ok(parsed.summary !== undefined, 'summary must exist');
  assert.ok(Array.isArray(parsed.findings), 'findings must be array');
});

test('sync --dry-run: summary has required fields (total_entries/by_action)', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json'], somaDir);

  const parsed = JSON.parse(result.stdout);
  const { summary } = parsed;

  assert.ok(typeof summary.total_entries === 'number', 'summary.total_entries must be number');
  assert.ok(summary.by_action !== undefined, 'summary.by_action must exist');
  // by_action should have action counts
  const validActions = ['insert', 'replace', 'skip', 'drift'];
  for (const action of validActions) {
    assert.ok(typeof summary.by_action[action] === 'number',
      `summary.by_action.${action} must be number, got ${typeof summary.by_action[action]}`);
  }
});

test('sync --dry-run: each finding has action/adapter/target_path/target_anchor_id fields', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json'], somaDir);

  const parsed = JSON.parse(result.stdout);
  const validActions = ['insert', 'replace', 'skip', 'drift'];

  for (const finding of parsed.findings) {
    assert.ok(validActions.includes(finding.action),
      `finding.action must be one of ${validActions.join('/')}, got: ${finding.action}`);
    assert.ok(typeof finding.target_path === 'string',
      `finding.target_path must be string: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.target_anchor_id === 'string',
      `finding.target_anchor_id must be string: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.source_doc === 'string',
      `finding.source_doc must be string: ${JSON.stringify(finding)}`);
  }
});

test('sync --dry-run: jq empty exits 0 (valid JSON)', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json'], somaDir);

  const jqResult = spawnSync('jq', ['empty'], {
    input: result.stdout,
    encoding: 'utf8'
  });
  assert.equal(jqResult.status, 0, `jq empty failed: ${jqResult.stderr}`);
});

// ----- Args contract tests -----

test('sync: accepts --soma-home flag', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json', `--soma-home=${somaDir}`]);
  assert.notEqual(result.status, 2, `Expected non-2 exit: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.soma_home, somaDir);
});

test('sync: accepts --tool flag to filter adapter', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json', '--tool=codex'], somaDir);
  assert.notEqual(result.status, 2, `Expected non-2 exit: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.adapters_scanned, ['codex']);
});

test('sync: --json --verbose returns INVALID_ARGS (exit 2)', () => {
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json', '--verbose'], somaDir);
  assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);
});

// ----- Exit code contract tests -----

test('sync --dry-run: exit code 1 when actionable findings (insert/replace/drift)', () => {
  // Real state has 2 insert actions for ~/AGENTS.md
  const { somaDir } = createFixture();
  const result = runSync(['--dry-run', '--json'], somaDir);
  assert.equal(result.status, 1, `Expected exit 1 with actionable findings, got ${result.status}`);
});

test('sync --dry-run: exit code 0 when all entries are skip (everything in sync)', () => {
  // Create fixture with no entries → all skip → exit 0
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-insync-'));
  const somaDir = path.join(dir, '.soma-v2');
  fs.mkdirSync(path.join(somaDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'claude'), { recursive: true });

  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0-test', files: []
  }));

  const emptyTargets = { schema: 'soma-install-targets/v1', tool: 'codex', entries: [] };
  fs.writeFileSync(path.join(somaDir, 'adapters', 'codex', 'install-targets.json'), JSON.stringify(emptyTargets));
  fs.writeFileSync(
    path.join(somaDir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] })
  );

  const result = runSync(['--dry-run', '--json', `--soma-home=${somaDir}`]);
  assert.equal(result.status, 0, `Expected exit 0 with no entries, got ${result.status}. stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.by_action.insert, 0);
  assert.equal(parsed.summary.by_action.drift, 0);
  assert.equal(parsed.summary.by_action.replace, 0);
});

test('sync --dry-run: exit code 2 when manifest missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-nomfest-'));
  const somaDir = path.join(dir, '.soma-v2-empty');
  fs.mkdirSync(somaDir);
  const result = runSync(['--dry-run', '--json', `--soma-home=${somaDir}`]);
  assert.equal(result.status, 2, `Expected exit 2 for missing manifest, got ${result.status}`);
});
