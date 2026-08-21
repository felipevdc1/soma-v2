# Tasks: `soma install` aprende a instalar arquivo inteiro

**Feature ID:** 018-install-whole-files
**Spec:** `core/specs/018-install-whole-files/spec.md`
**Created:** 2026-08-17

---

## Conventions

- `[P]` — parallel-safe (sem sobreposição de arquivos com outras `[P]` da mesma wave)
- `[SPEC:AC-XX]` — link de rastreabilidade com o critério de aceitação
- `[CONTRACT:filename]` — link com o arquivo de contrato
- `[FOUNDATION]` — bloqueia todas as waves
- `[WIRING]` — integração
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

**Regras de execução desta fase:**

1. **TDD obrigatório** (Article II) — toda task de código nasce com RED provado em commit separado.
2. **Filesystem real** (Article III) — diretórios temporários e repositórios git reais. Zero mock de `fs`.
3. **`os.tmpdir()` nunca é `/tmp`** neste Mac (é `/var/folders/...`). Hardcodar `/tmp` faz o teste passar sem testar.
4. **Zero dependência nova.** O `package.json` não tem `dependencies` nem `devDependencies`, e não deve passar a ter. Identidade de conteúdo usa `node:crypto`.
5. **Baseline**: **1378 / 1370 / 5 / 3**, reconfirmado por medição em `7461de8` (2026-08-21) — o número de `c3019f7` sobreviveu. **Depois da T-01 o baseline é `1414 / 1406 / 5 / 3`** (os mesmos + 36 testes novos); compare **listas nominais**, nunca contagem bruta.
   ⚠️ **Se você medir ~34 fails com `BF-06 ABORT: anchored block sha256 mismatch` no `~/.claude/CLAUDE.md`**: é acoplamento da suíte com a instalação viva do usuário, **não é regressão sua**. Pare, reporte, não conserte.
   🔴 **O baseline segue sendo 5, e isto foi decidido de propósito.** Uma versão anterior desta regra dizia 7, autorizando tocar `core/scripts/lib/manifest.cjs` — **revogada** pela D-018-06. Nenhum frozen lib é tocado por esta spec; o módulo novo `core/scripts/install/targets.cjs` **reusa** o validador congelado em vez de editá-lo. **Se você vir qualquer fail com `frozen libs`, `shasums match baseline` ou `migrateCbmDeprecation` no nome, algo tocou `core/scripts/lib/` e isso é regressão — pare e reporte.** Confira pelos **nomes**, nunca pela contagem. As 5 pré-existentes (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`) **não devem ser consertadas**. Meça antes e depois e reconcilie; nenhum fail NOVO fora dos seus.
   🟢 **Atualização pós-T-08 (2026-08-21, medido)**: o número bateu (**34 fails**, exatamente o "~34" previsto acima) mas o mecanismo que apareceu **não** foi o nomeado na linha anterior — não foi `BF-06 ABORT`/sha256 mismatch no `CLAUDE.md`, foi **`FILE_CONFLICT: file(s) diverged from what SOMA last installed`** contra os 31 hooks/comandos reais que a T-08 declarou. É o mesmo acoplamento suíte↔instalação-viva-do-usuário, um irmão do BF-06 que a linha acima não cobria porque, quando foi escrita, ainda não existia nenhuma entry `kind:"file"` real capaz de disparar essa variante. Raiz medida: `install.test.cjs` tem 33 `spawnSync` e só 2 sobrescrevem `env` (e sobrescrevem `SOMA_HOME`, não `HOME`) — os outros 31 herdam o `$HOME` real da máquina via `os.homedir()` (`files.cjs` `expandHome()`), porque `runStep` (`install.cjs:586`) não força `env`. Confirmado que nenhum arquivo real foi escrito (`find ~/.claude/hooks ~/.claude/commands -mmin -180` → 0 resultados; o abort-total do AC-04/T-07 segurou), mas o buraco é real: numa máquina onde esses arquivos já batessem byte-a-byte com o repo, `npm test` escreveria por cima deles de verdade, como efeito colateral de rodar a suíte.
   >
   > Decomposição medida dos 34: **3 eram bug de teste anterior à T-08** (toda entry tratada como bloco, sem filtrar por `kind` — `adapter-contract-d-c11-lint.test.cjs` ×2 casos, `bf-04-cbm-deprecation-reproducer.test.cjs` "AC-01", `contract-file-entry.test.cjs` "caso 1") e foram **corrigidos nesta mesma leva**, com prova bidirecional (cada um mutado pra confirmar que ainda acusa entry de bloco ausente/nova, depois restaurado byte-a-byte). Os **26 restantes** são o buraco de isolamento de `$HOME` descrito acima e **NÃO foram tocados** — viram task própria (candidata a T-10), autorizada pelo orquestrador. **O baseline correto a partir de agora é `1485 / 1451 / 31 / 3`**: os mesmos 5 de sempre (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`) **mais os 26 da categoria acima**. Compare por **nomes**, nunca só a contagem 31 — a lista nominal dos 26 está no relatório da T-08.
