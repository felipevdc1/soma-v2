'use strict';
/**
 * contract-check-cli-surface.test.cjs — T-04 / hardened T-06 / narrowed T-11
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
 * T-11 / D-017-01: every fixture's invocation (except 08, the deliberate
 * prose-mention case) now lives inside a ```bash fence in quickstart.md,
 * not an inline backtick span. Measured 2026-08-16: running this check
 * against the 017 spec itself produced 10 findings, all false-positive,
 * all from inline backtick prose (a table row, a heading, a sentence
 * describing a test case). D-017-01 fixes that by never sweeping inline
 * spans at all — so a fixture whose "bad" invocation stayed inline would
 * silently stop firing, which is why fixtures 01-04 (and 10) were
 * migrated to fenced blocks, not just left passing by omission.
 *
 * @spec [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-10]
 * @contract CONTRACT-CHECK-CLI-SURFACE-01
 * @task T-04 / T-06 / T-11
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContext } = require('../lib/spec-lint/context.cjs');
const cliSurface = require('../lib/spec-lint/checks/cli-surface.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures/spec-lint/cli-surface');

function loadFixture(fixtureName) {
  const specDir = path.join(FIXTURES_DIR, fixtureName);
  return buildContext(specDir);
}

function runCheck(fixtureName) {
  return cliSurface.run(loadFixture(fixtureName));
}

// ── conhecido-RUIM (corpus items 1-4) — cada um mapeado 1:1 a um fixture ──

// T-11 / D-017-01: the invocation now lives inside a ```bash fence, not an
// inline backtick span (inline is never swept — see below). Each fixture's
// quickstart.md is `# Quickstart` / blank / one prose line / blank /
// ```bash / <invocation> / ``` — the invocation always lands on line 6.

test('CONTRACT: [corpus 1] verbo desconhecido produz achado nomeando o verbo ofensor', () => {
  const result = runCheck('01-unknown-verb');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 6);
  assert.match(finding.message, /mark-done/);
});

test('CONTRACT: [corpus 2] argumento posicional obrigatório ausente produz achado', () => {
  const result = runCheck('02-missing-required-positional');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 6);
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
  assert.equal(finding.line, 6);
  assert.match(finding.message, /--format/);
});

test('CONTRACT: [corpus 4] subverbo desconhecido produz achado nomeando subverbo e verbo', () => {
  const result = runCheck('04-wrong-subverb');
  assert.equal(result.status, 'ran');
  assert.equal(result.findings.length, 1, `esperava 1 achado, veio ${JSON.stringify(result.findings)}`);
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 6);
  assert.match(finding.message, /start/);
  assert.match(finding.message, /dispatch-record/);
});

// ── conhecido-BOM (corpus items 5-9) — cada um mapeado 1:1 a um fixture ──

// Corpus 5-9 (conhecido-BOM) are hardened with a content precondition
// before trusting "zero achados" — T-06 deliverable. `status==='ran'` +
// `findings===[]` alone only proves the fence was found and the check ran;
// it does NOT prove the fixture's quickstart.md actually contains the
// invocation the test is named for — an EMPTY quickstart.md would satisfy
// the same two assertions. Pattern copied from
// contract-check-parallel.test.cjs, which asserts the parsed shape
// (ctx.tasks fields) before asserting zero findings; here the analogous
// "parsed shape" is the loaded artifact's `.lines` (context.cjs's own
// {file, text, lines} transform of the raw file) — asserting the exact
// line content pins the fixture to the scenario it claims to test.

test('CONTRACT: [corpus 5] invocação exata da superfície não produz achado', () => {
  const ctx = loadFixture('05-exact-match');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.equal(
    quickstart.lines[5],
    'soma spec-lint core/specs/017-soma-spec-lint',
    'precondition: line 6 (inside the ```bash fence) must carry the exact-match invocation this test is named for'
  );
  const result = cliSurface.run(ctx);
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 6] flag opcional presente e ausente — ambas passam', () => {
  const ctx = loadFixture('06-optional-flag-both-present-absent');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.equal(
    quickstart.lines[5],
    'soma run gate --step build',
    'precondition: first ```bash fence must invoke without the optional --dry-run'
  );
  assert.equal(
    quickstart.lines[11],
    'soma run gate --step build --dry-run',
    'precondition: second ```bash fence must invoke WITH the optional --dry-run present'
  );
  const result = cliSurface.run(ctx);
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 7] segunda forma alternativa do mesmo verbo casa — sem achado', () => {
  const ctx = loadFixture('07-alternate-form-match-second');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.equal(
    quickstart.lines[5],
    'soma run gate --resume',
    'precondition: line 6 (inside the ```bash fence) must invoke the SECOND declared form of "run gate" ' +
      '(--resume), not the first (--step)'
  );
  assert.ok(
    !quickstart.text.includes('--step'),
    'precondition: fixture must not ALSO contain a --step invocation — otherwise a check that silently ' +
      'ignored form 2 entirely could still pass by matching form 1'
  );
  const result = cliSurface.run(ctx);
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 8] menção em prosa ao nome do verbo não é invocação — zero achados', () => {
  const ctx = loadFixture('08-prose-mention-not-invocation');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.equal(
    quickstart.lines[2],
    'O verbo `gate` decide a transição — não é chamado diretamente aqui.',
    'precondition: line 3 must carry a bare-verb mention in backticks, with no binary preceding it'
  );
  // T-11 / D-017-01: inline backtick spans are NEVER swept, regardless of
  // content — this fixture stays deliberately un-migrated (no ```bash
  // fence) so it keeps demonstrating exactly that: the boundary is
  // typographic (fenced vs not), not a judgment call about what the
  // backtick span contains.
  assert.ok(
    !quickstart.text.includes('```'),
    'precondition: fixture must have NO fenced block at all — this test proves inline mention is exempt ' +
      'by location (D-017-01), not because a fence happens to be absent for some other reason'
  );
  assert.ok(
    !quickstart.text.includes('soma'),
    'precondition: fixture must not contain the binary "soma" anywhere — otherwise a check that swept ' +
      'the whole line (not just the code span) could accidentally match on surrounding prose'
  );
  const result = cliSurface.run(ctx);
  assert.equal(result.status, 'ran');
  assert.deepEqual(result.findings, []);
});

test('CONTRACT: [corpus 9] plan.md sem a cerca soma-cli-surface -> status skipped com reason, zero achados mesmo com invocação divergente presente', () => {
  const ctx = loadFixture('09-no-fence-skipped');
  const plan = ctx.artifacts.find(a => a.file === 'plan.md');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(plan, 'precondition: fixture must have a plan.md artifact');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.ok(
    !plan.text.includes('```soma-cli-surface'),
    'precondition: plan.md must genuinely lack the soma-cli-surface fence'
  );
  assert.equal(
    quickstart.lines[5],
    'soma run mark-done --step X',
    'precondition: quickstart.md must carry a REAL divergent invocation (unknown verb mark-done), inside ' +
      'a ```bash fence so it would be seen if the check ran — otherwise "zero achados" would be trivially ' +
      'true, not evidence that the check was actually skipped'
  );
  const result = cliSurface.run(ctx);
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

// ── T-12: linha continuada por `\` (achado real da prova de aceitação da ──
// ── 016 — ver quickstart.md:126-127 da 016) — os DOIS lados obrigatórios ──
//
// `collectCandidateLines()` tratava cada linha física dentro da cerca como
// candidato independente: uma invocação legítima quebrada em `\` (a forma
// NORMAL de escrever um comando longo) tinha sua linha de continuação
// descartada (não começa com "soma") e a primeira linha sozinha parecia
// estar faltando toda flag que só existia nas linhas seguintes. Os dois
// fixtures abaixo usam a MESMA superfície (`run dispatch-record end` com 4
// flags obrigatórias) — a real, não uma reduzida — para provar nos dois
// sentidos, exatamente como o AC-10 exige em toda esta spec.

test('CONTRACT: [T-12] invocação continuada por \\ em 3 linhas, completa depois de juntar — zero achados', () => {
  const ctx = loadFixture('11-line-continuation-complete');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.equal(
    quickstart.lines[5],
    'soma run dispatch-record end --run run-lab-001 \\ ',
    'precondition: line 6 must end in "\\" followed by a stray trailing space before the newline — ' +
      'the exact trap the contract calls out ("\\ seguido de espaço em branco antes da quebra")'
  );
  assert.equal(quickstart.lines[6], '  --task T-03 \\', 'precondition: line 7 is a SECOND continuation, not the last');
  assert.equal(
    quickstart.lines[7],
    '  --output-file /tmp/lab-output.md --metadata-file /tmp/lab-meta.json',
    'precondition: line 8 closes the chain and carries the last two required flags — a 3-line ' +
      'continuation, proving the join is not hardcoded to exactly two lines'
  );
  const result = cliSurface.run(ctx);
  assert.equal(result.status, 'ran');
  assert.deepEqual(
    result.findings,
    [],
    `all 4 required flags ARE present once the 3 physical lines are joined — any finding here means ` +
      `the continuation join is broken. Got: ${JSON.stringify(result.findings)}`
  );
});

test('CONTRACT: [T-12] invocação continuada por \\, ainda incompleta depois de juntar — acusa (só) a flag que falta de verdade', () => {
  const ctx = loadFixture('12-line-continuation-incomplete');
  const quickstart = ctx.artifacts.find(a => a.file === 'quickstart.md');
  assert.ok(quickstart, 'precondition: fixture must have a quickstart.md artifact');
  assert.equal(
    quickstart.lines[5],
    'soma run dispatch-record end --run run-lab-001 --task T-03 \\',
    'precondition: line 6 carries --run and --task, then continues'
  );
  assert.equal(
    quickstart.lines[6],
    '  --output-file /tmp/lab-output.md',
    'precondition: line 7 carries --output-file (present!) but --metadata-file never appears anywhere ' +
      'in the fixture — the invocation is genuinely incomplete even after a correct join'
  );
  assert.ok(
    !quickstart.text.includes('--metadata-file'),
    'precondition: --metadata-file must be truly absent from the fixture, not just split across lines — ' +
      'otherwise this is corpus 12 in name only'
  );
  const result = cliSurface.run(ctx);
  assert.equal(result.status, 'ran');
  // Exactly 1 finding, naming --metadata-file, at line 6 (the FIRST physical
  // line of the invocation — contract: "a linha reportada... deve ser a da
  // primeira linha física"). A buggy join (or no join at all) either misses
  // this finding, reports it at the wrong line, or ALSO wrongly flags
  // --output-file as missing (it isn't — it's just on line 7) — that
  // 2-findings-instead-of-1 shape is exactly what the pre-fix code produced.
  assert.equal(
    result.findings.length,
    1,
    `esperava exatamente 1 achado (só --metadata-file falta de verdade), veio ${JSON.stringify(result.findings)}`
  );
  const [finding] = result.findings;
  assert.equal(finding.check, 'cli-surface');
  assert.equal(finding.file, 'quickstart.md');
  assert.equal(finding.line, 6, 'finding must point at the FIRST physical line of the invocation');
  assert.match(finding.message, /--metadata-file/);
  assert.doesNotMatch(
    finding.message,
    /--output-file/,
    '--output-file IS present (on line 7) — flagging it too would mean the join never happened'
  );
});
