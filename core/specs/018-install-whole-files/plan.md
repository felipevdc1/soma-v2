# Plan: `soma install` aprende a instalar arquivo inteiro

**Feature ID:** 018-install-whole-files
**Spec:** `core/specs/018-install-whole-files/spec.md`
**Created:** 2026-08-17

---

## Technical Approach

A máquina de install/sync é hoje inteiramente bloco-ancorado: toda entry tem `block_id`/`source_doc`/`target_path`/`target_anchor_id`, o `block_id` é derivado da âncora (`sync.cjs:666`), e a detecção de conflito (`sync.cjs:774`, `:911`) **exige** âncora pra separar a região do SOMA das edições do usuário em volta.

A extensão é **aditiva e discriminada**: a entry ganha um campo `kind` opcional; ausente significa `"block"`, o que preserva as 8 entries existentes **sem tocá-las**. Entries com `kind: "file"` não têm âncora e são resolvidas por um caminho paralelo.

Toda a lógica que pode ser pura vive num módulo novo, `core/scripts/install/files.cjs` — validação de entry, identidade de conteúdo, decisão limpo-vs-divergido, e o planejamento em duas passadas. Os três consumidores (`sync.cjs`, `install.cjs`, `doctor.cjs`) ganham chamadas finas para ele; **nenhum dos três é reescrito**.

O abort total do AC-04 exige **duas passadas**: a primeira avalia todos os alvos e não escreve nada; a segunda só roda se a primeira aprovou todos. É o que torna "ou tudo, ou nada" verdadeiro em vez de aspiracional.

---

## Superfície fixada (2026-08-17) — autoridade única

**Esta seção é a autoridade.** Toda mudança acontece **aqui primeiro**. Divergir no exemplo e ajustar o documento depois foi como nasceram duas ambiguidades na spec 016.

### Shape da entry de arquivo

```json
{
  "kind": "file",
  "source_path": "hooks/framework-guard.cjs",
  "target_path": "~/.claude/hooks/framework-guard.cjs"
}
```

- **`kind`** — `"file"` ou `"block"`. **Ausente significa `"block"`.** É o que preserva as 8 entries existentes sem editá-las (AC-02).
- **`source_path`** — relativo à raiz do repositório SOMA.
- **`target_path`** — absoluto ou com `~`, mesma convenção do `target_path` das entries de bloco.
- **Sem `target_anchor_id`.** Arquivo não tem âncora — é a diferença que motiva a spec inteira.
- **Sem `file_id`.** Considerado e **rejeitado**: o `target_path` já é único por entry e é a chave natural do ledger. Um id paralelo seria um segundo nome pra mesma coisa, e o `block_id` só existe porque é derivado da âncora.

### Campo novo no `install-state`

`installedFiles` — acrescentado a `ALLOWED_STATE_FIELDS` (`install.cjs:74`), que hoje tem `$schema`, `status`, `timestamp`, `snapshotId`, `harness`, `installedVersion`, `lastError`, `blockIds`.

```json
"installedFiles": {
  "~/.claude/hooks/framework-guard.cjs": {
    "sha256": "<hex>",
    "installedAt": "2026-08-17T05:00:00Z"
  }
}
```

Objeto mapeado por `target_path`, não array. Motivo: a operação é **lookup por path** (AC-03/AC-04 perguntam "este arquivo mudou?"); array exigiria varredura. O `blockIds` é array porque a operação dele é enumeração, não lookup.

### Superfície de CLI

```soma-cli-surface
soma install --tool claude
soma sync --tool claude --dry-run
soma sync --tool claude --apply
soma doctor
```

**Zero flag nova.** O escape hatch por arquivo (`--force-file`) foi **considerado e rejeitado pelo usuário** em 2026-08-17, junto com a decisão de abort total. Reconciliar arquivo divergido é ação manual, informada pelo abort.

---

## Architecture Decisions

**D-018-01 — `kind` explícito, não detecção implícita por ausência de âncora.**
Alternativa rejeitada: inferir "é arquivo" quando `target_anchor_id` está ausente. Rejeitada porque entry de bloco malformada (âncora esquecida) seria silenciosamente reinterpretada como arquivo e sobrescreveria o `CLAUDE.md` inteiro. Discriminador explícito transforma um erro catastrófico e silencioso em erro de validação.

