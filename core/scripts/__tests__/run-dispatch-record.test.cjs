'use strict';
/**
 * run-dispatch-record.test.cjs — integration test for `soma run dispatch-record`
 * (Spec 016, T-10)
 *
 * CONTRACT-DISPATCH-RECORD-03's own contract test (contract-dispatch-record.
 * test.cjs, T-04) already covers T-10's 5 assigned cases (T-04-01, T-04-02,
 * T-04-03, T-04-04, T-04-07) plus the 2 AC-06 cases that belong to T-11
 * (validator-invariant.cjs, not touched here). This file adds what the
 * contract test doesn't: dispatch-record.cjs's own flag validation, extra
 * schema-rejection paths (invalid JSON, invalid `result`, non-integer
 * `attempt`), and the unknown-subcommand path.
 *
 * Article III HARD: real fs / real child_process, zero mocks.
 * ⚠️ os.tmpdir() on this machine is NOT /tmp — never hardcode the literal.
 *
 * @spec AC-05
 * @contract CONTRACT-DISPATCH-RECORD-03
 * @task T-10
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const RUN_ID = 'run-t10-integration';

function runRun(args, { cwd }) {
  return spawnSync('node', [RUN_CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}

function makeFixtureProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-t10-'));
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

function writeFixtureFile(projectRoot, name, content) {
  const p = path.join(projectRoot, name);
  fs.writeFileSync(p, content);
  return p;
}

// .soma.lock is a pre-existing mechanism (soma-run.md §0.3), not invented
// here — mirrors the fixture helper T-02's contract test already uses for
// report/gate.
function writeLock(projectRoot, runId) {
  fs.writeFileSync(
    path.join(projectRoot, '.soma.lock'),
    JSON.stringify({ sessionId: 'test-session-t10', runId, startedAt: new Date().toISOString() }),
    'utf8'
  );
}

function recordDir(projectRoot, runId, taskId, attempt) {
  const base = path.join(projectRoot, '.soma', 'dispatches', runId, taskId);
  return attempt && attempt > 1 ? path.join(base, `attempt-${attempt}`) : base;
}

function validMetadata(overrides = {}) {
  return {
    schema: 'soma-dispatch-record/v1',
    run_id: RUN_ID,
    task_id: 'T-XX',
    attempt: 1,
    model: 'sonnet',
    base_sha: 'abc1234',
    started_at: '2026-08-16T10:00:00.000Z',
    finished_at: '2026-08-16T10:05:00.000Z',
    ac_refs: ['AC-05'],
    executor_agent: 'soma-016-artifact-gated-trilho-T-XX',
    result: 'done',
    ...overrides,
  };
}

// run: pass explicitly to override the default RUN_ID, or `null` to omit
// --run entirely (exercising .soma.lock resolution / the unresolved path).
function begin(projectRoot, { run = RUN_ID, taskId, attempt, promptFile }) {
  const args = ['dispatch-record', 'begin'];
  if (run !== null) args.push('--run', run);
  args.push('--task', taskId, '--prompt-file', promptFile);
  if (attempt) args.push('--attempt', String(attempt));
  return runRun(args, { cwd: projectRoot });
}

function end(projectRoot, { run = RUN_ID, taskId, attempt, outputFile, metadataFile }) {
  const args = ['dispatch-record', 'end'];
  if (run !== null) args.push('--run', run);
  args.push('--task', taskId, '--output-file', outputFile, '--metadata-file', metadataFile);
  if (attempt) args.push('--attempt', String(attempt));
  return runRun(args, { cwd: projectRoot });
}

// @spec AC-05
test('begin sem --attempt: prompt.md vai direto em {taskId}/, sem attempt-1/', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-20';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-20.\n');
    const result = begin(projectRoot, { taskId, promptFile });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const dir = recordDir(projectRoot, RUN_ID, taskId);
    assert.ok(fs.existsSync(path.join(dir, 'prompt.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'attempt-1')), 'attempt 1 nunca deve criar subpasta attempt-1/');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: metadata.json gravado é exatamente o payload validado (pretty-printed)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-21';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-21.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'T-21 concluída.\n');
    const meta = validMetadata({ task_id: taskId, executor_agent: 'soma-016-artifact-gated-trilho-T-21' });
    const metadataFile = writeFixtureFile(projectRoot, 'metadata.json', JSON.stringify(meta));
    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const dir = recordDir(projectRoot, RUN_ID, taskId);
    const writtenMeta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    assert.deepEqual(writtenMeta, meta);

    const writtenOutput = fs.readFileSync(path.join(dir, 'output.md'), 'utf8');
    assert.equal(writtenOutput, 'T-21 concluída.\n');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: output.md é cópia byte-a-byte de --output-file, sem alteração de encoding', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-22';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-22.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const trickyOutput =
      'Saída com café, mañana, 日本語, emoji 🚀 e trailing spaces:   \nSegunda linha sem quebra final';
    const outputFile = writeFixtureFile(projectRoot, 'output-tricky.md', trickyOutput);
    const metadataFile = writeFixtureFile(
      projectRoot,
      'metadata.json',
      JSON.stringify(validMetadata({ task_id: taskId }))
    );
    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const expected = fs.readFileSync(outputFile);
    const actual = fs.readFileSync(path.join(recordDir(projectRoot, RUN_ID, taskId), 'output.md'));
    assert.ok(Buffer.compare(expected, actual) === 0, 'output.md deve ser byte-a-byte idêntico');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: JSON corrompido em --metadata-file → REJECT, exit != 0, nada escrito', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-23';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-23.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'saida\n');
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-bad.json', '{ isto não é json');
    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(result.status, 0);

    const dir = recordDir(projectRoot, RUN_ID, taskId);
    assert.ok(!fs.existsSync(path.join(dir, 'output.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'metadata.json')));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: "result" fora do enum → REJECT, exit != 0, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-24';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-24.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'saida\n');
    const badMeta = validMetadata({ task_id: taskId, result: 'concluido-com-sucesso' });
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-bad-result.json', JSON.stringify(badMeta));
    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(result.status, 0);
    assert.ok(/result/i.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: "attempt" não-inteiro (ex: 1.5) → REJECT, exit != 0', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-25';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-25.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'saida\n');
    const badMeta = validMetadata({ task_id: taskId, attempt: 1.5 });
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-bad-attempt.json', JSON.stringify(badMeta));
    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(result.status, 0);
    assert.ok(/attempt/i.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('begin sem --run/--task/--prompt-file → exit != 0, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'x\n');

    const noRun = runRun(['dispatch-record', 'begin', '--task', 'T-26', '--prompt-file', promptFile], {
      cwd: projectRoot,
    });
    assert.notEqual(noRun.status, 0);
    assert.ok(/--run/.test(noRun.stderr), noRun.stderr);

    const noTask = runRun(['dispatch-record', 'begin', '--run', RUN_ID, '--prompt-file', promptFile], {
      cwd: projectRoot,
    });
    assert.notEqual(noTask.status, 0);
    assert.ok(/--task/.test(noTask.stderr), noTask.stderr);

    const noPrompt = runRun(['dispatch-record', 'begin', '--run', RUN_ID, '--task', 'T-26'], { cwd: projectRoot });
    assert.notEqual(noPrompt.status, 0);
    assert.ok(/--prompt-file/.test(noPrompt.stderr), noPrompt.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('begin com --prompt-file inexistente → exit != 0, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const missing = path.join(projectRoot, 'nao-existe.md');
    const result = begin(projectRoot, { taskId: 'T-27', promptFile: missing });
    assert.notEqual(result.status, 0);
    assert.ok(/--prompt-file/.test(result.stderr) || /não é legível/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('subcomando desconhecido → exit != 0, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const result = runRun(['dispatch-record', 'bogus'], { cwd: projectRoot });
    assert.notEqual(result.status, 0);
    assert.ok(/bogus/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('--attempt inválido (não-numérico) → exit != 0', () => {
  const projectRoot = makeFixtureProject();
  try {
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'x\n');
    const result = begin(projectRoot, { taskId: 'T-28', attempt: 'abc', promptFile });
    assert.notEqual(result.status, 0);
    assert.ok(/--attempt/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('escrita atômica: nenhum arquivo .tmp residual após begin+end', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-29';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'x\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);
    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'y\n');
    const metadataFile = writeFixtureFile(
      projectRoot,
      'metadata.json',
      JSON.stringify(validMetadata({ task_id: taskId }))
    );
    assert.equal(end(projectRoot, { taskId, outputFile, metadataFile }).status, 0);

    const dir = recordDir(projectRoot, RUN_ID, taskId);
    const stray = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(stray, []);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── --run agora opcional (correção 2026-08-17, ver contrato "Superfície de
//    CLI"): resolve via .soma.lock quando omitido, igual report/state/gate.

// @spec AC-05
test('begin --run omitido, com .soma.lock legível → resolve runId do lock', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t10-from-lock';
    writeLock(projectRoot, runId);
    const taskId = 'T-30';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-30.\n');
    const result = begin(projectRoot, { run: null, taskId, promptFile });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const dir = recordDir(projectRoot, runId, taskId);
    assert.ok(fs.existsSync(path.join(dir, 'prompt.md')));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('begin --run omitido e sem .soma.lock → exit != 0, cita --run e .soma.lock', () => {
  const projectRoot = makeFixtureProject();
  try {
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'x\n');
    const result = begin(projectRoot, { run: null, taskId: 'T-31', promptFile });
    assert.notEqual(result.status, 0);
    assert.ok(/--run/.test(result.stderr), result.stderr);
    assert.ok(/\.soma\.lock/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('begin+end --run omitido nos dois: fluxo completo resolve o mesmo runId do lock nas duas chamadas', () => {
  const projectRoot = makeFixtureProject();
  try {
    const runId = 'run-t10-from-lock-e2e';
    writeLock(projectRoot, runId);
    const taskId = 'T-32';

    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-32.\n');
    assert.equal(begin(projectRoot, { run: null, taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'T-32 concluída.\n');
    const metadataFile = writeFixtureFile(
      projectRoot,
      'metadata.json',
      JSON.stringify(validMetadata({ run_id: runId, task_id: taskId }))
    );
    const result = end(projectRoot, { run: null, taskId, outputFile, metadataFile });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const dir = recordDir(projectRoot, runId, taskId);
    for (const filename of ['prompt.md', 'output.md', 'metadata.json']) {
      assert.ok(fs.existsSync(path.join(dir, filename)), `esperava ${filename} em ${dir}`);
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ── Coerência local (contrato "O que end valida", fechado 2026-08-17): o
//    metadata não pode mentir sobre a task/run/attempt a que pertence.

// @spec AC-05
test('end: metadata.task_id divergente do --task → REJECT, nada escrito (prova do buraco fechado)', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-33';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-33.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'saida\n');
    // metadata alega pertencer a T-09, mas a chamada é --task T-33: exatamente
    // o buraco que o ajuste fecha — um registro de proveniência mentindo
    // sobre a própria localização.
    const mismatched = validMetadata({ task_id: 'T-09' });
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-mismatch.json', JSON.stringify(mismatched));

    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(result.status, 0, `esperava REJECT. stdout=${result.stdout}`);
    assert.ok(/task_id/i.test(result.stderr), result.stderr);
    assert.ok(/T-09/.test(result.stderr) && /T-33/.test(result.stderr), result.stderr);

    // Nada parcial: nem output.md nem metadata.json chegam a existir.
    const dir = recordDir(projectRoot, RUN_ID, taskId);
    assert.ok(!fs.existsSync(path.join(dir, 'output.md')), 'output.md não deve ser escrito em REJECT');
    assert.ok(!fs.existsSync(path.join(dir, 'metadata.json')), 'metadata.json não deve ser escrito em REJECT');
    // O diretório de T-09 (o valor mentiroso do metadata) também não deve
    // ganhar nada — a escrita nunca chega a acontecer.
    const wrongDir = recordDir(projectRoot, RUN_ID, 'T-09');
    assert.ok(!fs.existsSync(wrongDir), 'diretório da task mentirosa não deve ser criado');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: metadata.run_id divergente do --run efetivo → REJECT, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-34';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-34.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'saida\n');
    const mismatched = validMetadata({ task_id: taskId, run_id: 'run-outro-totalmente-diferente' });
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-mismatch-run.json', JSON.stringify(mismatched));

    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(result.status, 0);
    assert.ok(/run_id/i.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-05
test('end: metadata.attempt divergente do --attempt efetivo → REJECT, causa nomeada', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-35';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'Execute T-35.\n');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);

    const outputFile = writeFixtureFile(projectRoot, 'output.md', 'saida\n');
    // --attempt omitido → efetivo é 1, mas o metadata alega attempt 2.
    const mismatched = validMetadata({ task_id: taskId, attempt: 2 });
    const metadataFile = writeFixtureFile(projectRoot, 'metadata-mismatch-attempt.json', JSON.stringify(mismatched));

    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.notEqual(result.status, 0);
    assert.ok(/attempt/i.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-01
test('begin: prompt acima de 8.000 bytes ou tentativa acima de 2 → exit 2 sem artefato', () => {
  const projectRoot = makeFixtureProject();
  try {
    const promptFile = writeFixtureFile(projectRoot, 'prompt-over-budget.md', 'x'.repeat(8001));
    const promptResult = begin(projectRoot, { taskId: 'T-025-PROMPT', promptFile });
    assert.equal(promptResult.status, 2, `stderr=${promptResult.stderr}`);
    assert.match(promptResult.stderr, /8\.000|8000|prompt/i);
    assert.ok(!fs.existsSync(recordDir(projectRoot, RUN_ID, 'T-025-PROMPT')));

    const validPrompt = writeFixtureFile(projectRoot, 'prompt-valid.md', 'ok');
    const attemptResult = begin(projectRoot, { taskId: 'T-025-ATTEMPT', attempt: 3, promptFile: validPrompt });
    assert.equal(attemptResult.status, 2, `stderr=${attemptResult.stderr}`);
    assert.match(attemptResult.stderr, /tentativa|attempt|2/i);
    assert.ok(!fs.existsSync(recordDir(projectRoot, RUN_ID, 'T-025-ATTEMPT', 3)));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-02
test('end: output acima de 4.000 bytes → exit 2 sem output.md nem metadata.json', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-025-OUTPUT';
    const promptFile = writeFixtureFile(projectRoot, 'prompt.md', 'ok');
    assert.equal(begin(projectRoot, { taskId, promptFile }).status, 0);
    const outputFile = writeFixtureFile(projectRoot, 'output-over-budget.md', 'x'.repeat(4001));
    const metadataFile = writeFixtureFile(projectRoot, 'metadata.json', JSON.stringify(validMetadata({ task_id: taskId })));

    const result = end(projectRoot, { taskId, outputFile, metadataFile });
    assert.equal(result.status, 2, `stderr=${result.stderr}`);
    assert.match(result.stderr, /4\.000|4000|output/i);
    const dir = recordDir(projectRoot, RUN_ID, taskId);
    assert.ok(!fs.existsSync(path.join(dir, 'output.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'metadata.json')));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// @spec AC-03
test('begin+end: limites exatos de 8.000/4.000 bytes e tentativa 2 preservam os três artefatos', () => {
  const projectRoot = makeFixtureProject();
  try {
    const taskId = 'T-025-EXACT';
    const promptFile = writeFixtureFile(projectRoot, 'prompt-exact.md', 'p'.repeat(8000));
    const beginResult = begin(projectRoot, { taskId, attempt: 2, promptFile });
    assert.equal(beginResult.status, 0, `stderr=${beginResult.stderr}`);
    const outputFile = writeFixtureFile(projectRoot, 'output-exact.md', 'o'.repeat(4000));
    const metadataFile = writeFixtureFile(
      projectRoot,
      'metadata-exact.json',
      JSON.stringify(validMetadata({ task_id: taskId, attempt: 2 }))
    );
    const endResult = end(projectRoot, { taskId, attempt: 2, outputFile, metadataFile });
    assert.equal(endResult.status, 0, `stderr=${endResult.stderr}`);
    const dir = recordDir(projectRoot, RUN_ID, taskId, 2);
    for (const artifact of ['prompt.md', 'output.md', 'metadata.json']) {
      assert.ok(fs.existsSync(path.join(dir, artifact)), `${artifact} deve ser preservado`);
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