6. **Nenhuma das três fontes grandes é reescrita.** `sync.cjs` (1258 l), `install.cjs` (1227 l) e `doctor.cjs` (835 l) recebem chamadas finas para o módulo da T-01. Se a sua task quiser reescrever uma delas, **pare e reporte** — o plano está errado, não o código.
7. **A superfície está fixada no `plan.md`** §"Superfície fixada". Mudança acontece **lá primeiro**, nunca no código ou no exemplo.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | `[FOUNDATION]` Módulo puro `core/scripts/install/files.cjs`, exportando: validação de entry (discriminador `kind`, campos proibidos, rejeição de `..`), `sha256` de conteúdo via `node:crypto`, a decisão limpo-vs-divergido da tabela do `CONTRACT-FILES-LEDGER-02`, o planejamento em **duas passadas**, e leitura/escrita do ledger. **Em `core/scripts/install/`, NÃO em `core/scripts/lib/`** — ver D-018-03: `lib/` acende o guarda "frozen libs invariant" e soma +2 fails à suíte de toda worktree que o tocar. RED: as funções existem e rejeitam entry malformada | [CONTRACT:install-file-entry] [CONTRACT:installed-files-ledger] | `core/scripts/install/files.cjs`, `core/scripts/__tests__/install-files.test.cjs` | DONE |

> **Por que um módulo e não lógica espalhada nos três consumidores:** `sync.cjs`, `install.cjs` e `doctor.cjs` precisam da **mesma** decisão limpo-vs-divergido. Três cópias divergiriam — foi exatamente o que aconteceu na spec 016 com a resolução de `.soma.lock`, que nasceu triplicada e precisou de uma task corretiva. Aqui o módulo vem primeiro, de propósito.

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

*Article III: contract test antes de qualquer implementação que use o contrato.*

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | `[P]` Contract test de `contracts/install-file-entry.md` — os 7 casos do stub, incluindo os de **rejeição**: `target_anchor_id` numa entry de arquivo é REJEITADA e não ignorada (é quase certamente entry de bloco malformada, e tratá-la como arquivo sobrescreveria o `CLAUDE.md` inteiro), `..` rejeitado antes de qualquer path ser construído, e `kind` desconhecido não cai em default silencioso | [CONTRACT:install-file-entry] | `core/scripts/__tests__/contract-file-entry.test.cjs` | T-01 | DONE |
| T-03 | `[P]` Contract test de `contracts/installed-files-ledger.md` — os 12 casos do stub, incluindo os **dois lados** da whitelist (aceita `installedFiles`, continua rejeitando campo desconhecido), o caso "presente sem entrada no ledger → divergido", a exigência de que 2 divergidos nomeiem **os dois**, e a idempotência | [CONTRACT:installed-files-ledger] | `core/scripts/__tests__/contract-files-ledger.test.cjs` | T-01 | DONE |

---

