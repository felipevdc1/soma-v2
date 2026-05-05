# Tasks: Phase 5 Codex+Claude Bootloader Operational Install

**Feature ID:** 011-phase5-codex-claude-install
**Spec:** `specs/011-phase5-codex-claude-install/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

**TDD enforcement (Article II + C-2):** All Wave 2 implementation tasks MUST commit RED tests separately from GREEN impl. Dispatch sets `SOMA_RED_PHASE_STRICT=1` env. C-2 validator (`~/.claude/hooks/spec-test-traceability.cjs`) blocks commit if RED phase missing.

**Sandbox enforcement (Q10):** All test runs MUST set `SOMA_SAFE_PATHS_ONLY=1` env. Real `~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/CLAUDE.md` NEVER touched in test runs.

---

## ⚠️ Re-scoped 2026-05-02 (Phase 4b discovery)

Phase 4b sync.cjs JÁ implementa `--apply` write-mode (663L). Re-scoped per spec.md "Phase 4b Empirical State" + "Bug Fix Requirements" sections.

**BF-XX → Task mapping**:
| BF | Description (1-line) | Mapped to | Status |
|---|---|---|---|
| BF-01 | sync.cjs writeBlock positional logic (BEFORE marker X) | T-05 (was: full apply impl) | NEW SCOPE |
| BF-02 | section header wrapper "## SOMA Bootloader" | T-05 | NEW SCOPE |
| BF-03 | 3 install-targets entries → 2 blocks consolidation bug | T-05 (investigation + fix) | NEW SCOPE |
| BF-04 | manifest schema rich (relative_path, file_size_bytes, block_ids_modified) | T-06 (was: full snapshot impl) | NEW SCOPE |
| BF-05 | manifest dedup (1 entry per file) | T-06 | NEW SCOPE |
| BF-06 | conflict abort vs warn-and-overwrite | T-09 (was: full conflict impl) | NEW SCOPE |
| BF-07 | dry-run as default (sem flag) | T-05 | NEW SCOPE |

**Tasks unchanged scope (NEW features, no Phase 4b coverage)**:
- T-07 rollback.cjs (full new command) — AC-07/08/09
- T-08 migration logic (--check-migration + --migrate) — AC-10/11/12
- T-10 synthetic validation cycle — AC-15/16
- T-11 sandbox enforcement — AC-17

**Tasks REDUCED to verify-only (Phase 4b DONE)**:
- T-12 idempotency (AC-18) + content preservation (AC-19) — write tests confirming, no impl
- AC-02/AC-04/AC-06/AC-20 — verify-only embedded em T-15 E2E

**Effective work**: ~12 tasks (vs original 15), most Wave 2 tasks now bug-fix scope (smaller per-task) instead of full impl. Estimate 5-7 dias (vs original 8-10).

---

## Foundation (Wave 0)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| **T-01** | [FOUNDATION] Setup `/tmp/phase5-validation/` test fixture infrastructure (mkdir, copy real CLAUDE.md as fixture, copy real AGENTS.md as fixture) + populate `~/.soma-v2/adapters/claude/install-targets.json` with 3 entries (`block.claude.CLAUDE_md.{cbm,hyd-v2,soma-stsd}` per D-C11 Cláusula E + Q2 source_doc mapping). Bootstrap baseline shasum capture: `shasum -a 256 ~/.soma-v2/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs > /tmp/phase5-baseline-shasum.txt`. **DONE 2026-05-02**: Sonnet dispatch DONE 6/6 success criteria. setup.sh + install-targets.json shipped. Stale test fix: `sync.dry-run-edits.test.cjs` lines 122-137 (`total_entries=5→8`, `by_action.insert=2→5`) — semantic correction reflecting Claude entries[] → 3 entries population. Baseline preserved 671 pass + 0 fail + 2 skip. Frozen lib shasum diff empty. | [SPEC:AC-20] | `tests/phase5/fixtures/setup.sh`, `~/.soma-v2/adapters/claude/install-targets.json`, `~/.soma-v2/scripts/__tests__/sync.dry-run-edits.test.cjs` (semantic update) | DONE |

---

## Wave 1 — Contract Tests (depends on T-01, all [P])

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| **T-02** | [P] Write contract test for `contracts/sync-apply.md`: dry-run vs apply gating, 5/3 entries write per tool, sandbox enforcement, BLOCK_CONFLICT error, idempotency. RED commit first. | [CONTRACT:sync-apply.md] | `~/.soma-v2/scripts/__tests__/sync-apply.contract.test.cjs` | T-01 | TODO |
| **T-03** | [P] Write contract test for `contracts/rollback.md`: restore round-trip, sha256 verification, SNAPSHOT_NOT_FOUND, ROLLBACK_VERIFICATION_FAILED, idempotency. RED commit first. | [CONTRACT:rollback.md] | `~/.soma-v2/scripts/__tests__/rollback.contract.test.cjs` | T-01 | TODO |
| **T-04** | [P] Write contract test for `contracts/doctor-migration-check.md`: migration_needed false/true cases, OLD marker regex positive+negative, install_targets_count=8, exit_code 0 on WARNING. RED commit first. | [CONTRACT:doctor-migration-check.md] | `~/.soma-v2/scripts/__tests__/doctor-migration.contract.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (depends on Wave 1, [P] within thermal-guard ≤3)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| **T-05** | [P] **RE-SCOPED** Bug fix BF-01 + BF-02 + BF-03 + BF-07 em sync.cjs: (a) BF-07 dry-run as default (remover error em line 67-69), (b) BF-01 positional logic em writeBlock (suportar "insert BEFORE marker X" via optional install-targets entry field `position_before: "## Failure Log"`), (c) BF-02 section header wrapper (optional `wrapper_section: "## SOMA Bootloader (managed by soma sync)"` em entry), (d) BF-03 investigate consolidation bug 3 entries → 2 blocks: read sync.cjs computeEntryAction + extractBlock + writeBlock paths, hypothesize root cause (extractBlock matching OLD sub-marker?), write reproducer test em /tmp fixture, fix. Integration tests `// @spec AC-01,AC-03 + BF-01,BF-02,BF-03,BF-07`. | [SPEC:AC-01] [SPEC:AC-03] | `~/.soma-v2/scripts/sync.cjs` (extend), `~/.soma-v2/tests/phase5/sync-apply.test.cjs` | T-02 | TODO |
| **T-06** | [P] **RE-SCOPED** Bug fix BF-04 + BF-05 em snapshot helper: (a) BF-04 schema bump `soma-snapshot/v1` → `soma-snapshot-manifest/v1` com richer fields (`relative_path`, `file_size_bytes`, `block_ids_modified[]`), (b) BF-05 dedup em createSnapshot (1 entry per UNIQUE file path, agregando block_ids_modified). Backward compat: read both schema versions during rollback. NOTE: Phase 4b já tem `~/.soma-v2/scripts/lib/snapshot.cjs` shipped (não NEW como spec original previa) — extend, não criar from zero. Integration tests `// @spec AC-05`. | [SPEC:AC-05] | `~/.soma-v2/scripts/lib/snapshot.cjs` (extend existing), `~/.soma-v2/scripts/lib/__tests__/snapshot.test.cjs` | T-02 | TODO |
| **T-07** | [P] Implement `~/.soma-v2/scripts/rollback.cjs` (NEW CLI command): parse `--snapshot-id` arg, read manifest, restore each manifest entry from snapshot copy, sha256 verify post-restore, idempotent if no-op detected, error codes (SNAPSHOT_NOT_FOUND, ROLLBACK_VERIFICATION_FAILED, MANIFEST_MISSING). Integration tests `// @spec AC-07,AC-08,AC-09`. | [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09] | `~/.soma-v2/scripts/rollback.cjs` (NEW), `~/.soma-v2/scripts/__tests__/rollback.test.cjs`, `~/.soma-v2/tests/phase5/rollback.test.cjs` | T-03, T-06 | TODO |
| **T-08** | [P] Implement `~/.soma-v2/scripts/lib/migration.cjs` (NEW): OLD marker detection regex (`<!-- (?<name>[a-z0-9-]+):start -->...<!-- \1:end -->` excluding `soma-v2` prefix), in-place replace logic for `--migrate` flag (compute byte position, replace OLD content with soma-v2 v2 anchor preserving same ID derived from marker_name → `block.{tool}.{file}.{marker_name}`), source-doc content extraction. Extend `~/.soma-v2/scripts/doctor.cjs` with `--check-migration` flag using migration.cjs detection. Integration tests `// @spec AC-10,AC-11,AC-12`. | [SPEC:AC-10] [SPEC:AC-11] [SPEC:AC-12] | `~/.soma-v2/scripts/lib/migration.cjs` (NEW), `~/.soma-v2/scripts/lib/__tests__/migration.test.cjs`, `~/.soma-v2/scripts/doctor.cjs` (extend), `~/.soma-v2/tests/phase5/doctor-migration.test.cjs` | T-04 | TODO |
| **T-09** | [P] **RE-SCOPED** Bug fix BF-06: change conflict behavior em sync.cjs D4 path (line 482-489) from warn-and-overwrite to ABORT. Add `--allow-local-edits` opt-in flag (default OFF — abort behavior). With flag: preserve existing warn-and-write behavior. Compute sha256 of CURRENT block content vs latest manifest entry, if mismatch + no opt-in flag → emit BLOCK_CONFLICT error with file+block_id+expected/actual sha256 + resolution_guidance, exit 1, ZERO writes. Integration tests `// @spec AC-13,AC-14 + BF-06`. | [SPEC:AC-13] [SPEC:AC-14] | `~/.soma-v2/scripts/sync.cjs` (extend), `~/.soma-v2/tests/phase5/conflict-detection.test.cjs` | T-05, T-06 | TODO |
| **T-10** | [P] Implement synthetic validation cycle test in `~/.soma-v2/tests/phase5/synthetic-validation.test.cjs`: setup fixture cópia of CLAUDE.md em `/tmp/phase5-validation/CLAUDE.md.fixture`, run `sync --apply` against fixture, simulate SIGKILL mid-write (mock partial state), invoke `rollback --snapshot-id`, assert sha256 of restored fixture equals pre-sync sha256 (round-trip identity). PR test output MUST include sha256 round-trip log entry per Article IV. **DONE 2026-05-03**: 2 sub-tests (round-trip + partial-state). synthetic_validation_evidence JSON logged. Frozen libs untouched. **Discovery: BF-08 latent bug — `soma-snapshot-manifest/v1` schema lacks `absolute_path` per entry → rollback silently skips entries; T-10 worked around via manual synthetic snapshot construction. T-15 E2E will likely surface this in real-world flow.** | [SPEC:AC-15] [SPEC:AC-16] | `~/.soma-v2/tests/phase5/synthetic-validation.test.cjs` | T-05, T-07 | DONE |
| **T-11** | [P] Implement sandbox enforcement inline em `~/.soma-v2/scripts/lib/snapshot.cjs` (extend T-06 work): check `process.env.SOMA_SAFE_PATHS_ONLY === "1"` em snapshot path derivation, if true AND target_path NOT prefixed with `/tmp/soma-v2-test/` → throw `{ error: "SANDBOX_VIOLATION", message: ... }`. Apply same check em `rollback.cjs` (T-07) restore path validation. Integration tests `// @spec AC-17`. **DONE 2026-05-03**: `assertSandboxPath` helper exported from snapshot.cjs (+48 LOC), rollback.cjs refactored to use shared helper (single source of truth). 6 sub-tests (snapshot safe/unsafe/env-unset + rollback safe/unsafe/env-unset). Backward compat preserved. | [SPEC:AC-17] | `~/.soma-v2/scripts/lib/snapshot.cjs` (extend), `~/.soma-v2/scripts/rollback.cjs` (refactor), `~/.soma-v2/tests/phase5/sandbox-enforcement.test.cjs` | T-06, T-07 | DONE |
| **T-12** | [P] Implement idempotency + content-preservation tests em `~/.soma-v2/tests/phase5/idempotency.test.cjs` + `~/.soma-v2/tests/phase5/content-preservation.test.cjs`: AC-18 idempotent re-apply (run sync apply twice, assert no diff/no-op), AC-19 sha256 of NON-anchored regions byte-identical pre/post apply (extract regions OUTSIDE soma-v2 anchor ranges, sha256, compare). **DONE 2026-05-03**: 13 tests added (5 idempotency + 8 content-preservation), all GREEN. Real regex matches sync.cjs anchor format `<!-- soma-v2:start id=... -->`. AC-19 fixture pre-includes `## SOMA Bootloader` header so first apply doesn't add new non-anchored text. Stability validated 3x runs. | [SPEC:AC-18] [SPEC:AC-19] | `~/.soma-v2/tests/phase5/idempotency.test.cjs`, `~/.soma-v2/tests/phase5/content-preservation.test.cjs` | T-05, T-06 | DONE |
| **T-13** | [P] Implement Article IV evidence logging + Article V thermal-guard integration: extend test runner em sync.cjs/rollback.cjs to log `{snapshot_path, manifest_sha256, post_write_sha256_per_file}` to test stdout (Article IV). Verify `thermal-guard.cjs` keyword detection counts `apply` invocations (Article V) — add test that 4th concurrent apply blocked. **DONE 2026-05-03 (PARTIAL)**: AC-21 SUCCESS — sync.cjs (+42 LOC) + rollback.cjs (+39 LOC) emit `soma_apply_evidence`/`soma_rollback_evidence` JSON line under `SOMA_EMIT_EVIDENCE=1` env (additive only, existing 834 pass preserved). 3 tests GREEN. **AC-22 GAP CAPTURED**: thermal-guard.cjs `COMPILE_KEYWORDS` does NOT include `apply` — 1 test stays expected-RED with descriptive failure message; 1-line fix (`add 'apply' to COMPILE_KEYWORDS`) deferred as separate gap fix (thermal-guard.cjs was on T-13 HARD denylist). See handoff Bucket E §"AC-22 Gap" for capture. | [SPEC:AC-21] [SPEC:AC-22] | `~/.soma-v2/scripts/sync.cjs` (extend), `~/.soma-v2/scripts/rollback.cjs` (extend), `~/.soma-v2/tests/phase5/article-compliance.test.cjs` | T-05, T-07 | DONE (AC-22 gap deferred → handoff) |

