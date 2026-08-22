'use strict';
/**
 * contract-files-ledger.test.cjs — CONTRACT-FILES-LEDGER-02 contract tests
 * (Spec 018, T-03)
 *
 * Covers the 12 cases enumerated in the "Contract Test Stub" section of
 * `core/specs/018-install-whole-files/contracts/installed-files-ledger.md`.
 * This file is the CONTRACT angle — it tests `files.cjs` against the
 * payload/decision-table promises the document makes, grounded in
 * `~`-prefixed target paths that match the contract's own Payload example
 * (`~/.claude/hooks/framework-guard.cjs`) rather than the raw absolute temp
 * paths `install-files.test.cjs` (T-01's own unit tests) use. That
 * difference is not cosmetic: the contract's 2026-08-21 amendment
 * ("A chave do ledger é o target_path VERBATIM") is a promise specifically
 * about the `~`-prefixed string surviving as the ledger key, unexpanded —
 * and nothing in T-01's own test file exercises a `~`-prefixed
 * target_path through `planFileInstall` at all. This file closes that gap.
 *
 * Real `~` expansion needs `os.homedir()` to resolve somewhere safe to
 * write. `os.homedir()` on this Mac/Node reads `process.env.HOME` on every
 * call (verified empirically, no internal caching), so `withFakeHome`
 * below points it at a throwaway temp dir for the duration of one test and
 * restores it in a `finally` — this NEVER touches the real `~/.claude` or
 * `~/.soma-v2`.
 *
 * This module (`files.cjs`) is READ-ONLY here — this task does not modify
 * it. A stub case failing against the real module is a finding for the
 * orchestrator to adjudicate, not something this file works around.
 *
 * Article III HARD: real filesystem, real temp dirs, zero mock of `fs`.
 * `os.tmpdir()` on this Mac is NOT `/tmp` (it's `/var/folders/...`) —
 * hardcoding `/tmp` would make this pass without testing anything.
 *
 * @spec [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09] [SPEC:AC-10]
 * @contract CONTRACT-FILES-LEDGER-02
 * @task T-03
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const files = require(path.join(REPO_ROOT, 'core', 'scripts', 'install', 'files.cjs'));
const INSTALL_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'install.cjs');

// Bucket G (Spec 018): unlike this file's own withFakeHome below (which
// only needs os.homedir() to resolve somewhere writable for in-process
// files.expandHome calls), caso 8b spawns install.cjs as a full subprocess
// — its Step 1 (init.cjs, no --soma-home flag) needs a real
// <HOME>/.soma-v2/templates tree to get past TEMPLATE_MISSING. The shared
// helper seeds that; see helpers/fake-home.cjs for the full rationale.
// Aliased to avoid colliding with this file's own withFakeHome (unseeded).
const { withFakeHome: withSeededFakeHome } = require('./helpers/fake-home.cjs');

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

/**
 * Points `os.homedir()` (and therefore `files.expandHome('~/...')`) at a
 * throwaway temp dir for the duration of `fn`, so tests can exercise
 * `~`-prefixed target_path values — the shape the contract actually
 * specifies — without ever writing under the real $HOME. Restored in
 * `finally` even if `fn` throws.
 */
