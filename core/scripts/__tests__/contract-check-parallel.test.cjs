'use strict';
/**
 * contract-check-parallel.test.cjs — T-05 contract test for
 * CONTRACT-CHECK-PARALLEL-01 (checks/parallel-collision.cjs).
 *
 * Article II HARD: RED phase. `checks/parallel-collision.cjs` is a T-02
 * stub that always returns `{ status: 'ran', findings: [] }` — the real
 * logic (3-condition collision rule + transitive `depends_on` closure) is
 * T-07. Every "known-bad" test below (fixtures 1-4) is RED by design until
 * T-07 lands; every "known-good" test (fixtures 5-9) already passes today
 * because a stub that finds nothing trivially agrees with "find nothing".
 *
 * Article III HARD: real fs, zero mocks. The 9 fixtures enumerated in the
 * contract's "Corpus de selftest" section live as real spec directories
 * under fixtures/spec-lint/parallel/ — each just a tasks.md, since
 * `context.cjs` only requires tasks.md to build `ctx.tasks` (AC-03).
 *
 * The check module is called directly (`check.run(ctx)`), not through the
 * `soma spec-lint` CLI: this contract is about the check's own logic, and
 * going through the CLI would only add process-spawn noise between the
 * fixture and the assertion.
 *
 * Trap this file avoids on purpose: the ad hoc validator of 2026-08-15 read
 * a task's own `id` as if it were a `depends_on` entry, making every task
 * "reach" itself and silently defeating condition 3 for every pair — it
 * reported "0 conflitos" against exactly the shape fixture 4 encodes below.
 * `0 achados` is not proof of correctness; it is the shape the bug produces.
 * That is why every fixture's `ctx.tasks` shape is asserted before its
 * findings are — a fixture that silently parsed wrong would otherwise let
 * a "0 findings" assertion pass for the wrong reason.
 *
 * T-13 (AC-15/AC-16) extends this file with fixtures 11-14: `[P]` without
 * the crase (specs 001-015's format) must be recognized AND evaluated, not
 * just parsed — and a `files` cell entry that isn't shaped like a path
 * (prose glued onto a real path, or a brace-expansion fragment split
 * mid-token by the naive comma parser) must be dropped instead of treated
 * as a phantom shared file. See `noise-floor.md` for the full measurement
 * that motivated both.
 *
 * @spec [SPEC:AC-08] [SPEC:AC-09] [SPEC:AC-15] [SPEC:AC-16]
 * @contract CONTRACT-CHECK-PARALLEL-01
 * @task T-05 / T-13
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContext } = require('../lib/spec-lint/context.cjs');
const check = require('../lib/spec-lint/checks/parallel-collision.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'spec-lint', 'parallel');

function loadFixture(slug) {
  return buildContext(path.join(FIXTURES_DIR, slug));
}

function runCheck(slug) {
  const ctx = loadFixture(slug);
  const result = check.run(ctx);
  return { ctx, result };
}

/** Line of a task by id, read from ctx.tasks — never hardcoded against the
 *  markdown, so a fixture edit can't silently desync the expectation. */
function lineOf(ctx, id) {
  const t = ctx.tasks.find((task) => task.id === id);
  assert.ok(t, `fixture task ${id} not found in ctx.tasks`);
  return t.line;
}

/** C(n, 2) — expected pair count for n mutually-[P], unrelated tasks
 *  sharing one file. */
function nChoose2(n) {
  return (n * (n - 1)) / 2;
}

// ── SENSIBILIDADE — os 4 fixtures conhecido-ruim têm que acusar ────────────

