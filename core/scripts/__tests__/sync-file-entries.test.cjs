'use strict';
/**
 * sync-file-entries.test.cjs — T-07 GREEN phase
 *
 * Wires install/files.cjs (T-01) into sync.cjs for kind:"file" entries:
 * byte-for-byte copy (AC-01), coexistence with block entries without
 * altering their behavior (AC-02), overwrite-clean-without-asking (AC-03),
 * two-pass abort-total on any divergence (AC-04), and the ownership
 * invariant — only declared targets are ever touched (AC-05). T-07 also
 * owns the symlink/escape guard on the real write (no earlier task
 * performs a write).
 *
 * Uses ONLY synthetic fixtures — never the real install-targets.json (that
 * is T-08's job) and never $HOME/.claude or $HOME/.soma-v2. Fixtures live
 * under a fresh /tmp dir per test file (Article III: real fs, zero mocks;
 * os.tmpdir() on this Mac is NOT /tmp — /tmp is used directly here,
 * matching sync-bf06-abort.test.cjs's own convention for this suite,
 * because it's an explicit path this test controls end-to-end, not a
 * default this test would silently inherit).
 *
 * AC-02's stronger claim — that block findings/writes are BYTE-IDENTICAL
 * to what sync.cjs produced before this task touched it — is proven
 * separately (git-show of the pre-T-07 sync.cjs run against an
 * independent copy of the same block-only fixture, output diffed byte for
 * byte; see the final report's "PROVA DO AC-02" section). What THIS file
 * proves is the durable regression surface: a block entry's action/message
 * stay what they'd be without any file entries present, in a suite that
 * keeps running after this task closes.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05]
 * @contract CONTRACT-FILE-ENTRY-01
 * @contract CONTRACT-FILES-LEDGER-02
 * @task T-07
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SYNC_CJS = path.resolve(__dirname, '..', 'sync.cjs');
const FIXTURE_BASE = `/tmp/soma-test-file-entries-${process.pid}`;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function runSync(args, envOverrides) {
  return spawnSync('node', [SYNC_CJS, ...args], {
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 15000,
  });
}

/**
 * Build a fixture soma-home with a `claude` adapter whose install-targets
 * entries are exactly `entries` (already fully formed — caller decides
 * kind/source_path/target_path per test). `sourceFiles` populates
 * `<somaHome>/<relPath>` for each `[relPath, content]` pair — that is what
 * kind:"file" entries' source_path resolves against (planFileInstallSafe
 * uses repoRoot=somaHome, matching how block source_doc already resolves
 * against somaHome in computeEntryAction).
 *
 * @returns {{ somaHome: string, targetsDir: string }}
 */
function createFixture(name, { entries, sourceFiles = [] }) {
  const fixtureDir = path.join(FIXTURE_BASE, name);
  const somaHome = path.join(fixtureDir, 'soma-home');
  const targetsDir = path.join(fixtureDir, 'targets');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(targetsDir, { recursive: true });

  fs.writeFileSync(path.join(somaHome, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));

  for (const [relPath, content] of sourceFiles) {
    const abs = path.join(somaHome, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const adapterDir = path.join(somaHome, 'adapters', 'claude');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'claude',
    entries,
  }, null, 2));

  return { somaHome, targetsDir, fixtureDir };
}

function fileEntry(sourceRel, targetAbs) {
  return { kind: 'file', source_path: sourceRel, target_path: targetAbs };
}

// ── AC-01: byte-for-byte copy on first install ─────────────────────────────

