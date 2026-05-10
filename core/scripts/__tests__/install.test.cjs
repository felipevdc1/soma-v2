'use strict';
/**
 * install.test.cjs — T-01 foundation stub tests for install.cjs
 *
 * Article II HARD: RED phase — these tests are written FIRST and must FAIL
 * before install.cjs exists (or before its module.exports are present).
 * Article III HARD: real fs / real child_process, no mocks.
 *
 * Scope: stub harness only (no orchestration logic — T-07..T-17 add those).
 *   T-01-S1: missing path arg → exit 1 (USAGE error)
 *   T-01-S2: valid path + flags → exit 0 (stub, no actual work)
 *   T-01-S3: --merge-claude-md + --replace-claude-md (mutual exclusion) → exit 1
 *   T-01-S4: path with space + leading hyphen → exit 0 (argv parser handles it)
 *   T-01-S5: dispatcher routes `soma install` to install.cjs (soma.cjs integration)
 *
 * @spec [SPEC:AC-06] [CONTRACT:01]
 * @task T-01
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// ── Paths ─────────────────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const INSTALL_CJS = path.join(SCRIPTS_DIR, 'install.cjs');
const SOMA_CJS = path.join(SCRIPTS_DIR, 'soma.cjs');

/**
 * Run install.cjs directly with given args.
 * @param {string[]} args
 * @returns spawnSync result with encoding utf8
 */
