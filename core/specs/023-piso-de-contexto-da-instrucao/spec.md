# Spec: O piso de contexto da superfície de instrução

**Feature ID:** 023-piso-de-contexto-da-instrucao
**Branch:** `feature/023-piso-de-contexto` *(ainda não criada — ver §Estado deste arquivo)*
**Created:** 2026-08-23
**Status:** DRAFT — **não é para executar.** **9** decisões de mecanismo em aberto (QA-1, 2, 4, 5, 6, 7, 8,
9, 10), **duas bloqueantes** (QA-6 e QA-8). A QA-3 foi **decidida em 2026-08-23** a pedido do Felipe — ver
`D-023-01`. Auditada em 2026-08-23 por **1 leitor em contexto isolado + 5 lentes adversariais**: **20
achados, todos reproduzidos pelo orquestrador antes de aceitar, zero descartado** — §Auditoria.

> **Origem:** pedido do Felipe em 2026-08-23, disparado por um número do `/usage` dele:
> *"72% of your usage was at >150k context — Longer sessions are more expensive even when cached."*
>
> **Por que spec própria e não emenda na 019/020/021/022:** a **019** trata de gates que não pegam nos
> artefatos do pipeline; a **020**, de fail-silent em código e suíte; a **021**, dos gates cujo mecanismo
> não foi decidido (`STEP_ORDER`, `hooks.json`, modo de adoção, proveniência, heading de AC); a **022**, do
> transporte do handoff. Nenhuma tem por sujeito **o custo de contexto da superfície que o SOMA instala e
> mantém**. Somar isto a qualquer uma delas as tornaria depósito — que é o que a **D-019-05** existe para
> impedir.
>
> **Por que DRAFT e não APPROVED:** pelo critério da D-019-05 — *"fica o que tem régua medida; sai o que só
> tem mecanismo indefinido"* — aqui o **estado está medido com rigor** e o **mecanismo não está decidido**.
> A QA-3 era escolha de risco e foi devolvida ao Felipe; ele mandou decidir, e a decisão está em
> `D-023-01`, com as três alternativas rejeitadas nomeadas e o motivo medido de cada uma.

---

## §0 Superfície fixada

Medições feitas em **2026-08-23** pelo orquestrador, contra o estado vivo da máquina do Felipe. Cada linha
diz **como** o valor foi obtido, e **se é medida ou estimativa** — o corolário de provenance do Failure Log.

