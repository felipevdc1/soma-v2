# Spec: `soma install` aprende a instalar arquivo inteiro

**Feature ID:** 018-install-whole-files
**Branch:** `feature/018-install-whole-files`
**Created:** 2026-08-17
**Status:** APPROVED — Gate #1 do Felipe em 2026-08-17, reafirmado em 2026-08-21 ("bora executar a spec 018"). Provenance: registrado em `~/.claude/plans/handoff-forge.md`; nenhum gate no código lê este campo (verificado: `grep -rn APPROVED core/scripts hooks` sem match), então ele é declaração para leitor humano.

---

## Discovery — estado empírico medido antes de especificar

Article XII / Failure Mode #9. Tudo abaixo foi **rodado**, não estimado. Fonte lida: `core/scripts/install.cjs` (1227 linhas), `core/scripts/sync.cjs` (1258), `core/scripts/doctor.cjs` (835), os dois `install-targets.json`.

**O que já existe e funciona:**

- Schema `soma-install-targets/v1`. Entry = **exatamente 4 campos**: `block_id`, `source_doc`, `target_path`, `target_anchor_id`.
- 8 entries no total — 3 no adapter `claude`, 5 no `codex`. **Todas** bloco-ancorado, todas apontando pra `~/.claude/CLAUDE.md` ou `~/.codex/AGENTS.md`. **Zero** entries de arquivo.
- `sync.cjs:409-530` processa por entry lendo `target_anchor_id` + `source_doc`. `sync.cjs:666` **deriva `block_id` da âncora**. `sync.cjs:1130` tem gate duro no schema.
- Detecção de conflito: `detectConflictInfo(target_path, target_anchor_id)` (`sync.cjs:774`) e `detectLocalEdits(...)` (`:911`). **As duas exigem âncora** pra saber qual região é do SOMA.
- `install-state` é validado por whitelist: `ALLOWED_STATE_FIELDS` (`install.cjs:74`) tem 8 campos — `$schema`, `status`, `timestamp`, `snapshotId`, `harness`, `installedVersion`, `lastError`, `blockIds`.
- `doctor.cjs` tem `detectTargetDrifts(somaHome, adapters)` para blocos.

**Gaps empíricos:**

- **Nenhum arquivo é instalado por nada.** Hook e comando chegam ao `~/.claude/` só à mão.
- **`install-state.json` não existe em lugar nenhum** — nem no repo, nem em `~/.soma-v2`. O `soma install` nunca completou neste ambiente.
- **O `doctor` é cego para arquivo.** Toca `~/.claude/hooks/` em um único ponto (`:441`, procurando `auto-load-modules.cjs` para o check de context-routing) e **não confere drift de hook nenhum**. Reportou `No drift detected` com 6 hooks defasados.
- ⚠️ **O repo tem 19 hooks; a instalação viva tem 36.** São **17 hooks vivos que o SOMA não possui** (`mempalace-wakeup`, `insight-action-coupling`, `vault-sync`, `reuse-gate`, `cognitive-gate` e outros do usuário). **Consequência de design, não detalhe**: a instalação tem de ser **por entry declarada**, nunca espelho de diretório — espelhar apagaria os 17.
- Comandos: `commands/` na raiz tem 11 arquivos, `core/adapters/claude/commands/` tem 7. **5 duplicados, todos divergidos** (`hyd.md`: 150 linhas divergentes num arquivo de ~130 — reescritas diferentes, não versões). O adapter é mais novo em **5 de 5** (raiz: 3 de maio, 1 de julho).
- A instalação viva é uma **terceira linhagem**: `hyd.md` e `sonar-audit.md` batem com o adapter; `plan-sdd.md` (6 linhas do raiz), `specify.md` (11 do adapter) e `soma-run.md` (2 do raiz, **422** do adapter) batem com nenhum.

**O dano que este gap já causou**, e é o que justifica a spec:

1. A instalação de hooks ficou **3 meses** defasada (6 hooks + 6 testes). O `capture-defer-gate.cjs` vivo era de 5 de maio, anterior ao commit que criou o isolamento de telemetria — o binário não sabia ler a variável de ambiente, e o diagnóstico consumiu uma sessão inteira perseguindo a hipótese errada.
2. **Agora**: o `hooks/framework-guard.cjs` da Fase 2 está no repo, registrado no `install/soma-hooks-map.json`, 12/12 testes verdes — e **não protege nada**, porque não está em `~/.claude/hooks/`.

