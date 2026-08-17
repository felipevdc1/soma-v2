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

function begin(projectRoot, { taskId, attempt, promptFile }) {
  const args = ['dispatch-record', 'begin', '--run', RUN_ID, '--task', taskId, '--prompt-file', promptFile];
  if (attempt) args.push('--attempt', String(attempt));
  return runRun(args, { cwd: projectRoot });
}

function end(projectRoot, { taskId, attempt, outputFile, metadataFile }) {
  const args = [
    'dispatch-record',
    'end',
    '--run',
    RUN_ID,
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
