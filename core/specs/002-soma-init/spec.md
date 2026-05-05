# Spec: SOMA v2.1 Phase 3 — Init Command + Sample Project

<!-- guidance: Fill every {PLACEHOLDER}. Mark every ambiguity; resolve before APPROVED. -->

**Feature ID:** 002-soma-init
**Branch:** `feature/002-soma-init`
**Created:** 2026-05-01
**Status:** SHIPPED 2026-05-01

---

## Context

Phase 2 entregou o CLI read-only (`doctor` + `sync --dry-run`) com 110/110 tests verde, 38/38 hooks regression preserved e sources canônicos untouched. Phase 3 é o **primeiro write-mode operation do framework**: `soma init` torna SOMA adopt-able por novos projetos, criando estrutura `.soma/` mínima a partir dos templates já prontos em `~/.soma-v2/templates/project/`.

Sem `init`, SOMA não tem onboarding pra novos projetos — `doctor`/`sync` operam sobre estrutura pré-existente. Phase 3 fecha esse gap E valida end-to-end o pipeline `init → doctor → sync` via sample project ephemeral em `/tmp/`: doctor num projeto recém-init'd retorna zero findings, `sync --dry-run` reporta nothing actionable. Templates já existem em `templates/project/`, e libs `lib/anchored-blocks.cjs` + `lib/manifest.cjs` da Phase 2 são reutilizadas pra anchored block injection no AGENTS.md.

Frozen conventions herdadas (não reabrir):
- SOMA_HOME = `~/.soma-v2/`
- Anchor format: `<!-- soma-v2:start id={id} version={ver} sha256={hex64} -->` ... `<!-- soma-v2:end id={id} -->`
- Anchor ID naming: `block.{tool}.{file}.{section}` | `core.{section}` | `adapter.{tool}.{kind}` | `project.AGENTS.bootloader` (novo, Phase 3)
- Manifest schema v1 + sources canônicos NÃO modificados em Phase 3
- Stack `.cjs` vanilla CommonJS Node 18+ stdlib only, zero npm deps

---

## User Stories

<!-- guidance: Minimum 1. Format: "Como <user>, quero <action>, pra <outcome>" -->

- Como dev adotando SOMA num projeto novo (greenfield), quero rodar `soma init` num diretório vazio (ou sem `.soma/`) pra obter estrutura mínima `.soma/{project.md, CONTEXT.md, modules/index.md, installed-state.json}` com placeholders ({{PROJECT_NAME}}, {{ISO8601_DATE}}) substituídos automaticamente, sem precisar copiar templates manualmente.

- Como dev adotando SOMA num projeto que já tem AGENTS.md, quero `--with-agents-md` opt-in que injete bootloader anchored block (id=`project.AGENTS.bootloader`) no file existente preservando todo conteúdo fora do block — pra agentes Codex/Claude descobrirem `.soma/` automaticamente sem perder minhas instruções pré-existentes.

- Como dev que já rodou `soma init` num projeto, quero re-run safe: detectar `.soma/` existente e me redirecionar pra `doctor` (health check) ou `sync --dry-run` (drift preview) com exit code 1 + mensagem clara, em vez de mutar files silenciosamente — porque init é greenfield-only e updates devem passar por workflow explícito de sync.

---

## Acceptance Criteria

<!-- guidance: Every AC must be testable: "Given X, when Y, then Z". No implementation details. No HOW — only WHAT and WHY. -->

- **AC-01 (greenfield init):** Given um diretório `$P` que não contém `.soma/`, when `node ~/.soma-v2/scripts/init.cjs $P` é invocado, then exatamente 5 files são criados — `$P/.soma/project.md`, `$P/.soma/CONTEXT.md`, `$P/.soma/modules/index.md`, `$P/.soma/installed-state.json`, `$P/.soma/manifest.json` (project-level minimal manifest com schema `soma-manifest/v1` + `files: []` empty array — necessário pra `doctor --soma-home $P/.soma` rodar sem retornar `MANIFEST_MISSING`, conforme AC-07) — os 4 templates com placeholders `{{PROJECT_NAME}}` e `{{ISO8601_DATE}}` substituídos pelos valores `basename($P)` e timestamp ISO8601 UTC, e exit code = 0.

  **Decisão de implementação 2026-05-01:** o 5º file (`.soma/manifest.json`) foi adicionado pelo executor após detectar conflito entre AC-01 ("4 files exatos") e AC-07 ("doctor exit=0 findings=0 em sample") — doctor (Phase 2) requer `manifest.json` em `--soma-home` ou retorna `MANIFEST_MISSING` (exit 2). Resolução estrutural correta: init produz uma estrutura `.soma/` "completa" pra que doctor opere. Spec atualizada retroativamente pra documentar a verdade do código.

