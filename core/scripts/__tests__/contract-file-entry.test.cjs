'use strict';
/**
 * contract-file-entry.test.cjs — CONTRACT-FILE-ENTRY-01 contract tests
 * (Spec 018, T-02)
 *
 * Covers the 8 cases enumerated in the "Contract Test Stub" section of
 * `core/specs/018-install-whole-files/contracts/install-file-entry.md`,
 * including case 8 (source_path absolute + outside repoRoot), added
 * 2026-08-21 after T-01 reported the gap. This file is the CONTRACT angle —
 * it tests `files.cjs` against the payload/rejection promises the document
 * makes, not the module's internals. It does not duplicate
 * `install-files.test.cjs` (T-01's own RED-bar unit tests): where a case
 * overlaps (target_anchor_id rejection, ".." rejection, unknown kind,
 * repoRoot escape), this file grounds the same assertion against the REAL
 * adapter data on disk (each adapter's own install-targets.json) instead
 * of synthetic fixtures alone, per case 1 and case 7 below.
 *
 * This module (`files.cjs`) is READ-ONLY here — this task does not modify
 * it. A stub case failing against the real module is a finding for the
 * orchestrator to adjudicate, not something this file works around.
 *
 * Article III HARD: real filesystem, real temp dirs, zero mock of `fs`.
 * `os.tmpdir()` on this Mac is NOT `/tmp` (it's `/var/folders/...`) —
 * hardcoding `/tmp` would make this pass without testing anything.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-05]
 * @contract CONTRACT-FILE-ENTRY-01
 * @task T-02
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '../../..');
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

function readAdapterEntries(tool) {
  const p = path.join(REPO_ROOT, 'core', 'adapters', tool, 'install-targets.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).entries;
}

// ── Case 1 ───────────────────────────────────────────────────────────────
// entry sem `kind` é tratada como bloco — as 8 entries existentes (3 do
// adapter `claude` + 5 do `codex` — the contract's "8 entries de bloco"
// count) não mudam de comportamento. Read from the REAL adapter files
// rather than a synthetic fixture: this is the strongest form of "não
// muda de comportamento" — it fails the day someone adds `kind` to one of
// the real entries without updating this assumption, not just the day
// `validateFileEntry` regresses.

test('CONTRACT-FILE-ENTRY-01 caso 1: as 8 entries reais de bloco (claude+codex) passam por validateFileEntry sem kind e voltam intactas', () => {
  // Filter to BLOCK entries only — Spec 018's own T-08 added 31 kind:"file"
  // entries to the claude adapter's same array (19 hooks + 12 commands).
  // The "8" this case asserts was always about the block world (that is
  // the whole premise of the case's name and of the comment above it) —
  // readAdapterEntries() itself stays kind-agnostic (case 7 below needs the
  // full set, file entries included) so the filtering lives here.
  const claudeEntries = readAdapterEntries('claude').filter((e) => !files.isFileEntry(e));
  const codexEntries = readAdapterEntries('codex').filter((e) => !files.isFileEntry(e));
  const allEntries = [...claudeEntries, ...codexEntries];
  assert.equal(allEntries.length, 8, 'contract text names 8 real block entries today (3 claude + 5 codex)');

  for (const raw of allEntries) {
    assert.equal(raw.kind, undefined, 'none of the real entries declare kind today — that is the premise of this case');
    const result = files.validateFileEntry(raw);
    assert.equal(result.kind, 'block', `entry ${raw.block_id} must be classified as block`);
    // Every original field survives untouched — "kind made explicit" must
    // not drop or rewrite anything else on the entry.
    for (const [key, value] of Object.entries(raw)) {
      assert.deepEqual(result[key], value, `field "${key}" on ${raw.block_id} must pass through unchanged`);
    }
  }
});

// ── Case 2 ───────────────────────────────────────────────────────────────
// kind:"file" com os 2 campos obrigatórios valida — both without repoRoot
// (shape-only path) and with repoRoot pointing at a real file (the
// production path `planFileInstall` always takes, per the contract's
// "Semântica de validação" section).

test('CONTRACT-FILE-ENTRY-01 caso 2: kind:"file" com os 2 campos obrigatorios valida (shape-only, sem repoRoot)', () => {
  const result = files.validateFileEntry({
    kind: 'file',
    source_path: 'hooks/framework-guard.cjs',
    target_path: '~/.claude/hooks/framework-guard.cjs',
  });
  assert.equal(result.kind, 'file');
  assert.equal(result.source_path, 'hooks/framework-guard.cjs');
  assert.equal(result.target_path, '~/.claude/hooks/framework-guard.cjs');
});

test('CONTRACT-FILE-ENTRY-01 caso 2b: kind:"file" com os 2 campos obrigatorios valida com repoRoot real (caminho de producao)', () => {
  withTmp('contract-file-entry-repo-', (repo) => {
    fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'hooks', 'x.cjs'), 'module.exports = {};\n');
    const result = files.validateFileEntry(
      { kind: 'file', source_path: 'hooks/x.cjs', target_path: '~/.claude/hooks/x.cjs' },
      { repoRoot: repo }
    );
    assert.equal(result.kind, 'file');
  });
});

// ── Case 3 ───────────────────────────────────────────────────────────────
// kind:"file" + target_anchor_id é REJEITADA, não ignorada. `assert.throws`
// is itself the non-blindness proof for this shape of assertion: if
// `validateFileEntry` silently ignored the forbidden field instead of
// throwing, this test fails (not passes) — see "Prova de não-cegueira" in
// the final report for the live mutation demonstration run against this
// exact case.

test('CONTRACT-FILE-ENTRY-01 caso 3: kind:"file" + target_anchor_id e REJEITADA, nao ignorada', () => {
  assert.throws(
    () => files.validateFileEntry({
      kind: 'file',
      source_path: 'hooks/x.cjs',
      target_path: '~/.claude/hooks/x.cjs',
      target_anchor_id: 'block.claude.CLAUDE_md.hyd-v2',
    }),
    /target_anchor_id/,
    'a file entry carrying target_anchor_id is most likely a malformed block entry — must error, not silently drop the field'
  );
});

// ── Case 4 ───────────────────────────────────────────────────────────────
// ".." rejeitado ANTES de qualquer path ser construído. Proven by passing
// a repoRoot that does not even exist on disk: if the ".." check ran after
// (or was replaced by) a filesystem resolve/existsSync, this would fail
// with an fs-shaped error instead of the ".." message — or not throw at
// all if repoRoot's absence were swallowed.

test('CONTRACT-FILE-ENTRY-01 caso 4: ".." em source_path e REJEITADA antes de qualquer path ser construido', () => {
  const nonExistentRepoRoot = path.join(os.tmpdir(), 'contract-file-entry-does-not-exist-' + Date.now());
  assert.throws(
    () => files.validateFileEntry(
      { kind: 'file', source_path: '../../etc/passwd', target_path: '~/.claude/x' },
      { repoRoot: nonExistentRepoRoot }
    ),
    /\.\./,
    'must reject on the ".." shape check before ever touching repoRoot on disk'
  );
});

// ── Case 5 ───────────────────────────────────────────────────────────────
// source_path inexistente no repo é REJEITADA.

test('CONTRACT-FILE-ENTRY-01 caso 5: source_path inexistente no repo e REJEITADA', () => {
  withTmp('contract-file-entry-repo-', (repo) => {
    fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
    assert.throws(
      () => files.validateFileEntry(
        { kind: 'file', source_path: 'hooks/nope.cjs', target_path: '~/.claude/hooks/nope.cjs' },
        { repoRoot: repo }
      ),
      /does not exist/,
      'a file entry pointing at a source that does not exist in the repo must be rejected, not silently planned'
    );
  });
});

// ── Case 6 ───────────────────────────────────────────────────────────────
// kind desconhecido (ex: "directory") rejeitado — nunca default silencioso.

test('CONTRACT-FILE-ENTRY-01 caso 6: kind desconhecido ("directory") e REJEITADO, nunca cai em default silencioso', () => {
  assert.throws(
    () => files.validateFileEntry({ kind: 'directory', source_path: 'a', target_path: '~/a' }),
    /kind/,
    'an unrecognized kind must error, never silently fall back to "block" or "file"'
  );
});

// ── Case 7 ───────────────────────────────────────────────────────────────
// O rollout universal aprovado em 2026-08-24/27 declara `soma-run.md` como
// arquivo inteiro do adapter Claude. Inspeciona apenas a declaração real.

test('CONTRACT-FILE-ENTRY-01 caso 7: o conjunto declarado do adapter claude contem soma-run.md para a entrada universal', () => {
  const claudeEntries = readAdapterEntries('claude');
  assert.ok(
    claudeEntries.some((entry) =>
      entry.kind === 'file' &&
      entry.source_path === 'adapters/claude/commands/soma-run.md' &&
      entry.target_path === '~/.claude/commands/soma-run.md'
    ),
    'the approved universal entry must declare soma-run.md as a Claude whole-file target'
  );
});

// ── Case 8 ───────────────────────────────────────────────────────────────
// source_path ABSOLUTO apontando fora do repoRoot é REJEITADA — the ".."
// literal is not the only way to escape. Fixed 2026-08-21 after T-01.

test('CONTRACT-FILE-ENTRY-01 caso 8: source_path absoluto apontando fora do repoRoot e REJEITADA', () => {
  withTmp('contract-file-entry-repo-', (repo) => {
    withTmp('contract-file-entry-outside-', (outside) => {
      const outsideFile = path.join(outside, 'secret.txt');
      fs.writeFileSync(outsideFile, 'nope\n');
      assert.throws(
        () => files.validateFileEntry(
          { kind: 'file', source_path: outsideFile, target_path: '~/.claude/x' },
          { repoRoot: repo }
        ),
        /escapes repoRoot/,
        'an absolute source_path resolving outside repoRoot must be rejected exactly like a "../" escape — same damage, different spelling'
      );
    });
  });
});