---

## Wave 3 — Integration + Wiring

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| **T-14** | Wire `soma rollback` command into main soma CLI dispatcher (extend existing CLI entrypoint to route `rollback` subcommand to `~/.soma-v2/scripts/rollback.cjs` via spawnSync or require). Wire `--check-migration` flag through doctor command. Update CLI usage message + `soma --help` output. | [SPEC:AC-07] [SPEC:AC-10] [SPEC:AC-20] | `~/.soma-v2/scripts/cli.cjs` (or main entry), `~/.soma-v2/docs/cli-reference.md` (extend) | T-07, T-08 | TODO |
| **T-15** | E2E integration smoke test em `~/.soma-v2/tests/integration/phase5-e2e.test.cjs`: full lifecycle on /tmp fixture — (1) initial dry-run preview, (2) apply with snapshot creation, (3) verify anchored blocks injected correctly, (4) simulate user manual edit inside block, (5) re-apply detects BLOCK_CONFLICT + aborts, (6) rollback restores pre-edit state with sha256 round-trip, (7) re-apply succeeds (no conflict). Cumulative SOMA test count target: 671→≥710 (+40 Phase 5 tests). | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-13] | `~/.soma-v2/tests/integration/phase5-e2e.test.cjs` | T-05..T-13 (all Wave 2) | TODO |