| valor | é | medido por | natureza |
|---|---|---|---|
| piso de contexto no 1º request | **104.391 – 126.812 tokens** | `usage` dos 12 transcripts mais recentes em `~/.claude/projects/-Users-felipevdc1/*.jsonl` | **medido** (contagem da própria plataforma) |
| requests acima de 150k | **3.448 / 3.797 = 91%** nas 12 sessões, às ~09:0x de 2026-08-23 | idem | **medido, e já obsoleto** — remedido ~1h depois: **3.769 / 4.110 = 92%**. O objeto cresce enquanto se mede |
| 🔴 **o 91% NÃO é o 72% do `/usage`** | reguas diferentes, e nenhuma minha reproduz a dele: por contagem de request **92%**, ponderada por token de input **97%**, por output **94%** | as três rodadas sobre as mesmas 12 sessões | **medido** — a janela do `/usage` dele não é "as 12 sessões mais recentes"; a minha amostra são sessões de trabalho pesado e é **mais extrema** que a janela dele. **A conclusão sobrevive; os números não são comparáveis** |
| distância do piso ao limiar de 150k | **~25k – 45k tokens** | derivado das duas linhas acima | **derivado** |
| sessões que nunca cruzaram 150k | **2 de 12**, e são as de **8** e **16** turnos | idem | **medido** |
| `~/.claude/CLAUDE.md` | **117.112 B / 701 linhas** às ~09:0x; **123.850 B / 725 linhas** às ~09:37 do MESMO dia | `wc -c -l ~/.claude/CLAUDE.md` | **medido, e o objeto cresceu +6.738 B durante esta própria auditoria** — todo o delta é **uma entrada nova apensada ao Log**, que é exatamente o espécime da AC-04. Âncora no instante desta linha: `sha256=f4cb3f1c2b1aad50…`, `2026-08-23T12:43:50Z` |
| `## Failure Log` dentro dele | **74.739 B = 64% do arquivo** | `sed -n '501,701p' \| wc -c` | **medido** |
| blocos ancorados `soma-v2` no CLAUDE.md | **3**: `soma-voxel` 8.933 B · `soma-stsd` 3.341 B · `hyd-v2` 1.303 B = **13.577 B** | regex sobre os markers `<!-- soma-v2:start … end -->` | **medido** |
| Output Style presente **duas vezes** no mesmo arquivo | seção manual (linhas 42-105, **4.304 B**) **+** bloco `soma-voxel` (linhas 301-499, **8.933 B**) | `grep -n '^## '` + contagem por faixa | **medido** |
| `~/.claude/projects/-Users-felipevdc1/memory/MEMORY.md` | **25.587 B** às ~09:0x → **23.462 B** às ~09:33 → **24.461 B** às ~09:34 | `wc -c <caminho absoluto>` | **medido 3×, e as 3 estão certas** — outra sessão encurtou o arquivo no meio e esta o aumentou depois. ⚠️ **O caminho absoluto é obrigatório**: existem **dezenas** de `MEMORY.md` sob `~/.claude/projects/`, um por projeto |
| hooks registrados **em duplicata** | **18 grupos** `(evento, caminho resolvido)` com mais de um registro. **Não são "pares"**: 15 são dois caminhos para o mesmo arquivo (`/Users/felipevdc1/.claude/hooks/X.cjs` **e** `"${CLAUDE_HOME}/hooks/X.cjs"`, com `CLAUDE_HOME=/Users/felipevdc1/.claude`); **1 tem três registros** (`agent-mode-gate.cjs` em `PreToolUse`); **2 são a mesma string repetida** (`capture-defer-gate.cjs` e `insight-action-coupling.cjs`, ambos em `Stop`) | agrupamento por caminho resolvido sobre `~/.claude/settings.json`; régua validada nos dois sentidos (fixture bom → 0 grupos; real → 18) | **medido** — corrigido de "17 pares" pelo leitor isolado, ver §Auditoria |
| efeito visível da duplicata | o aviso do `hyd-gate` e o do `session-init` chegam **2× por gatilho** | observado **no contexto desta própria sessão** — ambos impressos duas vezes, verbatim | **medido no efeito** |
| comandos que o SOMA instala — **no repo** | **13**, somando **93.734 B**; `soma-run.md` = **24.249 B** | `git ls-tree -l main core/adapters/claude/commands/ \| awk '{s+=$4}'` | **medido** |
| …**instalados** em `~/.claude/commands/` | **91.400 B** — **12 dos 13 byte-idênticos**; `soma-run.md` **diverge por desenho, não por defasagem**: repo **296 linhas / 24.249 B**, instalado **474 linhas / 21.915 B** — mais linhas e menos bytes, 553 linhas de diff, **linhagem separada** (o repo já corrigiu um typo que o instalado ainda tem). O `handoff-forge.md:147` documenta como armadilha medida: *"o pessoal do Felipe, excluído do install de propósito"* | `wc -l -c` + `diff`; régua validada nos dois sentidos (mutação deliberada acusou; os 12 idênticos ficaram quietos) | **medido** |
| 🔴 **repo ≠ instalado, e o piso é o instalado** | o critério da própria spec é *"o que o SOMA instala"*, e a divergência é **deliberada** — logo medir a árvore do **git** mede o objeto errado **por construção**, não por acidente de sync. O Felipe paga o que está em `~/.claude/`. Armadilha do mesmo nome nos dois lados de uma fronteira: falha **em silêncio**, não alto | comparação acima | **medido** |
| subcomandos reais do CLI | **11**: `bootstrap`, `init`, `install`, `doctor`, `sync`, `rollback`, `manifest`, `module`, `audit`, `run`, `spec-lint` | array `SUBCOMMANDS` em `core/scripts/soma.cjs` | **medido** |
| 🔴 `soma audit` **já está ocupado** | é o auditor **por módulo** da spec 012: `core/scripts/audit.cjs`, 184 linhas, **`--module <path>` obrigatório** (`audit.cjs:64`), invoca o CLI `claude` em subprocesso, emite schema **`soma-audit/v1`** (`audit.cjs:141`) | `cat` do arquivo; `grep -ic 'token\|context\|budget\|byte'` = **0**, com controle positivo (`grep -ic 'module'` = 21, régua não é cega) | **medido** — achado pelo leitor isolado, ver §Auditoria |
| skills/comandos na listagem do system prompt | 29 skills próprias + **139** `SKILL.md` no cache de plugins + 17 comandos | `ls` / `find` | **medido** |
| 🔴 o SOMA duplica bloco **entre arquivos**, por desenho | o adapter **codex** escreve `soma-stsd` e `codebase-memory-mcp` em **dois alvos**: `~/.codex/AGENTS.md` **e** `~/AGENTS.md`. Ratificado em **`D-C11`** (`core/docs/adapter-contract.md:63`). Nos arquivos vivos os dois blocos são **byte-idênticos** | `install-targets.json` do codex (2 de 3 block_ids com 2 alvos) + sha256 **independente** do conteúdo extraído (`awk`+`shasum`, não o sha declarado no comentário). Controle negativo: `hyd-v2` tem 1 alvo só e os shas **diferem** — a régua distingue | **medido** — achado pela lente C, ver §Auditoria |
| `codex-cli` instalado nesta máquina | **0.149.0** | `codex --version` | **medido** |
| MCP servers configurados | **6** (`magic`, `codebase-memory-mcp`, `stitch`, `mempalace`, `vault`, `notebooklm`) | `~/.claude.json` | **medido** |

🔴 **Nenhuma conversão byte→token entra nesta spec como fato.** Os únicos números de token aqui são os do
`usage` dos transcripts, que são contagem da plataforma. Qualquer divisor (÷4 e similares) é **estimativa
não validada** e está deliberadamente **ausente** desta tabela — construir a régua real é a **AC-01**, e é
o primeiro trabalho justamente porque sem ela toda priorização abaixo seria chute com cara de medida.

---

## O falsificador, e o reenquadramento que ele forçou

A tese óbvia, e a que eu ia especificar, era: *"sessões longas ficam caras — reduzir o crescimento do
contexto"*. O falsificador barato foi: **se o piso fosse pequeno, sessões novas começariam longe de 150k.**

Não começam. **Começam entre 104k e 127k** — 70% a 85% do limiar consumido **antes da primeira palavra do
Felipe**. As duas únicas sessões da amostra que nunca cruzaram 150k são as de 8 e 16 turnos; toda sessão de
trabalho real cruza, e cruza cedo.

**Consequência para o escopo:** o alvo é o **piso**, não a taxa de crescimento. Uma spec que otimizasse
poda de tool-results estaria mirando os 25k-45k de folga em vez dos 104k-127k já gastos.

**Consequência para a honestidade da spec:** o SOMA **não é dono do piso inteiro**. Ele é dono do que
instala e do que mantém (blocos ancorados, comandos, hooks). O resto — listagem de 139 skills de plugin,
6 servidores MCP, `MEMORY.md`, o system prompt do harness — o Felipe paga e o SOMA não controla. **A QA-7
existe porque essa fronteira ainda não foi decidida, e fingir que ela não existe faria a spec prometer o
que não pode entregar.**

### A tensão central, que não tem saída óbvia

O maior item **atribuível a um arquivo só** é o **`## Failure Log`: 74.739 B, 64% do `CLAUDE.md`**. Ele é
também o **mecanismo anti-reincidência** do sistema: o `§Self-Maintenance Protocol` manda escrever nele, e
os failure modes **#12** e **#15** existem porque ele foi ignorado. Ele só tem operação de **append**.

