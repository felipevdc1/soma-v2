'use strict';
/**
 * trilho-e2e.test.cjs — T-19: smoke de ponta a ponta do trilho artifact-gated
 *
 * Não é mais um contract test de um primitivo isolado (T-01..T-18 já
 * cobriram cada verbo/hook individualmente, RED-antes-GREEN). Este arquivo
 * é a prova de que os primitivos, USADOS JUNTOS na forma como
 * `soma-run.md` de fato os encadeia, entregam os 4 critérios de "Fase 2
 * pronta" do §F — mais um quinto cenário que a T-18 pediu nominalmente
 * (o ramo SONAR_CLEAN, que pula STEP_9_FIX_LOOP inteiro na prosa).
 *
 * Article III HARD: filesystem real, `git` real, processos reais via
 * `spawnSync` chamando `run.cjs`/`framework-guard.cjs` — zero mock de
 * `fs`/`child_process`.
 *
 * ⚠️ os.tmpdir() neste Mac NÃO é `/tmp` (é `/var/folders/...`) — nunca
 * hardcodar o literal, nem no fixture nem nas asserções.
 *
 * Todo verbo abaixo é chamado com `--run` explícito — nenhum destes
 * testes depende de `.soma.lock` (o cenário (b), em particular, prova
 * que `--run` sozinho resolve mesmo com `.soma.lock` AUSENTE).
 *
 * @spec [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-06]
 *       [SPEC:AC-07] [SPEC:AC-10] [SPEC:AC-13]
 * @task T-19
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RUN_CLI = path.resolve(__dirname, '..', 'run.cjs');
const FRAMEWORK_GUARD = path.resolve(REPO_ROOT, 'core', 'hooks', 'framework-guard.cjs');
const { resolveSomaPaths } = require(path.resolve(__dirname, '..', 'run', 'paths.cjs'));

// ── Helpers ──────────────────────────────────────────────────────────────

function runRun(args, { cwd, env } = {}) {
  return spawnSync('node', [RUN_CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

/** Real git-initialized fixture project with `.soma/` present. */
function makeLabProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trilho-e2e-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Trilho E2E' ], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.soma'), { recursive: true });
  return dir;
}

function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

/** Spawn framework-guard.cjs with a PreToolUse-shaped stdin payload. */
function runFrameworkGuard({ cwd, command = 'git commit -m "e2e"', sessionId }) {
  const env = { ...process.env };
  delete env.CK_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  if (sessionId !== undefined) env.CK_SESSION_ID = sessionId;
  const payload = JSON.stringify({ tool_input: { command } });
  const r = spawnSync('node', [FRAMEWORK_GUARD], {
    cwd,
    input: payload,
    encoding: 'utf8',
    env,
  });
  return { code: r.status, stderr: r.stderr };
}

// ── (a) AC-01/AC-02/AC-10: prosa "done" sem report bloqueia; report pass libera ──
//
// A superfície do `gate` não tem canal nenhum para receber prosa — não há
// flag `--message`, não há leitura de stdout de agente. "Prosa 'done'" é
// simulada pela AUSÊNCIA de qualquer artefato: nenhum report emitido,
// nada além do fato de que um agente PODERIA ter dito "concluído com
// sucesso" em algum lugar que o gate simplesmente não lê. Isso É o ponto —
// não há forma de o teste "fingir" a prosa porque o primitivo não a aceita.

test('E2E (a): transição sem report bloqueia (mesmo com "prosa done" hipotética) — report pass libera', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-e2e-a';
    const init = runRun(['state', '--init', '--run', runId], { cwd: dir });
    assert.equal(init.status, 0, `state --init falhou: ${init.stderr}`);

    // Sem report nenhum para STEP_1A_SPECIFY — "prosa done" não é evidência.
    const blocked = runRun(['gate', '--run', runId, '--step', 'STEP_1B_PLAN'], { cwd: dir });
    assert.equal(blocked.status, 2, `esperava exit 2 (report ausente), veio ${blocked.status}. stderr: ${blocked.stderr}`);
    assert.ok(
      blocked.stderr.includes('STEP_1A_SPECIFY'),
      `stderr tem que nomear o report ausente, não só dizer "bloqueado". stderr: ${blocked.stderr}`
    );

    // Agora o artefato real — e só ele libera.
    const report = runRun(
      ['report', '--run', runId, '--step', 'STEP_1A_SPECIFY', '--status', 'pass'],
      { cwd: dir }
    );
    assert.equal(report.status, 0, `report falhou: ${report.stderr}`);

    const released = runRun(['gate', '--run', runId, '--step', 'STEP_1B_PLAN'], { cwd: dir });
    assert.equal(released.status, 0, `esperava exit 0 com report pass presente, veio ${released.status}. stderr: ${released.stderr}`);
  } finally {
    cleanup(dir);
  }
});

