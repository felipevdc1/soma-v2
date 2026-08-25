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
const TRANSACTION_CJS = path.resolve(__dirname, '..', '..', '..', 'install', 'global-transaction.cjs');
const transaction = require(TRANSACTION_CJS);
const FIXTURE_BASE = `/tmp/soma-test-file-entries-${process.pid}`;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function runSync(args, envOverrides, spawnOptOverrides) {
  return spawnSync('node', [SYNC_CJS, ...args], {
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 15000,
    ...spawnOptOverrides,
  });
}

/**
 * Build a fixture soma-home with a `claude` adapter whose install-targets
 * entries are exactly `entries` (already fully formed — caller decides
 * kind/source_path/target_path per test). `sourceFiles` populates
 * `<somaHome>/<relPath>` for each `[relPath, content]` pair — that is what
 * kind:"file" entries' source_path resolves against (planFileInstallSafe
 * uses repoRoot=somaHome, matching how block source_doc already resolves
 * against somaHome in computeEntryAction — that did NOT change).
 *
 * Also builds `projectDir`, a directory DISTINCT from `somaHome` — the
 * ledger root fix (this commit) makes the file-entry ledger land at
 * `process.cwd()`, not `--soma-home`, matching how install.cjs invokes
 * sync.cjs (`cwd: projectPathAbs`, never `somaHome`). Every runSync() call
 * that applies (writes) or reads back ledger state MUST pass
 * `{ cwd: projectDir }` explicitly — spawnSync without an explicit `cwd`
 * inherits the test runner's OWN cwd, which would write `.soma/` into
 * wherever `npm test` happens to run from. Two SEPARATE directories here
 * is deliberate, not incidental: a test that (by accident) used the same
 * dir for both would pass even with the old, wrong code.
 *
 * @returns {{ somaHome: string, targetsDir: string, projectDir: string }}
 */