- **AC-02 (re-run redirect):** Given um diretório `$P` que já contém `.soma/` (de qualquer estado — completo, parcial, customizado), when `node ~/.soma-v2/scripts/init.cjs $P` é invocado **sem** flag `--force` (que está fora de scope), then nenhum file em `$P` é modificado nem criado, exit code = 1, e stderr (ou stdout em modo `--json`) contém mensagem indicando: (a) `$P` já está inicializado, (b) sugestão de rodar `node ~/.soma-v2/scripts/doctor.cjs` pra health check, (c) sugestão de rodar `node ~/.soma-v2/scripts/sync.cjs --dry-run` pra preview drift.

- **AC-03 (--with-agents-md em path sem AGENTS.md):** Given um diretório `$P` sem `.soma/` e sem `$P/AGENTS.md`, when `node ~/.soma-v2/scripts/init.cjs $P --with-agents-md` é invocado, then um file `$P/AGENTS.md` é criado a partir de `~/.soma-v2/templates/project/AGENTS.md.tmpl` com placeholder `{{PROJECT_NAME}}` substituído + anchored block `<!-- soma-v2:start id=project.AGENTS.bootloader version=2.1.0-draft sha256=<hex64-real> -->` ... `<!-- soma-v2:end id=project.AGENTS.bootloader -->` presente, onde `<hex64-real>` é o sha256 computado at install time do conteúdo dentro do block (não literal `FILL_AT_INSTALL`), e `installed-state.json.agents_md_managed = true`.

- **AC-04 (--with-agents-md preserva existing content):** Given um diretório `$P` sem `.soma/` e com `$P/AGENTS.md` pré-existente contendo conteúdo arbitrário (e.g., `"# My Project\n\nProject-specific instructions for agents...\n"`), when `node ~/.soma-v2/scripts/init.cjs $P --with-agents-md` é invocado, then `$P/AGENTS.md` final contém: (a) **todo** o conteúdo pré-existente preservado byte-for-byte fora do anchored block (verificável via diff ou substring match), (b) o anchored block `project.AGENTS.bootloader` adicionado (posição: append no final do file, separado por uma linha em branco do conteúdo prévio), (c) sha256 attribute do block é o sha real do conteúdo do bloco, e exit code = 0.