test('AC-01: kind:"file" entry with no prior install copies source to target byte-for-byte', () => {
  const content = 'module.exports = { guard: true };\n';
  const targetPath = path.join(FIXTURE_BASE, 'ac01-not-yet-created', 'framework-guard.cjs');
  const { somaHome } = createFixture('ac01', {
    sourceFiles: [['hooks/framework-guard.cjs', content]],
    entries: [fileEntry('hooks/framework-guard.cjs', targetPath)],
  });

  const dry = runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`]);
  const dryOut = JSON.parse(dry.stdout);
  const finding = dryOut.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'insert', `expected insert for a never-installed file, got: ${JSON.stringify(finding)}`);

  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(apply.status, 0, `apply should succeed: stdout=${apply.stdout} stderr=${apply.stderr}`);
  assert.equal(fs.existsSync(targetPath), true, 'target must exist after apply');
  assert.deepEqual(fs.readFileSync(targetPath), Buffer.from(content), 'target content must be byte-identical to source');
});

// ── AC-02: coexistence — block entry's finding is unaffected by file entries ──

test('AC-02: block entry finding (action + message) is identical whether or not file entries share the array', () => {
  const blockSourceContent = '# block content';
  const blockTargetPath = path.join(FIXTURE_BASE, 'ac02-target', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(blockTargetPath), { recursive: true });
  // Target already in sync with source -> block finding should be 'skip'.
  const blockSha = sha256(blockSourceContent);
  fs.writeFileSync(blockTargetPath,
    `<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 sha256=${blockSha} -->\n${blockSourceContent}\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->\n`);

  const blockOnlyEntries = [
    { block_id: 'block.claude.CLAUDE_md.cbm', source_doc: 'docs/cbm.md', target_path: blockTargetPath, target_anchor_id: 'block.claude.CLAUDE_md.cbm' },
  ];
  const { somaHome: somaHomeBlockOnly } = createFixture('ac02-block-only', {
    sourceFiles: [['docs/cbm.md', `<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 -->\n${blockSourceContent}\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->`]],
    entries: blockOnlyEntries,
  });
  const dryBlockOnly = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHomeBlockOnly}`]).stdout);

  const fileContent = 'module.exports = {};\n';
  const fileTargetPath = path.join(FIXTURE_BASE, 'ac02-target-mixed', 'hook.cjs');
  const mixedEntries = [
    { block_id: 'block.claude.CLAUDE_md.cbm', source_doc: 'docs/cbm.md', target_path: blockTargetPath, target_anchor_id: 'block.claude.CLAUDE_md.cbm' },
    fileEntry('hooks/hook.cjs', fileTargetPath),
  ];
  const { somaHome: somaHomeMixed } = createFixture('ac02-mixed', {
    sourceFiles: [
      ['docs/cbm.md', `<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 -->\n${blockSourceContent}\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->`],
      ['hooks/hook.cjs', fileContent],
    ],
    entries: mixedEntries,
  });
  const dryMixed = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHomeMixed}`]).stdout);

  const blockFindingAlone = dryBlockOnly.findings.find((f) => f.target_anchor_id === 'block.claude.CLAUDE_md.cbm');
  const blockFindingMixed = dryMixed.findings.find((f) => f.target_anchor_id === 'block.claude.CLAUDE_md.cbm');
  assert.equal(blockFindingMixed.action, blockFindingAlone.action, 'block action must be identical with or without file entries present');
  assert.equal(blockFindingMixed.action, 'skip', 'sanity: this fixture is set up so the block is already in sync');
  assert.equal(blockFindingMixed.message, blockFindingAlone.message, 'block message must be identical with or without file entries present');

  const fileFinding = dryMixed.findings.find((f) => f.kind === 'file');
  assert.ok(fileFinding, 'the file entry must also produce a finding');
  assert.equal(fileFinding.action, 'insert', 'file entry uses the SAME action vocabulary as block entries');
  assert.ok(['insert', 'replace', 'skip', 'drift'].includes(fileFinding.action), 'file action must be one of the shared vocabulary values');
});

// ── AC-03: clean + source changed -> overwritten without asking ───────────

test('AC-03: installed file with source changed since install is overwritten without confirmation', () => {
  const oldContent = 'module.exports = { v: 1 };\n';
  const newContent = 'module.exports = { v: 2 };\n';
  const targetPath = path.join(FIXTURE_BASE, 'ac03-target', 'hook.cjs');
  const { somaHome } = createFixture('ac03', {
    sourceFiles: [['hooks/hook.cjs', oldContent]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  // First install.
  let apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(apply.status, 0, `first apply should succeed: ${apply.stdout} ${apply.stderr}`);
  assert.deepEqual(fs.readFileSync(targetPath), Buffer.from(oldContent));

  // Source changes in the repo; target on disk is untouched by the user.
  fs.writeFileSync(path.join(somaHome, 'hooks', 'hook.cjs'), newContent);

  const dry = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`]).stdout);
  const finding = dry.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'replace', 'source changed since install -> replace, not insert or drift');

  apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(apply.status, 0, `second apply should succeed without any prompt/flag: ${apply.stdout} ${apply.stderr}`);
  assert.deepEqual(fs.readFileSync(targetPath), Buffer.from(newContent), 'target must now match the NEW source content');
});

