# Spec: Fail-silent no código e na suíte — os mecanismos que não produzem erro

**Feature ID:** 020-fail-silent-no-codigo
**Branch:** `feature/020-fail-silent-no-codigo`
**Created:** 2026-08-22
**Status:** DRAFT — precisa de Gate 1

> **Origem:** extraída da spec 019 pela **D-019-04** em 2026-08-22. A 019 tinha como alvo declarado, em
> dois lugares do próprio texto, *"os artefatos que ele mesmo gera"* e proibia *"auditoria adversarial de
> código de aplicação"* — mas cinco dos seus ACs tinham por sujeito código de produção e suíte de testes.
> A contradição era textual, não interpretativa. Esta spec recebe esses cinco, mais dois mecanismos que a
> auditoria achou órfãos.
>
> **Todas as medições abaixo foram feitas contra `origin/main` = `91c1b27`** e reverificadas em 2026-08-22
> por agentes independentes, cada um com régua validada nos dois sentidos. Nada aqui é hipótese.

---

## Estado empírico

| lacuna | onde vive hoje | confirmada por |
|---|---|---|
| **G11** fixture deriva do formato de produção | `core/scripts/__tests__/install-cli.contract.test.cjs:326` × produção | a fixture injeta `<!-- soma:start id=...`; a produção casa `<!-- soma-v2:start` (`lib/anchored-blocks.cjs:36`) e o legado bare `<!-- NAME:start -->` (`lib/migration.cjs:71`). O marcador do CC-07 **não casa nenhum dos dois** |
| **G12** guarda assere sobre um dublê, não sobre o sujeito | 1ª versão de `install-home-isolation-guard.test.cjs` | passou **verde** enquanto o `runInstall()` real escrevia 32 arquivos no `$HOME` ambiente |
| **G13** mesmo nome de campo, duas réguas | `doctor.cjs:846` × `bootstrap.cjs:330` | mesmo `somaHome`: `doctor` reporta `install_targets_count` **8**, `bootstrap` **39**. Reproduzido executando os dois |
| **G14** ambiente de medição carrega o objeto medido | `phase3-regression:192` · `phase4a-regression:81` · `hooks-regression:108` | `spawnSync(wrapper, {timeout})` mata o **wrapper**, não o neto → `node --test` órfão com `PPID=1` rodando **119** arquivos contra o `~/.soma-v2` vivo (180 é a contagem crua do diretório; o código filtra antes) |
| **G15** remediação recortada pelo sintoma | — | Bucket G escopado por *"quais testes falham"*; o que escrevia no `$HOME` **passava** |
| **G16** leitor sem strip perde dado em silêncio | `core/scripts/install.cjs:655` `readBlockIdsFromTargetsFile` | é o único dos 4 leitores de `install-targets.json` que não faz strip de comentário antes do `JSON.parse`, e o `try/catch` devolve `[]` para qualquer erro. Documentado em `core/specs/018-install-whole-files/plan.md:280` como *"Achado colateral"*, nunca promovido |
| **G17** dependência opcional sem contrato de abort exercitado | `CONTRACT-01` (`core/specs/015-soma-install/contracts/install-cli.md:3`) | nenhum teste cobre *"Codex NÃO instalado → aborta com a mensagem do CONTRACT-01"*. `install.cjs:1156-1163` exige `~/.codex/`; CC-02b/CC-02c passavam porque `~/.codex` existe na máquina. Pendência nomeada no merge `91c1b27`, nunca fechada |

**G16 e G17 foram achados pela auditoria da 019** e não estavam em nenhuma lista. O G17 é o quarto item
da seção *"PENDÊNCIAS NOMEADAS, NÃO ESQUECIDAS"* do próprio merge commit da 018 — três dos quatro viraram
G11/G13/G14, e o quarto ficou sem menção em lugar nenhum.

---

## User Stories

- Como quem lê a suíte verde, quero que um teste que exercita o caminho errado **falhe alto**, pra que
  "verde" e "vermelho" voltem a significar o que dizem.
- Como quem mede, quero que o ambiente de medição não carregue o objeto medido, pra que controle seja
  controle.

