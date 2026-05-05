# Tasks: Adapter Skeletons — Cursor / Aider / ChatGPT-desktop

**Feature ID:** 009-adapter-skeletons
**Spec:** `specs/009-adapter-skeletons/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: test file committed in RED phase BEFORE artifact creation. RED commit verified via `validateRedPhase` against `/tmp/spec009-work/` scratch git repo.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/spec009-work/` scratch git repo (copy of `~/.soma-v2/adapters/` + `~/.soma-v2/scripts/`) + capture shasum baseline 6 canonical+lib files; confirm 655/655 SOMA + 48/48 hooks aggregate pass pre-work. | [CONTRACT:adapter-skeleton] | `/tmp/spec009-work/`, `/tmp/spec009-shasum-before.txt` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:adapter-skeleton] Write contract test file (RED commit) parameterized over `NEW_ADAPTERS = ['cursor', 'aider', 'chatgpt-desktop']` covering all 13 ACs per CONTRACT-ADAPTER-SKELETON-01. ≥10 tests (5 per-adapter assertions × 3 = 15 + cross-cutting). Tests fail intentionally (adapter folders don't exist yet). | [CONTRACT:adapter-skeleton] [SPEC:AC-01..AC-13] | `~/.soma-v2/scripts/__tests__/adapter-skeletons.test.cjs` (NEW) | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Per-AC tasks (some grouped due to artifact-level scope):

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 + AC-06 — create 3 adapter folders with kebab-case names: `~/.soma-v2/adapters/cursor/`, `~/.soma-v2/adapters/aider/`, `~/.soma-v2/adapters/chatgpt-desktop/`. | [SPEC:AC-01] [SPEC:AC-06] | `adapters/cursor/`, `adapters/aider/`, `adapters/chatgpt-desktop/` (NEW dirs) | T-02 | TODO |
| T-04 | [P] AC-02 + AC-03 + AC-04 — create `install-targets.json` per adapter conforming `soma-install-targets/v1` schema com `entries: []` empty MVP (D1 lock). 3 files. | [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] | `adapters/{cursor,aider,chatgpt-desktop}/install-targets.json` (NEW × 3) | T-03 | TODO |
| T-05 | [P] AC-02 + AC-05 — create `bootloader.md` per adapter mirroring codex/bootloader.md structure (H1 + Responsibilities ≥3 + Non-responsibilities ≥2) com tool-specific wording per D2 (Cursor IDE / Aider CLI / ChatGPT chat phrasing). 3 files. | [SPEC:AC-02] [SPEC:AC-05] | `adapters/{cursor,aider,chatgpt-desktop}/bootloader.md` (NEW × 3) | T-03 | TODO |
| T-06 | [P] AC-13 — verify zero `integration.md` files created per D3 lock. Test asserts `!fs.existsSync(integration.md)` per adapter. (Verification only, no file write.) | [SPEC:AC-13] | (validation in test file) | T-05 | TODO |
| T-07 | [P] AC-07 — run `node ~/.soma-v2/scripts/doctor.cjs --check-context-routing` em SOMA-enabled fixture project; assert exit 0 + zero ERROR-level findings caused pelos new adapters. | [SPEC:AC-07] | (test in adapter-skeletons.test.cjs) | T-04, T-05 | TODO |
| T-08 | [P] AC-08 — run `node ~/.soma-v2/scripts/bootstrap.cjs --quiet`; parse JSON; assert `adapters[]` length ≥5 (claude + codex + cursor + aider + chatgpt-desktop). | [SPEC:AC-08] | (test in adapter-skeletons.test.cjs) | T-04, T-05 | TODO |
| T-09 | AC-09 — assert ≥10 tests pass em adapter-skeletons.test.cjs (already constructed via T-02 + parameterization, this task verifies count). | [SPEC:AC-09] | (count assertion via runner) | T-02 | TODO |
| T-10 | AC-10 — run full SOMA suite `node --test ~/.soma-v2/scripts/__tests__/*.test.cjs`; assert ≥665 cumulative (655 baseline + ≥10 new). | [SPEC:AC-10] | (regression check) | T-09 | TODO |
| T-11 | AC-11 — shasum 6 canonical+lib files post-Sprint-009; diff against `/tmp/spec009-shasum-before.txt`; assert empty diff. | [SPEC:AC-11] | `/tmp/spec009-shasum-after.txt` | T-09 | TODO |
| T-12 | AC-12 — `node --test ~/.claude/hooks/*.test.cjs` post-Sprint-009; assert 48+/48+ hooks aggregate (Sprint 010 may add 1; baseline preserved). | [SPEC:AC-12] | (hooks regression check) | T-09 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-13 | E2E smoke: synthetic project `/tmp/soma-spec009-e2e-{slug}/` → `init --existing` → `bootstrap --quiet` → assert adapters[] count = 5 + zero ERROR findings + warning count from doctor matches expectation. Validates real-world adapter ecosystem post-Sprint-009. | [SPEC:AC-07] [SPEC:AC-08] | `scripts/__tests__/adapter-skeletons-e2e.test.cjs` (NEW, OR inline em adapter-skeletons.test.cjs) | T-07, T-08 | TODO |
| T-14 | Final shasum verification + manifest check: confirm `~/.soma-v2/manifest.json` doesn't reference new adapter files (manifest is for canonical SOMA_HOME files like docs/templates, not adapters/). | [SPEC:AC-11] | manifest verification only | T-11 | TODO |

---

## Coverage check

| AC | Tasks | Coverage |
|---|---|---|
| AC-01 | T-03 | ✓ |
| AC-02 | T-04, T-05 | ✓ |
| AC-03 | T-04 | ✓ |
| AC-04 | T-04 | ✓ |
| AC-05 | T-05 | ✓ |
| AC-06 | T-03 | ✓ |
| AC-07 | T-07, T-13 | ✓ |
| AC-08 | T-08, T-13 | ✓ |
| AC-09 | T-09 | ✓ |
| AC-10 | T-10 | ✓ |
| AC-11 | T-11, T-14 | ✓ |
| AC-12 | T-12 | ✓ |
| AC-13 | T-06 | ✓ |

**Coverage: 13/13 = 100% ✓**

---

## TDD discipline gate

Per Article II HARD + C-2:
- T-02 contract test → RED commit (adapter folders don't exist yet, tests fail)
- T-03..T-08 → GREEN commits create artifacts that make tests pass
- Acceptable batched RED + 1-3 GREEN OK

---

## Test count target

- T-02 contract test (parameterized): 5 assertions × 3 adapters + cross-cutting = ~15-18 tests
- T-13 E2E: ~3-5 additional tests

**Total target: ≥10 (per AC-09 explicit threshold)**

---

## Notes for orchestrator

- Smallest sprint scope to date — pure artifact-level. Sonnet dispatch should be ~10-15min vs 20-30min Sprint 008.
- Zero code changes em `scripts/`, `lib/`, hooks. Sonnet should NOT touch any `.cjs` outside the new test file.
- Bootloader.md wording per tool requires Sonnet judgment — D2 lock says "adapt to tool nature". Provide concrete examples in dispatch prompt.