---

## Outcome & Guardrails

**OUTCOME observável:** depois de `soma install --tool claude`, um hook ou comando que existe no repo **existe idêntico** em `~/.claude/`, e o `soma doctor` **acusa** quando os dois divergem. Hoje as duas coisas são falsas.

**APPETITE:** ~2-3 dias em waves. A mudança é **aditiva** — nenhuma das três fontes (`install.cjs`, `sync.cjs`, `doctor.cjs`) é reescrita.

**NO-GOS** — o que esta feature explicitamente NÃO faz:

- **Não reescreve `install.cjs`/`sync.cjs`/`doctor.cjs`.** Entries de bloco continuam funcionando byte a byte como hoje; as 8 existentes não mudam de comportamento.
- **Não muda o modelo de bloco ancorado** nem o `BLOCK_CONFLICT`.
- **Não instala o `soma-run.md`.** Decisão do usuário em 2026-08-17: ele quer rodar um laboratório à mão com a versão de 296 linhas antes de ela virar default. A que ele roda hoje tem 474 linhas, **0** `Gate:`, **0** `Report:` e state ainda em `/tmp` — trocar isso sem ele ver é mudança de fluxo de trabalho, não refresh de arquivo.
- **Não espelha diretório e não apaga arquivo que o SOMA não declarou.** Os 17 hooks do usuário são intocáveis.
- **Não conserta as 5 falhas pré-existentes** (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`). Baseline a preservar: **1378 tests / 1370 pass / 5 fail / 3 skip**, medido em `c3019f7`.

---

## User Stories

1. **Como Felipe**, quero que um hook que eu construí no repo passe a valer na minha máquina rodando um comando, pra que trabalho de hook pare de ser teórico até alguém lembrar de copiar à mão.
2. **Como Felipe**, quero que o `soma doctor` me diga que a instalação divergiu do repo, pra que eu não passe uma sessão inteira diagnosticando um binário defasado achando que é bug de lógica.
3. **Como Felipe**, quero que o instalador **se recuse a sobrescrever** um arquivo que eu editei à mão, pra que eu não perca customização em silêncio.
4. **Como agente do SOMA**, quero que o `framework-guard` esteja de fato ativo, pra que o bloqueio de path protegido exista no mundo e não só no repositório.

---

## Acceptance Criteria

### AC-01: WHERE uma entry declara `kind: "file"`, the soma-install SHALL copiar o arquivo-fonte para o `target_path` preservando o conteúdo byte a byte

Given uma entry de arquivo apontando para um hook do repo / When `soma install --tool claude` roda num ambiente sem esse arquivo instalado / Then o arquivo existe no destino e `diff` contra a fonte sai `0`.

### AC-02: WHERE o `install-targets.json` contém entries de bloco e de arquivo misturadas, the soma-sync SHALL processar as duas sem alterar o comportamento das de bloco

Given as 3 entries de bloco existentes do adapter `claude` mais entries de arquivo novas / When `soma sync --dry-run` roda / Then os findings das entries de bloco são idênticos aos de antes da mudança, e as de arquivo aparecem com o mesmo vocabulário de `action`.

### AC-03: WHEN um arquivo instalado está idêntico ao que o SOMA gravou por último, the soma-install SHALL sobrescrevê-lo sem pedir confirmação

Given um arquivo instalado e não editado desde a instalação / When a fonte no repo mudou e `soma install` roda / Then o destino é atualizado e a ação é reportada.

### AC-04: IF qualquer arquivo declarado divergiu do que o SOMA gravou por último, THEN the soma-install SHALL abortar a instalação inteira antes de escrever qualquer arquivo, nomeando cada path divergido

Given 19 arquivos declarados, dos quais 1 foi editado à mão / When `soma install` roda / Then **nenhum dos 19** é escrito, a saída nomeia o path divergido e a causa, e o exit code sinaliza abort — **nunca** sucesso silencioso e **nunca** aplicação parcial.

**Precedente que fixa esta semântica** (decisão do usuário, 2026-08-17): é o que o `sync --apply` já faz para bloco — o teste `AC-13: sync --apply aborts with BLOCK_CONFLICT` mostra que conflito **aborta a aplicação inteira**, não aplica parcialmente. O estado final é sempre previsível: ou tudo mudou, ou nada mudou.

> **Convenção de numeração desta spec:** todos os ACs são `AC-NN` sem sufixo de letra, de propósito. O `AC_LINE_RE` do gate casa `AC-\d+` e **silenciosamente não casa** sufixo — um `AC-04b` ficaria sem lint e sem cobertura, e ninguém perceberia. Aconteceu na spec 016.

### AC-05: WHERE existem arquivos em `~/.claude/hooks/` que nenhuma entry declara, the soma-install SHALL preservá-los intactos

Given os 17 hooks do usuário que o SOMA não possui / When `soma install --tool claude` roda / Then os 17 continuam existindo e inalterados, e nenhum é apagado, movido ou sobrescrito.

### AC-06: WHEN o SOMA grava um arquivo, the soma-install SHALL registrar no `install-state` a identidade do conteúdo gravado

Given uma instalação bem-sucedida de N arquivos / When o `install-state` é lido depois / Then ele contém, para cada arquivo, o `target_path` e a identidade do conteúdo, suficiente para AC-03 e AC-04 decidirem sem consultar o repo.

### AC-07: WHERE o `install-state` ganha campo novo, the soma-install SHALL continuar rejeitando campo fora da whitelist

Given a whitelist `ALLOWED_STATE_FIELDS` estendida com o campo de arquivos / When um `install-state` com campo desconhecido é validado / Then a validação rejeita, como já rejeita hoje.

### AC-08: WHEN `soma doctor` roda, the soma-doctor SHALL comparar cada arquivo declarado contra a fonte do repo e reportar divergência

Given um arquivo instalado defasado em relação ao repo / When `soma doctor` roda / Then ele **não** reporta `No drift detected`, e a saída nomeia o arquivo defasado.

### AC-09: IF nenhum arquivo declarado divergiu, THEN the soma-doctor SHALL permanecer silencioso quanto a arquivos

Given todos os arquivos declarados idênticos à fonte / When `soma doctor` roda / Then não há finding de arquivo — o check é específico, não ruidoso.

### AC-10: WHERE o `soma doctor` não encontra `install-state`, the soma-doctor SHALL distinguir "nunca instalado" de "sem drift"

Given um ambiente sem `install-state.json` / When `soma doctor` roda / Then a saída diz explicitamente que não há registro de instalação, em vez de reportar ausência de drift — silêncio de check que não rodou é indistinguível de silêncio de check limpo.

### AC-11: WHEN a migração dos comandos é aplicada, the soma-repo SHALL ter uma única cópia de cada comando

Given os 5 duplicados divergidos e os 6 órfãos da raiz / When a migração é aplicada / Then `core/adapters/claude/commands/` contém os 6 órfãos, os 5 duplicados da raiz não existem mais, e nenhum comando existe em dois lugares.

### AC-12: WHERE o conjunto instalado é declarado, the soma-install SHALL NOT incluir o `soma-run.md`

Given o conjunto de entries de arquivo desta spec / When ele é inspecionado / Then não há entry para `soma-run.md`, e a razão está registrada no adapter.

---

## Non-Functional Requirements

- **Compatibilidade:** as 8 entries de bloco existentes não mudam de comportamento. O baseline de testes a preservar é **1378 / 1370 / 5 / 3** (`c3019f7`); qualquer fail novo é regressão desta spec.
- **Zero dependência nova.** O `package.json` não tem as chaves `dependencies` nem `devDependencies`, e não deve passar a ter. Identidade de conteúdo usa o `node:crypto` da stdlib.
- **Test style:** `node --test` com filesystem real em diretório temporário, zero mock de `fs`. `os.tmpdir()` neste Mac **não** é `/tmp` — hardcodar `/tmp` faz o teste passar sem testar. Todo AC precisa de teste referenciado por `[SPEC:AC-XX]` em `tasks.md` e `// @spec AC-XX` no teste.
- **Segurança:** a escrita nunca segue symlink para fora do `target_path` declarado, e nunca escreve fora do diretório do destino declarado. `target_path` com `..` é rejeitado antes de qualquer path ser construído.
- **Reversibilidade:** toda escrita de arquivo é precedida de backup do destino quando ele já existe, no mesmo padrão do snapshot que o `sync --apply` já pratica para bloco.
- **Idempotência:** rodar `soma install` duas vezes seguidas sem mudança no repo produz zero escrita na segunda.

---

## Out of Scope

- Instalar o `soma-run.md` — ver NO-GOS. Fica para depois do run de laboratório do usuário.
- Instalar arquivo para o adapter `codex` — esta spec entrega o mecanismo e o conjunto do `claude`. As 5 entries de bloco do `codex` continuam funcionando; entries de arquivo para ele são spec futura.
- Desinstalar ou remover arquivo que deixou de ser declarado. Só instalação e atualização.
- Reconciliar as divergências da terceira linhagem viva (`plan-sdd.md`, `specify.md`) automaticamente — o AC-04 vai **recusar** esses dois, e a reconciliação é ação manual do usuário, informada pela recusa.
- Merge de conteúdo. Arquivo é tudo-ou-nada; quem quer merge usa entry de bloco.

---

## Questões resolvidas

As duas questões que esta spec abriu foram fechadas em 2026-08-17, antes do `/plan-sdd`. Ficam registradas com o motivo para não serem re-decididas.

**Q1 — o conjunto de hooks são todos os 19 do repo, ou um subconjunto?** → **Todos os 19.** Resolvida por **medição**, não por preferência: dos 19 hooks do repo, **16 já estão vivos em `~/.claude/hooks/` e byte-idênticos**, o que prova empiricamente que pertencem à instalação de usuário. Os 3 restantes são precisamente o que o instalador precisa entregar — `framework-guard.cjs` **não instalado** (é o da Fase 2), e `spec-completeness-gate.cjs` + `spec-test-traceability.cjs` **divergidos com o repo à frente** (o primeiro migrado pelo K2 da 016 para achar state em `.soma/`, o segundo consertado pela T-15).

**Q2 — abort total ou aplicação parcial quando 1 de N divergiu?** → **Abort total**, ver AC-04. Segue o precedente do `sync --apply` com `BLOCK_CONFLICT`.

**Q3 — o `framework-guard.cjs` entra no conjunto declarado, apesar de bloquear `git commit`?** → **Sim, entra.** Decisão do Felipe em 2026-08-21, tomada depois de o conflito ser levantado explicitamente: o handoff `~/.claude/plans/handoff-forge.md` registrava, de 2026-08-17, *"framework-guard fica só no repo por enquanto — não sincronizar pro `~/.claude/hooks/` sem ele na frente do terminal"*, o que contradizia a Q1 ("todos os 19") e a User Story 4.

A contradição se resolve porque **declarar não é instalar**. A T-08 escreve a entry; o smoke da T-09 roda em `$HOME` temporário; e o `soma install` contra o `~/.claude` real continua sendo comando que o Felipe roda, com o AC-04 abortando enquanto os 2 hooks divergidos não forem reconciliados à mão.

⚠️ **Consequência aceita, e registrada aqui para não ser redescoberta como surpresa**: quando ele reconciliar os 2 divergidos e rodar o install de verdade, o `framework-guard` passa a bloquear `git commit` **em qualquer repositório** cujo staged toque `hooks/`, `core/scripts/`, `install/` ou arquivos de constituição — os padrões são relativos ao repo, então o efeito não fica contido no `soma-v2`. O bypass é por marker de sessão. Ele sabe disso e escolheu assim.

**Consequência imediata e conhecida**: com o estado atual, o primeiro `soma install` **vai abortar** — porque `spec-completeness-gate.cjs` e `spec-test-traceability.cjs` estão divergidos. Isso é o AC-04 funcionando, não um bug. A reconciliação desses dois é ação manual do usuário, informada pelo abort. A alternativa — instalar parcialmente — esconderia o fato.

---

## Rastreabilidade

Origem: Buckets B e D do `~/.claude/plans/handoff-forge.md`, que a Fase 2 (spec 016) expôs como **a mesma doença** — o instalador só sabe instalar bloco de texto dentro de arquivo, então tudo que é arquivo inteiro (hook, comando) ficou de fora. Decisões do usuário travadas em 2026-08-17: adapter é canônico, sobrescreve-limpo/recusa-divergido, `soma-run.md` fora.