---

## Outcome & Guardrails

**OUTCOME** — cada um dos sete mecanismos tem um teste que fica **vermelho** contra o estado defeituoso
que o revelou e verde depois. Hoje seis deles não produzem erro nenhum: produzem silêncio.

**APPETITE** — o **G14 vem primeiro e sozinho**, porque enquanto o `node --test` órfão viver a suíte tem
flake de ±1 de causa conhecida, e nenhuma prova de dois lados dos outros seis é confiável. Ver a
dependência declarada abaixo.

**NO-GOS**
- Não consertar o sintoma: cada um destes é conserto de **classe**. O G15 existe justamente porque um
  recorte por sintoma quase deixou passar a metade silenciosa.
- Todo gate ou teste novo nasce com caso conhecido-ruim que o dispara **e** conhecido-bom que ele ignora.

🔴 **Dependência invertida com a spec 019, declarada nas duas**: o AC-04 desta spec (o processo órfão) é
pré-requisito da prova de qualquer gate da 019, embora esta spec seja posterior em número.

---

## Acceptance Criteria

### AC-01: IF a fixture de um teste codificar um marcador que nenhum caminho de produção reconhece, THEN the sistema SHALL falhar alto em vez de exercitar outro caminho

Given uma fixture cujo marcador **não casa nem** o regex atual (`anchored-blocks.cjs:36`,
`<!-- soma-v2:start` com atributos) **nem** o regex de legado explicitamente suportado
(`migration.cjs:71`, `<!-- NAME:start -->` bare, sem atributos) / When o teste roda / Then ele acusa a
deriva. **Hoje exercita outro caminho em silêncio**: sem marcador reconhecido, o install trata como
*"bloco ausente"* e **reinstala com sucesso**, em vez de detectar drift. O `CC-07` **nunca testou o
`BF-06` que ele diz testar** — ficava vermelho por colisão acidental com os hooks reais da máquina, e a
vermelhidão acidental o fez parecer vivo por meses.

🔴 **A régua é a da produção, não uma régua nova** — é isso que evita o falso-positivo. Medido: usar
"marcador de formato antigo" como critério acusaria **oito** arquivos de teste que codificam formato
legado **de propósito**, para provar detecção/upgrade/drift:

`issue-11-legacy-upgrade-handler.test.cjs` · `doctor-migration.contract.test.cjs` ·
`doctor-mixed-kind-block-drift.test.cjs` · `doctor.drift-detection.test.cjs` ·
`lib-anchored-blocks.test.cjs` · `migrate-cbm-deprecation.test.cjs` ·
`core/scripts/lib/__tests__/migration.test.cjs` · `core/tests/integration/bf-04-cbm-e2e.test.cjs`

⚠️ **Correção de contagem, medida em 2026-08-22**: rodando o `startRe` real (`migration.cjs:71`) contra
os 203 `*.test.cjs` versionados, casam **12** arquivos, não 8. Os oito acima estão todos entre os 12
(nenhuma inclusão errada), mas faltam quatro: `bf-03-consolidation-reproducer.test.cjs` ·
`bf-04-cbm-deprecation-reproducer.test.cjs` · `sync.dry-run-edits.test.cjs` ·
`core/tests/phase5/synthetic-validation.test.cjs`. **A lista de oito veio de relatório e não foi
re-medida pelo autor.**

🔴 E há uma contradição interna: `synthetic-validation.test.cjs` está na lista de exclusão abaixo
(*"parecem casos e não são"*) **e** casa o `startRe`. Antes de implementar, resolver os 12 um a um —
separando fixture real em código de menção em comentário.

O `CC-07` não casa nenhum dos dois regexes e é o **caso conhecido-ruim**.

⚠️ **Três arquivos que parecem casos e não são**: `content-preservation.test.cjs`,
`idempotency.test.cjs` e `synthetic-validation.test.cjs` usam marcador bare em **source doc**, que é o
formato **atual** de produção para source docs — confirmado contra `core/docs/hyd-v2.md` real. O
comentário deles chama isso de *"legacy anchor format"*, e o rótulo está errado no próprio código de
teste. Não entram na lista de exceção porque não são casos do AC.

