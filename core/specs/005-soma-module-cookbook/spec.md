# Spec: Soma Module Cookbook Commands

**Feature ID:** 005-soma-module-cookbook
**Branch:** `feature/005-soma-module-cookbook`
**Created:** 2026-05-02
**Status:** SHIPPED (2026-05-02 — 15/15 ACs validated + 6/6 D resolutions + stdout-flush regression fix `4311eef`)

---

## User Stories

- Como dev SOMA num projeto post-`init --existing`, quero rodar `soma module add {keyword}` pra criar novo módulo em `.soma/modules/{slug}.md` com status `hypothesis` (per D-C9), pra agents poderem auto-load via C-1 module routing depois.
- Como dev SOMA depois de revisar manualmente conteúdo de um módulo hypothesis, quero rodar `soma module promote {slug}` pra mover de `hypothesis → active` (D-C9 lifecycle), pra que outros agents tratem o módulo como confiável.
- Como dev SOMA, quero rodar `soma module remove {slug}` (delete destrutivo) ou `soma module deprecate {slug}` (marca não-destrutiva), pra retirar módulo obsoleto sem corromper history dos outros.
- Como dev SOMA executando `soma doctor` semanalmente, quero ver warning sobre modules em `hypothesis` há >90d sem promote, pra catch stale modules antes que viram débito invisível (D-C9 stale-hypothesis pattern).
- Como agent SOMA querendo snippet rápido de código (Bruno C-1 cookbook pattern), quero search-and-pick em `~/.soma-v2/cookbook/snippets/{slug}.json` companion file, pra evitar carregar markdown completo do módulo só pra pegar 5 linhas.

---

## Acceptance Criteria

- **AC-01:** Given um projeto SOMA com `.soma/modules/` existing, when `soma module add {keyword}` é executado e slug derivado não existe, then arquivo `.soma/modules/{slug}.md` é criado a partir do template `templates/project/.soma/modules/module.md.tmpl` com front-matter `status: hypothesis`, `name: {keyword}`, `initialized_at: ISO8601`, `source_confidence: low`, e demais campos preenchidos com defaults do template.
- **AC-02:** Given um projeto SOMA onde `.soma/modules/{slug}.md` já existe, when `soma module add {keyword}` é executado com slug colidente, then comando aborta com exit 1 + `error_code: "MODULE_EXISTS"`, source untouched.
- **AC-03:** Given um module com `status: hypothesis`, when `soma module promote {slug}` é executado, then front-matter atualiza pra `status: active` + adiciona `promoted_at: ISO8601` + `last_verified: ISO8601`. Body do markdown é preserved (não rewrite).
- **AC-04:** Given um module com `status: active`, when `soma module promote {slug}` é executado, then comando aborta com exit 1 + `error_code: "ALREADY_ACTIVE"`, sem modificação.
- **AC-05:** Given um slug que não corresponde a nenhum module existente, when `soma module promote {slug}` é executado, then comando aborta com exit 1 + `error_code: "MODULE_NOT_FOUND"`.
- **AC-06:** Given um module existing, when `soma module remove {slug}` é executado com confirmação, then arquivo `.soma/modules/{slug}.md` é deletado + companion `cookbook/snippets/{slug}.json` é deletado se existe.
- **AC-07:** Given um module existing, when `soma module deprecate {slug}` é executado, then front-matter atualiza pra `status: deprecated` + `deprecated_at: ISO8601`, mantém arquivo no disco e mantém body.
- **AC-08:** Given modules em projeto com `status: hypothesis` há ≥90 dias (`initialized_at` vs hoje), when `soma doctor` é executado, then output inclui findings tipo `stale_hypothesis` por module com idade exata e `slug`. Limiar 90d hardcoded em MVP per D-C9 lock.
- **AC-09:** Given `soma module add {keyword} --with-snippet` é executado, then além do markdown criado (per AC-01) também cria `~/.soma-v2/cookbook/snippets/{slug}.json` com schema `{ schema: "soma-snippet/v1", slug, keywords: [keyword], snippets: [] }` skeleton vazio pra dev preencher.
- **AC-10:** Given `soma module add {keyword}` é executado SEM `--with-snippet`, when comando completa, then arquivo JSON em `cookbook/snippets/` NÃO é criado (lazy/opt-in policy).
- **AC-11:** Given um keyword com whitespace ou caracteres especiais (`"Auth System"`, `"foo/bar"`), when `soma module add` deriva o slug, then conversão é deterministic: lowercase + replace non-alphanumeric com `-` + collapse `--` runs + trim leading/trailing `-`. Slug result documentado no stdout antes de criar.
- **AC-12:** Given um keyword cujo slug derivado conflita com nome reservado (`manifest`, `snapshots`, `evidence`, `modules`, `cookbook`, `config`), when `soma module add` é executado, then aborta com exit 1 + `error_code: "RESERVED_SLUG"`.
- **AC-13:** Given Phase 4a `init --existing` detected modules em projeto target, when subsequente `soma module add` é executado pra cada module detectado, then arquivos populam `.soma/modules/` via comando público (não via direct file write em `init --existing`).
- **AC-14:** Given existing `~/.soma-v2/docs/module-cookbook.md` (449 bytes stub-redirect), when Phase 4c ships, then arquivo é evolved com section "## Cookbook commands (Phase 4c)" appended (preserve original 449 bytes intactos como historical context).
- **AC-15:** Given existing 315/315 SOMA tests + 48/48 hooks regression baseline, when 4c ships, then ambas counts preserved + 6 canonical+lib shasums match `/tmp/phase4bc-shasum-before.txt`.

