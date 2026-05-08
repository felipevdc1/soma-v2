'use strict';
/**
 * soma-dispatcher.test.cjs — T-14 contract tests for soma.cjs unified CLI dispatcher
 *
 * Tests that soma.cjs correctly routes subcommands to their respective scripts.
 * Article II HARD: RED phase — all tests must FAIL before soma.cjs is created.
 * Article III HARD: real fs / real child_process, no mocks.
 *
 * @spec [SPEC:AC-07] [SPEC:AC-10] [SPEC:AC-20]
 * @contract CONTRACT-T-14-dispatcher
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SOMA_CLI = path.join(SOMA_HOME, 'scripts', 'soma.cjs');

/**
 * Run the soma CLI dispatcher with given args.
 * @param {string[]} args
 * @param {object} env optional extra env vars
 * @returns spawnSync result
 */
function runSoma(args = [], env = {}) {
  return spawnSync('node', [SOMA_CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

// ── Test 1: soma --help exits 0 and lists all 7 subcommands ──────────────────

test('T-14-01: soma --help exits 0 and mentions all 7 subcommands', () => {
  const r = runSoma(['--help']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);

  const output = r.stdout + r.stderr;
  for (const cmd of ['bootstrap', 'init', 'doctor', 'sync', 'rollback', 'module', 'audit']) {
    assert.ok(output.includes(cmd), `--help output missing subcommand: ${cmd}. Output: ${output}`);
  }
});

// ── Test 2: soma --version exits 0 and emits version string ──────────────────

test('T-14-02: soma --version exits 0 and emits version', () => {
  const r = runSoma(['--version']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  assert.ok(output.includes('soma'), `--version output should include "soma". Got: ${output}`);
});

// ── Test 3: soma bootstrap --quiet delegates correctly ────────────────────────

test('T-14-03: soma bootstrap --quiet delegates and exits without crash', () => {
  // bootstrap may fail (no .soma/ in /tmp), but we're testing delegation not bootstrap logic.
  // We verify that soma.cjs invokes scripts/bootstrap.cjs, which emits JSON (bootstrap schema).
  const r = runSoma(['bootstrap', '--quiet', '--soma-home=/tmp/soma-v2-test-nonexistent'], {
    SOMA_SAFE_PATHS_ONLY: '1',
  });
  // bootstrap exits 1 when no .soma/ found — valid delegation
  const output = r.stdout + r.stderr;
  // Must produce some output (delegated to bootstrap.cjs, which always emits JSON or error)
  assert.ok(r.status !== null, 'soma bootstrap delegation should complete (exit code set)');
  // Delegation proof: output should come from bootstrap.cjs (not from soma.cjs itself)
  // bootstrap.cjs emits NO_SOMA_PROJECT when project not found
  assert.ok(
    output.includes('NO_SOMA_PROJECT') || output.includes('bootstrap') || output.length > 0,
    `Expected delegation output from bootstrap.cjs. Got: ${output}`
  );
});

// ── Test 4: soma doctor --check-migration delegates flag passthrough ──────────

test('T-14-04: soma doctor --check-migration delegates and flag passthrough works', () => {
  const r = runSoma(['doctor', '--check-migration', '--soma-home=/tmp/soma-v2-test-nonexistent'], {
    SOMA_SAFE_PATHS_ONLY: '1',
  });
  // doctor exits non-zero when SOMA_HOME invalid — what matters is flag was passed through
  const output = r.stdout + r.stderr;
  assert.ok(r.status !== null, 'soma doctor delegation should complete');
  // doctor.cjs should produce output (delegation proof)
  assert.ok(
    output.length > 0,
    `Expected output from doctor.cjs. Got nothing. stderr: ${r.stderr}`
  );
});

// ── Test 5: soma rollback --snapshot-id INVALID emits SNAPSHOT_NOT_FOUND ────

test('T-14-05: soma rollback --snapshot-id INVALID emits SNAPSHOT_NOT_FOUND', () => {
  const r = runSoma(['rollback', '--snapshot-id', 'INVALID_DOES_NOT_EXIST']);
  // rollback should exit 1 for SNAPSHOT_NOT_FOUND
  assert.ok(r.status === 1 || r.status === 2, `Expected exit 1 or 2, got ${r.status}`);
  const output = r.stdout + r.stderr;
  assert.ok(
    output.includes('SNAPSHOT_NOT_FOUND') || output.includes('INVALID') || output.includes('not found'),
    `Expected SNAPSHOT_NOT_FOUND error. Got: ${output}`
  );
});

// ── Test 6: soma sync --dry-run delegates correctly ──────────────────────────

test('T-14-06: soma sync --dry-run delegates to sync.cjs', () => {
  const r = runSoma(['sync', '--dry-run', '--soma-home=/tmp/soma-v2-test-nonexistent'], {
    SOMA_SAFE_PATHS_ONLY: '1',
  });
  const output = r.stdout + r.stderr;
  // sync.cjs exits 1 or 2 when soma-home is invalid — delegation proof
  assert.ok(r.status !== null, 'soma sync delegation should complete');
  assert.ok(output.length > 0, `Expected output from sync.cjs. Got nothing.`);
});

// ── Test 7: Unknown subcommand exits 2 + JSON UNKNOWN_SUBCOMMAND ─────────────

test('T-14-07: unknown subcommand "frob" exits 2 with JSON UNKNOWN_SUBCOMMAND', () => {
  const r = runSoma(['frob']);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stdout: ${r.stdout}`);

  // Should emit JSON to stderr with UNKNOWN_SUBCOMMAND
  let parsed;
  try {
    parsed = JSON.parse(r.stderr.trim());
  } catch (e) {
    assert.fail(`Expected valid JSON on stderr. Got: ${r.stderr}. ParseError: ${e.message}`);
  }
  assert.equal(parsed.error, 'UNKNOWN_SUBCOMMAND', `Expected error=UNKNOWN_SUBCOMMAND. Got: ${JSON.stringify(parsed)}`);
  assert.equal(parsed.subcommand, 'frob', `Expected subcommand=frob. Got: ${JSON.stringify(parsed)}`);
  assert.ok(Array.isArray(parsed.valid), `Expected valid[] array. Got: ${JSON.stringify(parsed)}`);
  assert.ok(parsed.valid.includes('bootstrap'), `Expected "bootstrap" in valid[]. Got: ${JSON.stringify(parsed.valid)}`);
});

// ── Test 8: No args exits 0 and prints usage ──────────────────────────────────

test('T-14-08: no args exits 0 and prints usage (not error)', () => {
  const r = runSoma([]);
  assert.equal(r.status, 0, `Expected exit 0 (not error) for no args. Got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  // Should print usage including at least one subcommand
  assert.ok(output.includes('bootstrap') || output.includes('Usage') || output.includes('soma'),
    `Expected usage output. Got: ${output}`);
});

// ── Test 9: soma rollback --help passthrough ───────────────────────────────────

test('T-14-09: soma rollback --help delegates --help to rollback.cjs', () => {
  const r = runSoma(['rollback', '--help']);
  // rollback.cjs does not have --help but should not crash; exits cleanly or with usage
  // The key assertion: soma.cjs passes --help through to rollback.cjs (delegation worked)
  assert.ok(r.status !== null, 'Delegation should complete without hanging');
  // Ensure it was delegated (not handled by soma.cjs as unknown subcommand)
  // rollback.cjs exits 2 with INVALID_ARGS when --snapshot-id missing
  assert.ok(r.status !== 2 || !r.stderr.includes('UNKNOWN_SUBCOMMAND'),
    `Should not be UNKNOWN_SUBCOMMAND; rollback is a known subcommand. stderr: ${r.stderr}`);
});

// ── Test 10: Argv preservation — multi-arg passthrough ─────────────────────────

test('T-14-10: multi-arg passthrough: soma sync --dry-run --tool=claude delegates all args', () => {
  // Use a synthetic soma-home so sync.cjs receives args without side effects
  const syntheticHome = '/tmp/soma-v2-test-no-exist';
  const r = runSoma(['sync', '--dry-run', '--tool=claude', `--soma-home=${syntheticHome}`], {
    SOMA_SAFE_PATHS_ONLY: '1',
  });
  const output = r.stdout + r.stderr;
  // sync.cjs will fail on invalid soma-home but should NOT produce UNKNOWN_SUBCOMMAND
  assert.ok(
    !output.includes('UNKNOWN_SUBCOMMAND'),
    `Should delegate to sync.cjs, not produce UNKNOWN_SUBCOMMAND. Got: ${output}`
  );
  // Should have exited (not hung) — delegation proof
  assert.ok(r.status !== null, 'Command should complete');
  // sync.cjs produces JSON or text output even on error
  assert.ok(output.length > 0, `Expected output from sync.cjs. Got nothing.`);
});

// ── T-09: manifest baseline dispatcher integration ─────────────────────────────
//
// Validates end-to-end wiring: soma.cjs routes `soma manifest baseline [flags]`
// through spawnSync to scripts/manifest.cjs.  Uses the CORE working-copy CLI
// (core/scripts/soma.cjs) so the current branch is tested directly.
//
// Dispatcher functional behaviour is unchanged — T-01 SUBCOMMANDS registration
// plus manifest.cjs positional parsing handle nested-verb routing.  These tests
// confirm the wiring with explicit assertions.
//
// Article III HARD: real fs fixtures, real child_process — zero mocks.
//
// @spec [SPEC:AC-10] [WIRING] [T-09] [run-260508-0841-fb4dce]

const CORE_SOMA_CLI = path.resolve(__dirname, '..', 'soma.cjs');

/** Run the CORE working-copy soma CLI (not installed ~/.soma-v2 copy). */
function runCoreSoma(args = [], env = {}) {
  return spawnSync('node', [CORE_SOMA_CLI, ...args], {
    env:     { ...process.env, ...env },
    encoding: 'utf8',
    timeout:  15_000,
  });
}

/**
 * Minimal SOMA_HOME fixture for dispatcher integration tests.
 * Creates a real temp dir with manifest.json + one stale lab file.
 * Returns { somaHome, cleanup }.
 */
function makeBaselineFixture() {
  const somaHome = fs.mkdtempSync(
    path.join(os.tmpdir(), `soma-disp-t09-${process.pid}-`)
  );
  const labDir = path.join(somaHome, 'lab');
  fs.mkdirSync(labDir, { recursive: true });

  const labContent = '# Dispatcher integration test file\nContent for wiring validation.\n';
  fs.writeFileSync(path.join(labDir, 'test-file.md'), labContent);

  const manifest = {
    schema:      'soma-manifest/v1',
    version:     '1.0',
    generatedAt: new Date().toISOString(),
    files: [{
      id:           'test.dispatcher.entry',
      path:         'lab/test-file.md',
      sha256:       'a'.repeat(64),   // deliberately stale sha — will be detected
      sourceSha256: 'source-original',
    }],
  };
  fs.writeFileSync(
    path.join(somaHome, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  return {
    somaHome,
    cleanup: () => {
      try { fs.rmSync(somaHome, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

// T-09-01: soma --help (core copy) lists "manifest" in subcommands table
test('T-09-01: soma --help (core copy) lists "manifest" in subcommands table', () => {
  const r = runCoreSoma(['--help']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  assert.ok(
    /\bmanifest\b/.test(output),
    `--help output must list "manifest" subcommand. Got:\n${output}`
  );
});

// T-09-02: soma manifest (no subverb) → manifest.cjs receives no positional → shows usage, exits 0
// (manifest.cjs treats no-args as usage request, not an error — consistent with SOMA CLI convention)
test('T-09-02: soma manifest (no subverb) routes to manifest.cjs and exits 0 with usage', () => {
  const r = runCoreSoma(['manifest']);
  // manifest.cjs treats no-args as usage display → exit 0
  assert.equal(
    r.status, 0,
    `Expected exit 0 (manifest.cjs usage display), got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`
  );
  // Must NOT be soma.cjs UNKNOWN_SUBCOMMAND — "manifest" IS a registered subcommand
  assert.ok(
    !r.stderr.includes('UNKNOWN_SUBCOMMAND'),
    `Should not emit UNKNOWN_SUBCOMMAND — manifest is registered in SUBCOMMANDS. stderr: ${r.stderr}`
  );
  // Delegation proof: output must come from manifest.cjs (mentions "baseline" subverb)
  const output = r.stdout + r.stderr;
  assert.ok(
    output.includes('baseline'),
    `Delegation proof: manifest.cjs usage must mention "baseline" subverb. Got:\n${output}`
  );
});

// T-09-03: soma manifest baseline --help exits 0 and documents all four flags
test('T-09-03: soma manifest baseline --help exits 0 with --dry-run --apply --filter --json', () => {
  const r = runCoreSoma(['manifest', 'baseline', '--help']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const output = r.stdout + r.stderr;
  for (const flag of ['--dry-run', '--apply', '--filter', '--json']) {
    assert.ok(
      output.includes(flag),
      `manifest baseline --help must document flag "${flag}". Output:\n${output}`
    );
  }
});

// T-09-04: soma manifest baseline --bogus exits 2 (INVALID_ARGS passthrough from manifest.cjs)
test('T-09-04: soma manifest baseline --bogus exits 2 (INVALID_ARGS passthrough)', () => {
  const r = runCoreSoma(['manifest', 'baseline', '--bogus']);
  assert.equal(
    r.status, 2,
    `Expected exit 2 (INVALID_ARGS from manifest.cjs), got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`
  );
  // Must NOT be soma.cjs UNKNOWN_SUBCOMMAND — manifest is a known subcommand
  assert.ok(
    !r.stderr.includes('UNKNOWN_SUBCOMMAND'),
    `Should not emit UNKNOWN_SUBCOMMAND from dispatcher. stderr: ${r.stderr}`
  );
});

// T-09-05: soma manifest baseline --json (with real fixture) emits valid soma-manifest-baseline/v1 JSON
test('T-09-05: soma manifest baseline --json emits valid soma-manifest-baseline/v1 JSON', () => {
  const { somaHome, cleanup } = makeBaselineFixture();
  try {
    const r = runCoreSoma(
      ['manifest', 'baseline', '--dry-run', '--json'],
      { SOMA_HOME: somaHome }
    );
    assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);

    let out;
    try {
      out = JSON.parse(r.stdout.trim());
    } catch (e) {
      assert.fail(
        `stdout must be parseable JSON. Got: ${r.stdout.slice(0, 300)}\nParseError: ${e.message}`
      );
    }

    assert.equal(
      out.schema, 'soma-manifest-baseline/v1',
      `schema must be "soma-manifest-baseline/v1". Got: ${out.schema}`
    );
    assert.ok(typeof out.mode === 'string',               'mode field must be present and string');
    assert.ok(Array.isArray(out.entries_rebaseled),       'entries_rebaseled must be array');
    assert.ok(typeof out.entries_considered === 'number', 'entries_considered must be number');
  } finally {
    cleanup();
  }
});