---

## Coverage Verification

| AC | Covered by | Status |
|---|---|---|
| AC-01 (dry-run default) | T-05 + T-15 | ✓ |
| AC-02 (Codex 5 entries) | T-05 + T-15 | ✓ |
| AC-03 (Claude 3 entries) | T-05 + T-15 | ✓ |
| AC-04 (auto-snapshot pré-write) | T-06 | ✓ |
| AC-05 (per-snapshot manifest) | T-06 | ✓ |
| AC-06 (0600 perms) | T-06 | ✓ |
| AC-07 (rollback restore) | T-07 + T-14 | ✓ |
| AC-08 (sha256 round-trip identity) | T-07 + T-10 | ✓ |
| AC-09 (rollback errors) | T-07 | ✓ |
| AC-10 (doctor migration_needed) | T-08 | ✓ |
| AC-11 (coexist mode default) | T-08 | ✓ |
| AC-12 (--migrate replace) | T-08 | ✓ |
| AC-13 (conflict detection) | T-09 + T-15 | ✓ |
| AC-14 (conflict error msg) | T-09 | ✓ |
| AC-15 (synthetic validation) | T-10 | ✓ |
| AC-16 (validation evidence in PR) | T-10 + T-13 | ✓ |
| AC-17 (sandbox enforcement) | T-11 | ✓ |
| AC-18 (idempotency) | T-12 | ✓ |
| AC-19 (content preservation) | T-12 | ✓ |
| AC-20 (install_targets_count=8) | T-01 + T-08 | ✓ |
| AC-21 (Article IV evidence) | T-13 | ✓ |
| AC-22 (Article V thermal-guard) | T-13 | ✓ |

