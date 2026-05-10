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

// ── T-09 tests: install-state.json writer + install.lock lifecycle ─────────────
// @spec [SPEC:AC-16] [CONTRACT:02] [CONTRACT:05]
// @task T-09
// Article II HARD: RED phase — these 4 tests are written BEFORE implementation.
// They MUST FAIL until T-09 GREEN phase implements acquireLock/releaseLock/writeInstallState.

/**
 * T-09-S1: AC-16 install writes valid install-state.json with required fields.
 * Runs install on a fresh directory, asserts state file is created with correct schema.
 */
test('T-09-S1: AC-16 install writes valid install-state.json with required fields', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t09-state-'));
  try {
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Must exit 0 (pipeline success)
    assert.equal(r.status, 0,
      `T-09-S1: install must exit 0 for valid greenfield. Got ${r.status}. stderr: ${r.stderr}`);

    const stateFile = path.join(freshDir, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFile),
      `T-09-S1: [RED — T-09] install-state.json must be created at ${stateFile}`
    );

    const raw = fs.readFileSync(stateFile, 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); },
      `T-09-S1: [RED — T-09] install-state.json must be valid JSON`);

    // Required fields per CONTRACT-02 schema
    const required = ['status', 'timestamp', 'snapshotId', 'harness', 'installedVersion'];
    for (const field of required) {
      assert.ok(field in parsed && parsed[field] !== null && parsed[field] !== undefined,
        `T-09-S1: [RED — T-09] Required field "${field}" missing or null in install-state.json`);
    }

    // Status must be a valid enum value
    const validStatuses = ['complete', 'partial-failed', 'drift-detected'];
    assert.ok(validStatuses.includes(parsed.status),
      `T-09-S1: [RED — T-09] status must be one of ${validStatuses.join('|')}. Got: "${parsed.status}"`);

    // harness must be a valid enum value
    const validHarnesses = ['claude', 'codex', 'both'];
    assert.ok(validHarnesses.includes(parsed.harness),
      `T-09-S1: [RED — T-09] harness must be one of ${validHarnesses.join('|')}. Got: "${parsed.harness}"`);

    // timestamp must be ISO-8601 with Z suffix
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    assert.ok(typeof parsed.timestamp === 'string' && ISO_RE.test(parsed.timestamp),
      `T-09-S1: [RED — T-09] timestamp must be ISO-8601 UTC (Z suffix). Got: "${parsed.timestamp}"`);

    // installedVersion must match semver pattern
    const SEMVER_RE = /^\d+\.\d+\.\d+/;
    assert.ok(typeof parsed.installedVersion === 'string' && SEMVER_RE.test(parsed.installedVersion),
      `T-09-S1: [RED — T-09] installedVersion must match semver N.N.N. Got: "${parsed.installedVersion}"`);
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-09-S2: install.lock acquired during pipeline, released after success.
 * After install completes (exit 0), the lock file must NOT remain.
 */