**D-018-02 — duas passadas, não escrita incremental com rollback.**
Alternativa rejeitada: escrever incrementalmente e desfazer no primeiro conflito. Rejeitada porque rollback é código que só roda no caminho de erro — o menos exercitado e o mais fácil de estar quebrado sem ninguém saber. Avaliar-tudo-antes-de-escrever-nada não tem caminho de desfazer.

**D-018-03 — módulo novo em `core/scripts/install/`, não em `core/scripts/lib/`.**
Alternativa rejeitada: `core/scripts/lib/install-files.cjs`. Rejeitada por razão medida: o guarda "frozen libs invariant" acende em **qualquer** branch que adicione ou modifique arquivo em `core/scripts/lib/` (2 testes em `manifest.test.cjs` rodando `git diff main -- core/scripts/lib/`), somando **+2 fails** à suíte de toda worktree que tocasse o módulo. Isso é ruído recorrente em cada task da wave. `core/scripts/install/` segue o precedente que a spec 016 estabeleceu com `core/scripts/run/`.

**D-018-04 — a identidade de conteúdo é `sha256` do `node:crypto`.**
Alternativa rejeitada: comparar `mtime` ou tamanho. Rejeitada porque as duas dão falso-negativo trivialmente (edição do mesmo tamanho, `touch`), e a decisão do AC-04 **destrói ou preserva trabalho do usuário** — é o lugar errado pra régua barata. `node:crypto` é stdlib, então a restrição de zero dependência é respeitada.

---

**D-018-05 — ~~o `manifest.cjs` é corrigido na fonte~~ — SUPERSEDIDA no mesmo dia pela D-018-06. Leia a D-018-06 antes de agir sobre qualquer coisa nesta seção.**
*A decisão original é de 2026-08-21 e foi tomada sobre uma medição minha que estava errada em dois pontos; o diagnóstico do defeito, abaixo, continua válido e é o que motiva a D-018-06.*

**O que a Discovery original não viu**: o porteiro do `install-targets.json` não é nenhuma das três fontes que a spec analisou — é um **quarto** arquivo, `core/scripts/lib/manifest.cjs`. Isso torna falsa, como escrita, a frase do §Technical Approach *"nenhum dos três é reescrito"*: continua verdadeira para os três, e passa a ser insuficiente como descrição do escopo.

**O defeito, medido e reproduzido**:
- `validateInstallTargetsSchema` (`manifest.cjs:74`) exige `block_id`, `source_doc`, `target_path` e `target_anchor_id` de **toda** entry, sem consultar `kind` — precisamente os três campos que o `CONTRACT-FILE-ENTRY-01` declara **proibidos** numa entry `kind:"file"`.
- `loadInstallTargets` (`manifest.cjs:~157`) aplica `expandHome()` no `target_path` de **todas** as entries, colidindo com a §"A chave do ledger é o `target_path` VERBATIM".
- `sync.cjs:1171` engole o `INSTALL_TARGETS_INVALID` com um `continue` **pelado, sem log**: o efeito não é crash, é o adapter inteiro — blocos **e** arquivos — desaparecer do dry-run em silêncio. Zero findings onde o AC-02 exige findings idênticos.

**A alternativa rejeitada** — `sync.cjs` ler e validar o JSON por conta própria — foi recusada por dois motivos: duplicaria validação que hoje só existe no `manifest.cjs`, que é a **doença das cópias divergentes** que a T-01 foi criada pra evitar (§"Por que um módulo e não lógica espalhada nos três consumidores"); e mudaria o caminho de carregamento do modo default para **todos** os adapters, arriscando regressão nas entries de bloco reais — exatamente o que o AC-02 proíbe.

**A terceira alternativa** — estreitar o AC-02 tirando o `soma sync --dry-run` de escopo, já que o `soma install` não passa pelo caminho quebrado — foi considerada e rejeitada: faria o `sync` pular entries de arquivo **em silêncio**, que é a doença que esta spec inteira existe pra matar.

### ⚠️ ~~Exceção declarada ao "frozen libs invariant"~~ — REVOGADA pela D-018-06 (nenhum frozen lib é tocado)

🔴 **As duas afirmações abaixo eram FALSAS quando escritas. Ficam registradas, corrigidas, porque o erro é instrutivo.**

