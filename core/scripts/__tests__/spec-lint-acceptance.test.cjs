'use strict';
/**
 * spec-lint-acceptance.test.cjs — T-09: prova de aceitação do `soma
 * spec-lint` contra a spec 016, nos DOIS estados (AC-11, AC-12).
 *
 * AC-11 (histórico, pré-`626936b`): a colisão de escrita paralela T-12×T-15
 * em `install/soma-hooks-map.json` sobreviveu aos 3 commits de correção da
 * 016 e à auditoria manual de 2026-08-15 — só foi vista quando a ferramenta
 * existiu. Materializa `626936b^` (`0c165d0`) num worktree descartável de
 * `git worktree add --detach`, injeta o mesmo info-string `soma-cli-surface`
 * na cerca que já existe no `plan.md` daquele commit, roda o lint e prova a
 * saída EXATA. Este teste é GREEN — a colisão já foi provada manualmente
 * antes de este arquivo existir.
 *
 * AC-12 (corrigido, HEAD atual): a 016 com a colisão já corrigida
 * (`7def35e`) deve sair silenciosa. NÃO sai — hoje `cli-surface` acusa 2
 * falsos-positivos em `quickstart.md:126`, porque a invocação de
 * `dispatch-record end` é continuada por `\` em duas linhas físicas e
 * `collectCandidateLines()` (`lib/spec-lint/checks/cli-surface.cjs`) não
 * junta linhas continuadas antes de tokenizar — vê só a linha 126 e não
 * enxerga `--output-file`/`--metadata-file` da linha 127. Bug real,
 * despachado como T-12 (dono: quem escreveu `cli-surface.cjs`, não esta
 * task). RED planejado (Article II) até T-12 fechar — ver `[RED até T-12]`
 * no nome do teste abaixo, mesmo padrão usado por T-03 em
 * contract-lint-output.test.cjs.
 *
 * A única edição fora da 017 autorizada por `plan.md` §"A única edição
 * fora da 017" — o info-string na cerca do `plan.md` da 016 no HEAD atual
 * (não neste arquivo; é uma edição de repositório, feita e commitada à
 * parte) — é o que faz `cli-surface` rodar de vez contra a 016 corrigida em
 * vez de sair `pulado`. Foi essa mesma injeção, rodada manualmente, que
 * revelou o bug de T-12: o rodapé antes da injeção dizia `pulados:
 * cli-surface` — o check nunca tinha rodado, e "0 achados" lido como
 * sucesso escondia isso.
 *
 * Article II HARD: RED planejado até T-12 fechar.
 * Article III HARD: real fs + real git + real child_process, zero mocks.
 * `os.tmpdir()` neste Mac NÃO é `/tmp` — o worktree histórico é criado ali
 * de verdade e removido no `finally` de cada teste, nunca deixado órfão.
 *
 * @spec [SPEC:AC-11] [SPEC:AC-12]
 * @task T-09
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const CORE_DIR = path.resolve(SCRIPTS_DIR, '..');
const REPO_ROOT = path.resolve(CORE_DIR, '..');
const SOMA_CLI = path.join(SCRIPTS_DIR, 'soma.cjs');
const SPEC_016_DIR = path.join(CORE_DIR, 'specs', '016-artifact-gated-trilho');

// 626936b^ — o commit imediatamente anterior ao primeiro dos 3 commits de
// correção da 016 (626936b, 7def35e-equivalente-ainda-não-existe,
// 9ba54b2). Full SHA fixado para não depender de abreviação ambígua.
const HISTORICAL_SHA = '0c165d0c9fa6fb3817834dc974e3531725788bb1';

const EXPECTED_HISTORICAL_FINDING =
  'parallel-collision: tasks.md:65: T-12 e T-15 são [P] no mesmo nível e escrevem em install/soma-hooks-map.json';
// AC-01 (spec 019, dispatch avulso): heading-near-miss foi registrado no FIM
// de registry.cjs, depois de parallel-collision — a ordem no rodapé é a
// ordem do registry (spec-lint.cjs:81, checks.map(c => c.name)), então a
// lista cresce de 2 para 3 nomes SEM reordenar os dois já existentes.
// `achados:` continua idêntico (1 e 0) — rodado direto contra os dois casos
// reais (worktree histórico e core/specs/016-artifact-gated-trilho no HEAD
// atual) para confirmar que heading-near-miss não gera falso-positivo nem
// pula (`pulados: -` também intacto) contra este corpus.
//
// AC-02 (spec 019, dispatch avulso): red-only-coverage registrado no FIM,
// depois de heading-near-miss — a lista cresce de 3 para 4 nomes, mesma
// regra. Verificado ao vivo (não por leitura): 016/tasks.md não tem AC
// coberto por task única RED-only em nenhum dos dois estados (T-01
// referencia AC-01+AC-03, cada um com 3+ tasks referenciadoras) — `achados:`
// permanece 1 e 0.
const EXPECTED_HISTORICAL_FOOTER =
  'checks executados: cli-surface, parallel-collision, heading-near-miss, red-only-coverage  |  pulados: -  |  achados: 1';
const EXPECTED_CORRECTED_FOOTER =
  'checks executados: cli-surface, parallel-collision, heading-near-miss, red-only-coverage  |  pulados: -  |  achados: 0';

function runSpecLint(specDir) {
  return spawnSync('node', [SOMA_CLI, 'spec-lint', specDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

/** Injects the `soma-cli-surface` info-string into the ONE bare fence pair
 *  in `plan.md`, without touching a single other byte. Asserts there is
 *  exactly one bare-fence pair first — the same check done by hand before
 *  editing the real 016 plan.md, so a `plan.md` that grew a second bare
 *  fence can't get silently mis-patched. */
