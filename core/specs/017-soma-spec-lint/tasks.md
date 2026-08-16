# Tasks: soma spec-lint

**Feature ID:** 017-soma-spec-lint
**Spec:** `core/specs/017-soma-spec-lint/spec.md`
**Created:** 2026-08-16

---

## Conventions

- `[P]` — parallel-safe (sem sobreposição de arquivos com outras `[P]` da mesma wave)
- `[SPEC:AC-XX]` — link de rastreabilidade com o critério de aceitação
- `[CONTRACT:filename]` — link com o arquivo de contrato
- `[FOUNDATION]` — bloqueia todas as waves
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

**Regras de execução desta fase** (não são decorativas):

1. **TDD obrigatório** (Article II) — toda task de código nasce com RED provado em commit separado.
2. **Nenhum check entra com um lado só.** Um check cujo teste só prova sensibilidade está incompleto — ele acusa e você não sabe se acusa demais. Os dois corpora estão enumerados no contrato de cada check e são deliverable, não opcional.
3. **Filesystem real** (Article III) — fixtures são diretórios de spec reais em `os.tmpdir()`. Zero mock de `fs`.
4. **`os.tmpdir()` neste Mac não é `/tmp`.** Hardcodar `/tmp` faz o teste passar sem testar.
5. **Zero dependência nova.** As chaves `dependencies` e `devDependencies` não existem no `package.json` e não devem passar a existir.
6. **Baseline móvel.** As 5 falhas pré-existentes (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`) não devem ser consertadas. Meça a suíte antes e depois da sua task e reconcilie a diferença; nenhum fail NOVO fora dos seus.
7. **A superfície de CLI está fixada** em `plan.md` §"Superfície de CLI". Divergir no código e ajustar o documento depois é o defeito que esta fase existe para matar. Mudança de superfície acontece **no `plan.md` primeiro**.
8. **São dois checks, não três.** O `path-exists` foi cortado por medição em 2026-08-16 — razão registrada em `spec.md` §"O check que foi cortado". Não ressuscitar sem trazer evidência nova.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | `[FOUNDATION]` Exportar as primitivas de `hooks/spec-completeness-gate.cjs` — hoje o arquivo **não tem `module.exports`** (verificado em 2026-08-16), e por isso todo consumidor recopia `AC_LINE_RE`, `parseAcEntries`, `isEarsValid`, `parseCoveredAcs`, `countOpenClarificationMarkers`. Adicionar o export **sem alterar o comportamento do hook**: ele continua executável direto como PreToolUse. RED: um teste que importa o módulo e falha por `undefined` antes do fix, mais a regressão de que o hook segue bloqueando e liberando igual | [SPEC:AC-13] | `hooks/spec-completeness-gate.cjs`, `hooks/__tests__/spec-completeness-gate.test.cjs` | DONE |
| T-02 | `[FOUNDATION]` Esqueleto do `soma spec-lint`: dispatcher `core/scripts/spec-lint.cjs`, registro no array `SUBCOMMANDS` de `core/scripts/soma.cjs`, e os módulos compartilhados `lib/spec-lint/context.cjs` (carrega artefatos e parseia o `tasks.md` **por nome de coluna**), `lib/spec-lint/finding.cjs` (formata linha e rodapé) e `lib/spec-lint/registry.cjs` (lista os dois checks). Cria os dois `checks/*.cjs` como **stub que retorna zero achados**, para que o registry resolva desde já. RED: `soma spec-lint` sem argumento sai 2; `soma --help` lista `spec-lint`; um `<spec-dir>` válido sai 0 com rodapé | [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-14] | `core/scripts/spec-lint.cjs`, `core/scripts/soma.cjs`, `core/scripts/lib/spec-lint/context.cjs`, `core/scripts/lib/spec-lint/finding.cjs`, `core/scripts/lib/spec-lint/registry.cjs`, `core/scripts/lib/spec-lint/checks/cli-surface.cjs`, `core/scripts/lib/spec-lint/checks/parallel-collision.cjs`, `core/scripts/__tests__/spec-lint.test.cjs` | DONE |

> **Por que os checks nascem como stub na T-02:** as tasks de implementação da Wave 2 são `[P]`. Se cada uma tivesse que se registrar, todas escreveriam em `registry.cjs` — colisão que este próprio linter passaria a acusar. O registry nasce completo e cada task da Wave 2 é dona de exatamente um arquivo. **Depois da T-02, ninguém mais edita `registry.cjs` nem `spec-lint.cjs`.**

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

*Article III: contract test antes de qualquer implementação que use o contrato. Todos RED por design — os checks ainda são stub.*

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | `[P]` Contract test de `contracts/lint-output.md` — os 8 casos do stub, incluindo os de **conteúdo**: a mensagem nomeia o token ofensor (não a categoria), o path da saída é relativo ao `<spec-dir>` rodando de dois `cwd` diferentes, o rodapé sai mesmo com zero achados, e a ordem é byte-a-byte estável entre duas execuções | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-06] [CONTRACT:lint-output] | `core/scripts/__tests__/contract-lint-output.test.cjs`, `core/scripts/__tests__/fixtures/spec-lint/output/` | T-02 | DONE |
| T-04 | `[P]` Contract test de `contracts/check-cli-surface.md` — os **9 fixtures enumerados no contrato**, 4 ruins e 5 bons. Os dois que a primeira implementação tende a errar: menção em prosa ao nome do verbo **não** é invocação, e `plan.md` sem a cerca dá `skipped` com zero achados mesmo havendo divergência no texto | [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [CONTRACT:check-cli-surface] | `core/scripts/__tests__/contract-check-cli-surface.test.cjs`, `core/scripts/__tests__/fixtures/spec-lint/cli-surface/` | T-02 | DONE |
| T-05 | `[P]` Contract test de `contracts/check-parallel-collision.md` — os **9 fixtures enumerados**, 4 ruins e 5 bons, incluindo o **fixture de regressão**: o `tasks.md` com 8 tasks `[P]` no mesmo arquivo que fez o validador de 2026-08-15 reportar "0 conflitos" por ler o próprio `id` como dependência. Mais o caso de tabela **sem** coluna `depends_on`, que quebra parser por índice | [SPEC:AC-08] [SPEC:AC-09] [CONTRACT:check-parallel-collision] | `core/scripts/__tests__/contract-check-parallel.test.cjs`, `core/scripts/__tests__/fixtures/spec-lint/parallel/` | T-02 | DONE |

---

## Wave 2 — Implementação (Step 4, Wave 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-06 | `[P]` `checks/cli-surface.cjs` — parseia a cerca ` ```soma-cli-surface ` do `plan.md` conforme a gramática do contrato, varre as invocações dos artefatos e emite um achado **por divergência** (uma invocação com duas flags erradas produz dois achados). Opt-in estrito: sem cerca, `status: 'skipped'` com `reason`. **+ Endurecer os 5 testes de especificidade da T-04**: hoje eles asseram `status==='ran'` e `findings===[]`, o que prova que a cerca foi achada mas **não** que a fixture contém a invocação sob teste — `quickstart.md` vazio passaria igual. Acrescentar a cada um a pré-condição de conteúdo, no padrão que a T-05 já usa. **Depois de implementar, confirmar que os 5 continuam verdes pelo motivo certo, não pelo motivo do stub** | [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] | `core/scripts/lib/spec-lint/checks/cli-surface.cjs`, `core/scripts/__tests__/contract-check-cli-surface.test.cjs` | T-04 | DONE |
| T-07 | `[P]` `checks/parallel-collision.cjs` — consome `ctx.tasks` e aplica as 3 condições do contrato. A condição 3 é **fecho transitivo** do grafo `depends_on`, nos dois sentidos, e a task **não** é dependência de si mesma. Três `[P]` no mesmo arquivo produzem três achados, um por par | [SPEC:AC-08] [SPEC:AC-09] | `core/scripts/lib/spec-lint/checks/parallel-collision.cjs` | T-05 | DONE |

---

## Wave 3 — Prova (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-08 | Meta-teste do corpus: para **cada** módulo em `registry.cjs`, existe ao menos um fixture conhecido-ruim que produz achado **e** um conhecido-bom que produz zero. Um check que ganhe só um dos lados **falha a suíte**. É o AC-10, e é a diferença entre este linter e os 4 validadores ad hoc de 2026-08-15, que reportaram aprovação plausível estando errados. **+ Fechar o buraco de cobertura achado em 2026-08-16**: nenhum fixture exercita um **par que compartilha mais de um arquivo**, e é justamente onde o contrato era ambíguo. Criar `fixtures/spec-lint/parallel/10-pair-sharing-multiple-files/` e provar a regra corrigida — **um** achado para o par, com **todos** os arquivos compartilhados na mensagem, e nenhum não-compartilhado | [SPEC:AC-10] | `core/scripts/__tests__/spec-lint-selftest-corpus.test.cjs`, `core/scripts/__tests__/fixtures/spec-lint/parallel/10-pair-sharing-multiple-files/` | T-06, T-07 | DONE |
| T-09 | Prova de aceitação contra a 016, nos dois estados. **(a)** Estado histórico: materializar via `git worktree --detach` os artefatos em `626936b^`, injetar o info-string `soma-cli-surface` na cerca que **já existe** no `plan.md` histórico (linha 49), rodar o lint e exigir **exatamente 1 achado**: `parallel-collision: tasks.md:65: T-12 e T-15 são [P] no mesmo nível e escrevem em install/soma-hooks-map.json`, exit 1. ⚠️ **Medido em 2026-08-16, não suponha diferente**: o `cli-surface` devolve **zero** no estado histórico, e isso está correto — os defeitos que `9ba54b2` consertou eram passos **ausentes** no quickstart, não invocações divergentes. Ver `spec.md` AC-11, cuja redação anterior estava falsificada. **(b)** Estado corrigido: rodar contra a 016 no HEAD e exigir **zero** achados. Inclui a **única edição fora da 017**: adicionar o info-string `soma-cli-surface` à cerca do bloco que já existe no `plan.md` da 016, sem alterar uma linha do conteúdo (ver `plan.md` §"A única edição fora da 017") | [SPEC:AC-11] [SPEC:AC-12] | `core/scripts/__tests__/spec-lint-acceptance.test.cjs`, `core/specs/016-artifact-gated-trilho/plan.md` | T-06, T-07 | DONE |
| T-10 | Medir o **piso de ruído** rodando o lint contra as specs 001 a 015 e registrar o resultado por spec. O `spec.md` declara explicitamente que silêncio nessas 15 **não é promessa** — nunca foram varridas. `cli-surface` deve sair `pulado` em quase todas (medido: 1 dos 16 `plan.md` tem seção de superfície), então o dado real desta task é o do `parallel-collision`, que roda nos 15 `tasks.md`. Não corrige nada: mede e reporta | | `core/specs/017-soma-spec-lint/noise-floor.md` | T-09 | DONE |
| T-11 | Estreitar o `cli-surface` conforme **D-017-01** (só cerca com info-string ≠ `text` é varrida; crase inline é menção) e **D-017-02** (`--help`/`--version` não são verbos), ambas fixadas em `contracts/check-cli-surface.md` §Detecção. **Migrar as 4 fixtures ruins da T-04 de crase inline para cerca executável** — em crase elas deixam de disparar, e fixture ruim que não dispara é teste que mente. **Dois critérios objetivos, os dois obrigatórios**: (a) `soma spec-lint core/specs/017-soma-spec-lint` sai **0 achados**; (b) as 4 fixtures conhecido-ruim continuam disparando e os 12 testes do `contract-check-cli-surface.test.cjs` seguem verdes. Um sem o outro é ou cegueira ou ruído | [SPEC:AC-07] | `core/scripts/lib/spec-lint/checks/cli-surface.cjs`, `core/scripts/__tests__/contract-check-cli-surface.test.cjs`, `core/scripts/__tests__/fixtures/spec-lint/cli-surface/` | T-06 | DONE |
| T-12 | `cli-surface` acusa flag ausente que **está presente na linha seguinte**: uma invocação de shell continuada por `\` é **um** comando, e `collectCandidateLines()` trata cada linha física da cerca como candidato isolado. Medido em 2026-08-16 no `quickstart.md` da 016 (linhas 126-127): `'run dispatch-record end' exige --output-file, ausente aqui` — e a flag está na linha 127. **Juntar linhas continuadas por `\` antes de tokenizar.** Quickstart real usa `\` como norma, então isto encheria de falso-positivo exatamente os documentos que o linter deve checar — é a classe de defeito que matou o `path-exists`. **Corpus dos dois lados obrigatório**: fixture com invocação continuada **completa** (tem que calar) e fixture com invocação continuada **de fato incompleta** (tem que acusar). **Critério**: `soma spec-lint core/specs/016-artifact-gated-trilho`, com o info-string já injetado pela T-09, sai **0 achados** | [SPEC:AC-07] [SPEC:AC-12] | `core/scripts/lib/spec-lint/checks/cli-surface.cjs`, `core/scripts/__tests__/contract-check-cli-surface.test.cjs`, `core/scripts/__tests__/fixtures/spec-lint/cli-surface/` | T-11 | DONE |

---

## Cobertura de AC

Os 14 ACs da spec e a task que cobre cada um — enumerado, não contado:

| AC | Task | AC | Task |
|---|---|---|---|
| AC-01 | T-03 | AC-08 | T-05, T-07 |
| AC-02 | T-03 | AC-09 | T-05, T-07 |
| AC-03 | T-02 | AC-10 | T-08 |
| AC-04 | T-02 | AC-11 | T-09 |
| AC-05 | T-04, T-06 | AC-12 | T-09 |
| AC-06 | T-03, T-04, T-06 | AC-13 | T-01 |
| AC-07 | T-04, T-06 | AC-14 | T-02 |

A T-10 não referencia AC: ela mede, e o `spec.md` já declara no Out of Scope que o resultado dessa medição não é promessa desta versão.