function createFixture(name, { entries, sourceFiles = [] }) {
  const fixtureDir = path.join(FIXTURE_BASE, name);
  const somaHome = path.join(fixtureDir, 'soma-home');
  const targetsDir = path.join(fixtureDir, 'targets');
  const projectDir = path.join(fixtureDir, 'project');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.mkdirSync(targetsDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

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

  return { somaHome, targetsDir, projectDir, fixtureDir };
}

function fileEntry(sourceRel, targetAbs) {
  return { kind: 'file', source_path: sourceRel, target_path: targetAbs };
}

// ── AC-01: byte-for-byte copy on first install ─────────────────────────────

test('AC-01: kind:"file" entry with no prior install copies source to target byte-for-byte', () => {
  const content = 'module.exports = { guard: true };\n';
  const targetPath = path.join(FIXTURE_BASE, 'ac01-not-yet-created', 'framework-guard.cjs');
  const { somaHome, projectDir } = createFixture('ac01', {
    sourceFiles: [['hooks/framework-guard.cjs', content]],
    entries: [fileEntry('hooks/framework-guard.cjs', targetPath)],
  });

  const dry = runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
  const dryOut = JSON.parse(dry.stdout);
  const finding = dryOut.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'insert', `expected insert for a never-installed file, got: ${JSON.stringify(finding)}`);

  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
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
  const { somaHome: somaHomeBlockOnly, projectDir: projectDirBlockOnly } = createFixture('ac02-block-only', {
    sourceFiles: [['docs/cbm.md', `<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 -->\n${blockSourceContent}\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->`]],
    entries: blockOnlyEntries,
  });
  const dryBlockOnly = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHomeBlockOnly}`], {}, { cwd: projectDirBlockOnly }).stdout);

  const fileContent = 'module.exports = {};\n';
  const fileTargetPath = path.join(FIXTURE_BASE, 'ac02-target-mixed', 'hook.cjs');
  const mixedEntries = [
    { block_id: 'block.claude.CLAUDE_md.cbm', source_doc: 'docs/cbm.md', target_path: blockTargetPath, target_anchor_id: 'block.claude.CLAUDE_md.cbm' },
    fileEntry('hooks/hook.cjs', fileTargetPath),
  ];
  const { somaHome: somaHomeMixed, projectDir: projectDirMixed } = createFixture('ac02-mixed', {
    sourceFiles: [
      ['docs/cbm.md', `<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 -->\n${blockSourceContent}\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->`],
      ['hooks/hook.cjs', fileContent],
    ],
    entries: mixedEntries,
  });
  const dryMixed = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHomeMixed}`], {}, { cwd: projectDirMixed }).stdout);

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
  const { somaHome, projectDir } = createFixture('ac03', {
    sourceFiles: [['hooks/hook.cjs', oldContent]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  // First install.
  let apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
  assert.equal(apply.status, 0, `first apply should succeed: ${apply.stdout} ${apply.stderr}`);
  assert.deepEqual(fs.readFileSync(targetPath), Buffer.from(oldContent));

  // Source changes in the repo; target on disk is untouched by the user.
  fs.writeFileSync(path.join(somaHome, 'hooks', 'hook.cjs'), newContent);

  const dry = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`], {}, { cwd: projectDir }).stdout);
  const finding = dry.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'replace', 'source changed since install -> replace, not insert or drift');

  apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
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

  const { somaHome, projectDir } = createFixture('ac04', {
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
  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });

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
  const { somaHome, projectDir } = createFixture('ac05', {
    sourceFiles: [['hooks/declared-hook.cjs', declaredContent]],
    entries: [fileEntry('hooks/declared-hook.cjs', declaredTarget)],
  });

  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
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
  const { somaHome, projectDir } = createFixture('idempotency', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  const first = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
  assert.equal(first.status, 0);
  const firstOut = JSON.parse(first.stdout);
  assert.equal(firstOut.summary.files_touched.length >= 0, true); // sanity: block summary unaffected either way

  const mtimeBefore = fs.statSync(targetPath).mtimeMs;

  const dry = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`], {}, { cwd: projectDir }).stdout);
  const finding = dry.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'skip', 'second run with no repo changes must classify the file as skip');

  const second = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
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

  const { somaHome, projectDir } = createFixture('symlink', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  const dry = JSON.parse(runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`], {}, { cwd: projectDir }).stdout);
  const finding = dry.findings.find((f) => f.kind === 'file');
  assert.equal(finding.action, 'drift', 'a symlinked target must be treated as diverged/drift even before any write is attempted');

  const beforeOutside = fs.readFileSync(outsideFile);
  const apply = runSync(['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
  assert.equal(apply.status, 2, `expected abort on symlinked target: ${apply.stdout} ${apply.stderr}`);
  const out = JSON.parse(apply.stdout);
  assert.equal(out.error.code, 'FILE_CONFLICT');

  assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), true, 'the symlink itself must still be a symlink (never replaced with a regular file)');
  assert.deepEqual(fs.readFileSync(outsideFile), beforeOutside, 'the file the symlink points to must be byte-for-byte untouched — write must never follow the symlink');
});

// ── Ledger root is process.cwd(), never --soma-home ────────────────────────
//
// Reopened T-07: the ledger was landing at --soma-home (the repo/adapters
// root), not process.cwd() (the project the user is actually installing
// into). install.cjs always invokes sync.cjs with `cwd: projectPathAbs`
// and `--soma-home=SOURCE_CORE` (the repo dir) — two DIFFERENT
// directories in every real invocation — so the old code wrote
// install-state.json under the repo, not the project, silently splitting
// the ledger install.cjs and sync.cjs each believe they own. Caught by
// T-05 (install-files-ledger.test.cjs, skipped case "T-05-06"), which
// could not fix it without touching sync.cjs (out of T-05's scope).
//
// somaHome and projectDir must be DIFFERENT directories on purpose — if a
// test used the same dir for both, it would pass even with the old, wrong
// code (the very trap the orchestrator named when reopening this task).

test('ledger root: install-state.json for kind:"file" entries lands at process.cwd() (the project dir), never at --soma-home', () => {
  const content = 'module.exports = {};\n';
  const targetPath = path.join(FIXTURE_BASE, 'ledger-root-target', 'hook.cjs');
  const { somaHome, projectDir } = createFixture('ledger-root', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });

  assert.notEqual(
    path.resolve(projectDir), path.resolve(somaHome),
    'sanity: cwd and --soma-home must be DIFFERENT directories, or this test proves nothing'
  );

  const apply = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`],
    {},
    { cwd: projectDir }
  );
  assert.equal(apply.status, 0, `apply should succeed: ${apply.stdout} ${apply.stderr}`);

  const ledgerAtCwd = path.join(projectDir, '.soma', 'install-state.json');
  const ledgerAtSomaHome = path.join(somaHome, '.soma', 'install-state.json');
  assert.equal(
    fs.existsSync(ledgerAtCwd), true,
    `ledger must be written at process.cwd() (${projectDir}), the project dir — matching how install.cjs invokes sync.cjs with cwd: projectPathAbs`
  );
  assert.equal(
    fs.existsSync(ledgerAtSomaHome), false,
    `ledger must NOT be written at --soma-home (${somaHome}) — that is where adapters/source_doc live, not the project ledger`
  );
});

