'use strict';
/**
 * contract-lint-output.test.cjs — CONTRACT-LINT-OUTPUT-01 contract tests
 *
 * Covers the 8 cases enumerated in the "Contract Test Stub" section of
 * `core/specs/017-soma-spec-lint/contracts/lint-output.md`: the shape of the
 * output artifact (stdout lines + exit code), not the semantics of either
 * check. `checks/cli-surface.cjs` and `checks/parallel-collision.cjs` are
 * still stubs at T-03 time (T-06/T-07 implement them) — tests that need a
 * REAL achado to exist (format, content, path-relativity, order) are
 * planned RED here and turn GREEN once those land. This file does not
 * duplicate T-02's `spec-lint.test.cjs` (arg validation / dispatcher
 * registration); where a case overlaps (arg absent, dir sem spec.md) this
 * file asserts the CONTRACT-LINT-OUTPUT-01-specific angle — stdout is
 * COMPLETELY empty on argument error, not just missing the footer text.
 *
 * Article II HARD: some tests below are deliberate RED (T-06/T-07 close
 * them) — see the per-test comments for which task closes which.
 * Article III HARD: real fs + real child_process, zero mocks. Fixtures are
 * static directories under `fixtures/spec-lint/output/` (not generated in
 * tmpdir — this contract's own fixtures are the deliverable, so they're
 * inspectable/committed rather than built inline).
 *
 * Trap avoided: never read child stdout with `|| '[]'` / `?.` / silent
 * catch — `runSpecLint()` below asserts the child exited with a numeric
 * status (not killed by signal/timeout) BEFORE any test interprets stdout.
 * A crashed child with empty stdout must never look like "zero achados".
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-06]
 * @contract CONTRACT-LINT-OUTPUT-01
 * @task T-03
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const SPEC_LINT_CLI = path.resolve(__dirname, '..', 'spec-lint.cjs');
const FIXTURES = path.resolve(__dirname, 'fixtures', 'spec-lint', 'output');

function runSpecLint(args = [], cwd) {
  const opts = { encoding: 'utf8', timeout: 15_000 };
  if (cwd) opts.cwd = cwd;
  const r = spawnSync('node', [SPEC_LINT_CLI, ...args], opts);
  // Assert the child actually exited (not killed by signal/timeout, not a
  // spawn error) BEFORE any test below interprets stdout/stderr as data.
  assert.equal(
    typeof r.status,
    'number',
    `child process did not exit with a status code — signal: ${r.signal}, error: ${r.error}. ` +
      `A crashed/killed child must never be silently read as "zero achados".`
  );
  return r;
}

// "{check}: {arquivo}:{linha}: {mensagem}" — CONTRACT-LINT-OUTPUT-01 §Payload
const FINDING_LINE_RE = /^(cli-surface|parallel-collision): (\S+):(\d+): (.+)$/;
// "checks executados: {lista}  |  pulados: {lista ou "-"}  |  achados: {n}"
const FOOTER_RE = /^checks executados: (.+)  \|  pulados: (.+)  \|  achados: (\d+)$/;

function findingLines(stdout) {
  return stdout.split('\n').filter(Boolean).filter(l => FINDING_LINE_RE.test(l));
}

function parseFooter(stdout) {
  const lines = stdout.split('\n').filter(Boolean);
  const footerLine = lines[lines.length - 1];
  const m = footerLine ? FOOTER_RE.exec(footerLine) : null;
  assert.ok(m, `last non-empty stdout line must match the footer shape. Got: "${footerLine}". Full stdout:\n${stdout}`);
  return {
    executed: m[1] === '-' ? [] : m[1].split(', '),
    skipped: m[2] === '-' ? [] : m[2].split(', '),
    count: Number(m[3]),
    line: footerLine,
  };
}

// ── Case 1: spec limpa → exit 0, zero achados, rodapé presente ──────────────
// AC-01. Real behavior already — both checks are stubs that emit zero
// findings on ANY input, so this passes today without needing T-06/T-07.

test('CONTRACT-LINT-OUTPUT-01: spec limpa -> exit 0, nenhuma linha de achado, rodapé presente', () => {
  const dir = path.join(FIXTURES, 'clean');
  const r = runSpecLint([dir]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  const findings = findingLines(r.stdout);
  assert.equal(findings.length, 0, `expected zero achado lines. Got stdout:\n${r.stdout}`);
  const footer = parseFooter(r.stdout);
  assert.equal(footer.count, 0, `footer achados must be 0. Got footer: "${footer.line}"`);
});

// ── Case 2: spec com violação → exit 1, cada achado no formato do contrato ──
// AC-02. RED até T-06: os stubs nunca emitem achado, então este fixture
// (que injeta um verbo e uma flag desconhecidos em quickstart.md) hoje
// sai com exit 0 e zero achados — a asserção de exit 1 falha de propósito.

test('CONTRACT-LINT-OUTPUT-01: spec com violação -> exit 1, achados no formato "{check}: {arquivo}:{linha}: {mensagem}" [RED até T-06]', () => {
  const dir = path.join(FIXTURES, 'violation');
  const r = runSpecLint([dir]);
  assert.equal(
    r.status,
    1,
    `Once cli-surface stops being a stub (T-06), this fixture (unknown verb 'frobnicate' + ` +
      `undeclared flag '--format' in quickstart.md) must produce >=1 achado and exit 1. ` +
      `Got exit ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`
  );
  const findings = findingLines(r.stdout);
  assert.ok(findings.length >= 1, `expected at least one achado line. Got stdout:\n${r.stdout}`);
  for (const line of findings) {
    const m = FINDING_LINE_RE.exec(line);
    assert.ok(m, `achado line must match "{check}: {arquivo}:{linha}: {mensagem}". Got: "${line}"`);
    const [, check, file, lineNo, message] = m;
    assert.ok(['cli-surface', 'parallel-collision'].includes(check), `unexpected check name: "${check}"`);
    assert.ok(!path.isAbsolute(file), `arquivo must be relative, not absolute. Got: "${file}"`);
    assert.ok(Number(lineNo) >= 1, `linha must be 1-indexed (>=1). Got: "${lineNo}"`);
    assert.ok(message.trim().length > 0, `mensagem must not be empty. Line: "${line}"`);
  }
  const footer = parseFooter(r.stdout);
  assert.equal(
    footer.count,
    findings.length,
    `footer "achados: N" must equal the number of achado lines actually emitted. Footer: "${footer.line}", achado lines: ${findings.length}`
  );
});

// ── Case 3: CONTEÚDO — a mensagem nomeia o token ofensor, não a categoria ──
// AC-02 (field constraint "mensagem ... nomeando o token ofensor"). RED até
// T-06, pelo mesmo motivo do caso 2.

test('CONTRACT-LINT-OUTPUT-01: CONTEÚDO -- a mensagem nomeia o token ofensor, não só a categoria [RED até T-06]', () => {
  const dir = path.join(FIXTURES, 'violation');
  const r = runSpecLint([dir]);
  assert.equal(r.status, 1, `stdout: ${r.stdout} stderr: ${r.stderr}`);
  const findings = findingLines(r.stdout);
  assert.ok(findings.length >= 1, `expected at least one achado line. Got stdout:\n${r.stdout}`);
  const messages = findings.map(l => FINDING_LINE_RE.exec(l)[4]);

  // The fixture injects two concrete offending tokens (quickstart.md): an
  // undeclared flag and an unknown verb. At least one message must name
  // EACH — a category-only message ("invocação inválida") would be a
  // falso-verde per CONTRACT-LINT-OUTPUT-01 §Payload field constraints.
  assert.ok(
    messages.some(m => m.includes('--format')),
    `expected some message to name the offending flag "--format". Got messages: ${JSON.stringify(messages)}`
  );
  assert.ok(
    messages.some(m => m.includes('frobnicate')),
    `expected some message to name the offending verb "frobnicate". Got messages: ${JSON.stringify(messages)}`
  );
  for (const m of messages) {
    assert.notEqual(
      m.trim().toLowerCase(),
      'invocação inválida',
      `message must not be a vague category label with no offending token. Got: "${m}"`
    );
  }
});

// ── Case 4: argumento ausente → exit 2, nenhum check, stdout vazio ─────────
// AC-03. Real behavior already (spec-lint.cjs's fail() runs before any
// check). Stronger than T-02's version: asserts stdout is COMPLETELY empty,
// not just missing the "checks executados" substring — an error before
// execution has nothing to summarize.

test('CONTRACT-LINT-OUTPUT-01: argumento ausente -> exit 2, stdout completamente vazio (sem rodapé)', () => {
  const r = runSpecLint([]);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.equal(r.stdout, '', `no execution happened — stdout must be entirely empty, not just missing the footer. Got: "${r.stdout}"`);
  assert.ok(r.stderr.length > 0, 'expected an error message on stderr');
});

// ── Case 5: <spec-dir> existe mas sem spec.md → exit 2 nomeando o que falta ─
// AC-03. Real behavior already.

test('CONTRACT-LINT-OUTPUT-01: <spec-dir> sem spec.md -> exit 2 nomeando o que falta, stdout vazio', () => {
  const dir = path.join(FIXTURES, 'no-spec-md');
  const r = runSpecLint([dir]);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.equal(r.stdout, '', `no execution happened — stdout must be entirely empty. Got: "${r.stdout}"`);
  assert.match(r.stderr, /spec\.md/, `error must name the missing file (spec.md). stderr: ${r.stderr}`);
});

// ── Case 6: path do achado é relativo ao spec-dir, idêntico em 2 cwd's ─────
// CONTRACT-LINT-OUTPUT-01 §Payload: "arquivo ... path relativo ao <spec-dir>.
// Nunca absoluto". RED até T-06 — a asserção de findings1.length >= 1 força
// isso: sem achado real, "idêntico entre 2 cwd's" seria uma prova vazia
// (dois rodapés de zero achados são trivialmente iguais e não provam nada
// sobre relatividade de path).

test('CONTRACT-LINT-OUTPUT-01: arquivo do achado é relativo ao spec-dir, saída idêntica rodando de dois cwd diferentes [RED até T-06]', () => {
  const dir = path.join(FIXTURES, 'violation');
  const cwdA = os.tmpdir();
  const cwdB = path.resolve(__dirname, '..');
  const r1 = runSpecLint([dir], cwdA);
  const r2 = runSpecLint([dir], cwdB);
  assert.equal(r1.status, r2.status, `exit code must not depend on cwd. cwdA: ${r1.status}, cwdB: ${r2.status}`);
  assert.equal(r1.stdout, r2.stdout, 'stdout must be byte-identical regardless of process cwd (spec-dir arg is always absolute)');

  const findings1 = findingLines(r1.stdout);
  assert.ok(
    findings1.length >= 1,
    `this proof is only meaningful once cli-surface (T-06) emits real findings against the ` +
      `"violation" fixture. Got stdout:\n${r1.stdout}`
  );
  for (const line of findings1) {
    const m = FINDING_LINE_RE.exec(line);
    const file = m[2];
    assert.ok(!path.isAbsolute(file), `arquivo must never be absolute — it leaks the user's home dir. Got: "${file}"`);
    assert.ok(!file.includes(dir), `arquivo must not embed the spec-dir path at all. Got: "${file}"`);
  }
});

// ── Case 7: check pulado aparece no rodapé como pulado, não some ──────────
// AC-06. RED até T-06 — o stub de cli-surface sempre reporta status "ran",
// então nunca aparece em "pulados" hoje, mesmo sem a cerca soma-cli-surface.

test('CONTRACT-LINT-OUTPUT-01: check pulado aparece no rodapé em "pulados", não some e não aparece em "executados" [RED até T-06]', () => {
  const dir = path.join(FIXTURES, 'no-fence-skip');
  const r = runSpecLint([dir]);
  // No fence + no tasks.md -> zero achados de qualquer forma; o que este
  // teste prova é o rótulo do check no rodapé, não o exit code.
  assert.equal(r.status, 0, `stdout: ${r.stdout} stderr: ${r.stderr}`);
  const footer = parseFooter(r.stdout);
  assert.ok(
    footer.skipped.includes('cli-surface'),
    `plan.md sem a cerca soma-cli-surface -> cli-surface deve aparecer em "pulados". Got footer: "${footer.line}"`
  );
  assert.ok(
    !footer.executed.includes('cli-surface'),
    `cli-surface pulado não pode TAMBÉM aparecer em "executados". Got footer: "${footer.line}"`
  );
});

// ── Case 8: ordem dos achados é byte-a-byte estável entre execuções ───────
// CONTRACT-LINT-OUTPUT-01 §Emitter: "Ordem instável faz diff de saída virar
// ruído". RED até T-06 — a asserção de findings1.length >= 2 força isso: com
// zero achados, "idêntico entre 2 execuções" é trivialmente verdade e não
// prova nada sobre estabilidade de ordem.

test('CONTRACT-LINT-OUTPUT-01: ordem dos achados é byte-a-byte estável entre duas execuções do mesmo fixture [RED até T-06]', () => {
  const dir = path.join(FIXTURES, 'violation');
  const r1 = runSpecLint([dir]);
  const r2 = runSpecLint([dir]);
  assert.equal(r1.status, r2.status);
  assert.equal(r1.stdout, r2.stdout, 'running the same fixture twice must produce byte-identical stdout');

  const findings1 = findingLines(r1.stdout);
  assert.ok(
    findings1.length >= 2,
    `expected >=2 achados (this fixture injects 2 distinct violations in quickstart.md) so that ` +
      `"identical" is a meaningful proof of order-stability, not a vacuous match of two empty ` +
      `outputs. Got stdout:\n${r1.stdout}`
  );
  const lines = findings1.map(l => Number(FINDING_LINE_RE.exec(l)[3]));
  const sorted = [...lines].sort((a, b) => a - b);
  assert.deepEqual(
    lines,
    sorted,
    `achados within the same file (quickstart.md) must come out sorted by line ascending. Got line numbers: ${JSON.stringify(lines)}`
  );
});