// ── AC-04: any divergence aborts the whole file install — zero writes ─────

test('AC-04: one diverged file among several aborts the entire file apply — nothing is written, not even the clean ones', () => {
  const cleanContent = 'module.exports = { clean: true };\n';
  const otherContent = 'module.exports = { other: true };\n';
  const cleanTarget = path.join(FIXTURE_BASE, 'ac04-clean', 'clean-hook.cjs');
  const divergedTarget = path.join(FIXTURE_BASE, 'ac04-diverged', 'foreign-hook.cjs');
  fs.mkdirSync(path.dirname(divergedTarget), { recursive: true });
  // Present on disk, but SOMA never installed it (no ledger entry) -> diverged.
  fs.writeFileSync(divergedTarget, 'a user already had this file before SOMA existed\n');

  const { somaHome } = createFixture('ac04', {
    sourceFiles: [
      ['hooks/clean-hook.cjs', cleanContent],
      ['hooks/foreign-hook.cjs', otherContent],
    ],
    entries: [
      fileEntry('hooks/clean-hook.cjs', cleanTarget),
      fileEntry('hooks/foreign-hook.cjs', divergedTarget),
    ],
  });

  const beforeDiverged = fs.readFileSync(divergedTarget);
  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);

  assert.equal(apply.status, 2, `expected exit 2 on file divergence, got ${apply.status}. stdout=${apply.stdout} stderr=${apply.stderr}`);
  const out = JSON.parse(apply.stdout);
  assert.equal(out.error.code, 'FILE_CONFLICT');
  assert.deepEqual(out.error.details.diverged, [divergedTarget]);

  assert.equal(fs.existsSync(cleanTarget), false, 'the CLEAN sibling must NOT be written — abort is total, not per-file');
  assert.deepEqual(fs.readFileSync(divergedTarget), beforeDiverged, 'the diverged target itself must be left byte-for-byte untouched');
});

// ── AC-05: ownership invariant — undeclared files are never touched ───────

test('AC-05: files inside the same target directory that no entry declares are left intact after apply', () => {
  const declaredContent = 'module.exports = { declared: true };\n';
  const targetsDir = path.join(FIXTURE_BASE, 'ac05-hooks-dir');
  fs.mkdirSync(targetsDir, { recursive: true });
  const undeclaredFile = path.join(targetsDir, 'user-owns-this.cjs');
  const undeclaredContent = 'module.exports = { userHookNeverDeclaredBySoma: true };\n';
  fs.writeFileSync(undeclaredFile, undeclaredContent);

  const declaredTarget = path.join(targetsDir, 'declared-hook.cjs');
  const { somaHome } = createFixture('ac05', {
    sourceFiles: [['hooks/declared-hook.cjs', declaredContent]],
    entries: [fileEntry('hooks/declared-hook.cjs', declaredTarget)],
  });

  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(apply.status, 0, `apply should succeed: ${apply.stdout} ${apply.stderr}`);

  assert.deepEqual(fs.readFileSync(undeclaredFile), Buffer.from(undeclaredContent), 'undeclared sibling file must be byte-for-byte unchanged');
  assert.deepEqual(fs.readFileSync(declaredTarget), Buffer.from(declaredContent), 'declared file must have been installed');
  const dirListing = fs.readdirSync(targetsDir).sort();
  assert.deepEqual(dirListing, ['declared-hook.cjs', 'user-owns-this.cjs'], 'no extra/removed files — install never scans or mirrors the directory');
});

