# Tasks: Article XI Capture-or-Defer Gate Hook

**Feature ID:** 010-capture-defer-gate
**Spec:** `specs/010-capture-defer-gate/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: every test file committed in RED phase BEFORE impl. RED commit verified via `validateRedPhase` against `/tmp/spec010-work/` scratch git repo.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/spec010-work/` scratch git repo (copy of `~/.claude/hooks/`) + capture shasum baseline of 6 canonical+lib files; confirm 48/48 hooks aggregate pre-work. | [CONTRACT:capture-defer-gate] | `/tmp/spec010-work/{git-init,hooks/}`, `/tmp/spec010-shasum-before.txt` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:capture-defer-gate] Write contract test stub (RED commit) covering all 15 ACs per CONTRACT-CAPTURE-DEFER-GATE-01. Tests fail intentionally. Includes stdin JSON parse + decision logic + telemetry assertions + override paths. | [CONTRACT:capture-defer-gate] [SPEC:AC-01..AC-15] | `~/.claude/hooks/capture-defer-gate.test.cjs` (NEW) | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 — en defer-phrase detection: regex array for en + scan logic + emit finding. RED test asserts each phrase pattern matches on synthetic turn output. | [SPEC:AC-01] | `hooks/capture-defer-gate.cjs` (NEW) + test additions | T-02 | TODO |
| T-04 | [P] AC-02 — pt-br defer-phrase detection: regex array pra pt-br + integration with same scan logic. Test asserts pt-br patterns match. | [SPEC:AC-02] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-05 | [P] AC-03 — no defer → exit 0 + zero stderr + zero telemetry: passthrough test on clean turn output. | [SPEC:AC-03] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-06 | [P] AC-04 — capture target regex match in same turn → status:captured: implementation of capture-target regex array + match logic. | [SPEC:AC-04] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-07 | [P] AC-05 — uncaptured + soft-warn → stderr warn + exit 0: default mode logic. Test asserts stderr contains warning + exit 0. | [SPEC:AC-05] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-08 | [P] AC-06 — uncaptured + hard-block (`ARTICLE_XI_HARD=1`) → stdout decision JSON + exit 1: hard-block mode logic. | [SPEC:AC-06] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-09 | [P] AC-07 — marker file bypass `/tmp/article-xi-bypass-{sessionId}`: early-exit logic before any scanning. | [SPEC:AC-07] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-10 | [P] AC-08 — env `ARTICLE_XI_DISABLED=1` bypass: early-exit logic. | [SPEC:AC-08] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-11 | [P] AC-09 — telemetry JSONL append per detection: write logic to `~/.claude/logs/article-xi-{date}.jsonl` with schema `article-xi-telemetry/v1`. Test reads back log entry + asserts schema. | [SPEC:AC-09] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-12 | [P] AC-10 — telemetry JSONL parseable per-line: test reads N entries from synthetic log, asserts each line is valid JSON + matches schema. | [SPEC:AC-10] | test additions | T-02 | TODO |
| T-13 | [P] AC-11 — multi-turn search (current + last 1 turn): read `transcript_path` JSONL, parse last 2 assistant turns, search capture target across both. Mirror auto-load-modules pattern. | [SPEC:AC-11] | `hooks/capture-defer-gate.cjs` + test | T-02 | TODO |
| T-14 | [P] AC-12 — soft-warn default mode: assert default behavior when env unset = soft-warn = exit 0 + stderr. | [SPEC:AC-12] | test additions | T-02 | TODO |
| T-15 | [P] AC-13 — hard-block via `ARTICLE_XI_HARD=1` env: assert behavior when env=1 = block. | [SPEC:AC-13] | test additions | T-02 | TODO |
| T-16 | [P] AC-14 — ≥30 hook-specific tests pass: ensure test file has ≥30 named tests covering combinations of (phrase langs × capture target × mode × override). | [SPEC:AC-14] | `hooks/capture-defer-gate.test.cjs` | T-02 | TODO |
| T-17 | AC-15 — hooks/*.test.cjs aggregate 49/49 (was 48 + 1 new): regression check via existing hooks aggregate runner pattern. | [SPEC:AC-15] | regression check | T-03..T-16 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-18 | Smoke E2E: synthetic Stop event JSON inputs (5 scenarios — captured/uncaptured/no-defer/marker-bypass/env-disable) end-to-end + assert decision matrix. Validates real-world hook lifecycle. | [SPEC:AC-01..AC-13] | `hooks/__tests__/capture-defer-gate-e2e.test.cjs` (NEW dir; OR inline in hook test if path conventions allow) | T-17 | TODO |
| T-19 | Hook registration step (POST-DISPATCH, NOT BY SONNET — the user runs manually): add entry to `~/.claude/settings.json` `hooks.Stop[]`. Document procedure in spec.md "Wave 3" note. | [SPEC:AC-01..AC-15] | `~/.claude/settings.json` (user edits, NOT Sonnet) | T-18 | TODO |
| T-20 | Final shasum verification: 6 canonical+lib files unchanged. Plus shasum check `~/.claude/CLAUDE.md` (read-only by hook design). Plus shasum check existing 48 hook test files (zero regression). | [SPEC:AC-15] | `/tmp/spec010-shasum-after.txt` | T-19 | TODO |

---

## Coverage check

| AC | Tasks | Coverage |
|---|---|---|
| AC-01 | T-03 | ✓ |
| AC-02 | T-04 | ✓ |
| AC-03 | T-05 | ✓ |
| AC-04 | T-06 | ✓ |
| AC-05 | T-07 | ✓ |
| AC-06 | T-08 | ✓ |
| AC-07 | T-09 | ✓ |
| AC-08 | T-10 | ✓ |
| AC-09 | T-11 | ✓ |
| AC-10 | T-12 | ✓ |
| AC-11 | T-13 | ✓ |
| AC-12 | T-14 | ✓ |
| AC-13 | T-15 | ✓ |
| AC-14 | T-16 | ✓ |
| AC-15 | T-17, T-20 | ✓ |
| AC-01..AC-13 (E2E) | T-18 | ✓ |

**Coverage: 15/15 = 100% ✓**

---

## TDD discipline gate

Per Article II HARD + C-2 enforcement:
- T-02 contract test → RED commit (impl doesn't exist)
- T-03..T-16 → each AC gets test added in RED phase, impl in GREEN phase
- Acceptable batched RED (1-2 RED batches + 1-2 GREEN OK per Phase 4 precedent)
- Sonnet commits separately: tests in RED commits, impl in GREEN commits, validateRedPhase passes

---

## Test count target

- T-02 contract: ~10-15 contract assertions
- T-03..T-16: 14 AC test groups × ~2-3 tests each = ~30-40 tests
- T-17 + T-18: ~5-10 integration tests

**Total target: ≥30 tests in `capture-defer-gate.test.cjs` per AC-14 explicit threshold**

---

## Notes for orchestrator

- T-19 hook registration is manual user step (touching `~/.claude/settings.json` is risky — outside Sonnet scope per CLAUDE.md "actions visible to others or that affect shared state"). Sonnet should leave registration TODO comment + report to orchestrator.
- Hook lives in `~/.claude/hooks/` NOT in `~/.soma-v2/scripts/` — different directory than other SOMA work. Sonnet must NOT touch `~/.soma-v2/` in this dispatch.
- Telemetry log file `~/.claude/logs/article-xi-{date}.jsonl` directory may not exist yet — hook should create on first write (or T-01 foundation step creates the dir).