test('T-09-S2: install.lock acquired during pipeline, released after success (finally block)', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t09-lock-'));
  try {
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Exit 0: pipeline success
    assert.equal(r.status, 0,
      `T-09-S2: install must exit 0 for greenfield. Got ${r.status}. stderr: ${r.stderr}`);

    const lockFile = path.join(freshDir, '.soma', 'install.lock');
    assert.ok(
      !fs.existsSync(lockFile),
      `T-09-S2: [RED — T-09] install.lock must NOT exist after successful install (must be released in finally). ` +
      `Found: ${lockFile}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-09-S3: stale lockfile (>60min) auto-cleans with WARNING + install proceeds normally.
 * Pre-creates a lock with timestamp 90 minutes ago.
 */
test('T-09-S3: stale lockfile (>60min) auto-cleans with WARNING + install proceeds (exit 0)', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t09-stale-'));
  try {
    // Pre-create .soma/install.lock with 90-min-old timestamp
    const somaDir = path.join(freshDir, '.soma');
    fs.mkdirSync(somaDir, { recursive: true });
    const staleLock = {
      pid: 12345,
      timestamp: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      hostname: os.hostname(),
    };
    fs.writeFileSync(
      path.join(somaDir, 'install.lock'),
      JSON.stringify(staleLock),
      { mode: 0o644 }
    );

    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Must NOT exit 2 (stale lock should be auto-cleaned, not block)
    assert.notEqual(r.status, 2,
      `T-09-S3: [RED — T-09] Stale lock must be auto-cleaned (NOT contention exit 2). Got exit ${r.status}. stderr: ${r.stderr}`);

    // Must exit 0 (install proceeds after stale cleanup)
    assert.equal(r.status, 0,
      `T-09-S3: [RED — T-09] Stale lock auto-clean: install must proceed and exit 0. Got ${r.status}. stderr: ${r.stderr}`);

    // Must emit WARNING or stale message to stderr
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.toLowerCase().includes('stale') || combined.toLowerCase().includes('warn'),
      `T-09-S3: [RED — T-09] Output must contain "stale" or "warn" message for stale lock auto-clean. Got: ${combined}`
    );

    // install-state.json should be written normally (install succeeded)
    const stateFile = path.join(freshDir, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFile),
      `T-09-S3: [RED — T-09] install-state.json must be written after stale-lock auto-clean + successful install. Not found at ${stateFile}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-09-S4: fresh lockfile (<60min) blocks with exit 2.
 * Pre-creates a lock with timestamp = now (0 seconds old).
 */
test('T-09-S4: fresh lockfile (<60min) blocks install with exit 2', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t09-contend-'));
  try {
    // Pre-create .soma/install.lock with current timestamp (fresh, < 60min)
    const somaDir = path.join(freshDir, '.soma');
    fs.mkdirSync(somaDir, { recursive: true });
    const freshLock = {
      pid: 99999,
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
    };
    fs.writeFileSync(
      path.join(somaDir, 'install.lock'),
      JSON.stringify(freshLock),
      { mode: 0o644 }
    );

    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 10000,
    });

    // Must exit 2 (lockfile contention blocks)
    assert.equal(r.status, 2,
      `T-09-S4: [RED — T-09] Fresh lock contention must exit 2. Got ${r.status}. stderr: ${r.stderr}`);

    // stderr must mention PID or "install.lock" or "in progress"
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.includes('PID') || combined.includes('install.lock') || combined.toLowerCase().includes('in progress'),
      `T-09-S4: [RED — T-09] stderr must mention PID, install.lock, or "in progress". Got: ${combined}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── T-08 tests: greenfield install pipeline orchestration ─────────────────────
// @spec [SPEC:AC-01] [CONTRACT:01]
// @task T-08
// Article II HARD: RED phase — these 3 tests are written BEFORE orchestration
// implementation and MUST FAIL until T-08 GREEN phase wires orchestrate() into main().

/**
 * T-08-S1: AC-01 greenfield install creates .soma/ + .soma/manifest.json + CLAUDE.md block.
 * Verifies the full 3-step pipeline:
 *   1. init.cjs → .soma/ created (including .soma/manifest.json)
 *   2. manifest.cjs baseline --apply → SOMA source manifest baselined
 *   3. sync.cjs --apply --tool=claude → CLAUDE.md anchored block injected
 *
 * Note on CLAUDE.md target: sync.cjs injects into ~/.claude/CLAUDE.md (global SOMA bootloader),
 * not the project's CLAUDE.md. Project-level CLAUDE.md handling is in T-14/T-16.
 * AC-01 "CLAUDE.md" refers to ~/.claude/CLAUDE.md (the global harness config).
 */
test('T-08-S1: AC-01 greenfield install creates .soma/ + .soma/manifest.json', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-test-fresh-'));
  try {
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Exit 0: pipeline must succeed
    assert.equal(r.status, 0,
      `Greenfield install must exit 0. Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // .soma/ directory created (init.cjs step)
    assert.ok(
      fs.existsSync(path.join(freshDir, '.soma')),
      `.soma/ directory must be created by init.cjs step. Not found at ${path.join(freshDir, '.soma')}`
    );

    // .soma/manifest.json created (init.cjs creates project manifest)
    assert.ok(
      fs.existsSync(path.join(freshDir, '.soma', 'manifest.json')),
      `.soma/manifest.json must be created by init.cjs. Not found at ${path.join(freshDir, '.soma', 'manifest.json')}`
    );

    // stdout success format from CONTRACT-01 (install pipeline ran)
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.toLowerCase().includes('soma') || combined.toLowerCase().includes('install') || combined.toLowerCase().includes('.soma'),
      `stdout must contain install completion indication. Got: ${combined.slice(0, 300)}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-08-S2: --dry-run on greenfield → exit 0 + does NOT create .soma/.
 * Pipeline must preview operations without mutating target when --dry-run passed.
 */
test('T-08-S2: --dry-run on greenfield → exit 0 + does NOT create .soma/', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-test-dry-'));
  try {
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude', '--dry-run'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Exit 0: dry-run must succeed
    assert.equal(r.status, 0,
      `Dry-run install must exit 0. Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // .soma/ must NOT be created (no mutations applied in dry-run)
    assert.ok(
      !fs.existsSync(path.join(freshDir, '.soma')),
      `.soma/ must NOT be created in dry-run mode. Found at ${path.join(freshDir, '.soma')}`
    );

    // stdout must indicate dry-run preview
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.toLowerCase().includes('dry-run') || combined.toLowerCase().includes('would create'),
      `Dry-run output must mention "dry-run" or "Would create". Got: ${combined.slice(0, 300)}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-08-S3: init.cjs "already initialized" (exit 1 redirect) → install resumes pipeline.
 *
 * init.cjs exits 1 for "already initialized" (REDIRECT), not for hard errors (exit 2).
 * T-08's pipeline treats init exit 1 as "resume from next step" (pipeline continues),
 * since T-12 owns full recovery logic for the re-run detection + state-matching case.
 *
 * This behavior also preserves backward compat with CC-02 tests that use os.tmpdir()
 * (which may have .soma/ from prior test runs).
 *
 * Exit 2 is reserved for hard init failures (init exit 2 = TEMPLATE_MISSING, IO_ERROR, etc.)
 * which are untestable in normal conditions (require file permission manipulation).
 *
 * So T-08-S3 verifies: pre-existing .soma/ + init redirect → install continues → exit 0.
 */
test('T-08-S3: pre-existing .soma/ causes init redirect → install resumes pipeline (exit 0)', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-test-init-resume-'));
  try {
    // Pre-create .soma/ to trigger init.cjs "already initialized" (exit 1 redirect)
    fs.mkdirSync(path.join(freshDir, '.soma'), { recursive: true });

    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // T-08: init exit 1 (redirect) → skip init, continue with manifest+sync → exit 0.
    // T-12 will later add proper state-matching detection for true idempotent re-run.
    assert.equal(r.status, 0,
      `init redirect (exit 1) must not abort install — pipeline resumes. Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});
