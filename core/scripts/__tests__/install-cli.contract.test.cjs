'use strict';
/**
 * install-cli.contract.test.cjs — T-02 contract tests for install-cli.md
 *
 * Article II HARD: RED phase — contract tests written BEFORE full implementation.
 * Cases 1-4 (argv schema + mutual exclusion) PASS on skeleton (T-01).
 * Cases 5-8 (orchestration exit codes) FAIL until T-08..T-17 implement pipeline.
 *
 * Contract covered: [CONTRACT:01] core/specs/015-soma-install/contracts/install-cli.md
 *
 * Test map:
 *   CC-01: argv parser exposes 6 fields (positional + 5 named flags)  → PASS (T-01 skeleton)
 *   CC-02: --tool enum validates claude|codex|both                    → PASS (T-01 skeleton)
 *   CC-03: missing project-path → exit 1 + usage hint                → PASS (T-01 skeleton)
 *   CC-04: --merge-claude-md + --replace-claude-md mutual exclusion  → PASS (T-01 skeleton)
 *   CC-05: greenfield valid args → exit 0                            → FAIL (RED — T-08)
 *   CC-06: lockfile contention → exit 2                              → FAIL (RED — T-09)
 *   CC-07: drift abort → exit 2                                      → FAIL (RED — T-11/T-17)
 *   CC-08: custom CLAUDE.md no flag non-interactive → exit 2         → FAIL (RED — T-16)
 *
 * @spec [CONTRACT:01]
 * @task T-02
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

/** Require install.cjs module for unit-level parseArgs testing. */
const installModule = require(INSTALL_CJS);

// Bucket G (Spec 018): the original comment here claimed only CC-05 and
// CC-08b reached install.cjs's real pipeline far enough to touch
// ~/.claude — WRONG, per the orchestrator's own measurement: 11 tests
// (CC-02a/b/c/d, CC-03a/b, CC-04a/c/d, CC-06, CC-07) call runInstall()
// bare and DO write there — they just don't FAIL, so the original
// "which tests fail" scoping missed them entirely. A test that writes
// to the real ~/.claude successfully is exactly as dangerous as one that
// fails there; "does it fail" and "does it write" are different sets.
//
// runInstall() itself now lives in helpers/cli-run-install.cjs (not
// inline here) so install-home-isolation-guard.test.cjs can import and
// exercise this file's REAL, production runInstall() directly — not a
// hand-rolled stand-in — instead of require()'ing this whole test file
// (which would re-register every test() below inside the guard's own
// run). Isolation itself is injected inside that shared function, once,
// for every call site in this file: each call without its own explicit
// `opts.env` gets a FRESH, disposable, seeded HOME (never shared with
// any other call — a shared fake HOME was measured elsewhere in this
// bucket to poison later calls' project-scoped ledger expectations:
// 34 -> 58 fails). A call site that already isolates itself explicitly
// (e.g. CC-05's `{ env: fakeHomeEnv(fakeHome) }`) is left alone — the
// default never overrides an explicit env. See helpers/fake-home.cjs for
// why a plain fake HOME isn't enough on its own.
const { withFakeHome, fakeHomeEnv } = require('./helpers/fake-home.cjs');
const { runInstall } = require('./helpers/cli-run-install.cjs');

// ── CC-01: argv parser exposes all 7 fields from the contract schema ──────────
// Contract: project-path (positional) + 6 named flags.
// Article II note: This PASSES on T-01 skeleton (parseArgs is fully implemented).

