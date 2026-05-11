'use strict';
/**
 * install-e2e.test.cjs — T-33 full lifecycle E2E composite test
 *
 * Article II HARD: RED commit first, then GREEN calibration.
 * Article III HARD: real fs / real child_process, no mocks.
 *
 * Exercises AC-01 through AC-09 in a single lifecycle sequence:
 *   T-33-S1: Greenfield install → block injected, exit 0             (AC-01)
 *   T-33-S2: Idempotent re-run → exit 0, no duplicate, "no changes"  (AC-02)
 *   T-33-S3: Drift detection → exit 2, force-resync hint, state=drift-detected (AC-03)
 *   T-33-S4: --merge-claude-md with hydra fixture → exit 0, original preserved + appended (AC-07)
 *   T-33-S5: Full lifecycle .soma/ artifacts intact (AC-16 composite)
 *
 * Integration sanity: catches regressions where individual AC tests pass
 * but the pipeline state-machine hands off incorrectly between stages.
 *
 * @spec AC-01 + AC-02 + AC-03 + AC-07 — full lifecycle composite
 * @task T-33
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// ── Paths ──────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'install.cjs');
const HYDRA_FIXTURE = path.join(REPO_ROOT, 'core', 'scripts', '__tests__', 'fixtures', 'hydra-like-claude.md');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Create a fresh tmp dir with given prefix.
 * @param {string} prefix
 * @returns {string} absolute path
 */
function freshTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