As duas saídas óbvias falham, e falham de modos opostos:
- **Cortar/truncar** ataca o mecanismo que impede repetir erro caro — o benefício é episódico mas o custo
  de perdê-lo é exatamente o que o arquivo documenta.
- **Mover para leitura sob demanda** reintroduz o defeito que a **spec 022** acabou de medir: referência
  por caminho que ninguém abre (*"referência decorativa"*, incidente de 2026-08-22).

**A QA-3 foi decidida — ver `D-023-01` abaixo.** A decisão é a terceira saída, e ela só apareceu depois de
medir; as duas óbvias caem por medição, não por gosto.

---

## D-023-01 — a partição do `## Failure Log` é por **função**, não por data

**Decidida em 2026-08-23** pelo orquestrador, a pedido explícito do Felipe (*"decide por mim"*).

### O que a medição mostrou

| valor | é | medido por |
|---|---|---|
| `## Failure Modes` (as regras, #1–#15) | **15.377 B**, linhas 5-32 | contagem por faixa |
| `## Failure Log` (as narrativas) | **74.739 B**, linhas 501-701, **39 entradas datadas** | idem |
| entradas que citam padrão **já catalogado** | **18 de 39** — são nota de frequência, não regra nova | parse dos `#N` no cabeçalho de cada entrada |
| distribuição por mês | 04/26: 9 · 05: 2 · 06: 1 · 07: 1 · **08/26: 26** | regex de data |
| **padrões reversos nomeados** | **15** — régua ampla, negrito **opcional**: `grep -oE 'Pattern reverso: *\*{0,2}"[^"]+"'` | 🔴 minha régua original exigia **negrito** e devolvia **12**; a exigência de negrito não tem relação nenhuma com "isto é um padrão nomeado". Régua cega numa dimensão irrelevante |
| …quantos **já vivem** em `## Failure Modes` | **4** (L14, L15, L17, L29) — **não 1** | a spec afirmava *"só `Grep the Old Value` está em Failure Modes"*: **falso** |
| …**órfãos que precisam subir** (a pré-condição) | **11** — inalterado | 15 − 4 = 11 = 12 − 1: **coincidência aritmética**, não confirmação. Reverificado por outro caminho — cada um dos 11 nomes com **0** ocorrências antes da L501, e controle negativo (*Grep the Old Value* aparece antes, como devia). **A pré-condição resiste; as duas afirmações-âncora não** |
| …quantos vivem **só** no `## Failure Log` | **11 de 12** | idem — só *"Grep the Old Value"* está em `## Failure Modes` |

### As duas saídas óbvias, e por que caem

- **"Vira artefato sob demanda" — REJEITADA.** Motivo medido: **11 dos 12 padrões reversos existem apenas
  no Log**. Movê-lo torna onze regras operacionais invisíveis — que é, literalmente, o defeito de
  *referência decorativa* que a **spec 022** mede. Trocaríamos um custo de tokens por uma perda de trava.
- **"Paginar por recência" — REJEITADA, e é a menos óbvia.** A recência é o **eixo errado**: as entradas
  antigas (04/2026) são os padrões fundadores #1–#9; as novas (**26 das 39 são de agosto**) são
  majoritariamente nota de frequência sobre padrão já catalogado. Cortar por data **descarta a regra e
  preserva a repetição** — exatamente ao contrário do que se quer.
- **"Fica inteiro" — REJEITADA.** 64% do arquivo, operação única de append, e a curva está acelerando
  (67% das entradas no último mês), não estabilizando.

### A decisão

**Partir por função, aplicando ao Log o padrão que o próprio Log contém** — *"Inline What Constrains,
Reference What Informs"* (registrado por ele em 2026-08-22):

1. **Fica inline** — o que **restringe**: o failure mode e o **padrão reverso nomeado**, em uma linha cada.
2. **Sai por caminho** — o que apenas **informa**: a narrativa do incidente (data, bytes, quem pegou, o
   custo, a história). Nada é apagado; vai para arquivo referenciado.

### Pré-condição bloqueante

🔴 **Os 11 padrões reversos órfãos sobem para `## Failure Modes` ANTES de qualquer narrativa sair.** Mover
primeiro perde onze regras. A ordem não é preferência — é a condição que separa esta decisão da saída
rejeitada. Os onze são: *Check the Boundary Before Appending · Never Anchor a Range on Your Own Commit ·
Never Ship a Rule Without Running It Against the Code · Ask the Tree, Not the Roster · Prove the Confession
Too · Run the Principle Up a Level · One Line, One Machine · Measure the Effect He Can See · Prove the
Caller, Not the Unit · Scope by the Behavior, Not by the Symptom · Inline What Constrains, Reference What
Informs.*

### Duas armadilhas medidas, que a execução tem de respeitar

- **O Log faz fronteira com região gerada.** Em 2026-08-21 duas entradas caíram **dentro** do bloco
  ancorado `hyd-v2`, mudaram o `sha256` e derrubaram **29 testes de install** — e um `soma sync --apply`
  as teria apagado. Toda escrita aqui confere os markers **antes** e re-mede o `sha256` **depois**
  (*"Check the Boundary Before Appending"*).
- **Nada é apagado.** O arquivo de narrativas é criado e o conteúdo é **movido**, com controle de
  integridade nos dois sentidos antes e depois.

### Ordem de grandeza do ganho

`CLAUDE.md` **117.112 B** → estimado **~44 KB** após a partição (regras + os 11 reversos acrescidos, menos
as narrativas). **Bytes são medidos; a conversão para tokens não** — é a AC-01.

**Alternativa rejeitada e nomeada, como o NFR desta família exige:** *"mover o Log inteiro para leitura sob
demanda"*, rejeitada pela medição dos 11 padrões reversos órfãos.

---

## User Stories

- Como Felipe, quero abrir uma sessão nova e saber **de onde vem cada pedaço do piso de contexto**, pra
  decidir o que cortar sem adivinhar qual arquivo pesa.
- Como Felipe, quero que o SOMA **recuse crescer em silêncio** a superfície que ele mesmo instala, pra o
  custo por request não subir a cada sessão sem ninguém perceber.
- Como a próxima sessão, quero que instrução duplicada seja **erro reportado** e não texto lido duas vezes,
  pra não pagar duas vezes pelo mesmo aviso.

---

## Outcome & Guardrails

**OUTCOME** — comportamento observável pelo Felipe, não feature: *ele roda um comando e vê a tabela do piso
de contexto por artefato, com número medido e não estimado, ordenada por peso; e uma sessão nova abre com o
piso abaixo do orçamento declarado, ou o `soma doctor` reclama em voz alta.*

**APPETITE** — **a decidir no Gate 1.** Depende inteiramente da **QA-2**: se der para medir token real sem
chamada de API, é uma sessão; se exigir tokenizer embarcado ou instrumentação nova, é bem mais.

**NO-GOS**
- **Não cortar o `## Failure Log` sem decisão escrita e datada do Felipe.** É o mecanismo que os failure
  modes #12 e #15 dizem que já foi ignorado uma vez, com custo medido.
- **Não trocar carregado-sempre por referência-por-caminho às cegas.** É literalmente o defeito que a spec
  **022** mede: os dois polos falham, e a partição entre eles ainda não foi decidida lá.
- **Não editar `~/.claude/settings.json` do Felipe.** O SOMA pode **reportar** as duplicatas; removê-las é
  mexer em configuração do usuário, e a decisão de reportar × remediar é a **QA-5**.
- **Não tratar gasto de fan-out** (subagentes, `Workflow`, budget guard). Isso é a **D23** deste sistema, já
  decidida e vigente — outro eixo de custo, outro mecanismo.

---

## Acceptance Criteria

### AC-01: The SOMA SHALL report, per artifact that it installs or manages into the always-loaded surface, its measured context cost.

🔴 **Esta AC não nomeia o comando de propósito, e isso é bloqueante, não estilo.** A versão original dizia
`soma audit` — **errado**: aquele nome já pertence ao auditor por módulo da spec 012, com `--module`
obrigatório e schema `soma-audit/v1` (ver §0). Onde a medição mora é a **QA-6**, agora **bloqueante**: sem
ela, nenhuma task de AC-01 ou AC-05 é derivável.

🔴 **O sujeito da medição é a árvore INSTALADA, não a do repo.** Medido: `soma-run.md` difere em 2.334 B
entre `main` e `~/.claude/commands/`, com 7 semanas de defasagem. Auditar o git reportaria um piso que o
Felipe não paga.

Given a máquina com o SOMA instalado / When o Felipe roda o subcomando de auditoria de contexto /
Then sai uma tabela por artefato (caminho, bytes, tokens, % do piso), ordenada por peso, em que **cada
número declara se é medido ou estimado** — e nenhum token estimado é apresentado sem esse rótulo.

*Régua desta AC — ⚠️ **a tolerância é a QA-10 e NÃO está declarada**; a frase original dizia "dentro de uma
tolerância declarada" como se já existisse, o que é fallback silencioso em prosa: qualquer implementação
passa se o número for escolhido depois. O total reportado tem de bater, dentro da tolerância da QA-10, com o `usage` do 1º
request de uma sessão nova real. Espécime conhecido-bom e conhecido-ruim são obrigatórios (ver NFR).*

### AC-02: IF the same hook script is registered more than once for the same event AND the same matcher, THEN the `soma doctor` SHALL report it as a finding.

🔴 **O `matcher` é dimensão obrigatória, e omiti-lo produziria remediação que QUEBRA um gate.** Medido no
próprio espécime: `agent-mode-gate.cjs` em `PreToolUse` tem 3 registros — **dois** com `matcher=Agent`
(duplicata real) e **um** com `matcher=Task`, que é a **única cobertura** do tool `Task`. Um relatório que
dissesse "3 registros, remova 2" levaria a apagar a cobertura do `Task`. Chave correta:
`(evento, matcher, caminho resolvido)`.

Given `~/.claude/settings.json` / When o doctor roda /
Then cada par duplicado aparece nomeado, com os dois caminhos que resolvem para o mesmo arquivo.

*Espécime conhecido-RUIM já existe e está preservado no §0: **18 grupos** hoje, incluindo `hyd-gate.cjs`
registrado em `UserPromptSubmit` por `/Users/felipevdc1/.claude/hooks/…` e por `"${CLAUDE_HOME}/hooks/…"`,
com `CLAUDE_HOME` resolvendo para o mesmo diretório. Espécime conhecido-BOM: um `settings.json` com um
registro por script, que **não** pode produzir achado.*

### AC-03: IF a block of instruction content managed by the SOMA appears more than once in the always-loaded surface, THEN the audit SHALL report it as duplication.

🔴 **A redação original dizia "in the same always-loaded **file**", e isso excluía por construção a única
duplicação literal que existe.** O adapter codex escreve o **mesmo `block_id`** em `~/.codex/AGENTS.md` e
`~/AGENTS.md` — byte-idêntico, por desenho ratificado (`D-C11`). Um gate restrito a "mesmo arquivo" ficaria
**cego** exatamente para o caso limpo. Trocado `file` → `surface`.

Isto **parte a AC em dois casos com maturidade diferente**:
- **Caso literal — derivável hoje.** Mesmo `block_id` (ou conteúdo com sha idêntico) em dois alvos.
  Espécime conhecido-RUIM: `soma-stsd` e `codebase-memory-mcp` nos dois `AGENTS.md`. Espécime
  conhecido-BOM: `hyd-v2`, um alvo só — a régua tem de ficar quieta nele. **Não depende da QA-8.**
- **Caso temático — travado na QA-8.** Sobreposição de assunto sem texto em comum (o Output Style).

Given `~/.claude/CLAUDE.md` / When a auditoria roda /
Then a duplicação é reportada com as duas faixas de linha e os bytes de cada uma.

🔴 **O espécime que esta AC citava NÃO a exemplifica — e isso a torna não-derivável hoje.** O Output Style
está no arquivo duas vezes (seção manual 42-105 = 4.304 B; bloco ancorado `soma-voxel` 301-499 = 8.933 B —
os dois números conferidos), mas medido: **zero linhas não-vazias em comum** entre as duas faixas
(`comm -12` sobre as faixas ordenadas, com controle positivo — a faixa contra ela mesma dá 46). A
sobreposição é **temática**, não textual: o único heading compartilhado é `Tone`, e em nível diferente
(`### Tone` × `## Tone`). **Um detector por diff, hash ou substring não acharia nada aqui.**

Consequência: **para o caso temático**, construir a AC exigiria inventar um critério de similaridade
(heading normalizado? n-gramas? limiar de quantos por cento?) — território puro de invenção. **É o mesmo
defeito que o HYD pegou na spec 019**: AC mirando objeto que o espécime não exemplifica. Vira a **QA-8**.
**O caso literal não é afetado** e tem espécime válido nos dois sentidos.

### AC-04: The SOMA SHALL declare, for every artifact it writes into the always-loaded surface, whether that artifact is append-only and what bounds its growth.

Given o manifesto de instalação / When a auditoria roda /
Then artefato sempre-carregado **sem teto declarado** aparece como achado, nomeando o artefato e o tamanho
atual.

*Espécime conhecido-RUIM: `## Failure Log`, 74.739 B, 64% do `CLAUDE.md`, operação única de append, sem
teto. **Esta AC exige declarar o teto; ela não autoriza podar** — a poda é a QA-3.*

### AC-05: WHILE the SOMA is installed, IF the always-loaded surface it owns exceeds the declared budget, THEN the `soma doctor` SHALL fail loudly.

Given um orçamento declarado (valor definido no Gate 1, **QA-1**) / When o piso do que o SOMA possui o
ultrapassa / Then o doctor falha com o número medido, o orçamento, e a lista de artefatos por peso.

*Falhar alto e não em silêncio é o ponto: o defeito que esta spec inteira persegue só existiu porque o
custo subia sem produzir nenhum sinal.*

---

## Non-Functional Requirements

- **Test style:** cada AC nasce com **espécime conhecido-RUIM e conhecido-BOM**, e a régua é validada nos
  dois sentidos antes de o veredito valer — acusa no ruim, fica quieta no bom. Os conhecidos-ruins de
  **AC-02 e AC-04** já existem e estão nomeados no §0; não precisam ser fabricados. 🔴 **AC-03 é a exceção
  e a NFR não pode encobri-la**: o espécime que ela citava foi medido e **não a exemplifica** (0 linhas
  não-vazias em comum) — enquanto a **QA-8** não decidir o critério de duplicação, a AC-03 **não tem
  espécime válido** e não entra em execução.
- **Provenance:** todo número no relatório declara **medido / estimado / derivado**. Número sem rótulo é
  achado, mesmo quando está certo. **E o comando citado tem de reproduzir o número quando colado
  literalmente** — com o caminho, não só o verbo. Medido nesta spec: 4 células do §0 citavam `wc -c`,
  `sed … | wc -c` e `grep -n '^## '` **sem o arquivo**, e travam em stdin se coladas; e uma citava
  `git cat-file -s` sobre um **diretório**, que devolve **515** (o objeto tree), não os 93.734 B dos blobs.
  O número estava certo, o método declarado não o reproduzia.
- **Custo da medição:** a auditoria **não pode** depender de chamada de API paga. `ANTHROPIC_API_KEY`
  existe nesta máquina mas exige permissão expressa do Felipe **a cada uso** (memória
  `feedback_api_key_explicit_permission`) — o que a torna inviável como dependência de um comando de rotina.
  Ver **QA-2**.
- **Privacidade:** o relatório reporta **caminho e tamanho**, nunca transcreve conteúdo de `CLAUDE.md`,
  `MEMORY.md` ou transcripts. O handoff e a memória contêm dado pessoal de terceiros.
- **Segurança:** o comando é **read-only** sobre `settings.json` e sobre o `$HOME`. Nenhuma AC desta spec
  autoriza escrita em configuração do usuário.

---

## Out of Scope

- **Gasto de fan-out** (subagentes, `Workflow`, budget guard, pinning de modelo) — é a **D23**, vigente.
- **Poda de tool-results / crescimento intra-sessão** — o falsificador mostrou que o lever é o piso; se
  depois de baixar o piso o crescimento virar o gargalo, é outra spec.
- **Os gates do pipeline** (`spec`/`plan`/`tasks`/`contracts`) — specs **019** e **021**.
- **O transporte do handoff** — spec **022**.
- **Superfície que o SOMA não instala** (139 `SKILL.md` de plugin, 6 servidores MCP, `MEMORY.md`, system
  prompt do harness) — **pendente da QA-7**; hoje explicitamente fora.

---

## Open Questions

- [NEEDS CLARIFICATION: **QA-1** — qual é o orçamento do piso para o que o SOMA possui, e o que acontece ao
  estourar: recusa (doctor falha), aviso, ou poda automática? Sem número, a AC-05 não tem Then.]
- [NEEDS CLARIFICATION: **QA-2** — como medir token **real** sem chamada de API? Tokenizer embarcado,
  derivação a partir do `usage` dos transcripts por diferença controlada, ou aceitar estimativa rotulada?
  **Esta questão decide o apetite da spec inteira.**]
- ~~QA-3 — o `## Failure Log`: fica inteiro, pagina por recência, ou vira sob demanda?~~
  ✅ **RESOLVIDA em 2026-08-23 → `D-023-01`**: partição por **função**, não por data. Pré-condição
  bloqueante: os **11 padrões reversos órfãos** sobem para `## Failure Modes` antes de qualquer narrativa
  sair. As três saídas originais foram rejeitadas por medição, cada uma com o motivo nomeado.
- [NEEDS CLARIFICATION: **QA-4** — o Output Style duplicado: some a seção manual, some o bloco ancorado, ou
  a seção manual vira ponteiro curto? O bloco é gerado pelo `soma sync --apply`, a seção manual não.]
- [NEEDS CLARIFICATION: **QA-5** — nos **18 grupos** de hook duplicado, o SOMA **reporta** apenas, ou também oferece
  remediação? Remediar é escrever em `settings.json` do usuário.]
- [NEEDS CLARIFICATION: **QA-6 — BLOQUEANTE.** `soma audit` **não está livre** (spec 012, `--module`
  obrigatório, schema `soma-audit/v1`). A medição mora num modo novo do `audit`, num subcomando novo, ou em
  `soma doctor` (que é quem já falha alto)? A AC-01 cita `audit` e a AC-05 cita `doctor`; se for um só,
  as duas mudam.]
- [NEEDS CLARIFICATION: **QA-10** — qual é a tolerância da AC-01, em número ou fórmula? Sem ela a régua não
  é validável nos dois sentidos, e um executor poderia declarar 50% e dizer que cumpriu.]
- [NEEDS CLARIFICATION: **QA-9** — a duplicação `~/.codex/AGENTS.md` × `~/AGENTS.md` é **artefato medido**,
  mas o **efeito não está verificado**: ninguém confirmou se o Codex CLI carrega os **dois** na mesma
  sessão. `codex --help` não documenta o carregamento de `AGENTS.md`, e os arquivos vivos são de 07/05/2026
  (não resincados). Se carrega os dois, é custo dobrado por sessão Codex, invisível; se não, é arquivo
  morto. **Medir o efeito antes de tratar como achado de custo** — a `D-C11` pode ter razão de ser.]
- [NEEDS CLARIFICATION: **QA-8 — BLOQUEANTE para a AC-03.** Qual é o critério de "duplicação" quando o
  espécime não é cópia literal? Heading normalizado, sobreposição de n-gramas com limiar, ou a AC-03 muda
  de sujeito (de "conteúdo duplicado" para "duas seções governando o mesmo assunto")? Sem isso, o limiar é
  invenção do executor.]
- [NEEDS CLARIFICATION: **QA-7** — o escopo é só o que o SOMA instala, ou o piso inteiro? O SOMA não
  controla plugins, MCP e `MEMORY.md`, mas o Felipe paga por todos. Auditar sem poder remediar tem valor?]

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observável, não implementação) — ⚠️ **"testável" aqui é
      forma, não prontidão**: AC-01, AC-03 e AC-05 têm G/W/T válido mas **não são deriváveis hoje**,
      travadas por QA-6, QA-8 e QA-1 respectivamente. Não leia este `[x]` como "pronto para construir".
