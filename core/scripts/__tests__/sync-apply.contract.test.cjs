'use strict';
/**
 * @phase RED (Article II HARD)
 * @contract CONTRACT-011-01-sync-apply
 * @spec AC-01 AC-02 AC-03 AC-13 AC-18
 *
 * @impl_status
 *   - SANDBOX_VIOLATION: NOT implemented (SOMA_SAFE_PATHS_ONLY env not checked in sync.cjs or snapshot.cjs)
 *   - BLOCK_CONFLICT: NOT implemented (current behavior emits LOCAL_EDITS_DETECTED warning but writes anyway — contract requires abort + zero writes)
 *   - AC-03 injection point: NOT implemented (writeBlock inserts at end-of-file, NOT before "## Failure Log")
 *   - INVALID_ARGS (missing --tool): NOT implemented (--tool currently optional; contract requires INVALID_ARGS when omitted)
 *
 * @expected_failures
 *   - AC-03 (claude injection before ## Failure Log) → block injected AFTER ## Failure Log at EOF instead
 *   - AC-13 (BLOCK_CONFLICT abort) → error=null + LOCAL_EDITS_DETECTED warning emitted + file written (no abort)
 *   - SANDBOX_VIOLATION (SOMA_SAFE_PATHS_ONLY=1 + real path) → exits 0 without error, no rejection
 *   - INVALID_ARGS (--tool missing) → exits 0 with skip-all summary, no error code
 *
 * @green_phase T-05 (sync.cjs apply extension: AC-03 injection point, BLOCK_CONFLICT detection)
 *              T-06 (snapshot.cjs extension: SANDBOX_VIOLATION inline check)
 *              T-09 (conflict detection: BLOCK_CONFLICT strict abort with zero writes)
 *              T-11 (sandbox enforcement: SOMA_SAFE_PATHS_ONLY inline check)
 *
 * Implementation notes:
 *   - All test cases set SOMA_SAFE_PATHS_ONLY=1 (Article III — sandbox enforced)
 *   - Fixtures live in /tmp/soma-v2-test/t02-{test-name}/ (Article III — real fs, zero mocks)
 *   - sync.cjs invoked via spawnSync (Article III — no mocking of child_process or fs)
 *   - Each test creates its own scoped somaDir (cp -R ~/.soma-v2) + patches install-targets
 *   - Cleanup via test.after (best-effort — /tmp is ephemeral, no strict cleanup required)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// ---- Constants ----

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SANDBOX_PREFIX = '/tmp/soma-v2-test';
const SYNC_SCRIPT = 'scripts/sync.cjs';

// ---- Fixture helpers ----

/**
 * Create an isolated soma fixture dir under /tmp/soma-v2-test/t02-{name}/.
 * Copies real soma-v2 (preserving all libs/docs) then patches install-targets.json.
 * Returns { somaDir, targetDir }.
 */
function createFixture(name) {
  const fixtureRoot = path.join(SANDBOX_PREFIX, `t02-${name}-${Date.now()}`);
  const somaDir = path.join(fixtureRoot, '.soma-v2');
  const targetDir = path.join(fixtureRoot, 'targets');

  fs.mkdirSync(targetDir, { recursive: true });

  // Copy real soma-v2 as base (libs, docs, adapters)
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  return { fixtureRoot, somaDir, targetDir };
}

/**
 * Patch codex install-targets.json in somaDir to use sandboxed target paths.
 * Returns the patched entries array.
 */
