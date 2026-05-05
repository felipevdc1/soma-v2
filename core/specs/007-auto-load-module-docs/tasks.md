# Tasks: Auto-Load Module Docs Primitive (C-1 Option A)

**Feature ID:** 007-auto-load-module-docs
**Spec:** `specs/007-auto-load-module-docs/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: every test file committed in RED phase BEFORE impl. RED commit verified via `validateRedPhase` against `/tmp/c-1-work/` scratch git repo (since `~/.claude/hooks/` is not git-tracked — same pattern as C-2 dispatch). Per-AC RED→GREEN preferred; batched OK if reasonable.
- **D8 research-first directive**: Sonnet reads existing `~/.claude/hooks/subagent-init.cjs` (465L Phase 2) BEFORE implementing extension. If PreSubagentSpawn lifecycle doesn't support auto-load injection — REPORT partial back to orchestrator (do NOT invent integration).

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/c-1-work/` scratch git repo + copy `~/.claude/hooks/subagent-init.cjs` baseline + `~/.soma-v2/scripts/doctor.cjs` baseline; capture shasum baseline of 6 canonical+lib files; capture original LOC (subagent-init.cjs ~465L; doctor.cjs ~522L post-4d); confirm 571/571 SOMA + 47/47 hooks (subset) + 48/48 hooks aggregate pass pre-work; **READ existing subagent-init.cjs** to identify injection point pattern (where Constitution/FAMILY_DOC/Spec AC inject — that's where auto-load injection plugs in). | [CONTRACT:auto-load-module] | `/tmp/c-1-work/{git-init,subagent-init.cjs,doctor.cjs}`, `/tmp/c-1-shasum-before.txt`, `/tmp/research-notes.md` (pattern findings) | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:auto-load-module] Write contract test stub (RED) covering all 18 ACs + D resolutions per CONTRACT-AUTO-LOAD-MODULE-01. Initial tests fail (auto-load functions undefined). | [CONTRACT:auto-load-module] [SPEC:AC-01..AC-18] | `~/.claude/hooks/__tests__/contract-auto-load-module.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Each task: write integration test `// @spec AC-XX` → RED commit → minimal impl → GREEN commit. Per-AC granularity.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 hook reads task description from spawn context. Test verifies hook can access task input via established subagent-init.cjs convention (env/stdin/argv per Phase 2 pattern, confirmed in T-01 research). | [SPEC:AC-01] | `~/.claude/hooks/__tests__/ac-01-hook-reads-task.test.cjs`, extend `~/.claude/hooks/subagent-init.cjs` | T-02 | TODO |
| T-04 | [P] AC-02 + AC-12 CONTEXT.md parser (front-matter soma-context/v1 + body table). Reuses Phase 4c `~/.soma-v2/scripts/lib/module-store.cjs::parseFrontMatter` via require. Body table parsed via simple regex per row. | [SPEC:AC-02 + AC-12] | `~/.claude/hooks/__tests__/ac-02-context-md-parser.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (NEW: parseContextMd fn) | T-02 | TODO |
| T-05 | [P] AC-03 keyword matching — case-insensitive substring (D1). Each match scored (count of occurrences). Returns ordered candidates. | [SPEC:AC-03 + D1] | `~/.claude/hooks/__tests__/ac-03-keyword-matching.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (matchKeywords fn) | T-02 | TODO |
| T-06 | [P] AC-04 max 2 modules cap (D2 hardcoded). | [SPEC:AC-04 + D2] | `~/.claude/hooks/__tests__/ac-04-max-2-cap.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (selectTopN fn) | T-02 | TODO |
| T-07 | [P] AC-05 + D3 token budget exceed → truncate to 1 highest score + WARN. Default cap 5KB UTF-8 bytes (AD-06). | [SPEC:AC-05 + D3] | `~/.claude/hooks/__tests__/ac-05-token-budget.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (enforceTokenBudget fn) | T-02 | TODO |
| T-08 | [P] AC-06 status filter — only `status: active` modules loaded. `hypothesis` + `deprecated` skipped silently. Reuses Phase 4c front-matter parser. | [SPEC:AC-06] | `~/.claude/hooks/__tests__/ac-06-status-filter.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (filterByStatus fn) | T-02 | TODO |
| T-09 | [P] AC-07 + D4 tie-break — layer priority `roots > trunk > leaves`; alphabetical slug within same layer. Reuses Phase 4d `~/.soma-v2/scripts/lib/foundation-check.cjs::resolveModuleLayer` via require. | [SPEC:AC-07 + D4] | `~/.claude/hooks/__tests__/ac-07-tie-break.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (sortByLayerThenAlpha fn) | T-02 | TODO |
| T-10 | [P] AC-08 + D5 injection format — markdown delimited block `--- soma-auto-loaded-module: {slug} (layer: {layer}) ---\n{body}\n--- end module ---`. Multiple modules separated by `\n\n`. | [SPEC:AC-08 + D5] | `~/.claude/hooks/__tests__/ac-08-injection-format.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (formatInjection fn) | T-02 | TODO |
| T-11 | [P] AC-09 fallback — no `.soma/CONTEXT.md` → silent skip. Single stderr INFO line ("no .soma/CONTEXT.md found; auto-load skipped"). | [SPEC:AC-09] | `~/.claude/hooks/__tests__/ac-09-no-context-md.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (graceful no-context path) | T-02 | TODO |
| T-12 | [P] AC-10 fallback — zero keyword matches → silent skip. | [SPEC:AC-10] | `~/.claude/hooks/__tests__/ac-10-zero-matches.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` | T-02 | TODO |
| T-13 | [P] AC-11 warning — keywords match but all candidates filtered by status → warning loud stderr. | [SPEC:AC-11] | `~/.claude/hooks/__tests__/ac-11-all-filtered.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` | T-02 | TODO |
| T-14 | [P] AC-13 + AC-14 + D7 `soma doctor --check-context-routing` flag — iterates each `keyword → slug` ref + verifies `.soma/modules/{slug}.md` exists + status active. Broken refs → `severity: warning` finding `code: BROKEN_CONTEXT_ROUTING` (D7 non-blocking). Doctor exits 0. | [SPEC:AC-13 + AC-14 + D7] | `~/.soma-v2/scripts/__tests__/ac-13-doctor-context-routing.test.cjs`, extend `~/.soma-v2/scripts/doctor.cjs` (--check-context-routing flag + scanContextRouting fn) | T-02 | TODO |
| T-15 | [P] AC-15 + D8 integration — modules content reaches child agent system prompt via existing subagent-init.cjs injection mechanism. **D8 research-first**: Sonnet validates injection point empirically (extends Constitution/FAMILY_DOC pattern; if PreSubagentSpawn lifecycle differs OR auto-load injection unsupported, REPORT partial). | [SPEC:AC-15 + D8] | `~/.claude/hooks/__tests__/ac-15-integration-injection.test.cjs`, extend `~/.claude/hooks/subagent-init.cjs` (auto-load + injection wiring) | T-02 | TODO |
| T-16 | [P] AC-16 backward compat regression — 571/571 SOMA + 47/47 hooks (subset) + 48/48 hooks aggregate + 6 canonical+lib shasums match `/tmp/c-1-shasum-before.txt`. | [SPEC:AC-16] | `~/.soma-v2/scripts/__tests__/c1-regression.test.cjs` (NEW, bridge wrapper pattern), OR `~/.claude/hooks/__tests__/c1-regression.test.cjs` if Sonnet picks that path | T-02 | TODO |
| T-17 | [P] AC-17 env var override — `SOMA_AUTO_LOAD_TOKEN_CAP=8192` → token cap = 8192 bytes (overrides default 5KB). | [SPEC:AC-17] | `~/.claude/hooks/__tests__/ac-17-token-cap-env.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (env var read in tokenCap default) | T-02 | TODO |
| T-18 | [P] AC-18 defensive failure mode — hook errors during auto-load → log stderr + return empty injection (dispatch proceeds). NEVER block agent spawn on auto-load failure. | [SPEC:AC-18 + D8] | `~/.claude/hooks/__tests__/ac-18-defensive-degrade.test.cjs`, `~/.claude/hooks/lib/auto-load-modules.cjs` (try/catch wrapper at hook boundary) | T-02 | TODO |
| T-19 | [P] D8 — Add `~/.soma-v2/templates/project/.soma/CONTEXT.md.tmpl` (NEW template) so `soma init` populates project's `.soma/CONTEXT.md` skeleton (front-matter soma-context/v1 + empty table + comment hint). | [SPEC:AC-12 + D6] | `~/.soma-v2/templates/project/.soma/CONTEXT.md.tmpl` | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-20 | E2E integration smoke: synthetic project `/tmp/c-1-e2e-{slug}/` with `.soma/CONTEXT.md` + 3 modules (auth-system trunk active, billing leaves active, legacy leaves deprecated). Synthesize Agent dispatch task w/ keyword "auth" → verify auth-system loaded, billing skipped (no keyword match), legacy skipped (status filter). | [CONTRACT:auto-load-module] | `~/.claude/hooks/__tests__/e2e-auto-load-module.test.cjs` | T-03..T-19 | TODO |
| T-21 | Phase C-1 regression test — cumulative 571/571 SOMA + 47/47 hooks (subset) + 48/48 hooks aggregate preserved + 6 canonical+lib shasums match `/tmp/c-1-shasum-before.txt`. Hook count check: subagent-init.cjs LOC delta + new auto-load-modules.cjs LOC reported. | [SPEC:AC-16] | `~/.claude/hooks/__tests__/c1-regression.test.cjs` | T-20 | TODO |
| T-22 | Copy-back from `/tmp/c-1-work/` scratch repo: `subagent-init.cjs` → `~/.claude/hooks/`, `lib/auto-load-modules.cjs` → `~/.claude/hooks/lib/`, `doctor.cjs` → `~/.soma-v2/scripts/`, `__tests__/*.test.cjs` → `~/.claude/hooks/__tests__/`, `~/.soma-v2/scripts/__tests__/ac-13-doctor-context-routing.test.cjs`, `~/.soma-v2/templates/project/.soma/CONTEXT.md.tmpl`. Re-verify all tests pass in destination. RED+GREEN commits in scratch git log; report SHAs. | [CONTRACT:auto-load-module] | (5 destinations as above) | T-21 | TODO |

---

## Coverage Verification

- AC-01 → T-03 ✓
- AC-02 → T-04 ✓
- AC-03 → T-05 ✓
- AC-04 → T-06 ✓
- AC-05 → T-07 ✓
- AC-06 → T-08 ✓
- AC-07 → T-09 ✓
- AC-08 → T-10 ✓
- AC-09 → T-11 ✓
- AC-10 → T-12 ✓
- AC-11 → T-13 ✓
- AC-12 → T-04 + T-19 ✓
- AC-13 → T-14 ✓
- AC-14 → T-14 ✓
- AC-15 → T-15 ✓
- AC-16 → T-16 + T-21 ✓
- AC-17 → T-17 ✓
- AC-18 → T-18 ✓

D resolutions: D1 (T-05), D2 (T-06), D3 (T-07), D4 (T-09), D5 (T-10), D6 (T-19), D7 (T-14), D8 (T-15 + research-first directive em T-01).

**Coverage: 18/18 ACs (100%) + 8/8 D resolutions traced. 22 tasks total: 1 foundation + 1 contract + 17 impl + 3 integration/regression/copy-back.**