**Erro 1 — a contagem.** Escrevi "2 testes, medidos e nomeados". São **8**. Minha régua foi um `grep` pela string `core/scripts/lib/`, que só encontra guardas baseados em `git diff`; os que comparam **sha256 contra baseline hardcoded** não citam esse caminho e ficaram invisíveis. Medido depois, com as mudanças da T-07 no working tree — 8 fails novos, confirmados 1:1 com a medição independente dela:
`AC-07 [T-02] frozen libs invariant` · `AC-07 [T-10] frozen lib manifest.cjs sha256 matches baseline` · `frozen libs: shasums match baseline (Spec 013 AC-17)` · `Regression: locked lib files in scratch repo not modified` · `Regression: locked lib files in scratch repo match SOMA_HOME originals` · `migrateCbmDeprecation: orchestrates full lifecycle (sandbox)` · `migrateCbmDeprecation: G3 bypassed with --force (W-B-3)` · `migrateCbmDeprecation: cleans .migration.lock on rollback path`.
Pior que o número: eu escrevi *"se aparecer um oitavo nome, é seu"*, transferindo à executora o ônus de uma medição minha incompleta. Ela recusou, e estava certa.

**Erro 2, o grave — "voltam ao verde no merge, sem ação" é falso para a maioria.** Vale só para os guardas baseados em `git diff main`. Os baseados em **sha256 contra baseline** comparam conteúdo contra uma constante hardcoded e **não curam no merge** — ficariam vermelhos indefinidamente. E três dos oito não são teste: são o gate funcional **G6** (`migrate.cjs:314`), que aborta a migração antes dos gates G1-G5 quando os libs derivam.

**O que a cerimônia realmente custaria** (medido com `grep` pelo valor **antigo**, `08a0f164…`, e não pelo novo): o sha vive em **9 ocorrências, 8 arquivos** — `lib/migrate.cjs`, **três testes-guarda** (`bf-04-frozen-libs-invariant`, `ac-15-regression`, `frozen-libs-invariant-014`), `docs/TROUBLESHOOTING.md`, mais registros históricos da spec 013 e um relatório de evidência datado. Atualizar os três testes-guarda não é "bumpar versão" — é **afrouxar os guardas**, ato diferente do que a decisão original descrevia.

Para registro, o que acenderia (não acende mais, ver D-018-06):
- `core/scripts/__tests__/frozen-libs-invariant-014.test.cjs:43`
- `core/scripts/__tests__/manifest.test.cjs:345` (`AC-07 [T-02] frozen libs invariant`)

Os dois rodam `git diff main -- core/scripts/lib/` e falham com diff não-vazio. **É tripwire, não proibição**: existe para que mudança em `lib/` seja visível e deliberada. Esta é deliberada e está escrita aqui.

🔴 **REVOGADO pela D-018-06 — o baseline segue sendo 5.** ~~Consequência na medição: enquanto a branch não for mergeada, o baseline de falhas é **7**, não 5~~ — as 5 pré-existentes **mais** esses 2, nominalmente identificáveis. Os 2 voltam ao verde no merge, sem ação. **Um executor que medir 7 e reportar "2 regressões" está lendo o tripwire como defeito.**

**O que NÃO muda**: a versão do schema continua `soma-install-targets/v1`. O `kind` segue aditivo e opcional; o que estava errado era o validador, que nunca soube da existência de dois tipos de entry.

---

**D-018-06 — composição, não correção-na-fonte nem duplicação: um módulo novo REUSA o validador congelado.**
*Decisão do Felipe em 2026-08-21, tomada depois de eu medir a cerimônia de verdade e reportar que a minha estimativa anterior estava errada.*

`core/scripts/lib/manifest.cjs` fica **byte-idêntico**. Nasce `core/scripts/install/targets.cjs`, na mesma casa que a D-018-03 já escolheu para o código novo desta spec, e ele:

1. lê o `install-targets.json`, tira comentários e faz `JSON.parse` — ~4 linhas triviais, a única duplicação aceita, e **não é duplicação de validação**;
2. separa `entries[]` por `kind`;
3. chama o **`validateInstallTargetsSchema` exportado pelo `manifest.cjs`** sobre `{schema, entries: <só as de bloco>}`. Validação de bloco byte-a-byte idêntica **por ser literalmente a mesma função**, não uma reimplementação equivalente;
4. valida as entries de arquivo pelo `files.cjs` da T-01;
5. expande `~` **apenas** nas entries de bloco. As de arquivo chegam ao consumidor **verbatim**, como a §"A chave do ledger é o `target_path` VERBATIM" exige.