test('T-05 fixture 1: duas [P] sem dependência, mesmo arquivo → 1 achado', () => {
  const { ctx, result } = runCheck('01-two-parallel-same-file');
  assert.equal(ctx.tasks.length, 2, 'precondition: fixture must parse both tasks');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1,
    `expected exactly 1 finding, got ${result.findings.length}: ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'parallel-collision');
  assert.equal(finding.file, 'tasks.md');
  assert.equal(finding.line, lineOf(ctx, 'T-B'), 'line must be the SECOND task\'s row, per contract achado example');
  assert.match(finding.message, /T-A/);
  assert.match(finding.message, /T-B/);
  assert.match(finding.message, /são \[P\] no mesmo nível e escrevem em/);
  assert.match(finding.message, /core\/shared\.cjs/);
});

test('T-05 fixture 2: três [P] sem dependência, mesmo arquivo → 3 achados (um por par)', () => {
  const { ctx, result } = runCheck('02-three-parallel-same-file');
  assert.equal(ctx.tasks.length, 3, 'precondition: fixture must parse all 3 tasks');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 3,
    `expected exactly 3 findings (one per pair), got ${result.findings.length}: ${JSON.stringify(result.findings)}`);
  // every pair (A,B) (A,C) (B,C) must be represented — not e.g. the same
  // pair reported 3x, which would also satisfy a naive "length === 3" check.
  const pairs = result.findings.map((f) => {
    const ids = ['T-A', 'T-B', 'T-C'].filter((id) => f.message.includes(id)).sort();
    return ids.join('+');
  });
  const expectedPairs = ['T-A+T-B', 'T-A+T-C', 'T-B+T-C'];
  assert.deepEqual([...pairs].sort(), expectedPairs,
    `each of the 3 pairs must appear exactly once. Got pairs: ${JSON.stringify(pairs)}`);
});

test('T-05 fixture 3: duas [P] compartilhando um de vários arquivos → 1 achado nomeando só o compartilhado', () => {
  const { ctx, result } = runCheck('03-shared-one-of-many-files');
  assert.equal(ctx.tasks.length, 2, 'precondition: fixture must parse both tasks');
  const taskA = ctx.tasks.find((t) => t.id === 'T-A');
  const taskB = ctx.tasks.find((t) => t.id === 'T-B');
  assert.deepEqual(taskA.files, ['core/a.cjs', 'core/shared.cjs'], 'precondition: T-A files as fixture wrote them');
  assert.deepEqual(taskB.files, ['core/shared.cjs', 'core/b.cjs'], 'precondition: T-B files as fixture wrote them');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1,
    `expected exactly 1 finding, got ${result.findings.length}: ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.match(finding.message, /core\/shared\.cjs/, 'must name the shared file');
  assert.ok(!finding.message.includes('core/a.cjs'), `must NOT name T-A's non-shared file. Got: "${finding.message}"`);
  assert.ok(!finding.message.includes('core/b.cjs'), `must NOT name T-B's non-shared file. Got: "${finding.message}"`);
});

test('T-05 fixture 4 REGRESSÃO: 8 [P] sem dependência, mesmo arquivo → 28 achados (não "0 conflitos")', () => {
  const { ctx, result } = runCheck('04-regression-eight-parallel-same-file');
  assert.equal(ctx.tasks.length, 8, 'precondition: fixture must parse all 8 tasks');
  assert.ok(ctx.tasks.every((t) => t.parallel), 'precondition: all 8 tasks must be [P]');
  assert.ok(ctx.tasks.every((t) => t.dependsOn.length === 0), 'precondition: none declare depends_on');
  assert.equal(result.status, 'ran');
  const expected = nChoose2(8); // 28 — this is the number the 2026-08-15 validator reported as 0
  assert.equal(result.findings.length, expected,
    `the bug this fixture guards against reported 0 here. Expected ${expected} (C(8,2)), got ${result.findings.length}`);
});

// ── ESPECIFICIDADE — os 5 fixtures conhecido-bom têm que ficar em zero ─────

test('T-05 fixture 5: mesmo arquivo, nenhuma [P] → zero achados', () => {
  const { ctx, result } = runCheck('05-no-parallel-same-file');
  assert.equal(ctx.tasks.length, 2);
  assert.ok(ctx.tasks.every((t) => t.parallel === false), 'precondition: neither task is [P]');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0, `expected zero, got: ${JSON.stringify(result.findings)}`);
});

