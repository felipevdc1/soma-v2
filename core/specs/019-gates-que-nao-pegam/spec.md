# Spec: Os gates que não pegam — três gates com régua medida

**Feature ID:** 019-gates-que-nao-pegam
**Branch:** `feature/019-gates-que-nao-pegam`
**Created:** 2026-08-19
**Reescopada:** 2026-08-22 (D-019-04 e D-019-05, ver §Questões resolvidas)
**Status:** APPROVED

> **Origem:** dois incidentes. (1) Sessão do projeto `hermes` em 2026-08-19: o orquestrador produziu 13
> defeitos próprios e, sobre artefatos que o **próprio validador do SOMA aprovou** com `100% cobertura ·
> 0 ACs órfãos · 0 violações de ordem`, três auditorias adversariais acharam 15 defeitos adicionais.
> (2) Fechamento da spec 018 (`merge 91c1b27`) e do Bucket G, em 2026-08-22.
>
> **Esta spec não é sobre o Hermes nem sobre a 018.** É sobre o que o SOMA deixou passar.
>
> ⚠️ **Esta spec foi reduzida de 15 ACs para 5 em 2026-08-22**, depois que ela mesma foi submetida à
> leitura adversarial que o antigo AC-04 propunha. O resultado está na §Auditoria adversarial. O critério
> do corte está na **D-019-05**: fica o que tem **régua medida**; sai o que só tem incidente narrado.

---

## §0 Superfície fixada

Toda afirmação abaixo carrega como foi obtida. Medições feitas em 2026-08-22 contra `origin/main` = `91c1b27`.

| valor | é | medido por |
|---|---|---|
| forma canônica de heading de AC, no hook | `/^\s*#{0,6}\s*-?\s*\*{0,2}(AC-\d+)\*{0,2}:/` | `core/hooks/spec-test-traceability.cjs:51` — `sed -n '51p'` |
| forma canônica de heading de AC, no comando | `^### AC-\d+:` | `core/adapters/claude/commands/soma-run.md:51` — `sed -n '51p'` |
| as duas formas **não** concordam entre si | fato | 8 candidatos testados; `- **AC-01:**` casa só no hook, `### AC-1:` casa nos dois |
| near-miss de heading em `spec.md`/`plan.md`/`tasks.md`/`contracts/` | **0**, nas 19 specs | grep ancorado em `^#{1,6}` menos a forma canônica |
| near-miss de heading em `quickstart.md` | **38**, todos convenção legítima | idem — ex.: `003/quickstart.md:25` `## AC-01 — H2 detects...` |
| blocos de comando em `tasks.md` | **0**, nas 19 specs | grep de cerca ` ```bash `/` ```sh `/` ```console ` |
| blocos de comando em `quickstart.md` · `plan.md` | **264** · **30** | idem |
| etiqueta real de condição de parada RED | `RED:` em texto livre na coluna `Description` | 4 ocorrências: `016/tasks.md:33`, `017/tasks.md:34`, `017/tasks.md:35`, `018/tasks.md:40` |
| a frase `parar se o teste passar` | **não existe** no repo | grep — 0 arquivos |
| ACs referenciados por task no repo | **219** | parser de tabela por nome de coluna |
| colunas que `context.cjs` **devolve** | `{id, parallel, files, dependsOn, specRefs, line}` | `core/scripts/lib/spec-lint/context.cjs:168-175` — **`Description` é lida e não devolvida** |
| `validateRedPhase` trata RED como | `status: 'verified'` = **bom** (Article II HARD) | `core/hooks/spec-test-traceability.cjs:196-215` |
| `spec.md` commitados em `core/specs/` | **19** | `git ls-files 'core/specs/*/spec.md' \| wc -l` |
| `spec-completeness-gate.cjs` é | `PreToolUse`, `Exit 2 - Block`, **registrado no `~/.claude/settings.json` vivo** | cabeçalho do arquivo + grep no settings |
| checks do `spec-lint` hoje | **2**: `cli-surface`, `parallel-collision` | `core/scripts/lib/spec-lint/registry.cjs` |
| `cli-surface` já varre | **todos** os `ctx.artifacts`, com scanner de cerca próprio | `cli-surface.cjs:383` (laço) e `:75-77` (scanner) |

🔴 **Regra de manutenção**: mudou um valor daqui, `grep` pelo valor **antigo** no repo inteiro antes de commitar.

---

## Estado empírico (Discover Before Specify)

### As três lacunas que ficaram

| lacuna | onde vive hoje | confirmada por |
|---|---|---|
| **G2** AC com sufixo invisível | `core/hooks/spec-test-traceability.cjs:51` × `core/adapters/claude/commands/soma-run.md:51` | as duas formas canônicas divergem entre si; `### AC-01b:` não casa nenhuma, e nada avisa |
| **G3** cobertura mede referência, não adequação | `core/scripts/lib/spec-lint/context.cjs:114` | `[SPEC:AC-XX]` conta presença; 4 ACs da 017 têm como única prova uma task cuja condição de parada declarada é `RED:` |
| **G9** comando não exercitado | `core/adapters/claude/commands/plan-sdd.md` §5 (linhas 116-131) | a régua de cobertura exige a tag `[SPEC:AC-XX]` existir e **nada** sobre o comando rodar; 3 defeitos graves de comando num único `tasks.md` do hermes, todos detectáveis por verificação read-only barata |

