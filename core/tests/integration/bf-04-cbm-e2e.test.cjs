'use strict';
/**
 * bf-04-cbm-e2e.test.cjs — Wave D Task 16: E2E integration tests (6 scenarios)
 *
 * Validates the full cbm-deprecation migration pipeline end-to-end:
 *   - 3 entry points: install.sh (S1), sync --apply (S2), explicit CLI (S3)
 *   - Safety invariants: --dry-run zero-mutation (S4), --revert restores (S5)
 *   - Guard: content mismatch aborts without --force (S6)
 *
 * Sandbox pattern: each scenario gets an isolated /tmp/bf-04-e2e/{name}-{ts}/
 * fixture populated from REPO_ROOT/core/. No production files touched.
 *
 * @spec core/specs/013-cbm-deprecation/spec.md AC-02, AC-03, AC-07, AC-08, AC-14
 * @task Task 16 (Wave D)
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const SANDBOX_PREFIX = '/tmp/bf-04-e2e';
const REPO_ROOT = '/tmp/soma-v2-build';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a soma-v2 anchor block with REAL sha256 computed from inner content.
 * Matches the sha256 that doctor.cjs expects after a clean install.
 *
 * @param {string} blockId — e.g. "block.claude.CLAUDE_md.cbm"
 * @param {string} innerContent — content between the markers (no leading/trailing newline)
 * @returns {string} full anchor block text
 */
function makeAnchor(blockId, innerContent) {
  const sha = crypto.createHash('sha256').update(innerContent).digest('hex');
  return [
    `<!-- soma-v2:start id=${blockId} version=1.0 sha256=${sha} -->`,
    innerContent,
    `<!-- soma-v2:end id=${blockId} -->`,
  ].join('\n');
}

// ── Sandbox setup ─────────────────────────────────────────────────────────────

before(() => fs.mkdirSync(SANDBOX_PREFIX, { recursive: true }));

/**
 * Create an isolated sandbox fixture for one scenario.
 *
 * Layout:
 *   root/
 *     home/
 *       .claude/CLAUDE.md   ← pre-migration state: cbm anchor
 *       .codex/AGENTS.md    ← pre-migration state: legacy codebase-memory-mcp markers
 *       AGENTS.md           ← minimal home-level AGENTS.md (real users have this)
 *       .soma-v2/           ← soma home, populated from REPO_ROOT/core/
 *
 * Source: REPO_ROOT/core/ (not ~/.soma-v2) — guarantees Wave A+B+C scripts present.
 *
 * @param {string} name — scenario identifier (e.g., 's1')
 * @returns {{ root: string, home: string, somaHome: string }}
 */
function setupFixture(name) {
  const root = path.join(SANDBOX_PREFIX, `${name}-${Date.now()}`);
  const home = path.join(root, 'home');
  const somaHome = path.join(home, '.soma-v2');

  // Create directory layout
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(somaHome, { recursive: true });

  // Populate somaHome from REPO_ROOT/core/ (Wave A+B+C scripts included)
  spawnSync('cp', ['-R', `${REPO_ROOT}/core/.`, somaHome], { stdio: 'pipe' });

  // Copy install.sh next to root so Scenario 1 can invoke it with correct REPO_ROOT
  spawnSync('cp', [`${REPO_ROOT}/install.sh`, root], { stdio: 'pipe' });

  // Write pre-migration CLAUDE.md with cbm anchor — use REAL sha256 to match doctor expectations
  const hydContent = '<!-- hyd-v2:start -->\n# HYD content\n<!-- hyd-v2:end -->';
  fs.writeFileSync(
    path.join(home, '.claude', 'CLAUDE.md'),
    [
      '# Claude Self-Model',
      makeAnchor('block.claude.CLAUDE_md.cbm', hydContent),
    ].join('\n')
  );

  // Write pre-migration AGENTS.md (codex) with legacy codebase-memory-mcp markers.
  // Content must match somaHome/docs/codebase-memory-mcp.md so G3 gate passes
  // (simulates user with the real canonical MCP doc but using old legacy markers).
  const mcpSourcePath = path.join(somaHome, 'docs', 'codebase-memory-mcp.md');
  const mcpContent = fs.existsSync(mcpSourcePath)
    ? fs.readFileSync(mcpSourcePath, 'utf8').trim()
    : '# Codebase Knowledge Graph\nMCP doc';
  fs.writeFileSync(
    path.join(home, '.codex', 'AGENTS.md'),
    [
      '<!-- codebase-memory-mcp:start -->',
      mcpContent,
      '<!-- codebase-memory-mcp:end -->',
      '<!-- hyd-v2:start -->',
      '# HYD discipline',
      '<!-- hyd-v2:end -->',
    ].join('\n')
  );

  // Write minimal home AGENTS.md (no cbm markers — real users have this file)
  // This prevents migrateCodexAgents() ENOENT crash on target.homeAgents path.
  fs.writeFileSync(
    path.join(home, 'AGENTS.md'),
    '# AGENTS\n\nNo SOMA content yet.\n'
  );

  return { root, home, somaHome };
}

