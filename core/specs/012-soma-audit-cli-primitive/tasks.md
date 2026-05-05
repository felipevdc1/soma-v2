# Tasks: Soma Audit CLI Primitive

**Feature ID:** 012-soma-audit-cli-primitive
**Spec:** `specs/012-soma-audit-cli-primitive/spec.md`
**Created:** 2026-05-03

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Scaffold `audit.cjs` skeleton (CLI arg parser + main entry stub returning empty schema-valid JSON) + `lib/audit-*.cjs` empty helper modules + create `templates/audit-prompt.md` template + create `scripts/tests/fixtures/audit/` dir + 3 module fixtures (cli, lib, empty) | [SPEC:AC-11] | `scripts/audit.cjs`, `scripts/lib/audit-{deterministic,sandbox,session,claude,telemetry,schema}.cjs`, `templates/audit-prompt.md`, `scripts/tests/fixtures/audit/{module-cli,module-lib,module-empty}.cjs` | TODO |

---

## Wave 1 — Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] Write contract test for `contracts/cli-soma-audit.md` (invocation + output schema + exit codes + side effects) | [CONTRACT:cli-soma-audit] | `scripts/__tests__/audit-contract-cli.test.cjs` | T-01 | TODO |
| T-03 | [P] Write contract test for `contracts/cli-claude-invocation.md` (spawn pattern + prompt construction + failure modes + DI injection) | [CONTRACT:cli-claude-invocation] | `scripts/__tests__/audit-contract-claude.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Decomposed by sub-module pra paralelização sem file overlap. Each task includes integration test `// @spec AC-XX` per Article II.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-04 | [P] Implement deterministic layer (path resolve, LOC count, exports parse, git log spawn, test count, --help capture, header comment + export signatures extraction per AC-15 redaction) + integration test | [SPEC:AC-01] [SPEC:AC-03] [SPEC:AC-04] | `scripts/lib/audit-deterministic.cjs`, `scripts/__tests__/audit-deterministic.test.cjs` | T-02, T-03 | TODO |
| T-05 | [P] Implement sandbox enforcement (resolve relative paths via `path.resolve(cwd, arg)` per Q4, validate against `~/.soma-v2/scripts/` allowlist when `SOMA_SAFE_PATHS_ONLY=1`) + integration test | [SPEC:AC-02] [SPEC:AC-14] | `scripts/lib/audit-sandbox.cjs`, `scripts/__tests__/audit-sandbox.test.cjs` | T-02 | TODO |
| T-06 | [P] Implement session ID resolver (6-deep fallback hierarchy per Q3 lock) + marker file creation `/tmp/soma-discovery-done-{sessionId}` on success + integration test | [SPEC:AC-09] [SPEC:AC-10] | `scripts/lib/audit-session.cjs`, `scripts/__tests__/audit-session.test.cjs` | T-02 | TODO |
| T-07 | [P] Implement claude CLI invoker (spawn pattern with DI, prompt template loading from `~/.soma-v2/templates/audit-prompt.md` + interpolation, output envelope parsing, 4 failure mode warnings, AC-15 redaction enforcement) + integration test with fixture-mocked spawn | [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-15] | `scripts/lib/audit-claude.cjs`, `scripts/tests/fixtures/audit/claude-cli-{success,timeout,failed,invalid-json,not-found}.fixture.js`, `scripts/__tests__/audit-claude.test.cjs` | T-03 | TODO |
| T-08 | [P] Implement telemetry JSONL appender (write to `~/.claude/logs/article-xii-{date}.jsonl` schema `article-xii-telemetry/v1`) + integration test | [SPEC:AC-13] | `scripts/lib/audit-telemetry.cjs`, `scripts/__tests__/audit-telemetry.test.cjs` | T-02 | TODO |
| T-09 | [P] Implement output schema validator (validate stdout JSON matches `soma-audit/v1` shape with required + optional fields) + structured error formatter (stderr `{code, message, hint}` line per AC-12) + integration test | [SPEC:AC-11] [SPEC:AC-12] | `scripts/lib/audit-schema.cjs`, `scripts/__tests__/audit-schema.test.cjs` | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-10 | Wire all sub-modules in `audit.cjs` main entry point (orchestrate: parse args → sandbox check → deterministic collect → claude invoke → schema validate → marker file → telemetry) + integration smoke test exercising 3 paths (success hybrid, claude absent fallback, sandbox violation) + verify shasum baseline preserved (6 canonical+lib files unchanged) + register em rollup test runner | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-05] [SPEC:AC-07] [SPEC:AC-09] [SPEC:AC-13] | `scripts/audit.cjs`, `scripts/__tests__/audit-integration-smoke.test.cjs` | T-04, T-05, T-06, T-07, T-08, T-09 | TODO |