### O que esta spec mede sobre si mesma

Rodado em 2026-08-22 contra este próprio diretório:

```
$ node core/scripts/spec-lint.cjs core/specs/019-gates-que-nao-pegam
checks executados: parallel-collision  |  pulados: cli-surface  |  achados: 0
exit=0
```

**Metade desse verde é vazia.** Não existe `tasks.md` aqui — o `parallel-collision` rodou sobre lista
vazia e se reportou como *executado*. O `cli-surface` foi honesto e se declarou pulado. A causa está
medida na **G-LINT** abaixo; a consequência é que o número `achados: 0` não sustenta a confiança que
transmite. É o próprio defeito que esta spec nomeia, na ferramenta que esta spec usa.

| lacuna | onde vive hoje | confirmada por |
|---|---|---|
| **G-LINT** check que nunca se declara pulado | `core/scripts/lib/spec-lint/checks/parallel-collision.cjs:112` | retorna `{status:'ran'}` incondicional e consome `ctx.tasks \|\| []` (:79), sem nunca perguntar se `tasks.md` existiu |

**Por que aconteceu** — e é o achado, não o bug: a regra genérica está escrita em `finding.cjs:4-6`
(*"a skipped check must be visibly skipped, or 'didn't run' silence is indistinguishable from 'ran and
passed' silence"*), mas o **AC-06 da spec 017** a operacionalizou assim: *"IF um `plan.md` não contém o
bloco cercado `soma-cli-surface`, THEN o linter SHALL pular o check de superfície"*. Foi escrita sobre
**um arquivo e um check**, não sobre a classe *"artefato de entrada ausente"*. Nenhum dos 16 ACs da 017
cobre `tasks.md` ausente, e o contrato `check-parallel-collision.md` declara `status:'ran'|'skipped'` sem
listar nenhuma situação de skip. O segundo check nunca foi submetido à regra.

🔴 **G-LINT é remediação recortada pelo sintoma, dentro do linter do SOMA.** Fica registrada aqui como
evidência da tese e é endereçada no **Bucket C** do handoff (`E3`), não por um AC desta spec — o conserto
é na spec 017, cujo AC-06 precisa ser reescrito sobre a classe.

### Nota de proveniência de caminhos — reverificada em 2026-08-22

A spec 018 moveu arquivos em **dois** commits distintos, e a nota original só cobria o primeiro:

- `85ea442` (T-04, 2026-08-21 09:29) — apagou as cópias da **raiz** de `commands/plan-sdd.md`,
  `commands/specify.md` e **também `commands/soma-run.md`**. Recuperáveis por `git show 295dc2f:<path>`.
- `30032fc` (T-08a, 2026-08-21 18:34) — `git mv hooks core/hooks`, **9 horas depois** da nota ter sido
  escrita (`ef89c82`, 09:33). Ninguém voltou para estendê-la. Move puro, 0 diff: a linha 51 continua
  linha 51, só o prefixo do diretório mudou.

⚠️ **Existem DOIS `soma-run.md`, e eles divergem.** O canônico do repo é
`core/adapters/claude/commands/soma-run.md` (296 linhas, regex na **:51**). O pessoal do Felipe é
`~/.claude/commands/soma-run.md` (474 linhas, regex na **:94**), **excluído do install de propósito**
pela T-08/T-08b da spec 018. **Esta spec audita o canônico do repo.** A citação antiga `soma-run.md:107`
nunca correspondeu a nenhum dos dois — já nascia errada.

---

## User Stories

- Como orquestrador, quero que o gate **recuse** o que ele hoje aprova em silêncio, pra eu parar de
  descobrir defeito só quando um subordinado tenta executar minha instrução.
- Como qualquer sessão futura, quero que "100%" signifique **evidência adequada**, não referência
  presente, pra que o número não me dê confiança que ele não sustenta.
- Como quem liga um gate novo, quero saber **sobre quais artefatos** ele passa a incidir antes de ligá-lo,
  pra não travar o repositório sem querer.

---

## Outcome & Guardrails

**OUTCOME** — rodar `soma spec-lint` sobre o corpus de fixtures do AC-04, com os defeitos das três
lacunas plantados, e ver cada gate **nomear** o seu. Hoje o linter responde `achados: 0` sobre dois deles
e não vê o terceiro.

**APPETITE** — uma sessão. Os três gates compartilham a mesma máquina (`spec-lint`, `context.cjs`,
`registry.cjs`) e nenhum deles muda a máquina de estados. **O AC-05 (retroatividade) é o mais barato e
vem primeiro**, porque sem ele ligar qualquer gate é aposta. Se estourar, corta o **AC-03** — é o único
que precisa de tokenizer novo. **Não corta o AC-04**: sem corpus, os outros não têm como ser provados.

**NO-GOS**
- Não transformar o SOMA em ferramenta de auditoria genérica: o alvo são os artefatos que ele mesmo gera —
  `spec.md`, `plan.md`, `tasks.md`, `contracts/`, `quickstart.md`.
- Não adicionar gate que só sabe dizer "ok" — todo gate novo nasce com caso conhecido-ruim que o dispara
  **e** caso conhecido-bom que ele ignora, ambos em `core/scripts/__tests__/fixtures/spec-lint/`.
- Não mexer no regex `AC-\d+` em si: a spec 016 já investigou e concluiu que ele **está correto**. A
  lacuna é a ausência de lint para o que *parece* AC e não casa.
- Não estender o alvo a código de produção nem à suíte de testes — isso é a **spec 020**.

---

## Acceptance Criteria

### AC-01: WHEN um heading de artefato normativo se parecer com um critério de aceite e não casar a forma canônica, the sistema SHALL emitir um achado nomeando o heading e o arquivo

Given os artefatos `spec.md`, `plan.md`, `tasks.md` e `contracts/*.md` de uma spec — **`quickstart.md`
fica de fora, e o motivo é medido**: ele tem 38 headings da forma `## AC-02 + AC-03: ...` e
`## AC-01 — ...`, que são convenção legítima de seção de walkthrough, não declaração de AC / When um
heading casa `^\s*#{1,6}\s*-?\s*\*{0,2}AC-` mas **não** casa `^### AC-\d+:` / Then o lint emite um achado.

A checagem opera **só sobre linha ancorada em `^`**, nunca sobre a substring em qualquer posição —
inclusive dentro de code span ou prosa.

**Caso conhecido-bom obrigatório**: a linha `### AC-01b: ...` citada dentro de code span nesta própria
spec. Medido: o primeiro caractere dela é crase (`0x60`), não `#`. O lint **não pode** acusá-la. Esta é a
única linha, em 19 specs, que distingue a versão ancorada da não-ancorada.

**Caso conhecido-ruim obrigatório**: **não existe no corpus atual** — os quatro tipos de artefato em
escopo têm **0** near-misses hoje. A fixture tem de ser **construída** em
`core/scripts/__tests__/fixtures/spec-lint/`, como a spec 017 já faz para os seus dois checks. O
espécime histórico (`### AC-01b:`, 2026-08-19) ocorreu no projeto `hermes`, que o Out of Scope exclui.

⚠️ **As duas formas canônicas divergem** (`§0`), e esta spec **não** as unifica — ela linta contra a
forma do `soma-run.md:51` (`^### AC-\d+:`), que é a que governa a escrita de spec. Unificar as duas é
trabalho da spec 021.

### AC-02: The sistema SHALL recusar contar como coberto um AC cuja única task referenciadora declare condição de parada RED

Given um `tasks.md` cuja coluna `Description` contém a etiqueta `RED:` — a convenção real deste
repositório, medida em 4 ocorrências (`§0`) / When essa task é a **única** linha cujo `spec_ref`
referencia um dado AC / Then a cobertura **não** conta esse AC como coberto, e o lint nomeia o par
AC↔task.

Régua: `/\bRED:\s/`, case-sensitive, aplicada à célula `Description`. "Única" = contagem de linhas cujo
`spec_ref` contém aquele `[SPEC:AC-NN]` é exatamente 1, **após expandir a notação de intervalo**
`[SPEC:AC-01..AC-12]`, que 5 specs usam nas tasks-stub de Wave 1.

**Validada nos dois sentidos contra o corpus real**: 219 ACs referenciados por task no repositório
inteiro → **4 acusados, 215 quietos (98%)**. Zero falso-positivo nas 64 linhas que usam as outras 7
formas de "RED" que convivem no repo (`RED phase`, `RED commit`, `validateRedPhase`,
`SOMA_RED_PHASE_STRICT`, `red:` de commit, `RED genuíno`, `expected-RED`).

**Casos conhecido-ruim** (4, todos locais, todos na spec **017**): `017/AC-13` ← `T-01`
(`017/tasks.md:34`); `017/AC-14`, `017/AC-03` e `017/AC-04` ← `T-02` (`017/tasks.md:35`).
**Caso conhecido-bom**: qualquer um dos 215 restantes.

⚠️ **Os quatro são qualificados com o número da spec de propósito.** Sem o prefixo, `AC-03` e `AC-04`
colidiriam com os ACs **desta** spec, e qualquer varredura de `AC-\d+` neste arquivo contaria referência
estrangeira como própria. É o mesmo defeito que a versão anterior desta spec carregava — ela citava um
`AC-15` do hermes na prosa enquanto tinha um `AC-15` próprio.

🔴 **Dois bloqueios medidos, que a implementação tem de resolver antes de escrever o check:**

1. **O parser não devolve `Description`.** `context.cjs:168-175` lê a coluna e a usa apenas para
   `parallel: PARALLEL_MARKER_RE.test(description)`; o objeto devolvido é
   `{id, parallel, files, dependsOn, specRefs, line}`. Nenhum consumidor de `ctx.tasks` consegue ver a
   etiqueta. **Estender `context.cjs` é pré-requisito**, e é mudança de contrato — o
   `CONTRACT-CHECK-PARALLEL-COLLISION` declara o shape hoje.
2. **A palavra RED já tem valência oposta no arquivo vizinho.** `validateRedPhase`
   (`spec-test-traceability.cjs:196-215`) devolve `status: 'verified'` quando há RED genuíno —
   ali RED é **bom**, e operacionaliza o Article II HARD. Aqui RED é **insuficiente como prova única**.
   São objetos diferentes (histórico git de arquivo de teste × declaração em task), mas o gate novo
   **não pode** reusar `validateRedPhase` nem herdar seu nome, sob pena de punir exatamente quem cumpre
   o Article II.

### AC-03: WHEN um artefato normativo contiver bloco de comando, the sistema SHALL exigir evidência de que o comando foi exercitado, ou marcação explícita de por que não é verificável

Given `quickstart.md` (264 blocos medidos) e `plan.md` (30) — **não `tasks.md`, que tem 0**: neste
repositório os comandos nunca moram nas tasks / When o artefato é validado / Then cada bloco carrega
verificação de forma registrada (`bash -n`, `--help`, `docker compose config`, dry-run) ou a marcação de
não-verificável **com o motivo**.

Evidência da lacuna: `core/adapters/claude/commands/plan-sdd.md` §5 (linhas 116-131) exige a tag
`[SPEC:AC-XX]` e **nada** sobre executabilidade — a régua de cobertura é sintática. Três defeitos graves
de comando num único `tasks.md` do hermes, **todos** detectáveis por verificação read-only barata.

**Reuso obrigatório, não construção nova**: o check `cli-surface` já varre todos os `ctx.artifacts`
(`cli-surface.cjs:383`) e já tem scanner de bloco cercado próprio (`:75-77`), com a regra D-017-01 de que
cerca com info-string `text` é dado exibido, não invocação. Este AC estende aquele território — verifica
*evidência de exercício*, onde o `cli-surface` verifica *conformidade de superfície*.

**Caso conhecido-bom obrigatório**: um bloco com info-string `text` — dado exibido, nunca acusado.

### AC-04: The sistema SHALL manter um corpus versionado de artefatos com os defeitos desta spec plantados, e cada gate SHALL ser provado contra ele

Given que o OUTCOME desta spec só é verificável contra artefatos defeituosos / When um gate novo é
adicionado ao `registry.cjs` / Then existe, em `core/scripts/__tests__/fixtures/spec-lint/`, um par
nomeado — conhecido-ruim que o gate acusa e conhecido-bom que ele ignora — e a suíte falha se o par
estiver ausente.

**Por que isto é um AC e não um NFR**: na versão anterior desta spec o corpus era exigido pelo NO-GO e
pelo NFR *"Test style"*, e **nenhum AC o criava** — não tinha dono, lugar, nem formato. Um leitor
adversarial em contexto isolado, encarregado de derivar as tasks, apontou que teria de inventar o corpus
inteiro. Exigência sem dono é a mesma classe de defeito que esta spec descreve.

**Precedente**: a spec 017 já mantém fixtures assim para os seus dois checks, incluindo uma de
regressão — o `tasks.md` que fez o validador ad hoc de 2026-08-15 dizer *"0 conflitos"* com 8 tasks `[P]`
escrevendo no mesmo arquivo.

### AC-05: IF um gate novo for ligado, THEN the sistema SHALL declarar sobre quais artefatos ele incide, e SHALL recusar em voz alta se a declaração estiver ausente

Given que existem **19 `spec.md` já commitados**, escritos antes destas regras / When um gate novo entra
em vigor / Then a declaração de escopo é explícita — artefatos da run ativa, ou varredura retroativa
sob comando próprio — e a ausência de declaração **falha alto**, nomeando o que falta, nunca em silêncio.

**Por que isto é obrigatório, medido**: o `spec-completeness-gate.cjs` se declara `PreToolUse` com
`Exit 2 - Block`, e **está registrado no `~/.claude/settings.json` vivo desta máquina**. Um gate novo
que incida retroativamente sobre `core/specs/` inteiro e reprove artefatos antigos **para o repositório**
— o commit passa a ser bloqueado por defeito em documento que ninguém está editando. A spec anterior
nunca declarou retroatividade, e as três leituras possíveis (só artefatos novos / todo o `core/specs/` /
só o diff da run ativa) produzem estados de repositório radicalmente diferentes, duas delas travados.

**Caso conhecido-ruim**: um gate registrado no `registry.cjs` sem declaração de escopo → a suíte acusa.

---

## Non-Functional Requirements

- **Performance:** todo gate **mecânico** (lint, regex, parser) roda em < 5 s sobre uma spec típica.
  Gate lento vira gate desligado. **Este teto não se aplica a leitura adversarial por agente**, que tem
  orçamento próprio e não roda no caminho do `spec-lint` — a versão anterior desta spec aplicava o teto
  sem exceção e ao mesmo tempo propunha um estado inteiro baseado em agente, uma contradição interna que
  a auditoria pegou.
- **Test style:** cada gate novo nasce com **dois** testes — um caso conhecido-ruim que ele acusa e um
  conhecido-bom que ele deixa passar, ambos no corpus do AC-04. Gate sem o segundo vira ruído; sem o
  primeiro, é cego.
- **Monitoring:** contador por gate de quantas vezes disparou. **Rótulo de falso-positivo fica fora**:
  exige um laço de julgamento humano que nenhum AC desta spec cria, e um campo que fica sempre `0` é
  pior que campo nenhum.

🔴 **Dependência invertida, declarada**: a prova de dois lados exigida pelo *Test style* é colhida pela
suíte. Enquanto o `node --test` órfão viver (`PPID=1`, documentado no **AC-04 da spec 020**), a suíte tem
flake de ±1 de causa conhecida e o mesmo SHA rende contagens diferentes. **O AC-04 da spec 020 é
pré-requisito da prova desta spec**, embora a 020 seja posterior em número.

## Out of Scope

- Consertar os defeitos do projeto `hermes`. Já foram corrigidos lá; aqui só interessa por que passaram.
- Reescrever o regex `AC-\d+` (spec 016 já concluiu que está correto).
- Auditoria adversarial de código de aplicação e de suíte de testes — é a **spec 020**.
- Unificar as duas formas canônicas de heading de AC, que hoje divergem — é a **spec 021**.
- Consertar o `G-LINT` (`parallel-collision` que nunca se declara pulado) — o conserto é de classe, no
  AC-06 da spec **017**, e está no Bucket C do handoff como `E3`.
- Os seis ACs de mecanismo indefinido (auditoria adversarial como estado, proveniência declarada, parser
  de decisões de projeto terceiro, contradição em arquivo canônico, adoção de trabalho externo,
  notificação de agente encerrado) — é a **spec 021**.

## Questões resolvidas

**D-019-01 — a auditoria adversarial é um estado próprio, `STEP_1D_AUDIT`.** *(Gate 1, 2026-08-22.)*
Alternativas rejeitadas: (a) dentro do `STEP_1C_TASKS`; (b) estado próprio mas opcional por tamanho.
*Por que estado próprio*: estado separado força **ator** separado, e o ator é a coisa toda. Estado próprio
também produz artefato próprio, que o `soma run gate` pode exigir — sem artefato, "auditei" volta a ser
prosa. A opção (b) foi rejeitada porque "opcional" historicamente vira "nunca".

🔴 **A decisão fica travada, mas a EXECUÇÃO migra para a spec 021**, por duas medições:
1. **O custo é 15 pontos de edição, não 1.** Não existe fonte única de `STEP_ORDER`. São **três** cópias
   completas da lista em código — `core/scripts/run/gate.cjs:60-73`, `core/scripts/run/resume.cjs:63-76`
   (comentada como *"Mirrors gate.cjs's STEP_ORDER verbatim"*) e `core/scripts/__tests__/run-resume.test.cjs:189-193`
   (`allSteps`, teste T-09-06, que a auditoria original não tinha nomeado) — mais **quatro** comentários
   que hardcodam a adjacência ou a contagem `12` (`gate.cjs:55-58`, `resume.cjs:33`, `soma-run.md:39`,
   `soma-run.md:41` e sua invocação na `:99`), mais **13** headers de markdown a renumerar, mais **quatro**
   fixtures de teste que quebram por `reentryFromReports()` parar no primeiro step sem report.
   **Nenhum teste hoje acusa se algum for esquecido.**
2. **O estado não está especificado.** A decisão não nomeia o artefato, o schema, o critério de
   aprovação, nem se um achado bloqueia a transição. `"pode exigir"` autoriza dois sistemas incompatíveis.

**D-019-02 — o AC-02 usa heurística estreita como gate duro.** *(Gate 1, 2026-08-22; régua corrigida em
2026-08-22 após medição.)* Alternativas rejeitadas: (a) só heurística; (b) só julgamento de agente.
*Correção*: a versão original ancorava numa frase — `"parar se o teste passar"` — que **não existe neste
repositório** (0 arquivos). Era invenção do autor. A convenção real é a etiqueta `RED:`, medida em 4
ocorrências, e a régua `/\bRED:\s/` foi validada nos dois sentidos: 4 acusados de 219, 215 quietos.
*Regra de projeto*: a heurística é **estreita e barulhenta**, nunca esperta.

**D-019-04 — o alvo desta spec é documento; código e suíte saem para a spec 020.** *(Felipe, 2026-08-22.)*
Os antigos AC-11..AC-15 tinham por sujeito `install-cli.contract.test.cjs`, `install-home-isolation-guard.test.cjs`,
`doctor.cjs` × `bootstrap.cjs`, três testes de regressão, e o modo como uma pessoa recorta escopo de
remediação. Nada disso é artefato que o SOMA gera, e o NO-GO e o Out of Scope proibiam os dois em texto
explícito. Alternativas rejeitadas: (a) alargar o NO-GO para admitir o próprio código — rejeitada porque
"auditar o próprio código" não tem fronteira natural, que é a razão de o NO-GO existir; (b) reprojetar os
cinco no nível documento — rejeitada porque só dois dos cinco têm projeção documental, então na prática
era o mesmo corte, parcial.

**D-019-05 — fica o que tem régua medida; sai o que só tem incidente narrado.** *(Felipe, 2026-08-22.)*
Critério aplicado aos 10 ACs restantes depois da D-019-04. Ficaram três, cada um com regex ou comando
literal e par de casos nomeado. Saíram seis para a spec 021, todos por falta de mecanismo decidido, não
por falta de mérito — os incidentes que os originaram estão preservados lá. E o AC-01 antigo saiu por
estar **morto**: ver §Achados registrados.
Alternativas rejeitadas: (a) manter os dez e decidir os mecanismos agora — exigiria sete decisões novas
de arquitetura numa sessão, duas delas de segurança; (b) rebaixar a spec a catálogo de padrões — descarta
três gates que já têm régua e espécime.

---

## Achados registrados — coisas medidas que não viram AC aqui

**O antigo AC-01 está morto, e o registro fica.** Ele afirmava que a precondição do `/plan-sdd` abortava
com `grep -c "\[NEEDS CLARIFICATION"` e que *"toda spec bem preenchida falha"*. Medido em 2026-08-22
contra o adapter canônico: **não aborta**. O snippet de hoje remove comentário HTML, remove trechos entre
crases, e conta só ocorrências não seguidas de `]`. Rodado contra 6 specs reais (001, 014, 016, 017, 018 e
esta): `markers em aberto: 0` em todas. Os commits do conserto são `540b7b8` (2026-08-15 20:27:52) e
`20920de` (2026-08-15 20:38:32), ambos ancestrais confirmados de HEAD — **quatro dias antes** do
`Medido em 2026-08-19` que o AC citava como prova. O grep ingênuo só existiu na cópia da **raiz**, apagada
em `85ea442`. A própria nota de proveniência desta spec mandava re-medir G1 antes de agir, e a re-medição
refuta o achado.

**A auditoria adversarial desta spec, contra ela mesma.** O antigo AC-04 propunha leitura adversarial de
artefato normativo antes do Gate 1. Foi exercida pela primeira vez **contra o documento que a criou**, em
2026-08-22: 5 lentes adversariais + 2 leitores em contexto isolado + 7 reverificações + 3 medições de
conserto. Resultado: **35 achados distintos**, todos reproduzidos, nenhum descartado por régua quebrada.
Os dois leitores em contexto isolado — que não recebiam a lista de achados, e sim a ordem de *executar* o
documento — acharam 14 que as 5 lentes não acharam, incluindo os dois que reescopara a spec: o OUTCOME sem
dono e a retroatividade não declarada. **Leitor adversarial acha contradição; leitor isolado acha o que o
documento não diz.** Os dois são necessários, e o segundo não é opcional.

---

## Completeness Checklist

- [x] Todo AC é testável — cada um cita regex ou comando literal, e nomeia caso conhecido-ruim e bom
- [x] Nenhum AC nomeia intenção sem observável
- [x] Zero perguntas em aberto
- [x] NFR com performance, estilo de teste e monitoramento, e com a exceção do teto declarada
- [x] Out of Scope nomeia cada coisa que saiu e para onde foi
- [x] Feature ID + Branch preenchidos
- [x] OUTCOME/APPETITE/NO-GOS preenchidos, e o APPETITE reflete o escopo atual de 5 ACs
- [x] Toda afirmação factual tem proveniência na §0 ou citação de arquivo:linha inline