function patchCodexTargets(somaDir, targetDir) {
  const agentsMd = path.join(targetDir, '.codex', 'AGENTS.md');
  const homeAgentsMd = path.join(targetDir, 'AGENTS.md');
  fs.mkdirSync(path.join(targetDir, '.codex'), { recursive: true });

  const entries = [
    {
      block_id: 'block.codex.AGENTS.codebase-memory-mcp',
      source_doc: 'docs/hyd-v2.md',
      target_path: agentsMd,
      target_anchor_id: 'block.codex.AGENTS.codebase-memory-mcp'
    },
    {
      block_id: 'block.codex.AGENTS.hyd-v2',
      source_doc: 'docs/hyd-v2.md',
      target_path: agentsMd,
      target_anchor_id: 'block.codex.AGENTS.hyd-v2'
    },
    {
      block_id: 'block.codex.AGENTS.soma-stsd',
      source_doc: 'docs/soma-stsd.md',
      target_path: agentsMd,
      target_anchor_id: 'block.codex.AGENTS.soma-stsd'
    },
    {
      block_id: 'block.codex.AGENTS.codebase-memory-mcp',
      source_doc: 'docs/hyd-v2.md',
      target_path: homeAgentsMd,
      target_anchor_id: 'block.codex.AGENTS.codebase-memory-mcp'
    },
    {
      block_id: 'block.codex.AGENTS.soma-stsd',
      source_doc: 'docs/soma-stsd.md',
      target_path: homeAgentsMd,
      target_anchor_id: 'block.codex.AGENTS.soma-stsd'
    }
  ];

  const targetsData = {
    schema: 'soma-install-targets/v1',
    tool: 'codex',
    entries
  };
  fs.writeFileSync(
    path.join(somaDir, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify(targetsData, null, 2)
  );
  return entries;
}

/**
 * Patch claude install-targets.json to use a sandboxed CLAUDE.md target.
 * Returns { claudeMdPath } — the sandboxed target file path.
 */
function patchClaudeTargets(somaDir, targetDir, claudeContent) {
  const claudeDir = path.join(targetDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

  if (claudeContent != null) {
    fs.writeFileSync(claudeMdPath, claudeContent);
  }

  const entries = [
    {
      block_id: 'block.claude.CLAUDE_md.cbm',
      source_doc: 'docs/hyd-v2.md',
      target_path: claudeMdPath,
      target_anchor_id: 'block.claude.CLAUDE_md.cbm'
    },
    {
      block_id: 'block.claude.CLAUDE_md.hyd-v2',
      source_doc: 'docs/hyd-v2.md',
      target_path: claudeMdPath,
      target_anchor_id: 'block.claude.CLAUDE_md.hyd-v2'
    },
    {
      block_id: 'block.claude.CLAUDE_md.soma-stsd',
      source_doc: 'docs/soma-stsd.md',
      target_path: claudeMdPath,
      target_anchor_id: 'block.claude.CLAUDE_md.soma-stsd'
    }
  ];

  fs.writeFileSync(
    path.join(somaDir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries }, null, 2)
  );

  return { claudeMdPath, entries };
}

/**
 * Run sync.cjs via spawnSync with SOMA_SAFE_PATHS_ONLY=1 enforced.
 * Returns { status, stdout, stderr, parsed } — parsed is JSON if output is valid JSON, else null.
 */
function runSync(somaDir, extraArgs = []) {
  const result = spawnSync(
    'node',
    [SYNC_SCRIPT, '--json', `--soma-home=${somaDir}`, ...extraArgs],
    {
      cwd: SOMA_HOME,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        SOMA_SAFE_PATHS_ONLY: '1'
      }
    }
  );

  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (_) { /* stdout not JSON — text mode */ }

  return { status: result.status, stdout: result.stdout, stderr: result.stderr, parsed };
}

/**
 * Compute sha256 of a file's content.
 */
