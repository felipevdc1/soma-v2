# Spec: Gate de Operador — o SOMA mede o artefato e não mede quem opera

**Feature ID:** 024-gate-de-operador
**Branch:** `feature/024-gate-de-operador`
**Created:** 2026-08-23
**Status:** DRAFT — pronta para Gate 1. As 6 questões bloqueantes foram resolvidas por medição (§Decisões),
e o documento passou por 5 lentes adversariais + 2 leitores em contexto isolado (§0.5).

---

## §0 Superfície fixada

Toda afirmação carrega como foi obtida. Número sem lastro é achado, mesmo quando está certo.
**Todo comando de proveniência desta seção roda a partir da raiz do repositório**
(`/Users/felipevdc1/Documents/- projetos claude code/soma-v2`); rodado de outro cwd, produz número
diferente e plausível, sem erro visível.

### §0.1 Inventário do SOMA (medido 2026-08-23, `main` = `cbd95a7`)

| fato | valor | como foi obtido |
|---|---|---|
| Hooks em `core/hooks/*.cjs` | **19** | `ls core/hooks/*.cjs \| wc -l` |
| Hooks com `exit(2)` no código-fonte | **10** | `grep -c 'exit(2)'` por arquivo |
| Destes, que **bloqueiam por padrão** (sem env extra) | **6** — `agent-mode-gate`, `framework-guard`, `pre-commit-gate`, `spec-completeness-gate`, `spec-test-traceability`, `thermal-guard` | inspeção de cada `exit(2)`; o único `HARD` do `spec-test-traceability` está em comentário (`:202`) |
| Destes, **soft por padrão** (só bloqueiam com env setada) | **4** — `capture-defer-gate` (`ARTICLE_XI_HARD`), `discover-before-specify` (`ARTICLE_XII_HARD`), `insight-action-coupling` (`INSIGHT_COUPLING_HARD`), `hyd-gate` | `hyd-gate.cjs:34` = `const ENFORCE = false;` — **hardcoded, nem é env** |
| Hooks que tratam comando destrutivo | **0** | `grep -rlE "rm -rf\|pkill\|\bkill\b" core/hooks/*.cjs` → vazio |
| `thermal-guard` — escopo real | só `Agent`; nunca vê `Bash` | `thermal-guard.cjs:143-144` — condição `if (!/^Agent$/i.test(toolName))` seguida de `process.exit(0)` |
| `payload.cwd` existe e é a fonte confiável de diretório | sim | `framework-guard.cjs:196` (ordem: `cd` no início → `payload.cwd` → `process.cwd()`) |
| `hyd-gate` — eventos / `WOULD_BLOCK` / bloqueios reais | **8.747 / 4.985 / 0** | parse de `~/.claude/logs/hyd-gate.log`, 2026-04-14 → 2026-08-23 |
| `hyd-gate` — sessões em que disparou / seguidas de `/hyd` rodado | **152 / 0** | mesmo parse; reconferido por auditor independente: 152 exato |
| `insight-action-coupling` — violação 1ª metade → 2ª metade | **20% → 60%** (n=10) | parse de `~/.claude/logs/insight-coupling-*.jsonl` |
| Hooks que escrevem telemetria JSONL | **3** — `capture-defer-gate` (`article-xi-telemetry/v1`), `discover-before-specify` (`article-xii-telemetry/v1`), `insight-action-coupling` (`insight-coupling/v1`) | `grep -l jsonl core/hooks/*.cjs`; forma comum: `<slug>/v1` + `~/.claude/logs/<slug>-<YYYY-MM-DD>.jsonl` |
| `install-targets.json` (adapter claude) — entradas | **34** = 3 `block` + 31 `kind:"file"` | `json.loads` com strip de comentários; 19 das `file` são os hooks de topo |
| `core/hooks/lib/*` tem entrada no install-targets? | **não** — chega por `rsync -a` | `install.sh:189`; grep por `lib` nas entradas = 0 |
| Shell em que o Bash tool executa | **zsh 5.9** (`$0` = `/bin/zsh`) | `echo $ZSH_VERSION $BASH_VERSION $0` |
| Defeitos do orquestrador em 1 sessão (2026-08-23) | **12**, dos quais **0** cobertos por qualquer hook | classificação manual contra os 19 hooks |

