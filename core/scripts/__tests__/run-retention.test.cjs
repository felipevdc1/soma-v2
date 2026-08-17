'use strict';
/**
 * run-retention.test.cjs — integration test for the AC-12 retention sweep
 * (Spec 016, T-17)
 *
 * `run/retention.cjs` is NOT a verb (see its module docstring, mirroring
 * run/legacy.cjs's precedent) — it's a shared module triggered from
 * `soma run state --set DONE`. This file tests both layers: the module's
 * own sweep logic directly (unit-shaped, real fs, mtime manipulated via
 * `fs.utimesSync` — never waiting 7 real days), and the CLI wiring
 * end-to-end (via `soma run state --set DONE`).
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 * ⚠️ os.tmpdir() on this machine is NOT /tmp — never hardcode the literal.
 *
 * Deletion is irreversible — every "swept" case here is paired with a
 * "preserved" case using the same fixture shape, so a sweeper that deletes
 * everything indiscriminately cannot pass silently.
 *
 * @spec AC-12
 * @contract CONTRACT-RUN-STATE-02 (persist-run-state.md §Retenção)
 * @task T-17
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const { sweepExpiredArtifacts, RETENTION_DAYS } = require(path.resolve(__dirname, '..', 'run', 'retention.cjs'));
const { resolveSomaPaths } = require(path.resolve(__dirname, '..', 'run', 'paths.cjs'));

const DAY_MS = 24 * 60 * 60 * 1000;

function runRun(args, { cwd, env } = {}) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, env: env || process.env, encoding: 'utf8', timeout: 15000 });
}

function makeFixtureProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t17-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

/** Backdates a file's mtime (and atime) by `days`. Real fs, no waiting. */
function backdate(filePath, days) {
  const past = new Date(Date.now() - days * DAY_MS);
  fs.utimesSync(filePath, past, past);
}

function writeRunStateFixture(projectRoot, runId, { currentState = 'DONE', extra = {} } = {}) {
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);
  fs.mkdirSync(path.dirname(runStateFile), { recursive: true });
  const state = {
    $schema: 'soma-state/v2',
    runId,
    sessionId: 'test-session-t17',
    startedAt: new Date().toISOString(),
    currentState,
    lastTransitionAt: new Date().toISOString(),
    activeDispatchIds: [],
    failureCountsByStep: {},
    fixLoopIterations: 0,
    snapshots: [],
    humanGatesApproved: { gate1_spec: { approved: false }, gate2_deploy: { approved: false } },
    decisions: [],
    reports: [],
    ...extra,
  };
  fs.writeFileSync(runStateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return runStateFile;
}

