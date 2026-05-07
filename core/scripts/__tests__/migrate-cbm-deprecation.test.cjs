'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lib = require('../lib/migrate.cjs');

test('extractMcpContentFromLab: extracts content between legacy markers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, [
    '<!-- codebase-memory-mcp:start -->',
    '# Codebase Knowledge Graph',
    'MCP doc content here',
    '<!-- codebase-memory-mcp:end -->',
    '',
    '<!-- hyd-v2:start -->',
    'unrelated',
    '<!-- hyd-v2:end -->',
  ].join('\n'));
  const content = lib.extractMcpContentFromLab(fixture);
  assert.match(content, /# Codebase Knowledge Graph/);
  assert.match(content, /MCP doc content here/);
  assert.doesNotMatch(content, /<!-- codebase-memory-mcp:start -->/, 'must exclude markers');
  assert.doesNotMatch(content, /unrelated/, 'must not include other blocks');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: returns null if no marker present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, '# Some other doc\nNo legacy markers here.');
  const content = lib.extractMcpContentFromLab(fixture);
  assert.equal(content, null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: returns null if file missing', () => {
  const content = lib.extractMcpContentFromLab('/nonexistent/path');
  assert.equal(content, null);
});

test('deleteLegacyBlock: removes markers + content cleanly', () => {
  const input = [
    '# Header',
    '',
    '<!-- codebase-memory-mcp:start -->',
    'Content to delete',
    '<!-- codebase-memory-mcp:end -->',
    '',
    '# After',
  ].join('\n');
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.doesNotMatch(result, /codebase-memory-mcp:start/);
  assert.doesNotMatch(result, /codebase-memory-mcp:end/);
  assert.doesNotMatch(result, /Content to delete/);
  assert.match(result, /# Header/);
  assert.match(result, /# After/);
});

test('deleteLegacyBlock: no triple newlines when surrounded by blank lines', () => {
  const input = '# Header\n\n<!-- codebase-memory-mcp:start -->\nx\n<!-- codebase-memory-mcp:end -->\n\n# After';
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.doesNotMatch(result, /\n{3,}/, 'no triple+ newlines');
});

test('deleteLegacyBlock: no-op if marker not present', () => {
  const input = '# Header\nNo markers here.';
  const result = lib.deleteLegacyBlock(input, 'codebase-memory-mcp');
  assert.equal(result, input);
});

test('renameAnchor: changes ID + sha256 in soma-v2 anchor markers', () => {
  const input = [
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=oldhash -->',
    'block content',
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->',
  ].join('\n');
  const result = lib.renameAnchor(input, 'block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2', 'newhash');
  assert.match(result, /id=block\.claude\.CLAUDE_md\.hyd-v2/);
  assert.match(result, /sha256=newhash/);
  assert.doesNotMatch(result, /id=block\.claude\.CLAUDE_md\.cbm/);
  assert.match(result, /block content/, 'inner content preserved');
});

test('renameAnchor: no-op if oldId not present', () => {
  const input = '# No anchor here\nplain text';
  const result = lib.renameAnchor(input, 'block.claude.CLAUDE_md.cbm', 'block.claude.CLAUDE_md.hyd-v2', 'newhash');
  assert.equal(result, input);
});

test('atomicWrite: writes via tmp + rename', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const target = path.join(tmpDir, 'output.md');
  fs.writeFileSync(target, 'old content');
  lib.atomicWrite(target, 'new content');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new content');
  // verify no .tmp leftover
  const leftovers = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0, 'no .tmp leftover after rename');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('atomicWrite: throws on permission failure (parent ENOENT)', () => {
  assert.throws(() => lib.atomicWrite('/nonexistent-dir/file.md', 'content'));
});

test('createMigrationSnapshot: creates snapshot dir with files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  const file1 = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(file1, 'claude content');
  const snapshotId = lib.createMigrationSnapshot(somaHome, [file1]);
  assert.match(snapshotId, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z-cbm-deprecation$/);
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  assert.ok(fs.existsSync(snapshotDir));
  // verify file content snapshot exists
  const snapshots = fs.readdirSync(snapshotDir);
  assert.ok(snapshots.length > 0, 'snapshot files written');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('rollbackFromSnapshot: restores files from snapshot', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  const snapshotId = '2026-05-06T20:00:00Z-cbm-deprecation';
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  // Create snapshot of CLAUDE.md
  fs.writeFileSync(path.join(snapshotDir, 'CLAUDE.md.snapshot'), 'original content');
  const target = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(target, 'mutated content');
  // Manifest mapping snapshot files → restore targets
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify({
    files: { 'CLAUDE.md.snapshot': target }
  }));
  lib.rollbackFromSnapshot(somaHome, snapshotId);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original content');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const { spawnSync } = require('node:child_process');

test('verifyMigration: invokes doctor.cjs and parses output', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  // Setup minimal somaHome with manifest etc — for now just stub the doctor invocation
  const result = lib.verifyMigration(tmpDir);
  assert.ok('ok' in result, 'returns {ok, findings}');
  assert.ok(Array.isArray(result.findings), 'findings is array');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('preFlightGates G1: lab files exist (graceful skip if missing)', () => {
  const result = lib.preFlightGates({
    lab: { claudeMd: '/nonexistent', codexAgents: '/nonexistent', homeAgents: '/nonexistent' },
    install: { /* ... */ },
    frozenLibs: { /* ... */ },
  });
  // G1: skip missing target gracefully — pass if at least one lab exists, else "nothing to migrate"
  assert.ok(result.gates.G1 !== 'fatal', 'G1 should not fatal-error on missing files');
});

test('preFlightGates G2: idempotent no-op if nothing to migrate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, '# Clean file, no cbm or legacy markers');
  const result = lib.preFlightGates({
    lab: { codexAgents: fixture, claudeMd: null, homeAgents: null },
    install: { hasCbm: false, hasLegacy: false },
    frozenLibs: { match: true },
  });
  assert.equal(result.action, 'noop', 'G2 returns noop when nothing to migrate');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('preFlightGates G3: content alignment blocks unless --force', () => {
  // Stubbed: lab MCP doc differs from spec extraction
  const result = lib.preFlightGates({
    lab: { /* with content */ },
    install: { /* ... */ },
    frozenLibs: { match: true },
    contentMismatch: true,
    force: false,
  });
  assert.equal(result.gates.G3, 'fail', 'G3 fails on content mismatch without --force');
  // With --force:
  const resultForce = lib.preFlightGates({ contentMismatch: true, force: true });
  assert.notEqual(resultForce.gates.G3, 'fail', 'G3 passes with --force');
});

test('preFlightGates G4: lock file blocks concurrent runs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const lockFile = path.join(tmpDir, '.migration.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 12345, started: new Date().toISOString() }));
  const result = lib.preFlightGates({ somaHome: tmpDir });
  assert.equal(result.gates.G4, 'fail');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('preFlightGates G5: pass when disk has space', () => {
  // Use real /tmp dir which should always have >1MB free
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-test-'));
  const result = lib.preFlightGates({ somaHome: tmpDir });
  assert.equal(result.gates.G5, 'pass');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('preFlightGates G5: fail with informative message when disk full', () => {
  // Test injection point: diskSpaceOverride=0 simulates no space available
  const result = lib.preFlightGates({ somaHome: '/tmp', diskSpaceOverride: 0 });
  assert.equal(result.gates.G5, 'fail');
  assert.ok(result.failures.some(f => /G5/.test(f)));
});

test('preFlightGates G6: frozen libs baseline mismatch fails', () => {
  const result = lib.preFlightGates({
    frozenLibs: { match: false, drift: ['anchored-blocks.cjs'] }
  });
  assert.equal(result.gates.G6, 'fail');
});

test('verifyMigration: parses migration_needed=true from doctor --check-migration JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  const scriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  // Stub doctor.cjs that returns migration_needed=true via JSON (--check-migration --json interface)
  fs.writeFileSync(path.join(scriptsDir, 'doctor.cjs'), `#!/usr/bin/env node
const out = {
  status: 'warning',
  migration_check: {
    migration_needed: true,
    old_markers_detected: 2,
    scanned_files: []
  }
};
process.stdout.write(JSON.stringify(out) + '\\n');
process.exit(0);
`);
  const result = lib.verifyMigration(tmpDir);
  assert.equal(result.ok, false, 'should fail when migration_needed=true');
  assert.ok(result.findings.some(f => /2.*old-format/.test(f)), 'should report old-format count');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('verifyMigration: returns ok=false when doctor exits non-zero', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-exit-test-'));
  const scriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'doctor.cjs'), `#!/usr/bin/env node\nconsole.error('crashed'); process.exit(1);\n`);
  const result = lib.verifyMigration(tmpDir);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => /exited with status 1/.test(f)));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('verifyMigration: returns ok=true when migration_needed=false', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  const scriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  // Stub doctor.cjs that returns migration_needed=false (clean state)
  fs.writeFileSync(path.join(scriptsDir, 'doctor.cjs'), `#!/usr/bin/env node
const out = {
  status: 'ok',
  migration_check: {
    migration_needed: false,
    old_markers_detected: 0,
    scanned_files: []
  }
};
process.stdout.write(JSON.stringify(out) + '\\n');
process.exit(0);
`);
  const result = lib.verifyMigration(tmpDir);
  assert.equal(result.ok, true);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateCbmDeprecation: writes + cleans .migration.lock on success', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'scripts', 'lib'), { recursive: true });
  // Use real frozen lib content from repo so G6 passes
  const repoRoot = path.resolve(__dirname, '../../..');
  for (const file of ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs']) {
    fs.copyFileSync(
      path.join(repoRoot, 'core', 'scripts', 'lib', file),
      path.join(somaHome, 'scripts', 'lib', file)
    );
  }
  // Setup lab with cbm to trigger migration
  const labClaude = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(labClaude, '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=x -->\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->');
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd: labClaude, codexAgents: null, homeAgents: null },
  });
  // Lock should be cleaned post-completion (whether success or rollback)
  assert.ok(!fs.existsSync(path.join(somaHome, '.migration.lock')), 'lock file must be deleted');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateCbmDeprecation: G6 fails if frozen libs drift detected', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g6-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, 'scripts', 'lib'), { recursive: true });
  // Write frozen libs with WRONG content (drift)
  fs.writeFileSync(path.join(somaHome, 'scripts', 'lib', 'anchored-blocks.cjs'), '// drifted');
  fs.writeFileSync(path.join(somaHome, 'scripts', 'lib', 'manifest.cjs'), '// drifted');
  fs.writeFileSync(path.join(somaHome, 'scripts', 'lib', 'template-engine.cjs'), '// drifted');
  // Setup minimal lab with cbm anchor to trigger migration path
  const labClaude = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(labClaude, '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=x -->\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->');
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd: labClaude, codexAgents: null, homeAgents: null },
    dryRun: false,
    force: false,
  });
  assert.equal(result.action, 'abort', 'must abort when frozen libs drift');
  assert.ok(result.failures.some(f => /G6/.test(f)));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createMigrationSnapshot: handles same-basename files (no collision)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collision-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  const dir1 = path.join(tmpDir, 'a');
  const dir2 = path.join(tmpDir, 'b');
  fs.mkdirSync(dir1); fs.mkdirSync(dir2);
  const file1 = path.join(dir1, 'AGENTS.md');
  const file2 = path.join(dir2, 'AGENTS.md');
  fs.writeFileSync(file1, 'content from a');
  fs.writeFileSync(file2, 'content from b');
  const snapshotId = lib.createMigrationSnapshot(somaHome, [file1, file2]);
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  const snapshots = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.snapshot'));
  assert.equal(snapshots.length, 2, 'both files should be snapshotted (no collision)');
  // Verify rollback restores both correctly
  fs.writeFileSync(file1, 'mutated a');
  fs.writeFileSync(file2, 'mutated b');
  lib.rollbackFromSnapshot(somaHome, snapshotId);
  assert.equal(fs.readFileSync(file1, 'utf8'), 'content from a');
  assert.equal(fs.readFileSync(file2, 'utf8'), 'content from b');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateCbmDeprecation: orchestrates full lifecycle (sandbox)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  // Setup minimal SOMA_HOME structure
  fs.mkdirSync(path.join(somaHome, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  // Provide real frozen libs so G6 passes
  const repoRoot = path.resolve(__dirname, '../../..');
  for (const file of ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs']) {
    fs.copyFileSync(
      path.join(repoRoot, 'core', 'scripts', 'lib', file),
      path.join(somaHome, 'scripts', 'lib', file)
    );
  }
  // Setup lab CLAUDE.md with cbm soma-v2 anchor
  const claudeMd = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(claudeMd, [
    '# CLAUDE',
    '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=oldhash -->',
    'cbm block content',
    '<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->',
    '# After',
  ].join('\n'));
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd, codexAgents: null, homeAgents: null },
    dryRun: false,
    force: false,
  });
  assert.equal(result.action, 'completed');
  assert.equal(result.gates.G1, 'pass');
  // Verify post-state: snapshot created
  assert.ok(result.snapshotId, 'snapshotId returned');
  const snapshotDir = path.join(somaHome, '.snapshots', result.snapshotId);
  assert.ok(fs.existsSync(snapshotDir), 'snapshot dir created');
  // Verify cbm anchor renamed in claudeMd
  const afterContent = fs.readFileSync(claudeMd, 'utf8');
  assert.doesNotMatch(afterContent, /id=block\.claude\.CLAUDE_md\.cbm/, 'cbm anchor removed');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateCbmDeprecation: G3 contentMismatch fires via orchestrator path (RED → W-B-3)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-orch-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'scripts', 'lib'), { recursive: true });
  // Copy real frozen libs so G6 passes
  const repoRoot = path.resolve(__dirname, '../../..');
  for (const file of ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs']) {
    fs.copyFileSync(
      path.join(repoRoot, 'core', 'scripts', 'lib', file),
      path.join(somaHome, 'scripts', 'lib', file)
    );
  }
  // Write spec source doc with CANONICAL content
  fs.writeFileSync(path.join(somaHome, 'docs', 'codebase-memory-mcp.md'), '# Canonical MCP doc content');
  // Setup lab with HAND-EDITED MCP content (drift from canonical)
  const labCodex = path.join(tmpDir, 'codex-AGENTS.md');
  fs.writeFileSync(labCodex, [
    '<!-- codebase-memory-mcp:start -->',
    '# HAND-EDITED different MCP doc',
    '<!-- codebase-memory-mcp:end -->',
  ].join('\n'));
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd: null, codexAgents: labCodex, homeAgents: null },
    dryRun: false,
    force: false,
  });
  assert.equal(result.action, 'abort', 'must abort on contentMismatch via orchestrator path');
  assert.ok(result.failures.some(f => /G3/.test(f)), 'failures must mention G3');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateCbmDeprecation: G3 bypassed with --force (W-B-3)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-force-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'scripts', 'lib'), { recursive: true });
  const repoRoot = path.resolve(__dirname, '../../..');
  for (const file of ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs']) {
    fs.copyFileSync(
      path.join(repoRoot, 'core', 'scripts', 'lib', file),
      path.join(somaHome, 'scripts', 'lib', file)
    );
  }
  fs.writeFileSync(path.join(somaHome, 'docs', 'codebase-memory-mcp.md'), '# Canonical MCP doc content');
  const labCodex = path.join(tmpDir, 'codex-AGENTS.md');
  // Legacy marker with DIFFERENT content → would trigger G3
  fs.writeFileSync(labCodex, [
    '<!-- codebase-memory-mcp:start -->',
    '# HAND-EDITED different MCP doc',
    '<!-- codebase-memory-mcp:end -->',
  ].join('\n'));
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd: null, codexAgents: labCodex, homeAgents: null },
    dryRun: false,
    force: true,  // --force bypasses G3
  });
  assert.notEqual(result.action, 'abort', 'G3 must be bypassed with --force');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateCbmDeprecation: cleans .migration.lock on rollback path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-rollback-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  fs.mkdirSync(path.join(somaHome, 'scripts', 'lib'), { recursive: true });
  // Real frozen libs so G6 passes
  const repoRoot = path.resolve(__dirname, '../../..');
  for (const file of ['anchored-blocks.cjs', 'manifest.cjs', 'template-engine.cjs']) {
    fs.copyFileSync(path.join(repoRoot, 'core', 'scripts', 'lib', file), path.join(somaHome, 'scripts', 'lib', file));
  }
  // Setup minimal lab with cbm anchor to trigger migration path
  const labClaude = path.join(tmpDir, 'CLAUDE.md');
  fs.writeFileSync(labClaude, '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=x -->\nbody\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->');
  // Force verifyMigration to throw by installing a doctor.cjs that exits non-zero
  fs.mkdirSync(path.join(somaHome, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'scripts', 'doctor.cjs'), [
    '#!/usr/bin/env node',
    "console.error('forced crash for N3 rollback test');",
    'process.exit(2);',
  ].join('\n'));
  const result = lib.migrateCbmDeprecation({
    somaHome,
    target: { claudeMd: labClaude, codexAgents: null, homeAgents: null },
  });
  assert.equal(result.action, 'rolled-back', 'should rollback on verify failure');
  assert.ok(!fs.existsSync(path.join(somaHome, '.migration.lock')), 'lock cleaned post-rollback (finally block)');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createMigrationSnapshot: returns null snapshotId when files array empty', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-snap-test-'));
  const somaHome = path.join(tmpDir, '.soma-v2');
  fs.mkdirSync(path.join(somaHome, '.snapshots'), { recursive: true });
  const result = lib.createMigrationSnapshot(somaHome, []);
  assert.equal(result, null, 'empty files → null snapshotId');
  // Verify no snapshot dir created
  const snapshots = fs.readdirSync(path.join(somaHome, '.snapshots'));
  assert.equal(snapshots.length, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractMcpContentFromLab: aborts when multiple start markers detected', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-marker-test-'));
  const fixture = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(fixture, [
    '<!-- codebase-memory-mcp:start -->',
    'first content',
    '<!-- codebase-memory-mcp:end -->',
    '<!-- codebase-memory-mcp:start -->',
    'second content',
    '<!-- codebase-memory-mcp:end -->',
  ].join('\n'));
  // Should throw with explicit error indicator
  assert.throws(() => lib.extractMcpContentFromLab(fixture), /multiple|duplicate/i);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('verifyMigration: aborts with timeout when doctor.cjs hangs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-timeout-test-'));
  const scriptsDir = path.join(tmpDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  // Stub doctor.cjs that hangs (sleep forever)
  fs.writeFileSync(path.join(scriptsDir, 'doctor.cjs'), `#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n`);
  const start = Date.now();
  const result = lib.verifyMigration(tmpDir);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 35000, `should timeout within 35s, took ${elapsed}ms`);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => /timeout|killed|hung/i.test(f)));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
