'use strict';
/**
 * contract-check-red-only-coverage.test.cjs — RED/GREEN test for
 * checks/red-only-coverage.cjs (AC-02, spec 019).
 *
 * "Given um tasks.md cuja coluna Description contém a etiqueta 'RED: ' /
 * When essa task é a ÚNICA linha cujo spec_ref referencia um dado AC / Then
 * a cobertura NÃO conta esse AC como coberto, e o lint nomeia o par
 * AC↔task."
 *
 * NOT validateRedPhase (spec-test-traceability.cjs:196-215) — there RED is
 * GOOD (Article II HARD evidence). Here RED is insufficient as the SOLE
 * proof of coverage. See checks/red-only-coverage.cjs's own header for the
 * full distinction — this test file does not repeat it.
 *
 * Article II HARD: RED phase. `checks/red-only-coverage.cjs` starts (this
 * commit) as a stub that always returns `{ status: 'ran', findings: [] }`
 * — same convention `parallel-collision.cjs` used before T-07 and
 * `heading-near-miss.cjs` used before its own real logic landed. The
 * "known-bad" assertions below are RED by design until the real logic
 * lands; the "known-good" assertions already pass today because a stub
 * that finds nothing trivially agrees with "find nothing".
 *
 * Article III HARD: real fs, zero mocks. The two fixtures live as real
 * spec directories under fixtures/spec-lint/red-only-coverage/ —
 * 01-single-and-interval-red (conhecido-RUIM) and
 * 02-real-content-non-vacuous (conhecido-BOM).
 *
 * The check module is called directly (`check.run(ctx)`), not through the
 * `soma spec-lint` CLI — this is about the check's own logic.
 *
 * @spec [SPEC:AC-02]
 * @task T-AC02 (dispatch avulso, AC-02 da spec 019)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContext } = require('../lib/spec-lint/context.cjs');
const check = require('../lib/spec-lint/checks/red-only-coverage.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'spec-lint', 'red-only-coverage');

function loadFixture(slug) {
  return buildContext(path.join(FIXTURES_DIR, slug));
}

function runCheck(slug) {
  const ctx = loadFixture(slug);
  const result = check.run(ctx);
  return { ctx, result };
}

/** Finds the one finding naming a given AC, failing loudly if zero or more
 *  than one match — every assertion below wants exactly one named finding
 *  per RED-only AC, not just "count is right". */
function findingFor(findings, ac) {
  const matches = findings.filter((f) => f.message.startsWith(`${ac} `));
  assert.equal(
    matches.length,
    1,
    `expected exactly 1 finding naming ${ac}, got ${matches.length}: ${JSON.stringify(findings)}`
  );
  return matches[0];
}

// ── SENSIBILIDADE — o fixture conhecido-RUIM tem que acusar os 6 casos ─────

test('AC-02 conhecido-RUIM: AC único + intervalo, ambos RED-only -> 6 achados, cada um nomeando o par AC↔task', () => {
  const { ctx, result } = runCheck('01-single-and-interval-red');

  // Precondition: prove the fixture itself has the shape this test
  // assumes, so a silently-mis-typed fixture can't make "6 findings" pass
  // for the wrong reason.
  const t01 = ctx.tasks.find((t) => t.id === 'T-01');
  const t02 = ctx.tasks.find((t) => t.id === 'T-02');
  assert.ok(t01 && t02, 'precondition: both T-01 and T-02 must parse');
  assert.deepEqual(t01.specRefs, ['AC-13'], 'precondition: T-01 references AC-13 alone');
  assert.deepEqual(
    t02.specRefs,
    ['AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05'],
    'precondition: T-02 references the AC-01..AC-05 interval, already expanded by context.cjs'
  );
  assert.match(t01.description, /\bRED:\s/, 'precondition: T-01 Description carries the RED: label');
  assert.match(t02.description, /\bRED:\s/, 'precondition: T-02 Description carries the RED: label');

  assert.equal(result.status, 'ran');
  assert.equal(
    result.findings.length,
    6,
    `expected 6 findings (1 for AC-13 + 5 for the expanded AC-01..AC-05 interval), got ${result.findings.length}: ${JSON.stringify(result.findings)}`
  );

  const singleAc = findingFor(result.findings, 'AC-13');
  assert.equal(singleAc.check, 'red-only-coverage');
  assert.equal(singleAc.file, 'tasks.md');
  assert.equal(singleAc.line, t01.line, 'AC-13 finding must point at T-01\'s line');
  assert.match(singleAc.message, /T-01/, 'message must name the referencing task');
  assert.match(singleAc.message, /RED/, 'message must name the RED stop condition');

  for (const ac of ['AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05']) {
    const f = findingFor(result.findings, ac);
    assert.equal(f.check, 'red-only-coverage');
    assert.equal(f.file, 'tasks.md');
    assert.equal(f.line, t02.line, `${ac} finding must point at T-02's line (the interval task)`);
    assert.match(f.message, /T-02/, `message for ${ac} must name the referencing task`);
    assert.match(f.message, /RED/, `message for ${ac} must name the RED stop condition`);
  }

  // Every finding must name its file via the `file` field, and no two
  // planted near-misses may have collapsed onto the same message.
  const messages = new Set(result.findings.map((f) => f.message));
  assert.equal(messages.size, 6, 'each of the 6 findings must have a distinct message');
});