test('ledger root: an explicit absolute root is shared by apply and dry-run across two cwd values', () => {
  const content = 'module.exports = { global: true };\n';
  const targetPath = path.join(FIXTURE_BASE, 'explicit-ledger-root-target', 'hook.cjs');
  const { somaHome, fixtureDir } = createFixture('explicit-ledger-root', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });
  const projectA = path.join(fixtureDir, 'project-a');
  const projectB = path.join(fixtureDir, 'project-b');
  const globalRoot = path.join(fixtureDir, 'global-root');
  const fakeHome = path.join(fixtureDir, 'fake-home');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });

  const first = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`, `--ledger-root=${globalRoot}`],
    { HOME: fakeHome },
    { cwd: projectA }
  );
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

  const dry = runSync(
    ['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`, '--ledger-root', globalRoot],
    { HOME: fakeHome },
    { cwd: projectB }
  );
  assert.equal(dry.status, 0, `${dry.stdout}\n${dry.stderr}`);
  const dryFinding = JSON.parse(dry.stdout).findings.find((finding) => finding.kind === 'file');
  assert.equal(dryFinding.action, 'skip', 'dry-run in project B must read the ownership written by apply in project A');

  const second = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`, '--ledger-root', globalRoot],
    { HOME: fakeHome },
    { cwd: projectB }
  );
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(fs.existsSync(path.join(globalRoot, '.soma', 'install-state.json')), true);
  assert.equal(fs.existsSync(path.join(projectA, '.soma', 'install-state.json')), false);
  assert.equal(fs.existsSync(path.join(projectB, '.soma', 'install-state.json')), false);
});

test('ledger root: a relative path returns INVALID_ARGS and writes nothing', () => {
  const targetPath = path.join(FIXTURE_BASE, 'relative-ledger-root-target', 'hook.cjs');
  const { somaHome, projectDir, fixtureDir } = createFixture('relative-ledger-root', {
    sourceFiles: [['hooks/hook.cjs', 'module.exports = {};\n']],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });
  const fakeHome = path.join(fixtureDir, 'fake-home');
  fs.mkdirSync(fakeHome, { recursive: true });

  const apply = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`, '--ledger-root=relative-root'],
    { HOME: fakeHome },
    { cwd: projectDir }
  );
  assert.equal(apply.status, 2, `${apply.stdout}\n${apply.stderr}`);
  const out = JSON.parse(apply.stdout);
  assert.equal(out.error.code, 'INVALID_ARGS');
  assert.match(out.error.message, /ledger root must be absolute/);
  assert.equal(fs.existsSync(targetPath), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'relative-root')), false);
  assert.equal(fs.existsSync(path.join(projectDir, '.soma')), false);
});

