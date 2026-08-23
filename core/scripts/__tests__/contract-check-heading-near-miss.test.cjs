'use strict';
/**
 * contract-check-heading-near-miss.test.cjs — RED/GREEN test for
 * checks/heading-near-miss.cjs (AC-01, spec 019).
 *
 * "WHEN um heading de artefato normativo se parecer com um critério de
 * aceite e não casar a forma canônica, THEN o sistema SHALL emitir um
 * achado nomeando o heading e o arquivo."
 *
 * Article II HARD: RED phase. `checks/heading-near-miss.cjs` starts (this
 * commit) as a stub that always returns `{ status: 'ran', findings: [] }`
 * — same convention `parallel-collision.cjs` used before T-07 (see that
 * file's own header comment). Every "known-bad" assertion below is RED by
 * design until the real logic lands; the "known-good" assertions already
 * pass today because a stub that finds nothing trivially agrees with
 * "find nothing" — same reasoning as contract-check-parallel.test.cjs.
 *
 * Article III HARD: real fs, zero mocks. The two fixtures live as real
 * spec directories under
 * fixtures/spec-lint/heading-near-miss/ — 01-mixed-near-miss-forms
 * (conhecido-RUIM) and 02-real-content-non-vacuous (conhecido-BOM).
 *
 * The check module is called directly (`check.run(ctx)`), not through the
 * `soma spec-lint` CLI — this is about the check's own logic.
 *
 * @spec [SPEC:AC-01]
 * @task T-AC01 (dispatch avulso, AC-01 da spec 019)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContext } = require('../lib/spec-lint/context.cjs');
const check = require('../lib/spec-lint/checks/heading-near-miss.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'spec-lint', 'heading-near-miss');

function loadFixture(slug) {
  return buildContext(path.join(FIXTURES_DIR, slug));
}

function runCheck(slug) {
  const ctx = loadFixture(slug);
  const result = check.run(ctx);
  return { ctx, result };
}

/** Finds the one finding for a given file:line pair, failing loudly if
 *  zero or more-than-one match — every assertion below wants exactly one
 *  named finding per near-miss, not just "count is right". */
function findingAt(findings, file, line) {
  const matches = findings.filter((f) => f.file === file && f.line === line);
  assert.equal(
    matches.length,
    1,
    `expected exactly 1 finding at ${file}:${line}, got ${matches.length}: ${JSON.stringify(findings)}`
  );
  return matches[0];
}

// ── SENSIBILIDADE — o fixture conhecido-RUIM tem que acusar os 4 casos ─────