function withFakeHome(prefix, fn) {
  const dir = mkTmp(prefix);
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    fn(dir);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeRepoWithFiles(repo, filesMap) {
  for (const [rel, content] of Object.entries(filesMap)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function writeAtTilde(tildePath, content) {
  const abs = files.expandHome(tildePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ── Case 1 ───────────────────────────────────────────────────────────────
// install grava o sha256 do conteúdo QUE GRAVOU, não do que estava lá
// antes.

test('CONTRACT-FILES-LEDGER-02 caso 1: o ledger registra o sha256 do conteudo QUE FOI GRAVADO, nao do que estava no destino antes da escrita', () => {
  withTmp('contract-ledger-target-', (targetDir) => {
    const target = path.join(targetDir, 'framework-guard.cjs');
    const oldContent = 'module.exports = { version: 1 };\n'; // what was there before
    const newContent = 'module.exports = { version: 2 };\n'; // what SOMA is about to write
    fs.writeFileSync(target, oldContent);

    // Simulate the write step T-07 owns: SOMA overwrites the target, then
    // records the identity of the content it JUST wrote.
    fs.writeFileSync(target, newContent);
    const entry = files.buildLedgerEntry(files.sha256OfContent(newContent));

    assert.equal(entry.sha256, files.sha256OfContent(newContent));
    assert.notEqual(
      entry.sha256,
      files.sha256OfContent(oldContent),
      'must not be the sha256 of the content that was there before the write'
    );
    // Round-trip: classifying the target right after must read clean
    // against this entry, proving the recorded sha256 actually matches
    // reality post-write.
    assert.equal(files.classifyFileState(target, entry), 'clean');
  });
});

// ── Case 2 ─── RESOLVED BY T-05 ─────────────────────────────────────────
// "os dois lados da whitelist: installedFiles é aceito pela whitelist;
// campo desconhecido continua REJEITADO (dois lados)".
//
// CONTRACT §"writeLedger não valida a whitelist" (fixed 2026-08-21, after
// T-01) is explicit: `ALLOWED_STATE_FIELDS` and `validateInstallState`
// live entirely in `install.cjs` (`:74`, `:344`), which `files.cjs`
// deliberately does not require — the dependency runs install.cjs ->
// files.cjs, never the reverse, to avoid closing a cycle. `writeLedger`
// here does no whitelist check at all: it merges `installedFiles` into
// whatever state object already exists on disk and leaves every other
// field untouched, known or not.
//
// Testing "unknown field continues rejected" against `files.cjs` would
// either pass for the wrong reason (this module never rejects anything
// about unrelated fields — it isn't a validator) or require writing the
// whitelist check here, which this task's restriction forbids and the
// contract explicitly assigns to T-05. This is a finding, not an
// obstacle to work around.
//
// Un-skipped by T-05: `install.cjs` now exports `validateInstallState`
// (Spec 018, T-05) so this contract test can exercise the real validator —
// `ALLOWED_STATE_FIELDS` (`install.cjs:74`) extended with `installedFiles`,
// `validateInstallState` (`install.cjs:344`+) still rejects anything else.
test('CONTRACT-FILES-LEDGER-02 caso 2: installedFiles aceito pela whitelist E campo desconhecido continua rejeitado (os dois lados)', () => {
  const install = require(INSTALL_CJS);
  const base = {
    $schema: 'soma-install-state/v1',
    status: 'complete',
    timestamp: '2026-08-21T00:00:00Z',
    snapshotId: '2026-08-21T00:00:00Z',
    harness: 'claude',
    installedVersion: '2.2.0',
    blockIds: ['block.x'],
  };

  // Side A: installedFiles IS accepted by the extended whitelist.
  assert.doesNotThrow(
    () => install.validateInstallState({
      ...base,
      installedFiles: {
        '~/.claude/hooks/framework-guard.cjs': files.buildLedgerEntry('a'.repeat(64), '2026-08-21T00:00:00Z'),
      },
    }),
    'installedFiles must be accepted once ALLOWED_STATE_FIELDS is extended (AC-07)'
  );

  // Side B: an unrelated unknown field must still be rejected — extending
  // the whitelist for installedFiles must not loosen additionalProperties:false
  // for anything else.
  assert.throws(
    () => install.validateInstallState({ ...base, totallyUnknownField: 'nope' }),
    /unknown field/,
    'a field outside the whitelist must still be rejected (dois lados da whitelist)'
  );
});

// ── Case 3 ───────────────────────────────────────────────────────────────
// arquivo ausente em disco -> limpo -> escrito.

test('CONTRACT-FILES-LEDGER-02 caso 3: arquivo ausente em disco -> limpo -> precisa ser escrito', () => {
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      makeRepoWithFiles(repo, { 'hooks/framework-guard.cjs': 'module.exports = {};\n' });
      const entries = [
        { kind: 'file', source_path: 'hooks/framework-guard.cjs', target_path: '~/.claude/hooks/framework-guard.cjs' },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger: {} });
      assert.equal(result.ok, true);
      assert.equal(result.plan[0].state, 'clean');
      assert.equal(result.plan[0].needsWrite, true, 'absent target on first install must be (re)written');
    });
  });
});

