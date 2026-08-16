'use strict';
/**
 * spec-lint.test.cjs — T-02 foundation tests for `soma spec-lint <spec-dir>`
 *
 * Covers only the CLI skeleton contract (AC-03, AC-04, AC-14): argument
 * validation, exit codes, dispatcher registration, and the always-emitted
 * footer. The two checks are stubs at this stage (T-06/T-07 implement the
 * real logic) — contract tests for `cli-surface` and `parallel-collision`
 * live in T-03/T-04/T-05, not here.
 *
 * Article II HARD: RED phase — every test here must FAIL before
 * spec-lint.cjs and lib/spec-lint/* exist.
 * Article III HARD: real fs + real child_process, zero mocks. Fixtures live
 * in os.tmpdir() (NOT /tmp — this Mac's os.tmpdir() is /var/folders/...).
 *
 * @spec [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-14]
 * @contract CONTRACT-LINT-OUTPUT-01
 * @task T-02
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SPEC_LINT_CLI = path.resolve(__dirname, '..', 'spec-lint.cjs');
const SOMA_CLI = path.resolve(__dirname, '..', 'soma.cjs');

function runSpecLint(args = []) {
  return spawnSync('node', [SPEC_LINT_CLI, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function runSpecLintFromCwd(args, cwd) {
  return spawnSync('node', [SPEC_LINT_CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function runSoma(args = []) {
  return spawnSync('node', [SOMA_CLI, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

/** A minimal valid spec-dir: just spec.md, nothing else required to exist. */
function makeValidSpecDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-spec-lint-t02-'));
  fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec: fixture\n\nFeature ID: fixture\n');
  return dir;
}

/** A dir that exists but has no spec.md. */
function makeSpecDirWithoutSpecMd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-spec-lint-t02-nospec-'));
  fs.writeFileSync(path.join(dir, 'plan.md'), '# plan\n');
  return dir;
}

// ── AC-03: argumento ausente ou inexistente → exit 2, nenhum check, sem rodapé ──

test('T-02: soma spec-lint sem argumento → exit 2, sem rodapé', () => {
  const r = runSpecLint([]);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.ok(r.stderr.length > 0, 'expected an error message on stderr');
  assert.ok(
    !/checks executados/.test(r.stdout),
    `no execution happened — footer must NOT be printed. stdout: ${r.stdout}`
  );
});

test('T-02: soma spec-lint /caminho/inexistente → exit 2', () => {
  const bogus = path.join(os.tmpdir(), 'soma-spec-lint-t02-does-not-exist-' + process.pid);
  assert.ok(!fs.existsSync(bogus), 'precondition: fixture path must not exist');
  const r = runSpecLint([bogus]);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.ok(
    !/checks executados/.test(r.stdout),
    `no execution happened — footer must NOT be printed. stdout: ${r.stdout}`
  );
});

test('T-02: <spec-dir> existe mas sem spec.md → exit 2 nomeando o que falta', () => {
  const dir = makeSpecDirWithoutSpecMd();
  const r = runSpecLint([dir]);
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.ok(
    /spec\.md/.test(r.stderr),
    `error must name the missing file (spec.md). stderr: ${r.stderr}`
  );
});

// ── AC-04: soma --help lista spec-lint ───────────────────────────────────────

test('T-02: soma --help lista spec-lint com descrição de uma linha', () => {
  const r = runSoma(['--help']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const lintLine = r.stdout.split('\n').find(l => /\bspec-lint\b/.test(l));
  assert.ok(lintLine, `--help output must list "spec-lint". Got:\n${r.stdout}`);
  // one-line description: something after the subcommand name on the same line
  assert.ok(
    lintLine.trim().length > 'spec-lint'.length,
    `spec-lint line must carry a description, not just the bare name. Got: "${lintLine}"`
  );
});

// ── AC-01/AC-14: <spec-dir> válido → exit 0 com rodapé listando os dois checks ──

test('T-02: <spec-dir> válido → exit 0 com rodapé listando cli-surface e parallel-collision como executados', () => {
  const dir = makeValidSpecDir();
  const r = runSpecLint([dir]);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  const footer = r.stdout.trim().split('\n').pop();
  assert.match(footer, /^checks executados: .+\s{2}\|\s{2}pulados: .+\s{2}\|\s{2}achados: \d+$/,
    `footer must match the CONTRACT-LINT-OUTPUT-01 shape. Got: "${footer}"`);
  assert.ok(footer.includes('cli-surface'), `footer must list cli-surface as executed. Got: "${footer}"`);
  assert.ok(footer.includes('parallel-collision'), `footer must list parallel-collision as executed. Got: "${footer}"`);
  assert.ok(footer.endsWith('achados: 0'), `stub checks emit zero findings. Got: "${footer}"`);
});

// ── Path relativity proof: identical output from two different cwd's ────────
// (both invocations pass an ABSOLUTE spec-dir, so cwd must not leak into output)

test('T-02: saída idêntica byte-a-byte rodando de dois cwd diferentes', () => {
  const dir = makeValidSpecDir();
  const cwdA = os.tmpdir();
  const cwdB = path.resolve(__dirname, '..');
  const r1 = runSpecLintFromCwd([dir], cwdA);
  const r2 = runSpecLintFromCwd([dir], cwdB);
  assert.equal(r1.status, 0, `run from cwdA failed: ${r1.stderr}`);
  assert.equal(r2.status, 0, `run from cwdB failed: ${r2.stderr}`);
  assert.equal(r1.stdout, r2.stdout, 'stdout must be identical regardless of process cwd');
});

// ── Registration proof: the dispatcher actually delegates to spec-lint.cjs ──

test('T-02: soma spec-lint <dir> (via dispatcher) delegates and exits 0', () => {
  const dir = makeValidSpecDir();
  const r = runSoma(['spec-lint', dir]);
  assert.equal(r.status, 0, `Expected exit 0 via dispatcher, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.ok(/checks executados/.test(r.stdout), `dispatcher delegation must produce the footer. stdout: ${r.stdout}`);
});