**O que isto compra**: zero fail de frozen-lib · G6 intacto · nenhum teste-guarda editado · nenhum bump de versão · baseline segue **5**.

**A alternativa rejeitada continua sendo a duplicação** — `sync.cjs` reimplementar a validação — pelos motivos da D-018-05, que seguem válidos. A diferença entre "duplicar" e "compor" é que a composição **chama** o validador congelado em vez de reescrevê-lo, e portanto não pode divergir dele.

⚠️ **O risco que sobra, e como ele é medido**: o caminho default de carregamento passa a atravessar o módulo novo para **todos** os adapters, inclusive os que não têm entry de arquivo nenhuma. É exatamente o que a prova obrigatória do AC-02 mede — capturar os findings das entries de bloco **antes** de qualquer mudança, rodar depois, e o `diff` tem de ser **vazio**. Sem essa prova, a T-07 não fecha.

---

## ✅ ~~BLOQUEADOR DA T-08~~ — **RESOLVIDO em `f179ba0` (2026-08-21).** Seção mantida como histórico; **não é mais instrução**

> **Estado atual, medido em 2026-08-21 ao fechar a D-018-07** — `detectTargetDrifts` (`doctor.cjs:141`) e `computeInstallTargetsSummary` (`doctor.cjs:839`) **já chamam** `loadInstallTargetsWithKinds` (`doctor.cjs:147` e `:845`). Prova: `grep -n "loadInstallTargetsWithKinds" core/scripts/doctor.cjs` e `node --test core/scripts/__tests__/doctor-file-drift.test.cjs` → **13 pass / 0 fail**; o guarda do AC-02 é `doctor-mixed-kind-block-drift.test.cjs`, escrito no mesmo commit. **A "Ordem obrigatória" ao pé desta seção já foi cumprida** — reler isto como pendência mandaria refazer trabalho feito.
>
> Os números de linha citados no corpo abaixo (`doctor.cjs:128`, `:812`) eram **imprecisos já quando escritos**: as funções nomeadas ficam em `:141` e `:839`. O texto abaixo fica como estava, marcado, para não reescrever histórico.

Registrado em 2026-08-21, **antes** de o código mudar. A T-06 achou ao instrumentar o `doctor` e classificou corretamente como fora do escopo dela.

A D-018-06 fez o `sync.cjs` migrar para `loadInstallTargetsWithKinds`. O **`doctor.cjs` não migrou junto** — só o caminho novo dela (`:338`) usa o loader novo. Dois pontos seguem no antigo:

| Ponto | Função | O que acontece quando existir a 1ª entry `kind:"file"` |
|---|---|---|
| `doctor.cjs:128` | `detectTargetDrifts` | `INSTALL_TARGETS_INVALID` → **o adapter inteiro é pulado**. Drift de **bloco** deixa de ser detectado para o `claude`, trocado por um finding de erro |
| `doctor.cjs:812` | `computeInstallTargetsSummary` | mesmo erro → o adapter é marcado **`valid: false`** |

**Por que é bloqueador e não observação**: a T-08 declara os 19 hooks e os comandos como entries `kind:"file"` no `core/adapters/claude/install-targets.json`. No instante em que isso entra, o `doctor` **para de vigiar drift de bloco no adapter `claude`** — e a mensagem `OK: No drift detected.` é substituída por um erro que mascara o resto. É a doença desta spec de novo, agora produzida por ela mesma: **um check que deixa de rodar, sem que ninguém peça.**

Hoje é inofensivo porque **zero** entries `kind:"file"` existem em produção — medido: nem o repo nem o `~/.soma-v2` declaram nenhuma. É exatamente por isso que ninguém pisou nisso antes.

**Correção mandatada, e ela é a mesma composição da D-018-06**: os dois pontos passam a `loadInstallTargetsWithKinds` e processam **apenas as entries de bloco**. O mundo de bloco não pode mudar de comportamento — vale aqui o mesmo padrão de prova do AC-02: capturar a saída do `doctor` antes, rodar depois, e o `diff` das partes de bloco tem de ser **vazio**.