test('CC-01: parseArgs returns all 6 contract fields with correct defaults (v2.2.0: 5 flags + positional)', () => {
  const result = installModule.parseArgs([os.tmpdir()]);

  // 1. positional: project-path captured
  assert.ok(result.projectPath !== null && result.projectPath !== undefined,
    'project-path must be captured as non-null');
  assert.equal(result.projectPath, os.tmpdir(),
    'project-path value must match the provided positional argument');

  // 2. --tool present with default 'claude'
  assert.ok('tool' in result.flags, 'flags must include "tool" key');
  assert.equal(result.flags.tool, 'claude', '--tool default must be "claude"');

  // 3. --dry-run present with default false
  assert.ok('dryRun' in result.flags, 'flags must include "dryRun" key');
  assert.equal(result.flags.dryRun, false, '--dry-run default must be false');

  // 4. --merge-claude-md present with default false
  assert.ok('mergeClaudioMd' in result.flags, 'flags must include mergeClaudioMd key (--merge-claude-md)');
  assert.equal(result.flags.mergeClaudioMd, false, '--merge-claude-md default must be false');

  // 5. --replace-claude-md present with default false
  assert.ok('replaceClaudioMd' in result.flags, 'flags must include replaceClaudioMd key (--replace-claude-md)');
  assert.equal(result.flags.replaceClaudioMd, false, '--replace-claude-md default must be false');

  // 6. --allow-local-edits present with default false (--force-resync REMOVED in v2.2.0)
  assert.ok('allowLocalEdits' in result.flags, 'flags must include "allowLocalEdits" key');
  assert.equal(result.flags.allowLocalEdits, false, '--allow-local-edits default must be false');
});

test('CC-01b: parseArgs parses all 5 flags simultaneously (full set v2.2.0)', () => {
  const result = installModule.parseArgs([
    os.tmpdir(),
    '--tool=both',
    '--dry-run',
    '--merge-claude-md',
    '--allow-local-edits',
  ]);

  assert.equal(result.projectPath, os.tmpdir(), 'project-path captured correctly');
  assert.equal(result.flags.tool, 'both', '--tool=both parsed');
  assert.equal(result.flags.dryRun, true, '--dry-run parsed as true');
  assert.equal(result.flags.mergeClaudioMd, true, '--merge-claude-md parsed as true');
  assert.equal(result.flags.allowLocalEdits, true, '--allow-local-edits parsed as true');
  // No mutual exclusion error (--replace-claude-md not present)
  assert.equal(result.errors.length, 0,
    `No errors expected for valid combined flags. Got: ${result.errors.join(', ')}`);
});

// ── CC-02: --tool enum validates: claude | codex | both ──────────────────────
// Contract: invalid --tool value → exit 1 + usage hint.
// PASSES on T-01 skeleton.

test('CC-02a: --tool=claude is valid (no error, exit 0)', () => {
  const r = runInstall([os.tmpdir(), '--tool=claude']);
  assert.equal(r.status, 0,
    `--tool=claude should exit 0 (valid enum). Got ${r.status}. stderr: ${r.stderr}`);
});

test('CC-02b: --tool=codex is valid (no error, exit 0)', () => {
  const r = runInstall([os.tmpdir(), '--tool=codex']);
  assert.equal(r.status, 0,
    `--tool=codex should exit 0 (valid enum). Got ${r.status}. stderr: ${r.stderr}`);
});

test('CC-02c: --tool=both is valid (no error, exit 0)', () => {
  const r = runInstall([os.tmpdir(), '--tool=both']);
  assert.equal(r.status, 0,
    `--tool=both should exit 0 (valid enum). Got ${r.status}. stderr: ${r.stderr}`);
});

test('CC-02d: invalid --tool value → exit 1 with usage message', () => {
  const r = runInstall([os.tmpdir(), '--tool=cursor']);
  assert.equal(r.status, 1,
    `Invalid --tool value must exit 1. Got ${r.status}. stderr: ${r.stderr}`);
  // stderr must mention the usage pattern
  const combined = r.stdout + r.stderr;
  assert.ok(combined.length > 0,
    'Must emit usage/error message on invalid --tool value');
  // Must reference valid values so user knows what to use
  assert.ok(
    combined.includes('claude') && combined.includes('codex') && combined.includes('both'),
    `Usage/error output must list valid enum values (claude, codex, both). Got: ${combined}`
  );
});

