'use strict';
/**
 * contract-step-report.test.cjs — CONTRACT-STEP-REPORT-01 (Spec 016, T-02)
 *
 * Contract test for `contracts/emit-step-report.md`. Article III: this test
 * exists BEFORE `soma run report` (T-06) and `soma run gate` (T-07) are
 * implemented — it IS the contract those two tasks must satisfy, not a test
 * of code that already exists.
 *
 * RED IS THE CORRECT STATE at T-02 time. Every case below is expected to
 * fail right now because `core/scripts/run/report.cjs` and
 * `core/scripts/run/gate.cjs` do not exist yet — `run.cjs` (T-01, already
 * landed) answers every verb call with VERB_NOT_IMPLEMENTED / exit 2. This
 * file does not create those modules; doing so would invade T-06/T-07.
 *
 * plan.md §"A restrição de design que veio da execução" governs every case
 * here: a report that validates against the schema but describes the wrong
 * thing is a false-green. No case below stops at "gate exits 2" — each one
 * that blocks also asserts the SPECIFIC reason the message must carry.
 *
 * CLI shape assumed (documented judgment call — see report to team lead):
 *   soma run report --run {runId} --step {STEP} --status {pass|fail|blocked} [--reason {reason}]
 *   soma run gate --step {STEP}
 * `report` takes an explicit `--run`, matching every example in
 * quickstart.md §1/§4 and the existing `resume --run {runId}` pattern
 * already baked into run.cjs's own --help text. `gate` does NOT take
 * `--run` in any quickstart.md example — it resolves the active run from
 * `.soma.lock`, the lock mechanism spec.md's Discovery section says
 * ALREADY EXISTS today (`soma-run.md` §0.3, `{sessionId, runId, startedAt}`),
 * independent of this spec's Wave 2 verbs. This test fabricates `.soma.lock`
 * directly via fs so it never depends on `soma run state` (T-08, a
 * different task, also unimplemented).
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-10]
 * @contract CONTRACT-STEP-REPORT-01
 * @task T-02
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const SCHEMA_MODULE = path.resolve(__dirname, '..', 'run', 'schema.cjs');
const PATHS_MODULE = path.resolve(__dirname, '..', 'run', 'paths.cjs');

const { resolveSomaPaths } = require(PATHS_MODULE);
const { validate } = require(SCHEMA_MODULE);

// ── CLI helper ──────────────────────────────────────────────────────────────

function runRun(args = [], { cwd }) {
  return spawnSync('node', [RUN_CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeFixtureProject() {
  // ⚠️ os.tmpdir() on this Mac is NOT '/tmp' — never hardcode the literal.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t02-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

// `.soma.lock` is a pre-existing mechanism (spec.md Discovery, soma-run.md
// §0.3) — not something T-02 invents. Fabricating it here lets `gate` (once
// implemented) resolve "the current run" without this contract test
// depending on `soma run state` (T-08, a different task).
function writeLock(projectRoot, runId) {
  const lockPath = path.join(projectRoot, '.soma.lock');
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ sessionId: 'test-session-t02', runId, startedAt: new Date().toISOString() }),
    'utf8'
  );
  return lockPath;
}

function reportPathFor(projectRoot, runId, step) {
  const p = resolveSomaPaths(projectRoot, runId);
  return path.join(p.runReportsDir, `${step}-report.json`);
}

function writeRawReport(projectRoot, runId, step, content) {
  const filePath = reportPathFor(projectRoot, runId, step);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// Mirrors the full soma-step-report/v1 field table from
// contracts/emit-step-report.md — used to check that a genuinely emitted
// report validates structurally, in addition to the CLI-level assertions.
const STEP_REPORT_SCHEMA = {
  fields: {
    schema: { type: 'string', required: true, const: 'soma-step-report/v1' },
    run_id: { type: 'string', required: true, minLength: 1 },
    step: { type: 'string', required: true, minLength: 1 },
    status: { type: 'string', required: true, enum: ['pass', 'fail', 'blocked'] },
    started_at: { type: 'string', required: true, minLength: 1 },
    finished_at: { type: 'string', required: true, minLength: 1 },
    artifacts: { type: 'array', required: true },
    metrics: { type: 'object', required: true },
    notes: { type: 'string', required: true },
    failure_reason: {
      type: 'string',
      requiredIf: (obj) => obj.status !== 'pass',
      minLength: 1,
    },
  },
};

// ── CONTRACT-STEP-REPORT-01 ─────────────────────────────────────────────────

// @spec AC-01
// @contract CONTRACT-STEP-REPORT-01
test('CONTRACT-STEP-REPORT-01 case 1: emite report válido e só então permite a transição', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t02-case1';
    writeLock(projectRoot, runId);

    const reportResult = runRun(
      ['report', '--run', runId, '--step', 'STEP_1A_SPECIFY', '--status', 'pass'],
      { cwd: projectRoot }
    );
    assert.equal(
      reportResult.status,
      0,
      `soma run report deve emitir com exit 0. status=${reportResult.status} stderr=${reportResult.stderr} stdout=${reportResult.stdout}`
    );

    const reportFile = reportPathFor(projectRoot, runId, 'STEP_1A_SPECIFY');
    assert.ok(fs.existsSync(reportFile), `Report não foi gravado em ${reportFile}`);

    const parsed = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const result = validate(STEP_REPORT_SCHEMA, parsed);
    assert.equal(
      result.valid,
      true,
      `Report gravado não valida contra soma-step-report/v1: ${JSON.stringify(result.violations)}`
    );
    assert.equal(parsed.status, 'pass');
    assert.equal(parsed.run_id, runId);
    assert.equal(parsed.step, 'STEP_1A_SPECIFY');

    const gateResult = runRun(['gate', '--step', 'STEP_1B_PLAN'], { cwd: projectRoot });
    assert.equal(
      gateResult.status,
      0,
      `gate deveria liberar a transição (exit 0) com report pass presente. status=${gateResult.status} stderr=${gateResult.stderr}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
// @contract CONTRACT-STEP-REPORT-01
test('CONTRACT-STEP-REPORT-01 case 2: CONTEÚDO — step falho produz status fail + failure_reason, e o gate bloqueia POR ISSO', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t02-case2';
    writeLock(projectRoot, runId);
    const reason = 'T-05 timed out esperando resposta do agente';

    const reportResult = runRun(
      ['report', '--run', runId, '--step', 'STEP_1B_PLAN', '--status', 'fail', '--reason', reason],
      { cwd: projectRoot }
    );
    assert.equal(
      reportResult.status,
      0,
      `report com status fail ainda deve gravar com exit 0 — quem bloqueia é o gate, não o report. status=${reportResult.status} stderr=${reportResult.stderr}`
    );

    const reportFile = reportPathFor(projectRoot, runId, 'STEP_1B_PLAN');
    const parsed = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.equal(parsed.status, 'fail');
    assert.equal(parsed.failure_reason, reason);

    const gateResult = runRun(['gate', '--step', 'STEP_1C_TASKS'], { cwd: projectRoot });
    assert.equal(
      gateResult.status,
      2,
      `gate deve bloquear com exit 2 quando o report anterior é fail. status=${gateResult.status}`
    );
    const output = gateResult.stdout + gateResult.stderr;
    // O ponto central do caso: bloquear não basta, tem que citar A RAZÃO
    // específica. Um teste que só checasse exit 2 passaria mesmo se o gate
    // bloqueasse pelo motivo errado — o falso-verde que o plan.md descreve.
    assert.ok(
      output.includes(reason),
      `O bloqueio tem que citar o failure_reason específico ("${reason}"), não recusar genericamente. Output: ${output}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
// @contract CONTRACT-STEP-REPORT-01
test('CONTRACT-STEP-REPORT-01 case 3: report ausente → gate exit 2 (prosa "done" do agente não conta)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t02-case3';
    writeLock(projectRoot, runId);
    // Nenhum report emitido para STEP_1A_SPECIFY — nem sequer tentamos
    // "soma run report". Um agente poderia ter dito "concluído com sucesso"
    // em prosa, mas nenhum artefato existe no disco. Isso não pode contar.

    const gateResult = runRun(['gate', '--step', 'STEP_1B_PLAN'], { cwd: projectRoot });
    assert.equal(
      gateResult.status,
      2,
      `report ausente deve bloquear com exit 2. status=${gateResult.status} stderr=${gateResult.stderr}`
    );
    const output = gateResult.stdout + gateResult.stderr;
    assert.ok(
      /STEP_1A_SPECIFY/.test(output),
      `A mensagem tem que nomear qual report está faltando (STEP_1A_SPECIFY). Output: ${output}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
// @spec AC-10
// @contract CONTRACT-STEP-REPORT-01
test('CONTRACT-STEP-REPORT-01 case 4: status fora do enum ("done") → report inválido, gate exit 2, nunca pass', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t02-case4';
    writeLock(projectRoot, runId);

    writeRawReport(
      projectRoot,
      runId,
      'STEP_1A_SPECIFY',
      JSON.stringify({
        schema: 'soma-step-report/v1',
        run_id: runId,
        step: 'STEP_1A_SPECIFY',
        status: 'done', // fora do enum pass|fail|blocked
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        artifacts: [],
        metrics: {},
        notes: '',
      })
    );

    const gateResult = runRun(['gate', '--step', 'STEP_1B_PLAN'], { cwd: projectRoot });
    assert.equal(
      gateResult.status,
      2,
      `status fora do enum é report inválido — inválido nunca vira pass. status=${gateResult.status} stderr=${gateResult.stderr}`
    );
    const output = gateResult.stdout + gateResult.stderr;
    assert.ok(
      /status/i.test(output) && /done/.test(output),
      `A mensagem deve nomear o motivo (campo "status" com valor inválido "done"). Output: ${output}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
// @spec AC-10
// @contract CONTRACT-STEP-REPORT-01
test('CONTRACT-STEP-REPORT-01 case 5: status fail sem failure_reason → report inválido → gate exit 2', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t02-case5';
    writeLock(projectRoot, runId);

    writeRawReport(
      projectRoot,
      runId,
      'STEP_1A_SPECIFY',
      JSON.stringify({
        schema: 'soma-step-report/v1',
        run_id: runId,
        step: 'STEP_1A_SPECIFY',
        status: 'fail',
        // failure_reason ausente de propósito — campo condicional obrigatório
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        artifacts: [],
        metrics: {},
        notes: '',
      })
    );

    const gateResult = runRun(['gate', '--step', 'STEP_1B_PLAN'], { cwd: projectRoot });
    assert.equal(
      gateResult.status,
      2,
      `status=fail sem failure_reason é report inválido. status=${gateResult.status} stderr=${gateResult.stderr}`
    );
    const output = gateResult.stdout + gateResult.stderr;
    assert.ok(
      /failure_reason/i.test(output),
      `A mensagem deve nomear o campo condicional ausente (failure_reason). Output: ${output}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-10
// @contract CONTRACT-STEP-REPORT-01
test('CONTRACT-STEP-REPORT-01 case 6: JSON corrompido → gate exit 2 com causa de não-legibilidade', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t02-case6';
    writeLock(projectRoot, runId);

    writeRawReport(projectRoot, runId, 'STEP_1A_SPECIFY', '{ isto não é json válido');

    const gateResult = runRun(['gate', '--step', 'STEP_1B_PLAN'], { cwd: projectRoot });
    // AC-10: nenhuma condição de erro, ausência ou impossibilidade de
    // leitura produz exit 0. JSON corrompido é REJECT, nunca pass.
    assert.notEqual(gateResult.status, 0, 'impossibilidade de ler nunca pode ser exit 0');
    assert.equal(
      gateResult.status,
      2,
      `JSON corrompido deve resultar em exit 2. status=${gateResult.status} stderr=${gateResult.stderr}`
    );
    const output = gateResult.stdout + gateResult.stderr;
    assert.ok(
      /(n[aã]o\s+leg[ií]vel|parse|json|corromp)/i.test(output),
      `A mensagem deve declarar a causa de não-legibilidade (ex: "report não legível: ..."). Output: ${output}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
