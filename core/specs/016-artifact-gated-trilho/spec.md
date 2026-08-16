# Spec: Trilho V3 — Artifact-Gated Steps, Durable Run-State E Proveniência De Dispatch

**Feature ID:** 016-artifact-gated-trilho
**Branch:** `feature/016-artifact-gated-trilho`
**Created:** 2026-08-15
**Status:** APPROVED
**Gate 1:** aprovado por Felipe em 2026-08-15, sem cortes de escopo. As três decisões que moldaram AC-11/12/13 foram tomadas por ele na mesma sessão (ver tabela em Open Questions).

**Origem:** Fase 2 do `~/Documents/- forge/framework/09-plano-execucao-soma-v3.md` §F (D4, D7, D15, D16, D17), re-verificado em 2026-08-15 sob a regra §B.9.
**Decisões que moldam esta spec:** `D-F2-01` (proveniência mora no pipeline do `soma-run`, não no command `/dispatch`) e a resolução de escopo de 2026-08-15 (AC-03/AC-04 como delta; defeito do traceability adotado como AC-09/AC-10).

---

## Discovery — estado empírico antes de especificar

<!-- Article XII / Failure Mode #9. Fonte lida integralmente: core/adapters/claude/commands/soma-run.md (487 linhas). -->

**Já existe e NÃO deve ser reimplementado:**

| Mecanismo | Onde | Estado |
|---|---|---|
| Run-state com schema versionado | `soma-run.md` §0.2, linhas 47-67 | `soma-state/v1.0`, 22 campos (23 chaves com `$schema`), **escrita atômica já especificada** (`write tmp → mv`). Já tem `snapshots[]`, `activeDispatchIds[]`, `failureCountsByStep{}`, `lastSuccessfulState` |
| Retomada de run | `soma-run.md` §0.1, linhas 40-43 | Detecta state ativo e pergunta "Resumir ou iniciar nova?". **Mas**: chaveado por `sessionId`, mora em `/tmp`, sem flag `--resume`, sem noção de "último step com prova" |
| Arquivamento de state antigo | `soma-run.md` linha 43 | `/tmp/soma-state-{sessionId}-{runId}.archive.json` |
| Postconditions por step | `soma-run.md`, todos os 13 blocos `## N. STEP_X` | Existem **em prosa**, avaliadas por leitura fuzzy do agente. O conteúdo semântico do report já está escrito — falta virar artefato |
| Lock multi-sessão | `soma-run.md` §0.3 | `.soma.lock` com `{sessionId, runId, startedAt}` |
| Snapshot-lock da Constitution | `soma-run.md` linha 85 | Copia para `/tmp/soma-constitution-{runId}.md`, guarda hash+path no state |

**Greenfield confirmado:** report.json entre steps (AC-01/02) · run-dir de dispatch (AC-05) · invariante executor≠validador (AC-06) · hook `framework-guard` (AC-07) · `.soma/` no `.gitignore` (AC-03).

**Defeito não previsto pelo plano, encontrado na discovery:** o primeiro check do `STEP_5_VALIDATE` (`soma-run.md:232`) invoca `bash ~/.claude/hooks/spec-test-traceability.cjs validate {specPath}`. O arquivo é um script Node (`'use strict'; require('node:fs')`) — `bash` quebra na primeira linha — e o hook **não está registrado nem em `install/soma-hooks-map.json` nem em `~/.claude/settings.json`** (grep = 0 em ambos). O `STEP_10_COMMIT:319` reusa o mesmo caminho morto. Efeito: a checagem de traceability AC↔teste dentro do run, que é o enforcement do Article I, nunca rodou; o `/quality-check` seguinte mascarou o buraco porque um agente lendo prosa reporta "validado". Adotado nesta spec como AC-09 + AC-10.

**Hipótese descartada por evidência:** suspeitei que a regex `^### AC-\d+:` de `soma-run.md:107` estivesse defasada pelo EARS da Fase 1. Não está — o template oficial usa a forma heading e a regex casa.