⚠️ **Ordem obrigatória**: isto entra **antes** da T-08. Declarar o conjunto real com o `doctor` cego seria entregar a spec com o vigia desligado justamente para o adapter que ela instrumenta.

---

## ✅ D-018-07 — a raiz do `source_path` em tempo de execução (**FECHADA em 2026-08-21**, ratificada pelo Felipe)

Levantada em 2026-08-21 ao verificar o bloqueio da T-07. **Dono: T-08.** Não decidir aqui seria defer-and-forget; decidir aqui, sem o conjunto real na mão, seria decidir sem evidência.

Os dois verbos leem o `install-targets.json` de **lugares diferentes**, e isso nunca foi dito:

| Verbo | De onde lê as entries | Raiz implícita |
|---|---|---|
| `soma install --tool claude` | `SOURCE_CORE/adapters/<tool>/…` — o `core/` do **checkout em execução** (`install.cjs:572`, e `--targets-file` em `:995`), passado ao `sync` | a raiz do repo — **`hooks/` existe** |
| `soma sync --tool claude` (default) | `loadInstallTargets(somaHome, …)` → `~/.soma-v2/adapters/<tool>/…` | `~/.soma-v2` — **`hooks/` NÃO existe** |

Medido em 2026-08-21: `~/.soma-v2/` não tem diretório `hooks/`, e seu `manifest.json` cobre **15 arquivos**, todos sob `docs/` e `adapters/` — **zero** hooks. A cópia instalada do `install-targets.json` está, hoje, byte-idêntica à do repo.

🔴 **Medido em 2026-08-21, depois da T-07 — o problema é mais estreito e mais concreto do que a tabela acima sugere.** O caminho real do `soma install` **não** usa `~/.soma-v2`: o `install.cjs:890` invoca o sync com `--soma-home=${SOURCE_CORE}`, e `SOURCE_CORE` é o **`core/` do checkout em execução** (`install.cjs:572`). Só o adapter de **projeto** (`install.cjs:994-995`) usa `--targets-file`. *(Números corrigidos em 2026-08-21: as citações anteriores — `:519`, `:837`, `:942`, `:1009` — apontavam para `--dry-run`, `installedVersion` e um comentário. Reconferidas com `grep -n "SOURCE_CORE\s*=\|--soma-home=\|--targets-file=" core/scripts/install.cjs`.)*

Portanto a pergunta real é: `source_path` é relativo a **`<repo>/core`** (o `somaHome` efetivo) ou à **raiz do repo**?

Medido: um `source_path: "hooks/framework-guard.cjs"` resolvido contra o `somaHome` efetivo aponta para `<repo>/core/hooks/framework-guard.cjs`, e **`core/hooks/` não existe** — os 19 hooks moram em `<repo>/hooks/`, um nível acima. O contrato diz *"relativo à raiz do repositório SOMA"*, que é `<repo>`, não `<repo>/core`.

🔴 **CORREÇÃO de 2026-08-21, medida — a opção (b) que este documento propunha estava ERRADA e foi removida.** Ela dizia "derivar a raiz da localização do próprio arquivo de adapter (`<X>/adapters/<tool>/install-targets.json` → raiz = `<X>/..`), robusto sem suposição de nome". Medido: **`adapters/` fica diretamente sob o `somaHome` nos DOIS layouts** (`manifest.cjs:126` e `targets.cjs:51` montam `path.join(somaHome, 'adapters', tool, ...)`). Portanto (b) devolve exatamente `somaHome` — é idêntica a (c) no efeito e **não alcança a raiz do repo**. Eu publiquei uma saída que não existe.

**O quadro real, medido:**

| Layout | `somaHome` | `adapters/` fica em | subir 1 dá | os hooks estão em |
|---|---|---|---|---|
| caminho do `install` | `<repo>/core` | `<repo>/core/adapters` | `<repo>` ✅ | `<repo>/hooks` |
| `sync` standalone | `~/.soma-v2` | `~/.soma-v2/adapters` | `~` 🔴 absurdo | **não existem** |

**As saídas avaliadas (14 agentes, 62 achados medidos, 2026-08-21):**

