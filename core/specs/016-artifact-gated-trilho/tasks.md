# Tasks: Trilho V3 — Artifact-Gated Steps, Durable Run-State E Proveniência De Dispatch

**Feature ID:** 016-artifact-gated-trilho
**Spec:** `core/specs/016-artifact-gated-trilho/spec.md`
**Created:** 2026-08-15

---

## Conventions

- `[P]` — parallel-safe (sem sobreposição de arquivos com outras `[P]` da mesma wave)
- `[SPEC:AC-XX]` — link de rastreabilidade com o critério de aceitação
- `[CONTRACT:filename]` — link com o arquivo de contrato
- `[FOUNDATION]` — bloqueia todas as waves
- `[WIRING]` — integração, roda no STEP_7
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

**Regras de execução desta fase** (não são decorativas):

1. **TDD obrigatório** (Article II) — toda task de código nasce com RED provado em commit separado. `git log` é a prova.
2. **Teste exercita conteúdo, não só forma.** Um report que valida contra o schema e descreve a coisa errada é falso-verde. Nenhuma task de report fecha com teste que só afirma conformidade estrutural — ver `plan.md` §"A restrição de design que veio da execução".
3. **Filesystem real** (Article III) — diretórios temporários e repositórios git reais. Zero mock de `fs`/`child_process`.
4. **`os.tmpdir()` nunca é `/tmp`** neste Mac, e `sessionId` vem de env var, não de stdin. Errar isso faz o teste passar sem testar nada — aconteceu 2× em 2026-08-14/15.
5. **Zero dependência nova.** O `package.json` não tem as chaves `dependencies` nem `devDependencies` — e não deve passar a ter.
6. **Baseline**: as **5 falhas pré-existentes** (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`) **não devem ser consertadas**. Contagem total é móvel — cada wave de contract test soma RED planejado (era 1184/1176/5/3 em `2929f50`; 1219/1189/27/3 em `0c165d0`). **Meça antes e depois da sua task e reconcilie a diferença**; o que importa é que nenhum fail NOVO apareça fora dos seus.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | `[FOUNDATION]` Esqueleto do primitivo `soma run`: dispatcher fino `core/scripts/run.cjs` que roteia os 5 verbos para `core/scripts/run/{verbo}.cjs`, registro no array `SUBCOMMANDS` de `core/scripts/soma.cjs`, e os **dois módulos compartilhados**: `run/schema.cjs` (validador à mão, zero dep) e `run/paths.cjs` (resolução de projeto e de `.soma/`, incluindo detecção de projeto legado). RED: `soma run --help` lista os 5 verbos e verbo desconhecido sai com exit ≠ 0 | [SPEC:AC-01] [SPEC:AC-03] | `core/scripts/run.cjs`, `core/scripts/run/schema.cjs`, `core/scripts/run/paths.cjs`, `core/scripts/soma.cjs`, `core/scripts/__tests__/run.test.cjs` | DONE |

> **Por que o dispatcher é fino e os verbos são módulos separados:** as 8 tasks da Wave 2 são `[P]` e, num arquivo único, todas escreveriam em `core/scripts/run.cjs` — conflito de paralelismo que o STEP_1C rejeita. A decomposição é exigida pela estrutura de execução, não é abstração especulativa: cada task passa a ser dona de um arquivo. T-01 cria o dispatcher e os dois módulos compartilhados; **depois de T-01, ninguém mais edita `run.cjs`**.

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

*Article III: contract test antes de qualquer implementação que use o contrato.*

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | `[P]` Contract test de `contracts/emit-step-report.md` — os 6 casos do stub, incluindo os de **conteúdo** (status `fail` bloqueia pela razão certa; status fora do enum não vira pass; JSON corrompido é REJECT) | [CONTRACT:emit-step-report] | `core/scripts/__tests__/contract-step-report.test.cjs` | T-01 | DONE |
| T-03 | `[P]` Contract test de `contracts/persist-run-state.md` — superset v1.0→v2, escrita atômica, append-only, e a **regressão do consumidor**: `spec-completeness-gate` continua achando `specPath` após a migração | [CONTRACT:persist-run-state] | `core/scripts/__tests__/contract-run-state.test.cjs` | T-01 | DONE |
| T-04 | `[P]` Contract test de `contracts/emit-dispatch-record.md` — 3 arquivos materializados, `prompt.md` byte-a-byte, gravado antes do dispatch, `model` obrigatório, e os **dois lados** do invariante AC-06 (recusa quando igual, aceita quando diferente) | [CONTRACT:emit-dispatch-record] | `core/scripts/__tests__/contract-dispatch-record.test.cjs` | T-01 | DONE |
| T-05 | `[P]` Contract test de `contracts/framework-guard-hook.md` — repo git real, `sessionId` de env var, `TMPDIR` alterado, os **dois lados** (bloqueia protegido / libera não-protegido), e o teste de que o hook está registrado no `soma-hooks-map.json` | [CONTRACT:framework-guard-hook] | `hooks/__tests__/framework-guard.test.cjs` | T-01 | DONE |

> **Âncoras de evidência da Foundation + Wave 1** (registradas em 2026-08-16 ao corrigir um drift: T-01..T-04 estavam marcadas `TODO` com o código já commitado, e um dispatch de Wave 2 lendo este arquivo como fonte de verdade poderia reconstruí-las do zero).
> T-01 `a423908` · T-02 `5171623` · T-03 `310a95e` (+`0c165d0`, conserto do falso-verde T-03-04b) · T-04 `45a50ec` · T-05 `d69b6ae` · T-15 `ffcb4d7` · T-16 `67bf6fb`.
> **RED planejado que estas tasks põem no ar, medido em `33efb0a`:** T-02 = 6 · T-03 = 8 · T-04 = 7 · T-05 = 9 → **30**, mais as 5 pré-existentes = **35 fails**, que é a suíte `1293/1255/35/3`. Wave 2 fecha os 30; as 5 continuam baseline.

---

## Wave 2 — Implementação (Step 4, Wave 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-06 | `[P]` `soma run report` — emite `.soma/reports/{runId}/{step}-report.json` validado contra `soma-step-report/v1`, atomicamente, antes de qualquer transição. Integration test `// @spec AC-01` | [SPEC:AC-01] | `core/scripts/run/report.cjs`, `core/scripts/__tests__/run-report.test.cjs` | T-02 | DONE |
| T-07 | `[P]` `soma run gate` — exit 0 só com report presente, válido e `pass`; exit 2 em ausência, `fail`, `blocked`, inválido ou ilegível, sempre nomeando a causa. Integration test `// @spec AC-02` cobrindo os 5 caminhos de bloqueio. A tag AC-10 aqui cobre só a fatia "artefato ilegível"; a fatia "check externo não executa" é da T-15 | [SPEC:AC-02] [SPEC:AC-10] | `core/scripts/run/gate.cjs`, `core/scripts/__tests__/run-gate.test.cjs` | T-02 | DONE |
| T-08 | `[P]` `soma run state` — persiste `soma-state/v2` em `{projeto}/.soma/run-state-{runId}.json`, superset estrito do v1.0, escrita atômica preservada, `decisions[]`/`reports[]` append-only. Integration test `// @spec AC-03` | [SPEC:AC-03] | `core/scripts/run/state.cjs`, `core/scripts/__tests__/run-state.test.cjs` | T-03 | DONE |
| T-09 | `[P]` `soma run resume --run {runId}` — retoma do último step com report `pass`, de sessão diferente, sem re-executar step concluído. Integration test `// @spec AC-04` que mata e retoma de fato | [SPEC:AC-04] | `core/scripts/run/resume.cjs`, `core/scripts/__tests__/run-resume.test.cjs` | T-03, T-06 | DONE |
| T-10 | `[P]` `soma run dispatch-record` — materializa `prompt.md` antes do dispatch, `output.md`+`metadata.json` no retorno, retentativa em `attempt-{n}` sem sobrescrever. Integration test `// @spec AC-05` | [SPEC:AC-05] | `core/scripts/run/dispatch-record.cjs`, `core/scripts/__tests__/run-dispatch-record.test.cjs` | T-04 | DONE |
| T-11 | `[P]` Invariante executor ≠ validador — `STEP_5_VALIDATE` lê `executor_agent` do `metadata.json` e recusa atribuição idêntica, registrando a recusa no report. Integration test `// @spec AC-06` nos dois sentidos | [SPEC:AC-06] | `core/scripts/run/validator-invariant.cjs`, `core/scripts/__tests__/run-validator-invariant.test.cjs` | T-04 | DONE |
| T-12 | `[P]` `hooks/framework-guard.cjs` — bloqueia `git commit` com staged em path protegido, exit 2 listando os ofensores; **+ entrada `PreToolUse`/`Bash` em `install/soma-hooks-map.json`** (sem o wiring o hook nunca dispara). **Depende de T-15 além de T-05**: as duas registram entrada no mesmo `install/soma-hooks-map.json` e ambas eram `[P]` no mesmo nível — colisão de escrita paralela achada pelo `soma spec-lint` em 2026-08-16, o mesmo motivo pelo qual a T-13 já não é `[P]`. T-15 entra primeiro porque é da wave anterior. Integration test `// @spec AC-07` | [SPEC:AC-07] | `hooks/framework-guard.cjs`, `install/soma-hooks-map.json`, `hooks/__tests__/framework-guard.test.cjs` | T-05, T-15 | DONE |
| T-13 | Override do guard por marker de sessão — `{os.tmpdir()}/claude-framework-guard-bypass-{sessionId}.marker`, `sessionId` de env var, e o override **sempre declarado na stderr**. Integration test `// @spec AC-13` com `TMPDIR` alterado. **Não é `[P]`**: mesmo hook e mesmo arquivo de teste que T-12, então roda na wave seguinte | [SPEC:AC-13] | `hooks/framework-guard.cjs`, `hooks/__tests__/framework-guard.test.cjs` | T-12 | DONE (dobrada na T-12) |
| T-14 | `[P]` Modo legado — projeto sem `.soma/` roda pelo caminho anterior com warning nomeando o degradado, sem erro fatal. Consome a detecção de `run/paths.cjs` criada em T-01, sem editá-la. Integration test `// @spec AC-08` | [SPEC:AC-08] | `core/scripts/run/legacy.cjs`, `core/scripts/__tests__/run-legacy-mode.test.cjs` | T-03 | DONE |
| T-15 | `[P]` **Ressuscitar o traceability** — `soma-run.md:232` invoca script Node com `bash` e o hook não está registrado em lugar nenhum. Corrigir o interpretador, registrar `spec-test-traceability.cjs` no `install/soma-hooks-map.json`, e provar por teste que ele **executa** e emite o payload (`coverage`, `orphan_tests`, `uncovered_ac`, `red_phase_evidence`). Integration test `// @spec AC-09`. **+ AC-10, o outro lado**: com o hook renomeado/ausente, com o interpretador errado, e com exit inesperado, o `STEP_5_VALIDATE` SHALL resultar em REJECT com a causa da não-execução no report — **nunca** em pass silencioso. Os dois lados são obrigatórios: só o AC-09 passaria num sistema que ignora falha de invocação | [SPEC:AC-09] [SPEC:AC-10] | `hooks/spec-test-traceability.cjs`, `install/soma-hooks-map.json`, `core/adapters/claude/commands/soma-run.md`, `hooks/__tests__/spec-test-traceability.test.cjs` | T-01 | DONE |
| T-16 | `[P]` Ignore seletivo — `.soma/reports/`, `.soma/dispatches/`, `.soma/run-state-*.json`, `.soma.lock` na seção "SOMA runtime artifacts" do `.gitignore`, **preservando `.soma/install-state.json` rastreado**. Integration test `// @spec AC-11` via `git check-ignore` | [SPEC:AC-11] | `.gitignore`, `core/scripts/__tests__/run-gitignore.test.cjs` | T-01 | DONE |
| T-17 | `[P]` Retenção de 7 dias — a mesma janela do state aplicada a reports e dispatches, varrida no `DONE`. Integration test `// @spec AC-12` manipulando mtime | [SPEC:AC-12] | `core/scripts/run/retention.cjs`, `core/scripts/__tests__/run-retention.test.cjs` | T-08 | DONE |

---

## Wave 3 — Integração + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-18 | `[WIRING]` Ligar o `soma-run.md` ao primitivo. **Âncoras nominais, não números de linha** — os números originais (`96-314`, `37-57`, `160/336`, `471`) derivaram todos quando a T-15 editou o arquivo, e o pior deles, `96-314`, **parava antes do `STEP_10_COMMIT`**, que emite report. Alvos: (a) os **12 blocos de step**, que são `## 1. STEP_1A_SPECIFY`, `## 2. STEP_1B_PLAN`, `## 3. STEP_1C_TASKS`, `## 5. STEP_2_TASKS`, `## 6. STEP_3_FOUNDATION`, `## 7. STEP_4_WAVES`, `## 8. STEP_5_VALIDATE`, `## 9. STEP_6_CONSOLIDATE`, `## 10. STEP_7_INTEGRATE`, `## 11. STEP_8_SONAR`, `## 12. STEP_9_FIX_LOOP`, `## 13. STEP_10_COMMIT` — cada um ganha "check gate" na entrada e "emit report" na saída; (b) `### 0.2 Novo run — criar state inicial` aponta para o state v2 em `.soma/`; (c) `## 4. AWAITING_SPEC_APPROVAL — GATE 1` e `## 14. AWAITING_DEPLOY_APPROVAL — GATE 2` **não mudam** (são os dois gates humanos, e é por isso que a ordem report-bearing os pula); (d) `## Gaps / deferred (canary Phase 4)` perde os itens que a fase cura. **Os 12 nomes acima são a mesma lista do `STEP_ORDER` de `gate.cjs` e `resume.cjs`** — mexer aqui quebra os dois em silêncio, ver a nota do `plan.md` | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] | `core/adapters/claude/commands/soma-run.md` | T-06, T-07, T-08, T-09 | DONE |
| T-19 | `[WIRING]` Smoke de ponta a ponta: run de laboratório que (a) tenta transicionar com prosa "done" e sem report → **bloqueia**; (b) é morto no meio e retomado por `soma run resume --run <runId>` de outra sessão → **continua do checkpoint** (a redação original dizia `--resume`, uma flag que **não existe** — a superfície fixada no `plan.md` é o verbo `resume`, e ele é o único que **exige** `--run`, porque retomar acontece de outra sessão e resolver pelo lock destruiria a propriedade que o teste verifica); (c) tenta commit em path protegido → **exit 2**; (d) tem run-dir diffável ao final. São os 4 critérios de "Fase 2 pronta" do §F | [SPEC:AC-02] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-07] | `core/scripts/__tests__/trilho-e2e.test.cjs` | T-18, T-10, T-12 | TODO |
| T-20 | `[WIRING]` **Poda obrigatória** (§B.10) — reescrever as instruções de transição do `soma-run.md` para "objetivo + invariantes", agora que report + state v2 carregam o determinismo. Meta: **≤300 linhas**. A de-prescription é só aqui e só nisso | [SPEC:AC-01] [SPEC:AC-02] | `core/adapters/claude/commands/soma-run.md` | T-18, T-19 | TODO |