// ── (b) AC-04: run morto retomado de OUTRA sessão, sem .soma.lock, continua do checkpoint ──

test('E2E (b): resume de outra sessão (sem .soma.lock) continua do checkpoint, não re-executa nada', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-e2e-b';
    runRun(['state', '--init', '--run', runId], { cwd: dir });

    const passedSteps = ['STEP_1A_SPECIFY', 'STEP_1B_PLAN', 'STEP_1C_TASKS', 'STEP_2_TASKS', 'STEP_3_FOUNDATION'];
    for (const step of passedSteps) {
      const r = runRun(['report', '--run', runId, '--step', step, '--status', 'pass'], { cwd: dir });
      assert.equal(r.status, 0, `report de ${step} falhou: ${r.stderr}`);
    }

    // "Sessão morta": nenhum --run foi resolvido via .soma.lock em lugar
    // nenhum desta suíte — todo report/state acima usou --run explícito, e
    // este teste NUNCA cria .soma.lock. Confirma antes de retomar.
    const lockPath = path.join(dir, '.soma.lock');
    assert.equal(fs.existsSync(lockPath), false, '.soma.lock não deveria existir — a prova é que --run sozinho resolve');

    // "Outra sessão": processo novo, CK_SESSION_ID diferente de qualquer
    // coisa usada acima (que nem usou sessão nenhuma).
    const differentSession = `e2e-b-different-session-${process.pid}-${Date.now()}`;
    const resumed = runRun(['resume', '--run', runId], {
      cwd: dir,
      env: { CK_SESSION_ID: differentSession, CLAUDE_SESSION_ID: '' },
    });
    assert.equal(resumed.status, 0, `resume falhou: ${resumed.stderr}`);

    const payload = JSON.parse(resumed.stdout.split('\n')[0]);
    assert.equal(payload.ok, true);
    assert.equal(
      payload.reentry, 'STEP_4_WAVES',
      `esperava reentrada em STEP_4_WAVES (o step seguinte ao último "pass"), veio ${payload.reentry}`
    );
    assert.equal(payload.last_pass, 'STEP_3_FOUNDATION', `esperava last_pass STEP_3_FOUNDATION, veio ${payload.last_pass}`);

    // Resume é read-only (contrato do próprio módulo): reports[] não pode
    // ter mudado de tamanho por causa do resume.
    const { runStateFile } = resolveSomaPaths(dir, runId);
    const state = JSON.parse(fs.readFileSync(runStateFile, 'utf8'));
    assert.equal(state.reports.length, passedSteps.length, 'resume não pode mutar reports[] — nenhum step foi "re-executado"');
  } finally {
    cleanup(dir);
  }
});

// ── (c) AC-07/AC-13: git commit em path protegido bloqueia — path livre libera ──

