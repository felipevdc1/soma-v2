# Plan: Trilho V3 — Artifact-Gated Steps, Durable Run-State E Proveniência De Dispatch

**Feature ID:** 016-artifact-gated-trilho
**Spec:** `core/specs/016-artifact-gated-trilho/spec.md`
**Created:** 2026-08-15
**Status:** DRAFT

---

## Technical Approach

O `soma-run` é um **comando em prosa executado por um LLM**, não um programa. Essa é a razão pela qual os defeitos que a Fase 2 vem curar existem: as postconditions dos 13 steps estão escritas em texto e quem julga se passaram é um agente lendo o texto. Reescrever a prosa com mais rigor não resolve — foi tentado e apodreceu em silêncio em cinco lugares diferentes, todos encontrados nesta mesma sessão por execução, nenhum por leitura.

A abordagem, portanto, é **mover o julgamento de prosa para código**: um primitivo CLI novo, `soma run`, passa a ser o único lugar que emite report, persiste estado, decide se a transição é permitida e materializa a proveniência de dispatch. O `soma-run.md` deixa de *descrever como julgar* e passa a *invocar o juiz* — o que também é o que viabiliza a poda obrigatória de 487 → ≤300 linhas, porque a prosa que sai é exatamente a prosa que virou código.

Fluxo: cada step, ao concluir, chama `soma run report --step X --status pass|fail|blocked` → o CLI valida contra `soma-step-report/v1`, grava em `.soma/reports/{runId}/` e atualiza `reports[]` no run-state. Antes de entrar em qualquer step, o `soma-run` chama `soma run gate --step X` → o CLI lê o report do step anterior e responde com exit code: `0` libera, `2` bloqueia. A fronteira de integração é o **sistema de arquivos** (`.soma/`), e os consumidores são o próprio `soma-run`, o `/dispatch` do pipeline e o humano auditando depois. O `framework-guard.cjs` é um hook independente em `PreToolUse(Bash)`, sem acoplamento ao CLI.

**Stack:**
- Runtime: **Node 22** (`node --test`), igual ao resto do repo
- Framework: **nenhum** — `node:fs`, `node:path`, `node:child_process` diretos
- Storage: **arquivos JSON** em `{projeto}/.soma/`, escrita atômica `write tmp → mv` (padrão que o `soma-run.md` §0.2 já especifica)
- Test runner: `node --test`, via `npm test`

**Rationale:** o repo tem **zero dependências** hoje — o `package.json` **não possui as chaves `dependencies` nem `devDependencies`** (as 10 chaves presentes são `name`, `version`, `description`, `license`, `author`, `contributors`, `homepage`, `repository`, `engines`, `scripts`; verificado com `hasOwnProperty` em 2026-08-15). Essa propriedade é um ativo real para um framework que se instala em projetos alheios — introduzir a primeira dependência para validar JSON seria pagar caro por pouco. O validador de schema é escrito à mão e é pequeno por construção, porque os schemas são fechados e conhecidos (ver `contracts/`).

<!-- Correção de 2026-08-15, levantada pelo executor da T-01: a redação anterior dizia
     "`dependencies: {}` e `devDependencies: {}`", afirmando chaves vazias onde na verdade não há
     chave alguma. O erro veio do MÉTODO de verificação, não do fato: eu havia medido com
     `p.dependencies || {}`, e o fallback imprime `{}` tanto para vazio quanto para ausente.
     A conclusão (zero dependências) estava certa; a evidência citada, não. Vale como lembrete de
     que um fallback no comando de verificação fabrica o resultado que se espera ver. -->


---

## Architecture Decisions