// ── ESPECIFICIDADE — o fixture conhecido-BOM tem que ficar em zero ─────────

test('AC-02 conhecido-BOM (não-vácuo): AC compartilhado, AC único sem RED (direto e via intervalo), e as 7 outras formas de "RED" -> zero achados', () => {
  const { ctx, result } = runCheck('02-real-content-non-vacuous');

  // Precondition: prove the fixture is NOT vacuous — a check that examined
  // nothing, or a stub, would also report zero findings against an empty
  // fixture. Each assertion below targets one of the traps the AC-02 text
  // and the team-lead brief call out by name.
  assert.equal(ctx.tasks.length, 10, 'precondition: fixture must parse all 10 planted tasks');

  const t01 = ctx.tasks.find((t) => t.id === 'T-01');
  const t02 = ctx.tasks.find((t) => t.id === 'T-02');
  const t10 = ctx.tasks.find((t) => t.id === 'T-10');
  assert.ok(t01 && t02 && t10, 'precondition: T-01, T-02 and T-10 must all parse');

  // (a) shared AC: T-01 is RED-labeled and references AC-01; T-02 ALSO
  // references AC-01 (without RED) — the count of referencers already
  // falsifies "única" before the label is ever inspected.
  assert.match(t01.description, /\bRED:\s/, 'precondition: T-01 carries the real RED: label');
  assert.deepEqual(t01.specRefs, ['AC-01'], 'precondition: T-01 references AC-01');
  assert.ok(t02.specRefs.includes('AC-01'), 'precondition: T-02 ALSO references AC-01 — the shared-AC case');
  assert.doesNotMatch(t02.description, /\bRED:\s/, 'precondition: T-02 carries no RED: label');

  // (b) single-task AC with no RED at all, direct (AC-02, T-02's second
  // ref) and via an expanded interval (AC-10..AC-12, T-10).
  assert.ok(t02.specRefs.includes('AC-02'), 'precondition: T-02 also references AC-02, exclusively and without RED');
  assert.deepEqual(
    t10.specRefs,
    ['AC-10', 'AC-11', 'AC-12'],
    'precondition: T-10 references an expanded interval, none RED-labeled'
  );
  assert.doesNotMatch(t10.description, /\bRED:\s/, 'precondition: T-10 carries no RED: label');

  // (c) the 7 other "RED"-shaped strings that convive in the repo must be
  // present verbatim, or this fixture would trivially yield zero findings
  // without exercising the regex's specificity at all.
  const negativeForms = [
    'RED phase',
    'RED commit',
    'validateRedPhase',
    'SOMA_RED_PHASE_STRICT',
    '`red:`',
    'RED genuíno',
    'expected-RED',
  ];
  for (const form of negativeForms) {
    const hit = ctx.tasks.some((t) => t.description.includes(form));
    assert.ok(hit, `precondition: fixture must plant the negative form "${form}" somewhere in Description`);
  }

  assert.equal(result.status, 'ran');
  assert.deepEqual(
    result.findings,
    [],
    `expected zero achados against real non-trivial content, got: ${JSON.stringify(result.findings)}`
  );
});
