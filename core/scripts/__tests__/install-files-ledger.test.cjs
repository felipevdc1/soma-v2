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

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'install.cjs');
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
// BLOCKED — this is the risk the contract flags as "🔴 ONDE o ledger mora",
// and this task cannot close it: fixing it means editing sync.cjs, which is
// out of T-05's file scope (owned by T-07, already DONE per tasks.md).
//
// Empirically, as of this commit, sync.cjs's kind:"file" pipeline does NOT
// use process.cwd() to locate the ledger — it uses the `somaHome` variable
// (the `--soma-home` CLI flag value):
//   - core/scripts/sync.cjs:834  runFileApplyMode(entries, somaHome, useJson)
//       `const projectRootAbs = somaHome;`
//   - core/scripts/sync.cjs:1455 (dry-run path) `filesModule.readLedger(somaHome)`
// sync.cjs's own contract test (sync-file-entries.test.cjs:335) asserts
// exactly this: `const ledgerPath = path.join(somaHome, '.soma', 'install-state.json');`
//
// install.cjs invokes sync.cjs with `cwd: projectPathAbs` (the project
// directory) but ALWAYS `--soma-home=${SOURCE_CORE}` (the repo's own
// core/ dir — install.cjs:837, :941, unchanged by this task). So inside
// that child process, `somaHome !== process.cwd()`: `somaHome` resolves to
// `<repo>/core`, not the project. Concretely, when the kind:"file" pipeline
// eventually has real entries (T-08, still TODO), sync.cjs would write the
// file ledger to `<repo>/core/.soma/install-state.json` while install.cjs
// writes/reads its own state at `<projectPathAbs>/.soma/install-state.json`
// — TWO different files, exactly the silent divergence the contract warns
// about (a project's own installed files would read back as "diverged"
// forever, since install.cjs's copy of installedFiles never receives what
// sync.cjs wrote).
//
// process.cwd() DOES reach projectPathAbs correctly when sync.cjs is
// spawned this way (sync.cjs already relies on process.cwd() elsewhere,
// e.g. --targets-file mode's relative target_path resolution) — so the
// contract's rule itself is sound. The gap is that runFileApplyMode/the
// dry-run ledger read do not use it. This is a finding for the
// orchestrator to route to a sync.cjs owner, not a "regra não funciona"
// case — see final report.
test(
  'T-05-06 BLOCKED @spec AC-06: install.cjs (writeInstallState at projectPathAbs) and sync.cjs (runFileApplyMode at somaHome, sync.cjs:834) target the SAME file — cannot verify GREEN without editing sync.cjs (out of T-05 scope)',
  { skip: 'BLOCKED — sync.cjs:834 runFileApplyMode uses `somaHome` (the --soma-home flag) as projectRootAbs, not process.cwd(); install.cjs always invokes sync.cjs with --soma-home=SOURCE_CORE (the repo dir), never the project dir. Today this writes two different install-state.json files instead of one. Fix belongs in sync.cjs (out of T-05\'s file scope: install.cjs, install-files-ledger.test.cjs, contract-files-ledger.test.cjs only) — recommended fix: change `const projectRootAbs = somaHome;` (sync.cjs:834) and `filesModule.readLedger(somaHome)` (sync.cjs:1455) to use `process.cwd()`, matching how install.cjs already invokes sync.cjs (`cwd: projectPathAbs`) and matching the contract\'s fixed rule. See final report "PROVA DO LEDGER ÚNICO".' },
  () => {
    assert.fail('unreachable while skipped — see skip reason above');
  }
);
