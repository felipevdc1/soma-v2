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
5. **Zero dependência nova.** `package.json` continua com `dependencies: {}`.
6. **Baseline**: 1184 tests / 1176 pass / **5 fail** / 3 skip (`2929f50`). As 5 são pré-existentes e **não devem ser consertadas**. Fail novo é regressão.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | `[FOUNDATION]` Criar o esqueleto do primitivo `soma run`: `core/scripts/run.cjs` com dispatch de verbos (`state`, `report`, `gate`, `resume`, `dispatch-record`), registro no array `SUBCOMMANDS` de `core/scripts/soma.cjs`, e o validador de schema à mão (zero dep). RED: teste de que `soma run --help` lista os 5 verbos e que verbo desconhecido sai com exit ≠ 0 | [SPEC:AC-01] [SPEC:AC-03] | `core/scripts/run.cjs`, `core/scripts/soma.cjs`, `core/scripts/__tests__/run.test.cjs` | TODO |

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

*Article III: contract test antes de qualquer implementação que use o contrato.*

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | `[P]` Contract test de `contracts/emit-step-report.md` — os 6 casos do stub, incluindo os de **conteúdo** (status `fail` bloqueia pela razão certa; status fora do enum não vira pass; JSON corrompido é REJECT) | [CONTRACT:emit-step-report] | `core/scripts/__tests__/contract-step-report.test.cjs` | T-01 | TODO |
| T-03 | `[P]` Contract test de `contracts/persist-run-state.md` — superset v1.0→v2, escrita atômica, append-only, e a **regressão do consumidor**: `spec-completeness-gate` continua achando `specPath` após a migração | [CONTRACT:persist-run-state] | `core/scripts/__tests__/contract-run-state.test.cjs` | T-01 | TODO |
| T-04 | `[P]` Contract test de `contracts/emit-dispatch-record.md` — 3 arquivos materializados, `prompt.md` byte-a-byte, gravado antes do dispatch, `model` obrigatório, e os **dois lados** do invariante AC-06 (recusa quando igual, aceita quando diferente) | [CONTRACT:emit-dispatch-record] | `core/scripts/__tests__/contract-dispatch-record.test.cjs` | T-01 | TODO |
| T-05 | `[P]` Contract test de `contracts/framework-guard-hook.md` — repo git real, `sessionId` de env var, `TMPDIR` alterado, os **dois lados** (bloqueia protegido / libera não-protegido), e o teste de que o hook está registrado no `soma-hooks-map.json` | [CONTRACT:framework-guard-hook] | `hooks/__tests__/framework-guard.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementação (Step 4, Wave 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-06 | `[P]` `soma run report` — emite `.soma/reports/{runId}/{step}-report.json` validado contra `soma-step-report/v1`, atomicamente, antes de qualquer transição. Integration test `// @spec AC-01` | [SPEC:AC-01] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-report.test.cjs` | T-02 | TODO |
| T-07 | `[P]` `soma run gate` — exit 0 só com report presente, válido e `pass`; exit 2 em ausência, `fail`, `blocked`, inválido ou ilegível, sempre nomeando a causa. Integration test `// @spec AC-02` cobrindo os 5 caminhos de bloqueio | [SPEC:AC-02] [SPEC:AC-10] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-gate.test.cjs` | T-02 | TODO |
| T-08 | `[P]` `soma run state` — persiste `soma-state/v2` em `{projeto}/.soma/run-state-{runId}.json`, superset estrito do v1.0, escrita atômica preservada, `decisions[]`/`reports[]` append-only. Integration test `// @spec AC-03` | [SPEC:AC-03] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-state.test.cjs` | T-03 | TODO |
| T-09 | `[P]` `soma run resume --run {runId}` — retoma do último step com report `pass`, de sessão diferente, sem re-executar step concluído. Integration test `// @spec AC-04` que mata e retoma de fato | [SPEC:AC-04] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-resume.test.cjs` | T-03, T-06 | TODO |
| T-10 | `[P]` `soma run dispatch-record` — materializa `prompt.md` antes do dispatch, `output.md`+`metadata.json` no retorno, retentativa em `attempt-{n}` sem sobrescrever. Integration test `// @spec AC-05` | [SPEC:AC-05] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-dispatch-record.test.cjs` | T-04 | TODO |
| T-11 | `[P]` Invariante executor ≠ validador — `STEP_5_VALIDATE` lê `executor_agent` do `metadata.json` e recusa atribuição idêntica, registrando a recusa no report. Integration test `// @spec AC-06` nos dois sentidos | [SPEC:AC-06] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-validator-invariant.test.cjs` | T-04 | TODO |
| T-12 | `[P]` `hooks/framework-guard.cjs` — bloqueia `git commit` com staged em path protegido, exit 2 listando os ofensores; **+ entrada `PreToolUse`/`Bash` em `install/soma-hooks-map.json`** (sem o wiring o hook nunca dispara). Integration test `// @spec AC-07` | [SPEC:AC-07] | `hooks/framework-guard.cjs`, `install/soma-hooks-map.json`, `hooks/__tests__/framework-guard.test.cjs` | T-05 | TODO |
| T-13 | `[P]` Override do guard por marker de sessão — `{os.tmpdir()}/claude-framework-guard-bypass-{sessionId}.marker`, `sessionId` de env var, e o override **sempre declarado na stderr**. Integration test `// @spec AC-13` com `TMPDIR` alterado | [SPEC:AC-13] | `hooks/framework-guard.cjs`, `hooks/__tests__/framework-guard.test.cjs` | T-05 | TODO |
| T-14 | `[P]` Modo legado — projeto sem `.soma/` roda pelo caminho anterior com warning nomeando o degradado, sem erro fatal. Integration test `// @spec AC-08` | [SPEC:AC-08] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-legacy-mode.test.cjs` | T-03 | TODO |
| T-15 | `[P]` **Ressuscitar o traceability** — `soma-run.md:232` invoca script Node com `bash` e o hook não está registrado em lugar nenhum. Corrigir o interpretador, registrar `spec-test-traceability.cjs` no `install/soma-hooks-map.json`, e provar por teste que ele **executa** e emite o payload (`coverage`, `orphan_tests`, `uncovered_ac`, `red_phase_evidence`). Integration test `// @spec AC-09` | [SPEC:AC-09] | `hooks/spec-test-traceability.cjs`, `install/soma-hooks-map.json`, `core/adapters/claude/commands/soma-run.md`, `hooks/__tests__/spec-test-traceability.test.cjs` | T-01 | TODO |
| T-16 | `[P]` Ignore seletivo — `.soma/reports/`, `.soma/dispatches/`, `.soma/run-state-*.json`, `.soma.lock` na seção "SOMA runtime artifacts" do `.gitignore`, **preservando `.soma/install-state.json` rastreado**. Integration test `// @spec AC-11` via `git check-ignore` | [SPEC:AC-11] | `.gitignore`, `core/scripts/__tests__/run-gitignore.test.cjs` | T-01 | TODO |
| T-17 | `[P]` Retenção de 7 dias — a mesma janela do state aplicada a reports e dispatches, varrida no `DONE`. Integration test `// @spec AC-12` manipulando mtime | [SPEC:AC-12] | `core/scripts/run.cjs`, `core/scripts/__tests__/run-retention.test.cjs` | T-08 | TODO |

