# Tasks: Soma Sync Apply Write-Mode

**Feature ID:** 004-soma-sync-apply
**Spec:** `specs/004-soma-sync-apply/spec.md`
**Created:** 2026-05-02

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`
- **TDD HARD per Article II + C-2**: every test file must be committed in a RED phase commit BEFORE its implementation file. RED commit verified via `validateRedPhase` against scratch git repo (since `~/.soma-v2/` is not git-tracked, dispatch uses `/tmp/phase4b-work/` scratch).

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | [FOUNDATION] Set up `/tmp/phase4b-work/` scratch git repo + copy `~/.soma-v2/scripts/sync.cjs` baseline; capture shasum baseline of 6 canonical+lib files; confirm 315/315 SOMA tests + 48/48 hooks regression pass pre-work. Output: scratch repo at expected SHA + baseline shasum file. | [CONTRACT:sync-apply] | `/tmp/phase4b-work/{git-init,sync.cjs}`, `/tmp/phase4b-shasum-before.txt` | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:sync-apply] Write contract test suite stub (RED commit) covering all 12 ACs from CONTRACT-SYNC-APPLY-01 — see contract test stub for template. Initial tests fail intentionally (validateRedPhase asserts RED). | [CONTRACT:sync-apply] [SPEC:AC-01..AC-12] | `~/.soma-v2/scripts/__tests__/contract-sync-apply.test.cjs` | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

Each task: write integration test `// @spec AC-XX` → RED commit → minimal impl → GREEN commit. Per-AC granularity preserves traceability.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | [P] AC-01 backward compat: sync without `--apply` preserves Phase 2 dry-run output (zero writes, zero snapshot dir). Integration test asserts `out.mode === 'dry-run'` + `.snapshots/` not created. | [SPEC:AC-01] | `~/.soma-v2/scripts/__tests__/ac-01-dry-run-preserved.test.cjs`, `scripts/sync.cjs` (parseArgs branch) | T-02 | TODO |
| T-04 | [P] AC-02 snapshot pre-write: when `--apply` + drift detected, snapshot dir `.snapshots/{ISO}/{adapter}/{path}` created BEFORE source modification. Test verifies copy on disk + source hash unchanged at snapshot moment. | [SPEC:AC-02] | `~/.soma-v2/scripts/__tests__/ac-02-snapshot-pre-write.test.cjs`, `scripts/lib/snapshot.cjs` (NEW), `scripts/sync.cjs` (apply branch) | T-02 | TODO |
| T-05 | [P] AC-03 manifest schema: `manifest.json` written with `{schema: "soma-snapshot/v1", timestamp, files: [{adapter, path, sha256}], total_bytes}` ordered alphabetically by `{adapter}/{path}`. | [SPEC:AC-03] | `~/.soma-v2/scripts/__tests__/ac-03-manifest-schema.test.cjs`, `scripts/lib/snapshot.cjs` | T-02 | TODO |
| T-06 | [P] AC-04 summary preview: stdout prints `## Sync preview\n- {adapter}/{path}: {action}\n...` BEFORE any write when `--apply` + drift detected. | [SPEC:AC-04] | `~/.soma-v2/scripts/__tests__/ac-04-summary-preview.test.cjs`, `scripts/sync.cjs` (preview emitter) | T-02 | TODO |
| T-07 | [P] AC-05 noop on already-synced: `--apply` in zero-drift state writes nothing, no snapshot dir created, exit 0, "already in sync" message. | [SPEC:AC-05] | `~/.soma-v2/scripts/__tests__/ac-05-noop-already-synced.test.cjs`, `scripts/sync.cjs` (drift gate) | T-02 | TODO |
| T-08 | [P] AC-06 SNAPSHOT_CREATE_FAILED: simulate unwritable `.snapshots/` (chmod 0000), assert exit 1 + error_code, source files SHA unchanged pre/post (D2 atomicity). | [SPEC:AC-06] | `~/.soma-v2/scripts/__tests__/ac-06-snapshot-create-failed.test.cjs`, `scripts/lib/snapshot.cjs` (error path) | T-02 | TODO |
| T-09 | [P] AC-07 SOURCE_STALE: simulate source mutation between dry-run preview and write phase (two-step shasum check), assert abort with SOURCE_STALE + zero snapshot + zero source mod. | [SPEC:AC-07] | `~/.soma-v2/scripts/__tests__/ac-07-source-stale.test.cjs`, `scripts/sync.cjs` (stale check) | T-02 | TODO |
| T-10 | [P] AC-08 ANCHOR_PARSE_ERROR: target file has malformed `<!-- soma-v2:start ... -->` block, assert abort + zero snapshot + zero source mod (D2 all-or-nothing). | [SPEC:AC-08] | `~/.soma-v2/scripts/__tests__/ac-08-anchor-parse-error.test.cjs`, `scripts/sync.cjs` (parse gate) | T-02 | TODO |
| T-11 | [P] AC-09 byte-stable manifest: compute `manifest.json` twice for identical input, byte-compare result. Sort + sha256 hex64 lowercase enforced. | [SPEC:AC-09] | `~/.soma-v2/scripts/__tests__/ac-09-manifest-byte-stable.test.cjs`, `scripts/lib/snapshot.cjs` (deterministic emit) | T-02 | TODO |
| T-12 | [P] AC-10 idempotência: run `--apply` twice in succession on drift state, assert second is noop (per AC-05) + only one snapshot dir created. | [SPEC:AC-10] | `~/.soma-v2/scripts/__tests__/ac-10-idempotencia.test.cjs`, `scripts/sync.cjs` (post-write state check) | T-02 | TODO |
| T-13 | [P] AC-11 trap scenarios in `/tmp/soma-sync-trap-*/` synthetic: 4 fixtures (accidental --apply with empty install-targets, missing snapshot dir, stale source, parse error in fake AGENTS.md). All exit 1 with no source corruption. | [SPEC:AC-11] | `~/.soma-v2/scripts/__tests__/ac-11-trap-scenarios.test.cjs`, `tests/fixtures/sync-traps/{accidental,missing-snapshot,stale-source,parse-error}/` | T-02 | TODO |
| T-14 | [P] AC-12 conflict `--apply` + `--dry-run`: exit 2 INVALID_ARGS with clear message, zero side effects. | [SPEC:AC-12] | `~/.soma-v2/scripts/__tests__/ac-12-conflict-apply-dry-run.test.cjs`, `scripts/sync.cjs` (parseArgs validation) | T-02 | TODO |
| T-15 | [P] D4 local edits: user-edited `~/.codex/AGENTS.md` (full-file shasum diff vs install-targets manifest), `--apply` writes anyway + emits LOCAL_EDITS_DETECTED warning + snapshot saves pre-state. Recovery validated. | [SPEC:AC-02 + D4] | `~/.soma-v2/scripts/__tests__/d4-local-edits-warn-loud.test.cjs`, `scripts/sync.cjs` (warning emitter) | T-02 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-16 | E2E integration smoke: write integration test that initializes a synthetic SOMA_HOME in `/tmp/soma-e2e-{slug}/`, induces drift, runs `--apply`, verifies snapshot+manifest created + source synced + idempotência on second run. Validates full pipeline. | [SPEC:AC-01..AC-12 + D4] | `~/.soma-v2/scripts/__tests__/e2e-sync-apply.test.cjs` | T-03..T-15 | TODO |
| T-17 | Phase 4b regression test: cumulative test count (Phase 2+3+4a 315 + Phase 4b N) all pass. Hooks regression 48/48 preserved. 6 canonical+lib shasums match `/tmp/phase4b-shasum-before.txt`. Update `phase4b-regression.test.cjs` (NEW) with bridge wrapper pattern (Node v22 NODE_TEST_CONTEXT workaround). | [CONTRACT:sync-apply] | `~/.soma-v2/scripts/__tests__/phase4b-regression.test.cjs` (NEW) | T-16 | TODO |
| T-18 | Copy-back from `/tmp/phase4b-work/` scratch repo to `~/.soma-v2/scripts/`. Re-verify all tests pass in destination. RED+GREEN commits visible in scratch repo via git log; report SHAs. | [CONTRACT:sync-apply] | `~/.soma-v2/scripts/sync.cjs`, `~/.soma-v2/scripts/lib/snapshot.cjs` | T-17 | TODO |

---

## Coverage Verification

- AC-01 → T-03 ✓
- AC-02 → T-04 ✓ (also T-15 for D4)
- AC-03 → T-05 ✓
- AC-04 → T-06 ✓
- AC-05 → T-07 ✓
- AC-06 → T-08 ✓
- AC-07 → T-09 ✓
- AC-08 → T-10 ✓
- AC-09 → T-11 ✓
- AC-10 → T-12 ✓
- AC-11 → T-13 ✓
- AC-12 → T-14 ✓
- D4 (local edits) → T-15 ✓
- T-01/T-17/T-18 reference [CONTRACT:sync-apply] (foundation/regression/copy-back are not AC-bound work)

**Coverage: 12/12 ACs (100%) + D4 explicit task + 3 contract-bound foundation/integration tasks. 18 tasks total: 1 foundation + 1 contract test + 13 impl + 3 integration/wiring/regression/copy-back.**
