# Spec: Foundation Primitive (Phase 4d)

**Feature ID:** 006-foundation-primitive
**Branch:** `feature/006-foundation-primitive`
**Created:** 2026-05-02
**Status:** SHIPPED (2026-05-02 — 17/17 ACs validated + 7/7 D resolutions Bruno-style + Phase 4d implementation 117 tests passing)

---

## User Stories

- Como dev SOMA num projeto em foundation phase, quero rodar `soma doctor --foundation-check` pra ver status binário dos 9 critérios Bruno's "fundação sólida", pra saber objetivamente quando a base está limpa o suficiente pra começar expansion (galhos+folhas).
- Como o usuário (gate-keeper antes de expansion shipping), quero ver foundation status binário (todos 9 PASS = "foundation done") antes de greenlight expansão lateral, pra evitar vazamento de débito invisível pra fora.
- Como agent SOMA executando Step 5 VALIDATE em territory marcado `foundation`, quero falhar com critical finding quando algum dos 9 critérios não pass, pra não permitir consolidate work em base não-sólida (Bruno P6 "crescer limpo até base estar forte").
- Como dev externo lendo `.soma/project.md`, quero ver foundation_layers + expansion_layers explícitos (Bruno P6 ontology RAÍZES/TRONCO/GALHOS+FOLHAS), pra entender qual módulo é foundation vs expansion sem precisar inferir.

---

## Acceptance Criteria

- **AC-01:** Given um projeto SOMA inicializado, when `.soma/project.md` schema soma-project/v1 é estendida, then ganha campos novos: `foundation_layers: [string]` (default: `["roots", "trunk"]`) + `expansion_layers: [string]` (default: `["leaves"]`). Schema version bump opcional pra v1.1 ou kept v1 com campos opcionais.
- **AC-02:** Given um module file `.soma/modules/{slug}.md`, when front-matter ganha campo opcional `layer: roots|trunk|leaves`, then default é `leaves` se ausente (lenient — preserva backward compat).
- **AC-03:** Given um projeto SOMA com modules layered, when `soma doctor --foundation-check` é executado, then output lista cada um dos 9 Bruno criteria com status (`pass`/`fail`/`skipped`/`not-applicable`) + per-criterion message indicando porquê.
- **AC-04:** **Criterion 1 — "padrões claros"** verified via: presença de `~/.claude/templates/decision.md`-style ADR files em `docs/architecture-decisions/*.md` (count ≥1) OR `.soma/project.md` ganha array `decisions: []` populated (count ≥1). Pass se qualquer caminho satisfeito.
- **AC-05:** **Criterion 2 — "rotas + APIs definidas zero ambiguidade"** verified via: cada module marcado `layer: trunk` tem ≥1 contract file em `specs/*/contracts/*.md` referenciando esse module (cross-ref via spec_ref ou metadata). Pass se todos trunk modules cobertos.
- **AC-06:** **Criterion 3 — "zero data leakage"** verified via: foundation modules (`layer: roots|trunk`) não importam OR referenciam expansion modules (`layer: leaves`). Static check via grep de import/require strings em source files declarados em module's `source_files`. Pass se zero violations.
- **AC-07:** **Criterion 4 — "zero hardcoded"** verified via: grep em foundation source files (modules `layer: roots|trunk` → respective `source_files`) por padrões hardcoded — credenciais (regex `password|secret|api_key|token`), paths absolutos (regex `/Users/|/home/|C:\\`), URLs hardcoded (regex `http://localhost|http://127`). **Bruno spirit: 0 HARD em todas categorias** — qualquer match = criterion fail. (D1 Bruno P6 "zero hardcoded" — não tolerable count.) Mensagens claras com path:line por hit pra usuário corrigir.
- **AC-08:** **Criterion 5 — "tudo dados reais"** verified via: scan de paths productivos (foundation source files) por fixture indicators (`fixtures/` dir embutido em src/, mock data files com naming `mock-*` ou `fake-*`, etc.). Fixtures legítimos só em test paths (`tests/`, `__tests__/`, `__fixtures__/`). Pass se zero fixtures em productive paths.
- **AC-09:** **Criterion 6 — "testes passando"** verified via: project.md ganha campo `test_command: string` (e.g. `"npm test"` ou `"node --test scripts/__tests__/*.test.cjs"`). Doctor runs `test_command` via spawnSync; pass se exit 0. Sem field configurada → criterion `skipped` com message "test_command not configured in project.md".
- **AC-10:** **Criterion 7 — "build limpo"** verified via: project.md ganha campo `build_command: string` (e.g. `"npm run build"`). Doctor runs build via spawnSync; pass se exit 0 AND stderr não contém pattern `WARNING|warn` (case-insensitive). Skipped se field ausente.
- **AC-11:** **Criterion 8 — "IDE sem erro"** verified via: project.md ganha 2 campos novos `typecheck_command: string` (e.g. `"npx tsc --noEmit"`) + `lint_command: string` (e.g. `"npx eslint ."`). Doctor runs both; pass se ambos exit 0. Skipped se ambos absent.
- **AC-12:** **Criterion 9 — "tech stack bem definida"** verified via: project.md ganha array `tech_stack: [{name, version, role}]` populated com ≥1 entry. Pass se array existe e count ≥1.
- **AC-13:** Given `soma doctor --foundation-check` invocado, when comando completa, then exit 0 (NÃO bloqueia, per Bruno D6 stale-hypothesis pattern). Surfaces warnings + finding entries em output. Critical findings só em modo `--gate` (AC-15).
- **AC-14:** Given Step 5 VALIDATE em projeto SOMA, when território a validar é marcado foundation (qualquer module com `layer: roots|trunk` faz parte do território), then VALIDATE step roda foundation-check + emits `severity: critical` finding por cada criterion fail (vs `severity: warning` em standalone `--foundation-check`).
- **AC-15:** Given `soma doctor --foundation-check --gate` (gate mode), when comando completa, then linha final stdout é "fundação sólida o suficiente?" (pergunta retórica) + exit 0 se TODOS 9 criteria pass + exit 1 se qualquer criterion fail (binary all-pass requirement).
- **AC-16:** Given user manually edits `.soma/project.md` adding/customizing `foundation_layers` ou `expansion_layers` ou `tech_stack`, when subsequent `soma sync` ou `soma doctor` rodam, then user-edits são preserved (não rewrite). Same backward-compat principle do AC-14 spec 005 (module-cookbook.md preserve).
- **AC-17:** Given um projeto SOMA SEM os novos campos em project.md (legacy state pre-Phase 4d), when comandos doctor/sync rodam, then comportamento default: assume all modules `layer: leaves` (expansion default), pula foundation-check com warning "foundation_layers not configured; assume project in expansion phase only".