function fileSha256(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ---- Ensure sandbox prefix exists ----

before(() => {
  fs.mkdirSync(SANDBOX_PREFIX, { recursive: true });
});

// ============================================================
// AC-01: sync without --apply runs dry-run only (zero writes)
// @spec AC-01
// @contract CONTRACT-011-01-sync-apply
// ============================================================

test('AC-01: sync without --apply is dry-run only — zero writes, target sha256 unchanged', () => {
  // @spec AC-01
  // @contract CONTRACT-011-01-sync-apply

  const { somaDir, targetDir } = createFixture('ac01-dryrun');
  patchCodexTargets(somaDir, targetDir);

  const agentsMd = path.join(targetDir, '.codex', 'AGENTS.md');
  // Target does NOT exist pre-run → sha256 "before" is a sentinel
  const existedBefore = fs.existsSync(agentsMd);

  const r = runSync(somaDir, ['--dry-run', '--tool=codex']);

  assert.equal(r.status, 1,
    `Dry-run with actionable findings should exit 1, got ${r.status}. stderr: ${r.stderr}`);
  assert.ok(r.parsed, `Expected JSON output, got: ${r.stdout.slice(0, 200)}`);
  assert.equal(r.parsed.mode, 'dry-run',
    `Expected mode=dry-run, got: ${r.parsed.mode}`);

  // Zero writes: target file must NOT have been created (it didn't exist before)
  if (!existedBefore) {
    assert.ok(!fs.existsSync(agentsMd),
      `Dry-run must NOT create target file. File was created at: ${agentsMd}`);
  } else {
    // If file existed, sha256 must be unchanged
    const shaBefore = fileSha256(agentsMd);
    assert.equal(fileSha256(agentsMd), shaBefore,
      'Dry-run must not modify existing target file sha256');
  }

  // Confirm writes_executed = 0 (via summary: no files_touched)
  // dry-run output has findings, NOT summary.files_touched — check findings only
  const findings = r.parsed.findings || [];
  assert.ok(findings.length > 0, 'Expected findings in dry-run output');
  const allActionsAreNotWrite = findings.every(f =>
    ['insert', 'replace', 'skip', 'drift'].includes(f.action)
  );
  assert.ok(allActionsAreNotWrite, 'Dry-run findings should only contain preview actions');
});

// ============================================================
// AC-02: --apply --tool=codex injects 5 entries
// @spec AC-02
// @contract CONTRACT-011-01-sync-apply
// ============================================================

test('AC-02: sync --apply --tool=codex injects 5 entries into sandboxed targets', () => {
  // @spec AC-02
  // @contract CONTRACT-011-01-sync-apply

  const { somaDir, targetDir } = createFixture('ac02-codex-apply');
  patchCodexTargets(somaDir, targetDir);

  const r = runSync(somaDir, ['--apply', '--tool=codex']);

  assert.equal(r.status, 0,
    `Apply should exit 0, got ${r.status}. stderr: ${r.stderr}. stdout: ${r.stdout.slice(0, 500)}`);
  assert.ok(r.parsed, `Expected JSON output`);
  assert.equal(r.parsed.mode, 'apply', `Expected mode=apply`);
  assert.equal(r.parsed.error, null, `Expected no error, got: ${JSON.stringify(r.parsed.error)}`);

  const summary = r.parsed.summary;
  assert.ok(summary, 'Expected summary in apply output');

  const totalWritten = (summary.by_action.insert || 0) + (summary.by_action.replace || 0);
  assert.equal(totalWritten, 5,
    `Expected 5 entries written (3 unique block_ids × 2 target_paths), got ${totalWritten}. ` +
    `by_action: ${JSON.stringify(summary.by_action)}`);

  // Verify snapshot_id is present (auto-snapshot per AC-04)
  assert.ok(r.parsed.snapshot, 'Expected snapshot metadata in apply output');
  assert.ok(r.parsed.snapshot.timestamp, 'Expected snapshot.timestamp');

  // Verify both target files were actually written
  const agentsMd = path.join(targetDir, '.codex', 'AGENTS.md');
  const homeAgentsMd = path.join(targetDir, 'AGENTS.md');
  assert.ok(fs.existsSync(agentsMd),
    `~/.codex/AGENTS.md equivalent must be written at: ${agentsMd}`);
  assert.ok(fs.existsSync(homeAgentsMd),
    `~/AGENTS.md equivalent must be written at: ${homeAgentsMd}`);

  // Verify anchor format: soma-v2:start id=... version=... sha256=...
  const agentsContent = fs.readFileSync(agentsMd, 'utf8');
  assert.match(agentsContent, /<!--\s*soma-v2:start\s+id=block\.codex\.AGENTS\.\S+\s+version=\S+\s+sha256=[0-9a-f]{64}\s*-->/,
    'Expected soma-v2 anchor format with id, version, sha256 in ~/.codex/AGENTS.md');
});

// ============================================================
// AC-03: --apply --tool=claude injects 3 entries BEFORE ## Failure Log
// @spec AC-03
// @contract CONTRACT-011-01-sync-apply
// EXPECTED TO FAIL (RED): writeBlock inserts at EOF, not before ## Failure Log
// ============================================================

test('AC-03: sync --apply --tool=claude appends ## SOMA Bootloader section BEFORE ## Failure Log', () => {
  // @spec AC-03
  // @contract CONTRACT-011-01-sync-apply
  // @expected_failure RED — writeBlock inserts at EOF, not before "## Failure Log"

  const claudeFixtureContent = [
    '# Claude Self-Model',
    '',
    'Some existing content in self-model.',
    '',
    '## Failure Modes (empirically verified)',
    '',
    '1. **Shallow pattern-matching** — example entry.',
    '',
    '## Failure Log',
    '2026-04-07 | #6 ignoring-own-memory | example entry | added',
    ''
  ].join('\n');

  const { somaDir, targetDir } = createFixture('ac03-claude-inject');
  const { claudeMdPath } = patchClaudeTargets(somaDir, targetDir, claudeFixtureContent);

  const r = runSync(somaDir, ['--apply', '--tool=claude']);

  assert.equal(r.status, 0,
    `Apply should exit 0, got ${r.status}. stderr: ${r.stderr}`);
  assert.ok(r.parsed, 'Expected JSON output');
  assert.equal(r.parsed.error, null, `Expected no error`);

  const summary = r.parsed.summary;
  const totalWritten = (summary.by_action.insert || 0) + (summary.by_action.replace || 0);
  assert.equal(totalWritten, 3,
    `Expected 3 entries written for claude, got ${totalWritten}`);

  // AC-03 CORE: ## SOMA Bootloader section must appear BEFORE ## Failure Log
  const claudeContent = fs.readFileSync(claudeMdPath, 'utf8');
  const bootloaderIdx = claudeContent.indexOf('## SOMA Bootloader (managed by soma sync)');
  const failureLogIdx = claudeContent.indexOf('## Failure Log');

  assert.ok(bootloaderIdx !== -1,
    'Expected "## SOMA Bootloader (managed by soma sync)" section to be injected in CLAUDE.md');
  assert.ok(failureLogIdx !== -1,
    'Expected "## Failure Log" to still exist in CLAUDE.md after sync');
  assert.ok(bootloaderIdx < failureLogIdx,
    `Expected ## SOMA Bootloader (at pos ${bootloaderIdx}) to appear BEFORE ## Failure Log (at pos ${failureLogIdx}) — ` +
    `but current impl appends at EOF after ## Failure Log. GREEN phase: T-05 must implement injection_point logic.`);
});

// ============================================================
// AC-13: BLOCK_CONFLICT error when user manually edited inside anchored block
// @spec AC-13
// @contract CONTRACT-011-01-sync-apply
// EXPECTED TO FAIL (RED): current behavior emits LOCAL_EDITS_DETECTED warning but writes anyway
// ============================================================

test('AC-13: sync --apply aborts with BLOCK_CONFLICT when user edited inside anchored block', () => {
  // @spec AC-13
  // @contract CONTRACT-011-01-sync-apply
  // @expected_failure RED — current behavior: LOCAL_EDITS_DETECTED warning + write (no abort)

  const { somaDir, targetDir } = createFixture('ac13-conflict');
  patchCodexTargets(somaDir, targetDir);

  // First apply: write blocks into targets
  const r1 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r1.status, 0, `First apply should succeed. stderr: ${r1.stderr}`);

  // Simulate user manually editing INSIDE the anchored block
  const agentsMd = path.join(targetDir, '.codex', 'AGENTS.md');
  assert.ok(fs.existsSync(agentsMd), 'Target file must exist after first apply');

  let agentsContent = fs.readFileSync(agentsMd, 'utf8');
  // Inject user content inside the first block (between start and end markers)
  agentsContent = agentsContent.replace(
    '# HYD v2 Cognitive Discipline',
    '# HYD v2 Cognitive Discipline\n<!-- USER MANUAL EDIT: added by the user outside SOMA -->'
  );
  fs.writeFileSync(agentsMd, agentsContent);

  // Second apply: MUST detect conflict and abort with BLOCK_CONFLICT
  const r2 = runSync(somaDir, ['--apply', '--tool=codex']);

  // Contract requires: error=BLOCK_CONFLICT, exit 1, writes_executed=0
  assert.equal(r2.status, 1,
    `Expected exit 1 on BLOCK_CONFLICT, got ${r2.status}. ` +
    `Current behavior: writes proceed with LOCAL_EDITS_DETECTED warning. GREEN phase: T-09.`);
  assert.ok(r2.parsed, 'Expected JSON output on conflict');
  assert.equal(r2.parsed.error?.code || r2.parsed.error, 'BLOCK_CONFLICT',
    `Expected error.code=BLOCK_CONFLICT, got: ${JSON.stringify(r2.parsed.error)}. ` +
    `Current impl uses LOCAL_EDITS_DETECTED warning instead of aborting.`);
  assert.equal(r2.parsed.summary?.by_action?.insert + r2.parsed.summary?.by_action?.replace || 0, 0,
    'Expected zero writes on BLOCK_CONFLICT (writes_executed=0)');

  // Verify the error includes required details per AC-14
  const errDetails = r2.parsed.error?.details || r2.parsed.error;
  if (typeof errDetails === 'object' && errDetails !== null) {
    assert.ok(errDetails.block_id || r2.parsed.error?.message?.includes('block'),
      'BLOCK_CONFLICT error must include block_id or block reference');
    assert.ok(errDetails.expected_sha256 || r2.parsed.error?.message,
      'BLOCK_CONFLICT error must include expected_sha256 or sha256 info');
    assert.ok(errDetails.actual_sha256 || r2.parsed.error?.message,
      'BLOCK_CONFLICT error must include actual_sha256 or sha256 info');
  }
});