function runInstall(args = []) {
  return spawnSync('node', [INSTALL_CJS, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

/**
 * Run soma.cjs dispatcher with given args (integration test).
 * @param {string[]} args
 * @returns spawnSync result
 */
function runSoma(args = []) {
  return spawnSync('node', [SOMA_CJS, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

// ── T-01-S1: missing path arg → exit 1 ───────────────────────────────────────

test('T-01-S1: install without args exits 1 (USAGE error)', () => {
  const r = runInstall([]);
  assert.equal(r.status, 1,
    `Expected exit 1 (USAGE error, missing project-path). Got ${r.status}. stderr: ${r.stderr}`);
  // Must emit usage hint to stderr
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.length > 0,
    `Expected some output (usage hint) on exit 1. Got nothing.`
  );
});

// ── T-01-S2: valid path + flags → exit 0 (stub) ──────────────────────────────

test('T-01-S2: install with valid path exits 0 (stub, no actual work)', () => {
  // Use a pre-existing path (os.tmpdir() always exists)
  const r = runInstall([os.tmpdir()]);
  assert.equal(r.status, 0,
    `Expected exit 0 for valid project-path stub. Got ${r.status}. stderr: ${r.stderr}`);
});

test('T-01-S2b: install with path + all flags exits 0 (stub)', () => {
  const r = runInstall([
    os.tmpdir(),
    '--tool=claude',
    '--dry-run',
    '--force-resync',
    '--allow-local-edits',
  ]);
  assert.equal(r.status, 0,
    `Expected exit 0 for valid path + flags stub. Got ${r.status}. stderr: ${r.stderr}`);
});

// ── T-01-S3: mutual exclusion --merge-claude-md + --replace-claude-md ────────

test('T-01-S3: --merge-claude-md + --replace-claude-md together → exit 1', () => {
  const r = runInstall([
    os.tmpdir(),
    '--merge-claude-md',
    '--replace-claude-md',
  ]);
  assert.equal(r.status, 1,
    `Expected exit 1 (mutual exclusion --merge-claude-md + --replace-claude-md). Got ${r.status}. stderr: ${r.stderr}`);
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.length > 0,
    `Expected error message for mutual exclusion. Got nothing.`
  );
});

// ── T-01-S4: path with space + leading hyphen ─────────────────────────────────
// @spec AC-06

test('T-01-S4: path with space and leading hyphen is accepted (exit 0 stub)', () => {
  // Create a temp dir with space + hyphen in name
  const baseDir = os.tmpdir();
  const hyphenDir = path.join(baseDir, '- soma test fresh hyphen');
  fs.mkdirSync(hyphenDir, { recursive: true });
  try {
    const r = runInstall([hyphenDir]);
    assert.equal(r.status, 0,
      `Expected exit 0 for path with space+hyphen "${hyphenDir}". Got ${r.status}. stderr: ${r.stderr}`);
  } finally {
    try { fs.rmSync(hyphenDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── T-01-S5: dispatcher integration — soma install routes to install.cjs ──────

test('T-01-S5: soma install (no path) exits 1 and does NOT emit UNKNOWN_SUBCOMMAND', () => {
  const r = runSoma(['install']);
  // install.cjs exits 1 on missing path → soma.cjs passes through exit code
  assert.equal(r.status, 1,
    `Expected exit 1 (install.cjs USAGE passthrough from dispatcher). Got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  // Must NOT be soma.cjs UNKNOWN_SUBCOMMAND — 'install' must be a registered subcommand
  const combined = r.stdout + r.stderr;
  assert.ok(
    !combined.includes('UNKNOWN_SUBCOMMAND'),
    `Dispatcher must NOT emit UNKNOWN_SUBCOMMAND for 'install'. Got: ${combined}`
  );
});

// ── T-07 tests: path validation + resolution + codex sanity ──────────────────
// @spec [SPEC:AC-06] [CONTRACT:01]
// @task T-07

/**
 * T-07-S1: AC-06 integration — path with leading hyphen + spaces really exists.
 * Verifies that install.cjs:
 *   1. parseArgs returns the path string unchanged (raw storage in parseArgs).
 *   2. Running via subprocess exits 0 (valid path, valid flags).
 * The path `/tmp/- soma test fresh hyphen` matches the real hydra pattern.
 */
test('T-07-S1: AC-06 path with leading hyphen and spaces (real existing dir) → exit 0 + parseArgs stores it', (t) => {
  const installModule = require(INSTALL_CJS);
  const hyphenPath = '/tmp/- soma test fresh hyphen';
  fs.mkdirSync(hyphenPath, { recursive: true });
  try {
    // parseArgs must store the raw path string (resolution happens in main())
    const parsed = installModule.parseArgs([hyphenPath, '--tool=claude']);
    assert.equal(parsed.projectPath, hyphenPath,
      `parseArgs must return projectPath === "${hyphenPath}". Got: ${parsed.projectPath}`);
    assert.equal(parsed.errors.length, 0,
      `parseArgs must have zero errors for valid input. Got: ${JSON.stringify(parsed.errors)}`);

    // Subprocess must exit 0 (path exists, valid invocation)
    const r = runInstall([hyphenPath, '--tool=claude']);
    assert.equal(r.status, 0,
      `Expected exit 0 for existing hyphen-space path "${hyphenPath}". Got ${r.status}. stderr: ${r.stderr}`);
  } finally {
    try { fs.rmSync(hyphenPath, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-07-S2: nonexistent project-path → exit 1 with sensible hint.
 * install.cjs must validate that projectPath directory actually exists before
 * proceeding. CONTRACT-01: "project-path … Must exist."
 */
test('T-07-S2: nonexistent path → exit 1 with "must exist" or similar in stderr', () => {
  const nonexistent = `/tmp/this-path-definitely-does-not-exist-${Date.now()}`;
  const r = runInstall([nonexistent]);
  assert.equal(r.status, 1,
    `Expected exit 1 for nonexistent path "${nonexistent}". Got ${r.status}. stderr: ${r.stderr}`);
  // stderr must contain a sensible hint about the path not existing
  const hint = r.stderr.toLowerCase();
  assert.ok(
    hint.includes('exist') || hint.includes('not found') || hint.includes('no such') || hint.includes('invalid'),
    `stderr must contain existence hint. Got: ${r.stderr}`
  );
});

/**
 * T-07-S3: --tool=codex without ~/.codex/ → exit 2 with hint.
 * CONTRACT-01: "Codex requires ~/.codex/ to exist; aborts with hint if missing."
 * Skip if ~/.codex actually exists on this host (don't force failure on a codex machine).
 */
test('T-07-S3: --tool=codex without ~/.codex/ → exit 2 with hint', (t) => {
  const codexDir = path.join(os.homedir(), '.codex');
  if (fs.existsSync(codexDir)) {
    t.skip('~/.codex exists on this host — codex sanity check would pass, not applicable');
    return;
  }
  const r = runInstall([os.tmpdir(), '--tool=codex']);
  assert.equal(r.status, 2,
    `Expected exit 2 for --tool=codex with no ~/.codex/. Got ${r.status}. stderr: ${r.stderr}`);
  // stderr must reference codex or the missing directory
  const combined = (r.stdout + r.stderr);
  assert.ok(
    combined.includes('~/.codex') || combined.toLowerCase().includes('codex'),
    `stderr must contain ~/.codex or "Codex" hint. Got: ${combined}`
  );
});

/**
 * T-07-S4: path.resolve normalization — install.cjs exposes resolveProjectPath helper
 * that converts any raw path (relative or absolute) to absolute.
 * This tests the exported helper surface directly (unit-level testability).
 */
test('T-07-S4: resolveProjectPath helper returns absolute path', () => {
  const installModule = require(INSTALL_CJS);
  // resolveProjectPath must be exported
  assert.ok(
    typeof installModule.resolveProjectPath === 'function',
    `install.cjs must export resolveProjectPath function. Got: ${typeof installModule.resolveProjectPath}`
  );
  // Absolute path round-trips unchanged (modulo symlink resolution differences — just check it IS absolute)
  const absResult = installModule.resolveProjectPath('/tmp/some-path');
  assert.ok(
    path.isAbsolute(absResult),
    `resolveProjectPath('/tmp/some-path') must return absolute path. Got: ${absResult}`
  );
  // Relative path gets resolved to absolute
  const relResult = installModule.resolveProjectPath('relative/path');
  assert.ok(
    path.isAbsolute(relResult),
    `resolveProjectPath('relative/path') must return absolute path. Got: ${relResult}`
  );
});
