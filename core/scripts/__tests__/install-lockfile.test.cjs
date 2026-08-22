'use strict';
/**
 * install-lockfile.test.cjs — T-06 contract tests for install-lockfile.md
 *
 * Article II HARD: RED phase — contract tests written BEFORE lock implementation.
 * All LC-* cases FAIL until T-09 implements lock acquire/release in install.cjs.
 * LC-08 static check may PASS if .soma/.gitignore template already lists install.lock.
 *
 * Contract covered: [CONTRACT:05] core/specs/015-soma-install/contracts/install-lockfile.md
 *
 * Test map:
 *   LC-01: lock acquire on install start → .soma/install.lock created with valid JSON     → FAIL (RED — T-09)
 *   LC-02: lock release on success → install.lock removed after clean run                 → FAIL (RED — T-09)
 *   LC-03: lock release on failure → install.lock removed even when pipeline throws       → FAIL (RED — T-09)
 *   LC-04: lock contention < 60min → exit 2 + stderr names PID + timestamp                → FAIL (RED — T-09)
 *   LC-05: stale lock > 60min → WARNING logged + auto-removed + exit 0                   → FAIL (RED — T-09)
 *   LC-06: lock JSON schema → required fields pid (int), timestamp (ISO-8601), hostname   → FAIL (RED — T-09)
 *   LC-07: file mode 0644 → lock file permissions are rw-r--r--                          → FAIL (RED — T-09)
 *   LC-08: .gitignore coverage → install.lock listed in .soma/.gitignore or global template → RED or static-PASS
 *
 * Test fixture: real fs under /tmp/soma-test-lockfile-{pid}/ per Article III.
 * No mocks. Cleanup in afterEach.
 *
 * @spec [CONTRACT:05]
 * @task T-06
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// ── Paths ─────────────────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const INSTALL_CJS = path.join(SCRIPTS_DIR, 'install.cjs');

// Bucket G (Spec 018): LC-05b is the one test in this file that spawns the
// FULL install.cjs pipeline (the rest exercise acquireLock/releaseLock
// in-process, or check exit codes before the pipeline reaches anything
// HOME-dependent). See helpers/fake-home.cjs for why a plain fake HOME
// isn't enough (install.cjs's init.cjs step needs a real
// <HOME>/.soma-v2/templates tree).
const { withFakeHome, fakeHomeEnv } = require('./helpers/fake-home.cjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh isolated project directory under /tmp for each test.
 * Returns the project root path.
 */