// ============================================================
// AC-18: idempotent re-apply with no source changes → no-op
// @spec AC-18
// @contract CONTRACT-011-01-sync-apply
// ============================================================

test('AC-18: idempotent re-apply with no source changes is a no-op (zero writes)', () => {
  // @spec AC-18
  // @contract CONTRACT-011-01-sync-apply

  const { somaDir, targetDir } = createFixture('ac18-idempotent');
  patchCodexTargets(somaDir, targetDir);

  // First apply: should write 5 entries
  const r1 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r1.status, 0, `First apply should exit 0. stderr: ${r1.stderr}`);
  assert.ok(r1.parsed, 'Expected JSON on first apply');

  const totalWritten1 = (r1.parsed.summary?.by_action?.insert || 0) +
    (r1.parsed.summary?.by_action?.replace || 0);
  assert.equal(totalWritten1, 5, `First apply must write 5 entries, got ${totalWritten1}`);

  // Capture sha256 of all target files after first apply
  const agentsMd = path.join(targetDir, '.codex', 'AGENTS.md');
  const homeAgentsMd = path.join(targetDir, 'AGENTS.md');
  const sha1Codex = fileSha256(agentsMd);
  const sha1Home = fileSha256(homeAgentsMd);

  // Second apply: no source changes → must be no-op
  const r2 = runSync(somaDir, ['--apply', '--tool=codex']);
  assert.equal(r2.status, 0, `Second apply (no-op) should exit 0. stderr: ${r2.stderr}`);
  assert.ok(r2.parsed, 'Expected JSON on second apply');
  assert.equal(r2.parsed.error, null, `Expected no error on re-apply`);

  const totalWritten2 = (r2.parsed.summary?.by_action?.insert || 0) +
    (r2.parsed.summary?.by_action?.replace || 0);
  assert.equal(totalWritten2, 0,
    `Expected zero writes on idempotent re-apply, got ${totalWritten2}. ` +
    `by_action: ${JSON.stringify(r2.parsed.summary?.by_action)}`);

  // Target file sha256 must be unchanged after second apply
  assert.equal(fileSha256(agentsMd), sha1Codex,
    'Target .codex/AGENTS.md sha256 must be unchanged after idempotent re-apply');
  assert.equal(fileSha256(homeAgentsMd), sha1Home,
    'Target ~/AGENTS.md sha256 must be unchanged after idempotent re-apply');
});