// ── Idempotency: second apply with no repo changes writes nothing ─────────

test('idempotency: running --apply twice with no source changes performs zero writes on the second run', () => {
  const content = 'module.exports = { stable: true };\n';
  const targetPath = path.join(FIXTURE_BASE, 'idempotency-target', 'hook.cjs');
  const { somaHome } = createFixture('idempotency', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  const first = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(first.status, 0);
  const firstOut = JSON.parse(first.stdout);
  assert.equal(firstOut.summary.files_touched.length >= 0, true); // sanity: block summary unaffected either way

  const mtimeBefore = fs.statSync(targetPath).mtimeMs;

  const dry = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`]).stdout);
  const finding = dry.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'skip', 'second run with no repo changes must classify the file as skip');

  const second = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(second.status, 0);
  const mtimeAfter = fs.statSync(targetPath).mtimeMs;
  assert.equal(mtimeAfter, mtimeBefore, 'file must not have been rewritten on the second, no-op apply');
});

// ── Symlink guard (T-07-owned NFR) ─────────────────────────────────────────

test('symlink guard: a target_path that already exists as a symlink is refused, never written through', () => {
  const content = 'module.exports = {};\n';
  const outsideDir = path.join(FIXTURE_BASE, 'symlink-outside');
  const targetsDir = path.join(FIXTURE_BASE, 'symlink-target-dir');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.mkdirSync(targetsDir, { recursive: true });
  const outsideFile = path.join(outsideDir, 'real-file-elsewhere.cjs');
  fs.writeFileSync(outsideFile, 'ORIGINAL CONTENT OUTSIDE THE DECLARED DIRECTORY\n');
  const targetPath = path.join(targetsDir, 'hook.cjs');
  fs.symlinkSync(outsideFile, targetPath);

  const { somaHome } = createFixture('symlink', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  const dry = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`]).stdout);
  const finding = dry.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'drift', 'a symlinked target must be treated as diverged/drift even before any write is attempted');

  const beforeOutside = fs.readFileSync(outsideFile);
  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`]);
  assert.equal(apply.status, 2, `expected abort on symlinked target: ${apply.stdout} ${apply.stderr}`);
  const out = JSON.parse(apply.stdout);
  assert.equal(out.error.code, 'FILE_CONFLICT');

  assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), true, 'the symlink itself must still be a symlink (never replaced with a regular file)');
  assert.deepEqual(fs.readFileSync(outsideFile), beforeOutside, 'the file the symlink points to must be byte-for-byte untouched — write must never follow the symlink');
});

// ── Ledger key stays verbatim (~-prefixed), never expanded ────────────────

test('ledger key: a ~-prefixed target_path is recorded verbatim in the ledger, not expanded', () => {
  const content = 'module.exports = {};\n';
  const fakeHomeDir = path.join(FIXTURE_BASE, 'verbatim-fake-home');
  fs.mkdirSync(fakeHomeDir, { recursive: true });
  const relTarget = '.claude/hooks/hook.cjs';
  const tildeTargetPath = `~/${relTarget}`;

  const { somaHome } = createFixture('verbatim-key', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', tildeTargetPath)],
  });

  const apply = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`],
    { HOME: fakeHomeDir }
  );
  assert.equal(apply.status, 0, `apply should succeed: ${apply.stdout} ${apply.stderr}`);
  assert.deepEqual(fs.readFileSync(path.join(fakeHomeDir, relTarget)), Buffer.from(content), 'file must land at the ~-expanded real path on disk');

  const ledgerPath = path.join(somaHome, '.soma', 'install-state.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.ok(
    Object.prototype.hasOwnProperty.call(ledger.installedFiles, tildeTargetPath),
    `ledger key must be the verbatim "${tildeTargetPath}" string, not the expanded path. Keys present: ${Object.keys(ledger.installedFiles).join(', ')}`
  );
});