## Wave 2 — Implementação (Step 4, Wave 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-04 | `[P]` **Migração dos comandos** — os 6 órfãos da raiz (`depth-score`, `dispatch`, `encerrar`, `gap-finder`, `handoff`, `quality-check`) movem para `core/adapters/claude/commands/`; os 5 duplicados stale da raiz (`hyd`, `plan-sdd`, `soma-run`, `sonar-audit`, `specify`) são removidos. O adapter é mais novo nos 5 de 5 — medido: raiz tem 3 de maio e 1 de julho. Integration test `// @spec AC-11` provando que **nenhum comando existe em dois lugares** | [SPEC:AC-11] | `commands/*.md`, `core/adapters/claude/commands/*.md`, `core/scripts/__tests__/commands-single-source.test.cjs` | T-01 | DONE |
| T-05 | `[P]` ⚠️ **Também fecha 2 casos do `CONTRACT-FILES-LEDGER-02` que a T-03 deixou em `skip` com dono nominal**: caso **2** (os dois lados da whitelist) e caso **8b** (abort nunca produz status `partial-failed`). Os dois vivem em `install.cjs` (`ALLOWED_STATE_FIELDS`, `VALID_STATUSES`), que `files.cjs` não requer nem possui. O `skip` carrega o motivo e o corpo tem `assert.fail`, então remover o skip sem escrever o teste **quebra alto** em vez de passar vazio. Ao terminar, os `skipped` da suíte voltam de **5 para 3**. — `install.cjs` grava o ledger — `installedFiles` acrescentado a `ALLOWED_STATE_FIELDS` (`:74`) e escrito após instalação bem-sucedida, com o `sha256` **do conteúdo que gravou**, não do que estava lá antes. `validateInstallState` (`:344`) continua rejeitando campo desconhecido. Integration test `// @spec AC-06` `// @spec AC-07` nos **dois lados** da whitelist | [SPEC:AC-06] [SPEC:AC-07] | `core/scripts/install.cjs`, `core/scripts/__tests__/install-files-ledger.test.cjs` | T-03 | DONE |
| T-06 | `[P]` `doctor.cjs` confere arquivo — compara cada entry de arquivo declarada contra a fonte do repo, nomeia divergentes, fica **silencioso** quando tudo bate, e **distingue "nunca instalado" de "sem drift"** quando o `install-state` não existe. Hoje ele toca `~/.claude/hooks/` num único ponto (`:441`) e foi cego para 6 hooks defasados por 3 meses. Integration test `// @spec AC-08` `// @spec AC-09` `// @spec AC-10` | [SPEC:AC-08] [SPEC:AC-09] [SPEC:AC-10] | `core/scripts/doctor.cjs`, `core/scripts/__tests__/doctor-file-drift.test.cjs` | T-03 | 🔄 AC-08/09/10 DONE · bloqueador da T-08 em execução |
| T-07 | `[P]` `sync.cjs` processa entry de arquivo — **duas passadas** (avalia todas sem escrever; só escreve se nenhuma divergiu), cópia byte-a-byte, coexistência com as 8 entries de bloco **sem alterar o comportamento delas**, e o invariante de propriedade: só toca o que uma entry declara. Usa fixtures próprios de `install-targets`, não o conjunto real (que é da T-08). Integration test `// @spec AC-01` `// @spec AC-02` `// @spec AC-03` `// @spec AC-04` `// @spec AC-05` | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05] | `core/scripts/sync.cjs`, **`core/scripts/install/targets.cjs`** (novo — ver D-018-06), `core/scripts/__tests__/sync-file-entries.test.cjs` | T-02, T-03 | DONE |

> ⚠️ **A T-07 é dona do guarda de symlink e de escape na escrita real** — fixado em 2026-08-21, depois da T-01. A NFR de segurança da `spec.md` ("a escrita nunca segue symlink para fora do `target_path` declarado, e nunca escreve fora do diretório do destino declarado") fala da **operação de escrita**, que não existe na T-01: o módulo puro planeja e escreve o `install-state.json`, mas nunca copia arquivo-alvo. Sem dono nominal, essa NFR ficaria órfã — foi exatamente o que aconteceu com o `spec-completeness-gate.cjs` na spec 016, que o contrato exigia e task nenhuma possuía.