test('ledger root: an existing symlink returns INVALID_ARGS and writes nothing', () => {
  const targetPath = path.join(FIXTURE_BASE, 'symlink-ledger-root-target', 'hook.cjs');
  const { somaHome, projectDir, fixtureDir } = createFixture('symlink-ledger-root', {
    sourceFiles: [['hooks/hook.cjs', 'module.exports = {};\n']],
    entries: [fileEntry('hooks/hook.cjs', targetPath)],
  });
  const fakeHome = path.join(fixtureDir, 'fake-home');
  const realRoot = path.join(fixtureDir, 'real-root');
  const symlinkRoot = path.join(fixtureDir, 'root-link');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(realRoot, { recursive: true });
  fs.symlinkSync(realRoot, symlinkRoot);

  const apply = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`, `--ledger-root=${symlinkRoot}`],
    { HOME: fakeHome },
    { cwd: projectDir }
  );
  assert.equal(apply.status, 2, `${apply.stdout}\n${apply.stderr}`);
  const out = JSON.parse(apply.stdout);
  assert.equal(out.error.code, 'INVALID_ARGS');
  assert.match(out.error.message, /ledger root must not be a symlink/);
  assert.equal(fs.existsSync(targetPath), false);
  assert.equal(fs.existsSync(path.join(realRoot, '.soma')), false);
  assert.equal(fs.existsSync(path.join(projectDir, '.soma')), false);
});

// ── Ledger key stays verbatim (~-prefixed), never expanded ────────────────

test('ledger key: a ~-prefixed target_path is recorded verbatim in the ledger, not expanded', () => {
  const content = 'module.exports = {};\n';
  const fakeHomeDir = path.join(FIXTURE_BASE, 'verbatim-fake-home');
  fs.mkdirSync(fakeHomeDir, { recursive: true });
  const relTarget = '.claude/hooks/hook.cjs';
  const tildeTargetPath = `~/${relTarget}`;

  const { somaHome, projectDir } = createFixture('verbatim-key', {
    sourceFiles: [['hooks/hook.cjs', content]],
    entries: [fileEntry('hooks/hook.cjs', tildeTargetPath)],
  });

  const apply = runSync(
    ['--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`],
    { HOME: fakeHomeDir },
    { cwd: projectDir }
  );
  assert.equal(apply.status, 0, `apply should succeed: ${apply.stdout} ${apply.stderr}`);
  assert.deepEqual(fs.readFileSync(path.join(fakeHomeDir, relTarget)), Buffer.from(content), 'file must land at the ~-expanded real path on disk');

  // Ledger root fix: the ledger lives at process.cwd() (projectDir), NOT
  // --soma-home — matching how install.cjs invokes sync.cjs
  // (cwd: projectPathAbs). See the "ledger root" test below for the
  // dedicated proof; this assertion only needed to move to the new
  // location to keep testing what it always meant to test (the KEY, not
  // the file's location).
  const ledgerPath = path.join(projectDir, '.soma', 'install-state.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.ok(
    Object.prototype.hasOwnProperty.call(ledger.installedFiles, tildeTargetPath),
    `ledger key must be the verbatim "${tildeTargetPath}" string, not the expanded path. Keys present: ${Object.keys(ledger.installedFiles).join(', ')}`
  );
});

// ── --targets-file mode: skipped file entries must be AUDIBLE ─────────────
//
// kind:"file" is out of scope for --targets-file mode (not part of the
// fixed CLI surface — see the comment above the skip in sync.cjs's
// --targets-file loop). The skip itself is correct and unchanged; what was
// missing is that it was silent. AC-10's own point at small scale: a mute
// `continue` reads, from the terminal, identically to "no file entries
// were present at all" — the same shape of bug that left 6 hooks invisible
// to `doctor` for 3 months. Requested by the orchestrator after reviewing
// T-07's GREEN commit.

function createTargetsFileFixture(name, { entries }) {
  const fixtureDir = path.join(FIXTURE_BASE, name);
  const somaHome = path.join(fixtureDir, 'soma-home');
  fs.mkdirSync(somaHome, { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));

  const targetsFilePath = path.join(fixtureDir, 'install-targets.custom.json');
  fs.writeFileSync(targetsFilePath, JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'claude',
    entries,
  }, null, 2));

  return { somaHome, targetsFilePath, fixtureDir };
}