function injectCliSurfaceFence(planPath) {
  const text = fs.readFileSync(planPath, 'utf8');
  const lines = text.split('\n');
  const bareFenceLines = [];
  lines.forEach((l, i) => { if (l === '```') bareFenceLines.push(i); });
  assert.equal(bareFenceLines.length, 2,
    `expected exactly one bare \`\`\` fence pair (2 lines) in ${planPath}, found ${bareFenceLines.length} bare fence line(s): ${JSON.stringify(bareFenceLines)}`);
  lines[bareFenceLines[0]] = '```soma-cli-surface';
  fs.writeFileSync(planPath, lines.join('\n'));
}

/** Removes a worktree hermetically: `git worktree remove --force`, falling
 *  back to a raw `fs.rmSync` if that fails for any reason, then `prune` so
 *  no administrative entry survives either way. Never throws — cleanup
 *  must not mask (or replace) an assertion failure from the test body. */
function removeWorktree(dir) {
  spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
}

// ── AC-11: estado histórico — a colisão sobrevive aos 3 commits de correção ──

test('T-09 AC-11: 626936b^ com o info-string injetado → acusa a colisão T-12×T-15 que sobreviveu aos 3 commits de correção e à auditoria manual', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-017-t09-hist-'));
  try {
    const add = spawnSync('git', ['worktree', 'add', '--detach', tmpDir, HISTORICAL_SHA], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(add.error, undefined, `git worktree add spawn failed: ${add.error}`);
    assert.equal(add.status, 0, `git worktree add failed (exit ${add.status}). stderr: ${add.stderr}`);

    const historicalSpecDir = path.join(tmpDir, 'core', 'specs', '016-artifact-gated-trilho');
    const historicalPlan = path.join(historicalSpecDir, 'plan.md');
    assert.ok(fs.existsSync(historicalPlan),
      `precondition: historical plan.md must exist at ${historicalPlan} — materialization failed silently otherwise`);

    injectCliSurfaceFence(historicalPlan);

    // The CLI itself runs from the CURRENT repo (HEAD) — only the DATA
    // (the specDir being linted) is historical. spec-lint didn't exist at
    // 0c165d0; there is nothing to invoke there.
    const r = runSpecLint(historicalSpecDir);
    assert.equal(r.error, undefined, `soma spec-lint spawn failed: ${r.error}`);
    assert.equal(r.status, 1,
      `expected exit 1 (the surviving collision), got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);

    const outLines = r.stdout.trim().split('\n');
    assert.equal(outLines.length, 2,
      `expected exactly 2 stdout lines (1 finding + footer), got ${outLines.length}: ${JSON.stringify(outLines)}`);
    assert.equal(outLines[0], EXPECTED_HISTORICAL_FINDING,
      `finding text mismatch. Got: "${outLines[0]}"`);
    assert.equal(outLines[1], EXPECTED_HISTORICAL_FOOTER,
      `footer mismatch. Got: "${outLines[1]}"`);
  } finally {
    removeWorktree(tmpDir);
  }
});

// ── AC-12: 016 corrigida no HEAD atual — deve sair silenciosa ──────────────

// RED até T-12: cli-surface acusa 2 falsos-positivos em quickstart.md:126
// (a invocação de `dispatch-record end` continuada por `\` em 2 linhas
// físicas — collectCandidateLines() não junta linhas continuadas antes de
// tokenizar). parallel-collision já sai limpo (T-12×T-15 corrigido em
// 7def35e). Fecha quando T-12 (o task de código, não este teste) ensinar o
// scanner de invocação a juntar linhas continuadas por `\`.
test('T-09 AC-12: 016 corrigida no HEAD atual (com o info-string do plan.md) → zero achados, exit 0 [RED até T-12]', () => {
  assert.ok(fs.existsSync(SPEC_016_DIR), `precondition: ${SPEC_016_DIR} must exist`);

  const r = runSpecLint(SPEC_016_DIR);
  assert.equal(r.error, undefined, `soma spec-lint spawn failed: ${r.error}`);
  assert.equal(r.status, 0,
    `expected exit 0, got ${r.status}. stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.equal(r.stdout.trim(), EXPECTED_CORRECTED_FOOTER,
    `expected the clean footer with zero findings. Got stdout: "${r.stdout}"`);
});