---

## Coverage Verification

- **Total ACs in spec:** 15 (AC-01..AC-15)
- **ACs covered by tasks:**
  - AC-01 → T-04 ✓
  - AC-02 → T-05 ✓
  - AC-03 → T-04 ✓
  - AC-04 → T-04 ✓
  - AC-05 → T-07 ✓
  - AC-06 → T-07 ✓
  - AC-07 → T-07 ✓
  - AC-08 → T-07 ✓
  - AC-09 → T-06 ✓
  - AC-10 → T-06 ✓
  - AC-11 → T-01, T-09 ✓
  - AC-12 → T-09 ✓
  - AC-13 → T-08 ✓
  - AC-14 → T-05 ✓
  - AC-15 → T-07 ✓
- **Coverage:** 15/15 = **100%** ✓

---

## Execution notes

- **TDD strict** — all Wave 1 contract tests written + RED commit BEFORE any Wave 2 task starts. `SOMA_RED_PHASE_STRICT=1` env enforced em dispatch prompt.
- **Parallelization** — Wave 2 has 6 [P] tasks (T-04..T-09), all touch separate `lib/audit-*.cjs` files. Safe paralelo. Thermal Guard limits 3 concurrent compile/test agents.
- **Sandbox** — `~/.soma-v2/` not git-tracked. Sonnet works in scratch repo (`/tmp/c-12-work` ou similar pattern matching C-2 SOMA precedent), copy back após validation.
- **Forbidden files** — `~/.soma-v2/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs` (D-C lock + AC-08 shasum invariant from spec 011). Verify shasum baseline pre/post.
- **Wave 1 depende de T-01** — T-01 creates fixture modules + skeleton; without it, contract tests have nothing to test against.
- **Wave 2 T-04..T-09 dependem de Wave 1** — RED contract tests written first; Wave 2 makes them GREEN.
- **Wave 3 T-10 depende de toda Wave 2** — wiring requires all sub-modules implemented.

---

## Dispatch hints (Sonnet executor)

- **Single Sonnet dispatch** — usage budget conservation per Bucket E pre-flight notes; no paralelo.
- **Required env in dispatch:** `SOMA_RED_PHASE_STRICT=1`, `SOMA_SAFE_PATHS_ONLY=1`.
- **Preamble mandatory pós-merge** (failure mode #7) — `cd ~/.soma-v2 && shasum -a 256 ~/.codex/AGENTS.md ~/AGENTS.md ~/.claude/constitution.md ~/.soma-v2/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs > /tmp/c-12-shasum-before.txt && node --test scripts/__tests__/*.test.cjs 2>&1 | tail -5`.
- **Hard rule** — zero file restoration. If files appear missing, STOP + report. Never recreate from memory/spec (failure mode #7).
- **Estimated total LOC:** ~400 (audit.cjs ~80 + 6 lib files ~50 each + audit-prompt.md ~40 + tests ~600 cumulative).
- **Estimated tests added:** ~25 (10 contract + 15 integration).
- **Estimated Sonnet duration:** 60-90 min single-pass (smaller than Phase 5 T-01 Foundation which took ~80 min).