// ── Case 4 ───────────────────────────────────────────────────────────────
// arquivo presente com sha256 batendo -> limpo -> sobrescrito sem
// perguntar (a fonte mudou desde a instalação; o destino em si não foi
// editado).

test('CONTRACT-FILES-LEDGER-02 caso 4: destino bate com o ledger -> limpo -> needsWrite quando a fonte mudou desde a instalacao (sobrescreve sem perguntar)', () => {
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      const targetPath = '~/.claude/hooks/framework-guard.cjs';
      const installedContent = 'module.exports = { version: 1 };\n';
      writeAtTilde(targetPath, installedContent); // matches what the ledger will say was installed
      const ledger = { [targetPath]: files.buildLedgerEntry(files.sha256OfContent(installedContent)) };

      makeRepoWithFiles(repo, { 'hooks/framework-guard.cjs': 'module.exports = { version: 2 };\n' }); // source changed since install
      const entries = [{ kind: 'file', source_path: 'hooks/framework-guard.cjs', target_path: targetPath }];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });

      assert.equal(result.plan[0].state, 'clean', 'unedited since install -> clean, regardless of what the source now says');
      assert.equal(result.plan[0].needsWrite, true, 'source changed since install -> overwritten, no confirmation prompt exists in this module');
      assert.equal(result.ok, true, 'clean must never be a reason to abort');
    });
  });
});

// ── Case 5 ───────────────────────────────────────────────────────────────
// arquivo presente com sha256 diferente -> divergido -> ABORT, e NENHUM
// arquivo escrito — nem os limpos.

test('CONTRACT-FILES-LEDGER-02 caso 5: destino diverge do ledger -> ABORT, e ZERO bytes escritos por planFileInstall, inclusive nos entries limpos', () => {
  // Não-cegueira: esta asserção falharia se planFileInstall escrevesse
  // qualquer coisa em disco (é uma função de PLANEJAMENTO — a própria
  // existência de uma segunda passada de escrita real é do consumidor,
  // T-07). Rodado ao vivo contra uma mutante que adiciona um
  // `fs.writeFileSync` dentro do loop de `planFileInstall`, ver
  // "Prova de não-cegueira" no relatório final.
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      makeRepoWithFiles(repo, {
        'hooks/framework-guard.cjs': 'module.exports = { v: 2 };\n',
        'hooks/clean-hook.cjs': 'module.exports = { clean: true };\n',
      });
      const divergedPath = '~/.claude/hooks/framework-guard.cjs';
      const cleanPath = '~/.claude/hooks/clean-hook.cjs';
      const divergedAbs = writeAtTilde(divergedPath, 'EDITED BY HAND\n'); // hand-edited, matches no ledger entry
      const cleanContent = 'module.exports = { clean: true };\n';
      const cleanAbs = writeAtTilde(cleanPath, cleanContent);
      const ledger = { [cleanPath]: files.buildLedgerEntry(files.sha256OfContent(cleanContent)) };
      const cleanBytesBefore = fs.readFileSync(cleanAbs);
      const divergedBytesBefore = fs.readFileSync(divergedAbs);

      const entries = [
        { kind: 'file', source_path: 'hooks/framework-guard.cjs', target_path: divergedPath },
        { kind: 'file', source_path: 'hooks/clean-hook.cjs', target_path: cleanPath },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });

      assert.equal(result.ok, false);
      assert.deepEqual(result.diverged, [divergedPath]);
      assert.deepEqual(fs.readFileSync(cleanAbs), cleanBytesBefore, 'the clean sibling must not be touched either — abort is total, not per-file');
      assert.deepEqual(fs.readFileSync(divergedAbs), divergedBytesBefore, 'the diverged target itself must not be touched by planning');
    });
  });
});