---

## User Stories

- Como **Felipe operando um run do SOMA**, quero que cada step só avance com um arquivo de prova, pra que "pronto" pare de ser uma afirmação do agente e passe a ser um fato verificável.
- Como **Felipe com a sessão morta no meio de um run longo**, quero retomar com `/soma-run --resume {runId}` do ponto exato onde parou, pra não re-executar horas de trabalho já concluído nem perder o run porque o `/tmp` foi limpo.
- Como **Felipe auditando um run depois do fato**, quero abrir o diretório do run e ver o prompt, a saída e os metadados de cada dispatch, pra conseguir diffar o que foi pedido contra o que voltou sem depender do meu scrollback.
- Como **mantenedor do framework**, quero que arquivos de infraestrutura do SOMA não sejam commitados por acidente por um subagente, pra que um run de feature não altere as próprias regras que o governam.

---

## Outcome & Guardrails

**OUTCOME** — como o usuário SABE que deu certo, em comportamento observável:

Felipe mata a sessão no meio do STEP_6, abre o terminal no dia seguinte, roda `/soma-run --resume {runId}` e o run continua do checkpoint sem repetir nada. E quando um agente escreve "task concluída com sucesso" sem deixar report, o SOMA **para** em vez de seguir — visível na tela como bloqueio, não como aviso.

**APPETITE** — quanto vale investir nisto:

~1 semana com waves (orçamento do §F). Se estourar, **corta escopo pelos NO-GOS e pelo Out of Scope, não estende o prazo** — a Fase 3 depende desta fechar.

**NO-GOS** — o que esta feature explicitamente NÃO vai fazer:

- **Não migra os gates humanos** (Gate 1 linha 160, Gate 2 linha 336) para artefato. Continuam markers em `/tmp` — humano é humano, e o §F trava isso.
- **Não toca o command `/dispatch`** do `~/.claude/commands/` (`D-F2-01`). Ele é live-only e fora do escopo SOMA.
- **Não implementa pass^k, grader fresco ou anti-tampering** — isso é Fase 3 / spec 017.
- **Não conserta as 5 falhas de teste pré-existentes** (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`). Baseline a preservar: **1184 tests / 1176 pass / 5 fail / 3 skip** (medido em `2929f50`, após o hotfix pré-voo — eram 1173/1165 no `d4193f2`).

---

## Acceptance Criteria

### AC-01: WHEN um step do soma-run conclui, the soma-run SHALL gravar `.soma/reports/{runId}/{step}-report.json` validável contra o schema `soma-step-report/v1` antes de executar a transição

Given um run ativo no `STEP_3_FOUNDATION` / When o step conclui suas postconditions / Then existe em disco `.soma/reports/{runId}/STEP_3_FOUNDATION-report.json` que valida contra o schema, e só depois o `currentState` muda.

### AC-02: IF o report do step anterior não existe ou tem `status` diferente de `"pass"`, THEN the soma-run SHALL bloquear a transição e entrar em `PAUSED_DIAGNOSTIC`

Given um agente que retornou "task concluída, tudo verde" em prosa mas nenhum report foi gravado / When o soma-run tenta transicionar para o próximo step / Then a transição não acontece, o estado vira `PAUSED_DIAGNOSTIC`, e a mensagem ao usuário nomeia qual report está faltando.

### AC-03: WHEN um run inicia, the soma-run SHALL persistir o run-state em `{projeto}/.soma/run-state-{runId}.json` sob o schema `soma-state/v2` — superset de `v1.0` acrescido de `decisions[]` e `reports[]` — preservando a escrita atômica já existente

Given um projeto sem run anterior / When um run novo inicia / Then o state vive dentro do projeto (não em `/tmp`), todo campo do `v1.0` continua presente e com o mesmo significado, e os dois campos novos existem.

### AC-11: The soma-run SHALL manter os artefatos de runtime fora do controle de versão por ignore seletivo — `.soma/reports/`, `.soma/dispatches/`, `.soma/run-state-*.json` e `.soma.lock` — preservando `.soma/install-state.json` rastreado

Given um run que já emitiu reports e dispatches num projeto bootstrapado / When se roda `git status` / Then nenhum artefato de runtime aparece como untracked **e** `.soma/install-state.json` continua sob controle de versão.

<!-- Resolvido por Felipe em 2026-08-15. O §F dizia "com .soma/ no .gitignore por default", o que
     tiraria o install-state.json do git — e o hydra depende dele para o fluxo de install distribuído
     (`.soma/install-state.json`, ver §C do plano 09). Ignore seletivo em vez de ignore do diretório. -->

### AC-12: WHEN um run atinge o estado `DONE`, the soma-run SHALL aplicar aos artefatos de dispatch a mesma janela de retenção de 7 dias já praticada para o state file

Given um run concluído com dispatches em disco / When passam mais de 7 dias / Then os run-dirs daquele run são elegíveis a limpeza pelo mesmo mecanismo que hoje trata o state file, sem regra de retenção paralela.

<!-- Resolvido por Felipe em 2026-08-15. Uma janela só: o §16 (DONE) já diz "mantenha state file
     por 7 dias"; os dispatches herdam a mesma, em vez de criar política própria. -->

### AC-04: WHEN o usuário invoca `/soma-run --resume {runId}`, the soma-run SHALL retomar a partir do último step com report `"pass"` sem re-executar steps já concluídos e sem depender do `sessionId` da sessão original

Given um run interrompido no STEP_6 com reports `pass` dos steps 1A a 5, em uma sessão do Claude Code que já foi encerrada / When o usuário roda `/soma-run --resume {runId}` numa sessão nova / Then o run reentra no STEP_6, os reports anteriores são reconhecidos, e nenhum step com report `pass` é re-executado.

### AC-05: WHEN um step do soma-run despacha um agente, the soma-run SHALL materializar `.soma/dispatches/{runId}/{taskId}/` contendo `prompt.md`, `output.md` e `metadata.json` antes de registrar o resultado da task

Given o `STEP_4_WAVES` despachando `T-03` / When o agente retorna / Then existe `.soma/dispatches/{runId}/T-03/` com os três arquivos, e o `metadata.json` traz modelo usado, SHA base, timestamps de início/fim e os `AC` referenciados.

<!-- Reescrito por D-F2-01. O §F original dizia "WHEN /dispatch despacha" — mas `/dispatch` é live-only
     e fora do escopo SOMA, e `runId` só existe dentro de um run. Steps que despacham: STEP_3_FOUNDATION,
     STEP_4_WAVES, STEP_7_INTEGRATE, STEP_9_FIX_LOOP. -->

### AC-06: IF o agente designado para validar uma task é o mesmo que a executou, THEN the soma-run SHALL rejeitar a atribuição

Given uma task `T-05` executada pelo agente `soma-{slug}-T-05` / When o `STEP_5_VALIDATE` monta a validação dessa task / Then a atribuição do mesmo agente como validador é recusada com motivo explícito, e a recusa aparece no report do step.

### AC-07: IF um `git commit` inclui arquivo staged casando um path protegido sem override explícito, THEN the framework-guard SHALL bloquear com exit 2 listando os paths ofensores

Given um subagente com `hooks/thermal-guard.cjs` staged e nenhum override presente / When ele tenta `git commit` / Then o commit é bloqueado com exit 2 e a saída lista o path bloqueado.

### AC-13: WHERE existe o marker de bypass da sessão corrente no diretório temporário do sistema, the framework-guard SHALL permitir o commit em path protegido e SHALL registrar o override na sua saída

Given o marker de bypass da sessão presente / When um commit toca `hooks/**` / Then o commit passa e a saída declara explicitamente que um override foi aplicado — o desbloqueio nunca é silencioso.

<!-- Resolvido por Felipe em 2026-08-15: o override é marker file por sessão, seguindo a convenção
     que agent-mode-gate, cognitive-gate e os demais hooks do SOMA já usam
     (`{tmpdir}/claude-{hook}-bypass-{sessionId}.marker`). Zero mecanismo novo.

     ⚠️ TRAP CONHECIDA, herdada do handoff-forge — quem implementar precisa saber, senão o teste
     manual dá falso-verde (aconteceu duas vezes na sessão de 2026-08-14/15):
       1. Os hooks do SOMA leem o sessionId de VARIÁVEL DE AMBIENTE (`CK_SESSION_ID` /
          `CLAUDE_SESSION_ID`), NÃO do stdin.
       2. `os.tmpdir()` neste Mac NÃO é `/tmp`. Nunca hardcode `/tmp` no teste nem no hook. -->

<!-- Nota de escopo (Felipe, 2026-08-15): o guard fica ATIVO também dentro do soma-v2. A opção de
     desligá-lo no repo do próprio framework foi descartada — deixaria justamente o repo mais
     sensível sem proteção. O atrito do desenvolvimento de infra se resolve pelo marker. -->

<!-- Paths protegidos default (do §F): hooks/**, core/scripts/**, constitution*, install/** -->


### AC-08: WHERE o projeto não possui diretório `.soma/`, the soma-run SHALL executar em modo legado emitindo warning em vez de falhar

Given um projeto pré-v3 sem `.soma/` / When um run inicia / Then o run executa pelo caminho anterior, um warning nomeia o que está degradado, e nenhum erro fatal ocorre.

### AC-09: WHEN o `STEP_5_VALIDATE` avalia um merge candidato, the soma-run SHALL obter um veredito de traceability AC↔teste efetivamente executado, com exit code e payload estruturado (`coverage`, `orphan_tests`, `uncovered_ac`, `red_phase_evidence`)

Given um merge candidato com um AC sem teste correspondente / When o `STEP_5_VALIDATE` roda / Then o veredito de traceability é REJECT com o AC descoberto nomeado no payload — e não um "validado" derivado de leitura de prosa.

### AC-10: IF qualquer check externo do `STEP_5_VALIDATE` não puder ser executado — binário ausente, hook não registrado, interpretador errado, exit inesperado —, THEN the soma-run SHALL tratar o resultado como REJECT e registrar a causa da não-execução no report, nunca como pass

Given o hook de traceability removido ou desregistrado / When o `STEP_5_VALIDATE` tenta invocá-lo / Then o step resulta em REJECT com causa `"check não executável: {motivo}"` no report, e o run não avança silenciosamente.

<!-- AC-09 e AC-10 nascem do defeito encontrado na discovery (soma-run.md:232 + :319). AC-10 é o
     invariante generalizável: a lição da Meta Note do handoff é que enforcement não-exercitado
     apodrece em silêncio. Aqui o silêncio vira REJECT. -->

---

## Non-Functional Requirements

- **Performance:** a emissão de report + persistência de state não pode adicionar mais que ~200ms por transição de step (é I/O local de arquivos pequenos). Um `--resume` de run com 13 steps deve reconstituir o estado em < 5s sem invocar LLM.
- **Security:** `.soma/` cobre `run-state`, `reports/` e `dispatches/` e fica fora do git por default — `prompt.md`/`output.md` podem conter trechos do repo e não devem vazar em commit. O `framework-guard` não pode ser desabilitável por variável de ambiente silenciosa; qualquer override precisa ser explícito e visível na saída do bloqueio.
- **Test style:** `node --test` com filesystem real em diretórios temporários (sem mock de `fs`), coerente com Article III (integration-first) e com as 162 suítes existentes. Todo AC precisa de teste referenciado por `[SPEC:AC-XX]` em `tasks.md` e `// @spec AC-XX` no teste. Hook novo exige teste de hook no padrão das 6 suítes trazidas pro repo na Fase 0.
- **Monitoring:** toda transição bloqueada por AC-02 e todo REJECT por AC-10 são eventos append no log JSONL do run, com o motivo estruturado (não texto livre).
- **Compatibilidade:** o baseline de testes a preservar é **1173 tests / 1165 pass / 5 fail / 3 skip**. Qualquer novo fail é regressão desta spec, não pré-existente.

---

## Out of Scope

- O command `/dispatch` em `~/.claude/commands/` — live-only, fora do escopo SOMA (`D-F2-01`).
- Migração dos gates humanos (Gate 1/Gate 2) de markers `/tmp` para artefato — travado pelo §F.
- `pass^k`, grader fresco e anti-tampering de teste — Fase 3, spec 017.
- Runs concorrentes multi-sessão no mesmo repo — gap conhecido de v1, segue mitigado por `.soma.lock`.
- Adapters de execução de deploy — gap conhecido, o usuário segue confirmando por marker.
- As 5 falhas de teste pré-existentes.
- A poda do `soma-run.md` (487 → ≤300 linhas) é **obrigação da fase**, mas é trabalho de reescrita de prosa cobrado no Gate 2 — não é AC desta spec e não deve virar task de código.

---

## Open Questions

Nenhuma em aberto. As três ambiguidades levantadas na redação foram resolvidas por Felipe em 2026-08-15 e estão registradas nos ACs correspondentes:

| Questão | Resolução | Onde ficou |
|---|---|---|
| `.soma/` no `.gitignore` tiraria o `install-state.json` do git | Ignore **seletivo** dos artefatos de runtime; install-state permanece rastreado | AC-11 (complementa AC-03) |
| Retenção dos run-dirs de dispatch | Mesma janela de **7 dias** já usada para o state file — uma regra só | AC-12 (complementa AC-05) |
| Forma do override do `framework-guard` num repo que é o próprio framework | **Marker file por sessão**, convenção dos demais hooks. Guard fica ativo também dentro do soma-v2 | AC-13 (complementa AC-07) |

> **Nota de numeração:** os três nasceram como `AC-03b`/`AC-03c`/`AC-07b` e foram renumerados para inteiros. Motivo verificado empiricamente: o `AC_LINE_RE` do `spec-completeness-gate` é `/^\s*#{0,6}\s*-?\s*\*{0,2}(AC-\d+)\*{0,2}:\*{0,2}/` e **não casa sufixo de letra** — os três seriam invisíveis para o EARS-lint e para o coverage check, e a tag `[SPEC:AC-03b]` também não casa `/\[SPEC:(AC-\d+)\]/`. Ficariam sem enforcement nenhum, em silêncio. **IDs de AC neste projeto são inteiros, sem sufixo.**

---

## Pré-requisito de execução (fora desta spec)

O `spec-completeness-gate` conta markers `[NEEDS CLARIFICATION` sobre o arquivo inteiro, incluindo comentários HTML e código inline. Como o template oficial carrega a string literal em 5 posições de guidance, **toda spec nasce com markers fantasma** — 13 das 15 specs já commitadas têm de 1 a 3. O `STEP_1A_SPECIFY` do `soma-run.md` usa a mesma contagem e ficaria em loop infinito em `AWAITING_HUMAN_CLARIFICATION`, e o `STEP_10_COMMIT` bloquearia o commit para sempre.

Isso **impede o `/soma-run` de executar esta spec**, então foi tratado como hotfix pré-voo (TDD, commit próprio em `main`), fora do escopo dos ACs acima. Não é dívida diferida: é pré-condição do veículo.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero markers de esclarecimento em aberto (as 3 questões foram respondidas — ver tabela acima)
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry
- [x] Feature ID + Branch filled in
- [x] OUTCOME/APPETITE/NO-GOS preenchidos
