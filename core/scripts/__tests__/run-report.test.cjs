'use strict';
/**
 * run-report.test.cjs — integration test for `soma run report` (Spec 016, T-06)
 *
 * Exercises `core/scripts/run/report.cjs` directly through the `soma run`
 * CLI (`run.cjs`), same invocation shape as CONTRACT-STEP-REPORT-01's cases
 * 1 and 2 (the only two cases there that actually call `report` — cases
 * 4/5/6 fabricate raw report files by hand to test `gate`, T-07's scope).
 *
 * This file covers what CONTRACT-STEP-REPORT-01 doesn't: report.cjs's own
 * input validation (missing/invalid flags), `.soma.lock` resolution when
 * `--run` is omitted, and the "reentry overwrites" rule from
 * contracts/emit-step-report.md ("Reentrada no mesmo step sobrescreve o
 * report anterior").
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 * ⚠️ os.tmpdir() on this Mac is NOT '/tmp' — never hardcode the literal.
 *
 * @spec AC-01
 * @contract CONTRACT-STEP-REPORT-01
 * @task T-06
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const { resolveSomaPaths } = require(path.resolve(__dirname, '..', 'run', 'paths.cjs'));
const { validate } = require(path.resolve(__dirname, '..', 'run', 'schema.cjs'));

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

function runRun(args = [], { cwd }) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function makeFixtureProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t06-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

function writeLock(projectRoot, runId) {
  fs.writeFileSync(
    path.join(projectRoot, '.soma.lock'),
    JSON.stringify({ sessionId: 'test-session-t06', runId, startedAt: new Date().toISOString() }),
    'utf8'
  );
}

function reportPathFor(projectRoot, runId, step) {
  const p = resolveSomaPaths(projectRoot, runId);
  return path.join(p.runReportsDir, `${step}-report.json`);
}

// @spec AC-01
test('report --status pass: escreve report válido no path certo, exit 0', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t06-pass';
    const result = runRun(
      ['report', '--run', runId, '--step', 'STEP_3_FOUNDATION', '--status', 'pass'],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 0, `stderr=${result.stderr} stdout=${result.stdout}`);

    const filePath = reportPathFor(projectRoot, runId, 'STEP_3_FOUNDATION');
    assert.ok(fs.existsSync(filePath));

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const check = validate(STEP_REPORT_SCHEMA, parsed);
    assert.equal(check.valid, true, JSON.stringify(check.violations));
    assert.equal(parsed.schema, 'soma-step-report/v1');
    assert.equal(parsed.run_id, runId);
    assert.equal(parsed.step, 'STEP_3_FOUNDATION');
    assert.equal(parsed.status, 'pass');
    assert.equal('failure_reason' in parsed, false, 'status pass não deve carregar failure_reason');
    assert.ok(parsed.finished_at >= parsed.started_at);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report --status fail --reason: grava failure_reason, ainda exit 0 (quem bloqueia é o gate)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t06-fail';
    const reason = 'agente reportou timeout no T-05';
    const result = runRun(
      ['report', '--run', runId, '--step', 'STEP_4_WAVES', '--status', 'fail', '--reason', reason],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const parsed = JSON.parse(fs.readFileSync(reportPathFor(projectRoot, runId, 'STEP_4_WAVES'), 'utf8'));
    assert.equal(parsed.status, 'fail');
    assert.equal(parsed.failure_reason, reason);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report --status blocked --reason: aceito, mesmo tratamento de fail', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t06-blocked';
    const reason = 'aguardando gate humano';
    const result = runRun(
      ['report', '--run', runId, '--step', 'STEP_1B_PLAN', '--status', 'blocked', '--reason', reason],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const parsed = JSON.parse(fs.readFileSync(reportPathFor(projectRoot, runId, 'STEP_1B_PLAN'), 'utf8'));
    assert.equal(parsed.status, 'blocked');
    assert.equal(parsed.failure_reason, reason);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report sem --step → exit 2, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(['report', '--run', 'run-x', '--status', 'pass'], { cwd: projectRoot });
    assert.equal(result.status, 2);
    assert.ok(/--step/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report sem --status → exit 2, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(['report', '--run', 'run-x', '--step', 'STEP_3_FOUNDATION'], { cwd: projectRoot });
    assert.equal(result.status, 2);
    assert.ok(/--status/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report --status fora do enum → exit 2, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(
      ['report', '--run', 'run-x', '--step', 'STEP_3_FOUNDATION', '--status', 'done'],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 2);
    assert.ok(/status/i.test(result.stderr) && /done/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report --status fail sem --reason → exit 2, causa nomeada (failure_reason)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(
      ['report', '--run', 'run-x', '--step', 'STEP_3_FOUNDATION', '--status', 'fail'],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 2);
    assert.ok(/failure_reason/i.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report sem --run, com .soma.lock legível → resolve runId do lock', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t06-from-lock';
    writeLock(projectRoot, runId);
    const result = runRun(['report', '--step', 'STEP_3_FOUNDATION', '--status', 'pass'], { cwd: projectRoot });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const filePath = reportPathFor(projectRoot, runId, 'STEP_3_FOUNDATION');
    assert.ok(fs.existsSync(filePath));
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(parsed.run_id, runId);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('report sem --run e sem .soma.lock → exit 2, mensagem cita as duas formas de resolver', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(['report', '--step', 'STEP_3_FOUNDATION', '--status', 'pass'], { cwd: projectRoot });
    assert.equal(result.status, 2);
    assert.ok(/--run/.test(result.stderr), result.stderr);
    assert.ok(/\.soma\.lock/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('reentrada no mesmo step sobrescreve o report anterior (um arquivo, não versionado)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t06-reentry';
    const first = runRun(
      ['report', '--run', runId, '--step', 'STEP_3_FOUNDATION', '--status', 'fail', '--reason', 'primeira tentativa'],
      { cwd: projectRoot }
    );
    assert.equal(first.status, 0);

    const second = runRun(
      ['report', '--run', runId, '--step', 'STEP_3_FOUNDATION', '--status', 'pass'],
      { cwd: projectRoot }
    );
    assert.equal(second.status, 0);

    const dir = resolveSomaPaths(projectRoot, runId).runReportsDir;
    const files = fs.readdirSync(dir).filter((f) => f.includes('STEP_3_FOUNDATION'));
    assert.deepEqual(files, ['STEP_3_FOUNDATION-report.json'], `esperava 1 arquivo, achou: ${JSON.stringify(files)}`);

    const parsed = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    assert.equal(parsed.status, 'pass', 'reentrada deveria refletir a chamada mais recente');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('escrita atômica: nenhum arquivo .tmp residual após sucesso', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t06-atomic';
    const result = runRun(
      ['report', '--run', runId, '--step', 'STEP_3_FOUNDATION', '--status', 'pass'],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 0);
    const dir = resolveSomaPaths(projectRoot, runId).runReportsDir;
    const stray = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(stray, []);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('argumento desconhecido → exit 2, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(
      ['report', '--run', 'run-x', '--step', 'STEP_3_FOUNDATION', '--status', 'pass', '--bogus', 'x'],
      { cwd: projectRoot }
    );
    assert.equal(result.status, 2);
    assert.ok(/--bogus/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