- [x] No implementation details leaked into AC (nenhuma AC nomeia estrutura de dado ou algoritmo)
- [ ] Zero `[NEEDS CLARIFICATION]` markers remaining — **7 abertos, deliberadamente; é o motivo do DRAFT**
- [x] NFR tem no mínimo: custo/performance, segurança, test style
- [x] Out of Scope tem ao menos uma entrada (tem cinco)
- [x] Feature ID + Branch preenchidos
- [x] OUTCOME/APPETITE/NO-GOS preenchidos (APPETITE marcado como dependente da QA-2)
- [x] **Leitor em contexto isolado** — rodado em 2026-08-23, achados reproduzidos e aplicados (§Auditoria).
- [ ] **Leitor adversarial** (lentes por classe de defeito) — ainda não rodado. As duas famílias acham
      coisas diferentes: o adversarial acha contradição, o isolado acha o que o documento não diz.

---

## Auditoria — leitor em contexto isolado, 2026-08-23

Rodado **antes** do Gate 1, como o failure mode #13 exige. O agente recebeu **só o caminho absoluto** da
spec e a ordem de **derivar as tasks e executar** — não de criticar. **Todos os achados abaixo foram
reproduzidos pelo orquestrador** com régua validada nos dois sentidos antes de serem aceitos.