// ── Case 6 ───────────────────────────────────────────────────────────────
// arquivo presente sem entrada no ledger -> divergido (não é do SOMA).

test('CONTRACT-FILES-LEDGER-02 caso 6: arquivo presente sem entrada no ledger -> divergido (nao e do SOMA, sobrescrever seria o dano que o AC-04 previne)', () => {
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      makeRepoWithFiles(repo, { 'hooks/vault-sync.cjs': 'module.exports = {};\n' });
      const targetPath = '~/.claude/hooks/vault-sync.cjs';
      // A file the user already had before SOMA ever ran — exactly the
      // class of hook AC-05 protects (the 17 hooks SOMA doesn't own).
      writeAtTilde(targetPath, 'user hand-rolled this before SOMA existed\n');

      const entries = [{ kind: 'file', source_path: 'hooks/vault-sync.cjs', target_path: targetPath }];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger: {} });
      assert.equal(result.plan[0].state, 'diverged');
      assert.equal(result.ok, false);
      assert.deepEqual(result.diverged, [targetPath]);
    });
  });
});

// ── Case 7 ───────────────────────────────────────────────────────────────
// 2 divergidos -> a saída nomeia OS DOIS, não só o primeiro.

test('CONTRACT-FILES-LEDGER-02 caso 7: 2 divergidos -> diverged nomeia OS DOIS (chaves verbatim com ~), nao so o primeiro, e nao o limpo', () => {
  // Não-cegueira: esta asserção falharia se planFileInstall parasse no
  // primeiro divergido (early-return) em vez de avaliar todas as entries
  // antes de decidir — ver "Prova de não-cegueira" no relatório final
  // para a mutação rodada ao vivo (early-`break` no loop).
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      makeRepoWithFiles(repo, {
        'hooks/framework-guard.cjs': 'A\n',
        'hooks/spec-completeness-gate.cjs': 'B\n',
        'hooks/spec-test-traceability.cjs': 'C\n',
      });
      // Names match the 2 real hooks spec.md's Q1 names as diverged today
      // (framework-guard not-yet-installed counts as clean/absent there;
      // here we use it as one of the two hand-edited ones for the shape
      // of this case).
      const pathA = '~/.claude/hooks/framework-guard.cjs';
      const pathB = '~/.claude/hooks/spec-completeness-gate.cjs';
      const pathC = '~/.claude/hooks/spec-test-traceability.cjs';
      writeAtTilde(pathA, 'EDITED A\n');
      writeAtTilde(pathB, 'EDITED B\n');
      writeAtTilde(pathC, 'C\n');
      const ledger = { [pathC]: files.buildLedgerEntry(files.sha256OfContent('C\n')) };

      const entries = [
        { kind: 'file', source_path: 'hooks/framework-guard.cjs', target_path: pathA },
        { kind: 'file', source_path: 'hooks/spec-completeness-gate.cjs', target_path: pathB },
        { kind: 'file', source_path: 'hooks/spec-test-traceability.cjs', target_path: pathC },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.diverged.slice().sort(),
        [pathA, pathB].sort(),
        'both diverged targets must be named, and pathC (clean) must not appear'
      );
    });
  });
});

// ── Case 8 ───────────────────────────────────────────────────────────────
// abort não produz status 'partial-failed' — nada foi aplicado.

