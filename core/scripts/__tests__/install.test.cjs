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