> **Por que a T-07 carrega 5 ACs:** os cinco são comportamento de um arquivo só, o `sync.cjs`, e dividir exigiria um segundo módulo que nenhum AC pede — o Anti-Abstraction Gate rejeitaria. A lógica pura já está na T-01; a T-07 é o wiring dela num consumidor.

---

## Wave 3 — Conjunto real e integração (Step 4, Wave 3)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-08a | `[WIRING]` **Executar a D-018-07** — `git mv hooks core/hooks` (19 `.cjs` + `hooks.json` + `lib/` + `__tests__/`) e atualizar os **5** pontos que referenciam o caminho antigo. **Três falham em SILÊNCIO e são o risco real desta task** — nenhum produz erro, os três produzem *ausência*: (1) `package.json:19`, glob `hooks/__tests__/*.test.cjs` → **7 arquivos de teste somem da suíte sem avisar** (medido: `node --test` com glob que não casa nada sai `# fail 0`, limpo); (2) `hooks/framework-guard.cjs:53`, `PROTECTED_PATTERNS: 'hooks/**'` → padrão literal sem `**/` líder, deixa de casar `core/hooks/**` e **o guarda para de proteger os próprios hooks**; (3) `install.sh:168`, `rsync "${REPO_ROOT}/hooks/"` → para de instalar os hooks no destino — **reclassificado em 2026-08-21 como falha ALTA**, não silenciosa: `install.sh:11` tem `set -euo pipefail` e `run()` faz `eval` sem fallback, então o instalador aborta. **São 2 silenciosos, não 3.** Os outros dois falham **alto** (teste vermelho) e são fáceis: `core/scripts/__tests__/contract-run-state.test.cjs:37` e `core/scripts/__tests__/trilho-e2e.test.cjs:37`, ambos com `path.resolve(REPO_ROOT, 'hooks', …)`. **`install.sh:142` NÃO muda** — o `rsync -a "${REPO_ROOT}/core/" "${HOME}/.soma-v2/"` já copia a árvore inteira sem `--exclude`, então `core/hooks/` passa a chegar ao standalone de graça (medido). **Doc a acompanhar, que não quebra mas passa a mentir**: `core/specs/016-artifact-gated-trilho/contracts/framework-guard-hook.md:30` e o teste da linha 95. **Parar e reportar se**: a contagem de testes da suíte CAIR após o `git mv` — é o sintoma do ponto (1), e ele é invisível pelo exit code. **Asserção (os dois sentidos)**: (a) contagem nominal de testes ANTES == DEPOIS, comparando **listas de nomes**, nunca totais brutos; (b) um staged em `core/hooks/**` é BLOQUEADO pelo `framework-guard` — o controle negativo é obrigatório, senão o teste passa por o guarda estar cego. | [SPEC:AC-05] [D-018-07] | `hooks/**` → `core/hooks/**`, `package.json`, `install.sh`, `hooks/framework-guard.cjs`, `core/scripts/__tests__/contract-run-state.test.cjs`, `core/scripts/__tests__/trilho-e2e.test.cjs`, `core/specs/016-artifact-gated-trilho/contracts/framework-guard-hook.md` | T-07 | **DONE** (`20e6100` RED + `30032fc` GREEN) — 183→183 arquivos de teste, 0 sumiram, contagem idêntica em 182/183 (só `framework-guard.test.cjs` 12→14, o par novo); suíte 1473 pass / **os mesmos 5 fails por nome**. **Mutação dirigida confirma que o teste não é cego**: revertendo `PROTECTED_PATTERNS` para `'hooks/**'` → **7 fail**; com o valor certo → 14/0. **+2 pontos que o levantamento dos 5 não previa**, ambos efeito do mesmo `PROTECTED_PATTERNS`: `HOOKS_MAP` no teste escapava 2 níveis para achar `install/soma-hooks-map.json` e precisa de 3 (o `install/` **não** se moveu), e o fixture `git add hooks/sneaky.cjs` do `trilho-e2e` deixava de ser bloqueado |
| T-08 | `[WIRING]` Declarar o conjunto real no `core/adapters/claude/install-targets.json`: **os 19 hooks** do repo mais os comandos que a T-04 consolidou, **sem `soma-run.md`** e com a razão da exclusão registrada junto. As 3 entries de bloco existentes **não são editadas**. Integration test `// @spec AC-12` provando que não há entry para `soma-run.md`. **Depende da T-04 por necessidade real, não por arquivo**: o contrato exige que `source_path` exista no repo, e os 6 comandos órfãos só existem no adapter depois da migração **Precedida pela T-08a (D-018-07)** — sem o `git mv`, `source_path: "hooks/…"` não resolve. | [SPEC:AC-12] [SPEC:AC-05] | `core/adapters/claude/install-targets.json`, `core/scripts/__tests__/install-targets-set.test.cjs` | T-04, T-07, **T-08a** | DONE — 34 entries (3 bloco + 31 arquivo), RED/GREEN provado, AC-12 mutado nos dois sentidos. Achou 29 fails novos ao rodar a suíte cheia (3 bug-de-teste pré-018 corrigidos junto, 26 acoplamento `$HOME` real → nota na regra 5 acima) |
| T-09 | `[WIRING]` Smoke de ponta a ponta: repo real + `~` temporário que (a) instala do zero e os arquivos aparecem idênticos; (b) tem 1 arquivo divergido e **nada é escrito**, com os divergidos nomeados; (c) tem arquivo não-declarado no destino e ele **sobrevive intacto**; (d) roda 2× sem mudança e a segunda **não escreve**; (e) `doctor` sem `install-state` diz "nunca instalado" | [SPEC:AC-01] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-10] | `core/scripts/__tests__/install-files-e2e.test.cjs` | T-05, T-06, T-08 | TODO |