test('CONTRACT-FILES-LEDGER-02 caso 8a: planFileInstall (aborted ou nao) nunca cria nem escreve install-state.json — nao ha superficie pra um status parcial nascer aqui', () => {
  // Não-cegueira: esta asserção falharia se planFileInstall chamasse
  // writeLedger (ou mkdirSync) por conta própria — ver "Prova de
  // não-cegueira" no relatório final.
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      withTmp('contract-ledger-project-', (project) => {
        makeRepoWithFiles(repo, { 'hooks/x.cjs': 'A\n' });
        const targetPath = '~/.claude/hooks/x.cjs';
        writeAtTilde(targetPath, 'EDITED\n'); // diverged, forces ok:false
        const entries = [{ kind: 'file', source_path: 'hooks/x.cjs', target_path: targetPath }];

        assert.equal(fs.existsSync(path.join(project, '.soma')), false);
        const result = files.planFileInstall(entries, { repoRoot: repo, ledger: {} });
        assert.equal(result.ok, false);
        assert.equal(
          fs.existsSync(path.join(project, '.soma')),
          false,
          'planning must never touch the project ledger — only writeLedger does, and nothing here calls it'
        );
      });
    });
  });
});

// Un-skipped by T-05. No kind:"file" adapter entries exist in the real repo
// yet (T-08, still TODO per tasks.md) — SOURCE_CORE is hardcoded in
// install.cjs, so a real `node install.cjs` invocation cannot be pointed at
// a fixture adapter to trigger a live FILE_CONFLICT. Proven instead via the
// BLOCK_CONFLICT (BF-06) path, which is real today and exercises the exact
// same status-mapping code in install.cjs's orchestrate() Step 3: any
// sync.cjs exit code 2 maps to status='drift-detected', never
// 'partial-failed' — the mapping is exit-code-driven and does not branch on
// *why* sync.cjs exited 2. The contract's own text names this precedent:
// "é o que o sync --apply já faz para bloco" (§"Abort total (AC-04)").
// FILE_CONFLICT (sync.cjs also exits 2 on it) therefore inherits the same
// guarantee by construction. This is inference by construction, not a
// direct FILE_CONFLICT exercise — see final report "Lacunas do documento".
test('CONTRACT-FILES-LEDGER-02 caso 8b: o status gravado apos abort nunca e "partial-failed"', () => {
  withSeededFakeHome('contract-ledger-8b-home-', () => {
    withTmp('contract-ledger-8b-', (d) => {
      // First install: clean, must succeed (status=complete).
      const first = spawnSync('node', [INSTALL_CJS, d, '--tool=claude'], { cwd: d, encoding: 'utf8', timeout: 60000 });
      assert.equal(first.status, 0, `first install must succeed. stderr: ${first.stderr}`);

      // Mutate inside the anchored block to force a sha256 mismatch (BF-06) —
      // same abort family as FILE_CONFLICT: sync.cjs exits 2, install.cjs
      // Step 3 maps any exit-2 sync failure to a non-partial-failed status.
      const claudeMdPath = path.join(d, 'CLAUDE.md');
      const original = fs.readFileSync(claudeMdPath, 'utf8');
      const mutated = original.replace(
        /(<!-- soma-v2:start[^\n]*\n)/,
        '$1\n# CASE_8B_DRIFT_MARKER\n'
      );
      assert.notEqual(mutated, original, 'mutation must actually change CLAUDE.md content');
      fs.writeFileSync(claudeMdPath, mutated);

      const second = spawnSync('node', [INSTALL_CJS, d, '--tool=claude'], { cwd: d, encoding: 'utf8', timeout: 60000 });
      assert.equal(second.status, 2, `abort must exit 2. stdout: ${second.stdout}\nstderr: ${second.stderr}`);

      const stateFile = path.join(d, '.soma', 'install-state.json');
      assert.ok(fs.existsSync(stateFile), 'install-state.json must exist after abort');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.notEqual(state.status, 'partial-failed', 'abort must never produce status=partial-failed — nothing was applied partially');
      assert.equal(state.status, 'drift-detected', `expected drift-detected, got "${state.status}"`);
    });
  });
});