| # | achado | veredito | efeito |
|---|---|---|---|
| A1 | **`soma audit` já está ocupado** pelo auditor por módulo da spec 012 (`--module` obrigatório, schema `soma-audit/v1`, zero relação com token/contexto) | **procede** — reproduzido: `grep -ic 'token\|context\|budget\|byte'` = 0 com controle positivo = 21 | AC-01 reescrita sem nomear comando; **QA-6 vira bloqueante** |
| A2 | **"17 pares" está errado**: são **18 grupos**, e "pares" é a forma errada — 1 grupo tem 3 registros, 2 são a mesma string repetida | **procede** — reproduzida a régua dele (agrupamento por caminho resolvido), controle negativo = 0 | §0 e AC-02 corrigidos |
| A3 | **O espécime da AC-03 não a exemplifica**: 0 linhas não-vazias em comum entre as duas faixas do Output Style | **procede** — `comm -12` = 0, controle positivo = 46 | AC-03 marcada não-derivável; **QA-8 criada** |
| A4 | **§Estado deste arquivo apodreceu** — branch e working tree mudaram no mesmo dia | **procede** — `git branch --show-current` = `feature/019-gates-que-nao-pegam`, tree só com a spec untracked | seção reescrita para mandar medir, não declarar |
| A5 | O CLI tem **11** subcomandos, a spec citava 5 | **procede, mas não era contradição** — a spec selecionava, não afirmava exaustividade | §0 corrigido para os 11 |
| — | Os números do `D-023-01` (74.739 B · 39 entradas) | resistiram | nada a mudar |
| ⚠️ | **Eu escrevi aqui que "11 de 12 padrões reversos" resistiu à conferência independente. Isso estava errado, e o modo é o pior possível**: o leitor isolado reproduziu **a minha régua** (negrito obrigatório) em vez de contar por outro caminho, então **a validação herdou a cegueira do instrumento**. Pego depois pela lente E. O certo é 15 nomeados, 4 já em `## Failure Modes`. **Verificação que compartilha a régua com o verificado não é verificação, é eco** | corrigido no §0 |