### ~~AC-02~~ — **MORTO. Consertado em `3cfa6e8`, 2026-08-22 10:44:39.** Registro abaixo, sem ação.

Given a primeira versão de `install-home-isolation-guard.test.cjs`, que provava apenas que o **próprio**
`spawnSync` interno dela era seguro / When o `runInstall()` real de `install-cli.contract.test.cjs`
escrevia **32 arquivos** (19 hooks + 12 comandos + `CLAUDE.md`) num `$HOME` limpo / Then o guarda acusa.
**Hoje passava verde.**

🔴 **Este AC nasceu morto, e o erro é do autor.** Medido em 2026-08-22: o guarda **já** importa o
`runInstall` real — `install-home-isolation-guard.test.cjs:66`. O commit é `3cfa6e8`, de **10:44 do mesmo
dia**, e o handoff que o autor leu de manhã o lista textualmente como *"fecha o ponto cego do guarda — ele
vigia o `runInstall()` REAL"*. Foi lido como item aberto e transcrito como AC.

E o critério que o AC chamava de decidível — *"vermelho contra o estado defeituoso anterior"* — é
**inexequível**: o estado defeituoso era uma versão anterior do próprio arquivo de teste, deletada pelo
commit que consertou. Um teste não fica vermelho contra uma versão de si mesmo que não existe mais.

⚠️ **Armadilha medida na própria validação deste AC**: a primeira tentativa de falsificar o guarda trocou
`env: fakeHomeEnv(fakeHome)` por `env: process.env` — **no-op**, porque `withFakeHome` já muta
`process.env.HOME`. Por dois minutos o guarda pareceu cego, e cega estava a mutação. Quando um
falsificador não derruba nada, a primeira hipótese é *"meu falsificador não falsifica"*.

### AC-03: WHERE o mesmo nome de campo for produzido por dois produtores independentes contra a mesma entrada, the sistema SHALL exigir que as réguas concordem ou que a divergência seja declarada

Given `doctor.cjs:846` (`data.entries.filter((e) => !isFileEntry(e)).length`) e `bootstrap.cjs:330`
(`data.entries.length`) / When ambos reportam `install_targets_count` contra o **mesmo** `somaHome` /
Then a divergência é sinalizada. Medido: `doctor` responde **8**, `bootstrap` responde **39**.

🔴 **Casar só pela string do nome gera falso-positivo, e o par legítimo está medido.** Universo: 38 nomes
distintos com sufixo `count`/`total`, 9 produzidos em 2+ arquivos. Destes, **1 defeito real**
(`install_targets_count`) e **1 par legítimo**:

**Caso conhecido-bom obrigatório**: `lib/module-inference.cjs:151` (`files_count: filesCount` — arquivos
de um diretório candidato a módulo) e `lib/snapshot.cjs:394` (`files_count: manifestFiles.length` —
entradas de um manifesto de snapshot). Sujeitos genuinamente diferentes. `init.cjs` e `sync.cjs` apenas
**repassam** esses valores e não são produtores — casar por string nua contaria 4 produtores onde há 2.

O escopo é, portanto: mesmo nome **E** mesma entrada **E** dois produtores independentes.

### AC-04: The sistema SHALL recusar teste que gere script wrapper que ele mesmo spawna processo

Given `phase3-regression.test.cjs:192`, `phase4a-regression.test.cjs:81` e `hooks-regression.test.cjs:108`,
que fazem `spawnSync(NODE_BIN, [wrapperPath], { timeout })`, e o wrapper por dentro faz
`spawnSync(NODE_BIN, ['--test', ...])` / When o timeout dispara / Then o neto morre também.

**Hoje o timeout mata o wrapper e nunca o neto**: o `node --test` sobrevive, é reparentado para `PID 1` e
segue rodando **119 arquivos** contra o `~/.soma-v2` vivo — ⚠️ **correção**: uma versão anterior deste
AC dizia *180*, que é a contagem **crua** de `~/.soma-v2/scripts/__tests__/*.test.cjs`; o código filtra
antes de passar ao `node --test` (`phase4a-regression.test.cjs:202-208`). O 180 foi herdado de relatório,
não medido. Efeito medido: a suíte passou de ~5,5 min para
12 min, e **o mesmo SHA rendeu contagens diferentes**. É a causa do flake de ±1 que este repositório
vinha registrando **sem causa nomeada**.