- **(a) `source_path` relativo a `somaHome/..`** — 🔴 **REJEITADA: é um buraco de leitura arbitrária, medido.** No caminho standalone `somaHome/..` = `$HOME`. Rodando o `validateFileEntry` real com `repoRoot=$HOME`, as entries `source_path: ".ssh/known_hosts"`, `".claude/CLAUDE.md"` e `".zshrc"` **são ACEITAS** — sem `..`, sem symlink, sem truque. Sob (c) as três são rejeitadas (`source_path does not exist in repo`) e o controle positivo (`adapters/claude/install-targets.json`) é aceito. O único guarda de leitura é `files.cjs:174-180` (`sourcePathAbs.startsWith(repoRootAbs + path.sep)`), e ele só contém enquanto `repoRoot` for o subtree do repo.
- **(c) `source_path` relativo a `somaHome`, com os fontes vivendo sob ele** — ✅ **ESCOLHIDA.** Ver a prova e o custo abaixo.
- **(d)** — o `install-targets.json` ganha um campo declarando a raiz dos fontes (ex.: `source_root`), resolvido relativo ao próprio arquivo de adapter. Viável, e mais explícita. **Rejeitada por custo sem ganho**: exige mudar 3 call sites hoje ancorados em `somaHome` (`targets.cjs:124`, `sync.cjs:749`, `doctor.cjs:397`) de forma **coordenada** — se só um mudar, `sync` e `doctor` resolvem a mesma entry contra raízes diferentes e divergem em silêncio —, exige absorver um campo novo na §"Superfície fixada" **antes** de qualquer exemplo, e **não resolve o standalone**: não existe pasta-fonte de hooks dentro de `~/.soma-v2` para o `source_root` apontar.

### Por que (c), com as provas

1. **É o que o código já faz.** `doctor.cjs:397` (`path.resolve(somaHome, entry.source_path)`), `sync.cjs:749` (`{ repoRoot: somaHome }`) e `targets.cjs:124` (`opts.repoRoot || somaHome`). **Zero mudança de código.**
2. **O custo que este documento alegava para (c) era falso.** A versão anterior dizia que ela exige "que os hooks cheguem ao `~/.soma-v2`, que hoje não tem `hooks/`". Medido: `install.sh:142` faz `rsync -a "${REPO_ROOT}/core/" "${HOME}/.soma-v2/"` — a árvore inteira de `core/`, **sem um único `--exclude`/`--filter` no arquivo**. Depois do `git mv`, `~/.soma-v2/hooks/` passa a ser entregue **sem editar uma letra** do instalador.
3. **A premissa de qual caminho é "produção" estava invertida.** `core/INSTALL.md` manda rodar `node ~/.soma-v2/scripts/install.cjs` em **8 de 8** invocações (`:26,73,90,93,94,108,111,131`) — nunca `node core/scripts/install.cjs`. O standalone é o fluxo canônico; `<repo>/core` é o laboratório.
4. **Os 8 blocos ficam intactos por construção, não por sorte.** Bloco resolve por `source_doc` (`sync.cjs:420` e `:1131`, `path.join(somaHome, entry.source_doc)`); `kind:"file"` resolve por `repoRoot`. Superfície de regressão sobre o AC-02: **vazia**.
5. **O exemplo do contrato já está correto sob (c)** — `contracts/install-file-entry.md:21` traz `"source_path": "hooks/framework-guard.cjs"`, e `path.resolve("<repo>/core", "hooks/framework-guard.cjs")` = `<repo>/core/hooks/framework-guard.cjs`, exatamente onde o arquivo passa a morar. **Nenhuma edição de contrato é necessária** — ao contrário de (d).

### O custo de (c), enumerado — e três dos cinco pontos falham em SILÊNCIO

O `git mv hooks core/hooks` move 19 `.cjs` + `hooks.json` + `lib/` + `__tests__/`. **Cinco pontos referenciam o caminho antigo.** Os **dois** silenciosos (1 e 2) são o risco real desta decisão: nenhum produz erro, os dois produzem *ausência*. O ponto 3 foi reclassificado como ALTO por medição — ver a tabela.

