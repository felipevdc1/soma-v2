'use strict';
/**
 * run-gitignore.test.cjs — T-16: integration test for the "SOMA runtime
 * artifacts" section of .gitignore added for spec 016 AC-11.
 *
 * AC-11: soma-run keeps runtime artifacts (.soma/reports/, .soma/dispatches/,
 * .soma/run-state-*.json, .soma.lock) out of version control by SELECTIVE
 * ignore, while .soma/install-state.json stays tracked — the hydra install
 * flow depends on it being versioned (spec.md AC-03/AC-11). Ignoring
 * ".soma/" wholesale would be trivial and wrong; that is exactly the
 * defect this test exists to catch.
 *
 * `git check-ignore` semantics are inverted from what intuition expects:
 * exit 0 means the path IS ignored, exit 1 means it is NOT. A test that
 * confuses the two directions passes either way and proves nothing — every
 * assertion below checks the exit code explicitly, on BOTH sides (4
 * ignored + 1 preserved). Without the preserved side, this test would be
 * vacuous: a `.gitignore` that ignored ".soma/" entirely would also make
 * the 4 "ignored" assertions pass.
 *
 * Trap this file avoids: `git check-ignore` is purely pattern-based — it
 * answers "would this path be excluded by the ignore rules", not "is this
 * path currently tracked". A file already tracked in the index stays
 * tracked even if a later .gitignore pattern would match it; conversely,
 * check-ignore reports "ignored" for such a path regardless of tracked
 * status. This test asserts the PATTERN's behavior (what check-ignore
 * says), which is what AC-11 is actually about — not `git status` /
 * `git ls-files`, which would answer a different question (today's index
 * state, not the rule).
 *
 * Runs `git check-ignore` directly against THIS worktree's committed
 * .gitignore (no synthetic temp git repo) — the artifact under test IS the
 * committed file, and re-copying it into a tmpdir sandbox would only risk
 * testing a stale copy instead of what actually ships. `os.tmpdir()` is
 * unused here for exactly that reason (only relevant if a test needs an
 * ISOLATED repo, which this one doesn't).
 *
 * Trap avoided: never read a child process's stdout/status with `||`,
 * `?.`, or a silent catch — a `git` invocation that fails for an
 * unexpected reason (fatal error, not "not ignored") must never be
 * silently reinterpreted as one of the two valid outcomes.
 *
 * @spec AC-11
 * @task T-16
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Precondition: we resolved the right directory (has .gitignore and .git).
assert.ok(fs.existsSync(path.join(REPO_ROOT, '.gitignore')), `REPO_ROOT miscomputed: no .gitignore at ${REPO_ROOT}`);
assert.ok(fs.existsSync(path.join(REPO_ROOT, '.git')), `REPO_ROOT miscomputed: no .git at ${REPO_ROOT}`);

/**
 * Runs `git check-ignore` for a single relative path from REPO_ROOT.
 * Returns { ignored, raw } where `ignored` is a strict boolean derived
 * from the exit code — 0 -> true, 1 -> false. Any OTHER exit code (fatal
 * git error, e.g. code 128) is a hard failure, never silently coerced into
 * either boolean.
 */
function checkIgnore(relPath) {
  const r = spawnSync('git', ['check-ignore', '--', relPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(
    typeof r.status,
    'number',
    `git check-ignore did not exit with a status code for "${relPath}" — signal: ${r.signal}, error: ${r.error}`
  );
  assert.ok(
    r.status === 0 || r.status === 1,
    `git check-ignore for "${relPath}" exited ${r.status} (expected 0=ignored or 1=not-ignored). ` +
      `stdout: "${r.stdout}" stderr: "${r.stderr}"`
  );
  return { ignored: r.status === 0, raw: r };
}

// ── Os 4 padrões de runtime artifacts → IGNORADOS (exit 0) ────────────────

test('AC-11: .soma/reports/<arquivo> é ignorado (exit 0)', () => {
  const { ignored, raw } = checkIgnore('.soma/reports/some-report.md');
  assert.equal(ignored, true, `expected exit 0 (ignored). Got exit ${raw.status}, stdout: "${raw.stdout}"`);
});

test('AC-11: .soma/dispatches/<run>/<arquivo> é ignorado recursivamente (exit 0)', () => {
  const { ignored, raw } = checkIgnore('.soma/dispatches/run-abc/attempt-1/output.md');
  assert.equal(ignored, true, `expected exit 0 (ignored). Got exit ${raw.status}, stdout: "${raw.stdout}"`);
});

test('AC-11: .soma/run-state-*.json é ignorado (exit 0)', () => {
  const { ignored, raw } = checkIgnore('.soma/run-state-2026-08-16T12-00-00.json');
  assert.equal(ignored, true, `expected exit 0 (ignored). Got exit ${raw.status}, stdout: "${raw.stdout}"`);
});

test('AC-11: .soma.lock é ignorado (exit 0)', () => {
  const { ignored, raw } = checkIgnore('.soma.lock');
  assert.equal(ignored, true, `expected exit 0 (ignored). Got exit ${raw.status}, stdout: "${raw.stdout}"`);
});

// ── O lado que faz a task existir: install-state.json PRESERVADO ─────────
// Sem este caso, os 4 acima passariam do mesmo jeito com ".soma/" inteiro
// no .gitignore — o que seria trivial e exatamente o defeito que AC-11
// existe para proibir.

test('AC-11: .soma/install-state.json NÃO é ignorado (exit 1) — preservado rastreado', () => {
  const { ignored, raw } = checkIgnore('.soma/install-state.json');
  assert.equal(
    ignored,
    false,
    `.soma/install-state.json must NOT match any ignore pattern — the hydra install flow depends on it ` +
      `staying tracked. Got exit ${raw.status} (0 = wrongly ignored), stdout: "${raw.stdout}"`
  );
});

// ── Guarda de não-vacuidade: pelo menos 1 padrão do .gitignore de fato ────
// ── cita ".soma" — sem isso, um .gitignore vazio faria os 4 acima ────────
// ── falharem (bom) mas o teste de baixo nível não distinguiria "sem regra" ─
// ── de "regra ampla demais que também bate install-state.json".──────────

test('AC-11: .gitignore contém pelo menos um padrão .soma/ (não é ausência total de regra)', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(text, /\.soma\//, '.gitignore must contain at least one .soma/ pattern');
  assert.ok(
    !/^\s*\.soma\/\s*$/m.test(text),
    '.gitignore must NOT ignore ".soma/" as a whole directory — that would also swallow install-state.json'
  );
});