- **AC-05 (placeholder substitution correctness):** Given templates contêm placeholders `{{PROJECT_NAME}}` e `{{ISO8601_DATE}}`, when init roda em `$P`, then nenhum file produzido contém literal `{{PROJECT_NAME}}` ou `{{ISO8601_DATE}}` remanescente (verificável via `grep -L '{{' $P/.soma/* $P/AGENTS.md` retornando todos os files), `{{PROJECT_NAME}}` é substituído por `basename($P)`, e `{{ISO8601_DATE}}` é substituído por uma string que valida como ISO 8601 UTC (regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`).

- **AC-06 (--dry-run zero side effects):** Given `$P` é um diretório qualquer, when `node ~/.soma-v2/scripts/init.cjs $P --dry-run [--with-agents-md] [--json]` é invocado, then nenhum file em `$P` é criado nem modificado (verificável via `shasum -a 256 -c` pre/post run de qualquer file existente, ou `ls -la $P` mostrando estado idêntico), output (stdout) lista os files que **seriam** criados (formato human readable ou JSON com `summary.files_planned[]`), e exit code = 0 (greenfield) ou 1 (já inicializado).

- **AC-07 (sample project pipeline integration):** Given um diretório limpo `$SAMPLE = /tmp/soma-sample-{slug}/` onde `{slug}` é gerado uniquely (e.g., via `uuidgen | cut -c1-8`), when a sequência `node init.cjs $SAMPLE --with-agents-md` → `node doctor.cjs --soma-home $SAMPLE/.soma` → `node sync.cjs --dry-run --soma-home $SAMPLE/.soma` é executada, then init exit = 0, doctor exit = 0 com `summary.findings_count = 0` (nenhum drift), e sync --dry-run exit = 0 com `summary.actionable = 0` (nada pra inserir/replace; sample está in-sync com seu próprio template baseline).

- **AC-08 (exit codes consistency + JSON schema):** Given `--json` flag é passada, when init roda em qualquer estado (greenfield success, re-run, dry-run, hard error), then stdout é JSON parseable (`jq empty` retorna 0) com schema `{tool: "init", mode: "create"|"dry-run"|"redirect", soma_home: string, target_path: string, summary: {files_created: number, files_planned?: number, agents_md_managed: boolean}, files_created: string[]}` (ou equivalent `findings`/`error` payload em modo redirect/error); exit codes são 0=success greenfield ou dry-run, 1=already-initialized-redirect, 2=hard-error (typed errors com `.code` property: e.g., `TARGET_PATH_INVALID`, `TEMPLATE_MISSING`, `AGENTS_MD_PARSE_ERROR`).

---

## Non-Functional Requirements

<!-- guidance: List explicitly. At minimum: performance SLO, security constraints, test style (integration/unit/contract), monitoring expectations. -->

- **Performance:** init complete em < 2s em path local (baixo I/O — escrita de 4-5 files small text + 1 sha256 compute). Não há SLA crítico; é one-shot bootstrap, não hot path.
- **Security:** zero shell-out pra valores user-controlled (no command injection); path validation via `path.resolve` + check que `target_path` é diretório existente OR criável (mkdir -p ok); recusar paths que escapem fs sandbox via `..` traversal além do cwd; nunca overwrite file fora de `.soma/` ou `AGENTS.md` (write set explícito).
- **Test style:** integration tests usam `/tmp/soma-init-test-{uuid}/` fixtures replicando templates do lab; sem mocks de fs/path/crypto — tests batem em real fs, real shasum (Article III Integration-First). Unit tests OK pra parsing helpers puros (template-engine placeholder substitution, AGENTS.md anchor injector). Espelhar Phase 2 padrão (`scripts/__tests__/*.test.cjs` com `node --test` runner). Cleanup explícito em `t.afterEach` ou test teardown.
- **Dependencies:** zero `npm install` em Phase 3 — runtime usa apenas Node stdlib (`fs`, `path`, `crypto`, `os`). Stack lockada em `.cjs` vanilla CommonJS Node (per D6).
- **Portability:** macOS (primary platform). Linux/WSL2 best-effort (no Windows-specific syscalls). Path separators via `path.join` only.
- **Output format:** default = human-readable summary com colored severity (`CREATED`/`SKIPPED`/`PLANNED`/`REDIRECT`); `--json` flag retorna stable JSON schema (per AC-08); `--quiet` suprime stdout em sucesso (apenas exit code conta).
- **Logging:** zero stdout em modo `--quiet`; stderr reservado pra warnings/errors. Default mode: stdout = summary, stderr = vazio em sucesso. `--verbose` adiciona debug detail (per-file decision rationale).
- **Idempotence:** init é write-mode, **não** idempotent no sentido tradicional. Re-run em mesmo path retorna **mesmo** exit code (1) e **mesma** mensagem (redirect), preservando estado existente. Idempotência observable: re-run não muta state e retorna determinístico.

---

## Out of Scope

<!-- guidance: Explicit "will not" list prevents scope creep. Write at least one entry. -->

- **`init --existing` com module inference** (PARK pra Phase 4) — heurística pra inferir modules de filesystem/git history/package.json scripts. PLAN §7 Phase 3 não inclui; merece spec própria.
- **`init --update` ou update mode** — re-run = redirect by design; updates passam por sync (Phase 4 write-mode).
- **`init --force`** — não em escopo; quem quer re-init explicitamente pode `rm -rf .soma/ && init`.
- **Repair command** — `soma init --repair` ou recovery de `.soma/` corrupto — Phase 4+.
- **Codex/Claude adapter bootloader install** em `~/.codex/AGENTS.md` ou `~/.claude/CLAUDE.md` — sync write-mode (Phase 4 explicit per user approval). Phase 3 toca apenas `target_path` dentro de `$P`.
- **Hook migration** pra `~/.soma-v2/hooks/` — PLAN §7 Phase 5+ explícito.
- **Module cookbook population** (`.soma/modules/{module}.md` files com schema soma-module/v1) — Phase 4 (módulos hypothesis→active workflow).
- **Decision/Evidence/Worklog files instantiation** (`.soma/{decisions,evidence,worklog}/`) — diretórios podem ser criados vazios mas templates não populated em Phase 3.
- **chezmoi sync do v2** — Bucket B handoff explicitamente PAUSED pelo usuário.
- **Modificação de `~/.soma-v2/manifest.json`** — frozen rev 2; Phase 3 não toca.
- **`/soma-run` autonomous execution** — implementação Phase 3 segue manual hybrid SDD path (specify→plan-sdd→Sonnet dispatch); /soma-run dogfood deferred.
- **Multi-project bulk init** — `init` opera em um path target por invocação.
- **Interactive prompts** — init é purely arg-driven, sem `inquirer`/readline. CI/automation friendly.
- **TypeScript build pipeline** — fora de scope (D6 confirms `.cjs` vanilla).

---

## Resolved Decisions

<!-- guidance: D1-D7 resolvidos em 2026-05-01 pela equipe (caminho rápido — todas decisões locked do plan approval). Mantidos em-spec pra audit trail. -->

- **D1 — Idempotence (re-run em `.soma/` existente):** Stop + redirect. Detect `.soma/` (existência do diretório basta — não validar content) → exit 1 com mensagem indicando project já inicializado + sugestão `doctor`/`sync --dry-run`. Init é greenfield-only by design; updates são via sync (Phase 4 write-mode). Evita ambiguidade "init re-rodou e mudou meu file".

- **D2 — `--with-agents-md` default:** Opt-in (default false; flag explícito ativa). D-C4 confirmed by the user 2026-04-30 em handoff. Justificativa: bootloader em AGENTS.md é decisão de adoption por agentes externos (Codex/Claude); deve ser explícita do dev.

- **D3 — `init --existing` (module inference):** PARK pra Phase 4. PLAN §7 não inclui em closed list; heurística merece spec própria.

- **D4 — Sample project location:** `/tmp/soma-sample-{slug}/` ephemeral, `{slug}` unique per invocação (e.g., `uuidgen | cut -c1-8`). Não é first-class feature do CLI; é validation fixture do quickstart e tests.

- **D5 — AGENTS.md sha256 em anchor block:** Computed at install time (real sha256, não literal `FILL_AT_INSTALL`). Init é write-mode; primeira oportunidade real de fill. Sha256 é do conteúdo entre os markers `start`/`end` exclusive (mesma regra que Phase 2 `lib/anchored-blocks.cjs#computeBlockSha256`).

- **D6 — Existing AGENTS.md preservation algorithm:** Injection-only — parse existing file, append anchored block separado por uma linha em branco, nunca overwrite content fora do block. Per PLAN §7 exit criteria "Existing AGENTS.md content is preserved". Algoritmo: ler file, detectar se já tem block `project.AGENTS.bootloader` (idempotent within --with-agents-md? — não, init faz redirect antes de chegar aqui se .soma/ existe; se .soma/ não existe mas AGENTS.md tem block, é estado anômalo: error TARGET_INCONSISTENT_STATE).

- **D7 — Stack:** Node CommonJS `.cjs` vanilla (matches Phase 2 + hooks ecosystem 100%). Zero npm deps. Reuse `lib/anchored-blocks.cjs` + `lib/manifest.cjs` da Phase 2 via `require()`. Novos libs: `lib/template-engine.cjs` (placeholder substitution) + `lib/agents-md-injector.cjs` (parse + inject).

- **D8 — Path de execução implementação:** Hybrid SDD (`/specify` → `/plan-sdd` → manual Sonnet dispatch). Confirmed by user; Phase 2 path proven (~22min, predictable, 110/110 tests). `/soma-run` autonomous dogfood deferred.

---

## Completeness Checklist

<!-- guidance: All boxes must be checked before Gate 1. -->

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT — 8 D-decisions resolvidas em Resolved Decisions)
- [x] Zero open clarification markers (D1-D8 resolved 2026-05-01)
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry (14 entries)
- [x] Feature ID + Branch filled in