---

## Wave 3 — Integração + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-18 | `[WIRING]` Ligar o `soma-run.md` ao primitivo: cada bloco `## N. STEP_X` (linhas 96-314) ganha "check gate" na entrada e "emit report" na saída; §0.2 (37-57) aponta para o state v2 em `.soma/`; Gates 1 e 2 (160/336) **não mudam**; seção Gaps (471) perde os itens que a fase cura | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] | `core/adapters/claude/commands/soma-run.md` | T-06, T-07, T-08, T-09 | TODO |
| T-19 | `[WIRING]` Smoke de ponta a ponta: run de laboratório que (a) tenta transicionar com prosa "done" e sem report → **bloqueia**; (b) é morto no meio e retomado por `--resume` de outra sessão → **continua do checkpoint**; (c) tenta commit em path protegido → **exit 2**; (d) tem run-dir diffável ao final. São os 4 critérios de "Fase 2 pronta" do §F | [SPEC:AC-02] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-07] | `core/scripts/__tests__/trilho-e2e.test.cjs` | T-18, T-10, T-12 | TODO |
| T-20 | `[WIRING]` **Poda obrigatória** (§B.10) — reescrever as instruções de transição do `soma-run.md` para "objetivo + invariantes", agora que report + state v2 carregam o determinismo. Meta: **487 → ≤300 linhas**. A de-prescription é só aqui e só nisso | [SPEC:AC-01] [SPEC:AC-02] | `core/adapters/claude/commands/soma-run.md` | T-18, T-19 | TODO |

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
| AC-10 | T-07 |
| AC-11 | T-16 |
| AC-12 | T-17 |
| AC-13 | T-13 |

**13/13 ACs cobertos — 100%.** Nenhuma task órfã: T-01 é `[FOUNDATION]`, T-18/T-19/T-20 são `[WIRING]`, e todas as demais carregam `[SPEC:AC-XX]` ou `[CONTRACT:...]`.

---

## Nota de ordenação

T-15 (ressuscitar o traceability) depende só de T-01 e é **pré-requisito real do valor de T-11**: o invariante executor≠validador só significa alguma coisa se a validação que ele protege existir de fato. Hoje ela não roda. Se o apetite apertar, T-15 tem prioridade sobre T-11.

A poda (T-20) fecha a fase de propósito: podar antes de o smoke de ponta a ponta passar seria reescrever prosa sem saber ainda se o determinismo por trás dela funciona.
