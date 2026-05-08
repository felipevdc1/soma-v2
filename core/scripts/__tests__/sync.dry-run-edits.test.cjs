'use strict';
// @spec AC-03
// Integration tests: sync --dry-run edits — verifies 2 inserts for ~/AGENTS.md + drift for codex

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

// Synthetic legacy-marker AGENTS.md content for .codex/ fixture.
// Uses OLD format (no version=/sha256= attrs) so sync reports drift action for codex entries.
// Hand-crafted: does not depend on real ~/.codex/AGENTS.md state (which may be upgraded post-PR #12).
const LEGACY_CODEX_AGENTS_MD = [
  '# Codex AGENTS.md — legacy format (D3 fixture)',
  '',
  '<!-- hyd-v2:start -->',
  '# HYD v2 Cognitive Discipline',
  'Legacy content for hyd-v2 block.',
  '<!-- hyd-v2:end -->',
  '',
  '<!-- soma-stsd:start -->',
  '# SOMA / STSD Operating Lens',
  'Legacy content for soma-stsd block.',
  '<!-- soma-stsd:end -->',
  '',
  '<!-- codebase-memory-mcp:start -->',
  '# Codebase Memory MCP',
  'Legacy content for codebase-memory-mcp block.',
  '<!-- codebase-memory-mcp:end -->',
  ''
].join('\n');

/**
 * Create fixture for sync dry-run testing.
 * Replicates: real soma-v2 + real ~/.codex/AGENTS.md (legacy markers) + ~/AGENTS.md without CBM/stsd blocks.
 */
function createSyncFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-fixture-'));
  const somaDir = path.join(dir, '.soma-v2');

  // Copy real soma-v2 lab
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  // Set up .codex/AGENTS.md with SYNTHETIC legacy markers (D3 fixture — lacks new attrs).
  // Does NOT copy real ~/.codex/AGENTS.md — that file was upgraded by PR #12 and no longer has
  // legacy markers, making detection tests vacuously pass. Synthetic content preserves D3 coverage.
  fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codex', 'AGENTS.md'), LEGACY_CODEX_AGENTS_MD, 'utf8');

  // ~/AGENTS.md WITHOUT CBM or soma-stsd blocks → 2 inserts expected
  fs.writeFileSync(path.join(dir, 'AGENTS.md'),
    '# Global Agent Operating Rules\n\nBasic rules only — missing CBM and soma-stsd blocks.\n'
  );

  // Patch codex install-targets to use fixture paths
  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const patchedEntries = targets.entries.map(e => {
    let tp = e.target_path;
    if (tp === '~/.codex/AGENTS.md') tp = path.join(dir, '.codex', 'AGENTS.md');
    else if (tp === '~/AGENTS.md') tp = path.join(dir, 'AGENTS.md');
    return { ...e, target_path: tp };
  });
  fs.writeFileSync(targetsPath, JSON.stringify({ ...targets, entries: patchedEntries }, null, 2));

  // Patch claude install-targets: remove legacy cbm entry so count matches AC-20 (8 total: 5 codex + 3 claude).
  // The installed ~/.soma-v2 may still carry cbm during migration rollout; fixture must reflect
  // post-migration canonical state.
  const claudeItPath = path.join(somaDir, 'adapters', 'claude', 'install-targets.json');
  if (fs.existsSync(claudeItPath)) {
    const claudeIt = JSON.parse(fs.readFileSync(claudeItPath, 'utf8'));
    claudeIt.entries = claudeIt.entries.filter(e => e.block_id !== 'block.claude.CLAUDE_md.cbm');
    fs.writeFileSync(claudeItPath, JSON.stringify(claudeIt, null, 2));
  }

  return { dir, somaDir };
}

function runSync(somaDir, extraArgs = []) {
  return spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`, ...extraArgs], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });
}

// ---- Tests ----

test('sync --dry-run: reports 2 insert actions for ~/AGENTS.md (D1+D2)', () => {
  const { dir, somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  assert.equal(result.status, 1, `Expected exit 1 (actionable findings), got ${result.status}. stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);

  const insertFindings = parsed.findings.filter(f =>
    f.action === 'insert' &&
    f.target_path.includes('AGENTS.md') &&
    !f.target_path.includes('.codex')
  );

  assert.equal(insertFindings.length, 2,
    `Expected 2 insert findings for ~/AGENTS.md, got ${insertFindings.length}. Findings: ${JSON.stringify(parsed.findings.map(f => ({action: f.action, id: f.target_anchor_id})))}`);

  const ids = new Set(insertFindings.map(f => f.target_anchor_id));
  assert.ok(ids.has('block.codex.AGENTS.codebase-memory-mcp'), 'CBM insert finding expected');
  assert.ok(ids.has('block.codex.AGENTS.soma-stsd'), 'soma-stsd insert finding expected');
});