---

## Cobertura de ACs

| AC | Tasks |
|---|---|
| AC-01 | T-01, T-06, T-18, T-20 |
| AC-02 | T-07, T-18, T-19, T-20 |
| AC-03 | T-01, T-08, T-18 |
| AC-04 | T-09, T-18, T-19 |
| AC-05 | T-10, T-19 |
| AC-06 | T-11 |
| AC-07 | T-12, T-19 |
| AC-08 | T-14 |
| AC-09 | T-15 |
| AC-10 | T-07 (report ilegível), T-15 (check externo não executável) |
| AC-11 | T-16 |
| AC-12 | T-17 |
| AC-13 | T-13 |

**13/13 ACs cobertos — 100%.** Nenhuma task órfã: T-01 é `[FOUNDATION]`, T-18/T-19/T-20 são `[WIRING]`, e todas as demais carregam `[SPEC:AC-XX]` ou `[CONTRACT:...]`.

---

## Nota de ordenação

T-15 (ressuscitar o traceability) depende só de T-01 e é **pré-requisito real do valor de T-11**: o invariante executor≠validador só significa alguma coisa se a validação que ele protege existir de fato. Hoje ela não roda. Se o apetite apertar, T-15 tem prioridade sobre T-11.

A poda (T-20) fecha a fase de propósito: podar antes de o smoke de ponta a ponta passar seria reescrever prosa sem saber ainda se o determinismo por trás dela funciona.
