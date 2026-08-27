'use strict';
// @spec AC-05
// Smoke test: doctor + sync --dry-run against real ~/.soma-v2 don't break hooks 48/48

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');

// Resolve node binary explicitly — bun sets process.execPath to itself, which
// breaks the wrapper + inner runner pattern (bun --test has recursive detection).
const NODE_BIN = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim() || 'node';

function sha256file(filepath) {
  try {
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

const CANONICAL_SOURCES = [
  path.join(os.homedir(), '.codex', 'AGENTS.md'),
  path.join(os.homedir(), 'AGENTS.md'),
  path.join(os.homedir(), '.claude', 'constitution.md'),
  path.join(os.homedir(), '.claude', 'CLAUDE.md')
].filter(p => fs.existsSync(p));

function captureCanonicalShas() {
  const result = {};
  for (const p of CANONICAL_SOURCES) {
    result[p] = sha256file(p);
  }
  return result;
}

/**
 * Run hooks tests by spawning `node --test` directly, with NODE_TEST_CONTEXT
 * stripped from the child's env to avoid Node.js v22+'s "recursive node:test"
 * detection. No wrapper script is generated — see no-nested-test-spawn.test.cjs
 * for why: a wrapper that itself spawns a "neto" process orphans that neto
 * whenever the outer spawnSync's timeout kills the wrapper before the neto
 * finishes (the neto is reparented to PID 1 and keeps running, unbounded).
 */
function runHooksTests() {
  spawnSync('bash', ['-c', 'rm -f /tmp/soma-state-trap* 2>/dev/null'], { encoding: 'utf8' });

  const hookTestFiles = getHooksTestFiles();
  if (hookTestFiles.length === 0) {
    return { tests: 0, pass: 0, fail: 0, raw: '' };
  }

  // Telemetry isolation: the hook test files under HOOKS_DIR exercise
  // capture-defer-gate.cjs / insight-action-coupling.cjs, which append Article
  // XI / insight-coupling telemetry. Without an override they write straight
  // into ~/.claude/logs (production). Route them to a throwaway tmp dir here.
  // NOTE (2026-08-16): this only closes the leak once ~/.claude/hooks/ itself
  // is resynced — the copy deployed there today (2026-05-05, predates commit
  // 1d467af which added the override) hardcodes the log path and does not
  // read ARTICLE_XI_LOG_DIR / INSIGHT_COUPLING_LOG_DIR at all. Verified: even
  // with the var set, the deployed hook still writes to the real log and
  // nothing lands in the override dir. Setting it here is still correct —
  // it's what makes isolation work the day the deployed copy catches up.
  const telemetryLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-hooks-regression-telemetry-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-hooks-regression-cwd-'));

  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  env.FORCE_COLOR = '0';
  env.ARTICLE_XI_LOG_DIR = telemetryLogDir;
  env.INSIGHT_COUPLING_LOG_DIR = telemetryLogDir;

  try {
    const result = spawnSync(NODE_BIN, ['--test', ...hookTestFiles], {
      encoding: 'utf8',
      timeout: 60000,
      env,
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const raw = (result.stdout || '') + (result.stderr || '');
    const testsMatch = raw.match(/# tests (\d+)/);
    const passMatch = raw.match(/# pass (\d+)/);
    const failMatch = raw.match(/# fail (\d+)/);

    return {
      tests: testsMatch ? parseInt(testsMatch[1]) : null,
      pass: passMatch ? parseInt(passMatch[1]) : null,
      fail: failMatch ? parseInt(failMatch[1]) : null,
      raw
    };
  } finally {
    try { fs.rmSync(telemetryLogDir, { recursive: true, force: true }); } catch (e) { /* cleanup */ }
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch (e) { /* cleanup */ }
  }
}

function getHooksTestFiles() {
  const files = [];
  try {
    for (const f of fs.readdirSync(HOOKS_DIR)) {
      if (f.endsWith('.test.cjs')) files.push(path.join(HOOKS_DIR, f));
    }
  } catch (err) { /* ignore */ }
  const libTestDir = path.join(HOOKS_DIR, 'lib', '__tests__');
  try {
    for (const f of fs.readdirSync(libTestDir)) {
      if (f.endsWith('.test.cjs')) files.push(path.join(libTestDir, f));
    }
  } catch (err) { /* ignore */ }
  return files;
}

// ---- Tests ----

test('hooks-regression: hooks baseline has zero failures before running doctor/sync', () => {
  const { tests, pass, fail, raw } = runHooksTests();

  assert.equal(fail, 0,
    `Expected 0 hook failures, got pass=${pass} tests=${tests} fail=${fail}\nOutput snippet: ${raw.slice(-200)}`);
  assert.ok(pass >= 48, `Expected hooks baseline ≥48, got pass=${pass}`);
});

test('hooks-regression: doctor against real ~/.soma-v2 does not modify canonical sources', () => {
  const preShas = captureCanonicalShas();

  spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  for (const [filepath, preSha] of Object.entries(preShas)) {
    const postSha = sha256file(filepath);
    assert.equal(postSha, preSha,
      `Canonical source modified by doctor against real ~/.soma-v2: ${filepath}`);
  }
});

test('hooks-regression: sync --dry-run against real ~/.soma-v2 does not modify canonical sources', () => {
  const preShas = captureCanonicalShas();

  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json'], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  for (const [filepath, preSha] of Object.entries(preShas)) {
    const postSha = sha256file(filepath);
    assert.equal(postSha, preSha,
      `Canonical source modified by sync --dry-run against real ~/.soma-v2: ${filepath}`);
  }
});

test('hooks-regression: after doctor + sync, hooks still pass with zero failures', () => {
  // Run doctor + sync against real ~/.soma-v2 (read-only, safe)
  spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });
  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });

  // Re-run hooks tests
  const { tests, pass, fail, raw } = runHooksTests();

  assert.equal(fail, 0,
    `Expected 0 hook failures after doctor+sync, got pass=${pass} tests=${tests} fail=${fail}\nOutput: ${raw.slice(-300)}`);
  assert.ok(pass >= 48,
    `Expected ≥48 hook passes after doctor+sync, got ${pass}`);
});

test('hooks-regression: doctor output is valid JSON (AC-06 real state)', () => {
  const result = spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });

  const jqResult = spawnSync('jq', ['empty'], {
    input: result.stdout, encoding: 'utf8'
  });
  assert.equal(jqResult.status, 0,
    `doctor --json output is not valid JSON. jq error: ${jqResult.stderr}`);
});

test('hooks-regression: sync --dry-run output is valid JSON (AC-06 real state)', () => {
  const result = spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });

  const jqResult = spawnSync('jq', ['empty'], {
    input: result.stdout, encoding: 'utf8'
  });
  assert.equal(jqResult.status, 0,
    `sync --dry-run --json output is not valid JSON. jq error: ${jqResult.stderr}`);
});
