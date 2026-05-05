# Tasks: Soma Bootstrap CLI + Onboarding Doc

**Feature ID:** 008-soma-bootstrap
**Spec:** `specs/008-soma-bootstrap/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: every test file committed in RED phase BEFORE implementation. RED commit verified via `validateRedPhase` against `/tmp/phase008-work/` scratch git repo (since `~/.soma-v2/` is not git-tracked).

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/phase008-work/` scratch git repo + copy `~/.soma-v2/scripts/{doctor,init,sync,module}.cjs` baseline + libs; capture shasum baseline of 6 canonical+lib files; confirm 579/579 SOMA + 48/48 hooks pass pre-work; capture `~/.soma-v2/manifest.json` original for AC-14 preservation check. | [CONTRACT:bootstrap] | `/tmp/phase008-work/{git-init,scripts/}`, `/tmp/phase008-shasum-before.txt` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:bootstrap] Write contract test stub (RED commit) covering all 14 ACs per CONTRACT-BOOTSTRAP-01. Tests fail intentionally (validateRedPhase asserts RED). Includes flag parsing, output schema, error codes, exit codes. | [CONTRACT:bootstrap] [SPEC:AC-01..AC-14] | `~/.soma-v2/scripts/__tests__/contract-bootstrap.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Each task: write integration test `// @spec AC-XX` → RED commit → minimal impl → GREEN commit. Per-AC granularity preserves traceability. All [P] = parallel-safe within wave (different test files; bootstrap.cjs file-touch coordinated via merge windows).

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 — bootstrap detects `.soma/` and avança Step 2: integration test + impl Step 1 detection logic in `bootstrap.cjs`. Setup synthetic `/tmp/fixture-with-soma/`, run bootstrap, assert exit 0 + status reaches Step 2. | [SPEC:AC-01] | `scripts/bootstrap.cjs` (NEW) + `scripts/__tests__/bootstrap-detect-soma.test.cjs` | T-02 | TODO |
| T-04 | [P] AC-02 — `error_code: NO_SOMA_PROJECT` when cwd lacks `.soma/`: integration test + impl error path. Setup `/tmp/fixture-no-soma/`, assert exit 1 + JSON `error_code: "NO_SOMA_PROJECT"` + suggestion field non-empty. | [SPEC:AC-02] | `scripts/__tests__/bootstrap-no-soma-project.test.cjs` | T-02 | TODO |
| T-05 | [P] AC-03 — bootstrap valida SOMA_HOME existing manifest valid: integration test using copy of real `~/.soma-v2/`. Assert exit 0 and step 3 reached. | [SPEC:AC-03] | `scripts/__tests__/bootstrap-valid-soma-home.test.cjs` | T-02 | TODO |
| T-06 | [P] AC-04 — `error_code: INVALID_SOMA_HOME` when missing/invalid: integration test with corrupted manifest + missing dir scenarios. Assert exit 1 + suggestion field with onboarding doc reference + env var override hint. | [SPEC:AC-04] | `scripts/__tests__/bootstrap-invalid-soma-home.test.cjs` | T-02 | TODO |
| T-07 | [P] AC-05 — doctor delegation captured in-memory: impl `require('./doctor.cjs')` + invoke check function with `checkContextRouting: true`. Test verifies findings array captured (not stdout-parsed). | [SPEC:AC-05] | `scripts/bootstrap.cjs` + `scripts/__tests__/bootstrap-doctor-delegation.test.cjs` | T-02 | TODO |
| T-08 | [P] AC-06 — zero findings → status:ready + exit 0: integration test on healthy synthetic project. Assert `findings: []` and `status: "ready"`. | [SPEC:AC-06] | `scripts/__tests__/bootstrap-zero-findings.test.cjs` | T-02 | TODO |
| T-09 | [P] AC-07 — warnings only → status:drift + exit 0 + suggestion: integration test using fixture with synthetic drift (e.g., extra unanchored content in adapter). Assert findings array populated, exit 0, suggestion field references `soma sync --apply`. | [SPEC:AC-07] | `scripts/__tests__/bootstrap-drift-warnings.test.cjs` | T-02 | TODO |
| T-10 | [P] AC-08 — critical findings → status:error + critical_findings[] + exit 1: integration test using fixture with corrupted manifest schema. Assert `error_code: "CRITICAL_DRIFT"` and `critical_findings[]` populated. | [SPEC:AC-08] | `scripts/__tests__/bootstrap-critical-drift.test.cjs` | T-02 | TODO |
| T-11 | [P] AC-09 — output JSON schema (modules + adapters + findings + duration_ms): integration test asserting full schema shape per CONTRACT-BOOTSTRAP-01 (every field present + types correct). | [SPEC:AC-09] | `scripts/__tests__/bootstrap-output-schema.test.cjs` | T-02 | TODO |
| T-12 | [P] AC-10 — default mode (no `--quiet`) emits human + JSON block: integration test asserting stdout contains both human-readable line ("Project ready") and JSON parseable from final block (Phase 2/3/4 convention). | [SPEC:AC-10] | `scripts/__tests__/bootstrap-default-output.test.cjs` | T-02 | TODO |
| T-13 | [P] AC-11 — `--quiet` emits ONLY JSON: integration test asserting stdout starts with `{` and ends with `}`, valid parseable JSON, zero non-JSON noise. | [SPEC:AC-11] | `scripts/__tests__/bootstrap-quiet-mode.test.cjs` | T-02 | TODO |
| T-14 | [P] AC-12 — `~/.soma-v2/docs/onboarding.md` exists with 3+ errors documented: write doc + integration test that reads doc + validates required sections (Prerequisites, Quickstart, Troubleshooting with ≥3 error scenarios + remediation). | [SPEC:AC-12] | `docs/onboarding.md` (NEW) + `scripts/__tests__/onboarding-doc.test.cjs` | T-02 | TODO |
| T-15 | [P] AC-13 — wallclock ≤5000ms p95: perf integration test using fixture with ~10 modules, run bootstrap N=10 times, assert max ≤5000ms (p95 ≤4500ms target). | [SPEC:AC-13] | `scripts/__tests__/bootstrap-perf.test.cjs` | T-02 | TODO |
| T-16 | [P] AC-14 — read-only sha256 integrity: integration test computes sha256 of every file in SOMA_HOME copy pre-bootstrap, runs bootstrap, computes again post, asserts diff is empty. Includes both success and error paths. | [SPEC:AC-14] | `scripts/__tests__/bootstrap-readonly.test.cjs` | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-17 | Smoke E2E: chain `init --existing → bootstrap` em `/tmp/soma-sample-{slug}/`. Test creates fresh dir, runs init existing, runs bootstrap immediately after, asserts ready status + modules detected matches init output. Validates real-world workflow (Spec 003 → Spec 008 chain). | [SPEC:AC-01] [SPEC:AC-09] | `scripts/__tests__/bootstrap-e2e-smoke.test.cjs` | T-03..T-16 | TODO |
| T-18 | Regression bridge: phase008-regression.test.cjs spawns `node --test` for all 48 hook tests + Phase 2/3/4 cumulative tests; asserts 48/48 hooks aggregate + 579/579 SOMA pass-or-skip preserved (Node v22 NODE_TEST_CONTEXT bridge wrapper pattern). | [SPEC:AC-14] | `scripts/__tests__/phase008-regression.test.cjs` | T-17 | TODO |
| T-19 | Final shasum verification: shasum 6 canonical+lib files (codex AGENTS, ~/AGENTS, constitution, anchored-blocks, manifest, template-engine) post-Phase008 work; diff against `/tmp/phase008-shasum-before.txt`. Assert empty diff. | [SPEC:AC-14] | `/tmp/phase008-shasum-after.txt` | T-18 | TODO |