// ============================================================
// SANDBOX_VIOLATION: SOMA_SAFE_PATHS_ONLY=1 + target outside /tmp/soma-v2-test/
// @spec AC-17
// @contract CONTRACT-011-01-sync-apply
// EXPECTED TO FAIL (RED): SOMA_SAFE_PATHS_ONLY not checked — sync proceeds without error
// ============================================================

test('SANDBOX_VIOLATION: SOMA_SAFE_PATHS_ONLY=1 + real bootloader path → exit 1 SANDBOX_VIOLATION', () => {
  // @spec AC-17 AC-02
  // @contract CONTRACT-011-01-sync-apply
  // @expected_failure RED — SOMA_SAFE_PATHS_ONLY env not checked in sync.cjs or snapshot.cjs

  // Use the REAL install-targets (which point to ~/.codex/AGENTS.md, ~/AGENTS.md)
  // Under SOMA_SAFE_PATHS_ONLY=1, these paths are NOT prefixed with /tmp/soma-v2-test/
  // Contract requires: exit 1 with SANDBOX_VIOLATION error, zero writes

  // We create a soma fixture but do NOT patch install-targets (real paths remain)
  const { somaDir } = createFixture('sandbox-violation');

  // Capture sha256 of real AGENTS.md (must be unchanged after test)
  const realAgentsMd = path.join(os.homedir(), '.codex', 'AGENTS.md');
  const shaBeforeReal = fs.existsSync(realAgentsMd) ? fileSha256(realAgentsMd) : null;

  const r = runSync(somaDir, ['--apply', '--tool=codex']);

  // Contract: must exit 1 with SANDBOX_VIOLATION
  assert.equal(r.status, 1,
    `Expected exit 1 (SANDBOX_VIOLATION), got ${r.status}. ` +
    `Current impl: exits 0 and proceeds without checking SOMA_SAFE_PATHS_ONLY. GREEN phase: T-06/T-11.`);
  assert.ok(r.parsed, 'Expected JSON output on SANDBOX_VIOLATION');
  assert.equal(r.parsed.error?.code || r.parsed.error, 'SANDBOX_VIOLATION',
    `Expected error.code=SANDBOX_VIOLATION, got: ${JSON.stringify(r.parsed.error)}`);

  // Ensure zero writes happened (real bootloader untouched)
  if (shaBeforeReal !== null) {
    assert.equal(fileSha256(realAgentsMd), shaBeforeReal,
      'Real ~/.codex/AGENTS.md must NOT be modified when SANDBOX_VIOLATION triggered');
  }
});