test('T-05 fixture 6: mesmo arquivo, uma [P] e outra não → zero achados', () => {
  const { ctx, result } = runCheck('06-one-parallel-one-not');
  assert.equal(ctx.tasks.length, 2);
  const flags = ctx.tasks.map((t) => t.parallel).sort();
  assert.deepEqual(flags, [false, true], 'precondition: exactly one of the two tasks is [P]');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0, `expected zero, got: ${JSON.stringify(result.findings)}`);
});

test('T-05 fixture 7: duas [P] mesmo arquivo, B depende diretamente de A → zero achados (níveis diferentes)', () => {
  const { ctx, result } = runCheck('07-parallel-direct-dependency');
  assert.equal(ctx.tasks.length, 2);
  const taskB = ctx.tasks.find((t) => t.id === 'T-B');
  assert.deepEqual(taskB.dependsOn, ['T-A'], 'precondition: B declares a direct dependency on A');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0, `expected zero, got: ${JSON.stringify(result.findings)}`);
});

test('T-05 fixture 8: duas [P] mesmo arquivo, B alcança A por caminho transitivo B→C→A → zero achados', () => {
  const { ctx, result } = runCheck('08-parallel-transitive-dependency');
  assert.equal(ctx.tasks.length, 3);
  const taskB = ctx.tasks.find((t) => t.id === 'T-B');
  const taskC = ctx.tasks.find((t) => t.id === 'T-C');
  assert.deepEqual(taskB.dependsOn, ['T-C'], 'precondition: B depends directly only on C, not on A');
  assert.deepEqual(taskC.dependsOn, ['T-A'], 'precondition: C depends on A — the transitive link');
  assert.equal(taskC.parallel, false, 'precondition: C is not [P] — it exists only to form the path');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0,
    `a naive direct-dependency-only check would wrongly flag this pair. Got: ${JSON.stringify(result.findings)}`);
});

test('T-05 fixture 9: tabela de Foundation sem coluna depends_on → parseia sem lançar, zero achados espúrios', () => {
  assert.doesNotThrow(() => loadFixture('09-foundation-table-no-depends-on-column'),
    'context.cjs must parse a tasks.md table lacking depends_on without throwing');
  const { ctx, result } = runCheck('09-foundation-table-no-depends-on-column');
  assert.equal(ctx.tasks.length, 3, 'precondition: all 3 Foundation rows must parse');
  assert.ok(ctx.tasks.every((t) => Array.isArray(t.dependsOn) && t.dependsOn.length === 0),
    'precondition: dependsOn must default to [] when the column is absent, not throw or misalign');
  // T-F1 and T-F3 share a file but neither is [P]; T-F2 is [P] but its file
  // is unique. A column-index parser (instead of by-name) could misread
  // `files` or `Status` here and fabricate a finding — that is what "zero
  // achados espúrios" is guarding against, not the absence of any [P] task.
  const taskF1 = ctx.tasks.find((t) => t.id === 'T-F1');
  const taskF3 = ctx.tasks.find((t) => t.id === 'T-F3');
  assert.deepEqual(taskF1.files, ['core/shared.cjs']);
  assert.deepEqual(taskF3.files, ['core/shared.cjs']);
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0, `expected zero, got: ${JSON.stringify(result.findings)}`);
});

// ── T-13 / AC-15 — `[P]` sem crase é reconhecida E avaliada ────────────────

