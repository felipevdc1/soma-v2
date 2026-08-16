'use strict';
/**
 * contract-check-cli-surface.test.cjs — T-04
 * Contract test for CONTRACT-CHECK-CLI-SURFACE-01.
 *
 * Exercises the `cli-surface` check module directly (`buildContext` +
 * `check.run(ctx)`) against 10 real fixture spec-directories on disk — no
 * `fs` mock (Article III / Integration-First Gate). Fixtures 01-09 are the
 * 9-item corpus enumerated in the contract's "Corpus de selftest (AC-10)"
 * section (4 conhecido-ruim, 5 conhecido-bom); fixture 10 is an additional
 * case for the "duas flags erradas -> dois achados" line in the contract's
 * Detecção table, which is not one of the 9 numbered items.
 *
 * `lib/spec-lint/checks/cli-surface.cjs` is a T-02 STUB today — it always
 * returns `{ status: 'ran', findings: [] }` regardless of ctx. Every test
 * below that expects a non-empty `findings` array or a `skipped` status is
 * RED PLANNED (Article III): it fails now, on purpose, and closes when T-06
 * implements the real check. Tests that expect zero findings from a
 * genuinely clean invocation already pass against the stub — that's
 * coincidence of the stub's unconditional empty-findings return, not
 * evidence the check works.
 *
 * @spec [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-10]
 * @contract CONTRACT-CHECK-CLI-SURFACE-01
 * @task T-04
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContext } = require('../lib/spec-lint/context.cjs');
const cliSurface = require('../lib/spec-lint/checks/cli-surface.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures/spec-lint/cli-surface');

function runCheck(fixtureName) {
  const specDir = path.join(FIXTURES_DIR, fixtureName);
  const ctx = buildContext(specDir);
  return cliSurface.run(ctx);
}

// ── conhecido-RUIM (corpus items 1-4) — cada um mapeado 1:1 a um fixture ──

test('CONTRACT: [corpus 1] verbo desconhecido produz achado nomeando o verbo ofensor', () => {
  const result = runCheck('01-unknown-verb');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 3);
  assert.match(finding.message, /mark-done/);
});

test('CONTRACT: [corpus 2] argumento posicional obrigatório ausente produz achado', () => {
  const result = runCheck('02-missing-required-positional');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 3);
  // O contrato só tem template de mensagem explícito para "flag obrigatória
  // ausente" ('{verbo}' exige {--flag}, ausente aqui) — não há linha na
  // tabela dedicada a "positional obrigatório ausente". Assumindo que T-06
  // reusa o mesmo template com o nome do posicional no lugar de {--flag}.
  // Ver "Surpresas" no report — ambiguidade real do contrato, não decidida
  // aqui.
  assert.match(finding.message, /spec-lint/);
  assert.match(finding.message, /ausente/i);
});

test('CONTRACT: [corpus 3] flag não declarada produz achado nomeando a flag', () => {
  const result = runCheck('03-undeclared-flag');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 3);
  assert.match(finding.message, /--format/);
});

test('CONTRACT: [corpus 4] subverbo desconhecido produz achado nomeando subverbo e verbo', () => {
  const result = runCheck('04-wrong-subverb');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 3);
  assert.match(finding.message, /start/);
  assert.match(finding.message, /dispatch-record/);
});

// ── conhecido-BOM (corpus items 5-9) — cada um mapeado 1:1 a um fixture ──

test('CONTRACT: [corpus 5] invocação exata da superfície não produz achado', () => {
  const result = runCheck('05-exact-match');
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 6] flag opcional presente e ausente — ambas passam', () => {
  const result = runCheck('06-optional-flag-both-present-absent');
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 7] segunda forma alternativa do mesmo verbo casa — sem achado', () => {
  const result = runCheck('07-alternate-form-match-second');
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 8] menção em prosa ao nome do verbo não é invocação — zero achados', () => {
  const result = runCheck('08-prose-mention-not-invocation');
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 9] plan.md sem a cerca soma-cli-surface -> status skipped com reason, zero achados mesmo com invocação divergente presente', () => {
  const result = runCheck('09-no-fence-skipped');
  assert.equal(result.status, 'skipped');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0, 'esperava reason não-vazio quando status é skipped');
  assert.deepEqual(result.findings, []);
});

// ── AC-10: prova nos dois sentidos, agregada (bate literalmente com o ─────
// ── Contract Test Stub do arquivo de contrato) ────────────────────────────

test('CONTRACT: SENSIBILIDADE — os 4 fixtures ruins produzem achado, cada um nomeando o token ofensor', () => {
  const cases = [
    { fixture: '01-unknown-verb', token: 'mark-done' },
    { fixture: '02-missing-required-positional', token: 'ausente' },
    { fixture: '03-undeclared-flag', token: '--format' },
    { fixture: '04-wrong-subverb', token: 'start' },
  ];
  for (const { fixture, token } of cases) {
    const result = runCheck(fixture);
    assert.ok(result.findings.length >= 1, `fixture conhecido-ruim '${fixture}' não produziu achado — falso-negativo`);
    const messages = result.findings.map(f => f.message).join(' | ');
    assert.ok(messages.includes(token), `achado de '${fixture}' não nomeia o token ofensor '${token}': ${messages}`);
  }
});

test('CONTRACT: ESPECIFICIDADE — os 5 fixtures bons produzem zero achado', () => {
  const good = [
    '05-exact-match',
    '06-optional-flag-both-present-absent',
    '07-alternate-form-match-second',
    '08-prose-mention-not-invocation',
    '09-no-fence-skipped',
  ];
  for (const fixture of good) {
    const result = runCheck(fixture);
    assert.deepEqual(result.findings, [], `fixture conhecido-bom '${fixture}' produziu achado — falso-positivo`);
  }
});

// ── Granularidade do achado (fora do corpus numerado dos 9) ───────────────

test('CONTRACT: uma invocação com duas flags erradas produz DOIS achados, não um', () => {
  const result = runCheck('10-two-bad-flags-single-invocation');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 2, `esperava 2 achados (uma flag cada), veio ${JSON.stringify(result.findings)}`);
  const messages = result.findings.map(f => f.message).join(' | ');
  assert.match(messages, /--format/);
  assert.match(messages, /--check/);
});