test('E2E (c): git commit staged em path protegido -> exit 2 listando o path; path livre -> exit 0 e silêncio', () => {
  const dir = makeLabProject();
  try {
    const sessionId = `e2e-c-${process.pid}-${Date.now()}`;

    // Negativo primeiro: path NÃO protegido não pode bloquear — um guard
    // que bloqueia tudo é tão inútil quanto um que nunca bloqueia.
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
    execFileSync('git', ['add', 'README.md'], { cwd: dir });
    const clean = runFrameworkGuard({ cwd: dir, sessionId });
    assert.equal(clean.code, 0, `esperava exit 0 (path livre), veio ${clean.code}. stderr: ${clean.stderr}`);
    assert.equal(clean.stderr.trim(), '', `esperava silêncio, veio: ${clean.stderr}`);
    execFileSync('git', ['reset'], { cwd: dir });

    // Positivo: path protegido. (T-08a/D-018-07: PROTECTED_PATTERNS passou
    // de `hooks/**` para `core/hooks/**` junto com o git mv do repo real —
    // o fixture tem que encenar o layout NOVO, senão este teste continuaria
    // passando por acidente enquanto testa um padrão que não existe mais.)
    fs.mkdirSync(path.join(dir, 'core', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'core', 'hooks', 'sneaky.cjs'), 'x\n');
    execFileSync('git', ['add', 'core/hooks/sneaky.cjs'], { cwd: dir });
    const blocked = runFrameworkGuard({ cwd: dir, sessionId });
    assert.equal(blocked.code, 2, `esperava exit 2 (path protegido), veio ${blocked.code}. stderr: ${blocked.stderr}`);
    assert.ok(
      blocked.stderr.includes('core/hooks/sneaky.cjs'),
      `stderr tem que nomear o path ofensor, não só "bloqueado". stderr: ${blocked.stderr}`
    );
  } finally {
    cleanup(dir);
  }
});

// ── (d) AC-05/AC-06: run-dir diffável ao final ──
//
// "Diffável" aqui é tomado ao pé da letra: rodo o `diff` de verdade
// (não uma comparação de string frouxa) entre o artefato gravado em disco
// e o arquivo original que foi passado via --prompt-file/--output-file.
// `diff` sai 0 quando os arquivos são idênticos byte-a-byte — é a mesma
// técnica que o quickstart.md §5 usa manualmente. Escolhi `diff` de
// verdade em vez de `Buffer.equals`/string `===` porque a palavra do
// critério é literalmente "diffável", e `diff` expõe até divergência de
// encoding/quebra de linha que uma comparação ingênua poderia mascarar.

test('E2E (d): run-dir de dispatch é diffável — prompt.md/output.md idênticos byte-a-byte ao que foi enviado', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-e2e-d';
    const taskId = 'T-99';

    const promptFile = path.join(dir, 'lab-prompt.md');
    const promptContent = 'Implemente X seguindo o contrato Y.\nLinha com acento: ção, ã, ê.\n\tTab e trailing spaces:   \n';
    fs.writeFileSync(promptFile, promptContent, 'utf8');

    const begin = runRun(
      ['dispatch-record', 'begin', '--run', runId, '--task', taskId, '--prompt-file', promptFile],
      { cwd: dir }
    );
    assert.equal(begin.status, 0, `dispatch-record begin falhou: ${begin.stderr}`);

    const { runDispatchesDir } = resolveSomaPaths(dir, runId);
    const taskDir = path.join(runDispatchesDir, taskId);
    const writtenPrompt = path.join(taskDir, 'prompt.md');
    assert.ok(fs.existsSync(writtenPrompt), `esperava ${writtenPrompt} existir`);

    // diff real, não comparação de string — exit 0 = idêntico.
    const diffPrompt = spawnSync('diff', [writtenPrompt, promptFile], { encoding: 'utf8' });
    assert.equal(
      diffPrompt.status, 0,
      `prompt.md tem que ser diff-idêntico ao --prompt-file original. diff output: ${diffPrompt.stdout}${diffPrompt.stderr}`
    );

    const outputFile = path.join(dir, 'lab-output.md');
    const outputContent = 'feito — 3 testes verdes, SHA abc1234.\n';
    fs.writeFileSync(outputFile, outputContent, 'utf8');

    const metadataFile = path.join(dir, 'lab-meta.json');
    const metadata = {
      schema: 'soma-dispatch-record/v1',
      run_id: runId,
      task_id: taskId,
      attempt: 1,
      model: 'sonnet',
      base_sha: 'abc1234',
      started_at: '2026-08-17T00:00:00.000Z',
      finished_at: '2026-08-17T00:05:00.000Z',
      ac_refs: ['AC-05'],
      executor_agent: 'soma-e2e-T-99',
      result: 'done',
    };
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), 'utf8');

    const end = runRun(
      ['dispatch-record', 'end', '--run', runId, '--task', taskId, '--output-file', outputFile, '--metadata-file', metadataFile],
      { cwd: dir }
    );
    assert.equal(end.status, 0, `dispatch-record end falhou: ${end.stderr}`);

    const writtenOutput = path.join(taskDir, 'output.md');
    const diffOutput = spawnSync('diff', [writtenOutput, outputFile], { encoding: 'utf8' });
    assert.equal(
      diffOutput.status, 0,
      `output.md tem que ser diff-idêntico ao --output-file original. diff output: ${diffOutput.stdout}${diffOutput.stderr}`
    );

    const writtenMetadata = JSON.parse(fs.readFileSync(path.join(taskDir, 'metadata.json'), 'utf8'));
    assert.equal(writtenMetadata.model, 'sonnet', 'metadata.json tem que preservar o model pinning');
    assert.equal(writtenMetadata.executor_agent, 'soma-e2e-T-99');
    assert.equal(writtenMetadata.run_id, runId);
    assert.equal(writtenMetadata.task_id, taskId);

    // AC-06: executor == validador é recusado; executor != validador é aceito.
    const sameValidator = runRun(
      ['gate', '--run', runId, '--validate', taskId, '--validator', 'soma-e2e-T-99'],
      { cwd: dir }
    );
    assert.equal(sameValidator.status, 2, `validador == executor tem que ser recusado, veio ${sameValidator.status}`);

    const diffValidator = runRun(
      ['gate', '--run', runId, '--validate', taskId, '--validator', 'soma-e2e-outro-agente'],
      { cwd: dir }
    );
    assert.equal(diffValidator.status, 0, `validador != executor tem que ser aceito, veio ${diffValidator.status}. stderr: ${diffValidator.stderr}`);
  } finally {
    cleanup(dir);
  }
});