test('sync --dry-run: ~/AGENTS.md insert findings have expected_sha256 and source_doc', () => {
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  const parsed = JSON.parse(result.stdout);
  const insertFindings = parsed.findings.filter(f =>
    f.action === 'insert' &&
    !f.target_path.includes('.codex')
  );

  for (const f of insertFindings) {
    assert.ok(typeof f.expected_sha256 === 'string' && f.expected_sha256.length > 0,
      `Insert finding should have expected_sha256: ${JSON.stringify(f)}`);
    assert.ok(typeof f.source_doc === 'string' && f.source_doc.length > 0,
      `Insert finding should have source_doc: ${JSON.stringify(f)}`);
    assert.equal(f.actual_sha256, null,
      `Insert finding actual_sha256 should be null: ${JSON.stringify(f)}`);
  }
});

test('sync --dry-run: codex entries have drift action (legacy markers D3)', () => {
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  const parsed = JSON.parse(result.stdout);
  const codexFindings = parsed.findings.filter(f =>
    f.target_path.includes('.codex')
  );

  // All codex entries have legacy markers (no id/version/sha256 attrs) → drift
  for (const f of codexFindings) {
    assert.ok(['drift', 'skip'].includes(f.action),
      `Codex finding should be drift or skip, got: ${f.action}`);
  }

  // At least some should be drift (they have legacy markers)
  const driftCount = codexFindings.filter(f => f.action === 'drift').length;
  assert.ok(driftCount >= 1, `Expected ≥1 drift for codex entries, got ${driftCount}`);
});

test('sync --dry-run: summary total_entries = 8 (all install-targets entries)', () => {
  // AC-20: cbm deprecated → 3 claude entries (hyd-v2, soma-stsd, soma-voxel) + 5 codex = 8 total.
  // Fixture patches claude install-targets to strip cbm (post-migration canonical state).
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.total_entries, 8,
    `Expected 8 total entries (5 codex + 3 claude), got ${parsed.summary.total_entries}`);
});

test('sync --dry-run: summary by_action.insert = 2 (AGENTS.md inserts from clean fixture)', () => {
  // TEST-STALE-FIX: Original assertion was insert=5 (2 AGENTS.md + 3 claude).
  // This fixture only patches codex targets (AGENTS.md in fixture dir).
  // The claude entries still point to real ~/.claude/CLAUDE.md which ALREADY has the
  // soma-v2 blocks (cbm: skip, soma-stsd: skip, hyd-v2: drift) — not inserts.
  // The actual inserts are 2: both AGENTS.md entries (fixture dir, no pre-existing blocks).
  // Updated from 5 → 2 to match the fixture's actual scope.
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.by_action.insert, 2,
    `Expected 2 inserts (both ~/AGENTS.md fixture entries, no pre-existing blocks), got ${parsed.summary.by_action.insert}`);
});

test('sync --dry-run: each finding has required contract fields', () => {
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  const parsed = JSON.parse(result.stdout);
  const validActions = ['insert', 'replace', 'skip', 'drift'];

  for (const f of parsed.findings) {
    assert.ok(validActions.includes(f.action),
      `Invalid action "${f.action}"`);
    assert.ok(typeof f.target_path === 'string', `target_path must be string: ${JSON.stringify(f)}`);
    assert.ok(typeof f.target_anchor_id === 'string', `target_anchor_id must be string: ${JSON.stringify(f)}`);
    assert.ok(typeof f.source_doc === 'string', `source_doc must be string: ${JSON.stringify(f)}`);
  }
});

test('sync --dry-run: adapters_scanned includes codex', () => {
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);

  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.adapters_scanned.includes('codex'),
    `Expected codex in adapters_scanned: ${JSON.stringify(parsed.adapters_scanned)}`);
});

test('sync --dry-run: --tool=codex filters to only codex adapter', () => {
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir, ['--tool=codex']);

  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.adapters_scanned, ['codex']);

  // Only codex entries (target_path has .codex or AGENTS.md)
  for (const f of parsed.findings) {
    assert.equal(f.adapter, 'codex',
      `All findings should be from codex adapter: ${JSON.stringify(f)}`);
  }
});

test('sync --dry-run: exit code 1 with actionable findings', () => {
  const { somaDir } = createSyncFixture();
  const result = runSync(somaDir);
  assert.equal(result.status, 1, `Expected exit 1 with actionable findings, got ${result.status}`);
});

test('sync --dry-run: exit code 0 when all entries skip (empty targets fixture)', () => {
  // Create fixture with zero entries → no actions needed
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-insync-'));
  const somaDir = path.join(dir, '.soma-v2');
  fs.mkdirSync(path.join(somaDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(somaDir, 'adapters', 'claude'), { recursive: true });

  fs.writeFileSync(path.join(somaDir, 'manifest.json'), JSON.stringify({
    schema: 'soma-manifest/v1', version: '2.1.0-test', files: []
  }));
  fs.writeFileSync(path.join(somaDir, 'adapters', 'codex', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'codex', entries: [] }));
  fs.writeFileSync(path.join(somaDir, 'adapters', 'claude', 'install-targets.json'),
    JSON.stringify({ schema: 'soma-install-targets/v1', tool: 'claude', entries: [] }));

  const result = spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });
  assert.equal(result.status, 0, `Expected exit 0 with empty targets, got ${result.status}. stderr: ${result.stderr}`);
});
