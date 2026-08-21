'use strict';
/**
 * install-files-ledger.test.cjs — install.cjs integration tests for
 * CONTRACT-FILES-LEDGER-02 (Spec 018, T-05)
 *
 * T-05's own scope (per tasks.md): `installedFiles` added to
 * `ALLOWED_STATE_FIELDS` (`install.cjs:80`) and preserved across
 * `writeInstallState` writes; `validateInstallState` (`install.cjs:355`)
 * keeps rejecting anything outside the whitelist. This file is the
 * INTEGRATION angle (against install.cjs's real writer), complementing the
 * unit-level whitelist assertion already un-skipped as case 2 in
 * `contract-files-ledger.test.cjs`.
 *
 * Article III HARD: real filesystem, real temp dirs, zero mock of `fs`.
 * `os.tmpdir()` on this Mac is NOT `/tmp`.
 *
 * @spec [SPEC:AC-06] [SPEC:AC-07]
 * @contract CONTRACT-FILES-LEDGER-02
 * @task T-05
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'install.cjs');
const SYNC_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'sync.cjs');
const install = require(INSTALL_CJS);
const files = require(path.join(REPO_ROOT, 'core', 'scripts', 'install', 'files.cjs'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTmp(prefix, fn) {
  const dir = mkTmp(prefix);
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function baseCompleteState(overrides = {}) {
  return {
    $schema: 'soma-install-state/v1',
    status: 'complete',
    timestamp: '2026-08-21T00:00:00Z',
    snapshotId: '2026-08-21T00:00:00Z',
    harness: 'claude',
    installedVersion: '2.2.0',
    blockIds: ['block.claude.CLAUDE_md.core'],
    ...overrides,
  };
}

// ── AC-06: install-state registra a identidade do conteúdo gravado ────────

test('T-05-01 @spec AC-06: writeInstallState preserves a pre-existing installedFiles ledger written by files.cjs at the SAME projectPathAbs (no clobber)', () => {
  withTmp('t05-ac06-', (project) => {
    const targetPath = '~/.claude/hooks/framework-guard.cjs';
    const oldContent = 'module.exports = { version: 1 };\n'; // what a prior file had, irrelevant here
    const newContent = 'module.exports = { version: 2 };\n'; // what SOMA just wrote

    // Simulate the write step the kind:"file" pipeline owns (sync.cjs, via
    // files.cjs's writeLedger — CONTRACT-FILES-LEDGER-02): the ledger
    // records the sha256 of the content that was JUST WRITTEN, never of
    // whatever the target had before.
    const writtenSha = files.sha256OfContent(newContent);
    files.writeLedger(project, { [targetPath]: files.buildLedgerEntry(writtenSha, '2026-08-21T00:00:00Z') });

    // install.cjs's own pipeline (orchestrate()) then writes its final
    // status=complete state, WITHOUT knowing/repeating the installedFiles
    // field — this is exactly what every writeInstallState call site in
    // orchestrate() does today. Without AC-06 preservation this call would
    // replace the whole state object and silently erase the ledger the
    // kind:"file" pipeline just wrote earlier in the SAME run.
    install.writeInstallState(project, baseCompleteState());

    const stateFile = path.join(project, '.soma', 'install-state.json');
    const finalState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

    assert.equal(finalState.status, 'complete', 'the caller-supplied fields must still be written');
    assert.deepEqual(finalState.blockIds, ['block.claude.CLAUDE_md.core']);
    assert.ok(finalState.installedFiles, 'installedFiles must survive a subsequent writeInstallState call that does not mention it');
    assert.equal(
      finalState.installedFiles[targetPath].sha256,
      writtenSha,
      'the preserved entry must be the sha256 of the content that was WRITTEN, not of the prior content'
    );
    assert.notEqual(
      finalState.installedFiles[targetPath].sha256,
      files.sha256OfContent(oldContent),
      'must not be the sha256 of content that predates the write'
    );
  });
});

test('T-05-02 @spec AC-06: an explicit installedFiles argument to writeInstallState wins over whatever is already on disk (no silent merge-over-caller-intent)', () => {
  withTmp('t05-ac06-explicit-', (project) => {
    const staleTarget = '~/.claude/hooks/stale.cjs';
    files.writeLedger(project, { [staleTarget]: files.buildLedgerEntry('a'.repeat(64), '2026-08-20T00:00:00Z') });

    const freshTarget = '~/.claude/hooks/fresh.cjs';
    const explicitLedger = { [freshTarget]: files.buildLedgerEntry('b'.repeat(64), '2026-08-21T00:00:00Z') };
    install.writeInstallState(project, baseCompleteState({ installedFiles: explicitLedger }));

    const stateFile = path.join(project, '.soma', 'install-state.json');
    const finalState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.deepEqual(
      Object.keys(finalState.installedFiles),
      [freshTarget],
      'caller-supplied installedFiles must be used verbatim, not merged with what was on disk'
    );
  });
});

// ── AC-07: os dois lados da whitelist (integration angle) ─────────────────

test('T-05-03 @spec AC-07: installedFiles accepted end-to-end through writeInstallState; unrelated unknown field still rejected', () => {
  withTmp('t05-ac07-', (project) => {
    // Side A: a state object that explicitly carries installedFiles must
    // write successfully (whitelist accepts it).
    const ledger = { '~/.claude/hooks/x.cjs': files.buildLedgerEntry('c'.repeat(64), '2026-08-21T00:00:00Z') };
    assert.doesNotThrow(() => install.writeInstallState(project, baseCompleteState({ installedFiles: ledger })));

    // Side B: extending the whitelist for installedFiles must not loosen
    // additionalProperties:false for anything else.
    assert.throws(
      () => install.writeInstallState(project, baseCompleteState({ notInTheSchema: true })),
      /unknown field/,
      'a field outside ALLOWED_STATE_FIELDS must still be rejected'
    );
  });
});

test('T-05-04 @spec AC-07: installedFiles must be a plain object, not an array or null (shape guard on the whitelisted field itself)', () => {
  withTmp('t05-ac07-shape-', (project) => {
    assert.throws(
      () => install.writeInstallState(project, baseCompleteState({ installedFiles: ['not', 'an', 'object'] })),
      /installedFiles must be a plain object/
    );
    assert.throws(
      () => install.writeInstallState(project, baseCompleteState({ installedFiles: null })),
      /installedFiles must be a plain object/
    );
  });
});

// ── "ONDE o ledger mora" — install.cjs ↔ files.cjs, mesmo projectPathAbs ──
//
// CONTRACT-FILES-LEDGER-02 §"🔴 ONDE o ledger mora" fixes the rule: the
// file ledger lives at <projectPathAbs>/.soma/install-state.json — the
// SAME file install.cjs already uses for blockIds and the other 7
// ALLOWED_STATE_FIELDS. This proves the install.cjs half of that equality:
// files.cjs's ledgerFilePath()/writeLedger()/readLedger() and install.cjs's
// writeInstallState() resolve to, and interoperate through, the identical
// path when given the same projectPathAbs — not two files that happen to
// have similar names.

test('T-05-05: install.cjs writeInstallState and files.cjs writeLedger/readLedger target the EXACT SAME file for the same projectPathAbs', () => {
  withTmp('t05-same-file-', (project) => {
    const expectedPath = path.join(project, '.soma', 'install-state.json');
    assert.equal(files.ledgerFilePath(project), expectedPath, 'files.cjs ledgerFilePath must match the literal path install.cjs writes to');

    // Verb 1: files.cjs writes a ledger entry.
    const targetPath = '~/.claude/hooks/shared.cjs';
    files.writeLedger(project, { [targetPath]: files.buildLedgerEntry('d'.repeat(64), '2026-08-21T00:00:00Z') });

    // Verb 2: install.cjs writes its own state, unaware of the ledger.
    const writtenPath = install.writeInstallState(project, baseCompleteState());
    assert.equal(writtenPath, expectedPath, 'writeInstallState must report the same path files.cjs computed');

    // Read back through files.cjs's OWN reader — proving verb 1's write is
    // visible through the same file verb 2 just wrote to, not a second file.
    const { installed, installedFiles } = files.readLedger(project);
    assert.equal(installed, true);
    assert.ok(installedFiles[targetPath], 'the entry files.cjs wrote must still be readable after install.cjs wrote its own state to the same file');

    // Read back through install.cjs's own JSON output too — one file, two readers.
    const raw = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.equal(raw.status, 'complete', 'install.cjs\'s own fields must be present');
    assert.deepEqual(raw.installedFiles, installedFiles, 'both readers must see the identical installedFiles content — one file, not two');
  });
});

// ── "ONDE o ledger mora" — install.cjs (cwd) × sync.cjs subprocess ────────
//
// RESOLVED. This was BLOCKED: sync.cjs's kind:"file" pipeline used to key
// the ledger off the `somaHome` variable (the --soma-home CLI flag value)
// instead of process.cwd() — `runFileApplyMode` (sync.cjs:834) and the
// dry-run ledger read (sync.cjs:1455). install.cjs invokes sync.cjs with
// `cwd: projectPathAbs` but ALWAYS `--soma-home=${SOURCE_CORE}` (the repo's
// own core/ dir, install.cjs:837/941), so the two variables are NEVER the
// same value in the real pipeline — the old code would have written the
// file ledger to `<repo>/core/.soma/install-state.json` while install.cjs
// writes/reads its own state at `<projectPathAbs>/.soma/install-state.json`.
// sync.cjs has since been fixed to use process.cwd() in both places
// (sync-file-entries.test.cjs's own fixture helper now documents this:
// "the ledger root fix ... makes the file-entry ledger land at
// process.cwd(), not --soma-home").
//
// This test is the encounter no unit test on either side catches (files.cjs
// alone, install.cjs alone, or sync.cjs alone all pass regardless of which
// variable it used — only running BOTH real producers together, with
// somaHome and the project DELIBERATELY different directories, would have
// failed against the old code). It spawns sync.cjs exactly as install.cjs
// spawns it (`cwd: project`, `--soma-home=<a different dir>`) — not a
// hand-called `files.writeLedger`, the actual producer — then calls
// install.cjs's own `writeInstallState` the way orchestrate()'s Step 4
// does, without mentioning installedFiles, and proves the ledger sync.cjs
// wrote survives.
test('T-05-06 @spec AC-06: install.cjs (writeInstallState) and sync.cjs (the real kind:"file" producer, spawned exactly as install.cjs invokes it) target the SAME ledger file', () => {
  withTmp('t05-encounter-soma-home-', (somaHome) => {
    withTmp('t05-encounter-project-', (project) => {
      // somaHome and project MUST be different directories — that was
      // exactly the shape of the bug. A test that (by accident) used the
      // same dir for both would pass even against the old, wrong code.
      assert.notEqual(somaHome, project, 'fixture bug: somaHome and project must be distinct directories');

      fs.writeFileSync(
        path.join(somaHome, 'manifest.json'),
        JSON.stringify({ schema: 'soma-manifest/v1', version: '2.2.0', files: [] })
      );
      const hookRel = 'hooks/encounter-check.cjs';
      const hookContent = 'module.exports = { encounter: true };\n';
      fs.mkdirSync(path.join(somaHome, 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(somaHome, hookRel), hookContent);

      const targetAbs = path.join(project, '.claude-fake', 'encounter-check.cjs');
      const adapterDir = path.join(somaHome, 'adapters', 'claude');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
        schema: 'soma-install-targets/v1',
        tool: 'claude',
        entries: [{ kind: 'file', source_path: hookRel, target_path: targetAbs }],
      }, null, 2));

      // Invoke sync.cjs EXACTLY as install.cjs invokes it (install.cjs:837,
      // :853): cwd = the project directory, --soma-home = a directory that
      // is NOT the project (install.cjs always passes SOURCE_CORE, the
      // repo dir — never the project).
      const apply = spawnSync('node', [
        SYNC_CJS, '--apply', '--json', '--tool=claude', '--allow-local-edits', `--soma-home=${somaHome}`,
      ], { cwd: project, encoding: 'utf8', timeout: 15000 });
      assert.equal(apply.status, 0, `sync --apply must succeed. stdout: ${apply.stdout}\nstderr: ${apply.stderr}`);
      assert.equal(fs.existsSync(targetAbs), true, 'the file must actually be installed');
      assert.deepEqual(fs.readFileSync(targetAbs), Buffer.from(hookContent), 'installed content must be byte-identical to source');

      // (a) sync.cjs must have written the ledger into the PROJECT, not somaHome.
      assert.equal(
        fs.existsSync(path.join(project, '.soma', 'install-state.json')), true,
        'sync.cjs must write the ledger at the project (cwd), not somaHome'
      );
      assert.equal(
        fs.existsSync(path.join(somaHome, '.soma')), false,
        'somaHome must receive no .soma/ at all — the ledger must never land there'
      );
      assert.equal(files.ledgerFilePath(project), path.join(project, '.soma', 'install-state.json'));

      // (b) install.cjs's writeInstallState — called next, exactly as
      // orchestrate()'s Step 4 does, WITHOUT mentioning installedFiles —
      // must not clobber what sync.cjs (the real producer) just wrote.
      const writtenPath = install.writeInstallState(project, baseCompleteState());
      assert.equal(writtenPath, path.join(project, '.soma', 'install-state.json'));

      const finalState = JSON.parse(fs.readFileSync(writtenPath, 'utf8'));
      assert.equal(finalState.status, 'complete', 'install.cjs\'s own fields must still be written');
      assert.ok(finalState.installedFiles, 'installedFiles must be present after install.cjs writes its own state');
      assert.ok(
        finalState.installedFiles[targetAbs],
        'the exact entry sync.cjs wrote must have survived — merge-preserve exercised against the REAL producer, not a hand-called writeLedger'
      );
      assert.equal(
        finalState.installedFiles[targetAbs].sha256,
        files.sha256OfContent(hookContent),
        'the preserved sha256 must be the content sync.cjs actually wrote'
      );

      // (c) One file, two producers, one reader API — files.cjs's own
      // reader must see exactly what's in install.cjs's JSON output.
      const { installed, installedFiles } = files.readLedger(project);
      assert.equal(installed, true);
      assert.deepEqual(installedFiles, finalState.installedFiles, 'both readers must see identical content — one file, not two');
    });
  });
});
