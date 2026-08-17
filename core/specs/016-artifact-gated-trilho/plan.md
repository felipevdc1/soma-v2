# Plan: Trilho V3 — Artifact-Gated Steps, Durable Run-State E Proveniência De Dispatch

**Feature ID:** 016-artifact-gated-trilho
**Spec:** `core/specs/016-artifact-gated-trilho/spec.md`
**Created:** 2026-08-15
**Status:** DRAFT

---

## Technical Approach

O `soma-run` é um **comando em prosa executado por um LLM**, não um programa. Essa é a razão pela qual os defeitos que a Fase 2 vem curar existem: as postconditions dos 13 steps estão escritas em texto e quem julga se passaram é um agente lendo o texto. Reescrever a prosa com mais rigor não resolve — foi tentado e apodreceu em silêncio em cinco lugares diferentes, todos encontrados nesta mesma sessão por execução, nenhum por leitura.

A abordagem, portanto, é **mover o julgamento de prosa para código**: um primitivo CLI novo, `soma run`, passa a ser o único lugar que emite report, persiste estado, decide se a transição é permitida e materializa a proveniência de dispatch. O `soma-run.md` deixa de *descrever como julgar* e passa a *invocar o juiz* — o que também é o que viabiliza a poda obrigatória de ≤300 linhas, porque a prosa que sai é exatamente a prosa que virou código.

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
| **Validador de schema à mão** | Preserva a propriedade zero-dep do repo. Os 3 schemas são fechados, com 10 campos no maior deles | `ajv`. Rejeitado: primeira dependência do projeto, ~30 transitivas, para validar 3 objetos de forma conhecida |
| **Gate como exit code, não como texto** — `soma run gate` responde `0`/`2` | Exit code é inambíguo e não depende de um agente interpretar prosa. É a mesma convenção dos 18 hooks do repo (2 = block) | Retornar JSON e deixar o orquestrador decidir. Rejeitado: reintroduz o julgamento fuzzy que a fase existe para eliminar |
| **`.soma/` com ignore seletivo** (AC-11) | `install-state.json` é artefato de bootstrap versionado, do qual o fluxo de install distribuído depende (`hydra`) | Ignorar `.soma/` inteiro, como o §F escreveu. Rejeitado por decisão do Felipe no Gate 1 |
| **Reaproveitar `soma-state/v1.0` como superset** (AC-03) | O v1.0 já tem 22 campos corretos (23 chaves com `$schema`) e escrita atômica especificada. `v2` acrescenta `decisions[]` e `reports[]` e muda o *local*, não a semântica | Schema novo do zero. Rejeitado: reimplementaria mecanismo existente — failure mode #9, que a discovery desta spec já pegou uma vez |
| **`framework-guard` separado do CLI** | Hook roda em `PreToolUse(Bash)`, ciclo de vida e contrato totalmente distintos do CLI. Acoplar criaria dependência sem AC que a exija | Um verbo `soma run guard`. Rejeitado: Anti-Abstraction — nenhum AC pede que o guard conheça o run |

---

## Superfície de CLI do `soma run` (fixada em 2026-08-15)

Esta seção existe porque o `quickstart.md` que eu mesmo escrevi ficou **inconsistente**: `report`, `state` e `resume` aparecem com `--run <runId>`, e `gate` aparece sem, nas 4 ocorrências. O executor da T-02 esbarrou nisso ao escrever o contract test, resolveu de forma defensável (gate resolve o run ativo via `.soma.lock`) e **sinalizou em vez de deixar a escolha enterrada no teste**. Fixado aqui para T-06 a T-11 implementarem contra a mesma forma.

**Regra geral: `--run <runId>` é opcional em todos os verbos.** Quando omitido, o run ativo é resolvido pelo `.soma.lock` da raiz do projeto (mecanismo **pré-existente**, `soma-run.md` §0.3, campos `{sessionId, runId, startedAt}` — não é invenção desta fase). Sem `--run` e sem lock legível → erro nomeando as duas formas de resolver. Isso reconcilia os testes de T-02 e T-04 sem que nenhum precise ser reescrito.

```soma-cli-surface
soma run state  --init --run <runId>
soma run state  [--run <runId>] --set <STATE>
soma run report [--run <runId>] --step <STEP> --status pass|fail|blocked [--reason <texto>]
soma run gate   [--run <runId>] --step <STEP>
soma run gate   [--run <runId>] --validate <taskId> --validator <agentName>
soma run resume --run <runId>
soma run dispatch-record begin [--run <runId>] --task <taskId> [--attempt <n>] --prompt-file <path>
soma run dispatch-record end   [--run <runId>] --task <taskId> [--attempt <n>] --output-file <path> --metadata-file <path>
```

Notas que valem para quem implementa:

- **`state --set <STATE>`** acrescentado em 2026-08-15, terceira vez que o mesmo buraco aparece: **nenhum documento definia como um run chega a `DONE`**, e o AC-12 (retenção de 7 dias) é disparado justamente por isso. Foi descoberto tentando escrever o passo de validação manual do AC-12 no `quickstart.md` — o texto precisou de um verbo que não existia, e a primeira reação foi inventar um `--mark-done` no exemplo em vez de fechar a lacuna aqui. Isso é o defeito, não o conserto. `--set` é o mínimo que serve: a transição de estado já é a responsabilidade do verbo `state`.
- **`resume` exige `--run` explícito.** É o único caso em que resolver pelo lock seria errado: retomar acontece de outra sessão, possivelmente com o lock apontando para outro run ou ausente. Pedir o `runId` é o que torna o AC-04 possível.
- **`gate --validate`** é a superfície de CLI do invariante AC-06 e apenas embrulha `run/validator-invariant.cjs`, que exporta `checkValidatorAssignment({ metadataPath, proposedValidator }) -> { allowed, reason }`. A T-04 testou o módulo; o `quickstart.md` §5 exercita a CLI. As duas formas existem e a CLI não duplica lógica.
  - **Quem escreve o quê** (fechado em 2026-08-16, antes do dispatch da Wave 2, porque a nota acima dizia que o wrapper existe e **não** dizia de quem ele é — e contrato que descreve o artefato sem nomear quem o produz já fez dois executores inventarem respostas diferentes nesta mesma spec). **T-07 é dona de `run/gate.cjs` inteiro**, incluindo a rota `--validate`, que faz `require('./validator-invariant.cjs')` **preguiçoso** — só dentro do ramo `--validate`, nunca no topo do arquivo. Módulo ausente sai com erro legível nomeando a causa e exit `2`, **jamais** um stack de `MODULE_NOT_FOUND`; é o mesmo padrão do `VERB_NOT_IMPLEMENTED` que o `run.cjs` já usa, e existe pela mesma razão: a T-11 é de outra wave e a T-07 tem que rodar com o irmão faltando. **T-11 é dona apenas de `run/validator-invariant.cjs` e NÃO edita `gate.cjs`.** A T-07 testa o roteamento e o erro-de-ausência; a asserção de comportamento do invariante nos dois sentidos é da T-11, contra o módulo.
- **`dispatch-record` tem duas fases** (`begin`/`end`) porque o artefato nasce em dois momentos: o prompt antes do dispatch, a saída depois. Detalhe completo em `contracts/emit-dispatch-record.md`.
- **`run/retention.cjs` (T-17) é módulo com gatilho no `state --set DONE`** — fechado em 2026-08-17 antes do dispatch, pelo mesmo motivo da nota do `legacy.cjs`: `retention` não está no `VERBS` do `run.cjs` (que tem cinco e está fechado desde a T-01), então como verbo nunca seria roteado e como módulo sem chamador nasceria morto. O AC-12 nomeia o gatilho explicitamente — *"**WHEN** um run atinge o estado `DONE`"* — e o único lugar onde um run atinge `DONE` é `soma run state --set DONE`. Hoje o `state.cjs` **não trata `DONE` de forma alguma**: `--set` aceita qualquer string. Então a T-17 escreve `run/retention.cjs` **e liga o gatilho no `state.cjs`**, mesma licença cross-cutting que a T-14 teve. **Uma janela só** (contrato §Retenção): os mesmos 7 dias aplicados a state, reports **e** dispatches — não criar regra de retenção paralela.
- ⚠️ **`STEP_ORDER` está duplicado em `gate.cjs` e `resume.cjs`, e não tem fonte única — leitura obrigatória para T-18 e T-20.** A ordem dos steps não existe como dado em lugar nenhum: os dois verbos que precisam dela derivaram a lista **lendo os blocos `## N. STEP_X` do `soma-run.md`** e a hardcodaram. A executora da T-07 registrou isso quando escreveu a primeira cópia (*"se a ordem real dos steps mudar no `soma-run.md`, esse array precisa ser atualizado manualmente — não há fonte única de verdade hoje"*), e a T-09 fez a segunda pelo mesmo motivo. Detalhe que ninguém adivinharia: a ordem "report-bearing" **pula os dois gates humanos** (`AWAITING_SPEC_APPROVAL`, `AWAITING_DEPLOY_APPROVAL`), então o predecessor de `STEP_2_TASKS` é `STEP_1C_TASKS`, não o GATE 1 que fica estruturalmente entre eles. **Por que isto é normativo para T-18/T-20**: as duas reescrevem o `soma-run.md` — a T-20 até com meta de ≤300 linhas —, e renomear, reordenar ou fundir um bloco `## N. STEP_X` **quebra os dois arrays em silêncio**, sem nenhum teste acusando. Quem mexer nos blocos de step confere as duas cópias no mesmo commit, ou promove a ordem a dado único primeiro.
- **`run/legacy.cjs` (T-14) é módulo compartilhado, NÃO verbo** — fechado em 2026-08-17, antes do dispatch, porque a linha da T-14 no `tasks.md` não diz qual das duas coisas ele é e as duas leituras produzem resultados opostos. **Não é verbo**: o array `VERBS` do `run.cjs` tem cinco (`state`, `report`, `gate`, `resume`, `dispatch-record`) e o dispatcher está fechado desde a T-01 — um `legacy.cjs` criado como verbo nunca seria roteado, e um criado como módulo sem consumidor **nasceria morto**. O AC-08 diz *"the **soma-run** SHALL executar em modo legado"*, o run inteiro, não um verbo: então é helper que **todos** os verbos consomem. Estado herdado que a T-14 tem que absorver: o `state.cjs` já traz `warnIfLegacy` inline (consumindo `isLegacyProject` do `paths.cjs`), e `report.cjs`/`gate.cjs` **não tratam legado nenhum** — a cobertura do AC-08 hoje é parcial e silenciosa nos outros dois. A T-14 extrai o helper para `run/legacy.cjs`, remove o inline do `state.cjs` e liga os três. É cross-cutting por natureza, como o dedup do `.soma.lock` foi: a alternativa é três cópias ou dois verbos sem cobertura.