> Artefatos vivos crescem entre medições: reconferidos horas depois, os `.jsonl` de sessão foram de 614→623
> e o `hyd-gate.log` de 8.747→8.789 linhas. As **frações que decidem** (0 bloqueios, 152 sessões) não mudaram.

### §0.2 Corpus de comandos reais (medido 2026-08-23)

Base empírica de toda decisão de frequência. Extração: `python3` + `json`, glob recursivo em
`~/.claude/projects/**/*.jsonl`, filtrando `type=='tool_use' and name=='Bash'` → `input.command`.
Corpos de heredoc mascarados antes de qualquer split — sem isso, prosa dentro de mensagem de commit era
contada como comando (bug achado e corrigido durante a medição).

**614** arquivos `.jsonl`; **542** com ≥1 chamada Bash; **17.083** comandos; 0 erros de parse.

Frequência por **comando distinto** (não por ocorrência), e por sessão (÷542). A régua de cada linha é um
regex sobre o campo `cmd`, excluindo `|`, `;` e `&` para não capturar o argumento de um comando vizinho:

| forma | comandos | por sessão |
|---|---|---|
| `2>/dev/null` (qualquer) | 2.829 | 5,220 |
| `\|\| echo` (fallback) | 1.001 | 1,847 |
| `grep -c` | 791 | 1,459 |
| `rm -rf` / `-fr` | **198** (217 ocorrências; 210 com alvo extraível) | 0,365 |
| `git log … -- <path>` | **160** | 0,295 |
| `git diff A..B` | 118 | 0,218 |
| `\|\| true` | 100 | 0,185 |
| `pkill` (qualquer) | 38 | 0,070 |
| `kill -9` | 14 | 0,026 |
| `find -newerXY <timestamp que o bfs rejeita>`, fora de `ssh`/`docker` | **16** (7 sessões) | **0,030** |
| `for X in $VAR` (sem `${=VAR}`) | 8 | 0,015 |
| `git reset --hard` | 3 | 0,006 |
| `awk '$0 >[=] "<data>"'` | **0 em escopo** (2 brutos: 1 dentro de `ssh`, 1 é prosa deste próprio Failure Log) | 0 |
| `git clean` com `-x` | **0** (9 brutos, **todos** menção em prosa dentro de `echo`/heredoc) | 0 |
| `killall` | **0** | 0 |

Alvos dos **210** `rm -rf` com alvo extraível: 39,5% `tmp`/scratch literal · **36,2% variável opaca (`$X`)** ·
19,0% relativo ao cwd · 2,9% raiz absoluta · 2,4% `HOME`. Isentando o primeiro grupo, restam **127
ocorrências = 0,234/sessão**.

Uso PROVA vs EXPLORAÇÃO (classificação manual): `grep -c` 15/15 PROVA; `git log -- path` 73%;
`git diff A..B` 67%. Reconferência independente (n=10, outro anotador, outro método): **70% PROVA no geral,
nenhuma categoria 100% de forma robusta** — a margem honesta é 20-30% de exploração legítima.

Latência (30 amostras, formato real: hook Node que executa `pgrep` internamente, sequencial):
**p50 = 35,5 ms · p95 = 36,8 ms**. Piso do `node -e ""` ~18-25 ms. Nenhum hook do SOMA mede latência hoje.

`lsof -a -p <pid> -d cwd` devolve o cwd de processo alheio **sem sudo** nesta máquina (medido).

### §0.3 O que esta rodada REFUTOU

**A premissa da regra-bandeira estava errada.** O Failure Log, o handoff e a primeira versão desta spec
afirmavam: *"`find -newermt` é GNU-ism; no macOS devolve `0` silenciosamente"*. **Falso.** Medido com
controle discriminante (arquivo criado no instante, quatro réguas lado a lado):

