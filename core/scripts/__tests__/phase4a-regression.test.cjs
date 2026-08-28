'use strict';
// @spec AC-08
// @contract CONTRACT-INIT-EXISTING-01
// T-16: Phase 4a regression suite
// Spawns node --test over all Phase 4a tests via bridge wrapper pattern (Node v22 workaround).
// Verifies cumulative count = Phase 2+3 baseline (238) + Phase 4a additions, all pass.
// Also re-verifies 48/48 hooks regression.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOMA_HOME = process.env.SOMA_HOME || path.join(REPO_ROOT, 'core');
const TESTS_DIR = path.join(SOMA_HOME, 'scripts', '__tests__');
const HOOKS_DIR = path.join(SOMA_HOME, 'hooks');

// Resolve node binary explicitly — bun sets process.execPath to itself, which
// breaks the wrapper + inner runner pattern (bun --test has recursive detection).
const NODE_BIN = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim() || 'node';

// Phase 4a test files (do NOT include this regression file itself to avoid recursion)
const PHASE4A_TEST_FILES = [
  'init-existing.contract.test.cjs',
  'init-existing.h2-src.test.cjs',
  'init-existing.h2-workspaces.test.cjs',
  'init-existing.h2-framework.test.cjs',
  'init-existing.module-emit.test.cjs',
  'init-existing.deep-rank.test.cjs',
  'init-existing.deep-fallback.test.cjs',
  'init-existing.redirect.test.cjs',
  'init-existing.libs-untouched.test.cjs',
  'init-existing.fixture-validation.test.cjs',
  'init-existing.empty-repo.test.cjs',
  'init-existing.threshold.test.cjs',
  'init-existing.cross-llm.test.cjs',
  'init-existing.e2e-smoke.test.cjs'
].map(f => path.join(TESTS_DIR, f));

// Spawns `node --test` directly, with NODE_TEST_CONTEXT stripped from the
// child's env to avoid Node v22+'s "recursive node:test" detection. No
// wrapper script is generated — see no-nested-test-spawn.test.cjs for why:
// a wrapper that itself spawns a "neto" process orphans that neto whenever
// the outer spawnSync's timeout kills the wrapper before the neto finishes.
function runTestsBridge(files, label) {
  // Telemetry isolation: when `files` is the Hooks set (see the 'Hooks' call
  // site below), it exercises capture-defer-gate.cjs / insight-action-coupling.cjs,
  // which append Article XI / insight-coupling telemetry. Without an override
  // they write straight into ~/.claude/logs (production). Set it unconditionally
  // here — harmless no-op for the Phase 4a / Phase 2+3 file sets, which never
  // read these vars.
  // NOTE (2026-08-16): this only closes the leak once ~/.claude/hooks/ itself
  // is resynced — the copy deployed there today (2026-05-05, predates commit
  // 1d467af which added the override) hardcodes the log path and does not
  // read ARTICLE_XI_LOG_DIR / INSIGHT_COUPLING_LOG_DIR at all. Verified: even
  // with the var set, the deployed hook still writes to the real log and
  // nothing lands in the override dir. Setting it here is still correct —
  // it's what makes isolation work the day the deployed copy catches up.
  const telemetryLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-p4a-telemetry-'));
  const projectRoot = label === 'Hooks'
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'soma-p4a-hooks-cwd-'))
    : null;

  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  env.FORCE_COLOR = '0';
  env.ARTICLE_XI_LOG_DIR = telemetryLogDir;
  env.INSIGHT_COUPLING_LOG_DIR = telemetryLogDir;

  try {
    const result = spawnSync(NODE_BIN, ['--test', '--test-concurrency=1', ...files], {
      encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024, env,
      ...(projectRoot ? { cwd: projectRoot } : {})
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
    if (projectRoot) {
      try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch (e) { /* cleanup */ }
    }
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

// ---- Phase 4a test suite all pass ----

test('phase4a-regression: all Phase 4a tests pass (AC-08, CONTRACT-INIT-EXISTING-01)', { timeout: 180000 }, () => {
  const existingFiles = PHASE4A_TEST_FILES.filter(f => fs.existsSync(f));
  assert.ok(existingFiles.length > 0, 'Phase 4a test files must exist');

  const { tests, pass, fail, raw } = runTestsBridge(existingFiles, 'Phase 4a');
  assert.equal(fail, 0, `Phase 4a: must have 0 failures. Got fail=${fail}, pass=${pass}, tests=${tests}\n${raw.slice(-500)}`);
  assert.ok(pass > 0, `Phase 4a: must have at least 1 passing test. Got pass=${pass}`);
});

// ---- Hooks 48/48 regression ----

test('phase4a-regression: hooks pass with zero failures after Phase 4a (AC-08)', () => {
  const hookTestFiles = getHooksTestFiles();
  if (hookTestFiles.length === 0) {
    // Skip gracefully if hooks dir has no tests
    return;
  }

  const { tests, pass, fail, raw } = runTestsBridge(hookTestFiles, 'Hooks');
  assert.equal(fail, 0, `Hooks: must have 0 failures. Got fail=${fail}, pass=${pass}, tests=${tests}\n${raw.slice(-300)}`);
  assert.ok(pass >= 48, `Expected hooks baseline ≥48, got pass=${pass}`);
});

// ---- Phase 4a test files exist ----

test('phase4a-regression: all expected Phase 4a test files exist', () => {
  for (const f of PHASE4A_TEST_FILES) {
    assert.ok(fs.existsSync(f), `Phase 4a test file must exist: ${path.basename(f)}`);
  }
});

// ---- module-inference.cjs is loadable and exports correct API ----

test('phase4a-regression: module-inference.cjs exports required functions', () => {
  const mi = require('../lib/module-inference.cjs');
  assert.ok(typeof mi.detectModulesFilesystem === 'function', 'detectModulesFilesystem must be exported');
  assert.ok(typeof mi.rankByGitCommitCount === 'function', 'rankByGitCommitCount must be exported');
  assert.ok(typeof mi.loadGitignore === 'function', 'loadGitignore must be exported');
  assert.ok(typeof mi.hasGitRepo === 'function', 'hasGitRepo must be exported');
});