| # | Ponto | Como falha | Prova de que falha calado |
|---|---|---|---|
| 1 | `package.json:19` — glob `hooks/__tests__/*.test.cjs` | 🔇 **SILENCIOSO** — 7 arquivos de teste somem da suíte | `node --test 'hooks/__tests__/NAO_EXISTE_*.test.cjs'` sai **limpo**, `# fail 0`, sem avisar que o glob não casou nada |
| 2 | `hooks/framework-guard.cjs:53` — `PROTECTED_PATTERNS: 'hooks/**'` | 🔇 **SILENCIOSO** — o guarda para de proteger os próprios hooks | padrão literal ancorado, sem `**/` líder: `core/hooks/x.cjs` não casa `hooks/**` |
| 3 | `install.sh:168` — `rsync "${REPO_ROOT}/hooks/" "${HOME}/.claude/hooks/"` | 🔊 **ALTO** *(corrigido em 2026-08-21 — este documento dizia SILENCIOSO)* | medido: `install.sh:11` tem `set -euo pipefail` e `run()` faz `eval "$@"` sem fallback, então `rsync` de origem inexistente **aborta o instalador**. O "conferir" que estava aqui foi conferido: são **2** pontos silenciosos, não 3 |
| 4 | `core/scripts/__tests__/contract-run-state.test.cjs:37` | 🔊 alto — teste vermelho | `path.resolve(REPO_ROOT, 'hooks', 'spec-completeness-gate.cjs')` |
| 5 | `core/scripts/__tests__/trilho-e2e.test.cjs:37` | 🔊 alto — teste vermelho | `path.resolve(REPO_ROOT, 'hooks', 'framework-guard.cjs')` |

Fora do executável, a doc a acompanhar: `core/specs/016-artifact-gated-trilho/contracts/framework-guard-hook.md:30` (o `PROTECTED_PATTERNS` do contrato) e seu teste na linha 95. **Não quebram nada se esquecidos — apenas passam a mentir.**

**Controle positivo da varredura** (para não confundir origem com destino): as **53** referências a `~/.claude/hooks` apontam para o **destino** da instalação e **não** são afetadas. A régua distinguiu os dois sentidos: acusou os 5 de origem e ficou quieta nos 53 de destino.

⚠️ **Nenhum dos 5 pontos está nominalmente na T-08 hoje.** Entram como subtarefas explícitas — sem isso, a decisão fica escrita e o código a contradiz, que é o defeito recorrente desta base.

**Consequência para a T-08**: declarar as entries com `source_path` relativo ao `somaHome` (ex.: `"hooks/framework-guard.cjs"`, que resolve para `<repo>/core/hooks/…` após o `git mv`). O `sync` standalone passa a funcionar assim que um `install.sh` novo rodar — o `rsync` de `core/` entrega os fontes. Até lá, `validateFileEntry` **falha alto** (`source_path does not exist in repo`), nunca em silêncio.

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 1 módulo novo (`core/scripts/install/files.cjs`), 0 libs novas, 0 dependências. Abaixo do teto de 3.
- [x] **Anti-Abstraction Gate** — o módulo novo não é wrapper especulativo: cada função nele é exigida nominalmente por um AC (validação → AC-02/AC-07, hash → AC-06, decisão limpo/divergido → AC-03/AC-04, duas passadas → AC-04). Nenhuma "infraestrutura que pode ser útil depois".
- [x] **Integration-First Gate** — `node --test` com filesystem real em diretório temporário, zero mock de `fs`. Coerente com Article III e com as suítes existentes.

Nenhum gate violado. **Complexity Tracking:** vazio, de propósito.

---

## Dependencies

**Zero novas.** O `package.json` não tem as chaves `dependencies` nem `devDependencies`, e isso é decisão de arquitetura, não esquecimento. Tudo usado é stdlib do Node: `node:fs`, `node:path`, `node:crypto`, `node:os`.

---

## Baseline a preservar

