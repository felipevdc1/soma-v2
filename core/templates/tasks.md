# Tasks: {FEATURE_TITLE}

<!-- guidance: Derived from plan.md + contracts/ + spec.md ACs. Every task MUST have a spec_ref (AC-XX or CONTRACT-XX). Orphan tasks (no spec_ref) are rejected in Step 5. -->

**Feature ID:** {NNNN-slug}
**Spec:** `specs/{NNNN-slug}/spec.md`
**Created:** {YYYY-MM-DD}

---

## Conventions

<!-- guidance: Read before editing. -->

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Step 4 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

---

## Foundation (Step 3)

<!-- guidance: Setup, scaffold, migrations, shared config. ONE task. Blocks everything else. -->

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Scaffold project structure + base config + run `npm install` | [SPEC:AC-01] | `package.json`, `tsconfig.json`, `src/index.ts` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

<!-- guidance: Per constitution Article III: contract tests BEFORE implementation. One task per contract file. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] Write contract test for `contracts/rest-endpoint.md` | [CONTRACT:rest-endpoint] | `tests/contract/endpoint.test.ts` | T-01 | TODO |
| T-03 | [P] Write contract test for `contracts/{other}` | [CONTRACT:{other}] | `tests/contract/{other}.test.ts` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

<!-- guidance: One task per AC. Each task implements the code that makes Wave 1 contract tests pass + adds integration test for its AC. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-04 | [P] Implement {AC-01 feature} + integration test `// @spec AC-01` | [SPEC:AC-01] | `src/{module}.ts`, `tests/{module}.test.ts` | T-02 | TODO |
| T-05 | [P] Implement {AC-02 feature} + integration test `// @spec AC-02` | [SPEC:AC-02] | `src/{module2}.ts`, `tests/{module2}.test.ts` | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

<!-- guidance: Wire all modules together. Entry point, server bootstrap, env config. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-06 | Wire all modules in entry point + integration smoke test | [SPEC:AC-01] [SPEC:AC-02] | `src/index.ts`, `tests/integration/smoke.test.ts` | T-04, T-05 | TODO |