// ── Case 9 ───────────────────────────────────────────────────────────────
// rodar install 2x sem mudança no repo -> zero escrita na segunda
// (idempotência). End-to-end through the real ledger file this time
// (readLedger/writeLedger round-trip), not just the in-memory ledger
// object T-01's own idempotency test uses.

test('CONTRACT-FILES-LEDGER-02 caso 9: rodar o install 2x sem mudanca no repo -> zero escrita na segunda (idempotencia, via ledger real em disco)', () => {
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      withTmp('contract-ledger-project-', (project) => {
        makeRepoWithFiles(repo, { 'hooks/x.cjs': 'module.exports = 1;\n' });
        const targetPath = '~/.claude/hooks/x.cjs';
        const entries = [{ kind: 'file', source_path: 'hooks/x.cjs', target_path: targetPath }];

        // First run: nothing installed yet.
        const first = files.planFileInstall(entries, { repoRoot: repo, ledger: {} });
        assert.equal(first.ok, true);
        assert.equal(first.plan[0].needsWrite, true);
        // Apply it for real, the way T-07 will: write the target, then
        // persist the ledger to disk.
        const targetAbs = files.expandHome(targetPath);
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        fs.writeFileSync(targetAbs, fs.readFileSync(first.plan[0].sourcePathAbs));
        files.writeLedger(project, { [targetPath]: files.buildLedgerEntry(first.plan[0].sourceSha256) });

        // Second run: repo unchanged, ledger read back from disk (not the
        // in-memory object from the first call).
        const { installedFiles } = files.readLedger(project);
        const second = files.planFileInstall(entries, { repoRoot: repo, ledger: installedFiles });
        assert.equal(second.ok, true);
        assert.equal(second.plan[0].needsWrite, false, 'unchanged source + already-installed target -> zero writes on the second run');
      });
    });
  });
});

// ── Case 10 ──────────────────────────────────────────────────────────────
// doctor sem install-state -> "nunca instalado", NÃO "No drift detected".
//
// `doctor.cjs` has no file-drift wiring at all yet (T-06, still TODO) — it
// touches `~/.claude/hooks/` at exactly one point (`:441`, the
// `auto-load-modules.cjs` context-routing check) and has no code path
// that reads `installedFiles` or reports "nunca instalado". Asserting
// against doctor.cjs's stdout today would be a false-green test: it would
// pass for the wrong reason (doctor doesn't look at files at all, so it
// trivially never contradicts anything) and would need to be rewritten,
// not just loosened, the day T-06 lands.
//
// What IS testable today, and is a permanent invariant rather than a
// transient absence-of-feature state: `readLedger` already returns a
// shape that distinguishes "no install-state.json at all" from "state
// exists, no files recorded" — the exact fact AC-10 depends on. T-06's
// job is to wire this distinction into doctor's stdout; the distinction
// itself is proven here, against files.cjs, and survives T-06 landing.
test('CONTRACT-FILES-LEDGER-02 caso 10: ausencia de install-state e distinguivel de "instalado, sem arquivos registrados" — invariante que a T-06 vai ler para dizer "nunca instalado"', () => {
  withTmp('contract-ledger-project-', (neverInstalled) => {
    withTmp('contract-ledger-project-', (installedNoFiles) => {
      const never = files.readLedger(neverInstalled);
      assert.equal(never.installed, false, '"nunca instalado" must be a distinguishable state, never folded into "no drift"');
      assert.deepEqual(never.installedFiles, {});

      // A project WITH an install-state.json (e.g. block entries were
      // installed already) but with no file entries recorded yet — a
      // DIFFERENT state from "never installed" that readLedger must not
      // conflate with it.
      files.writeLedger(installedNoFiles, {});
      const installed = files.readLedger(installedNoFiles);
      assert.equal(installed.installed, true);
      assert.deepEqual(installed.installedFiles, {});
      assert.notEqual(never.installed, installed.installed, 'the two states must read as different, not the same silence twice');
    });
  });
});
// PENDING T-06: doctor.cjs's actual stdout text ("nunca instalado" vs "No
// drift detected") is not exercised here — that wiring does not exist
// yet. Un-skip/extend once T-06 adds `detectFileDrifts`-equivalent
// reading of `readLedger(...).installed` into `doctor.cjs`.