function writeArtifactFile(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

// ── Module-level: swept vs preserved (the pair that proves the sweeper
//    isn't just "delete everything") ───────────────────────────────────────

// @spec AC-12
test(`DONE run com state file de ${RETENTION_DAYS + 1} dias → elegível, reports+dispatches+state somem`, () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-old-done';
    const runStateFile = writeRunStateFixture(projectRoot, runId);
    const { runReportsDir, runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
    writeArtifactFile(runReportsDir, 'STEP_3_FOUNDATION-report.json', '{"status":"pass"}');
    writeArtifactFile(path.join(runDispatchesDir, 'T-01'), 'prompt.md', 'x\n');
    backdate(runStateFile, RETENTION_DAYS + 1);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.deepEqual(
      result.swept.map((s) => s.runId),
      [runId],
      JSON.stringify(result)
    );
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    assert.ok(!fs.existsSync(runStateFile), 'state file deveria ter sido removido');
    assert.ok(!fs.existsSync(runReportsDir), 'reports dir deveria ter sido removido');
    assert.ok(!fs.existsSync(runDispatchesDir), 'dispatches dir deveria ter sido removido');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-12
test(`DONE run com state file de ${RETENTION_DAYS - 1} dias → preservado, nada é removido`, () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-recent-done';
    const runStateFile = writeRunStateFixture(projectRoot, runId);
    const { runReportsDir, runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
    writeArtifactFile(runReportsDir, 'STEP_3_FOUNDATION-report.json', '{"status":"pass"}');
    writeArtifactFile(path.join(runDispatchesDir, 'T-01'), 'prompt.md', 'x\n');
    backdate(runStateFile, RETENTION_DAYS - 1);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.deepEqual(result.swept, []);
    assert.deepEqual(
      result.preserved.map((p) => p.runId),
      [runId]
    );
    assert.ok(fs.existsSync(runStateFile), 'state file NÃO deveria ter sido removido');
    assert.ok(fs.existsSync(runReportsDir), 'reports dir NÃO deveria ter sido removido');
    assert.ok(fs.existsSync(runDispatchesDir), 'dispatches dir NÃO deveria ter sido removido');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-12
test('run NÃO-DONE com state file antigo → nunca varrido, mesmo com 30 dias de idade', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-still-in-progress';
    const runStateFile = writeRunStateFixture(projectRoot, runId, { currentState: 'STEP_4_WAVES' });
    const { runReportsDir } = resolveSomaPaths(projectRoot, runId);
    writeArtifactFile(runReportsDir, 'STEP_3_FOUNDATION-report.json', '{"status":"pass"}');
    backdate(runStateFile, 30);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.deepEqual(result.swept, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].runId, runId);
    assert.ok(/not DONE/i.test(result.skipped[0].reason), result.skipped[0].reason);
    assert.ok(fs.existsSync(runStateFile));
    assert.ok(fs.existsSync(runReportsDir));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-12
test('state file com JSON corrompido → skipped, nunca varrido por incapacidade de confirmar DONE', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-corrupt';
    const { runStateFile } = resolveSomaPaths(projectRoot, runId);
    fs.mkdirSync(path.dirname(runStateFile), { recursive: true });
    fs.writeFileSync(runStateFile, '{ isto não é json', 'utf8');
    backdate(runStateFile, RETENTION_DAYS + 5);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.deepEqual(result.swept, []);
    assert.equal(result.skipped.length, 1);
    assert.ok(fs.existsSync(runStateFile), 'nunca varrer um state ilegível');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-12
test('symlink no lugar do dispatches dir → sweep recusa remover, alvo externo intocado', () => {
  const projectRoot = makeFixtureProject();
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t17-external-'));
  try {
    const runId = 'run-symlink-attack';
    const runStateFile = writeRunStateFixture(projectRoot, runId);
    const canary = writeArtifactFile(externalDir, 'canary.txt', 'não deveria sumir\n');

    const { runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
    fs.mkdirSync(path.dirname(runDispatchesDir), { recursive: true });
    fs.symlinkSync(externalDir, runDispatchesDir, 'dir');
    backdate(runStateFile, RETENTION_DAYS + 1);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.equal(result.swept.length, 0, `não deveria completar o sweep deste run: ${JSON.stringify(result)}`);
    assert.equal(result.errors.length, 1, JSON.stringify(result));
    assert.ok(/symlink/i.test(result.errors[0].reason), result.errors[0].reason);
    assert.ok(fs.existsSync(canary), 'o arquivo canário fora de .soma/ tem que sobreviver');
    assert.equal(fs.readFileSync(canary, 'utf8'), 'não deveria sumir\n');
    // Safety-order: por ter falhado no dispatches (symlink), o state file
    // (removido por último) também não deve ter sido apagado.
    assert.ok(fs.existsSync(runStateFile), 'state file preservado quando o sweep do run falha parcialmente');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
});

// @spec AC-12
test('runId malicioso (".." via filename) → skipped, .soma/ inteiro sobrevive', () => {
  const projectRoot = makeFixtureProject();
  try {
    const somaDir = path.join(projectRoot, '.soma');
    const canary = writeArtifactFile(somaDir, 'canary-in-soma.txt', 'não deveria sumir\n');

    // "run-state-" + ".." + ".json" = filename literal "run-state-...json",
    // cujo runId extraído pelo regex é a string "..".
    const maliciousFile = path.join(somaDir, 'run-state-...json');
    fs.writeFileSync(
      maliciousFile,
      JSON.stringify({ currentState: 'DONE', runId: '..' }),
      'utf8'
    );
    backdate(maliciousFile, RETENTION_DAYS + 1);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.deepEqual(result.swept, []);
    assert.equal(result.skipped.length, 1);
    assert.ok(/unsafe runId/i.test(result.skipped[0].reason), result.skipped[0].reason);
    assert.ok(fs.existsSync(canary), 'canário dentro de .soma/ tem que sobreviver ao runId malicioso');
    assert.ok(fs.existsSync(somaDir), '.soma/ inteiro tem que sobreviver');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-12
test('múltiplos runs: cada um avaliado independentemente (swept + preserved + skipped juntos)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const oldDone = writeRunStateFixture(projectRoot, 'run-a-old-done');
    backdate(oldDone, RETENTION_DAYS + 3);

    const recentDone = writeRunStateFixture(projectRoot, 'run-b-recent-done');
    backdate(recentDone, 1);

    const inProgress = writeRunStateFixture(projectRoot, 'run-c-in-progress', { currentState: 'STEP_4_WAVES' });
    backdate(inProgress, RETENTION_DAYS + 3);

    const result = sweepExpiredArtifacts({ projectRoot });

    assert.deepEqual(result.swept.map((s) => s.runId).sort(), ['run-a-old-done']);
    assert.deepEqual(result.preserved.map((p) => p.runId).sort(), ['run-b-recent-done']);
    assert.deepEqual(result.skipped.map((s) => s.runId).sort(), ['run-c-in-progress']);
    assert.ok(!fs.existsSync(oldDone));
    assert.ok(fs.existsSync(recentDone));
    assert.ok(fs.existsSync(inProgress));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── Wiring: `soma run state --set DONE` triggers the sweep for OTHER
//    stale runs, and never sweeps its own just-written state file ─────────

// @spec AC-12
test('CLI: "soma run state --set DONE" varre outros runs DONE vencidos e preserva a si mesmo', () => {
  const projectRoot = makeFixtureProject();
  try {
    // Run A: já DONE há muito tempo — deve ser varrido pelo gatilho de B.
    const staleRunId = 'run-stale-trigger-test';
    const staleStateFile = writeRunStateFixture(projectRoot, staleRunId);
    backdate(staleStateFile, RETENTION_DAYS + 2);

    // Run B: inicializa de verdade via CLI e transiciona pra DONE via CLI —
    // é essa chamada que deve disparar o gatilho.
    const freshRunId = 'run-fresh-trigger-test';
    const init = runRun(['state', '--init', '--run', freshRunId], { cwd: projectRoot });
    assert.equal(init.status, 0, `init falhou: ${init.stderr}`);

    const setDone = runRun(['state', '--run', freshRunId, '--set', 'DONE'], { cwd: projectRoot });
    assert.equal(setDone.status, 0, `--set DONE falhou: ${setDone.stderr}`);

    const { runStateFile: freshStateFile } = resolveSomaPaths(projectRoot, freshRunId);
    assert.ok(!fs.existsSync(staleStateFile), 'run A (velho, DONE) deveria ter sido varrido pelo gatilho de B');
    assert.ok(fs.existsSync(freshStateFile), 'run B (recém DONE) NÃO deveria varrer a si mesmo');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-12
test('CLI: "--set" para estado != DONE NUNCA dispara o sweep', () => {
  const projectRoot = makeFixtureProject();
  try {
    const staleRunId = 'run-stale-no-trigger-test';
    const staleStateFile = writeRunStateFixture(projectRoot, staleRunId);
    backdate(staleStateFile, RETENTION_DAYS + 2);

    const otherRunId = 'run-transitioning-test';
    const init = runRun(['state', '--init', '--run', otherRunId], { cwd: projectRoot });
    assert.equal(init.status, 0, `init falhou: ${init.stderr}`);

    const setInProgress = runRun(['state', '--run', otherRunId, '--set', 'STEP_4_WAVES'], { cwd: projectRoot });
    assert.equal(setInProgress.status, 0, `--set falhou: ${setInProgress.stderr}`);

    assert.ok(fs.existsSync(staleStateFile), 'transição para estado != DONE nunca deve varrer nada');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