### Lente adversarial D — contradição interna, 2026-08-23

| # | achado | veredito | efeito |
|---|---|---|---|
| D1 | A **NFR `Test style` afirmava que AC-03 já tem espécime pronto** — contradizendo a própria AC-03, que foi marcada não-derivável horas antes | **procede** — é o padrão #14 dentro do próprio documento: consertei a AC e deixei a NFR que a cita apodrecendo | NFR corrigida, exceção da AC-03 explicitada |
| D2 | **QA-5 ainda dizia "17 duplicatas"** — valor já corrigido em §0 e AC-02 | **procede** — e a causa é minha: rodei "Grep the Old Value" com régua **estreita** (`'17 pares'`), e a podridão dizia `17 duplicatas`. O grep largo (`\b17\b`) achou. **Confirmou também o outro lado da regra**: das 4 ocorrências de `17`, uma é a contagem legítima de comandos — troca cega a quebraria | QA-5 corrigida para 18 grupos |
| D3 | Checklist marcava `[x] Every AC is testable` enquanto 3 ACs estão travadas por QA aberta | **procede como ambiguidade, não como erro** — "testável" ali é forma (G/W/T), não prontidão; a lente reportou com ressalva e estava certa em reportar | linha qualificada para não ser lida como "pronto para construir" |

