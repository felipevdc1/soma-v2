'use strict';
/**
 * run-gate.test.cjs — integration test for `soma run gate` (Spec 016, T-07)
 *
 * Covers the 5 blocking paths of CONTRACT-STEP-REPORT-01's gate semantics
 * table (contracts/emit-step-report.md §"Gate semantics"), one by one, as
 * tasks.md's T-07 row requires: ausência, fail, blocked, inválido, ilegível
 * — every one of them exit 2 with the cause NAMED in output, never exit 0.
 *
 * Report fixtures are written directly via fs (not through `soma run
 * report`) so this file is decoupled from T-06 (run/report.cjs), which is a
 * different task landing in the same wave — this file must be correct
 * whether or not that sibling exists yet in the working tree.
 *
 * This file's [SPEC:AC-10] slice is ONLY "report ilegível" (corrupt JSON —
 * case 5 below). The other AC-10 slice ("check externo não executa") is
 * T-15's (hooks/spec-test-traceability.cjs) and is not touched here.
 *
 * Also covers: routing through `--validate` — every failure path (missing
 * metadata for the task, missing --validator flag) must satisfy the same
 * invariant, never a raw MODULE_NOT_FOUND/Cannot find module stack trace,
 * always exit 2 with the cause named (see plan.md §"Teste-de-irmão-ausente:
 * a segunda metade do RED-by-design" for why this is asserted as an
 * invariant rather than a specific message) — and run-resolution failure
 * when neither --run nor a readable .soma.lock is available.
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 * ⚠️ os.tmpdir() on this machine is NOT /tmp — never hardcode the literal
 * (plan.md §Dependencies; false-green twice already in this phase).
 * ⚠️ Exit code alone doesn't distinguish "ran and correctly refused" from
 * "crashed mid-way" — both give non-zero. Every assertion below also checks
 * stdout/stderr content, not just the exit code (T-15's finding, echoed in
 * the T-07 dispatch brief).
 *
 * @spec [SPEC:AC-02] [SPEC:AC-10]
 * @contract CONTRACT-STEP-REPORT-01
 * @task T-07
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const PATHS_MODULE = path.resolve(__dirname, '..', 'run', 'paths.cjs');
const { resolveSomaPaths } = require(PATHS_MODULE);

function runRun(args, { cwd }) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function makeFixtureProject() {
  // ⚠️ os.tmpdir() on this Mac is NOT '/tmp' — never hardcode the literal.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t07-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

function writeLock(projectRoot, runId) {
  fs.writeFileSync(
    path.join(projectRoot, '.soma.lock'),
    JSON.stringify({ sessionId: 'test-session-t07', runId, startedAt: new Date().toISOString() }),
    'utf8'
  );
}

function reportPathFor(projectRoot, runId, step) {
  const p = resolveSomaPaths(projectRoot, runId);
  return path.join(p.runReportsDir, `${step}-report.json`);
}

function writeReport(projectRoot, runId, step, payload) {
  const filePath = reportPathFor(projectRoot, runId, step);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return filePath;
}

function validPassReport(overrides = {}) {
  return {
    schema: 'soma-step-report/v1',
    run_id: 'run-t07-fixture',
    step: 'STEP_2_TASKS',
    status: 'pass',
    started_at: '2026-08-16T00:00:00.000Z',
    finished_at: '2026-08-16T00:01:00.000Z',
    artifacts: [],
    metrics: {},
    notes: '',
    ...overrides,
  };
}

// ── Sanity: pass path exits 0 (not one of the 5 blocking paths, but the
//    control case that proves the other 5 are genuinely being blocked, not
//    just always-fail). ──────────────────────────────────────────────────

// @spec AC-02
test('T-07 sanity: report presente, válido, status pass → gate exit 0', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-sanity';
    writeLock(projectRoot, runId);
    writeReport(projectRoot, runId, 'STEP_2_TASKS', validPassReport({ run_id: runId, step: 'STEP_2_TASKS' }));

    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 0, `esperava exit 0. stderr=${result.stderr} stdout=${result.stdout}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── The 5 blocking paths, one by one ───────────────────────────────────────

// @spec AC-02
test('T-07 caminho 1/5 — ausência: nenhum report emitido → exit 2, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-absent';
    writeLock(projectRoot, runId);
    // STEP_2_TASKS nunca teve report emitido.

    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(/STEP_2_TASKS/.test(out), `deve nomear o step com report faltante. Output: ${out}`);
    assert.ok(/ausente/i.test(out), `deve nomear "ausência" como causa. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
test('T-07 caminho 2/5 — status fail: report válido mas fail → exit 2, cita failure_reason', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-fail';
    const reason = 'suite RED planejado não fechou — 3 casos ainda vermelhos';
    writeLock(projectRoot, runId);
    writeReport(
      projectRoot,
      runId,
      'STEP_2_TASKS',
      validPassReport({ run_id: runId, step: 'STEP_2_TASKS', status: 'fail', failure_reason: reason })
    );

    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(out.includes(reason), `deve citar o failure_reason específico. Output: ${out}`);
    assert.ok(/fail/.test(out), `deve nomear o status "fail". Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
test('T-07 caminho 3/5 — status blocked: report válido mas blocked → exit 2, cita failure_reason', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-blocked';
    const reason = 'aguardando aprovação humana do Gate 1';
    writeLock(projectRoot, runId);
    writeReport(
      projectRoot,
      runId,
      'STEP_2_TASKS',
      validPassReport({ run_id: runId, step: 'STEP_2_TASKS', status: 'blocked', failure_reason: reason })
    );

    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(out.includes(reason), `deve citar o failure_reason específico. Output: ${out}`);
    assert.ok(/blocked/.test(out), `deve nomear o status "blocked". Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
test('T-07 caminho 4/5 — inválido: report com campo obrigatório ausente → exit 2, nomeia o campo', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-invalid';
    writeLock(projectRoot, runId);
    const broken = validPassReport({ run_id: runId, step: 'STEP_2_TASKS' });
    delete broken.metrics; // campo obrigatório, sempre presente no contrato

    writeReport(projectRoot, runId, 'STEP_2_TASKS', broken);

    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(/metrics/.test(out), `deve nomear o campo ausente "metrics". Output: ${out}`);
    assert.ok(/inv[aá]lido/i.test(out), `deve nomear "inválido" como causa. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
// @spec AC-10
test('T-07 caminho 5/5 — ilegível: JSON corrompido → exit 2, causa de não-legibilidade (AC-10, fatia "artefato ilegível")', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-illegible';
    writeLock(projectRoot, runId);
    const filePath = reportPathFor(projectRoot, runId, 'STEP_2_TASKS');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ isto não é json válido', 'utf8');

    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.notEqual(result.status, 0, 'impossibilidade de ler nunca pode ser exit 0 (AC-10)');
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(/n[aã]o\s+leg[ií]vel/i.test(out), `deve declarar causa de não-legibilidade. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── Resolução de run: sem --run e sem .soma.lock legível ──────────────────

test('T-07: sem --run e sem .soma.lock legível → erro nomeando as duas formas de resolver, exit 2', () => {
  const projectRoot = makeFixtureProject();
  try {
    // Nenhum .soma.lock escrito de propósito.
    const result = runRun(['gate', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(/--run/.test(out), `deve mencionar a flag --run. Output: ${out}`);
    assert.ok(/\.soma\.lock/.test(out), `deve mencionar .soma.lock. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── Rota --validate: roteamento e invariante de robustez ──────────────────
//
// Todo caminho de FALHA de `--validate` tem que satisfazer o MESMO
// invariante, qualquer que seja a causa específica: exit 2, stderr NUNCA
// vaza um stack cru de MODULE_NOT_FOUND/Cannot find module, e a causa é
// nomeada — nunca silêncio. plan.md §"Teste-de-irmão-ausente: a segunda
// metade do RED-by-design" (2026-08-17) documenta por quê a versão anterior
// deste teste morreu: ela asserted a MENSAGEM específica de "módulo
// ausente" (run/validator-invariant.cjs não encontrado). No dia em que a
// T-11 pousou esse módulo, o `gate.cjs` passou a carregá-lo com sucesso e a
// falhar mais adiante — por metadata ausente. Exit code e comportamento
// continuaram certos; só a asserção de string morreu, porque a pergunta
// certa nunca foi "essa mensagem aparece", foi "o roteamento nunca vaza um
// stack cru". Escrita como invariante, esta versão sobrevive à chegada de
// qualquer módulo irmão futuro — regra geral que a mesma seção do plan.md
// fixa: todo teste cuja asserção depende de um artefato NÃO existir tem
// prazo de validade igual à wave que o cria.

/**
 * @param {{status: number, stdout: string, stderr: string}} result
 * @param {{context: string}} opts
 * @returns {string} stdout+stderr combinado, para asserções adicionais do chamador
 */
