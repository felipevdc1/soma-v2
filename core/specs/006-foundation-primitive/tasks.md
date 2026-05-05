# Tasks: Foundation Primitive (Phase 4d)

**Feature ID:** 006-foundation-primitive
**Spec:** `specs/006-foundation-primitive/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: every test file committed in RED phase BEFORE implementation. RED commit verified via `validateRedPhase` against `/tmp/phase4d-work/` scratch git repo.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/phase4d-work/` scratch git repo + copy `~/.soma-v2/scripts/doctor.cjs` baseline + `scripts/lib/module-store.cjs` (read-only reference); capture shasum baseline of 6 canonical+lib files; confirm 454/454 SOMA + 47/47 hooks (subset) pass pre-work; capture `~/.soma-v2/scripts/doctor.cjs` LOC pre-Phase-4d (~423L post-4c). | [CONTRACT:foundation-check] | `/tmp/phase4d-work/{git-init,doctor.cjs,lib/module-store.cjs}`, `/tmp/phase4d-shasum-before.txt` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:foundation-check] Write contract test stub (RED) covering all 17 ACs + D resolutions per CONTRACT-FOUNDATION-CHECK-01. Initial tests fail (foundation-check flag undefined). | [CONTRACT:foundation-check] [SPEC:AC-01..AC-17] | `~/.soma-v2/scripts/__tests__/contract-foundation-check.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Each task: write integration test `// @spec AC-XX` → RED commit → minimal impl → GREEN commit. Per-AC granularity preserves traceability.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 `.soma/project.md` schema migration — adds optional fields `foundation_layers: ["roots", "trunk"]` + `expansion_layers: ["leaves"]` (defaults). Test verifies parser accepts both new + legacy state. | [SPEC:AC-01] | `~/.soma-v2/scripts/__tests__/ac-01-project-schema-migration.test.cjs`, `scripts/lib/foundation-check.cjs` (NEW, parseProjectMd fn) | T-02 | TODO |
| T-04 | [P] AC-02 module front-matter optional `layer: roots\|trunk\|leaves` field; default `leaves` if absent. | [SPEC:AC-02] | `~/.soma-v2/scripts/__tests__/ac-02-module-layer-field.test.cjs`, `scripts/lib/foundation-check.cjs` (resolveModuleLayer fn) | T-02 | TODO |
| T-05 | [P] AC-03 `doctor --foundation-check` lists 9 criteria with status (pass/fail/skipped/not-applicable) + per-criterion message. JSON + human output formats. | [SPEC:AC-03] | `~/.soma-v2/scripts/__tests__/ac-03-foundation-check-output.test.cjs`, `scripts/doctor.cjs` (--foundation-check flag), `scripts/lib/foundation-check.cjs` (orchestrator runFoundationCheck) | T-02 | TODO |
| T-06 | [P] AC-04 criterion 1 "padrões claros" verifier — pass se ≥1 ADR file em `docs/architecture-decisions/*.md` OR `decisions: []` array em project.md ≥1 entry. | [SPEC:AC-04] | `~/.soma-v2/scripts/__tests__/ac-04-criterion-1-padroes.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion1 fn) | T-02 | TODO |
| T-07 | [P] AC-05 criterion 2 "rotas+APIs" verifier — pass se cada module trunk tem ≥1 contract file em `specs/*/contracts/*.md` (cross-ref via spec_ref ou metadata). | [SPEC:AC-05] | `~/.soma-v2/scripts/__tests__/ac-05-criterion-2-contracts.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion2 fn) | T-02 | TODO |
| T-08 | [P] AC-06 criterion 3 "zero data leakage" verifier — static check: foundation modules não importam expansion modules. Grep `import|require` em foundation source files declarados em module's `source_files`. | [SPEC:AC-06] | `~/.soma-v2/scripts/__tests__/ac-06-criterion-3-leakage.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion3 fn) | T-02 | TODO |
| T-09 | [P] AC-07 + D1 criterion 4 "zero hardcoded" verifier — Bruno strict 0 HARD: regex `password\|secret\|api_key\|token` em foundation source = fail. Paths absolutos `/Users/\|/home/\|C:\\` = fail. URLs `http://localhost\|http://127` = fail. Mensagem com path:line por hit. | [SPEC:AC-07 + D1] | `~/.soma-v2/scripts/__tests__/ac-07-criterion-4-hardcoded.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion4 fn) | T-02 | TODO |
| T-10 | [P] AC-08 criterion 5 "tudo dados reais" verifier — scan productive paths por fixture indicators (`fixtures/` dir embutido em src/, files `mock-*` ou `fake-*`). Pass se zero em productive paths. | [SPEC:AC-08] | `~/.soma-v2/scripts/__tests__/ac-08-criterion-5-real-data.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion5 fn) | T-02 | TODO |
| T-11 | [P] AC-09 criterion 6 "testes passando" verifier — runs `test_command` from project.md via spawnSync shell:false. Pass se exit 0. Skipped if field absent (clear message). | [SPEC:AC-09 + D5] | `~/.soma-v2/scripts/__tests__/ac-09-criterion-6-tests.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion6 fn) | T-02 | TODO |
| T-12 | [P] AC-10 criterion 7 "build limpo" verifier — runs `build_command`. Pass se exit 0 AND stderr não contém pattern `WARNING\|warn` (case-insensitive). Skipped if field absent. | [SPEC:AC-10 + D5] | `~/.soma-v2/scripts/__tests__/ac-10-criterion-7-build.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion7 fn) | T-02 | TODO |
| T-13 | [P] AC-11 criterion 8 "IDE sem erro" verifier — runs `typecheck_command` + `lint_command`. Pass se ambos exit 0. Skipped if both absent. | [SPEC:AC-11 + D5] | `~/.soma-v2/scripts/__tests__/ac-11-criterion-8-ide.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion8 fn) | T-02 | TODO |
| T-14 | [P] AC-12 criterion 9 "tech stack" verifier — pass se project.md `tech_stack: [{name, version, role}]` array exists with ≥1 entry. | [SPEC:AC-12] | `~/.soma-v2/scripts/__tests__/ac-12-criterion-9-tech-stack.test.cjs`, `scripts/lib/foundation-check.cjs` (verifyCriterion9 fn) | T-02 | TODO |
| T-15 | [P] AC-13 standalone `--foundation-check` exits 0 mesmo com criteria fail (não bloqueia). Surfaces warnings + finding entries. | [SPEC:AC-13] | `~/.soma-v2/scripts/__tests__/ac-13-non-blocking.test.cjs`, `scripts/doctor.cjs` (exit logic) | T-02 | TODO |
| T-16 | [P] AC-15 + D7 `--gate` mode — emits "fundação sólida o suficiente?" rhetorical line + binary exit (0 if all 9 pass per D4; 1 otherwise). | [SPEC:AC-15 + D4 + D7] | `~/.soma-v2/scripts/__tests__/ac-15-gate-binary.test.cjs`, `scripts/doctor.cjs` (--gate flag) | T-02 | TODO |
| T-17 | [P] AC-16 user edits to project.md custom fields preserved across doctor/sync runs (no rewrite). | [SPEC:AC-16] | `~/.soma-v2/scripts/__tests__/ac-16-preserve-edits.test.cjs`, integration check | T-02 | TODO |
| T-18 | [P] AC-17 + D6 legacy state — projeto sem foundation_layers → warning loud + skip foundation-check + exit 0. | [SPEC:AC-17 + D6] | `~/.soma-v2/scripts/__tests__/ac-17-legacy-state.test.cjs`, `scripts/lib/foundation-check.cjs` (legacy detection) | T-02 | TODO |
| T-19 | [P] D3 invalid layer name (custom string outside enum) → INVALID_LAYER error exit 1. | [SPEC:AC-01 + D3] | `~/.soma-v2/scripts/__tests__/d3-invalid-layer.test.cjs`, `scripts/lib/foundation-check.cjs` (layer validation) | T-02 | TODO |
| T-20 | [P] AD-06 + Security NFR — command injection prevention em test_command/build_command/typecheck_command/lint_command. Reject strings com shell metacharacters (`;`, `&`, `|`, `$`, backticks) OR safely argv-split. | [SPEC:AC-09..AC-11 + Security] | `~/.soma-v2/scripts/__tests__/security-command-injection.test.cjs`, `scripts/lib/foundation-check.cjs` (validateCommand fn + spawnSync shell:false) | T-02 | TODO |
| T-21 | [P] AC-14 placeholder — Step 5 VALIDATE in foundation territory emits critical findings vs warnings. **DEFER** until Phase 5+ when /soma-run integration is wired up; document expected behavior in test stub `xtest()` skip pattern. | [SPEC:AC-14] | `~/.soma-v2/scripts/__tests__/ac-14-validate-foundation-territory.test.cjs` (skip stub) | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-22 | E2E integration smoke: synthetic project em `/tmp/soma-foundation-e2e-{slug}/` w/ all 9 criteria PASS configured (full happy path). Run `--foundation-check` → all pass → run `--gate` → exit 0 + "fundação sólida o suficiente?". Then break criterion 4 (add hardcoded path) → re-run `--gate` → exit 1. | [CONTRACT:foundation-check] | `~/.soma-v2/scripts/__tests__/e2e-foundation-primitive.test.cjs` | T-03..T-21 | TODO |
| T-23 | Phase 4d regression test (bridge wrapper pattern): cumulative SOMA tests (was 454) + new Phase 4d additions all pass. Hooks regression 47/47 preserved. 6 canonical+lib shasums match `/tmp/phase4d-shasum-before.txt`. | [CONTRACT:foundation-check] | `~/.soma-v2/scripts/__tests__/phase4d-regression.test.cjs` (NEW) | T-22 | TODO |
| T-24 | Update `~/.soma-v2/templates/project/.soma/project.md.tmpl` (if exists) with optional fields documented. Update `~/.soma-v2/templates/project/.soma/modules/module.md.tmpl` with optional `layer` field documented (preserve existing schema soma-module/v1). | [SPEC:AC-01 + AC-02] | `~/.soma-v2/templates/project/.soma/project.md.tmpl`, `~/.soma-v2/templates/project/.soma/modules/module.md.tmpl` | T-22 | TODO |
| T-25 | Copy-back from `/tmp/phase4d-work/` scratch repo to `~/.soma-v2/`. Re-verify all tests pass in destination. RED+GREEN commits visible in scratch repo via git log; report SHAs. | [CONTRACT:foundation-check] | `~/.soma-v2/scripts/doctor.cjs`, `~/.soma-v2/scripts/lib/foundation-check.cjs`, `~/.soma-v2/templates/project/.soma/{project,modules/module}.md.tmpl` | T-23, T-24 | TODO |

---

## Coverage Verification

- AC-01 → T-03 + T-19 ✓
- AC-02 → T-04 ✓
- AC-03 → T-05 ✓
- AC-04 → T-06 ✓
- AC-05 → T-07 ✓
- AC-06 → T-08 ✓
- AC-07 → T-09 ✓
- AC-08 → T-10 ✓
- AC-09 → T-11 + T-20 ✓
- AC-10 → T-12 + T-20 ✓
- AC-11 → T-13 + T-20 ✓
- AC-12 → T-14 ✓
- AC-13 → T-15 ✓
- AC-14 → T-21 (deferred Phase 5+ integration; stub now)
- AC-15 → T-16 ✓
- AC-16 → T-17 ✓
- AC-17 → T-18 ✓
- D resolutions covered via dedicated tasks: D1 (T-09), D3 (T-19), D5 (T-11/T-12/T-13), D6 (T-18), D7 (T-16)

**Coverage: 17/17 ACs (100%) + 5/7 D resolutions explicit (D2/D4 covered implicitly in AC tasks). 25 tasks total: 1 foundation + 1 contract test + 19 impl + 3 integration + 1 templates + 1 copy-back.**