| régua | resultado |
|---|---|
| `find -newermt "<ISO>"` | **1** — correto |
| `find -newermt "5 minutes ago" 2>/dev/null` | **0** — silêncio |
| idem, **sem** `2>/dev/null` | `bfs: error: Invalid timestamp`, `rc=1`, com a lista de formatos aceitos |
| `/usr/bin/find -newermt "5 minutes ago"` | **1** — o BSD find do macOS aceita, inclusive relativo |

Mecanismo real: no Bash tool, `find` **não** é o BSD find — é uma **função de shell** injetada pelo Claude
Code que despacha para **`bfs 4.1.1`**. Quem transforma o erro alto em zero mudo é o `2>/dev/null`; no corpus,
**16 de 16** usos locais com timestamp rejeitado carregam `2>/dev/null` — 100%, em 7 sessões. Uma das 16 era
um **controle** que o próprio operador escreveu para detectar régua cega; o controle era cego pelo mesmo motivo.

**Formatos que o `bfs 4.1.1` desta máquina ACEITA** (medido um a um, não inferido): `@<epoch>` ·
`YYYY-MM-DD` · `YYYY-MM-DDThh:mm:ss` · `…±hh:mm` · `…Z`. **`@epoch` não é ISO-8601** — uma regra escrita
como "bloqueia o que não casa ISO" produziria falso-positivo. A regra tem de ser a **lista de aceitos
medida contra o binário**, não uma noção de ISO.

### §0.4 Superfície fixada da implementação

Nomes e algoritmos ficam aqui, **antes** de qualquer AC usá-los. Executor que precisar de um nome que não
está nesta seção **para**, e não inventa.