test('--targets-file mode: a skipped kind:"file" entry emits an audible stderr warning naming its target_path', () => {
  const skippedTargetPath = path.join(FIXTURE_BASE, 'targets-file-warn', 'hook.cjs');
  const { somaHome, targetsFilePath } = createTargetsFileFixture('targets-file-warn', {
    entries: [fileEntry('hooks/hook.cjs', skippedTargetPath)],
  });

  const dry = runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`, `--targets-file=${targetsFilePath}`]);

  assert.match(dry.stderr, /WARNING \[FILE_ENTRY_UNSUPPORTED_IN_TARGETS_FILE_MODE\]/, `expected an audible warning on stderr, got: ${dry.stderr}`);
  assert.ok(dry.stderr.includes(skippedTargetPath), `warning must name the skipped entry's target_path. stderr: ${dry.stderr}`);

  // stdout must still be valid, parseable JSON — the warning must never
  // leak into stdout (install.cjs parses this stream).
  const out = JSON.parse(dry.stdout);
  assert.equal(out.tool, 'sync');
});

test('--targets-file mode: no warning is emitted when there are no kind:"file" entries to skip', () => {
  const blockTargetPath = path.join(FIXTURE_BASE, 'targets-file-no-warn', 'CLAUDE.md');
  const { somaHome, targetsFilePath } = createTargetsFileFixture('targets-file-no-warn', {
    entries: [
      { block_id: 'block.claude.CLAUDE_md.cbm', source_doc: 'docs/cbm.md', target_path: blockTargetPath, target_anchor_id: 'block.claude.CLAUDE_md.cbm' },
    ],
  });
  fs.mkdirSync(path.join(somaHome, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(somaHome, 'docs', 'cbm.md'), '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 -->\n# x\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->');

  const dry = runSync(['--dry-run', '--json', '--tool=claude', `--soma-home=${somaHome}`, `--targets-file=${targetsFilePath}`]);

  assert.equal(dry.stderr.includes('FILE_ENTRY_UNSUPPORTED_IN_TARGETS_FILE_MODE'), false, `no file entries present -> no warning expected. stderr: ${dry.stderr}`);
  const out = JSON.parse(dry.stdout);
  assert.equal(out.tool, 'sync');
});

// ── Spec 026: transaction-gated global adoption ───────────────────────────

function writeInstallTargets(root, entries) {
  const adapterDir = path.join(root, 'adapters', 'claude');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'claude',
    entries,
  }, null, 2));
}

function writeSourceFiles(root, sourceFiles) {
  for (const [relative, content] of sourceFiles) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}