---

## Cobertura de ACs

| AC | Tasks |
|---|---|
| AC-01 | T-07, T-09 |
| AC-02 | T-07 |
| AC-03 | T-07 |
| AC-04 | T-07, T-09 |
| AC-05 | T-07, T-08, T-09 |
| AC-06 | T-05 |
| AC-07 | T-05 |
| AC-08 | T-06 |
| AC-09 | T-06 |
| AC-10 | T-06, T-09 |
| AC-11 | T-04 |
| AC-12 | T-08 |

**12/12 ACs cobertos — 100%.** Nenhuma task órfã: T-01 é `[FOUNDATION]`, T-08/T-09 são `[WIRING]`, e as demais carregam `[SPEC:AC-XX]` ou `[CONTRACT:...]`.

---

## Ordem e riscos

**T-01 primeiro e sozinha** — os três consumidores dependem da mesma decisão, e três cópias divergiriam. Na spec 016 isso aconteceu com a resolução de `.soma.lock`: nasceu triplicada, com três réguas diferentes, e custou uma task corretiva.

**Nenhuma task da Wave 2 compartilha arquivo com outra.** T-04 mexe em `commands/`, T-05 em `install.cjs`, T-06 em `doctor.cjs`, T-07 em `sync.cjs`.

⚠️ **O risco real desta spec é a T-07.** Ela toca o arquivo mais movimentado do repo, no caminho que já tem a lógica de `BLOCK_CONFLICT` funcionando. **Quebrar bloco pra fazer arquivo funcionar é o pior desfecho possível** — os blocos são o que instala o `CLAUDE.md` hoje. É por isso que o AC-02 exige que os findings das entries de bloco fiquem idênticos, e não só que "continuem funcionando".

**O primeiro `soma install` de verdade vai abortar**, porque `spec-completeness-gate.cjs` e `spec-test-traceability.cjs` estão divergidos com o repo à frente. Isso é o AC-04 funcionando. **Não relaxe o AC-04 pra "fazer a instalação passar".**