| Decisão | Rationale | Alternativa rejeitada |
|---|---|---|
| **Enforcement em CLI, não em prosa** — novo `core/scripts/run.cjs` registrado em `SUBCOMMANDS` do `soma.cjs` | Prosa normativa não exercitada por teste apodrece em silêncio; medido 5× nesta sessão, incluindo enforcement do Article I morto desde sempre. Código com teste é a única forma de o gate falhar alto | Endurecer a redação das postconditions no `soma-run.md`. Rejeitado: é exatamente o que já existe e é o que falhou |
| **Validador de schema à mão** | Preserva a propriedade zero-dep do repo. Os 3 schemas são fechados, com ~12 campos no maior deles | `ajv`. Rejeitado: primeira dependência do projeto, ~30 transitivas, para validar 3 objetos de forma conhecida |
| **Gate como exit code, não como texto** — `soma run gate` responde `0`/`2` | Exit code é inambíguo e não depende de um agente interpretar prosa. É a mesma convenção dos 18 hooks do repo (2 = block) | Retornar JSON e deixar o orquestrador decidir. Rejeitado: reintroduz o julgamento fuzzy que a fase existe para eliminar |
| **`.soma/` com ignore seletivo** (AC-11) | `install-state.json` é artefato de bootstrap versionado, do qual o fluxo de install distribuído depende (`hydra`) | Ignorar `.soma/` inteiro, como o §F escreveu. Rejeitado por decisão do Felipe no Gate 1 |
| **Reaproveitar `soma-state/v1.0` como superset** (AC-03) | O v1.0 já tem 22 campos corretos (23 chaves com `$schema`) e escrita atômica especificada. `v2` acrescenta `decisions[]` e `reports[]` e muda o *local*, não a semântica | Schema novo do zero. Rejeitado: reimplementaria mecanismo existente — failure mode #9, que a discovery desta spec já pegou uma vez |
| **`framework-guard` separado do CLI** | Hook roda em `PreToolUse(Bash)`, ciclo de vida e contrato totalmente distintos do CLI. Acoplar criaria dependência sem AC que a exija | Um verbo `soma run guard`. Rejeitado: Anti-Abstraction — nenhum AC pede que o guard conheça o run |

---

## Superfície de CLI do `soma run` (fixada em 2026-08-15)

Esta seção existe porque o `quickstart.md` que eu mesmo escrevi ficou **inconsistente**: `report`, `state` e `resume` aparecem com `--run <runId>`, e `gate` aparece sem, nas 4 ocorrências. O executor da T-02 esbarrou nisso ao escrever o contract test, resolveu de forma defensável (gate resolve o run ativo via `.soma.lock`) e **sinalizou em vez de deixar a escolha enterrada no teste**. Fixado aqui para T-06 a T-11 implementarem contra a mesma forma.

**Regra geral: `--run <runId>` é opcional em todos os verbos.** Quando omitido, o run ativo é resolvido pelo `.soma.lock` da raiz do projeto (mecanismo **pré-existente**, `soma-run.md` §0.3, campos `{sessionId, runId, startedAt}` — não é invenção desta fase). Sem `--run` e sem lock legível → erro nomeando as duas formas de resolver. Isso reconcilia os testes de T-02 e T-04 sem que nenhum precise ser reescrito.

```
soma run state  --init --run <runId>
soma run report [--run <runId>] --step <STEP> --status pass|fail|blocked [--reason <texto>]
soma run gate   [--run <runId>] --step <STEP>
soma run gate   [--run <runId>] --validate <taskId> --validator <agentName>
soma run resume --run <runId>
soma run dispatch-record begin [--run <runId>] --task <taskId> [--attempt <n>] --prompt-file <path>
soma run dispatch-record end   [--run <runId>] --task <taskId> [--attempt <n>] --output-file <path> --metadata-file <path>
```

Notas que valem para quem implementa:

- **`resume` exige `--run` explícito.** É o único caso em que resolver pelo lock seria errado: retomar acontece de outra sessão, possivelmente com o lock apontando para outro run ou ausente. Pedir o `runId` é o que torna o AC-04 possível.
- **`gate --validate`** é a superfície de CLI do invariante AC-06 e apenas embrulha `run/validator-invariant.cjs`, que exporta `checkValidatorAssignment({ metadataPath, proposedValidator }) -> { allowed, reason }`. A T-04 testou o módulo; o `quickstart.md` §5 exercita a CLI. As duas formas existem e a CLI não duplica lógica.
- **`dispatch-record` tem duas fases** (`begin`/`end`) porque o artefato nasce em dois momentos: o prompt antes do dispatch, a saída depois. Detalhe completo em `contracts/emit-dispatch-record.md`.

Toda mudança nesta superfície acontece **aqui primeiro**. Divergir no código e ajustar o documento depois é como as duas ambiguidades acima nasceram.

---

## A restrição de design que veio da execução

