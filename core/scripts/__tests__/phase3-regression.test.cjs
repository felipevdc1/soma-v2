'use strict';
// @spec AC-02 AC-04 AC-06
// Phase 3 regression test — validates that:
// (a) canonical sources and lab files are untouched after Phase 3 operations
// (b) hooks 48/48 still pass
// (c) full init pipeline (greenfield, --with-agents-md, --dry-run, redirect) works
// (d) cleanup /tmp fixtures

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

// Resolve node binary explicitly — bun sets process.execPath to itself, which
// breaks the wrapper + inner runner pattern (bun --test has recursive detection).
const NODE_BIN = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim() || 'node';

// ---- Canonical sources to protect ----
const CANONICAL_SOURCES = [
  path.join(os.homedir(), '.codex', 'AGENTS.md'),
  path.join(os.homedir(), 'AGENTS.md'),
  path.join(os.homedir(), '.claude', 'constitution.md'),
  path.join(SOMA_HOME, 'manifest.json'),
  path.join(SOMA_HOME, 'adapters', 'codex', 'install-targets.json')
];

function computeSha256(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (err) {
    return null;
  }
}

function mkRegressionFixture() {
  const slug = crypto.randomBytes(4).toString('hex');
  const dir = path.join(os.tmpdir(), `soma-init-regression-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runInit(args = []) {
  return spawnSync('node', [INIT, ...args], {
    encoding: 'utf8',
    timeout: 15000
  });
}

// ---- (a) Canonical sources untouched ----

test('regression: capture pre-state and verify canonical sources untouched after init pipeline', (t) => {
  // Capture pre-state shasums
  const preState = {};
  for (const src of CANONICAL_SOURCES) {
    preState[src] = computeSha256(src);
    assert.ok(preState[src] !== null, `Canonical source must be readable: ${src}`);
  }

  // Run full init pipeline in /tmp/ fixture
  const fixture = mkRegressionFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  // 1. Greenfield
  const r1 = runInit([fixture, '--with-agents-md', '--json']);
  assert.equal(r1.status, 0, `Greenfield init failed: ${r1.stderr}`);

  // 2. Redirect (re-run on same fixture)
  const r2 = runInit([fixture, '--json']);
  assert.equal(r2.status, 1, `Expected redirect exit 1, got ${r2.status}`);

  // 3. Dry-run on fresh fixture
  const fixture2 = mkRegressionFixture();
  t.after(() => fs.rmSync(fixture2, { recursive: true, force: true }));
  const r3 = runInit([fixture2, '--dry-run', '--with-agents-md', '--json']);
  assert.equal(r3.status, 0, `Dry-run failed: ${r3.stderr}`);

  // Verify canonical sources still match pre-state shasums
  for (const src of CANONICAL_SOURCES) {
    const postSha = computeSha256(src);
    assert.equal(
      preState[src],
      postSha,
      `Canonical source modified after init pipeline: ${src}`
    );
  }
});

// ---- (b) Lab frozen files untouched ----

test('regression: lab frozen files not modified by Phase 3', (t) => {
  const frozenFiles = [
    path.join(SOMA_HOME, 'manifest.json'),
    path.join(SOMA_HOME, 'adapters', 'codex', 'install-targets.json'),
    path.join(SOMA_HOME, 'adapters', 'claude', 'install-targets.json'),
    path.join(SOMA_HOME, 'scripts', 'doctor.cjs'),
    path.join(SOMA_HOME, 'scripts', 'sync.cjs'),
    path.join(SOMA_HOME, 'scripts', 'lib', 'anchored-blocks.cjs'),
    path.join(SOMA_HOME, 'scripts', 'lib', 'manifest.cjs')
  ];

  // Capture shasums
  const preShas = {};
  for (const f of frozenFiles) {
    preShas[f] = computeSha256(f);
    assert.ok(preShas[f] !== null, `Frozen file must be readable: ${f}`);
  }

  // Run an init pipeline
  const fixture = mkRegressionFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  runInit([fixture, '--with-agents-md', '--json']);
  runInit([fixture, '--json']); // redirect
  runInit([fixture, '--dry-run', '--json']); // dry-run

  // Verify shasums unchanged
  for (const f of frozenFiles) {
    const postSha = computeSha256(f);
    assert.equal(preShas[f], postSha, `Frozen lab file modified: ${f}`);
  }
});

// ---- Hooks runner helper (reuses Phase 2 wrapper approach to avoid recursive node:test) ----

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

// Spawns `node --test` directly, with NODE_TEST_CONTEXT stripped from the
// child's env to avoid Node v22+'s "recursive node:test" detection. No
// wrapper script is generated — see no-nested-test-spawn.test.cjs for why:
// a wrapper that itself spawns a "neto" process orphans that neto whenever
// the outer spawnSync's timeout kills the wrapper before the neto finishes.
function runHooksViaBridge() {
  spawnSync('bash', ['-c', 'rm -f /tmp/soma-state-trap* 2>/dev/null'], { encoding: 'utf8' });
  const hookTestFiles = getHooksTestFiles();
  if (hookTestFiles.length === 0) return { tests: 0, pass: 0, fail: 0, raw: '' };

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
  const telemetryLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-p3-hooks-telemetry-'));

  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  env.FORCE_COLOR = '0';
  env.ARTICLE_XI_LOG_DIR = telemetryLogDir;
  env.INSIGHT_COUPLING_LOG_DIR = telemetryLogDir;

  try {
    const result = spawnSync(NODE_BIN, ['--test', ...hookTestFiles], {
      encoding: 'utf8', timeout: 60000, env
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
  }
}

// ---- (c) Hooks 48/48 regression ----

test('regression: hooks pass with zero failures after Phase 3 implementation', () => {
  const { tests, pass, fail, raw } = runHooksViaBridge();
  assert.equal(fail, 0, `Hooks must have 0 failures. Got fail=${fail}, pass=${pass}, tests=${tests}\nOutput: ${raw.slice(-300)}`);
  assert.ok(pass >= 48, `Expected hooks baseline ≥48, got pass=${pass}, tests=${tests}`);
});

// ---- (d) Cleanup validation ----

test('regression: /tmp/soma-init-regression-* fixtures cleaned by t.after', (t) => {
  const fixture = mkRegressionFixture();
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    // Verify cleanup
    assert.ok(!fs.existsSync(fixture), `Fixture not cleaned: ${fixture}`);
  });

  // Create some files in fixture to ensure cleanup works
  runInit([fixture, '--with-agents-md']);

  assert.ok(fs.existsSync(path.join(fixture, '.soma')), 'Fixture .soma/ must exist before cleanup');
});

// ---- (e) New Phase 3 files don't interfere with Phase 2 tests ----

test('regression: Phase 3 lib files exist and are loadable', (t) => {
  const templateEngine = require('../lib/template-engine.cjs');
  const agentsMdInjector = require('../lib/agents-md-injector.cjs');

  assert.ok(typeof templateEngine.renderTemplate === 'function', 'renderTemplate must be exported');
  assert.ok(typeof templateEngine.nowISO8601 === 'function', 'nowISO8601 must be exported');
  assert.ok(typeof agentsMdInjector.injectBootloader === 'function', 'injectBootloader must be exported');
  assert.ok(typeof agentsMdInjector.hasAnchorBlock === 'function', 'hasAnchorBlock must be exported');
});

test('regression: init.cjs exists and is node-loadable (no syntax error)', (t) => {
  const initPath = path.join(SOMA_HOME, 'scripts', 'init.cjs');
  assert.ok(fs.existsSync(initPath), 'init.cjs must exist');

  // Verify no syntax error by parsing (not executing main)
  const result = spawnSync('node', ['--check', initPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `init.cjs has syntax error: ${result.stderr}`);
});
