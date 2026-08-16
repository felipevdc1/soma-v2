'use strict';
/**
 * contract-dispatch-record.test.cjs — CONTRACT-DISPATCH-RECORD-03 (T-04)
 *
 * Contract source: core/specs/016-artifact-gated-trilho/contracts/emit-dispatch-record.md
 * spec_ref: [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-12]
 *
 * RED BY DESIGN. `soma run dispatch-record` (T-10) and the executor≠validador
 * invariant module (T-11) belong to a later wave and do NOT exist yet in this
 * working tree. Every test below is expected to FAIL until T-10/T-11 land —
 * that failure is the correct state for this task (Article III: contract
 * before implementation). Do not "fix" these tests by implementing the verbs
 * here; that work is explicitly out of scope for T-04.
 *
 * Interface this contract test targets — it is the spec T-10/T-11 must
 * satisfy, chosen to extend the CLI convention `run.cjs` (T-01) already
 * establishes (`soma run <verb> [args...]`, delegated to run/{verb}.cjs):
 *
 *   soma run dispatch-record begin --run <runId> --task <taskId>
 *                                    [--attempt <n>] --prompt-file <path>
 *     → copies the exact bytes of --prompt-file into prompt.md at
 *       .soma/dispatches/{runId}/{taskId}[/attempt-{n}]/prompt.md, BEFORE the
 *       caller ever spawns the agent. Exit 0 on success. attempt defaults to 1
 *       and attempt 1 lives directly under {taskId}/ (no attempt-1/ subdir);
 *       attempt >= 2 lives under {taskId}/attempt-{n}/, leaving the prior
 *       attempt's files untouched (Article VI, zero deletion).
 *
 *   soma run dispatch-record end --run <runId> --task <taskId>
 *                                  [--attempt <n>] --output-file <path>
 *                                  --metadata-file <path>
 *     → validates --metadata-file against soma-dispatch-record/v1 (model is
 *       required — Amendment 1.1.0). On REJECT, writes nothing (all-or-
 *       nothing, mirrors AC-10's "never partially pass"). On success, writes
 *       output.md (copy of --output-file) + metadata.json (the validated
 *       payload) into the same dir as prompt.md. Exit 0 on success, non-zero
 *       on REJECT with the failing field named in stderr.
 *
 *   run/validator-invariant.cjs exports:
 *     checkValidatorAssignment({ metadataPath, proposedValidator })
 *       -> { allowed: boolean, reason: string|null }
 *     Reads executor_agent from the metadata.json at metadataPath and refuses
 *       the assignment when proposedValidator === executor_agent (AC-06).
 *       reason must name the agent when refused.
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 * ⚠️ os.tmpdir() on this machine is NOT /tmp — never hardcode the literal.
 * ⚠️ CLI output matching uses line/column anchors, not \b — \brun\b matches
 *    inside "--dry-run" (false positive already hit in T-01).
 *
 * @task T-04
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const VALIDATOR_INVARIANT_MODULE = path.resolve(__dirname, '..', 'run', 'validator-invariant.cjs');

const RUN_ID = 'run-260815-2340-a1b2c3';

function runRun(args, { cwd } = {}) {
  return spawnSync('node', [RUN_CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function makeProjectFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t04-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

function writeFixtureFile(projectRoot, name, content) {
  const p = path.join(projectRoot, name);
  fs.writeFileSync(p, content);
  return p;
}

function dispatchDir(projectRoot, runId, taskId, attempt) {
  const base = path.join(projectRoot, '.soma', 'dispatches', runId, taskId);
  return attempt && attempt > 1 ? path.join(base, `attempt-${attempt}`) : base;
}

function validMetadata(overrides = {}) {
  return {
    schema: 'soma-dispatch-record/v1',
    run_id: RUN_ID,
    task_id: 'T-05',
    attempt: 1,
    model: 'sonnet',
    base_sha: 'd15f592',
    started_at: '2026-08-15T23:50:00.000Z',
    finished_at: '2026-08-15T23:58:30.000Z',
    ac_refs: ['AC-05'],
    executor_agent: 'soma-016-artifact-gated-trilho-T-05',
    result: 'done',
    ...overrides,
  };
}

function beginDispatch(projectRoot, { runId = RUN_ID, taskId, attempt, promptFile }) {
  const args = ['dispatch-record', 'begin', '--run', runId, '--task', taskId, '--prompt-file', promptFile];
  if (attempt) args.push('--attempt', String(attempt));
  return runRun(args, { cwd: projectRoot });
}

function endDispatch(projectRoot, { runId = RUN_ID, taskId, attempt, outputFile, metadataFile }) {
  const args = [
    'dispatch-record',
    'end',
    '--run',
    runId,
    '--task',
    taskId,
    '--output-file',
    outputFile,
    '--metadata-file',
    metadataFile,
  ];
  if (attempt) args.push('--attempt', String(attempt));
  return runRun(args, { cwd: projectRoot });
}

// ── 1. Materializa os 3 arquivos antes de registrar o resultado ───────────

// @spec AC-05
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-01: dispatch materializa prompt.md + output.md + metadata.json antes de registrar o resultado', () => {
  // "Antes de registrar o resultado" é verificado no limite deste módulo como:
  // `end` só pode sair 0 depois que os 3 arquivos existem em disco — o
  // registro do resultado da task (fora do escopo de T-04/T-10) não pode
  // acontecer antes disso porque `end` é o único ponto que sabe que o
  // dispatch terminou.
  const projectRoot = makeProjectFixture();
  try {
    const taskId = 'T-05';
    const promptFile = writeFixtureFile(projectRoot, 'prompt-fixture.md', 'Execute a task T-05.\n');
    const begin = beginDispatch(projectRoot, { taskId, promptFile });
    assert.equal(begin.status, 0, `begin deve sair 0. stderr: ${begin.stderr}`);

    const outputFile = writeFixtureFile(projectRoot, 'output-fixture.md', 'Task concluída.\n');
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-fixture.json', JSON.stringify(validMetadata()));
    const end = endDispatch(projectRoot, { taskId, outputFile, metadataFile });
    assert.equal(end.status, 0, `end deve sair 0. stderr: ${end.stderr}`);

    const dir = dispatchDir(projectRoot, RUN_ID, taskId);
    for (const filename of ['prompt.md', 'output.md', 'metadata.json']) {
      assert.ok(fs.existsSync(path.join(dir, filename)), `esperava ${filename} materializado em ${dir}`);
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── 2. CONTEÚDO: prompt.md é o prompt EXATO, byte-a-byte ──────────────────

// @spec AC-05
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-02: CONTEUDO — prompt.md contém o prompt exato enviado, comparação byte-a-byte', () => {
  const projectRoot = makeProjectFixture();
  try {
    const taskId = 'T-06';
    // Conteúdo adversarial: unicode multi-byte, espaços à direita, SEM quebra
    // de linha final — um resumo ou "contém um trecho" reprova aqui.
    const trickyPrompt =
      'Dispatch T-06 — inclua caractères especiais: café, mañana, 日本語, emoji 🚀 e trailing spaces:   \n' +
      'Segunda linha sem quebra final';
    const promptFile = writeFixtureFile(projectRoot, 'prompt-tricky.md', trickyPrompt);
    const begin = beginDispatch(projectRoot, { taskId, promptFile });
    assert.equal(begin.status, 0, `begin deve sair 0. stderr: ${begin.stderr}`);

    const writtenPath = path.join(dispatchDir(projectRoot, RUN_ID, taskId), 'prompt.md');
    assert.ok(fs.existsSync(writtenPath), `prompt.md deveria existir em ${writtenPath}`);

    const expected = fs.readFileSync(promptFile);
    const actual = fs.readFileSync(writtenPath);
    assert.ok(
      Buffer.compare(expected, actual) === 0,
      `prompt.md deve ser byte-a-byte idêntico ao prompt enviado.\nEsperado: ${JSON.stringify(expected.toString())}\nEncontrado: ${JSON.stringify(actual.toString())}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── 3. prompt.md sobrevive ao agente morrendo sem retornar ────────────────

// @spec AC-05
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-03: prompt.md existe mesmo quando o agente morre sem retornar (gravado antes do dispatch)', () => {
  const projectRoot = makeProjectFixture();
  try {
    const taskId = 'T-07';
    const promptFile = writeFixtureFile(projectRoot, 'prompt-fixture.md', 'Execute a task T-07.\n');
    const begin = beginDispatch(projectRoot, { taskId, promptFile });
    assert.equal(begin.status, 0, `begin deve sair 0. stderr: ${begin.stderr}`);

    // Simula o agente morrendo: `end` NUNCA é chamado.
    const dir = dispatchDir(projectRoot, RUN_ID, taskId);
    assert.ok(fs.existsSync(path.join(dir, 'prompt.md')), 'prompt.md deve existir mesmo sem output/metadata');
    assert.ok(!fs.existsSync(path.join(dir, 'output.md')), 'output.md não deve existir — end nunca rodou');
    assert.ok(!fs.existsSync(path.join(dir, 'metadata.json')), 'metadata.json não deve existir — end nunca rodou');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── 4. metadata sem `model` → rejeitado (model pinning obrigatório) ───────

// @spec AC-05
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-04: metadata sem "model" é rejeitado — model pinning é obrigatório (Amendment 1.1.0)', () => {
  const projectRoot = makeProjectFixture();
  try {
    const taskId = 'T-08';
    const promptFile = writeFixtureFile(projectRoot, 'prompt-fixture.md', 'Execute a task T-08.\n');
    const begin = beginDispatch(projectRoot, { taskId, promptFile });
    assert.equal(begin.status, 0, `begin deve sair 0. stderr: ${begin.stderr}`);

    const outputFile = writeFixtureFile(projectRoot, 'output-fixture.md', 'Task concluída.\n');
    const badMetadata = validMetadata({ task_id: taskId });
    delete badMetadata.model;
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-no-model.json', JSON.stringify(badMetadata));

    const end = endDispatch(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(end.status, 0, `end deve sair != 0 sem "model". stdout: ${end.stdout} stderr: ${end.stderr}`);
    const errOut = end.stdout + end.stderr;
    assert.ok(/model/i.test(errOut), `saída deve nomear o campo "model" ausente. Got: ${errOut}`);

    // Tudo-ou-nada: REJECT não pode deixar metadata.json nem output.md parciais.
    const dir = dispatchDir(projectRoot, RUN_ID, taskId);
    assert.ok(!fs.existsSync(path.join(dir, 'metadata.json')), 'metadata.json não deve ser escrito em REJECT');
    assert.ok(!fs.existsSync(path.join(dir, 'output.md')), 'output.md não deve ser escrito em REJECT');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── 5-6. Invariante executor ≠ validador (AC-06) — os DOIS lados ──────────
// Os dois casos andam juntos: só o 5 passaria com um invariante que recusa
// tudo; só o 6 passaria com um invariante que não existe / sempre aceita.

// @spec AC-06
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-05: AC-06 lado A — validador igual ao executor_agent registrado é RECUSADO, com o nome do agente', () => {
  const projectRoot = makeProjectFixture();
  try {
    const executorAgent = 'soma-016-artifact-gated-trilho-T-09';
    const metadataFile = writeFixtureFile(
      projectRoot,
      'metadata-t09.json',
      JSON.stringify(validMetadata({ task_id: 'T-09', executor_agent: executorAgent }))
    );

    const { checkValidatorAssignment } = require(VALIDATOR_INVARIANT_MODULE);
    const result = checkValidatorAssignment({ metadataPath: metadataFile, proposedValidator: executorAgent });

    assert.equal(result.allowed, false, 'validador == executor_agent deve ser recusado');
    assert.ok(
      typeof result.reason === 'string' && result.reason.includes(executorAgent),
      `motivo da recusa deve nomear o agente "${executorAgent}". Got: ${JSON.stringify(result.reason)}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-06
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-06: AC-06 lado B — validador DIFERENTE do executor_agent é ACEITO', () => {
  const projectRoot = makeProjectFixture();
  try {
    const executorAgent = 'soma-016-artifact-gated-trilho-T-09';
    const proposedValidator = 'soma-016-artifact-gated-trilho-T-12';
    const metadataFile = writeFixtureFile(
      projectRoot,
      'metadata-t09.json',
      JSON.stringify(validMetadata({ task_id: 'T-09', executor_agent: executorAgent }))
    );

    const { checkValidatorAssignment } = require(VALIDATOR_INVARIANT_MODULE);
    const result = checkValidatorAssignment({ metadataPath: metadataFile, proposedValidator });

    assert.equal(
      result.allowed,
      true,
      `validador != executor_agent deve ser aceito. Got: ${JSON.stringify(result)}`
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── 7. Retentativa preserva o attempt anterior (Article VI) ───────────────

// @spec AC-05
// @contract CONTRACT-DISPATCH-RECORD-03
test('T-04-07: retentativa grava em attempt-{n}/ preservando o attempt anterior, sem sobrescrever', () => {
  const projectRoot = makeProjectFixture();
  try {
    const taskId = 'T-11';

    // attempt 1 (implícito, sem --attempt) — vive direto em {taskId}/
    const promptFile1 = writeFixtureFile(projectRoot, 'prompt-attempt-1.md', 'Tentativa 1 de T-11.\n');
    const begin1 = beginDispatch(projectRoot, { taskId, promptFile: promptFile1 });
    assert.equal(begin1.status, 0, `begin attempt 1 deve sair 0. stderr: ${begin1.stderr}`);
    const outputFile1 = writeFixtureFile(projectRoot, 'output-attempt-1.md', 'Falhou na tentativa 1.\n');
    const metadataFile1 = writeFixtureFile(
      projectRoot,
      'metadata-attempt-1.json',
      JSON.stringify(validMetadata({ task_id: taskId, attempt: 1, result: 'failed' }))
    );
    const end1 = endDispatch(projectRoot, { taskId, outputFile: outputFile1, metadataFile: metadataFile1 });
    assert.equal(end1.status, 0, `end attempt 1 deve sair 0. stderr: ${end1.stderr}`);

    const attempt1Dir = dispatchDir(projectRoot, RUN_ID, taskId, 1);
    const attempt1PromptSnapshot = fs.readFileSync(path.join(attempt1Dir, 'prompt.md'));

    // attempt 2 — deve ir para {taskId}/attempt-2/, NÃO sobrescrever attempt 1
    const promptFile2 = writeFixtureFile(projectRoot, 'prompt-attempt-2.md', 'Tentativa 2 de T-11 (retry).\n');
    const begin2 = beginDispatch(projectRoot, { taskId, attempt: 2, promptFile: promptFile2 });
    assert.equal(begin2.status, 0, `begin attempt 2 deve sair 0. stderr: ${begin2.stderr}`);
    const outputFile2 = writeFixtureFile(projectRoot, 'output-attempt-2.md', 'Sucesso na tentativa 2.\n');
    const metadataFile2 = writeFixtureFile(
      projectRoot,
      'metadata-attempt-2.json',
      JSON.stringify(validMetadata({ task_id: taskId, attempt: 2, result: 'done' }))
    );
    const end2 = endDispatch(projectRoot, {
      taskId,
      attempt: 2,
      outputFile: outputFile2,
      metadataFile: metadataFile2,
    });
    assert.equal(end2.status, 0, `end attempt 2 deve sair 0. stderr: ${end2.stderr}`);

    const attempt2Dir = dispatchDir(projectRoot, RUN_ID, taskId, 2);
    assert.ok(
      fs.existsSync(path.join(attempt2Dir, 'prompt.md')),
      `attempt 2 deve materializar em ${attempt2Dir}, não sobrescrever attempt 1`
    );

    // attempt 1 continua intacto, byte-a-byte, depois do attempt 2 rodar.
    assert.ok(fs.existsSync(path.join(attempt1Dir, 'prompt.md')), 'prompt.md do attempt 1 deve continuar existindo');
    const attempt1PromptAfter = fs.readFileSync(path.join(attempt1Dir, 'prompt.md'));
    assert.ok(
      Buffer.compare(attempt1PromptSnapshot, attempt1PromptAfter) === 0,
      'attempt 1 não pode ser alterado pela gravação do attempt 2 (Article VI, zero deleção)'
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