Toda mudança nesta superfície acontece **aqui primeiro**. Divergir no código e ajustar o documento depois é como as duas ambiguidades acima nasceram.

---

## A restrição de design que veio da execução

O hotfix pré-voo desta fase produziu, no round 1, código que **passava em 100% dos testes escritos para ele e ainda assim estava errado**: o fixture pré-existente foi realinhado para caber na regra nova, e com isso o teste parou de fazer a pergunta que fazia antes. O buraco só apareceu quando a regra foi exercitada contra o que o `/specify` realmente produz.

Isso tem consequência direta para os ACs de report desta fase, e é normativo para as tasks:

> **Um report que valida contra o schema e descreve a coisa errada é falso-verde.** Nenhum AC de report é considerado coberto por um teste que apenas afirma conformidade estrutural. Todo teste de report precisa exercitar o **conteúdo**: um step que falhou tem que produzir report com `status: "fail"`, e o gate tem que bloquear **por causa daquele conteúdo** — não por ausência de arquivo.

O corolário está no AC-10 e vale para todo check desta fase: **impossibilidade de executar é REJECT, nunca pass.**

### Teste-de-irmão-ausente: a segunda metade do RED-by-design (medido em 2026-08-17)

O contract test nasce **vermelho** e fica verde quando a implementação chega. Existe o espelho disso, e ele não estava documentado: um teste que prova *"o módulo irmão ainda não existe, e a falha é legível"* nasce **verde** e fica **obsoleto** pelo mesmo evento.

Aconteceu literalmente: a T-07 escreveu `run-gate.test.cjs` provando que o `require` preguiçoso de `validator-invariant.cjs` falhava com erro nomeado e nunca com stack de `MODULE_NOT_FOUND`. Quando a T-11 pousou o módulo, o `gate.cjs` passou a carregá-lo com sucesso e a falhar mais adiante — por metadata ausente. **Exit code continua `2`, comportamento continua certo, a asserção de string é que morreu.**

**O conserto proibido é relaxar a asserção para aceitar as duas mensagens.** Isso é exatamente o defeito descrito no parágrafo de abertura desta seção: o teste pararia de fazer a pergunta que fazia. Um teste que aceita "módulo ausente" **ou** "metadata ausente" não prova nenhuma das duas.

**O conserto certo preserva a pergunta**, e há duas formas legítimas:
1. **Asserir o invariante em vez da mensagem** — em qualquer caminho de falha do `--validate`, a stderr **nunca** contém stack cru nem `MODULE_NOT_FOUND`/`Cannot find module`, o exit é `2`, e a causa é nomeada. Isso é o que o teste sempre quis dizer, escrito de um jeito que não apodrece quando o irmão pousa.
2. **Fabricar a condição de ausência** num sandbox (cópia de `run/` sem o módulo), mantendo o teste original literal.

A (1) é preferível: sobrevive à chegada de qualquer irmão futuro. A (2) é aceitável se alguém quiser a literalidade.

**Regra geral que fica**: todo teste cuja asserção depende de um artefato **não existir** tem prazo de validade igual à wave que o cria. Quem escreve um assim deve, no mesmo commit, dizer qual task o invalida.

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

Referentes a `core/adapters/claude/commands/soma-run.md` **no repo** (492 linhas (em `2929f50`) — o lado canônico; o live tem 474 e está desatualizado):

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