✅ **CONSERTADO em 2026-08-22, antes desta spec ser aprovada.** Branch `fix/orphan-node-test-process`,
commits `da00a8b` (RED) e `2a3a352` (GREEN), PR #22. O conserto **não** foi matar o neto por grupo de
processo — foi eliminar a camada do wrapper, que é dispensável: medido em Node v22.15.0, `spawnSync`
direto com `NODE_TEST_CONTEXT` removido do env roda o teste interno normalmente. Sem wrapper não há neto.
Escopo: 3 sites, das 29 chamadas `spawnSync` dos três arquivos.

🔴 **Por isso este AC vira REGRESSÃO, não construção.** O que resta é impedir a reintrodução:
o gate estrutural `core/scripts/__tests__/no-nested-test-spawn.test.cjs` acusa qualquer `*.test.cjs` que
gere script wrapper que spawna, e tem controles nos dois sentidos. **Caso conhecido-ruim**: o fixture
sintético que o próprio gate carrega. **Caso conhecido-bom**: `phase4d-regression.test.cjs`, que spawna
direto sem wrapper.

⚠️ **Nota de método**: esta spec já teve um AC (o antigo AC-02) que descrevia trabalho já feito, porque o
autor transcreveu bucket de handoff sem re-medir. Converter este AC no mesmo dia em que o conserto entrou
é o que impede a repetição — *"`DONE` é afirmação sobre o código, não sobre o documento"*.

### AC-05: WHEN uma medição for apresentada como controle, the sistema SHALL declarar se o ambiente contém o artefato sob teste

Given uma medição apresentada como grupo de controle / When o ambiente contém o objeto medido / Then a
contaminação é declarada. Medido em 2026-08-22: um controle rodado no checkout de `origin/main` executou
código da branch 018, porque `~/.soma-v2/scripts/` **é** o build da 018 — o grupo de controle carregava o
tratamento. Só apareceu porque um `FILE_CONFLICT` (string que só existe no código novo) surgiu num fail
do `main`.

⚠️ **Aplicado à própria corrida de validação, este AC a reprova**: provar os gates da 019 significa rodar
o SOMA sobre artefatos do SOMA. A corrida do OUTCOME precisa de isolamento explícito de `~/.soma-v2` e de
`$HOME`, ou de declaração de contaminação no relatório. **Isto é uma decisão para o Gate 1**, não algo
que o executor deva resolver sozinho.

### AC-06: IF um leitor de arquivo engolir erro de parse, THEN the sistema SHALL falhar alto em vez de devolver vazio

Given `core/scripts/install.cjs:655` (`readBlockIdsFromTargetsFile`), único dos quatro leitores de
`install-targets.json` que não faz strip de comentário `//` e `/* */` antes do `JSON.parse`, e cujo
`try/catch` devolve `[]` para qualquer erro / When o arquivo tem um comentário legítimo / Then o leitor
falha nomeando a causa. **Hoje devolve `[]` em silêncio** — os outros três leitores (`manifest.cjs`,
`install/targets.cjs`, `bootstrap.cjs`) preservam o `block_id`; este perde tudo, e nada avisa.

Documentado em `core/specs/018-install-whole-files/plan.md:280` como *"Achado colateral, registrado para
quem editar este arquivo no futuro"* — e nunca promovido a lacuna, teste ou AC. É a forma pura do padrão:
um defeito conhecido, escrito, e invisível a toda a maquinaria.

### AC-07: WHERE um contrato declarar abort por dependência ausente, the sistema SHALL ter teste que exercite o abort