/**
 * Run install.cjs with given args and cwd.
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function runInstall(args, cwd) {
  return spawnSync('node', [INSTALL_CJS, ...args], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf8',
    timeout: 60000,
  });
}

// ── T-33-S1: Greenfield install (AC-01) ───────────────────────────────────────

test('T-33-S1: AC-01 greenfield install in fresh tmpdir → block injected, exit 0', () => {
  const d = freshTmpDir('soma-test-fresh');
  try {
    const result = runInstall([d, '--tool=claude'], d);
    assert.equal(
      result.status, 0,
      `Expected exit 0 for greenfield install. Got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // .soma/ must exist
    assert.ok(
      fs.existsSync(path.join(d, '.soma')),
      `.soma/ directory must be created by greenfield install. Not found at ${path.join(d, '.soma')}`
    );

    // CLAUDE.md must exist with exactly one soma-v2:start anchor
    const claudeMdPath = path.join(d, 'CLAUDE.md');
    assert.ok(
      fs.existsSync(claudeMdPath),
      `CLAUDE.md must be created by install (T-08bis project-bootloader). Not found at ${claudeMdPath}`
    );

    const claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
    const matches = claudeMd.match(/<!-- soma-v2:start/g) || [];
    assert.equal(
      matches.length, 1,
      `Exactly one soma-v2:start anchor expected. Got ${matches.length}.\nContent (first 400): ${claudeMd.slice(0, 400)}`
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ── T-33-S2: Idempotent re-run (AC-02) ────────────────────────────────────────

test('T-33-S2: AC-02 idempotent re-run → exit 0, no duplicate block, "no changes"', () => {
  const d = freshTmpDir('soma-test-idemp');
  try {
    // First install
    const first = runInstall([d, '--tool=claude'], d);
    assert.equal(
      first.status, 0,
      `First install must exit 0. Got ${first.status}.\nstderr: ${first.stderr}`
    );

    // Second install — idempotent
    const second = runInstall([d, '--tool=claude'], d);
    assert.equal(
      second.status, 0,
      `Idempotent re-run must exit 0. Got ${second.status}.\nstdout: ${second.stdout}\nstderr: ${second.stderr}`
    );

    // "no changes" must appear in stdout
    assert.match(
      second.stdout,
      /no changes/i,
      `Idempotent re-run stdout must contain "no changes". Got: ${second.stdout}`
    );

    // Still exactly one anchor (no duplication)
    const claudeMd = fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');
    const matches = claudeMd.match(/<!-- soma-v2:start/g) || [];
    assert.equal(
      matches.length, 1,
      `Idempotent re-run must NOT duplicate anchor. Got ${matches.length} anchors.\nContent (first 400): ${claudeMd.slice(0, 400)}`
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ── T-33-S3: Drift detection (AC-03) ──────────────────────────────────────────

test('T-33-S3: AC-03 drift detection → exit 2, force-resync/soma rollback hint, state=drift-detected', () => {
  const d = freshTmpDir('soma-test-drift');
  try {
    // Install first so state=complete and block has sha256
    const first = runInstall([d, '--tool=claude'], d);
    assert.equal(
      first.status, 0,
      `First install must exit 0 before drift test. Got ${first.status}.\nstderr: ${first.stderr}`
    );

    const claudeMdPath = path.join(d, 'CLAUDE.md');
    const original = fs.readFileSync(claudeMdPath, 'utf8');

    // Mutate INSIDE the anchored block (between start and end markers)
    // This will cause sha256 mismatch → drift detected.
    // Find the start marker and inject text immediately after it.
    const mutated = original.replace(
      /(<!-- soma-v2:start[^\n]*\n)/,
      '$1\n# DRIFT_MARKER_INJECTED_BY_T33_S3\n'
    );

    // Verify the mutation actually changed the content (guard against regex miss)
    assert.notEqual(
      mutated, original,
      'Mutation must change CLAUDE.md content. Check regex pattern for soma-v2:start marker.'
    );

    fs.writeFileSync(claudeMdPath, mutated);

    // Re-run install — must detect drift
    const second = runInstall([d, '--tool=claude'], d);
    assert.equal(
      second.status, 2,
      `Drift-detected install must exit 2. Got ${second.status}.\nstdout: ${second.stdout}\nstderr: ${second.stderr}`
    );

    // stderr must contain force-resync or soma rollback hint (AC-03)
    const combined = second.stdout + second.stderr;
    assert.ok(
      combined.includes('force-resync') || combined.includes('soma rollback'),
      `AC-03: output must contain "force-resync" or "soma rollback" hint. Got:\nstdout: ${second.stdout}\nstderr: ${second.stderr}`
    );

    // install-state.json must have status=drift-detected
    const stateFile = path.join(d, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFile),
      `install-state.json must exist after drift-detected. Not found at ${stateFile}`
    );

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(
      state.status, 'drift-detected',
      `install-state.json status must be "drift-detected". Got: "${state.status}"`
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ── T-33-S4: --merge-claude-md with hydra fixture (AC-07) ─────────────────────

test('T-33-S4: AC-07 --merge-claude-md with hydra fixture → exit 0, original preserved + appended', () => {
  const d = freshTmpDir('soma-test-merge');
  try {
    // Seed CLAUDE.md with the hydra-like free-text fixture
    const original = fs.readFileSync(HYDRA_FIXTURE, 'utf8');
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), original);

    // Install with --merge-claude-md: must preserve original + append anchor
    const result = runInstall([d, '--tool=claude', '--merge-claude-md'], d);
    assert.equal(
      result.status, 0,
      `--merge-claude-md install must exit 0. Got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    const post = fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');

    // Original content must be preserved (trim to handle trailing newline differences)
    assert.ok(
      post.includes(original.trim()),
      `Original hydra content must be preserved in CLAUDE.md after --merge-claude-md.\nPost content (first 600): ${post.slice(0, 600)}`
    );

    // Anchored block must be appended
    assert.match(
      post,
      /<!-- soma-v2:start/,
      `Anchored soma-v2 block must be appended after --merge-claude-md. Post content (first 600): ${post.slice(0, 600)}`
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ── T-33-S5: Full lifecycle .soma/ artifacts intact ──────────────────────────

test('T-33-S5: full lifecycle .soma/ artifacts intact (AC-16 composite)', () => {
  const d = freshTmpDir('soma-test-lifecycle');
  try {
    const result = runInstall([d, '--tool=claude'], d);
    assert.equal(
      result.status, 0,
      `Full lifecycle install must exit 0. Got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // install-state.json must exist and be valid JSON
    const stateFile = path.join(d, '.soma', 'install-state.json');
    assert.ok(
      fs.existsSync(stateFile),
      `install-state.json must exist after successful install. Not found at ${stateFile}`
    );

    let state;
    assert.doesNotThrow(() => {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }, `install-state.json must be valid JSON`);

    // status must be "complete"
    assert.equal(
      state.status, 'complete',
      `install-state.json status must be "complete" for successful install. Got: "${state.status}"`
    );

    // snapshotId must be ISO-8601 UTC
    const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    assert.ok(
      typeof state.snapshotId === 'string' && ISO_UTC_RE.test(state.snapshotId),
      `snapshotId must be ISO-8601 UTC (Z suffix). Got: "${state.snapshotId}"`
    );

    // installedVersion must match semver prefix
    assert.match(
      state.installedVersion,
      /^\d+\.\d+\.\d+/,
      `installedVersion must match semver N.N.N prefix. Got: "${state.installedVersion}"`
    );

    // harness must be a valid enum value
    assert.ok(
      ['claude', 'codex', 'both'].includes(state.harness),
      `harness must be one of claude|codex|both. Got: "${state.harness}"`
    );

    // .soma/manifest.json must exist
    assert.ok(
      fs.existsSync(path.join(d, '.soma', 'manifest.json')),
      `.soma/manifest.json must exist after lifecycle install. Not found.`
    );

    // install.lock must NOT remain (released in finally block)
    assert.ok(
      !fs.existsSync(path.join(d, '.soma', 'install.lock')),
      `install.lock must be released (not present) after successful install.`
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