---

## Coverage check

| AC | Tasks | Coverage |
|---|---|---|
| AC-01 | T-03, T-17 | ✓ |
| AC-02 | T-04 | ✓ |
| AC-03 | T-05 | ✓ |
| AC-04 | T-06 | ✓ |
| AC-05 | T-07 | ✓ |
| AC-06 | T-08 | ✓ |
| AC-07 | T-09 | ✓ |
| AC-08 | T-10 | ✓ |
| AC-09 | T-11, T-17 | ✓ |
| AC-10 | T-12 | ✓ |
| AC-11 | T-13 | ✓ |
| AC-12 | T-14 | ✓ |
| AC-13 | T-15 | ✓ |
| AC-14 | T-16, T-18, T-19 | ✓ |

**Coverage: 14/14 = 100% ✓**

---

## TDD discipline gate

Per Article II HARD (C-2 enforced via `SOMA_RED_PHASE_STRICT=1`):
- T-02 (contract test stub) → RED commit (impl doesn't exist yet)
- T-03..T-16 (per-AC tasks) → each task's test file MUST be committed in RED phase before its impl. Sonnet commits separately: 1 RED commit per test file → 1 GREEN commit per impl.
- Acceptable batched RED commits if tests are independent; impl commits MUST be separate from test commits.
- Phase 4c precedent: 2 RED batches + 4 GREEN OK (some batching). Aim for tighter discipline if possible.

---

## Test count target

- T-02 contract: ~20 contract assertions
- T-03..T-16: 14 integration test files × ~3 tests each = ~42 tests
- T-17 E2E smoke: ~5 tests
- T-18 regression bridge: 48+ hooks aggregate + 579 SOMA cumulative

**Total new tests target: ≥40 (Phase 4 size precedent)**