Given o `CONTRACT-01` (`core/specs/015-soma-install/contracts/install-cli.md:3`), que declara o abort de
`soma install --tool codex` quando o Codex não está instalado, e `install.cjs:1156-1163`, que exige
`~/.codex/` / When a suíte roda / Then existe teste que remove a dependência e assere a mensagem do
contrato. 🔴 **A premissa original era falsa, e a correção torna o AC melhor.** O autor escreveu *"hoje não
existe"*. Medido em 2026-08-22: **existe** — `install.test.cjs:206-226`, `T-07-S3`, invoca
`runInstall([os.tmpdir(), '--tool=codex'])` e assere `exit 2` mais a mensagem do CONTRACT-01. Ele é
`t.skip()`-guarded quando `~/.codex` existe, e `~/.codex` existe na máquina que roda a suíte.

O defeito não é ausência de cobertura — é **teste pulado que lê como suíte verde**. Mesma classe do órfão
do AC-04 e do `G-LINT` da spec 019.

⚠️ Complicação medida: `withFakeHome` semeia `.codex/` **incondicionalmente**, sem opt-out — provar este
AC exige contornar o próprio mecanismo de isolamento que o NFR exige.

---

## Non-Functional Requirements

- **Test style:** cada AC nasce com caso conhecido-ruim que ele acusa e conhecido-bom que ele ignora,
  ambos nomeados por arquivo. Os do AC-01 e do AC-03 já estão nomeados no texto acima.
- **Ordem:** o AC-04 é FOUNDATION e bloqueia todos os outros, aqui e na spec 019.
- **Isolamento:** nenhum teste desta spec pode escrever no `$HOME` ambiente. O Bucket G Grupo 1 levou a
  suíte de 32 arquivos escritos para 0; não regredir.

## Out of Scope

- Gates sobre documento normativo — é a **spec 019**.
- Os Grupos 2 e 3 do Bucket G (desacoplar o resto da suíte do ambiente) seguem como bucket de handoff,
  não como AC daqui, salvo a parte do órfão `PPID=1` que virou o AC-04.

## Questões abertas

- [NEEDS CLARIFICATION] O AC-05 exige decidir como a corrida de validação se isola do SOMA instalado —
  isolamento explícito de `~/.soma-v2` e `$HOME`, ou declaração de contaminação no relatório?
  ⚠️ **Medido em 2026-08-22 e maior do que o AC sugere**: são **104** arquivos de
  `core/scripts/__tests__/` que resolvem para o `~/.soma-v2` instalado (mais 6 fora do glob do
  `npm test`), não os 3 citados. E `rollback.cjs:30-31` é **hardcoded**, sem nem env var de override.
  Nuance: os scripts instalados estão hoje **byte-idênticos** ao checkout — a contaminação é de
  **resolução**, não de conteúdo velho.
- [NEEDS CLARIFICATION] O AC-06 **se contradiz**: o título manda *"falhar alto"*, o corpo nomeia o
  defeito como *"não faz strip de comentário"* (que pede adicionar o strip). O Given/When aponta para um
  conserto e o Then para o outro. Escolher um lado.
  ✅ **Chamadores levantados em 2026-08-22, como o Gate 1 exigia**: são **2**, ambos em `install.cjs`
  (`:1063` e `:1066`), nenhum em teste, e a função **não está em `module.exports`** — a enumeração é
  definitiva. O `[]` alimenta uma cadeia de 3 fallbacks (adapter → regex no stdout → placeholder
  `'(injected)'`). Risco de quebrar teste hoje: **0, medido** — o caminho de erro está dormente.
  🔴 **Mas lançar é perigoso, e isso é novo**: os dois call sites ficam dentro do *"Step 4: Write success
  state"*, **depois** de o `sync --apply` já ter escrito os arquivos reais e **antes** do
  `writeInstallState(status:'complete')`. Não há `catch` em nenhum ponto da pilha até o entry point.
  Lançar ali deixa o projeto em estado **pior** que hoje.

## Completeness Checklist

- [ ] Gate 1 pendente — duas questões em aberto
- [x] Todo AC cita arquivo:linha medido
- [x] AC-01 e AC-03 trazem a lista de casos conhecido-bons que evita falso-positivo em massa
- [x] A dependência invertida com a spec 019 está declarada nas duas