| item | valor fixado | precedente |
|---|---|---|
| Hook | `core/hooks/operator-gate.cjs` (arquivo único; sem dispatcher/módulos) | os 19 hooks são arquivo único |
| Evento / matcher | `PreToolUse`, `matcher: "Bash"` | `framework-guard` |
| Corpus de regras de forma | `core/hooks/blindness-rules.json`, entrada `kind:"file"` no `install-targets.json` do adapter claude | idêntico aos 19 hooks (D-024-03) |
| Wiring | entrada nova em `install/soma-hooks-map.json`, dentro do objeto `matcher:"Bash"` **já existente** | não criar segundo objeto `Bash` |
| Telemetria | schema `operator-gate/v1`, arquivo `~/.claude/logs/operator-gate-<YYYY-MM-DD>.jsonl` | forma dos 3 hooks JSONL da §0.1 |
| `session_id` | env var, como os hooks existentes (não campo do payload) | §0.1 |
| Bypass | `/tmp/claude-operator-gate-bypass-<sessionId>.marker`, **one-shot: consumido no uso** | `hyd-gate` bypass |
| Opt-out global | respeita `/tmp/claude-direct-mode-<sessionId>.marker` | convenção existente |
| Instrumento de latência | `core/hooks/__tests__/operator-gate.bench.cjs`, ≥30 amostras, imprime p50/p95, **não** roda no CI | não existe precedente; nasce aqui |
| **É scratch (isento)?** | `path.resolve(cwd, alvo)` começa com `os.tmpdir()`, `/private/tmp/claude-501/`, ou `/tmp/` — **resolvido, nunca por prefixo textual** | ver AC-01 |
| **É fixture (fora da telemetria)?** | `path.resolve` do cwd contém `/__tests__/`, `/fixtures/`, ou está sob `os.tmpdir()` | corrige o defeito medido do Article XII |
| **Alvo opaco?** | o token contém `$`, `` ` `` ou `$(` após remoção de aspas | ver AC-01 |
| **É remoto (não dispara)?** | o comando começa com `ssh ` ou `docker exec ` **ou** o alvo está dentro de string passada a um deles | D-024-07 |
| `stdin` vazio ou malformado | `exit 0` — **exceção explícita ao fail-closed**, seguindo os 19 hooks | ver NFR |

### §0.5 O que a auditoria de Gate 1 mudou

5 lentes adversariais + 2 leitores em contexto isolado, antes deste Gate. **30 achados e 23 pontos de
invenção.** O que mudou de substância, e não só de redação:

- **O corpus do AC-02 caiu de 4 regras para 2.** `for X in $VAR` foi **removida**: em zsh, o **mesmo texto**
  está certo quando a variável é array e errado quando é escalar (medido: array de 3 → 3 voltas; escalar
  `"a b c"` → 1 volta). Falha o critério (b) do D-024-01. `awk '$0 >= "<data>"'` foi **removida**: seus 2
  espécimes são 1 dentro de `ssh` (fora de escopo por D-024-07) e 1 prosa — **0 em escopo**.
- **A isenção do `rm -rf` era contornável por travessia** (`tmp/../importante` começa com `tmp/`). Passou a
  ser por caminho **resolvido**.
- **Três números meus estavam errados** e foram corrigidos: `git clean -fdx` (1 → **0**, todos os brutos eram
  menção em prosa), `-newerXY` (15 comandos / 9 sessões → **16 / 7**; o 9 vinha de população que incluía `ssh`),
  e `rm -rf` (a tabela dizia 198 e o parágrafo 210 — são comandos × ocorrências, agora declarados).
- **Um número do auditor estava errado**: `git log -- <path>` = 208 pela régua dele, **160** pela minha; a
  dele contava `--` que pertencia a um comando depois de `|` ou `;`. Régua reproduzida antes de concluir.
- **`bfs` também aceita `@epoch`** — a regra deixou de ser "não-ISO" e virou lista de aceitos medida.
- **`AC-05` citava 4 hooks como precedente de JSONL; são 3** (`agent-mode-gate` só escreve marker).
- **A §0.1 rotulava 10 hooks como "bloqueiam"** quando 4 deles são soft por padrão — inclusive o `hyd-gate`,
  que a própria spec usa como prova de que warn-only falha.

---

## User Stories

- Como **operador de uma sessão longa**, quero que uma forma de comando que **não consegue acusar em nenhum
  uso** seja barrada antes de rodar, pra eu não concluir "0 achados" de uma régua quebrada.
- Como **dono da máquina**, quero que um comando destrutivo de escopo amplo exija a lista concreta do que
  seria atingido antes de rodar, pra que matar processo de outro projeto seja impossível por acidente e não
  apenas detectável depois.
- Como **mantenedor do SOMA**, quero uma régua medida por máquina que diga se este gate serve, pra poder
  **matá-lo** sem depender da minha honestidade sobre os meus próprios erros.

---

## Outcome & Guardrails

**OUTCOME** — observável, medido por máquina, sem depender de eu contar meus defeitos:

1. **Primário:** numa sessão real, **zero** comandos que casam **qualquer regra desta feature** (as do AC-01
   e as do AC-02) executam sem bloqueio. Reconciliação: eventos `blocked` do log `operator-gate/v1` × os
   comandos do transcript da sessão. **Instrumento verificado:** comando barrado por hook aparece no
   transcript como `tool_use` com o comando completo seguido de `tool_result` com `is_error: true` e
   `toolDenialKind: "permission-rule"` — medido durante a auditoria, a reconciliação é possível.
2. **De controle (calibração, nunca gate):** varredura de retratação nos transcripts — toda admissão de
   *"a régua estava errada"* deve ter um evento de bloqueio antecedente na mesma sessão. Sem ele, é
   falso-negativo do corpus e vira **candidata a regra nova**, que só entra pelo critério do D-024-01.
   **Falso-positivo conhecido e declarado:** este repositório usa "régua cega" e "falso-positivo" como
   *nome de padrão de engenharia*; a varredura tem de excluir ocorrência dentro de bloco de código,
   de `echo`/heredoc e dos próprios arquivos de doutrina.

**Por que a régua antiga foi trocada:** ela dizia *"a classe régua cega cai de 8 para ≤2"*. Dos 8 defeitos
dessa classe em 2026-08-23, apenas **2** são decidíveis pelo texto do comando; os outros 6 são erros de
semântica da régua, invisíveis ao texto. No melhor caso a feature entrega 8 → 6, e o critério de morte
mataria a feature por um alvo impossível, não por implementação ruim.

**CRITÉRIOS DE MORTE** — os dois medidos por máquina:
- **(a)** 3 sessões reais consecutivas com **0 bloqueios** → o gate não tem alvo → remove a feature.
- **(b)** taxa de bypass > 20% dos bloqueios **de uma regra** → aquela regra é falso-positivo → remove
  **a regra**, não a feature.

**APPETITE** — **uma sessão**. Se estourar, corta o **AC-04**; o OUTCOME primário continua verificável
sobre as regras restantes. **Não corta o AC-01**: sem o gate destrutivo, o dano da classe mais cara
continua possível e é irreversível.

**NO-GOS**:
1. **Não vai gatear forma frequente.** `grep -c` (1,46/sessão), `git log … -- <path>` (0,295) e
   `2>/dev/null` isolado (5,22) **não entram em regra nenhuma** — nem bloqueio, nem aviso.
2. **Não vai nascer em warn-only.** Medido: `hyd-gate` disparou em 152 sessões e mudou comportamento em **0**
   (e o enforcement dele é `const ENFORCE = false` hardcoded há 4 meses); o `insight-coupling` teve a
   violação **subindo** 20%→60%.
3. **Não vai julgar intenção.** Por isso o corpus só admite forma errada **nos dois** usos — ver D-024-01.
4. **Não vai reescrever nem mover o `CLAUDE.md`.** É a spec 023.
5. **Não vai emitir telemetria que mede a si mesma.** Detecção de fixture fixada na §0.4.

---

## Decisões

**D-024-01 — o AC-02 bloqueia, e o corpus é governado por critério de admissão medido.**
A pergunta original ("bloquear é certo em prova e errado em exploração, e o hook não distingue") se dissolve
ao mudar o critério de entrada: **só entra a forma que está errada nos dois usos**. Uma regra é admitida se:
  (a) dispara **≤ 0,05×/sessão** no corpus de 17.083 comandos; **e**
  (b) o caso em que dispara é **sempre** errado, provado por controle **negativo** (caso conhecido-ruim →
      acusa) **e positivo** (caso conhecido-bom → fica quieto). Os dois controles vivem em
      `core/hooks/__tests__/fixtures/operator-gate/<rule-id>/{bad,good}.txt`, e um meta-teste falha se
      alguma regra do corpus não tiver os dois.
Isso exclui `grep -c`, `git log … -- <path>` e `2>/dev/null` isolado — e **excluiu, na auditoria,
`for X in $VAR`**, que parecia caber e não cabe (§0.5).

**D-024-02 — o antigo AC-03 (lembrete pós-fato via `PostToolUse`) está CORTADO. O número fica aposentado.**
Evidência: 0 de 152 sessões com `WOULD_BLOCK` mudaram comportamento; a violação do `insight-coupling`
**subiu** 20%→60%; nenhum hook `PostToolUse` local demonstra que texto injetado chega ao modelo.
Pré-requisito para ressuscitar, e é empírico: provar, com hook descartável, que
`hookSpecificOutput.additionalContext` em `PostToolUse` aparece no turno seguinte.

**D-024-03 — o corpus mora em `core/hooks/blindness-rules.json` com entrada `kind:"file"`** no
`install-targets.json` do adapter claude — o mesmo transporte dos 19 hooks. **Não** em `core/hooks/lib/`:
`lib/` chega por `rsync -a` (`install.sh:189`) mas não tem entrada no install-targets, logo fica fora do
ledger e a drift nele é invisível ao `sync`/`doctor`. Regra que exige execução mora no código, com o campo
`kind` no JSON distinguindo `static-regex` de `dynamic-check`.

**D-024-04 — o orçamento de latência cabe, com uma exceção declarada.** p50 = 35,5 ms, p95 = 36,8 ms no
formato real (hook Node executando `pgrep`). Teto: **45 ms de p95**. A primeira estimativa ("não cabe no
p95") vinha de **somar p95 de processos separados** — inferência refutada por medição direta.
**Exceção:** a enumeração de arquivos do `rm -rf` (AC-01) é I/O de diretório e **não** está coberta por
essa medição — ver o teto próprio no AC-01. O instrumento de medição nasce **junto** com o AC-01 (§0.4).

**D-024-05 — "mesmo projeto" é `payload.cwd`** (`framework-guard.cjs:196`), não match no texto. Para
processo já vivo, `pgrep` acha candidato e **`lsof -a -p <pid> -d cwd`** confirma o cwd — sem sudo (medido).
`pgrep` sozinho foi a causa direta do **incidente do `pkill`** de 2026-08-23 (o que matou o `npm test` de
outro projeto — não o do empilhamento de suítes, que é o outro incidente daquele dia).

**D-024-06 — a régua do OUTCOME não pode depender de eu contar meus defeitos.** Trocada por medição de
mecanismo mais varredura de retratação como calibração. Limite declarado: mecanismo é **proxy**, nunca prova
de que a conclusão saiu errada.

**D-024-07 — toda regra declara o binário e a versão em que foi medida.** O mesmo texto tem semântica
diferente conforme o que resolve: `find` no Bash tool é `bfs 4.1.1`; `/usr/bin/find` é BSD; dentro de
`ssh`/`docker` é GNU findutils. Regra sem binário declarado **não entra**, e comando remoto **não dispara**
(detecção fixada na §0.4). *Esta decisão não resolve uma das 6 questões — ela nasceu da refutação da §0.3.*

**D-024-08 — regra que perde o último espécime em escopo sai do corpus.** Aplicado na auditoria a
`awk '$0 >= "<data>"'`: o incidente que a motivou aconteceu dentro de `ssh`, e o D-024-07 diz que ali o hook
não dispara. Regra que nunca teria pego o próprio incidente que a originou não entra.

---

## Acceptance Criteria

### AC-01: WHEN um comando Bash casa um padrão destrutivo de escopo amplo, the framework SHALL bloquear com exit 2 e imprimir a lista concreta do que seria atingido.

Padrões no escopo, com a frequência medida que justifica o custo:
`pkill` (0,070/sessão) · `kill -9` (0,026) · `killall` (0 espécimes; entra por simetria de dano) ·
`git clean` com `-x` (0 espécimes; idem) · `git reset --hard` (0,006) · `rm -rf` **cujo alvo resolvido não
esteja sob scratch** (0,234/sessão após a isenção).

Formas de `rm` que contam: `-rf`, `-fr`, `-r -f` em qualquer ordem, `-R` maiúsculo, `--recursive --force`,
e as mesmas precedidas de `sudo` ou de `\` (escape de alias).

**Isenção por caminho resolvido, nunca por prefixo textual.** `path.resolve(cwd, alvo)` decide (§0.4) —
`rm -rf tmp/../importante` começa com `tmp/` e **não** é isento.

Extração do alvo do `pkill`: se o comando tem `-f`, o padrão vai para `pgrep -f`; sem `-f`, para `pgrep`
sem `-f`. Flags de sinal (`-9`, `-SIGKILL`) e de seleção (`-u`, `-g`, `-P`) são consumidas como flags; o
padrão é o primeiro token não-flag restante.

A mensagem SHALL nomear **quantos e quais** processos/arquivos casam, **antes** de qualquer destruição —
para processo, `pgrep` mais `lsof -a -p <pid> -d cwd` exibindo o cwd de cada candidato (D-024-05) — e SHALL
oferecer a **forma estreita equivalente**, derivada assim: para `pkill`, `kill <pid>` com os PIDs listados;
para `git clean`/`git reset`, a mesma flag com `-- <path>` do cwd; para `rm -rf`, o alvo expandido.

**Teto de latência próprio:** a enumeração do alvo do `rm -rf` SHALL parar em **200 entradas ou 100 ms**, o
que vier primeiro, e a mensagem SHALL declarar quando truncou. Sem esse teto, um `rm -rf` sobre árvore
grande estoura o orçamento de 45 ms (D-024-04).

**Limite declarado, não escondido:** 36,2% dos `rm -rf` do corpus miram uma **variável opaca** (`$X`), que
um hook de texto não resolve. Nesses casos o hook SHALL declarar que **não consegue decidir** e bloquear
pedindo o alvo expandido — nunca passar em silêncio.

Incidente que originou: 2026-08-23, `pkill -9 -f "^npm test"` matou o `npm test` de outro projeto (PID 9022,
16 min de execução). O controle escrito na mesma chamada **detectou depois do dano**.

### AC-02: WHEN um comando Bash casa uma regra admitida do corpus, the framework SHALL bloquear com exit 2 e nomear por que aquela forma não consegue acusar.

Corpus inicial — **duas** regras. Cada uma passou no critério do D-024-01 e declara o binário do D-024-07.
Duas outras candidatas foram reprovadas na auditoria e o motivo está na §0.5 — o corpus é pequeno de
propósito, e cresce por medição, nunca por intuição.

| id | regra | binário | frequência | por que está sempre errada |
|---|---|---|---|---|
| `bfs-timestamp` | `find -newerXY <timestamp fora da lista de aceitos do binário>` | `bfs 4.1.1` | 0,030/sessão | o bfs rejeita e sai com `rc=1`; 16/16 usos no corpus escondem o erro com `2>/dev/null`. A lista de aceitos é a medida na §0.3 (`@epoch`, `YYYY-MM-DD`, `…Thh:mm:ss`, `…±hh:mm`, `…Z`) — **não** "é ISO?" |
| `git-same-object` | `git diff A..B` / `git log A..B` com `rev-parse A` == `rev-parse B` | `git` | subconjunto degenerado dos 0,218/sessão (a população degenerada em si não é contável por texto — declarado) | vazio **por construção**; sairia vazio mesmo se tudo tivesse mudado |

Comportamento fixado da `git-same-object`, para não sobrar escolha ao executor:
- extração de A e B tolera flags no meio (`git diff --stat A..B`);
- `A...B` (três pontos) **não** dispara — é outra semântica; e a extração SHALL ser não-gulosa para não
  capturar `A.` a partir de `A...B`;
- se `rev-parse` de A ou B **falhar** (ref inexistente), o hook **deixa passar** — não é o caso "vazio por
  construção" que a regra existe para pegar, e bloquear ali seria inventar escopo;
- `git diff` sem argumento de revisão não dispara.

A lista de regras de forma vive no arquivo do D-024-03; a `git-same-object` exige execução e mora no código,
declarada no JSON com `kind: "dynamic-check"`.

### AC-04: WHEN duas ou mais suítes de teste do mesmo `cwd` estão vivas simultaneamente, the framework SHALL bloquear o lançamento de uma nova, com bypass registrado.

"Lançar suíte" é a lista fechada: `npm test`, `npm run test*`, `pnpm test`, `yarn test`, `node --test`,
`pytest`, `jest`, `vitest`, `go test`, `cargo test`. Deliberadamente **não** inclui `npm start`/`npm run
build` — o `thermal-guard.COMPILE_KEYWORDS` mistura os dois e é sobre prompt de `Agent`, não sobre `Bash`.

"Mesmo projeto" é `payload.cwd` mais confirmação por `lsof` do cwd dos processos vivos (D-024-05).
Hoje o `thermal-guard` cobre apenas `tool_name === 'Agent'` (`thermal-guard.cjs:143-144`) e nunca vê `Bash`.
Em 2026-08-23 quatro `npm test` do mesmo repo se empilharam, travaram nos mesmos três testes disputando
`~/.soma-v2`, e produziram três diagnósticos errados antes de alguém olhar o `ps`.

### AC-05: The framework SHALL registrar, por sessão, quantas vezes cada regra bloqueou, quantas vezes o bypass foi usado, e quais comandos casaram sem bloquear.

Schema `operator-gate/v1` em `~/.claude/logs/operator-gate-<YYYY-MM-DD>.jsonl` (§0.4) — a mesma **forma**
dos 3 hooks do repo que escrevem JSONL, embora cada um use o próprio slug.
O registro SHALL excluir execução cujo cwd seja fixture ou caminho de teste, pela regra fixada na §0.4
(NO-GO 5). É este log que alimenta os dois critérios de morte — sem ele a feature não é falsificável.
Incidente que originou: a telemetria do Article XII acumulou 11.811 entradas das quais ~6 são de trabalho
real; 80% são fixture, e 2.361 são de um único caminho de teste.

---

## Non-Functional Requirements

- **Custo por chamada**: o hook roda antes de **todo** comando Bash. Teto **45 ms de p95** (D-024-04), com a
  exceção da enumeração de `rm -rf`, que tem teto próprio no AC-01. O instrumento nasce com o AC-01.
- **Fail closed com uma exceção declarada**: exceção inesperada dentro do hook SHALL bloquear com mensagem
  acionável, nunca `exit 0` mudo — precedente: o `catch` externo do `framework-guard` fazia isso e foi
  consertado em `ef39505`. **A exceção é `stdin` vazio ou malformado, que SHALL sair 0**, como fazem os 19
  hooks: tratar isso como erro faria o hook barrar todo comando Bash num hiccup do harness.
- **Proibido no próprio hook**: `|| true`, `2>/dev/null`, `|| echo`, `?.` e `catch{}` silencioso em qualquer
  caminho de verificação. O achado da §0.3 é a prova: foi o `2>/dev/null` que transformou erro alto em zero
  mudo em 16 de 16 casos.
- **Bypass**: marker one-shot da §0.4, registrado (alimenta o critério de morte (b)). Gate sem escape vira
  gate desligado.
- **Zero dependência nova**: Node puro, como os outros **19** hooks.

---

## Out of Scope

- Reescrever, particionar ou mover o `CLAUDE.md` — é a spec **023**.
- Regra sobre conteúdo de spec, AC ou cobertura de teste — já é `spec-completeness-gate` e
  `spec-test-traceability`.
- Detectar "o operador raciocinou mal". Só forma de comando é decidível — e, medido, isso alcança 2 dos 8
  defeitos da classe. A spec não promete mais que isso.
- Migrar o `hyd-gate` para enforce — decisão própria, pendente desde 2026-04-20. (Medido aqui, para quem
  for fazê-la: o enforcement dele é `const ENFORCE = false` hardcoded, não uma env var.)
- Comando dentro de `ssh …` ou `docker exec …` — semântica de binário diferente (D-024-07).

---

## Completeness Checklist

- [x] Cada AC é binário e observável
- [x] AC-01, AC-02 e AC-04 citam o incidente medido que os originou; AC-05 cita o defeito de telemetria
      medido no Article XII
- [x] Todo número da §0 tem procedência declarada, e os divergentes foram reconciliados na §0.5
- [x] NO-GOS ≥ 2 (são 5)
- [x] Critério de **morte** declarado e medido por máquina (dois)
- [x] As 6 questões bloqueantes resolvidas por medição (D-024-01 a D-024-06); D-024-07 e D-024-08 nasceram
      da refutação e da auditoria
- [x] Premissa refutada declarada em vez de silenciosamente corrigida (§0.3)
- [x] Superfície de implementação fixada antes dos ACs (§0.4), fechando os 23 pontos de invenção apontados
      pelos leitores em contexto isolado
- [x] Leitura adversarial (5 lentes) + 2 leitores em contexto isolado — resultado na §0.5