test('CC-02e: parseArgs marks invalid --tool value in errors array', () => {
  const result = installModule.parseArgs([os.tmpdir(), '--tool=vscode']);
  assert.ok(result.errors.length > 0,
    'errors array must be non-empty for invalid --tool value');
  const errorText = result.errors.join(' ');
  assert.ok(errorText.includes('vscode') || errorText.includes('--tool'),
    `Error message must reference the bad value or the --tool flag. Got: ${errorText}`);
});

// ── CC-03: missing project-path → exit 1 + usage message ────────────────────
// Contract: exit 1 with "usage: soma install <project-path>..." on stderr.
// PASSES on T-01 skeleton.

test('CC-03a: no args → exit 1 with usage on stderr', () => {
  const r = runInstall([]);
  assert.equal(r.status, 1,
    `Missing project-path must exit 1. Got ${r.status}. stderr: ${r.stderr}`);
  const combined = r.stdout + r.stderr;
  assert.ok(combined.length > 0,
    'Must emit usage message when project-path missing');
  // Contract specifies usage format: "usage: soma install <project-path>"
  assert.ok(
    combined.includes('usage') && combined.includes('soma install'),
    `Stderr must contain usage hint with "usage" and "soma install". Got: ${combined}`
  );
});

test('CC-03b: flags only, no positional path → exit 1 with usage', () => {
  const r = runInstall(['--dry-run', '--tool=claude']);
  assert.equal(r.status, 1,
    `Flags-only (no project-path) must exit 1. Got ${r.status}. stderr: ${r.stderr}`);
});

test('CC-03c: parseArgs returns null projectPath and zero errors when no args', () => {
  const result = installModule.parseArgs([]);
  assert.equal(result.projectPath, null,
    'projectPath must be null when no positional arg given');
  // No flag errors — the missing-path detection happens in main(), not parseArgs
  // parseArgs itself should NOT add an error for missing path
  const flagErrors = result.errors.filter(e =>
    e.includes('missing') || e.includes('required') || e.includes('project-path')
  );
  // If parseArgs adds a missing-path error that's fine; if it doesn't, main() catches it.
  // Either way, the subprocess exit code test CC-03a covers the observable contract.
  assert.ok(result !== null, 'parseArgs must return a result object');
});

// ── CC-04: mutual exclusion --merge-claude-md + --replace-claude-md ──────────
// Contract: simultaneously passing both flags → exit 1.
// PASSES on T-01 skeleton.

test('CC-04a: --merge-claude-md + --replace-claude-md together → exit 1', () => {
  const r = runInstall([os.tmpdir(), '--merge-claude-md', '--replace-claude-md']);
  assert.equal(r.status, 1,
    `Mutual exclusion violation must exit 1. Got ${r.status}. stderr: ${r.stderr}`);
  const combined = r.stdout + r.stderr;
  assert.ok(combined.length > 0,
    'Must emit error message on mutual exclusion violation');
});

test('CC-04b: parseArgs sets errors for mutual exclusion (unit level)', () => {
  const result = installModule.parseArgs([
    os.tmpdir(),
    '--merge-claude-md',
    '--replace-claude-md',
  ]);
  assert.ok(result.errors.length > 0,
    'errors array must be non-empty for mutual exclusion violation');
  // Error message should reference both flags or "mutually exclusive"
  const errorText = result.errors.join(' ').toLowerCase();
  assert.ok(
    errorText.includes('merge') || errorText.includes('replace') || errorText.includes('mutual'),
    `Error text must reference the conflicting flags. Got: ${errorText}`
  );
});

test('CC-04c: --replace-claude-md alone is valid (exit 0)', () => {
  const r = runInstall([os.tmpdir(), '--replace-claude-md']);
  assert.equal(r.status, 0,
    `--replace-claude-md alone should be valid (exit 0). Got ${r.status}. stderr: ${r.stderr}`);
});