---

## Non-Functional Requirements

- **Performance:** `--foundation-check` completes <2s para typical project (≤100 modules). Critério 6/7/8 (test/build/typecheck/lint) podem exceder esse limite — são timeout do project's próprio runner; doctor reporta duração mas não impõe SLO.
- **Security:** command injection prevention em `test_command`/`build_command`/`typecheck_command`/`lint_command` — strings YAML são passadas via spawnSync com `shell: false` SEM expansion. User-provided strings tratadas como argv arrays (split + escape) ou rejeitadas se contêm shell metacharacters (`;`, `&`, `|`, `$`, backticks).
- **Test style:** integration via tmp dir + spawnSync (real fs, real subprocess). TDD HARD per Article II + C-2 (`SOMA_RED_PHASE_STRICT=1`). Contract test em `contracts/foundation-check.md`.
- **Backward compat:** existing 454/454 SOMA + 47/47 hooks (subset) + 48/48 hooks aggregate preserved + 6 canonical+lib shasums match baseline.
- **Idempotência:** `--foundation-check` é read-only. Multiple invocations consecutivas retornam mesmo result (deterministic).

---

## Out of Scope

- CI/CD integration via `.github/workflows` automation (Phase 5+)
- IDE plugin pra surface foundation findings em real-time (Phase 6+)
- Multi-language criterion definitions (assume Node ecosystem in MVP; Python/Rust/Go adapter Phase 5+)
- Auto-promotion modules de `layer: leaves` → `roots`/`trunk` baseado em metrics (Phase 5+ se demand)
- Rollback foundation status quando criterion fails post-promote (Phase 5+)
- Custom criterion plugins (user-defined criterion #10+ via plugin) — Phase 6+
- Cross-harness bucket implementation — separate spec

---

## Resolved Decisions (2026-05-02 — user ratified Bruno-style)

- **D1 (was 006-NC1) — AC-07 hardcoded threshold**: **0 HARD em TODAS categorias** (credenciais + paths absolutos + URLs hardcoded). Qualquer match = criterion fail. **Why**: Bruno P6 "zero hardcoded" não admite tolerable count. Foundation source (roots/trunk) é core abstraction — tudo configurável via env/args/manifest. Mensagem inclui path:line por hit pra usuário corrigir.
- **D2 (was 006-NC2) — AC-04 "padrões claros" threshold**: ≥1 ADR file em `docs/architecture-decisions/*.md` OR `.soma/project.md` array `decisions: []` populated com ≥1 entry. **Why**: lenient mínimo verificável MVP; Phase 5+ pode subir threshold se demand surface. Não-blocker em projetos novos com 1 ADR mínima.
- **D3 (was 006-NC3) — foundation_layers enum**: strict enum `{roots, trunk, leaves}` MVP. Custom layer names → INVALID_LAYER error. **Why**: Bruno P6 ontology é fixed 3 layers (RAÍZES/TRONCO/GALHOS+FOLHAS). Custom layers diluiriam o ontology. Phase 5+ se demand real surface.
- **D4 (was 006-NC4) — Foundation done criteria**: **ALL 9 must pass binary**. Qualquer um falhando = foundation NOT done. AC-15 `--gate` exit 0 só com 9/9. **Why**: Bruno P6 "crescer limpo até base estar forte" é categórico — ou tá limpa ou não tá. Weighted scoring (≥7/9) é exatamente o pattern "kinda done" que SOMA existe pra prevenir.
- **D5 (was 006-NC5) — Test/build/typecheck/lint commands**: explicit em project.md (`test_command`, `build_command`, `typecheck_command`, `lint_command`). NO auto-detect. Field ausente → criterion `skipped` com message clara. **Why**: Bruno P6 explicit cleanup pattern. Auto-detect = silent assumption (anti-pattern). User opt-in keeps intentionality.
- **D6 (was 006-NC6) — Legacy state behavior**: lenient default — projeto sem `foundation_layers`/`expansion_layers` configurados → comando passa com warning **loud** ("foundation_layers not configured; assume project in expansion phase only — use `soma init --foundation` to set up Phase 4d primitive"). **Why**: gateway pattern facilita migração de projetos legados pré-Phase-4d. Warning ruidoso garante user awareness sem block. Strict abort seria barreira artificial pra adoção.
- **D7 (was 006-NC7) — `--gate` sentence format**: rhetorical only — output line "fundação sólida o suficiente?" + binary exit code. NÃO interactive (sem aguardar input). **Why**: agents também rodam (Step 5 VALIDATE em automated pipelines). Interactive prompts quebram automation. Pergunta retórica + exit code carrega o veredicto.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry
- [x] Feature ID + Branch filled in