---

## Non-Functional Requirements

- **Performance:** `module add/promote/remove/deprecate` <100ms. `doctor` stale-hypothesis scan <500ms para 100 modules.
- **Security:** slug derivation NÃO pode escapar `.soma/modules/` — `..`, `/`, leading-`-` resultam em `INVALID_SLUG` error. Snippet path `~/.soma-v2/cookbook/snippets/{slug}.json` validado contra mesma slug regex.
- **Test style:** integration tests via tmp dir + `child_process.spawnSync` (sem mocks). Contract test em `contracts/module-commands.md` com schema completo + error codes. TDD HARD per Article II + C-2 enforcement: dispatch corre com `SOMA_RED_PHASE_STRICT=1` env.
- **Backward compat:** shasum-locked libs (`anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) untouched. 315/315 SOMA + 48/48 hooks regression preserved.
- **Idempotência:** `module add` em slug existente é error (AC-02), não silent overwrite. `promote` em already-active é error (AC-04), não silent. Operações destructivas (`remove`) são idempotent (re-run em slug não-existente exit 0 com warn).

---

## Out of Scope

- `soma module list/show/edit` (read/edit commands) — Phase 5+ se demand surface
- Module versioning ou diff entre versões — Phase 5+
- Module migration entre projetos (export/import) — Phase 5+
- Module dependency graph (cross-references entre modules) — Phase 5+
- Auto-promotion baseada em telemetry/usage stats — Phase 6+ (D-C14 sem auto-consolidation)
- `soma snippet add/edit/search` (snippet content management) — esta spec só skeleton. Phase 5+ pra full snippet mgmt
- Multi-module operations em batch (`soma module promote --all`) — Phase 5+

---

## Resolved Decisions (2026-05-02 — user ratified)

- **D1 (was 005-NC1) — `module remove` confirmation**: prompt default (`Are you sure? This deletes .soma/modules/{slug}.md and cookbook/snippets/{slug}.json (if exists). [y/N]`) + `-y/--yes` flag pra non-interactive (CI / agent automation). **Why**: Bruno P6 "crescer limpo" require explicit confirmation pra destructive ops; flag preserva ergonomia em scripts.
- **D2 (was 005-NC2) — `module-cookbook.md` evolution**: append section `## Cookbook commands (Phase 4c)` ao final do file existing (preserva 449 bytes original como historical context). **Why**: stub redirect aponta pra PLAN.md §4.4 que ainda é canonical; Phase 4c ships docs descrevendo novos commands sem invalidar redirect existente.
- **D3 (was 005-NC3) — Snippet JSON schema scope**: minimal MVP `{ schema: "soma-snippet/v1", slug, keywords: [string], snippets: [{title, content, lang}] }`. Sem `created_at`/`updated_at`/`author`/`tags`/`examples` em MVP. **Why**: YAGNI; Phase 5+ adiciona campos quando demand surface.
- **D4 (was 005-NC4) — `promote` em manual-edited front-matter**: validate front-matter schema PRE-write; if breaking edits detected (extra unknown fields, malformed YAML, missing required keys), abort com exit 1 + `error_code: "SCHEMA_INVALID"`. User must `module deprecate` + `module add` again, OR Phase 5+ adiciona `--rewrite` flag pra force-canonical promote. **Why**: silent rewrite de manual edits é o pior failure mode; explicit error force user awareness.
- **D5 (was 005-NC5) — Stale-hypothesis 90d threshold**: calendar 90d, computed via `Math.floor((Date.now() - new Date(initialized_at).getTime()) / 86400000)`. **Why**: calendar simpler do que business days; user-visible threshold; D-C14 alinha com mesmo pattern em outras stale checks.
- **D6 (was 005-NC6) — `soma doctor` stale-hypothesis severity**: `warning` (non-blocking; doctor exit 0 mesmo com warnings; surface ao user em stdout). **Why**: stale-hypothesis é heads-up signal, não failure; bloquear doctor exit em hypothesis stale criaria friction não-justificável.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry
- [x] Feature ID + Branch filled in