test('AC-01 conhecido-RUIM: 4 formas de near-miss em 3 arquivos em escopo → 4 achados, cada um nomeando heading e arquivo', () => {
  const { ctx, result } = runCheck('01-mixed-near-miss-forms');

  // Precondition: prove the fixture itself has the shape this test assumes,
  // so a silently-mis-typed fixture can't make "4 findings" pass for the
  // wrong reason (same discipline as contract-check-parallel.test.cjs's
  // ctx.tasks preconditions).
  const specArtifact = ctx.artifacts.find((a) => a.file === 'spec.md');
  const planArtifact = ctx.artifacts.find((a) => a.file === 'plan.md');
  const contractArtifact = ctx.artifacts.find((a) => a.file === 'contracts/example-contract.md');
  assert.ok(specArtifact, 'precondition: spec.md must be loaded');
  assert.ok(planArtifact, 'precondition: plan.md must be loaded');
  assert.ok(contractArtifact, 'precondition: contracts/example-contract.md must be loaded');
  assert.equal(specArtifact.lines[5], '## AC-02 + AC-03: dois ACs declarados no mesmo heading',
    'precondition: spec.md line 6 must be the "two ACs in one heading" near-miss, unchanged');
  assert.equal(specArtifact.lines[10], '#### AC-7 sem dois pontos',
    'precondition: spec.md line 11 must be the "4 hashes, no colon" near-miss, unchanged');
  assert.equal(planArtifact.lines[5], '## AC-01 — descrição não numerada com travessão',
    'precondition: plan.md line 6 must be the "em-dash instead of colon" near-miss, unchanged');
  assert.equal(contractArtifact.lines[5], '### AC-9 sem dois-pontos',
    'precondition: contracts/example-contract.md line 6 must be the "3 hashes, no colon" near-miss, unchanged');

  assert.equal(result.status, 'ran');
  assert.equal(
    result.findings.length,
    4,
    `expected exactly 4 findings (one per planted near-miss), got ${result.findings.length}: ${JSON.stringify(result.findings)}`
  );

  const f1 = findingAt(result.findings, 'spec.md', 6);
  assert.equal(f1.check, 'heading-near-miss');
  assert.match(f1.message, /AC-02 \+ AC-03/, 'message must name the offending heading text');
  assert.match(f1.message, /spec\.md|heading/, 'message must be about the heading — file is carried in the finding.file field');

  const f2 = findingAt(result.findings, 'spec.md', 11);
  assert.match(f2.message, /AC-7 sem dois pontos/, 'message must name the offending heading text');

  const f3 = findingAt(result.findings, 'plan.md', 6);
  assert.match(f3.message, /AC-01 — descrição não numerada com travessão/, 'message must name the offending heading text');

  const f4 = findingAt(result.findings, 'contracts/example-contract.md', 6);
  assert.match(f4.message, /AC-9 sem dois-pontos/, 'message must name the offending heading text');

  // Every finding must name its file via the `file` field (not just buried
  // in the message) — the AC text is explicit: "nomeando o heading E o
  // arquivo". findingAt() above already asserts file+line as the lookup
  // key, so this loop just confirms none of the 4 collapsed onto the same
  // file:line pair by accident.
  const keys = result.findings.map((f) => `${f.file}:${f.line}`).sort();
  assert.deepEqual(
    keys,
    ['contracts/example-contract.md:6', 'plan.md:6', 'spec.md:11', 'spec.md:6'],
    'each of the 4 planted near-misses must produce its own distinct file:line finding'
  );
});

// ── ESPECIFICIDADE — o fixture conhecido-BOM tem que ficar em zero ─────────

test('AC-01 conhecido-BOM (não-vácuo): forma canônica real, code span em prosa, near-miss cercado e quickstart.md cheio de near-miss legítimo → zero achados', () => {
  const { ctx, result } = runCheck('02-real-content-non-vacuous');

  // Precondition: prove the fixture is NOT vacuous — a check that examined
  // nothing would also report zero findings. Each assertion below targets
  // one of the 4 traps the AC-01 text calls out by name.
  const specArtifact = ctx.artifacts.find((a) => a.file === 'spec.md');
  const planArtifact = ctx.artifacts.find((a) => a.file === 'plan.md');
  const quickstartArtifact = ctx.artifacts.find((a) => a.file === 'quickstart.md');
  assert.ok(specArtifact, 'precondition: spec.md must be loaded');
  assert.ok(planArtifact, 'precondition: plan.md must be loaded');
  assert.ok(quickstartArtifact, 'precondition: quickstart.md must be loaded');

  assert.match(specArtifact.text, /^### AC-01:/m,
    'precondition (a): spec.md must contain the real canonical heading form');
  assert.match(specArtifact.text, /`### AC-01b: variante citada em prosa`/,
    'precondition (b): spec.md must contain the near-miss form quoted inside an inline code span');

  assert.match(planArtifact.text, /```\n### AC-05 — forma near-miss citada como exemplo, nunca como declaração real\n```/,
    'precondition (c): plan.md must contain a near-miss heading INSIDE a fenced ``` block');

  assert.match(quickstartArtifact.text, /^## AC-01 — H2 detects src\/ subdirs as modules/m,
    'precondition (d): quickstart.md must be full of near-miss-shaped walkthrough headings');
  assert.match(quickstartArtifact.text, /^## AC-02 \+ AC-03: dois ACs cobertos no mesmo passo/m,
    'precondition (d): quickstart.md must contain a second near-miss-shaped walkthrough heading');

  assert.equal(result.status, 'ran');
  assert.equal(
    result.findings.length,
    0,
    `expected zero achados against real non-trivial content, got: ${JSON.stringify(result.findings)}`
  );
});