function createAdoptionFixture(name, { previousEntries, candidateEntries, previousSources, candidateSources }) {
  const fixtureDir = path.join(FIXTURE_BASE, `adoption-${name}`);
  const repoRoot = path.join(fixtureDir, 'repo');
  const candidateRoot = path.join(repoRoot, 'core');
  const home = path.join(fixtureDir, 'home');
  const previousLiveRoot = path.join(home, '.soma-v2');
  const ledgerRoot = previousLiveRoot;
  const backupRoot = path.join(home, '.soma-v2-backups');
  fs.mkdirSync(candidateRoot, { recursive: true });
  fs.mkdirSync(previousLiveRoot, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(candidateRoot, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  fs.writeFileSync(path.join(previousLiveRoot, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.0.0', files: [] }));
  writeInstallTargets(candidateRoot, candidateEntries);
  writeInstallTargets(previousLiveRoot, previousEntries);
  writeSourceFiles(candidateRoot, candidateSources);
  writeSourceFiles(previousLiveRoot, previousSources);

  const prepared = transaction.prepareTransaction({
    repoRoot,
    home,
    backupRoot,
    sourceSha: 'e96e59f92d883f52c4b137b74fb27ea912c26bce',
    noCodex: true,
  });
  const journal = JSON.parse(fs.readFileSync(prepared.journal_path, 'utf8'));
  const previousRoot = journal.snapshots.find((snapshot) => snapshot.target_path === previousLiveRoot).snapshot_path;
  const ledgerPath = path.join(ledgerRoot, '.soma', 'install-state.json');
  return { fixtureDir, repoRoot, candidateRoot, home, previousRoot, ledgerRoot, ledgerPath, backupRoot, prepared };
}

function adoptionArgs(fx, extra = []) {
  return [
    '--apply',
    '--json',
    '--tool=claude',
    `--soma-home=${fx.candidateRoot}`,
    `--ledger-root=${fx.ledgerRoot}`,
    `--adopt-from=${fx.previousRoot}`,
    `--transaction-journal=${fx.prepared.journal_path}`,
    ...extra,
  ];
}

test('026 AC-03: adoption records proven old ownership without touching targets or blocks', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'adoption-old-identical');
  const target = path.join(fixtureDir, 'home', '.claude', 'hooks', 'old.cjs');
  const blockTarget = path.join(fixtureDir, 'home', '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'old bytes\n');
  fs.writeFileSync(blockTarget, 'user block file stays byte-identical\n');
  const oldFile = fileEntry('hooks/old.cjs', target);
  const blockEntry = {
    block_id: 'block.claude.CLAUDE_md.cbm',
    source_doc: 'docs/cbm.md',
    target_path: blockTarget,
    target_anchor_id: 'block.claude.CLAUDE_md.cbm',
  };
  const fx = createAdoptionFixture('old-identical', {
    previousEntries: [oldFile, blockEntry],
    candidateEntries: [oldFile, blockEntry],
    previousSources: [['hooks/old.cjs', 'old bytes\n'], ['docs/cbm.md', '# old block\n']],
    candidateSources: [['hooks/old.cjs', 'candidate bytes\n'], ['docs/cbm.md', '# candidate block\n']],
  });
  const targetBefore = fs.readFileSync(target);
  const blockBefore = fs.readFileSync(blockTarget);

  const result = runSync(adoptionArgs(fx), { HOME: fx.home }, { cwd: fx.repoRoot });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'adopt');
  assert.deepEqual(output.summary.adopted, [target]);
  assert.deepEqual(fs.readFileSync(target), targetBefore, 'adoption must not write the whole-file target');
  assert.deepEqual(fs.readFileSync(blockTarget), blockBefore, 'adoption must not enter the block pipeline');
  const ledger = JSON.parse(fs.readFileSync(fx.ledgerPath, 'utf8'));
  assert.equal(ledger.installedFiles[target].sha256, sha256('old bytes\n'));
});

test('026 AC-04: adoption names every old ownership conflict and writes no ledger or target', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'adoption-conflicts');
  const home = path.join(fixtureDir, 'home');
  const divergent = path.join(home, '.claude', 'hooks', 'divergent.cjs');
  const symlinked = path.join(home, '.claude', 'hooks', 'symlinked.cjs');
  const unreadable = path.join(home, '.claude', 'hooks', 'unreadable.cjs');
  const symlinkDestination = path.join(home, '.claude', 'hooks', 'destination.cjs');
  fs.mkdirSync(path.dirname(divergent), { recursive: true });
  fs.writeFileSync(divergent, 'user edit\n');
  fs.writeFileSync(symlinkDestination, 'old b\n');
  fs.writeFileSync(symlinked, 'old b\n');
  fs.writeFileSync(unreadable, 'old c\n');
  const entries = [
    fileEntry('hooks/a.cjs', divergent),
    fileEntry('hooks/b.cjs', symlinked),
    fileEntry('hooks/c.cjs', unreadable),
  ];
  const fx = createAdoptionFixture('conflicts', {
    previousEntries: entries,
    candidateEntries: entries,
    previousSources: [['hooks/a.cjs', 'old a\n'], ['hooks/b.cjs', 'old b\n'], ['hooks/c.cjs', 'old c\n']],
    candidateSources: [['hooks/a.cjs', 'new a\n'], ['hooks/b.cjs', 'new b\n'], ['hooks/c.cjs', 'new c\n']],
  });
  fs.unlinkSync(symlinked);
  fs.symlinkSync(symlinkDestination, symlinked);
  fs.unlinkSync(unreadable);
  fs.mkdirSync(unreadable);
  const divergentBefore = fs.readFileSync(divergent);
  const destinationBefore = fs.readFileSync(symlinkDestination);

  const result = runSync(adoptionArgs(fx), { HOME: fx.home }, { cwd: fx.repoRoot });

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.error.code, 'GLOBAL_OWNERSHIP_CONFLICT');
  assert.deepEqual(output.error.details.conflicts.sort(), [divergent, symlinked, unreadable].sort());
  assert.equal(fs.existsSync(fx.ledgerPath), false);
  assert.deepEqual(fs.readFileSync(divergent), divergentBefore);
  assert.deepEqual(fs.readFileSync(symlinkDestination), destinationBefore);
  assert.equal(fs.lstatSync(symlinked).isSymbolicLink(), true);
});