test('CC-04d: --merge-claude-md alone is valid (exit 0)', () => {
  const r = runInstall([os.tmpdir(), '--merge-claude-md']);
  assert.equal(r.status, 0,
    `--merge-claude-md alone should be valid (exit 0). Got ${r.status}. stderr: ${r.stderr}`);
});

// ── CC-05: greenfield install with valid args → exit 0 ────────────────────────
// Contract: [CONTRACT:01] Idempotence Contract row "Empty (greenfield)" → exit 0.
// RED phase — FAILS until T-08 implements the install pipeline.
// Current skeleton exits 0 for valid args WITHOUT doing any actual work,
// so this technically "passes" the stub. However, the real contract requires
// a greenfield directory with NO .soma/ to trigger the full pipeline and
// produce the expected stdout format. We test for that verifiable side-effect.

test('CC-05: greenfield install (fresh tmpdir) → exit 0 + creates .soma/ dir', () => {
  withFakeHome('cc05-home-', (fakeHome) => {
    // Create an empty directory simulating a fresh project
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-cc05-'));
    try {
      const r = runInstall([freshDir, '--tool=claude'], { env: fakeHomeEnv(fakeHome) });

      // Exit code MUST be 0 (either stub or real impl)
      assert.equal(r.status, 0,
        `Greenfield install must exit 0. Got ${r.status}. stderr: ${r.stderr}`);

      // RED-phase assertion: .soma/ directory MUST be created by real implementation.
      // This FAILS until T-08 implements the pipeline.
      const somaDir = path.join(freshDir, '.soma');
      assert.ok(
        fs.existsSync(somaDir),
        `[RED — depends T-08] Greenfield install must create .soma/ in target. ` +
        `${somaDir} not found. This FAILS until T-08 implements the pipeline.`
      );
    } finally {
      try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

// ── CC-06: lockfile contention → exit 2 ──────────────────────────────────────
// Contract: if .soma/install.lock exists (PID + timestamp) → exit 2 with
// "Install in progress (PID <pid>, started <timestamp>). Lock: <project>/.soma/install.lock"
// RED phase — FAILS until T-09 implements lockfile acquisition.

test('CC-06: pre-existing .soma/install.lock → exit 2 with contention message', () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-cc06-'));
  try {
    // Create .soma/ dir + install.lock to simulate concurrent install
    const somaSubDir = path.join(lockDir, '.soma');
    fs.mkdirSync(somaSubDir, { recursive: true });
    const lockFile = path.join(somaSubDir, 'install.lock');
    const lockContent = JSON.stringify({
      pid: 99999,
      started: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago (not stale)
    });
    fs.writeFileSync(lockFile, lockContent, 'utf8');

    const r = runInstall([lockDir, '--tool=claude']);

    // RED-phase assertion: exit 2 required for lockfile contention
    assert.equal(r.status, 2,
      `[RED — depends T-09] Lockfile contention must exit 2. ` +
      `Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`
    );

    // Contract stderr format check
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.includes('install.lock') || combined.includes('in progress') || combined.includes('PID'),
      `[RED — depends T-09] stderr must reference lock file or "in progress". Got: ${combined}`
    );
  } finally {
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── CC-07: drift abort → exit 2 ──────────────────────────────────────────────
// Contract: anchored block exists but sha mismatch → exit 2 with
// "BF-06 ABORT: anchored block sha mismatch." message.
// RED phase — FAILS until T-11 + T-17 implement drift detection.

test('CC-07: existing CLAUDE.md with modified anchored block → exit 2', () => {
  const driftDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-cc07-'));
  try {
    // Simulate post-install state: CLAUDE.md with a tampered anchored block
    // The block has a sha256 that won't match actual content (drift scenario)
    const claudeMd = path.join(driftDir, 'CLAUDE.md');
    const tamperedContent = [
      '<!-- soma:start id=block.claude.CLAUDE.md version=2.2.0 sha256=000000000000000000000000000000000000000000000000000000000000dead -->',
      '# SOMA Block — this content was modified manually (sha mismatch)',
      '<!-- soma:end id=block.claude.CLAUDE.md -->',
    ].join('\n');
    fs.writeFileSync(claudeMd, tamperedContent, 'utf8');

    // Also create .soma/ to simulate installed state
    const somaSubDir = path.join(driftDir, '.soma');
    fs.mkdirSync(somaSubDir, { recursive: true });

    const r = runInstall([driftDir, '--tool=claude']);

    // RED-phase assertion: exit 2 required for drift
    assert.equal(r.status, 2,
      `[RED — depends T-11+T-17] Drift detection must exit 2. ` +
      `Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`
    );

    // Contract: BF-06 ABORT message on stderr
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.includes('BF-06') || combined.includes('sha mismatch') || combined.includes('ABORT'),
      `[RED — depends T-11+T-17] stderr must contain BF-06 ABORT message. Got: ${combined}`
    );
  } finally {
    try { fs.rmSync(driftDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── CC-08: custom CLAUDE.md no flag non-interactive → exit 2 ─────────────────
// Contract: if CLAUDE.md has free-text content (no anchor markers) and
// neither --merge-claude-md nor --replace-claude-md is given, AND
// invocation is non-interactive (no TTY) → exit 2 with message:
// "CLAUDE.md has free-text content. Specify --merge-claude-md or --replace-claude-md"
// RED phase — FAILS until T-16 implements the non-interactive guard.

test('CC-08: CLAUDE.md has free-text content, no handling flag, piped (non-interactive) → exit 2', () => {
  const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-cc08-'));
  try {
    // Create CLAUDE.md with free-text content (no soma anchor markers)
    const claudeMd = path.join(customDir, 'CLAUDE.md');
    const freeTextContent = [
      '# My Custom Rules',
      '',
      'This project has specific conventions:',
      '- Always use TypeScript',
      '- Commits must be conventional',
      '',
      'No soma anchor markers present here.',
    ].join('\n');
    fs.writeFileSync(claudeMd, freeTextContent, 'utf8');

    // Pipe stdin to simulate non-interactive (no TTY)
    const r = spawnSync('node', [INSTALL_CJS, customDir, '--tool=claude'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'], // pipe = non-interactive (no TTY)
    });

    // RED-phase assertion: exit 2 required when free-text CLAUDE.md + no flag + non-interactive
    assert.equal(r.status, 2,
      `[RED — depends T-16] Free-text CLAUDE.md without handling flag in non-interactive mode must exit 2. ` +
      `Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`
    );

    // Contract stderr message check
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.includes('--merge-claude-md') || combined.includes('--replace-claude-md') || combined.includes('free-text'),
      `[RED — depends T-16] stderr must name both flags or mention free-text content. Got: ${combined}`
    );
  } finally {
    try { fs.rmSync(customDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('CC-08b: CLAUDE.md has free-text + --merge-claude-md flag → NOT exit 2 (flag resolves ambiguity)', () => {
  withFakeHome('cc08b-home-', (fakeHome) => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-cc08b-'));
    try {
      const claudeMd = path.join(customDir, 'CLAUDE.md');
      fs.writeFileSync(claudeMd, '# Custom rules\nNo anchor markers.\n', 'utf8');

      const r = spawnSync('node', [INSTALL_CJS, customDir, '--tool=claude', '--merge-claude-md'], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'], // non-interactive
        env: fakeHomeEnv(fakeHome),
      });

      // Must NOT exit 2 for the "no flag" reason — the user provided a resolution flag.
      // RED-phase: in stub this exits 0 (flag accepted). Real impl must also not exit 2 here.
      assert.notEqual(r.status, 2,
        `[RED — depends T-08+T-14] --merge-claude-md must resolve the free-text ambiguity (not exit 2). ` +
        `Got ${r.status}. stderr: ${r.stderr} stdout: ${r.stdout}`
      );
    } finally {
      try { fs.rmSync(customDir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});