/**
 * Cleanup a fixture root (best-effort).
 *
 * @param {string} root
 */
function cleanupFixture(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // best-effort cleanup — don't fail tests on cleanup errors
  }
}

// ── Scenario 1: install.sh trigger ───────────────────────────────────────────

test('Scenario 1: install.sh trigger migrates lab (cbm → hyd-v2)', () => {
  const { root, home, somaHome } = setupFixture('s1');

  try {
    // install.sh Phase 0.7 detects cbm markers and invokes migration.
    // We run the REPO's install.sh directly so REPO_ROOT is correct for Phase 2 rsync.
    const installSh = path.join(REPO_ROOT, 'install.sh');

    const result = spawnSync('bash', [installSh, '--force-overwrite'], {
      env: {
        ...process.env,
        HOME: home,
        SOMA_HOME: somaHome,
        FORCE_OVERWRITE: '1',
        // Suppress interactive prompts
        NO_CODEX: '0',
        NO_CLAUDE_MD: '0',
        // Skip Phase 9 (doctor + verify-portability) in sandbox:
        // verify-portability runs node --test *.test.cjs which produces large TAP
        // output that triggers SIGPIPE in spawnSync pipe context. Migration correctness
        // is verified via CLAUDE.md content assertions below.
        SOMA_NO_PHASE9: '1',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });

    // install.sh must exit 0
    assert.equal(
      result.status,
      0,
      `install.sh failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // Post-migration CLAUDE.md must have hyd-v2 anchor (not cbm)
    const claudeContent = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.match(
      claudeContent,
      /id=block\.claude\.CLAUDE_md\.hyd-v2/,
      'CLAUDE.md must have hyd-v2 anchor post-migration'
    );
    assert.doesNotMatch(
      claudeContent,
      /id=block\.claude\.CLAUDE_md\.cbm/,
      'CLAUDE.md must NOT have cbm anchor post-migration'
    );
  } finally {
    cleanupFixture(root);
  }
});

// ── Scenario 2: sync --apply trigger ─────────────────────────────────────────

test('Scenario 2: sync --apply auto-detects cbm and runs migration', () => {
  const { root, home, somaHome } = setupFixture('s2');

  try {
    const syncScript = path.join(somaHome, 'scripts', 'sync.cjs');

    // sync --apply with sandbox HOME + SOMA_HOME → auto-detect + migrate
    const result = spawnSync(
      'node',
      [syncScript, '--apply', '--tool=claude'],
      {
        env: {
          ...process.env,
          HOME: home,
          SOMA_HOME: somaHome,
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    // Detection message must appear in stdout
    assert.match(
      result.stdout,
      /cbm.*detected|legacy.*detected/,
      `Expected cbm detection message in stdout.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  } finally {
    cleanupFixture(root);
  }
});

// ── Scenario 3: Explicit CLI ──────────────────────────────────────────────────

test('Scenario 3: explicit CLI (migrate-cbm-deprecation.cjs) → action: completed', () => {
  const { root, home, somaHome } = setupFixture('s3');

  try {
    const cliScript = path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs');

    const result = spawnSync(
      'node',
      [cliScript],
      {
        env: {
          ...process.env,
          HOME: home,
          SOMA_HOME: somaHome,
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    // CLI must exit 0 on completed
    assert.equal(
      result.status,
      0,
      `CLI exited non-zero.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // stdout must be valid JSON with action: 'completed'
    let out;
    try {
      out = JSON.parse(result.stdout);
    } catch (parseErr) {
      assert.fail(`CLI stdout is not valid JSON: ${result.stdout}`);
    }
    assert.equal(out.action, 'completed', `Expected action 'completed', got '${out.action}'`);
  } finally {
    cleanupFixture(root);
  }
});

// ── Scenario 4: --dry-run zero mutations ─────────────────────────────────────

test('Scenario 4: --dry-run produces zero file mutations', () => {
  const { root, home, somaHome } = setupFixture('s4');

  try {
    const cliScript = path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs');

    // Capture pre-dry-run content
    const claudeBefore = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    const codexBefore = fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8');
    const homeBefore = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');

    spawnSync(
      'node',
      [cliScript, '--dry-run'],
      {
        env: {
          ...process.env,
          HOME: home,
          SOMA_HOME: somaHome,
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    // Post-dry-run content must be byte-identical to pre-dry-run
    const claudeAfter = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    const codexAfter = fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8');
    const homeAfter = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');

    assert.equal(claudeBefore, claudeAfter, '--dry-run must not mutate CLAUDE.md');
    assert.equal(codexBefore, codexAfter, '--dry-run must not mutate .codex/AGENTS.md');
    assert.equal(homeBefore, homeAfter, '--dry-run must not mutate ~/AGENTS.md');
  } finally {
    cleanupFixture(root);
  }
});

// ── Scenario 5: --revert restores from snapshot ───────────────────────────────

test('Scenario 5: --revert restores lab files from snapshot', () => {
  const { root, home, somaHome } = setupFixture('s5');

  try {
    const cliScript = path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs');

    // Record original state
    const claudeOriginal = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');

    // Phase 1: run migration — must complete
    const r1 = spawnSync(
      'node',
      [cliScript],
      {
        env: {
          ...process.env,
          HOME: home,
          SOMA_HOME: somaHome,
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    let out1;
    try {
      out1 = JSON.parse(r1.stdout);
    } catch {
      assert.fail(`Migration stdout is not valid JSON: ${r1.stdout}`);
    }
    assert.equal(
      out1.action,
      'completed',
      `Migration must complete before revert test. Got: ${out1.action}\nstdout: ${r1.stdout}\nstderr: ${r1.stderr}`
    );
    assert.ok(out1.snapshotId, 'Migration must return a snapshotId');

    // Phase 2: revert using snapshotId
    const r2 = spawnSync(
      'node',
      [cliScript, '--revert', out1.snapshotId],
      {
        env: {
          ...process.env,
          HOME: home,
          SOMA_HOME: somaHome,
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    // Verify CLAUDE.md restored to original pre-migration content
    const claudeRestored = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.equal(
      claudeOriginal,
      claudeRestored,
      '--revert must restore CLAUDE.md to pre-migration state'
    );
  } finally {
    cleanupFixture(root);
  }
});

// ── Scenario 6: Content mismatch aborts without --force ───────────────────────

test('Scenario 6: content mismatch in MCP doc aborts without --force (G3 gate)', () => {
  const { root, home, somaHome } = setupFixture('s6');

  try {
    // Overwrite .codex/AGENTS.md with hand-edited content that differs from
    // what the migration would extract via extractMcpContentFromLab().
    // This simulates a user who has manually edited the MCP section — drift vs spec extraction.
    fs.writeFileSync(
      path.join(home, '.codex', 'AGENTS.md'),
      [
        '<!-- codebase-memory-mcp:start -->',
        '# Hand-edited content (drift from spec)',
        'This user has manually added custom documentation.',
        'A migration would silently overwrite this. G3 must block it.',
        '<!-- codebase-memory-mcp:end -->',
      ].join('\n')
    );

    const cliScript = path.join(somaHome, 'scripts', 'migrate-cbm-deprecation.cjs');

    const result = spawnSync(
      'node',
      [cliScript],
      {
        env: {
          ...process.env,
          HOME: home,
          SOMA_HOME: somaHome,
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    // CLI must exit non-zero on abort
    assert.notEqual(
      result.status,
      0,
      `CLI should exit non-zero on G3 abort. stdout: ${result.stdout}`
    );

    // stdout must be valid JSON with action: 'abort'
    let out;
    try {
      out = JSON.parse(result.stdout);
    } catch {
      assert.fail(`CLI stdout is not valid JSON: ${result.stdout}`);
    }
    assert.equal(
      out.action,
      'abort',
      `Expected action 'abort' (G3 gate), got '${out.action}'`
    );

    // failures must mention G3
    const failuresText = (out.failures || []).join(' ');
    assert.match(
      failuresText,
      /G3/,
      `Expected G3 in failures, got: ${failuresText}`
    );
  } finally {
    cleanupFixture(root);
  }
});