test('026 AC-05: a present new target needs force plus an exact PREPARED snapshot', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'adoption-new-target');
  const target = path.join(fixtureDir, 'home', '.claude', 'commands', 'new.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'foreign bytes captured before adoption\n');
  const fx = createAdoptionFixture('new-target', {
    previousEntries: [],
    candidateEntries: [fileEntry('commands/new.md', target)],
    previousSources: [],
    candidateSources: [['commands/new.md', 'candidate bytes\n']],
  });
  const before = fs.readFileSync(target);

  const denied = runSync(adoptionArgs(fx), { HOME: fx.home }, { cwd: fx.repoRoot });
  assert.equal(denied.status, 2, `${denied.stdout}\n${denied.stderr}`);
  assert.equal(JSON.parse(denied.stdout).error.code, 'GLOBAL_OWNERSHIP_CONFLICT');
  assert.equal(fs.existsSync(fx.ledgerPath), false);
  assert.deepEqual(fs.readFileSync(target), before);

  const allowed = runSync(adoptionArgs(fx, ['--allow-new-target-overwrite']), { HOME: fx.home }, { cwd: fx.repoRoot });
  assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`);
  const ledger = JSON.parse(fs.readFileSync(fx.ledgerPath, 'utf8'));
  assert.equal(ledger.installedFiles[target].sha256, sha256(before));
  assert.deepEqual(fs.readFileSync(target), before, 'authorized adoption records current bytes but never overwrites them');
});

test('026 AC-05: force fails RECOVERY_BLOCKED if live bytes no longer match the PREPARED snapshot', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'adoption-snapshot-mismatch');
  const target = path.join(fixtureDir, 'home', '.claude', 'commands', 'new.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'snapshotted bytes\n');
  const fx = createAdoptionFixture('snapshot-mismatch', {
    previousEntries: [],
    candidateEntries: [fileEntry('commands/new.md', target)],
    previousSources: [],
    candidateSources: [['commands/new.md', 'candidate bytes\n']],
  });
  fs.writeFileSync(target, 'changed after PREPARED\n');

  const result = runSync(adoptionArgs(fx, ['--allow-new-target-overwrite']), { HOME: fx.home }, { cwd: fx.repoRoot });

  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.error.code, 'RECOVERY_BLOCKED');
  assert.match(output.error.message, /snapshot|hash/i);
  assert.equal(fs.existsSync(fx.ledgerPath), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'changed after PREPARED\n');
});

test('026 AC-05: replacing transaction.json cannot mint adoption authority', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'adoption-compatibility-spoof');
  const target = path.join(fixtureDir, 'home', '.claude', 'commands', 'new.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'snapshotted bytes\n');
  const fx = createAdoptionFixture('compatibility-spoof', {
    previousEntries: [],
    candidateEntries: [fileEntry('commands/new.md', target)],
    previousSources: [],
    candidateSources: [['commands/new.md', 'candidate bytes\n']],
  });
  fs.writeFileSync(target, 'changed after PREPARED\n');
  const compatibility = JSON.parse(fs.readFileSync(fx.prepared.journal_path, 'utf8'));
  compatibility.snapshots.find((snapshot) => snapshot.target_path === target).sha256 = sha256('changed after PREPARED\n');
  fs.writeFileSync(fx.prepared.journal_path, `${JSON.stringify(compatibility, null, 2)}\n`);

  const result = runSync(adoptionArgs(fx, ['--allow-new-target-overwrite']), { HOME: fx.home }, { cwd: fx.repoRoot });

  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).error.code, 'RECOVERY_BLOCKED');
  assert.equal(fs.existsSync(fx.ledgerPath), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'changed after PREPARED\n');
});

test('026 AC-05: force fails RECOVERY_BLOCKED after the active journal leaves PREPARED', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'adoption-expired-prepared');
  const target = path.join(fixtureDir, 'home', '.claude', 'commands', 'new.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'snapshotted bytes\n');
  const fx = createAdoptionFixture('expired-prepared', {
    previousEntries: [],
    candidateEntries: [fileEntry('commands/new.md', target)],
    previousSources: [],
    candidateSources: [['commands/new.md', 'candidate bytes\n']],
  });
  transaction.advanceTransaction(fx.prepared.journal_path, 'ADOPTED');

  const result = runSync(adoptionArgs(fx, ['--allow-new-target-overwrite']), { HOME: fx.home }, { cwd: fx.repoRoot });

  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.error.code, 'RECOVERY_BLOCKED');
  assert.match(output.error.message, /PREPARED/);
  assert.equal(fs.existsSync(fx.ledgerPath), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'snapshotted bytes\n');
});

test('026 adoption requires --apply, --tool, --ledger-root and absolute journal paths', () => {
  const { somaHome, projectDir } = createFixture('adoption-invalid-cli', { entries: [] });
  const cases = [
    [['--dry-run', '--tool=claude', '--ledger-root=/tmp/ledger', '--adopt-from=/tmp/old', '--transaction-journal=/tmp/journal'], /--apply/],
    [['--apply', '--ledger-root=/tmp/ledger', '--adopt-from=/tmp/old', '--transaction-journal=/tmp/journal'], /--tool/],
    [['--apply', '--tool=claude', '--adopt-from=/tmp/old', '--transaction-journal=/tmp/journal'], /--ledger-root/],
    [['--apply', '--tool=claude', '--ledger-root=/tmp/ledger', '--adopt-from=relative', '--transaction-journal=/tmp/journal'], /adopt-from.*absolute/i],
    [['--apply', '--tool=claude', '--ledger-root=/tmp/ledger', '--adopt-from=/tmp/old', '--transaction-journal=relative'], /transaction-journal.*absolute/i],
  ];
  for (const [args, expectedMessage] of cases) {
    const result = runSync([...args, '--json', `--soma-home=${somaHome}`], {}, { cwd: projectDir });
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, 'INVALID_ARGS');
    assert.doesNotMatch(output.error.message, /Unknown flag/);
    assert.match(output.error.message, expectedMessage);
  }
});

test('026 --files-only applies whole files without writing block targets', () => {
  const fixtureDir = path.join(FIXTURE_BASE, 'files-only');
  const fileTarget = path.join(fixtureDir, 'targets', 'hook.cjs');
  const blockTarget = path.join(fixtureDir, 'targets', 'CLAUDE.md');
  const blockEntry = {
    block_id: 'block.claude.CLAUDE_md.cbm',
    source_doc: 'docs/cbm.md',
    target_path: blockTarget,
    target_anchor_id: 'block.claude.CLAUDE_md.cbm',
  };
  const { somaHome, projectDir } = createFixture('files-only', {
    entries: [fileEntry('hooks/hook.cjs', fileTarget), blockEntry],
    sourceFiles: [
      ['hooks/hook.cjs', 'file bytes\n'],
      ['docs/cbm.md', '<!-- soma-v2:start id=block.claude.CLAUDE_md.cbm version=1.0 -->\n# block\n<!-- soma-v2:end id=block.claude.CLAUDE_md.cbm -->\n'],
    ],
  });

  const result = runSync(
    ['--apply', '--json', '--tool=claude', '--files-only', `--soma-home=${somaHome}`],
    {},
    { cwd: projectDir }
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(fileTarget, 'utf8'), 'file bytes\n');
  assert.equal(fs.existsSync(blockTarget), false, '--files-only must not create or modify a block target');
});