**Coverage: 22/22 ACs = 100% ✓**

---

## Total task count

- Foundation: **1** (T-01)
- Wave 1 contract tests: **3** (T-02..T-04)
- Wave 2 implementation: **9** (T-05..T-13)
- Wave 3 integration: **2** (T-14..T-15)

**Total: 15 tasks**

---

## Execution Order Notes

- **DAG awareness**: T-05/T-06 podem rodar em paralelo (different files: sync.cjs extend vs new snapshot.cjs). T-07 depends on T-06 (uses snapshot infrastructure). T-08 independent (migration.cjs + doctor.cjs extend).
- **Thermal-guard limit ≤3**: Wave 2 has 9 tasks; max 3 concurrent compile/test. Suggested batching: Wave 2a (T-05+T-06+T-08 parallel) → Wave 2b (T-07+T-09+T-11 parallel) → Wave 2c (T-10+T-12+T-13 parallel).
- **Critical path**: T-01 → T-02 → T-05 → T-09 → T-15 (full e2e gate). ~6-8 days estimated end-to-end.
- **Real-write canary AFTER all tests green**: NEVER apply against real `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md` until ALL tests pass + the user explicitly ACKs synthetic validation evidence.

---

## Constitutional checklist (per dispatch)

Each Sonnet dispatch prompt MUST include:

- [ ] Article II HARD: `SOMA_RED_PHASE_STRICT=1` env set + RED tests committed BEFORE GREEN impl + verified via git log
- [ ] Article III HARD: real fs em `/tmp/phase5-validation/` fixtures + zero mocks for fs/sha256/child_process
- [ ] Article IV HARD: Test output logs snapshot_path + manifest_sha256 + post_write_sha256
- [ ] Article V HARD: `apply` keyword in prompt counted by thermal-guard; max 3 concurrent
- [ ] Article VI HARD: zero deletion (apply is additive; --migrate destructive but reversible via snapshot)
- [ ] Article VII SOFT: ≤3 NEW components (verified: rollback + snapshot + migration; sandbox inline)
- [ ] Sandbox: `SOMA_SAFE_PATHS_ONLY=1` env set in all test runs
- [ ] Preamble: `cd ~/.soma-v2 && shasum -a 256 scripts/lib/{anchored-blocks,manifest,template-engine}.cjs` matches /tmp/phase5-baseline-shasum.txt (BEFORE work starts AND AFTER work completes — frozen libs not mutated)