test('T-13 fixture 11 AC-15 SENSIBILIDADE: [P] sem crase (formato 001-015) → reconhecida E avaliada, 1 achado', () => {
  const { ctx, result } = runCheck('11-bare-p-marker-recognized-and-evaluated');
  assert.equal(ctx.tasks.length, 2, 'precondition: fixture must parse both tasks');
  assert.ok(ctx.tasks.every((t) => t.parallel === true),
    'precondition: bare `[P]` (no backticks) must still set parallel: true — this is the AC-15 recognition half');
  assert.equal(result.status, 'ran');
  // "0 achados" by cleanliness and "0 achados" by blindness look identical —
  // the noise-floor measurement caught the bug by asking how many PAIRS the
  // check evaluated (0 of 247 tasks), not by reading the finding count. This
  // assertion is the evaluation half: recognizing the marker is not enough
  // if the pair is never actually run through the collision rule.
  assert.equal(result.findings.length, 1,
    `expected exactly 1 finding (recognition alone is not proof — the pair must be EVALUATED), got ${result.findings.length}: ${JSON.stringify(result.findings)}`);
  assert.match(result.findings[0].message, /T-A/);
  assert.match(result.findings[0].message, /T-B/);
  assert.match(result.findings[0].message, /core\/shared\.cjs/);
});

test('T-13 fixture 12 AC-15 ESPECIFICIDADE: [P] sem crase + dependência direta → zero achados (reconhecimento não atropela a condição 3)', () => {
  const { ctx, result } = runCheck('12-bare-p-marker-with-direct-dependency');
  assert.equal(ctx.tasks.length, 2);
  assert.ok(ctx.tasks.every((t) => t.parallel === true), 'precondition: both still parse as [P] despite no backticks');
  const taskB = ctx.tasks.find((t) => t.id === 'T-B');
  assert.deepEqual(taskB.dependsOn, ['T-A'], 'precondition: B declares a direct dependency on A');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0, `expected zero, got: ${JSON.stringify(result.findings)}`);
});

// ── T-13 / AC-16 — coluna `files` só conta entrada com forma de path ──────

test('T-13 fixture 13 AC-16: expansão de chaves partida pelo split de vírgula (reprodução real de 009) → zero achados', () => {
  const { ctx, result } = runCheck('13-brace-expansion-split-ignored');
  assert.equal(ctx.tasks.length, 2);
  assert.ok(ctx.tasks.every((t) => t.parallel === true), 'precondition: both tasks are [P]');
  // Precondition proves the trap is real: without the extra "{"/"}" guard
  // (AC-16's literal wording only excludes space/paren/+), both tasks would
  // still show the fragment "adapters/{cursor" as a "file" — it has no
  // space, no paren, no +, and it DOES contain "/". The guard must reject
  // it outright, leaving files empty, not merely deduplicated.
  assert.ok(ctx.tasks.every((t) => t.files.length === 0),
    `precondition: every entry in this fixture's files cell is prose/brace-artifact, none should survive the filter. Got: ${JSON.stringify(ctx.tasks.map((t) => t.files))}`);
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 0,
    `the 2026-08-16 measurement found this exact shape produced a false collision in 009-adapter-skeletons T-04/T-05. Got: ${JSON.stringify(result.findings)}`);
});

test('T-13 fixture 14 AC-16: path real ao lado de prosa na mesma célula → 1 achado nomeando só o path real', () => {
  const { ctx, result } = runCheck('14-real-path-alongside-prose-in-same-cell');
  assert.equal(ctx.tasks.length, 2);
  const taskA = ctx.tasks.find((t) => t.id === 'T-A');
  const taskB = ctx.tasks.find((t) => t.id === 'T-B');
  assert.deepEqual(taskA.files, ['core/real-shared.cjs'],
    `precondition: the prose/brace junk in T-A's cell must not survive as a file. Got: ${JSON.stringify(taskA.files)}`);
  assert.deepEqual(taskB.files, ['core/real-shared.cjs'],
    `precondition: the prose/brace junk in T-B's cell must not survive as a file. Got: ${JSON.stringify(taskB.files)}`);
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1,
    `expected exactly 1 finding — the filter must not over-reject the real path sitting next to prose. Got: ${JSON.stringify(result.findings)}`);
  assert.match(result.findings[0].message, /core\/real-shared\.cjs/, 'must name the real shared file');
  assert.ok(!/hooks\/x\.cjs/.test(result.findings[0].message), 'must NOT name the prose fragment from T-A');
  assert.ok(!/adapters/.test(result.findings[0].message), 'must NOT name the brace fragment from T-B');
});
