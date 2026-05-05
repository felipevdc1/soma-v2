# Spec: Soma Init Existing — Module Inference From Existing Project

<!-- guidance: Fill every {PLACEHOLDER}. Replace [NEEDS CLARIFICATION: ...] only when you have a real answer from the human. Never assume. -->

**Feature ID:** 003-soma-init-existing
**Branch:** `feature/003-soma-init-existing`
**Created:** 2026-05-01
**Status:** APPROVED (user ratification 2026-05-01: NC-1 src/-first + NC-2 90d hardcoded MVP — ready pra `/plan-sdd` derive plan/contracts/tasks/quickstart)

---

## User Stories

<!-- guidance: Minimum 1. Format: "Como <user>, quero <action>, pra <outcome>" -->

- Como o usuário (orchestrator de SOMA), quero rodar `soma init --existing` num projeto real já com código, pra populá-lo com `.soma/` + módulos detectados como `hypothesis` sem escrever cada module doc à mão.
- Como o usuário, quero opt-in via `--deep` pra rankear módulos por commit count em git history (últimos 90d) quando faz sentido, pra ver só "active modules" — e quando o projeto não é git, fallback automático pra heurística filesystem (não silent fail).

---

## Acceptance Criteria

<!-- guidance: Every AC must be testable: "Given X, when Y, then Z". No implementation details. No HOW — only WHAT and WHY. -->

- **AC-01:** Given um projeto com `src/` contendo subdiretórios, when `soma init --existing` é executado, then cada subdir sob `src/` com ≥1 arquivo é emitido como módulo candidato.
- **AC-02:** Given um projeto sem `src/` mas com `package.json` declarando `workspaces`, when init --existing é executado, then cada path de workspace expandido é emitido como módulo candidato.
- **AC-03:** Given um projeto framework (presença de `app/`, `pages/`, `components/`, `lib/` ou `api/` na raiz quando não tem `src/`), when init --existing é executado, then cada framework dir presente é emitido como módulo.
- **AC-04:** Given init --existing termina com sucesso, when listando módulos detectados, then cada `.soma/modules/{module}.md` existe com `schema=soma-module/v1`, `status=hypothesis`, `source_confidence=low`, `owners=[]`, `last_verified=null`, `verification.command=null`, `verification.files_checked=[paths reais detectados]`.
- **AC-05:** Given `--deep` flag presente num projeto git válido, when init --existing é executado, then módulos são rankeados por commit count em últimos 90 dias e só módulos com ≥1 commit no window são emitidos (subset do resultado H2 sem --deep).
- **AC-06:** Given `--deep` flag presente num projeto SEM `.git/` (ou git unreadable), when init --existing é executado, then um warning é printado indicando "no git history available, falling back to filesystem heuristic" e o resultado H2 é emitido (exit 0, não exit 1).
- **AC-07:** Given um projeto onde `.soma/` já existe, when init --existing é executado, then exit code é 1 e mensagem de redirect aponta pra `soma doctor` e `soma sync` (matching Phase 3 idempotence pattern).
- **AC-08:** Given init --existing roda em qualquer projeto, when comparando `scripts/lib/manifest.cjs`, `scripts/lib/template-engine.cjs`, `scripts/lib/anchored-blocks.cjs` antes e depois da execução, then nenhum desses 3 arquivos teve mudança (zero modificação em libs Phase 2/3).
- **AC-09:** Given quickstart validation suite, when executando `soma init --existing` em ≥3 projetos de tipos diferentes (1 framework-heavy tipo Next.js, 1 CLI/library, 1 monorepo com workspaces — todos via fixture sintética em `tests/fixtures/init-existing/` com ground-truth list de módulos esperados), then cada produz módulos detectados com hit rate ≥60% vs lista manual de módulos esperados (vinculante via fixture ground-truth — objective pass/fail, não guideline qualitativo). **Sub-clause D-C10 (evidence dir):** quando init --existing roda e produz smoke validation, a evidência vai para `evidence/{YYYY-MM-DD}/{task-slug}.md` com front-matter `modules: [lista de módulos detectados]`.
- **AC-10:** Given init --existing roda em projeto sem código source detectável (repo vazio ou sem matches H2), when finalizando, then exit code é 0 com mensagem "no modules inferred" e `.soma/modules/index.md` ainda é criado com lista vazia.
- **AC-11:** Given init --existing detecta módulos, when validando o threshold mínimo de arquivos, then um módulo candidato com ≥1 arquivo de source é emitido (NÃO ≥3 — single-file modules são semanticamente válidos).
- **AC-12:** Given init --existing produz `.soma/modules/{name}.md` stubs e `.soma/project.md`, when validando portabilidade cross-LLM, then schema validation deve retornar zero referências a primitivas Claude Code-específicas (slash command names, hook IDs, skill IDs) em campos normativos. Verificável via `grep`. **Note: full cross-LLM operational continuity (Codex/Claude switching mid-project) requires Phase 5 adapter install — Phase 4a delivers the artifact-level portability foundation per D-C11 Adapter Contract design intent.**

---

## Non-Functional Requirements

