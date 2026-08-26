'use strict';
/**
 * run-validator-invariant.test.cjs — executor≠validador invariant (Spec 016, T-11)
 *
 * Two layers:
 *   1. Unit tests against run/validator-invariant.cjs directly — the two
 *      RED cases this task owns (mirrors T-04-05/T-04-06 in
 *      contract-dispatch-record.test.cjs, which this task does NOT edit),
 *      plus the failure-closed edge cases (unreadable / corrupt / missing
 *      executor_agent) that AC-10's spec-wide corollary requires.
 *   2. End-to-end CLI tests through `soma run gate --validate` (T-07's
 *      wrapper in run/gate.cjs, not edited here) — proving the whole path
 *      works now that this module exists, in both directions. Per dispatch
 *      brief: "esse é o teste que só você pode fazer, porque só você
 *      conhece os dois lados."
 *
 * Both sides of the invariant are asserted in every layer: a module that
 * refuses everything passes the "equal" case and is useless; one that
 * accepts everything passes the "different" case and is worse than
 * useless — it lets the executor validate its own work.
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 * ⚠️ os.tmpdir() on this Mac is NOT '/tmp' — never hardcode the literal.
 *
 * @spec [SPEC:AC-06]
 * @contract CONTRACT-DISPATCH-RECORD-03
 * @task T-11
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MODULE_PATH = path.resolve(__dirname, '..', 'run', 'validator-invariant.cjs');
const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const PATHS_MODULE = path.resolve(__dirname, '..', 'run', 'paths.cjs');

const { checkValidatorAssignment } = require(MODULE_PATH);
const { resolveSomaPaths } = require(PATHS_MODULE);

function makeFixtureDir() {
  // ⚠️ os.tmpdir() on this Mac is NOT '/tmp' — never hardcode the literal.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t11-'));
}

function writeMetadata(dir, overrides = {}) {
  const metadataPath = path.join(dir, 'metadata.json');
  const payload = {
    schema: 'soma-dispatch-record/v1',
    run_id: 'run-t11-fixture',
    task_id: 'T-09',
    attempt: 1,
    model: 'sonnet',
    base_sha: 'abc1234',
    started_at: '2026-08-16T00:00:00.000Z',
    finished_at: '2026-08-16T00:05:00.000Z',
    ac_refs: ['AC-06'],
    executor_agent: 'soma-016-artifact-gated-trilho-T-09',
    result: 'done',
    ...overrides,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(payload), 'utf8');
  return metadataPath;
}

// ── 1. Unit — lado A: validador == executor_agent → RECUSADO ──────────────

// @spec AC-06
test('T-11 unit lado A: validador igual ao executor_agent → allowed=false, reason nomeia o agente', () => {
  const dir = makeFixtureDir();
  try {
    const executorAgent = 'soma-016-artifact-gated-trilho-T-09';
    const metadataPath = writeMetadata(dir, { executor_agent: executorAgent });

    const result = checkValidatorAssignment({ metadataPath, proposedValidator: executorAgent });

    assert.equal(result.allowed, false, 'validador == executor_agent deve ser recusado');
    assert.ok(
      typeof result.reason === 'string' && result.reason.includes(executorAgent),
      `motivo deve nomear o agente "${executorAgent}". Got: ${JSON.stringify(result.reason)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. Unit — lado B: validador != executor_agent → ACEITO ────────────────

// @spec AC-06
test('T-11 unit lado B: validador diferente do executor_agent → allowed=true', () => {
  const dir = makeFixtureDir();
  try {
    const executorAgent = 'soma-016-artifact-gated-trilho-T-09';
    const proposedValidator = 'soma-016-artifact-gated-trilho-T-12';
    const metadataPath = writeMetadata(dir, { executor_agent: executorAgent });

    const result = checkValidatorAssignment({ metadataPath, proposedValidator });

    assert.equal(result.allowed, true, `validador != executor_agent deve ser aceito. Got: ${JSON.stringify(result)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3-5. Failure-closed: AC-10's corollary applied to this module ─────────

// @spec AC-06
test('T-11 unit: metadata.json ausente → allowed=false (nunca aceita por não conseguir ler)', () => {
  const dir = makeFixtureDir();
  try {
    const metadataPath = path.join(dir, 'nao-existe.json');
    const result = checkValidatorAssignment({ metadataPath, proposedValidator: 'qualquer-agente' });
    assert.equal(result.allowed, false, 'metadata ausente deve falhar fechado');
    assert.ok(/n[aã]o\s+leg[ií]vel/i.test(result.reason || ''), `deve nomear não-legibilidade. Got: ${result.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-06
test('T-11 unit: metadata.json com JSON corrompido → allowed=false', () => {
  const dir = makeFixtureDir();
  try {
    const metadataPath = path.join(dir, 'metadata.json');
    fs.writeFileSync(metadataPath, '{ isto não é json válido', 'utf8');
    const result = checkValidatorAssignment({ metadataPath, proposedValidator: 'qualquer-agente' });
    assert.equal(result.allowed, false, 'metadata corrompido deve falhar fechado');
    assert.ok(/corromp/i.test(result.reason || ''), `deve nomear corrupção. Got: ${result.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// @spec AC-06
test('T-11 unit: metadata.json sem "executor_agent" → allowed=false', () => {
  const dir = makeFixtureDir();
  try {
    const metadataPath = writeMetadata(dir, {});
    const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    delete raw.executor_agent;
    fs.writeFileSync(metadataPath, JSON.stringify(raw), 'utf8');

    const result = checkValidatorAssignment({ metadataPath, proposedValidator: 'qualquer-agente' });
    assert.equal(result.allowed, false, 'metadata sem executor_agent deve falhar fechado');
    assert.ok(/executor_agent/.test(result.reason || ''), `deve nomear o campo ausente. Got: ${result.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 6-7. Ponta a ponta via CLI: `soma run gate --validate` — os dois lados ─
//
// Este é o teste que só o dono do módulo pode escrever de verdade: prova
// que o wrapper preguiçoso da T-07 (run/gate.cjs) agora encontra o módulo,
// desestrutura `checkValidatorAssignment` corretamente, e propaga allowed/
// reason até o exit code e o stderr do processo `soma run gate`.

function runRun(args, { cwd }) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function makeProjectFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t11-cli-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

function writeLock(projectRoot, runId) {
  fs.writeFileSync(
    path.join(projectRoot, '.soma.lock'),
    JSON.stringify({ sessionId: 'test-session-t11', runId, startedAt: new Date().toISOString() }),
    'utf8'
  );
}

function initExactState(projectRoot, runId) {
  const result = runRun(['state', '--init', '--run', runId], { cwd: projectRoot });
  assert.equal(
    result.status,
    0,
    `state --init falhou para ${runId}. stdout=${result.stdout} stderr=${result.stderr}`
  );
}

// Fabricates metadata.json at the exact path CONTRACT-DISPATCH-RECORD-03
// specifies ({projeto}/.soma/dispatches/{runId}/{taskId}/metadata.json) —
// via fs directly, since `soma run dispatch-record` (T-10) is a different
// task and may not be in this working tree yet.
function fabricateDispatchMetadata(projectRoot, runId, taskId, executorAgent) {
  const { runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
  const taskDir = path.join(runDispatchesDir, taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, 'metadata.json'),
    JSON.stringify({
      schema: 'soma-dispatch-record/v1',
      run_id: runId,
      task_id: taskId,
      attempt: 1,
      model: 'sonnet',
      base_sha: 'abc1234',
      started_at: '2026-08-16T00:00:00.000Z',
      finished_at: '2026-08-16T00:05:00.000Z',
      ac_refs: ['AC-06'],
      executor_agent: executorAgent,
      result: 'done',
    }),
    'utf8'
  );
}

// @spec AC-06
test('T-11 CLI ponta-a-ponta lado A: soma run gate --validate com validador == executor → exit 2, stderr nomeia o agente', () => {
  const projectRoot = makeProjectFixture();
  try {
    const runId = 'run-t11-cli-a';
    const executorAgent = 'soma-lab-T-03';
    writeLock(projectRoot, runId);
    initExactState(projectRoot, runId);
    fabricateDispatchMetadata(projectRoot, runId, 'T-03', executorAgent);

    const result = runRun(['gate', '--validate', 'T-03', '--validator', executorAgent], { cwd: projectRoot });
    assert.equal(result.status, 2, `esperava exit 2. stdout=${result.stdout} stderr=${result.stderr}`);
    const out = result.stdout + result.stderr;
    assert.ok(
      !/MODULE_NOT_FOUND/.test(out),
      `NUNCA um stack MODULE_NOT_FOUND — o módulo agora existe. Output: ${out}`
    );
    assert.ok(out.includes(executorAgent), `stderr deve nomear o agente "${executorAgent}". Output: ${out}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-06
test('T-11 CLI ponta-a-ponta lado B: soma run gate --validate com validador != executor → exit 0', () => {
  const projectRoot = makeProjectFixture();
  try {
    const runId = 'run-t11-cli-b';
    const executorAgent = 'soma-lab-T-03';
    const proposedValidator = 'soma-lab-T-99';
    writeLock(projectRoot, runId);
    initExactState(projectRoot, runId);
    fabricateDispatchMetadata(projectRoot, runId, 'T-03', executorAgent);

    const result = runRun(['gate', '--validate', 'T-03', '--validator', proposedValidator], { cwd: projectRoot });
    assert.equal(result.status, 0, `esperava exit 0. stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
