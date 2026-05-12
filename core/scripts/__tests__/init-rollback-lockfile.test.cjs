/**
 * init-rollback-lockfile.test.cjs — C-fu-3
 * init.cjs --rollback must remove both .soma/ AND .soma.lock at project root.
 * Orphan .soma.lock after aborted init is a UX pain point.
 *
 * @spec C-fu-3
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkFixture(prefix = 'soma-rollback-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runInit(args = [], cwd = undefined) {
  return spawnSync('node', [INIT, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function cleanup(dir) {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Create a project with both .soma/ dir AND .soma.lock file (simulating aborted init).
 */
function makeAbortedInitProject() {
  const dir = mkFixture('soma-aborted-init');

  // .soma/ directory with some content (simulated partial init)
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), '# partial project\n', 'utf8');

  // .soma.lock file (left behind by soma-run)
  const lockContent = JSON.stringify({
    sessionId: 'sid-test-rollback',
    runId: 'run-test-rollback',
    startedAt: new Date().toISOString(),
  }, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, '.soma.lock'), lockContent, 'utf8');

  return dir;
}

// ── C-fu-3 tests ─────────────────────────────────────────────────────────────

test('C-fu-3: init --rollback removes .soma/ directory', () => {
  const project = makeAbortedInitProject();

  try {
    const somaDir = path.join(project, '.soma');
    assert.ok(fs.existsSync(somaDir), 'Precondition: .soma/ must exist before rollback');

    const result = runInit(['--rollback', '--json', project]);
    assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);

    assert.ok(
      !fs.existsSync(somaDir),
      `.soma/ must be removed by --rollback. Still exists at: ${somaDir}`
    );
  } finally {
    cleanup(project);
  }
});

test('C-fu-3: init --rollback removes .soma.lock alongside .soma/', () => {
  const project = makeAbortedInitProject();

  try {
    const lockFile = path.join(project, '.soma.lock');
    assert.ok(fs.existsSync(lockFile), 'Precondition: .soma.lock must exist before rollback');

    const result = runInit(['--rollback', '--json', project]);
    assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);

    assert.ok(
      !fs.existsSync(lockFile),
      `.soma.lock must be removed by --rollback. Still exists at: ${lockFile}`
    );
  } finally {
    cleanup(project);
  }
});

test('C-fu-3: init --rollback is idempotent — re-run on clean project returns 0 (no errors)', () => {
  const project = mkFixture('soma-rollback-clean');

  try {
    // Project has NO .soma/ and NO .soma.lock — already clean state
    assert.ok(!fs.existsSync(path.join(project, '.soma')), 'Precondition: no .soma/ dir');
    assert.ok(!fs.existsSync(path.join(project, '.soma.lock')), 'Precondition: no .soma.lock');

    const result = runInit(['--rollback', '--json', project]);
    assert.equal(result.status, 0,
      `Expected exit 0 on idempotent rollback (nothing to clean). stderr: ${result.stderr}`
    );
  } finally {
    cleanup(project);
  }
});

test('C-fu-3: init --rollback with only .soma.lock (no .soma/) — removes lock, exits 0', () => {
  const project = mkFixture('soma-rollback-lockonly');

  try {
    // Only .soma.lock present, no .soma/ dir
    fs.writeFileSync(path.join(project, '.soma.lock'), '{"sessionId":"sid-orphan"}\n', 'utf8');
    assert.ok(!fs.existsSync(path.join(project, '.soma')), 'Precondition: no .soma/ dir');

    const result = runInit(['--rollback', '--json', project]);
    assert.equal(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
    assert.ok(
      !fs.existsSync(path.join(project, '.soma.lock')),
      '.soma.lock must be removed even without .soma/ dir'
    );
  } finally {
    cleanup(project);
  }
});