**Regras que a lente conferiu e o documento CUMPRE:** zero `\|\| true` / `2>/dev/null`; provenance em 100%
das linhas do §0; zero chave duplicada (`AC`/`QA`/`D-023`); `D-023-01` consistente — nenhum trecho
pressupõe as três alternativas rejeitadas; soma dos blocos ancorados confere (8.933+3.341+1.303 = 13.577).

### Lente adversarial C — sintoma × classe, 2026-08-23

| # | achado | veredito | efeito |
|---|---|---|---|
| C1 | **Todo espécime da spec vinha de UM alvo só** (o `~/.claude/` do Felipe), enquanto o SOMA tem adapter **codex em produção** que escreve os mesmos blocos em **dois** arquivos — e a AC-03 dizia "same **file**", excluindo isso por construção | **procede, HIGH** — reproduzido: 2 de 3 `block_id` com 2 alvos no `install-targets.json`; sha independente idêntico nos dois arquivos vivos; controle negativo (`hyd-v2`, 1 alvo) **difere**. Ratificado em `D-C11` | AC-03: `file` → `surface`; §0 ganhou a linha; **QA-9** criada para medir o efeito |
| C2 | A exclusão é **por omissão, não por decisão** — o `Out of Scope` nomeia o que o SOMA *não* instala (plugins, MCP), mas o codex é superfície que ele **instala** e não estava em lugar nenhum | **procede** | corrigido junto com C1 |

**O achado C1 é melhor que o espécime que ele substitui:** a duplicação do codex é **byte-idêntica**, então
não precisa da QA-8 — ela **destrava** o caso literal da AC-03 em vez de só quebrá-lo.

**Recortes que a lente conferiu e estão CERTOS:** AC-02 e AC-05 são escritas sobre o **comportamento
proibido**, não sobre a lista atual — pegam caso futuro; o `Out of Scope`/QA-7 é exclusão **nomeada e
justificada**, não escondida; os adapters `_EXPERIMENTAL/{cursor,aider,chatgpt-desktop}` são stubs reais
(reproduzido: `entries: []` nos três) e estão corretamente fora; o texto da AC-04 é genérico como devia — o
problema era a base empírica, não a norma.

### Lente adversarial B — instrução incompleta para quem executa, 2026-08-23

| # | achado | veredito | efeito |
|---|---|---|---|
| B1 | **A spec mede o repo; o Felipe paga o instalado — e eles divergem.** | **procede quanto à fronteira, ALTA** — reproduzido: 1 de 13 diverge, total 93.734 × 91.400 | §0 ganhou as duas linhas; **AC-01 passa a ter a árvore instalada como sujeito** |
| B1′ | ⚠️ **A CAUSA que a lente atribuiu — e que eu aceitei — estava errada.** Nós dois lemos "instalado menor + mtime velho" como **defasagem de 7 semanas**. Medindo linhas em vez de bytes: repo **296**, instalado **474** — mais linhas, menos bytes, 553 de diff. É **linhagem separada e deliberada**, já documentada em `handoff-forge.md:147`, que eu tinha lido nesta mesma sessão | **achado meu, ao conferir o handoff antes de anotar o "bug"** | a conclusão estrutural **fica mais forte** (a divergência é por construção); o "bug de sync" **não existe** |
| B2 | 4 células "medido por" citam comando **sem o caminho** (travam em stdin) e uma cita `git cat-file -s` sobre diretório, que devolve **515**, não a soma dos blobs | **procede** — o número estava certo, o método declarado não o reproduzia | §0 corrigido; NFR de provenance passa a exigir comando **reproduzível colado** |
| B3 | `"12 padrões reversos no total"` é afirmação sobre o arquivo feita com régua estreita — são **15** nomeados; 12 é só a forma em negrito | **procede como proveniência** — e ela mesma verificou que **não quebra** a pré-condição. Reverifiquei: **11/11 órfãos, 0 falsos**, controle negativo ok | §0 desmembrado em "forma" × "total" |

**O que a lente conferiu e FUNCIONA:** os 18 grupos de hook (ela errou na primeira tentativa por bug na
régua **dela** — não normalizava aspas — corrigiu e bateu 18/18); o `comm -12` = 0 do Output Style com
controle positivo 46; `soma.cjs:48`, `audit.cjs:64` e `audit.cjs:141` linha a linha; os 11 subcomandos;
`audit.cjs` **idêntico** entre repo e instalado (a divergência do B1 não é geral); e a instrução do §Estado
(`git branch --show-current && git status --short`) — que, rodada por ela, mostrou a branch **já mudada de
novo**, provando que a seção funciona como desenhada: manda medir, não confiar.