// ── (e) T-18: ramo SONAR_CLEAN pula STEP_9_FIX_LOOP na prosa — sem report
// proativo, o gate travaria no caminho feliz; com ele, libera ──
//
// Pedido nominal da executora da T-18: o STEP_ORDER de gate.cjs/resume.cjs
// é linear, mas a prosa do STEP_8 pula STEP_9 inteiro quando o SONAR já
// sai limpo. Reproduzo o defeito ISOLADO primeiro (prova que é real, não
// hipotético) e só depois aplico a cura que soma-run.md:325 manda.

test('E2E (e): SONAR_CLEAN sem report proativo de STEP_9 trava STEP_10_COMMIT; com report proativo, libera', () => {
  const dir = makeLabProject();
  try {
    const runId = 'run-e2e-e';
    runRun(['state', '--init', '--run', runId], { cwd: dir });

    // STEP_8_SONAR conclui limpo — mas SONAR_CLEAN pula STEP_9 na prosa.
    const sonar = runRun(['report', '--run', runId, '--step', 'STEP_8_SONAR', '--status', 'pass'], { cwd: dir });
    assert.equal(sonar.status, 0, `report STEP_8_SONAR falhou: ${sonar.stderr}`);

    // Reprodução do defeito: SEM report de STEP_9_FIX_LOOP, o gate do
    // step seguinte tem que travar — é exatamente o "quanto melhor o
    // trabalho, mais cedo trava" que a T-18 descreveu.
    const trapped = runRun(['gate', '--run', runId, '--step', 'STEP_10_COMMIT'], { cwd: dir });
    assert.equal(
      trapped.status, 2,
      `defeito esperado: sem o report proativo de STEP_9_FIX_LOOP, STEP_10_COMMIT tem que travar. veio ${trapped.status}`
    );
    assert.ok(
      trapped.stderr.includes('STEP_9_FIX_LOOP'),
      `a causa do travamento tem que nomear STEP_9_FIX_LOOP. stderr: ${trapped.stderr}`
    );

    // A cura, exatamente como soma-run.md:325 manda: report proativo do
    // step pulado.
    const proactive = runRun(
      ['report', '--run', runId, '--step', 'STEP_9_FIX_LOOP', '--status', 'pass', '--reason', 'SONAR limpo — 0 iterações do fix loop'],
      { cwd: dir }
    );
    assert.equal(proactive.status, 0, `report proativo de STEP_9_FIX_LOOP falhou: ${proactive.stderr}`);

    const released = runRun(['gate', '--run', runId, '--step', 'STEP_10_COMMIT'], { cwd: dir });
    assert.equal(
      released.status, 0,
      `com o report proativo, STEP_10_COMMIT tem que liberar. veio ${released.status}. stderr: ${released.stderr}`
    );
  } finally {
    cleanup(dir);
  }
});