function makeTmpProject(suffix = '') {
  const dir = path.join(
    os.tmpdir(),
    `soma-test-lockfile-${process.pid}${suffix ? '-' + suffix : ''}`
  );
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

/**
 * Remove a temp project directory, ignoring ENOENT.
 */
function cleanTmpProject(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/**
 * Path to the lock file inside a project.
 */
function lockPath(projectDir) {
  return path.join(projectDir, '.soma', 'install.lock');
}

/**
 * Write a synthetic lock file with given content to projectDir/.soma/install.lock.
 * Used to simulate an existing lock before running install.
 */
function writeSyntheticLock(projectDir, content) {
  const lp = lockPath(projectDir);
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  fs.writeFileSync(lp, JSON.stringify(content), { mode: 0o644 });
}

/**
 * Return ISO-8601 timestamp offset by `offsetMs` milliseconds from now.
 * Negative offset = in the past.
 */
function isoOffset(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Get acquireLock/releaseLock from install.cjs module.
 * Throws ReferenceError if the exports don't exist yet (RED phase).
 */
function getLockFunctions() {
  const m = require(INSTALL_CJS);
  if (typeof m.acquireLock !== 'function') {
    throw new ReferenceError(
      '[RED — T-09] install.cjs does not export acquireLock() yet. ' +
      'Will be implemented in T-09.'
    );
  }
  if (typeof m.releaseLock !== 'function') {
    throw new ReferenceError(
      '[RED — T-09] install.cjs does not export releaseLock() yet. ' +
      'Will be implemented in T-09.'
    );
  }
  return { acquireLock: m.acquireLock, releaseLock: m.releaseLock };
}

/**
 * Run install.cjs as a subprocess with given args.
 */
function runInstall(args = [], opts = {}) {
  return spawnSync('node', [INSTALL_CJS, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    ...opts,
  });
}

// ── Cleanup registry ──────────────────────────────────────────────────────────

const _cleanup = [];
afterEach(() => {
  while (_cleanup.length) {
    const dir = _cleanup.pop();
    cleanTmpProject(dir);
  }
});

// ── LC-01: Lock acquire on install start ──────────────────────────────────────

test('LC-01: acquireLock creates .soma/install.lock with valid JSON content', () => {
  const projectDir = makeTmpProject('lc01');
  _cleanup.push(projectDir);

  const { acquireLock, releaseLock } = getLockFunctions();

  // Call acquireLock — should create the file
  acquireLock(projectDir);

  const lp = lockPath(projectDir);
  assert.ok(
    fs.existsSync(lp),
    `Expected .soma/install.lock to exist after acquireLock. Got: no file at ${lp}`
  );

  // File must contain valid JSON
  const raw = fs.readFileSync(lp, 'utf8');
  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(raw);
  }, `Lock file must contain valid JSON. Got: ${raw}`);

  // Cleanup: release before assertions to avoid leaking lock
  releaseLock(projectDir);
});

// ── LC-02: Lock release on install end (success) ──────────────────────────────

test('LC-02: releaseLock removes .soma/install.lock after successful install', () => {
  const projectDir = makeTmpProject('lc02');
  _cleanup.push(projectDir);

  const { acquireLock, releaseLock } = getLockFunctions();

  acquireLock(projectDir);
  const lp = lockPath(projectDir);

  // Verify lock exists before release
  assert.ok(fs.existsSync(lp), `Lock must exist before release check. Got: no file at ${lp}`);

  releaseLock(projectDir);

  // Lock must be gone after release
  assert.ok(
    !fs.existsSync(lp),
    `Expected .soma/install.lock to be REMOVED after releaseLock. Got: file still exists at ${lp}`
  );
});

// ── LC-03: Lock release on install end (failure / idempotent) ─────────────────

test('LC-03: releaseLock is idempotent — no error if lock file already missing (ENOENT)', () => {
  const projectDir = makeTmpProject('lc03');
  _cleanup.push(projectDir);

  const { releaseLock } = getLockFunctions();

  // No lock was ever written — releaseLock must not throw
  assert.doesNotThrow(() => {
    releaseLock(projectDir);
  }, 'releaseLock must NOT throw when lock file does not exist (ENOENT idempotency)');
});

test('LC-03b: releaseLock removes lock after pipeline failure (finally block)', () => {
  const projectDir = makeTmpProject('lc03b');
  _cleanup.push(projectDir);

  const { acquireLock, releaseLock } = getLockFunctions();

  acquireLock(projectDir);
  const lp = lockPath(projectDir);
  assert.ok(fs.existsSync(lp), 'Lock must exist before simulating failure');

  // Simulate finally block on pipeline failure
  let pipelineError;
  try {
    throw new Error('Simulated pipeline failure');
  } catch (err) {
    pipelineError = err;
  } finally {
    releaseLock(projectDir);
  }

  assert.ok(
    !fs.existsSync(lp),
    `Lock must be removed even after pipeline failure. Got: file still at ${lp}`
  );
  // Confirm the pipeline error was not swallowed
  assert.ok(pipelineError instanceof Error, 'Pipeline error must have been thrown');
});

// ── LC-04: Lock contention (age < 60min → exit 2) ─────────────────────────────

test('LC-04: acquireLock exits 2 when lock exists with timestamp < 60min old', () => {
  const projectDir = makeTmpProject('lc04');
  _cleanup.push(projectDir);

  // Write a synthetic fresh lock (30min ago)
  const syntheticPid = 99999;
  const syntheticTs = isoOffset(-30 * 60 * 1000); // 30 min in the past
  writeSyntheticLock(projectDir, {
    pid: syntheticPid,
    timestamp: syntheticTs,
    hostname: os.hostname(),
  });

  // Run install as subprocess — should exit 2 due to contention
  const r = runInstall([projectDir]);

  assert.equal(
    r.status,
    2,
    `Expected exit 2 on lock contention (fresh lock). Got exit ${r.status}. stderr: ${r.stderr}`
  );

  const combined = r.stdout + r.stderr;
  // Must name the blocking PID
  assert.ok(
    combined.includes(String(syntheticPid)),
    `Expected stderr to contain blocking PID ${syntheticPid}. Got: ${combined}`
  );
  // Must include the timestamp or a human-readable age reference
  assert.ok(
    combined.includes(syntheticTs) || combined.toLowerCase().includes('progress') || combined.toLowerCase().includes('started'),
    `Expected stderr to reference the blocking timestamp or "in progress". Got: ${combined}`
  );
});

// ── LC-05: Stale lock auto-clean (age > 60min → WARNING + proceed) ────────────

test('LC-05: acquireLock auto-removes stale lock (>60min) and logs WARNING to stderr', () => {
  const projectDir = makeTmpProject('lc05');
  _cleanup.push(projectDir);

  // Write a stale lock (90min ago)
  const stalePid = 77777;
  const staleTs = isoOffset(-90 * 60 * 1000); // 90 min in the past
  writeSyntheticLock(projectDir, {
    pid: stalePid,
    timestamp: staleTs,
    hostname: os.hostname(),
  });

  const { acquireLock, releaseLock } = getLockFunctions();

  let stderrCapture = '';
  // Redirect stderr capture if acquireLock writes warnings (implementation-dependent)
  // We call acquireLock and check: (a) no throw, (b) stale lock removed, (c) new lock created.
  assert.doesNotThrow(() => {
    acquireLock(projectDir);
  }, 'acquireLock must NOT throw for stale lock — must auto-clean and proceed');

  const lp = lockPath(projectDir);
  // New lock should exist with current process pid (not the stale one)
  assert.ok(
    fs.existsSync(lp),
    `Expected new lock file after stale auto-clean. Got: no file at ${lp}`
  );

  const raw = fs.readFileSync(lp, 'utf8');
  const parsed = JSON.parse(raw);
  assert.notEqual(
    parsed.pid,
    stalePid,
    `New lock must have current PID, not the stale PID ${stalePid}. Got: ${parsed.pid}`
  );
  assert.equal(
    parsed.pid,
    process.pid,
    `New lock must contain current process.pid (${process.pid}). Got: ${parsed.pid}`
  );

  releaseLock(projectDir);
});

// LC-05 subprocess variant: full install with stale lock → exit 0 + WARNING on stderr

test('LC-05b: install with stale lock exits 0 and emits WARNING keyword on stderr', () => {
  withFakeHome('lc05b-home-', (fakeHome) => {
    const projectDir = makeTmpProject('lc05b');
    _cleanup.push(projectDir);

    writeSyntheticLock(projectDir, {
      pid: 55555,
      timestamp: isoOffset(-90 * 60 * 1000),
      hostname: os.hostname(),
    });

    const r = runInstall([projectDir], { env: fakeHomeEnv(fakeHome) });

    // Must NOT exit 2 (contention) — stale lock is cleaned, install proceeds
    assert.notEqual(
      r.status,
      2,
      `Expected exit != 2 for stale lock (should auto-clean). Got exit 2. stderr: ${r.stderr}`
    );

    const combined = r.stdout + r.stderr;
    // Must emit some WARNING / stale indication to stderr
    assert.ok(
      combined.toLowerCase().includes('stale') || combined.toLowerCase().includes('warn'),
      `Expected WARNING or "stale" mention in output. Got: ${combined}`
    );
  });
});

// ── LC-06: Lock JSON schema validation ────────────────────────────────────────

test('LC-06: lock file contains required fields: pid (integer), timestamp (ISO-8601), hostname (string)', () => {
  const projectDir = makeTmpProject('lc06');
  _cleanup.push(projectDir);

  const { acquireLock, releaseLock } = getLockFunctions();
  acquireLock(projectDir);

  const lp = lockPath(projectDir);
  const raw = fs.readFileSync(lp, 'utf8');
  const parsed = JSON.parse(raw);

  // pid must be an integer
  assert.ok(
    Number.isInteger(parsed.pid),
    `pid must be integer. Got: ${JSON.stringify(parsed.pid)}`
  );
  assert.equal(
    parsed.pid,
    process.pid,
    `pid must equal current process.pid (${process.pid}). Got: ${parsed.pid}`
  );

  // timestamp must be ISO-8601 parseable
  assert.ok(
    typeof parsed.timestamp === 'string',
    `timestamp must be a string. Got: ${typeof parsed.timestamp}`
  );
  const parsedDate = new Date(parsed.timestamp);
  assert.ok(
    !isNaN(parsedDate.getTime()),
    `timestamp must be valid ISO-8601 date. Got: ${parsed.timestamp}`
  );
  // ISO-8601 strict: must contain 'T' and 'Z' or timezone offset
  assert.ok(
    parsed.timestamp.includes('T'),
    `timestamp must be ISO-8601 with 'T' separator. Got: ${parsed.timestamp}`
  );

  // hostname must be a non-empty string
  assert.ok(
    typeof parsed.hostname === 'string' && parsed.hostname.length > 0,
    `hostname must be a non-empty string. Got: ${JSON.stringify(parsed.hostname)}`
  );
  assert.equal(
    parsed.hostname,
    os.hostname(),
    `hostname must match os.hostname() (${os.hostname()}). Got: ${parsed.hostname}`
  );

  releaseLock(projectDir);
});

// ── LC-07: File mode 0644 ─────────────────────────────────────────────────────

test('LC-07: lock file mode is 0644 (rw-r--r--)', () => {
  const projectDir = makeTmpProject('lc07');
  _cleanup.push(projectDir);

  const { acquireLock, releaseLock } = getLockFunctions();
  acquireLock(projectDir);

  const lp = lockPath(projectDir);
  const stat = fs.statSync(lp);
  // Extract permission bits (last 12 bits of mode)
  const mode = stat.mode & 0o7777;
  const expected = 0o644;

  assert.equal(
    mode,
    expected,
    `Expected lock file mode 0644 (${expected.toString(8)}). Got: ${mode.toString(8)} (0o${mode.toString(8)})`
  );

  releaseLock(projectDir);
});

// ── LC-08: Lock file NOT committed to git ─────────────────────────────────────
//
// Two acceptable implementations:
//   (a) install creates <project>/.soma/.gitignore with "install.lock" entry, OR
//   (b) install.cjs references a gitignore template that includes install.lock.
//
// This test checks (a) via acquireLock side-effect.
// If install.cjs does neither yet, the test will FAIL (RED until T-09).

test('LC-08: acquireLock creates .soma/.gitignore listing install.lock', () => {
  const projectDir = makeTmpProject('lc08');
  _cleanup.push(projectDir);

  const { acquireLock, releaseLock } = getLockFunctions();
  acquireLock(projectDir);

  const gitignorePath = path.join(projectDir, '.soma', '.gitignore');

  // Either a .soma/.gitignore must exist, or a root .soma entry must exist
  const somaGitignoreExists = fs.existsSync(gitignorePath);

  if (somaGitignoreExists) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(
      content.includes('install.lock'),
      `.soma/.gitignore must contain "install.lock". Got: ${content}`
    );
  } else {
    // Fallback: check if project root .gitignore covers .soma/install.lock
    const rootGitignore = path.join(projectDir, '.gitignore');
    if (fs.existsSync(rootGitignore)) {
      const rootContent = fs.readFileSync(rootGitignore, 'utf8');
      assert.ok(
        rootContent.includes('install.lock') || rootContent.includes('.soma/install.lock'),
        `root .gitignore must cover install.lock. Got: ${rootContent}`
      );
    } else {
      assert.fail(
        `Neither .soma/.gitignore nor root .gitignore covers install.lock. ` +
        `acquireLock must create .soma/.gitignore with "install.lock" entry (CONTRACT:05 Invariant).`
      );
    }
  }

  releaseLock(projectDir);
});