<!-- guidance: List explicitly. At minimum: performance SLO, security constraints, test style (integration/unit/contract), monitoring expectations. -->

- **Performance:** Detecção H2 (filesystem-only) completa em <5s pra projeto típico (≤500 source files). Modo `--deep` pode levar até 30s em git repo grande (>5k commits no window de 90d). Ambos não-blocking — feedback progressive ok.
- **Security:** Zero writes destrutivos fora de `.soma/`. Zero modificação de `AGENTS.md` existente (`--with-agents-md` é exclusivo do greenfield Phase 3 — `init --existing` NÃO injeta bootloader em AGENTS.md alheio). Read-only access ao filesystem do projeto-alvo (no execução de comandos do projeto, no install de deps).
- **Test style:** Integration tests via fixture projects em `~/.soma-v2/scripts/tests/fixtures/init-existing/` (real filesystem, real git via `git init` no setup do test). Contract tests pra output schema (each `.soma/modules/{name}.md` valida contra schema soma-module/v1). Zero mocks de fs ou git — usar tmpdir real.
- **Monitoring:** N/A (CLI tool sem runtime monitoring). Exit codes seguem CONTRACT-INIT-EXISTING-01 (a ser definido em /plan-sdd): 0=success, 1=preconditions failed (`.soma/` already exists, etc.), 2=invalid args.

---

## Out of Scope

<!-- guidance: Explicit "will not" list prevents scope creep. Write at least one entry. -->

- Promoção de módulos `hypothesis` → `active` (deferred pra Phase 4c — comando separado `soma module promote {name}`)
- Auto-execução de `verification.command` em módulos detectados (PLAN.md §6.5: command é descriptive metadata only — nunca executado por init/sync/doctor)
- Injeção de bootloader em `AGENTS.md` existente do projeto-alvo (`--with-agents-md` é flag exclusiva do greenfield init, NÃO disponível em `--existing`)
- Heurística pluggable / regras user-supplied de detecção de módulos (Phase 5+ se demanda surgir)
- Modo `--update` pra `.soma/` já inicializado (idempotence-by-redirect matching Phase 3 D1 lock — não há "update" path, só doctor + sync)
- Resolução de module name collision além de namespacing simples (ex: `lib/` existindo em src/ E root) — se collision detectada, flag warning + ambos emitidos com path-based naming (e.g. `src-lib`, `root-lib`); não há prompt interativo
- Sync write-mode (Phase 4b — comando separado, não tocado em `--existing`)
- Module cookbook population schema content beyond hypothesis stub (Phase 4c populates tutorial sections)
- **Phase 4 sequence note (Q2 sentence 2026-05-01):** sequência é `4a → (4c ∥ 4b)` — esta spec cobre apenas 4a (init --existing); 4b (sync write-mode) e 4c (cookbook commands `soma module add/remove/promote`) são specs separadas rodando em paralelo após conclusão de 4a. 4c bloqueia iteração de UX; 4b bloqueia adapter rollout.

---

## Open Questions

<!-- guidance: NEVER assume. Mark every ambiguity. Loop ends when this section is empty. -->

- **RESOLVED (user ratification 2026-05-01):** Quando `src/` AND framework dirs coexistem (e.g. Next.js com `src/app/` + `src/components/`), **src/-first**: H2 detecta SOMENTE subdirs sob src/ — framework dirs raiz só quando NÃO tem src/. Rationale: Next.js/Remix moderno default; evita duplicação `app/`+`components/` em src/-bearing projects.
- **RESOLVED (user ratification 2026-05-01):** `--deep` window é **hardcoded 90 dias em MVP**. Parametrização via `--deep-window=N` deferida pra Phase 5+ se demanda surgir. Rationale: reduz superfície de configuração no MVP; 90d cobre quarter de atividade típica.
- **RESOLVED (D-C10 + Q2 sentence 2026-05-01):** `--json` flag → suportado (matching init/doctor/sync convention). Evidence dir granularity → `evidence/{YYYY-MM-DD}/{task-slug}.md` com front-matter `modules: [list]` (D-C10 lock). Monorepo fixture → fixture sintética em `tests/fixtures/init-existing/monorepo-fixture/` (elimina dep externa). Hit rate ≥60% → vinculante via fixture ground-truth (objective pass/fail). `.gitignore` + blacklist → respeitar ambos: `.gitignore` do projeto + blacklist hardcoded (`node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.cache`).

---

## Completeness Checklist

<!-- guidance: All boxes must be checked (or replaced with [NEEDS CLARIFICATION]) before Gate 1. -->

- [x] Every AC is testable (Given/When/Then, observable)
- [x] No implementation details leaked into AC (no HOW — apenas WHAT/WHY; AC-08 referencia paths como constraint observable, não como instrução de impl)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining (7 de 7 resolvidos: 5 via D-C10+Q2 sentences 2026-05-01 first batch + 2 via user ratification 2026-05-01 second batch — src/-first priority rule + 90d hardcoded MVP)
- [x] NFR section has performance SLO, security constraints, test style
- [x] Out of Scope section has multiple entries
- [x] Feature ID + Branch filled in
