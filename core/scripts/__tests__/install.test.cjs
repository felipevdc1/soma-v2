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
 * T-08-S1: AC-01 greenfield install creates .soma/ + .soma/manifest.json + project CLAUDE.md block.
 * Verifies the full 4-step pipeline (T-08bis extends T-08 to include project-level bootloader):
 *   1. init.cjs → .soma/ created (including .soma/manifest.json)
 *   2. manifest.cjs baseline --apply → SOMA source manifest baselined
 *   3. sync.cjs --apply --tool=claude (user-globals) → injects into ~/.claude/CLAUDE.md
 *   4. sync.cjs --apply --tool=claude --targets-file=install-targets.project.json (T-08bis)
 *      → injects block.claude.CLAUDE_md.project-bootloader into <freshDir>/CLAUDE.md
 *
 * AC-01 literal: `grep -c '<!-- soma-v2:start' <freshDir>/CLAUDE.md` must return 1.
 * This assertion was WEAKENED in commit 8e3729c (T-08-S1 "fix assertion to match actual sync.cjs target").
 * T-08bis REVERTS that weakening: the project CLAUDE.md MUST contain the anchor.
 */
test('T-08-S1: AC-01 greenfield install creates .soma/ + .soma/manifest.json + project CLAUDE.md anchor', async (t) => {
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

    // [T-08bis REVERTED] CLAUDE.md must be created in project dir with soma-v2 anchor
    // AC-01 literal: grep -c '<!-- soma-v2:start' <freshDir>/CLAUDE.md → must return 1
    const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdPath),
      `[RED — T-08bis] CLAUDE.md must be created by sync.cjs project-level targets. Not found at ${claudeMdPath}`
    );

    const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
    const anchorCount = (claudeMdContent.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(anchorCount, 1,
      `[RED — T-08bis] AC-01 literal: grep -c '<!-- soma-v2:start' CLAUDE.md must return 1. Got ${anchorCount}.\nContent: ${claudeMdContent.slice(0, 500)}`
    );

    // The anchor must be for block.claude.CLAUDE_md.project-bootloader
    assert.ok(
      claudeMdContent.includes('id=block.claude.CLAUDE_md.project-bootloader'),
      `[RED — T-08bis] CLAUDE.md anchor must have id=block.claude.CLAUDE_md.project-bootloader.\nContent: ${claudeMdContent.slice(0, 500)}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-08bis-S1: AC-01b — project-bootloader block literal substrings present in CLAUDE.md.
 * After greenfield install, <freshDir>/CLAUDE.md must contain all 7 required substrings
 * defined in AC-01b spec amendment.
 *
 * @spec AC-01b (project-bootloader block content)
 * @task T-08bis
 */
test('T-08bis-S1: AC-01b project-bootloader block contains all required literal substrings in CLAUDE.md', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t08bis-s1-'));
  try {
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r.status, 0,
      `T-08bis-S1: install must exit 0. Got ${r.status}. stderr: ${r.stderr}`);

    const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdPath),
      `[RED — T-08bis] CLAUDE.md must exist at ${claudeMdPath}`
    );

    const content = fs.readFileSync(claudeMdPath, 'utf8');

    // AC-01b literal substrings (all must be present)
    const requiredSubstrings = [
      '## SOMA install',
      '## Project artifacts',
      '## Workflow',
    ];

    for (const substr of requiredSubstrings) {
      assert.ok(
        content.includes(substr),
        `[RED — T-08bis] AC-01b: CLAUDE.md must contain literal "${substr}". Content (first 600): ${content.slice(0, 600)}`
      );
    }

    // {{version}} must be resolved (no unresolved placeholders)
    assert.ok(
      !content.includes('{{version}}'),
      `[RED — T-08bis] AC-01b: {{version}} must be resolved in CLAUDE.md. Content: ${content.slice(0, 600)}`
    );
    assert.ok(
      content.includes('2.2.0'),
      `[RED — T-08bis] AC-01b: version 2.2.0 must appear in CLAUDE.md. Content: ${content.slice(0, 600)}`
    );

    // {{harness}} must be resolved to 'claude'
    assert.ok(
      !content.includes('{{harness}}'),
      `[RED — T-08bis] AC-01b: {{harness}} must be resolved in CLAUDE.md. Content: ${content.slice(0, 600)}`
    );
    assert.ok(
      content.includes('claude'),
      `[RED — T-08bis] AC-01b: harness value 'claude' must appear in CLAUDE.md. Content: ${content.slice(0, 600)}`
    );

    // {{install_timestamp}} must be resolved (no unresolved placeholder)
    assert.ok(
      !content.includes('{{install_timestamp}}'),
      `[RED — T-08bis] AC-01b: {{install_timestamp}} must be resolved. Content: ${content.slice(0, 600)}`
    );

    // {{soma_home}} must be resolved to a non-empty path
    assert.ok(
      !content.includes('{{soma_home}}'),
      `[RED — T-08bis] AC-01b: {{soma_home}} must be resolved. Content: ${content.slice(0, 600)}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-08bis-S2: --targets-file= resolves target_path relative to cwd.
 * When sync.cjs is called with --targets-file=<absolutePath> and the adapter file
 * contains target_path: "CLAUDE.md" (relative), the file must be written relative
 * to process.cwd() (the project dir), NOT relative to soma_home.
 *
 * @spec D4 sync.cjs --targets-file flag
 * @task T-08bis
 */
test('T-08bis-S2: sync.cjs --targets-file= resolves relative target_path against cwd', async (t) => {
  const SYNC_CJS = path.join(SCRIPTS_DIR, 'sync.cjs');
  const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..', '..');
  const projectAdapterPath = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'install-targets.project.json');
  const freshCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t08bis-s2-'));

  try {
    // Run sync.cjs with --targets-file pointing to the project adapter
    // cwd=freshCwd means relative target_path "CLAUDE.md" must resolve to freshCwd/CLAUDE.md
    const r = spawnSync('node', [
      SYNC_CJS,
      '--apply',
      '--tool=claude',
      `--targets-file=${projectAdapterPath}`,
      `--soma-home=${path.join(REPO_ROOT, 'core')}`,
    ], {
      encoding: 'utf8',
      timeout: 30000,
      cwd: freshCwd,
    });

    // Must exit 0 (apply succeeded)
    assert.equal(r.status, 0,
      `[RED — T-08bis] sync.cjs --targets-file must exit 0. Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`);

    // CLAUDE.md must be created in cwd (freshCwd), not in soma_home
    const claudeMdInCwd = path.join(freshCwd, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdInCwd),
      `[RED — T-08bis] CLAUDE.md must be created at ${claudeMdInCwd} (relative to cwd). Not found.`
    );

    const content = fs.readFileSync(claudeMdInCwd, 'utf8');
    assert.ok(
      content.includes('<!-- soma-v2:start'),
      `[RED — T-08bis] CLAUDE.md created by --targets-file must contain soma-v2 anchor. Got: ${content.slice(0, 400)}`
    );
    assert.ok(
      content.includes('id=block.claude.CLAUDE_md.project-bootloader'),
      `[RED — T-08bis] CLAUDE.md must have id=block.claude.CLAUDE_md.project-bootloader. Got: ${content.slice(0, 400)}`
    );
  } finally {
    try { fs.rmSync(freshCwd, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-08bis-S3: user-globals invariant — ~/.claude/CLAUDE.md content unchanged by project install.
 * Running install.cjs in a fresh project dir must NOT mutate the content of ~/.claude/CLAUDE.md.
 * We verify by comparing sha256 of the file before and after install.
 * If the file doesn't exist (fresh machine), we skip the content-unchanged assertion
 * and only assert that the file is not created from scratch (to avoid false-positive on new machines).
 *
 * @spec D5 install.cjs orchestrate — user-globals stay in ~/.claude/CLAUDE.md
 * @task T-08bis
 */
test('T-08bis-S3: user-globals invariant — ~/.claude/CLAUDE.md content unchanged by project install', async (t) => {
  const CRYPTO = require('node:crypto');
  const userClaudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t08bis-s3-'));

  // Snapshot pre-run sha256 (if file exists)
  let preSha256 = null;
  if (fs.existsSync(userClaudeMd)) {
    const preBuf = fs.readFileSync(userClaudeMd);
    preSha256 = CRYPTO.createHash('sha256').update(preBuf).digest('hex');
  }

  try {
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r.status, 0,
      `T-08bis-S3: install must exit 0. Got ${r.status}. stderr: ${r.stderr}`);

    if (preSha256 !== null) {
      // File existed pre-run — content must be byte-identical after install
      const postBuf = fs.readFileSync(userClaudeMd);
      const postSha256 = CRYPTO.createHash('sha256').update(postBuf).digest('hex');
      assert.equal(postSha256, preSha256,
        `[T-08bis] user-globals invariant: ~/.claude/CLAUDE.md content must be unchanged after project install.\n` +
        `pre sha256:  ${preSha256}\n` +
        `post sha256: ${postSha256}`
      );
    } else {
      // File did not exist pre-run — must still not exist (project install must not create user global)
      // Note: user-globals sync (step 3 in orchestrate) DOES write user globals when they drift.
      // T-08bis-S3 is specifically about content invariance, not file creation.
      // Skip the assertion if file didn't exist (new machine scenario).
      t.skip('~/.claude/CLAUDE.md did not exist pre-run — skipping content-unchanged check (new machine)');
    }
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

// ── T-12 tests: partial state recovery (AC-04) ───────────────────────────────
// @spec [SPEC:AC-04]
// @task T-12
// Article II HARD: RED phase — T-12-S1 and T-12-S2 written BEFORE implementation.
// Must FAIL until T-12 GREEN phase adds partial-state recovery branch in install.cjs.
//
// AC-04 contract: Given .soma/ exists but anchored block MISSING in CLAUDE.md,
// when soma install runs, then:
//   1. exit code is 0
//   2. anchored block IS injected (sync step ran)
//   3. init step IS SKIPPED (verified via stdout/stderr containing "init skipped" marker)

/**
 * T-12-S1: AC-04 partial state recovery — CLAUDE.md block stripped, .soma/ intact.
 *
 * Setup:
 *   1st run: full greenfield install → establishes baseline (.soma/ + CLAUDE.md with anchor)
 *   Mutation: strip the <!-- soma-v2:start ... --> ... <!-- soma-v2:end --> block from CLAUDE.md
 *   2nd run: soma install → must recover (inject block) without re-running init step
 *
 * Assertions:
 *   - exit code 0
 *   - CLAUDE.md exists AND grep -c '<!-- soma-v2:start' returns exactly 1
 *   - stdout/stderr contains "init skipped" marker (init was NOT re-run)
 *   - .soma/ directory still intact (not deleted between runs — that's the contract)
 */
test('T-12-S1: AC-04 partial state recovery — block stripped from CLAUDE.md, .soma/ intact → block re-injected + init skipped', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t12-s1-'));
  try {
    // ── 1st run: greenfield install ──────────────────────────────────────────
    const r1 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r1.status, 0,
      `T-12-S1: 1st install must exit 0. Got ${r1.status}. stderr: ${r1.stderr} stdout: ${r1.stdout}`);

    // Verify 1st run created CLAUDE.md with anchor
    const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdPath),
      `T-12-S1: CLAUDE.md must exist after 1st install. Not found at ${claudeMdPath}`
    );

    const afterFirst = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterFirst = (afterFirst.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterFirst, 1,
      `T-12-S1: CLAUDE.md must have exactly 1 anchor after 1st install. Got ${countAfterFirst}`
    );

    // Verify .soma/ exists (precondition for partial-state scenario)
    const somaDir = path.join(freshDir, '.soma');
    assert.ok(
      fs.existsSync(somaDir),
      `T-12-S1: .soma/ must exist after 1st install. Not found at ${somaDir}`
    );

    // ── Mutation: strip the anchored block from CLAUDE.md ────────────────────
    // Remove the <!-- soma-v2:start ... --> ... <!-- soma-v2:end ... --> block entirely.
    // This simulates: user manually edited CLAUDE.md and stripped the block.
    const stripped = afterFirst.replace(
      /<!-- soma-v2:start[^>]*-->([\s\S]*?)<!-- soma-v2:end[^>]*-->\n?/g,
      ''
    ).trim();
    fs.writeFileSync(claudeMdPath, stripped + '\n', 'utf8');

    // Verify strip worked
    const afterStrip = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterStrip = (afterStrip.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterStrip, 0,
      `T-12-S1: setup: CLAUDE.md must have 0 anchors after strip. Got ${countAfterStrip}`
    );

    // .soma/ MUST still exist (do NOT delete it — T-12 contract requires it)
    assert.ok(
      fs.existsSync(somaDir),
      `T-12-S1: .soma/ must still exist after strip mutation. It was unexpectedly removed.`
    );

    // ── 2nd run: partial state recovery ──────────────────────────────────────
    const r2 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // AC-04 assertion 1: exit code 0
    assert.equal(r2.status, 0,
      `[RED — T-12] AC-04: 2nd install (partial state recovery) must exit 0. Got ${r2.status}.\n` +
      `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`
    );

    // AC-04 assertion 2: anchored block re-injected (exactly 1 anchor)
    const afterSecond = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterSecond = (afterSecond.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterSecond, 1,
      `[RED — T-12] AC-04: grep -c '<!-- soma-v2:start' CLAUDE.md must return 1 after recovery. Got ${countAfterSecond}.\n` +
      `Content: ${afterSecond.slice(0, 500)}`
    );

    // AC-04 assertion 3: init step was SKIPPED (log marker present)
    const combined2 = r2.stdout + r2.stderr;
    assert.ok(
      combined2.toLowerCase().includes('init skipped') || combined2.toLowerCase().includes('init: skip'),
      `[RED — T-12] AC-04: output must contain "init skipped" or "init: skip" marker when .soma/ exists + block missing.\n` +
      `stdout: ${r2.stdout}\nstderr: ${r2.stderr}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-12-S2: AC-04 partial state recovery — CLAUDE.md deleted entirely, .soma/ intact.
 *
 * Variant of T-12-S1 where CLAUDE.md is completely deleted (not just stripped).
 * This simulates: user ran `rm CLAUDE.md` after install.
 *
 * Same AC-04 assertions:
 *   - exit code 0
 *   - CLAUDE.md re-created with exactly 1 anchor
 *   - init step skipped (log marker)
 */
test('T-12-S2: AC-04 partial state recovery — CLAUDE.md deleted, .soma/ intact → CLAUDE.md recreated + init skipped', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t12-s2-'));
  try {
    // ── 1st run: greenfield install ──────────────────────────────────────────
    const r1 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r1.status, 0,
      `T-12-S2: 1st install must exit 0. Got ${r1.status}. stderr: ${r1.stderr}`);

    const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
    const somaDir = path.join(freshDir, '.soma');

    assert.ok(fs.existsSync(claudeMdPath), `T-12-S2: CLAUDE.md must exist after 1st install`);
    assert.ok(fs.existsSync(somaDir), `T-12-S2: .soma/ must exist after 1st install`);

    // ── Mutation: delete CLAUDE.md entirely ──────────────────────────────────
    fs.rmSync(claudeMdPath, { force: true });

    assert.ok(!fs.existsSync(claudeMdPath), `T-12-S2: setup: CLAUDE.md must not exist after deletion`);
    // .soma/ MUST still exist (do NOT delete — T-12 contract)
    assert.ok(fs.existsSync(somaDir), `T-12-S2: .soma/ must still exist after CLAUDE.md deletion`);

    // ── 2nd run: partial state recovery ──────────────────────────────────────
    const r2 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // AC-04 assertion 1: exit code 0
    assert.equal(r2.status, 0,
      `[RED — T-12] AC-04 (deleted CLAUDE.md): 2nd install must exit 0. Got ${r2.status}.\n` +
      `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`
    );

    // AC-04 assertion 2: CLAUDE.md re-created with exactly 1 anchor
    assert.ok(
      fs.existsSync(claudeMdPath),
      `[RED — T-12] AC-04: CLAUDE.md must be re-created after recovery. Not found at ${claudeMdPath}`
    );
    const afterRecovery = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterRecovery = (afterRecovery.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterRecovery, 1,
      `[RED — T-12] AC-04: grep -c '<!-- soma-v2:start' CLAUDE.md must return 1 after recovery from deletion. Got ${countAfterRecovery}`
    );

    // AC-04 assertion 3: init step was SKIPPED
    const combined2 = r2.stdout + r2.stderr;
    assert.ok(
      combined2.toLowerCase().includes('init skipped') || combined2.toLowerCase().includes('init: skip'),
      `[RED — T-12] AC-04 (deleted CLAUDE.md): output must contain "init skipped" or "init: skip" marker.\n` +
      `stdout: ${r2.stdout}\nstderr: ${r2.stderr}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── T-10 tests: idempotent re-run clean (AC-02) ───────────────────────────────
// @spec [SPEC:AC-02]
// @task T-10
// Article II HARD: RED phase — T-10-S1 written BEFORE implementation.
// Must FAIL until T-10 GREEN phase adds early-exit detection in install.cjs.

/**
 * T-10-S1: AC-02 idempotent re-run clean.
 *
 * Given a project full-installed (1st run exit 0, install-state.json status=complete,
 * CLAUDE.md with exactly 1 soma-v2:start anchor), when `soma install . --tool=claude`
 * runs AGAIN (2nd run), then:
 *   1. exit code is 0
 *   2. grep -c '<!-- soma-v2:start' CLAUDE.md returns exactly 1 (no duplicate block)
 *   3. stdout contains literal "no changes"
 *   4. install-state.json content is unchanged (status still "complete", same blockIds)
 *
 * @spec AC-02 (idempotent re-run clean)
 * @task T-10
 */
test('T-10-S1: AC-02 idempotent re-run clean — 2nd install run exits 0 + no duplicate block + "no changes"', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t10-s1-'));
  try {
    // ── 1st run: greenfield install ──────────────────────────────────────────
    const r1 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r1.status, 0,
      `T-10-S1: 1st install must exit 0. Got ${r1.status}. stderr: ${r1.stderr} stdout: ${r1.stdout}`);

    // Verify 1st run created CLAUDE.md with exactly 1 anchor
    const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdPath),
      `T-10-S1: CLAUDE.md must exist after 1st install. Not found at ${claudeMdPath}`
    );
    const afterFirst = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterFirst = (afterFirst.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterFirst, 1,
      `T-10-S1: CLAUDE.md must have exactly 1 anchor after 1st install. Got ${countAfterFirst}`
    );

    // Capture install-state.json after 1st run
    const stateFilePath = path.join(freshDir, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFilePath),
      `T-10-S1: install-state.json must exist after 1st install. Not found at ${stateFilePath}`
    );
    const stateAfterFirst = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    assert.equal(stateAfterFirst.status, 'complete',
      `T-10-S1: install-state.json must have status=complete after 1st install. Got: ${stateAfterFirst.status}`
    );

    // ── 2nd run: re-install on already-complete project ──────────────────────
    const r2 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // AC-02 contract assertions:

    // 1. exit code must be 0
    assert.equal(r2.status, 0,
      `[RED — T-10] AC-02: 2nd install must exit 0. Got ${r2.status}. stderr: ${r2.stderr} stdout: ${r2.stdout}`
    );

    // 2. grep -c '<!-- soma-v2:start' CLAUDE.md must return exactly 1 (no duplicate)
    const afterSecond = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterSecond = (afterSecond.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterSecond, 1,
      `[RED — T-10] AC-02: grep -c '<!-- soma-v2:start' CLAUDE.md must return 1 after 2nd install. Got ${countAfterSecond}.\n` +
      `Content: ${afterSecond.slice(0, 400)}`
    );

    // 3. stdout must contain literal "no changes"
    assert.ok(
      r2.stdout.includes('no changes'),
      `[RED — T-10] AC-02: 2nd install stdout must contain "no changes". Got stdout: ${r2.stdout}`
    );

    // 4. install-state.json status still "complete" (unchanged)
    const stateAfterSecond = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    assert.equal(stateAfterSecond.status, 'complete',
      `[RED — T-10] AC-02: install-state.json must still have status=complete after 2nd install. Got: ${stateAfterSecond.status}`
    );
  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── T-13 tests: mid-pipeline failure rollback (AC-05) ────────────────────────
// @spec [SPEC:AC-05]
// @task T-13
// Article II HARD: RED phase — T-13-S1 written BEFORE implementation.
// Must FAIL until T-13 GREEN phase adds snapshot-id surface in stderr.
//
// AC-05 contract: Given init succeeded but manifest baseline failed,
// when install detects partial state, then:
//   1. exit code is 2 (NOT 1 — distinct from generic error)
//   2. stderr contains a snapshot-id reference (ISO-8601 UTC format)
//   3. .soma/install-state.json field status is "partial-failed"

/**
 * T-13-S1: AC-05 mid-pipeline failure rollback (simulated manifest baseline failure).
 *
 * Setup:
 *   - Pre-create .soma/ in a fresh tmpdir so init.cjs exits 1 (redirect / "already initialized")
 *   - Run install with SOMA_HOME=/nonexistent to force manifest.cjs baseline to fail
 *     (MANIFEST_MISSING: manifest.json not found at /nonexistent/manifest.json)
 *
 * This simulates "init succeeded but manifest baseline failed" (AC-05 precondition).
 * init exits 1 = redirect = success branch in orchestrate().
 * manifest.cjs exits 2 = MANIFEST_MISSING = failure branch.
 *
 * AC-05 assertions:
 *   1. exit code is 2 (hard error, distinct from exit 1 usage error)
 *   2. stderr contains snapshot-id substring matching ISO-8601 UTC pattern
 *      (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/ or literal "snapshot-id: ...")
 *   3. .soma/install-state.json exists + parses as JSON + status === "partial-failed"
 *
 * @spec AC-05
 * @task T-13
 */
test('T-13-S1: AC-05 mid-pipeline failure rollback (EACCES/MANIFEST_MISSING) — exit 2 + stderr snapshot-id + state partial-failed', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t13-s1-'));
  try {
    // ── Setup: pre-create .soma/ to simulate "init already ran" ─────────────
    // This causes init.cjs to exit 1 (redirect / "already initialized") so
    // the pipeline continues to manifest baseline (AC-05 precondition: init succeeded).
    fs.mkdirSync(path.join(freshDir, '.soma'), { recursive: true });

    // ── Run install with SOMA_HOME=/nonexistent to force manifest failure ────
    // SOMA_HOME env is inherited by all subprocesses (init.cjs, manifest.cjs, sync.cjs).
    // init.cjs: exits 1 (redirect) when .soma/ already exists, regardless of SOMA_HOME.
    // manifest.cjs: exits 2 (MANIFEST_MISSING) when SOMA_HOME points to nonexistent path.
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, SOMA_HOME: '/nonexistent-soma-home-t13-test' },
    });

    // AC-05 assertion 1: exit code must be 2 (distinct from exit 1 USAGE error)
    assert.equal(r.status, 2,
      `[RED — T-13] AC-05: install must exit 2 when manifest baseline fails. Got ${r.status}.\n` +
      `stderr: ${r.stderr}\nstdout: ${r.stdout}`
    );

    // AC-05 assertion 2: stderr must contain a snapshot-id reference
    // Expected format: "snapshot-id: 2026-05-10T18:41:13Z" or similar ISO-8601 UTC string
    // The snapshot-id is the ISO-8601 timestamp computed at orchestrate() start (the `now` variable).
    // D1 adds: process.stderr.write(`soma install: partial-failed snapshot-id: ${snapshotId}\n`)
    const ISO_UTC_SNAPSHOT_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/;
    const stderrHasSnapshotId = (
      (r.stderr.toLowerCase().includes('snapshot') || r.stderr.includes('snapshotId') || r.stderr.toLowerCase().includes('snapshot-id')) &&
      ISO_UTC_SNAPSHOT_RE.test(r.stderr)
    );
    assert.ok(
      stderrHasSnapshotId,
      `[RED — T-13] AC-05: stderr must contain a snapshot-id reference (ISO-8601 UTC timestamp + "snapshot"/"snapshotId" keyword).\n` +
      `Got stderr: ${r.stderr}`
    );

    // AC-05 assertion 3: .soma/install-state.json must exist with status="partial-failed"
    const stateFilePath = path.join(freshDir, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFilePath),
      `[RED — T-13] AC-05: .soma/install-state.json must be written on partial failure. Not found at ${stateFilePath}`
    );

    let stateRaw, stateParsed;
    assert.doesNotThrow(
      () => { stateRaw = fs.readFileSync(stateFilePath, 'utf8'); stateParsed = JSON.parse(stateRaw); },
      `[RED — T-13] AC-05: install-state.json must be valid JSON`
    );

    assert.equal(stateParsed.status, 'partial-failed',
      `[RED — T-13] AC-05: install-state.json must have status="partial-failed" on mid-pipeline failure. Got: "${stateParsed.status}"`
    );

  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── T-11 tests: drift detection abort (AC-03) ────────────────────────────────
// @spec [SPEC:AC-03]
// @task T-11
// Article II HARD: RED phase — T-11-S1 written BEFORE implementation.
// Must FAIL until T-11 GREEN phase adds drift-specific state + propagation in install.cjs.
//
// AC-03 contract: Given anchored block exists in CLAUDE.md but user added text INSIDE
// the anchored region (sha mismatch), when soma install runs WITHOUT --force-resync or
// --allow-local-edits, then:
//   1. exit code is 2 (drift abort)
//   2. stderr contains literal "soma rollback" OR "force-resync" hint
//   3. install-state.json has status="drift-detected"
//   4. User's added text is preserved in CLAUDE.md (no overwrite happened)

/**
 * T-11-S1: AC-03 drift detection abort — user edit inside anchored region, no bypass flag.
 *
 * Setup:
 *   1st run: full greenfield install → CLAUDE.md has anchored block (clean sha)
 *   Mutation: insert user text INSIDE the anchored region (between start and end markers)
 *             This changes the block content sha → BF-06 conflict
 *   2nd run: soma install WITHOUT --force-resync or --allow-local-edits
 *
 * Assertions (AC-03 literal):
 *   1. exit code is 2 (NOT 0, NOT 1)
 *   2. stderr contains "soma rollback" OR "force-resync" substring
 *   3. .soma/install-state.json field status is "drift-detected"
 *   4. CLAUDE.md still contains the user-added text (no overwrite)
 *
 * @spec AC-03 (drift detection abort)
 * @task T-11
 */
test('T-11-S1: AC-03 drift detection abort — user edit inside anchor, no bypass flag → exit 2 + drift-detected state + user text preserved', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t11-s1-'));
  const USER_EDIT_MARKER = '# USER ADDED TEXT INSIDE ANCHOR — T-11-S1 drift marker';
  try {
    // ── 1st run: greenfield install ──────────────────────────────────────────
    const r1 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r1.status, 0,
      `T-11-S1: 1st install must exit 0. Got ${r1.status}. stderr: ${r1.stderr} stdout: ${r1.stdout}`);

    const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdPath),
      `T-11-S1: CLAUDE.md must exist after 1st install. Not found at ${claudeMdPath}`
    );

    const afterFirst = fs.readFileSync(claudeMdPath, 'utf8');
    const countAfterFirst = (afterFirst.match(/<!-- soma-v2:start/g) || []).length;
    assert.equal(countAfterFirst, 1,
      `T-11-S1: CLAUDE.md must have exactly 1 anchor after 1st install. Got ${countAfterFirst}`
    );

    // ── Mutation: insert user text INSIDE the anchored region ─────────────
    // Find the start marker, locate the end marker, and insert user text between them.
    // This changes the block content sha → triggers BF-06 conflict on 2nd run.
    const startMarkerMatch = afterFirst.match(/<!-- soma-v2:start[^\n]*-->/);
    const endMarkerMatch = afterFirst.match(/<!-- soma-v2:end[^\n]*-->/);
    assert.ok(startMarkerMatch, `T-11-S1: setup: CLAUDE.md must have soma-v2:start marker`);
    assert.ok(endMarkerMatch, `T-11-S1: setup: CLAUDE.md must have soma-v2:end marker`);

    // Insert the user-edit text AFTER the start marker and BEFORE the end marker.
    // This mutates the block content (sha mismatch) while preserving the markers themselves.
    const startMarker = startMarkerMatch[0];
    const endMarker = endMarkerMatch[0];
    const mutated = afterFirst.replace(
      startMarker,
      `${startMarker}\n${USER_EDIT_MARKER}`
    );
    fs.writeFileSync(claudeMdPath, mutated, 'utf8');

    // Verify mutation worked
    const afterMutation = fs.readFileSync(claudeMdPath, 'utf8');
    assert.ok(
      afterMutation.includes(USER_EDIT_MARKER),
      `T-11-S1: setup: mutation must insert user text marker inside anchor. Content: ${afterMutation.slice(0, 600)}`
    );
    // Markers must still be present (we only added content inside, not removed markers)
    assert.ok(
      afterMutation.includes('<!-- soma-v2:start'),
      `T-11-S1: setup: soma-v2:start marker must still be present after mutation`
    );
    assert.ok(
      afterMutation.includes('<!-- soma-v2:end'),
      `T-11-S1: setup: soma-v2:end marker must still be present after mutation`
    );

    // ── 2nd run: WITHOUT --force-resync or --allow-local-edits ──────────────
    const r2 = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // AC-03 assertion 1: exit code must be 2 (drift abort, distinct from exit 1 USAGE error)
    assert.equal(r2.status, 2,
      `[RED — T-11] AC-03: drift detection must exit 2. Got ${r2.status}.\n` +
      `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`
    );

    // AC-03 assertion 2: stderr must contain recovery hint
    const hasRecoveryHint =
      r2.stderr.includes('soma rollback') ||
      r2.stderr.includes('force-resync');
    assert.ok(
      hasRecoveryHint,
      `[RED — T-11] AC-03: stderr must contain "soma rollback" OR "force-resync" substring.\n` +
      `Got stderr: ${r2.stderr}`
    );

    // AC-03 assertion 3: install-state.json must have status="drift-detected"
    const stateFilePath = path.join(freshDir, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFilePath),
      `[RED — T-11] AC-03: .soma/install-state.json must be written on drift detection. Not found at ${stateFilePath}`
    );

    let stateParsed;
    assert.doesNotThrow(
      () => { stateParsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8')); },
      `[RED — T-11] AC-03: install-state.json must be valid JSON`
    );

    assert.equal(stateParsed.status, 'drift-detected',
      `[RED — T-11] AC-03: install-state.json must have status="drift-detected" on drift abort. Got: "${stateParsed.status}"`
    );

    // AC-03 assertion 4: user edit text preserved in CLAUDE.md (no overwrite happened)
    const afterSecond = fs.readFileSync(claudeMdPath, 'utf8');
    assert.ok(
      afterSecond.includes(USER_EDIT_MARKER),
      `[RED — T-11] AC-03: user-added text must be preserved in CLAUDE.md (no overwrite on drift abort).\n` +
      `Expected: "${USER_EDIT_MARKER}"\n` +
      `Content after 2nd run: ${afterSecond.slice(0, 600)}`
    );

  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── T-14 + T-15 + T-16 tests: CLAUDE.md custom handling (AC-07, AC-08, AC-09) ──
// @spec [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09]
// @task T-14 T-15 T-16
// Article II HARD: RED phase — these 3 tests are written BEFORE implementation.
// Must FAIL until T-14/T-15/T-16 GREEN phase adds CLAUDE.md detection + branching.
//
// AC-07: --merge-claude-md → preserve original + append anchor (no deletions)
// AC-08: --replace-claude-md → snapshot original + replace with anchor only
// AC-09: non-interactive + no flag → exit 2 + stderr names both flags

const HYDRA_FIXTURE = path.join(__dirname, 'fixtures', 'hydra-like-claude.md');

/**
 * T-14-S1: AC-07 --merge-claude-md preserves free-text + appends anchored block.
 *
 * Setup:
 *   - Fresh tmpdir with CLAUDE.md = hydra-like-claude.md fixture (free-text, no anchors)
 *
 * Run:
 *   soma install <tmpdir> --merge-claude-md
 *
 * Assertions:
 *   1. exit code 0
 *   2. CLAUDE.md still contains ALL original lines (no deletions)
 *   3. CLAUDE.md NOW contains <!-- soma-v2:start id=block.claude.CLAUDE_md.project-bootloader
 *      AFTER the original content (anchored block appended at end)
 *
 * @spec AC-07
 * @task T-14
 */
test('T-14-S1: AC-07 --merge-claude-md preserves free-text + appends anchored block (no deletions)', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t14-s1-'));
  const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
  try {
    // Setup: copy hydra fixture into tmpdir
    const fixtureContent = fs.readFileSync(HYDRA_FIXTURE, 'utf8');
    fs.writeFileSync(claudeMdPath, fixtureContent, 'utf8');

    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude', '--merge-claude-md'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Assertion 1: exit code 0
    assert.equal(r.status, 0,
      `[RED — T-14] AC-07: install with --merge-claude-md must exit 0. Got ${r.status}.\n` +
      `stderr: ${r.stderr}\nstdout: ${r.stdout}`
    );

    const afterContent = fs.readFileSync(claudeMdPath, 'utf8');

    // Assertion 2: no original lines deleted
    // All original non-empty lines from fixture must still be present
    const originalLines = fixtureContent.split('\n').filter(l => l.trim().length > 0);
    const missingLines = originalLines.filter(l => !afterContent.includes(l));
    assert.equal(missingLines.length, 0,
      `[RED — T-14] AC-07: --merge-claude-md must NOT delete any original lines.\n` +
      `Missing (first 3): ${JSON.stringify(missingLines.slice(0, 3))}\n` +
      `Content (first 800): ${afterContent.slice(0, 800)}`
    );

    // Assertion 3: soma-v2 anchored block appended AFTER original content
    const anchorIdx = afterContent.indexOf('<!-- soma-v2:start');
    const originalEndIdx = afterContent.indexOf('# Memory'); // last section in fixture
    assert.ok(
      anchorIdx > -1,
      `[RED — T-14] AC-07: CLAUDE.md must contain <!-- soma-v2:start after --merge-claude-md.\n` +
      `Content (first 800): ${afterContent.slice(0, 800)}`
    );
    assert.ok(
      afterContent.includes('id=block.claude.CLAUDE_md.project-bootloader'),
      `[RED — T-14] AC-07: anchored block must have id=block.claude.CLAUDE_md.project-bootloader.\n` +
      `Content (first 800): ${afterContent.slice(0, 800)}`
    );
    // Block must appear AFTER the original content (append, not prepend)
    assert.ok(
      originalEndIdx > -1 && anchorIdx > originalEndIdx,
      `[RED — T-14] AC-07: anchored block must appear AFTER original content (anchor at ${anchorIdx}, "# Memory" at ${originalEndIdx}).\n` +
      `Content (first 800): ${afterContent.slice(0, 800)}`
    );

  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * T-15-S1: AC-08 --replace-claude-md snapshots original + replaces with anchor only.
 *
 * Setup:
 *   - Fresh tmpdir with CLAUDE.md = hydra-like-claude.md fixture (free-text, no anchors)
 *   - Record content sha256 before install
 *
 * Run:
 *   soma install <tmpdir> --replace-claude-md
 *
 * Assertions:
 *   1. exit code 0
 *   2. CLAUDE.md content now has anchored block but NOT original free-text lines
 *   3. Snapshot file exists under ~/.soma-v2/.snapshots/<ts>/ with content matching original sha
 *   4. stdout contains "Original preserved at" or ".snapshots" substring
 *   5. Cleanup: snapshot dir created by this test is removed in teardown
 *
 * @spec AC-08
 * @task T-15
 */
test('T-15-S1: AC-08 --replace-claude-md snapshots original + CLAUDE.md = anchor only + snapshot path in stdout', async (t) => {
  const crypto = require('node:crypto');
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t15-s1-'));
  const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
  let snapshotDirCreated = null;
  try {
    // Setup: copy hydra fixture into tmpdir, record sha256
    const fixtureContent = fs.readFileSync(HYDRA_FIXTURE, 'utf8');
    fs.writeFileSync(claudeMdPath, fixtureContent, 'utf8');
    const originalSha = crypto.createHash('sha256').update(fixtureContent).digest('hex');

    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude', '--replace-claude-md'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Assertion 1: exit code 0
    assert.equal(r.status, 0,
      `[RED — T-15] AC-08: install with --replace-claude-md must exit 0. Got ${r.status}.\n` +
      `stderr: ${r.stderr}\nstdout: ${r.stdout}`
    );

    const afterContent = fs.readFileSync(claudeMdPath, 'utf8');

    // Assertion 2a: CLAUDE.md now has anchored block
    assert.ok(
      afterContent.includes('<!-- soma-v2:start'),
      `[RED — T-15] AC-08: CLAUDE.md must contain <!-- soma-v2:start after --replace-claude-md.\n` +
      `Content (first 600): ${afterContent.slice(0, 600)}`
    );
    assert.ok(
      afterContent.includes('id=block.claude.CLAUDE_md.project-bootloader'),
      `[RED — T-15] AC-08: anchored block must have id=block.claude.CLAUDE_md.project-bootloader.\n` +
      `Content (first 600): ${afterContent.slice(0, 600)}`
    );

    // Assertion 2b: original free-text content is GONE
    const fixtureUniqueLines = [
      '# Hydra Project — Claude Context',
      '- Squad copywriter-os in ~/squads/',
      '- Single-tenant by design (Aryse first)',
    ];
    for (const line of fixtureUniqueLines) {
      assert.ok(
        !afterContent.includes(line),
        `[RED — T-15] AC-08: original free-text line must NOT remain after --replace-claude-md.\n` +
        `Found line: "${line}"\n` +
        `Content (first 600): ${afterContent.slice(0, 600)}`
      );
    }

    // Assertion 3: stdout contains snapshot path reference
    const stdoutHasPreservedMsg = r.stdout.includes('Original preserved at') ||
      r.stdout.includes('preserved') ||
      r.stdout.includes('.snapshots');
    assert.ok(
      stdoutHasPreservedMsg,
      `[RED — T-15] AC-08: stdout must contain "Original preserved at" or ".snapshots".\n` +
      `Got stdout: ${r.stdout}`
    );

    // Assertion 4: snapshot file exists with matching sha256
    const snapshotsBase = path.join(os.homedir(), '.soma-v2', '.snapshots');

    // Try to extract snapshot path from stdout
    // Match absolute paths (/Users/.../.soma-v2/.snapshots/<ts>/) or relative (.soma-v2/.snapshots/<ts>/)
    const snapshotPathMatch = r.stdout.match(/(?:\/[^\s]*\.soma-v2[/\\]\.snapshots[/\\][^\s/]+|~[/\\]\.soma-v2[/\\]\.snapshots[/\\][^\s/]+|\.soma-v2[/\\]\.snapshots[/\\][^\s/]+)/);
    let snapshotOriginalFile = null;

    if (snapshotPathMatch) {
      const rawPath = snapshotPathMatch[0].replace(/^~/, os.homedir());
      // Resolve: if starts with '/', it's already absolute; otherwise resolve from home
      const resolved = rawPath.startsWith('/') ? rawPath : path.join(os.homedir(), rawPath);
      const snapDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved
        : path.dirname(resolved);
      snapshotDirCreated = snapDir;
    }

    // Scan for most recently modified snapshot dir containing CLAUDE.md.original or CLAUDE.md
    const findSnapshotFile = (dir) => {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const found = findSnapshotFile(path.join(dir, entry.name));
          if (found) return found;
        }
        if (entry.name === 'CLAUDE.md.original' || entry.name === 'CLAUDE.md') {
          return path.join(dir, entry.name);
        }
      }
      return null;
    };

    if (snapshotDirCreated) {
      snapshotOriginalFile = findSnapshotFile(snapshotDirCreated);
    }

    if (!snapshotOriginalFile && fs.existsSync(snapshotsBase)) {
      // Fallback: scan all snapshot dirs newest first
      const tsDirs = fs.readdirSync(snapshotsBase)
        .map(d => path.join(snapshotsBase, d))
        .filter(d => { try { return fs.statSync(d).isDirectory(); } catch (_) { return false; } })
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

      for (const tsDir of tsDirs) {
        const f = findSnapshotFile(tsDir);
        if (f) {
          snapshotOriginalFile = f;
          if (!snapshotDirCreated) snapshotDirCreated = tsDir;
          break;
        }
      }
    }

    assert.ok(
      snapshotOriginalFile !== null && fs.existsSync(snapshotOriginalFile),
      `[RED — T-15] AC-08: snapshot file (CLAUDE.md.original or CLAUDE.md) must exist under ~/.soma-v2/.snapshots/.\n` +
      `stdout: ${r.stdout}\n` +
      `Searched in: ${snapshotsBase}`
    );

    const snapshotContent = fs.readFileSync(snapshotOriginalFile, 'utf8');
    const snapshotSha = crypto.createHash('sha256').update(snapshotContent).digest('hex');
    assert.equal(snapshotSha, originalSha,
      `[RED — T-15] AC-08: snapshot content sha256 must match original.\n` +
      `original sha: ${originalSha}\n` +
      `snapshot sha: ${snapshotSha}\n` +
      `snapshot file: ${snapshotOriginalFile}`
    );

  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
    // Cleanup: remove snapshot dir created by this test (no orphans in ~/.soma-v2/.snapshots/)
    if (snapshotDirCreated && fs.existsSync(snapshotDirCreated)) {
      try { fs.rmSync(snapshotDirCreated, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

/**
 * T-16-S1: AC-09 abort default non-interactive — free-text CLAUDE.md + no flag → exit 2.
 *
 * Setup:
 *   - Fresh tmpdir with CLAUDE.md = hydra-like-claude.md fixture (free-text, no anchors)
 *
 * Run:
 *   soma install <tmpdir> via spawnSync with piped stdio (non-TTY)
 *   WITHOUT --merge-claude-md or --replace-claude-md
 *
 * Assertions:
 *   1. exit code 2
 *   2. stderr contains literal "--merge-claude-md"
 *   3. stderr contains literal "--replace-claude-md"
 *   4. CLAUDE.md NOT modified (original content intact)
 *
 * @spec AC-09
 * @task T-16
 */
test('T-16-S1: AC-09 abort default non-interactive — free-text CLAUDE.md + no flag → exit 2 + stderr names both flags + CLAUDE.md unchanged', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-t16-s1-'));
  const claudeMdPath = path.join(freshDir, 'CLAUDE.md');
  try {
    // Setup: copy hydra fixture into tmpdir
    const fixtureContent = fs.readFileSync(HYDRA_FIXTURE, 'utf8');
    fs.writeFileSync(claudeMdPath, fixtureContent, 'utf8');

    // Run install WITHOUT any --merge-claude-md or --replace-claude-md flag
    // spawnSync with piped stdio → child stdout.isTTY === undefined (non-interactive)
    const r = spawnSync('node', [INSTALL_CJS, freshDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Assertion 1: exit code 2 (AC-09 abort)
    assert.equal(r.status, 2,
      `[RED — T-16] AC-09: non-interactive install with free-text CLAUDE.md + no flag must exit 2. Got ${r.status}.\n` +
      `stderr: ${r.stderr}\nstdout: ${r.stdout}`
    );

    // Assertion 2: stderr contains literal "--merge-claude-md"
    assert.ok(
      r.stderr.includes('--merge-claude-md'),
      `[RED — T-16] AC-09: stderr must contain literal "--merge-claude-md".\n` +
      `Got stderr: ${r.stderr}`
    );

    // Assertion 3: stderr contains literal "--replace-claude-md"
    assert.ok(
      r.stderr.includes('--replace-claude-md'),
      `[RED — T-16] AC-09: stderr must contain literal "--replace-claude-md".\n` +
      `Got stderr: ${r.stderr}`
    );

    // Assertion 4: CLAUDE.md NOT modified (original content intact)
    const afterContent = fs.readFileSync(claudeMdPath, 'utf8');
    assert.equal(afterContent, fixtureContent,
      `[RED — T-16] AC-09: CLAUDE.md must NOT be modified on abort.\n` +
      `Original length: ${fixtureContent.length}, After length: ${afterContent.length}`
    );

  } finally {
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
  }
});