**Nota sobre a minha própria verificação do B1:** a primeira régua que escrevi para comparar repo ×
instalado acusou **13 de 13** com delta zero — `wc -c` no macOS devolve com espaços à esquerda e eu comparei
como **string**. Ruidosa no sentido errado, o padrão #10. Peguei porque olhei a coluna de delta em vez do
veredito; com comparação numérica, **1 de 13**.

### Lentes adversariais A (afirmar sem medir) e E (régua cega), 2026-08-23

| # | achado | veredito | efeito |
|---|---|---|---|
| **E1** | **"12 padrões reversos" veio de régua que exige NEGRITO** — dimensão sem relação com "é um padrão nomeado". Amplo = **15**, e **4** já vivem em `## Failure Modes`, não 1. Pior: **o leitor isolado "confirmou" reproduzindo a MESMA régua estreita** | **procede, o mais grave** — reproduzido: bold-only 12, amplo 15, 4 em L14/L15/L17/L29 | §0 refeito; a linha do "resistiram inteiros" corrigida. **A pré-condição dos 11 resiste** — reverificada por outro caminho (0 ocorrências antes da L501 para cada um), não pela mesma régua |
| **E2** | **A régua de hook duplicado ignora `matcher`** — e no espécime isso levaria a remediação que **quebra um gate** | **procede** — medido: `agent-mode-gate.cjs`/`PreToolUse` = 2× `matcher=Agent` (duplicata real) + 1× `matcher=Task`, que é a **única cobertura do tool `Task`** | AC-02 passa a exigir `(evento, matcher, caminho)` |
| **E5** | **O 91% da spec não é o 72% do `/usage`** que motivou tudo — réguas diferentes apresentadas como se concordassem | **procede** — medi as três: request **92%**, ponderada por input **97%**, por output **94%**. **Nenhuma reproduz 72%** | §0 declara a divergência; conclusão mantida, comparabilidade retirada |
| **E3 / A1** | Números-âncora medidos contra documento que **cresce durante a auditoria**, sem instante nem sha | **procede** — o `CLAUDE.md` foi de 117.112 B / 701 linhas para **123.850 B / 725** em ~30 min, e **todo o delta é uma entrada nova no Log** — o espécime da AC-04 se reproduzindo ao vivo | §0 passa a carregar instante + `sha256`; valores drifted registrados como par |
| **A2** | `MEMORY.md` citado **sem caminho absoluto**, com dezenas de homônimos, e o valor mudou | **procede, e as 3 medidas estão certas** — 25.587 → 23.462 → 24.461 no mesmo dia; meu backup pré-edição bate **exato** com a medida dela, o que **explica** a divergência que ela honestamente marcou como "não consigo determinar" | caminho absoluto + as 3 leituras com instante |
| **E4** | AC-01 dizia *"dentro de uma tolerância declarada"* e **nenhuma tolerância existe no documento** — fallback silencioso em prosa | **procede** — 1 única ocorrência da palavra, a própria definição | vira **QA-10** |
| **A3** | *"18 de 39 entradas citam padrão já catalogado"* — o método declarado (parse dos `#N`) **não produz 18 sozinho**; falta regra de classificação | **procede como subespecificação** — ela disse "não consegui conferir" e não inferiu | fica registrado; não sustenta nenhuma AC |

**Réguas da spec que a lente A testou e reproduziu EXATAS:** o piso 104.391–126.812 (min/max idênticos); as
2 sessões que nunca cruzaram, com 8 e 16 turnos; os 3 blocos ancorados e seus bytes — **inclusive
reconhecendo que a spec usou a régua ancorada certa** (`^<!-- soma-v2:start`), porque a ingênua devolve 5 e
não 3, casando menções dentro do próprio Log; `## Failure Modes` = 15.377 B; `## Failure Log` = 74.739 B com
39 entradas e a distribuição por mês; o `comm -12` = 0 com controle positivo 46; os 13 comandos e 93.734 B;
os 5 números do `audit.cjs`; os 11 subcomandos; e os 18 grupos com a decomposição 15+1+2, célula por célula.

**Duas lentes relataram que a régua CEGA era delas, não do documento** — a A achou 3 grupos em vez de 18 até
normalizar aspas; a B idem. Nos dois casos o documento estava certo. Isso é o comportamento que se quer de
um auditor: aplicar a suspeita ao próprio instrumento primeiro.

**O que este leitor achou e um leitor adversarial não teria achado:** A1 e A3 só aparecem quando alguém
**tenta executar** contra o documento. Nenhum dos dois é contradição interna — são coisas que a spec **não
diz**, e que o executor teria preenchido por conta. É a razão pela qual esta família de specs trata o leitor
isolado como obrigatório e não como reforço do adversarial.

**Defeito de origem reconhecido, e é reincidência de 2 dias:** o A1 existe porque o orquestrador conferiu
que o **nome** `audit` existia em `soma.cjs:48` e afirmou a superfície **sem abrir `audit.cjs`**. A regra
já estava escrita no Failure Log em 2026-08-21: *"`ls` prova existência, NUNCA conteúdo. Se a afirmação é
sobre o QUE o arquivo é, `cat`/`wc -c` ou não afirme."*

---

## Estado deste arquivo

Escrito **untracked**, sem branch e sem commit. É o mesmo estado em que a **020** e a **021** nasceram em
2026-08-22.

⚠️ **Esta seção já apodreceu uma vez, no mesmo dia.** Quando a spec foi escrita, o repo estava em
`fix/orphan-node-test-process` com 4 arquivos de teste modificados, e a seção mandava não commitar por
causa disso. Medido algumas horas depois: branch = **`feature/019-gates-que-nao-pegam`**, `git status`
mostra **só** `?? core/specs/023-piso-de-contexto-da-instrucao/`. Outra sessão mexeu no repo no intervalo.
**Estado de working tree não se declara em documento — se mede na hora.** Antes de criar branch ou
commitar, rode `git branch --show-current && git status --short` e decida com o que voltar.

**Quem decide o número da spec, a branch e a ordem contra 019/020/021/022 é a sessão do `soma`.**