**1378 tests / 1370 pass / 5 fail / 3 skip**, medido em `c3019f7`. As 5 falhas são pré-existentes (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`) e **não devem ser consertadas**. Qualquer fail novo é regressão desta spec.

> **Atualização pós-T-08 (2026-08-21, medido)**: declarar o conjunto real (31 entries `kind:"file"`) fez a suíte cheia acusar **34 fails** — o "~34" já previsto em `tasks.md` regra 5, mas por um mecanismo **diferente** do lá nomeado: não foi `BF-06`/sha256 mismatch no `CLAUDE.md`, foi `FILE_CONFLICT: file(s) diverged from what SOMA last installed` contra os 31 hooks/comandos reais. Raiz: ~25 testes de `install.cjs`/`sync.cjs` (`install.test.cjs`, `install-cli.contract.test.cjs`, `contract-files-ledger.test.cjs`) rodam via `spawnSync` **sem sobrescrever `env.HOME`** — o tmpdir de cada teste isola só o lado do projeto (`.soma/`); o lado "user-globals" resolve `~` via `os.homedir()` (`files.cjs` `expandHome()`), que lê o `$HOME` **real** da máquina. Antes da T-08 isso era invisível (só 3 entries de bloco ancoradas, idempotentes); agora toca hooks/comandos reais e aborta com segurança (AC-04/T-07 abort-total) porque o `~/.claude/hooks/` desta máquina está desatualizado — mas numa máquina onde já batesse com o repo, `npm test` escreveria por cima dos dotfiles reais como efeito colateral. Verificado sem dano: `find ~/.claude/hooks ~/.claude/commands -mmin -180` → 0 arquivos tocados. O padrão de correção **já existe** no repo (`contract-files-ledger.test.cjs:70` `withFakeHome()`, usado em 9 pontos do próprio arquivo) — só não foi espalhado para os ~25 call sites afetados. Isso fica para task própria (candidata a T-10); **não é escopo da T-08**.
>
> Dos 34, **3 eram bug de teste pré-018** (assumiam que toda entry do array é de bloco) e foram corrigidos, com prova bidirecional, na mesma leva de commits da T-08: `adapter-contract-d-c11-lint.test.cjs` (`e.block_id.replace(...)` sem guard de `kind`), `bf-04-cbm-deprecation-reproducer.test.cjs` "AC-01" (`entries.length === 3` contando o array todo), `contract-file-entry.test.cjs` "caso 1" (`allEntries.length === 8` idem — a própria mensagem do assert já dizia "8 real **block** entries", só o código não filtrava). **Baseline correto agora: `1485 / 1451 / 31 / 3`** — os 5 de sempre + os 26 restantes do buraco de `$HOME` acima, listados por nome no relatório da T-08.

**Achado colateral, registrado para quem editar este arquivo no futuro**: `core/adapters/claude/install-targets.json` tem **4 leitores** no código, e só **3** fazem strip de comentário `//`/`/* */` antes do `JSON.parse` (`lib/manifest.cjs` `loadInstallTargets`, `install/targets.cjs` `readRawInstallTargets`, `bootstrap.cjs`). O quarto, `install.cjs:655` `readBlockIdsFromTargetsFile`, faz `JSON.parse(raw)` puro dentro de um `try/catch` que devolve `[]` em qualquer erro — um comentário `//` ali quebraria a extração de `block_id` **em silêncio** (cai no catch, ninguém percebe). É por isso que a razão da exclusão do AC-12 foi registrada como campo JSON top-level `"excluded"` no `install-targets.json`, nunca como comentário. Quatro leitores do mesmo arquivo com regras de parsing diferentes é uma mina para a próxima pessoa que decidir "só adicionar um comentário ali".

---

## Notas que valem para quem implementa

- **Nunca espelhar diretório.** O repo tem 19 hooks; `~/.claude/hooks/` tem 36. Os **17 de diferença são hooks do usuário** que o SOMA não possui (`mempalace-wakeup`, `insight-action-coupling`, `vault-sync`, `reuse-gate`, `cognitive-gate`, entre outros). Instalação é **por entry declarada**, sempre. É o AC-05, e é a diferença entre uma ferramenta e um acidente.
- **O primeiro `soma install` vai abortar, e isso é o AC-04 funcionando.** Dos 19 hooks do repo: 16 estão vivos e byte-idênticos, 1 não está instalado (`framework-guard.cjs`), e 2 divergiram com o repo à frente (`spec-completeness-gate.cjs`, curado pelo K2 da 016; `spec-test-traceability.cjs`, consertado pela T-15). Os 2 divergidos disparam o abort. Reconciliá-los é ação manual do usuário. **Não "consertar" isso relaxando o AC-04.**
- **`install-state.json` não existe em lugar nenhum** — nem no repo, nem em `~/.soma-v2`. O caminho "primeira instalação" é o caminho comum, não a exceção, e o AC-10 existe porque ausência de state precisa ser distinguível de ausência de drift.
- **A ordem importa no abort.** A primeira passada avalia **todas** as entries e acumula os divergidos; a mensagem nomeia **todos** de uma vez, não só o primeiro. Abortar no primeiro faria o usuário descobrir os problemas um por rodada.