function assertValidateFailureInvariant(result, { context }) {
  assert.equal(result.status, 2, `${context}: esperava exit 2. stdout=${result.stdout} stderr=${result.stderr}`);
  const out = result.stdout + result.stderr;
  assert.ok(
    !/MODULE_NOT_FOUND/.test(out) && !/Cannot find module/.test(out),
    `${context}: NUNCA um stack cru de MODULE_NOT_FOUND/Cannot find module — tem que ser erro legível nomeando a causa. Output: ${out}`
  );
  assert.ok(out.trim().length > 0, `${context}: a causa tem que ser nomeada, nunca silêncio. Output vazio.`);
  return out;
}

// Caminho REAL que acontece hoje: run/validator-invariant.cjs (T-11) existe
// e é carregado com sucesso, mas a task nunca foi dispatched — nenhum
// .soma/dispatches/{runId}/T-03/metadata.json foi fabricado. O invariante
// executor≠validador falha FECHADO (AC-10's corollary, aplicado por T-11
// também a este módulo) em vez de aprovar por não conseguir verificar.
test('T-07 --validate: metadata ausente para a task (módulo presente) → exit 2, causa nomeada, invariante preservado', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-validate';
    writeLock(projectRoot, runId);

    const result = runRun(['gate', '--validate', 'T-03', '--validator', 'soma-lab-T-99'], { cwd: projectRoot });
    const out = assertValidateFailureInvariant(result, { context: 'metadata ausente' });
    assert.ok(/metadata/i.test(out), `deve nomear "metadata" como a causa concreta hoje. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('T-07 --validate: exige --validator junto de --validate → exit 2 sem tentar carregar o módulo, invariante preservado', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-validate-missing-flag';
    writeLock(projectRoot, runId);

    const result = runRun(['gate', '--validate', 'T-03'], { cwd: projectRoot });
    const out = assertValidateFailureInvariant(result, { context: '--validator ausente' });
    assert.ok(/--validator/.test(out), `deve nomear a flag ausente --validator. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── Nenhum verbo/flag reconhecido ──────────────────────────────────────────

test('T-07: gate sem --step e sem --validate → exit 2, nomeia as duas formas de uso', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t07-noargs';
    writeLock(projectRoot, runId);

    const result = runRun(['gate'], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout}`);
    const out = result.stdout + result.stderr;
    assert.ok(/--step/.test(out) && /--validate/.test(out), `deve nomear as duas formas de uso. Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