// ── Case 11 ──────────────────────────────────────────────────────────────
// doctor com tudo idêntico -> silêncio quanto a arquivos.
//
// Same T-06-not-built caveat as case 10. What's testable now: the
// `diverged` array — the exact data a future doctor wiring would iterate
// to print findings — comes back empty when every declared file matches.
// An empty array is the invariant "silence" is built on; it survives
// T-06 landing unchanged.
test('CONTRACT-FILES-LEDGER-02 caso 11: todos os declarados identicos -> diverged vazio — invariante que sustenta o silencio do doctor', () => {
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      makeRepoWithFiles(repo, { 'hooks/a.cjs': 'A\n', 'hooks/b.cjs': 'B\n' });
      const pathA = '~/.claude/hooks/a.cjs';
      const pathB = '~/.claude/hooks/b.cjs';
      writeAtTilde(pathA, 'A\n');
      writeAtTilde(pathB, 'B\n');
      const ledger = {
        [pathA]: files.buildLedgerEntry(files.sha256OfContent('A\n')),
        [pathB]: files.buildLedgerEntry(files.sha256OfContent('B\n')),
      };
      const entries = [
        { kind: 'file', source_path: 'hooks/a.cjs', target_path: pathA },
        { kind: 'file', source_path: 'hooks/b.cjs', target_path: pathB },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      assert.equal(result.ok, true);
      assert.deepEqual(result.diverged, [], 'nothing diverged -> the finding list a future doctor prints from must be empty, i.e. silent');
    });
  });
});
// PENDING T-06: doctor.cjs's actual absence-of-stdout-line for files is
// not exercised here — that wiring does not exist yet.

// ── Case 12 ──────────────────────────────────────────────────────────────
// doctor com 1 declarado defasado -> nomeia o arquivo.
//
// Same T-06-not-built caveat. Testable now: among several declared
// entries, exactly the 1 stale one shows up in `diverged`, by its
// verbatim `~` path — the identity a future doctor finding would name.
test('CONTRACT-FILES-LEDGER-02 caso 12: 1 declarado defasado entre varios limpos -> diverged nomeia exatamente esse 1 — invariante para a T-06 nomear no finding', () => {
  withFakeHome('contract-ledger-home-', () => {
    withTmp('contract-ledger-repo-', (repo) => {
      makeRepoWithFiles(repo, {
        'hooks/a.cjs': 'A\n',
        'hooks/b.cjs': 'B\n',
        'hooks/stale.cjs': 'STALE NEW\n',
      });
      const pathA = '~/.claude/hooks/a.cjs';
      const pathB = '~/.claude/hooks/b.cjs';
      const pathStale = '~/.claude/hooks/stale.cjs';
      writeAtTilde(pathA, 'A\n');
      writeAtTilde(pathB, 'B\n');
      writeAtTilde(pathStale, 'STALE OLD\n'); // hand-edited, matches no ledger entry -> defasado
      const ledger = {
        [pathA]: files.buildLedgerEntry(files.sha256OfContent('A\n')),
        [pathB]: files.buildLedgerEntry(files.sha256OfContent('B\n')),
      };
      const entries = [
        { kind: 'file', source_path: 'hooks/a.cjs', target_path: pathA },
        { kind: 'file', source_path: 'hooks/b.cjs', target_path: pathB },
        { kind: 'file', source_path: 'hooks/stale.cjs', target_path: pathStale },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      assert.equal(result.ok, false);
      assert.deepEqual(result.diverged, [pathStale], 'exactly the one stale file must be named, by its verbatim ~ path');
    });
  });
});
// PENDING T-06: doctor.cjs's actual stdout finding line naming the file
// is not exercised here — that wiring does not exist yet.