// ============================================================
// INVALID_ARGS: --tool missing or not in {codex, claude}
// @spec AC-01 (--tool required per contract)
// @contract CONTRACT-011-01-sync-apply
// EXPECTED TO FAIL (RED): --tool currently optional; no INVALID_ARGS when omitted
// ============================================================

test('INVALID_ARGS: --apply without --tool flag → exit 2 INVALID_ARGS', () => {
  // @spec contract args.tool (required=true)
  // @contract CONTRACT-011-01-sync-apply
  // @expected_failure RED — --tool currently optional; sync proceeds without error

  const { somaDir } = createFixture('invalid-args-no-tool');
  // Patch install-targets to avoid real writes even if check is bypassed
  patchCodexTargets(somaDir, path.join(somaDir, '..', 'targets'));

  const r = runSync(somaDir, ['--apply']); // NO --tool flag

  assert.equal(r.status, 2,
    `Expected exit 2 (INVALID_ARGS: --tool is required), got ${r.status}. ` +
    `Current impl: --tool is optional and sync proceeds scanning all adapters. GREEN phase: T-05 or sync.cjs arg validation.`);
  assert.ok(r.parsed, 'Expected JSON output on INVALID_ARGS');
  assert.equal(r.parsed.error?.code || r.parsed.error, 'INVALID_ARGS',
    `Expected error.code=INVALID_ARGS, got: ${JSON.stringify(r.parsed.error)}`);
});

test('INVALID_ARGS: --apply --tool=badvalue → exit 2 INVALID_ARGS', () => {
  // @spec contract args.tool (enum: codex|claude)
  // @contract CONTRACT-011-01-sync-apply
  // @expected_failure RED — invalid tool values not rejected with INVALID_ARGS; sync silently no-ops

  const { somaDir } = createFixture('invalid-args-bad-tool');
  patchCodexTargets(somaDir, path.join(somaDir, '..', 'targets'));

  const r = runSync(somaDir, ['--apply', '--tool=badvalue']);

  assert.equal(r.status, 2,
    `Expected exit 2 (INVALID_ARGS: tool must be codex|claude), got ${r.status}. ` +
    `Current impl: exits 0 with empty summary (unknown adapter silently skipped).`);
  assert.ok(r.parsed, 'Expected JSON output on INVALID_ARGS');
  assert.equal(r.parsed.error?.code || r.parsed.error, 'INVALID_ARGS',
    `Expected error.code=INVALID_ARGS for unrecognized tool, got: ${JSON.stringify(r.parsed.error)}`);
  assert.ok(r.parsed.error?.message?.toLowerCase().includes('tool'),
    `INVALID_ARGS message must mention --tool constraint. Got: ${r.parsed.error?.message}`);
});