O hotfix pré-voo desta fase produziu, no round 1, código que **passava em 100% dos testes escritos para ele e ainda assim estava errado**: o fixture pré-existente foi realinhado para caber na regra nova, e com isso o teste parou de fazer a pergunta que fazia antes. O buraco só apareceu quando a regra foi exercitada contra o que o `/specify` realmente produz.

Isso tem consequência direta para os ACs de report desta fase, e é normativo para as tasks:

> **Um report que valida contra o schema e descreve a coisa errada é falso-verde.** Nenhum AC de report é considerado coberto por um teste que apenas afirma conformidade estrutural. Todo teste de report precisa exercitar o **conteúdo**: um step que falhou tem que produzir report com `status: "fail"`, e o gate tem que bloquear **por causa daquele conteúdo** — não por ausência de arquivo.

O corolário está no AC-10 e vale para todo check desta fase: **impossibilidade de executar é REJECT, nunca pass.**

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 2 componentes novos (`core/scripts/run.cjs` + `hooks/framework-guard.cjs`). ≤3 (Article VII)
- [x] **Anti-Abstraction Gate** — `node:fs`/`node:path` diretos, zero wrapper, zero dependência nova (Article VII)
- [x] **Integration-First Gate** — testes usam filesystem real em diretórios temporários e repositórios git reais para o hook; nenhum mock de `fs` ou de `child_process` (Article III)

Os três passam. **Complexity Tracking fica vazio** — não há violação a justificar.

---

## Complexity Tracking

Nenhum gate violado. Seção intencionalmente vazia.

---

## Dependencies

Nenhuma nova. A feature usa exclusivamente built-ins do Node 22:

- `node:fs` — leitura/escrita atômica dos artefatos em `.soma/`
- `node:path` — resolução de paths de projeto
- `node:child_process` — `git diff --cached --name-only` no `framework-guard`
- `node:os` — `os.tmpdir()` para o marker de bypass ⚠️ **nunca hardcodar `/tmp`**: neste Mac `os.tmpdir()` não é `/tmp`, e errar isso já produziu falso-verde duas vezes na sessão de 2026-08-14/15

**Preservar**: `package.json` com `dependencies: {}` e `devDependencies: {}`. Qualquer PR desta fase que introduza dependência viola esta decisão de arquitetura.

---

## Anchors verificados (2026-08-15)

Referentes a `core/adapters/claude/commands/soma-run.md` **no repo** (487 linhas — o lado canônico; o live tem 474 e está desatualizado):

| Alvo | Linha | O que muda |
|---|---|---|
| State schema `soma-state/v1.0` inline (§0.2) | 37-57 | Vira `v2`, migra de `/tmp` para `{projeto}/.soma/` |
| Blocos `## N. STEP_X` | 96 a 314 | Cada um ganha "check gate" na entrada e "emit report" na saída |
| Gates humanos 1 e 2 | 160 / 336 | **Não mudam** — seguem markers em `/tmp` (NO-GO da spec) |
| Seção `## Gaps / deferred` | 471 | Remover os itens que esta fase cura |
| Check de traceability morto | 232 | `bash` num script Node + hook não registrado → AC-09/AC-10 |
| Re-run do traceability | 319 | Mesmo caminho morto, mesma cura |

Hook novo: arquivo em `hooks/` **+ entrada `PreToolUse(Bash)` em `install/soma-hooks-map.json`**. Sem a entrada, o hook é copiado e nunca dispara — foi exatamente assim que o `spec-test-traceability.cjs` ficou morto.

---

## Baseline a preservar

**1184 tests / 1176 pass / 5 fail / 3 skip** (medido em `2929f50`). As 5 falhas são pré-existentes e conhecidas: `doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`. **Não consertar** — NO-GO da spec. Qualquer fail novo é regressão desta fase.

---

## References

- Contracts: `contracts/` — 4 contratos, todos de artefato em filesystem
- Quickstart: `quickstart.md`
- Spec: `spec.md` (13 ACs, APPROVED no Gate 1 em 2026-08-15)
- Plano da fase: `~/Documents/- forge/framework/09-plano-execucao-soma-v3.md` §F
- Constitution: `~/.claude/constitution.md` Articles I, III, VI, VII, X
