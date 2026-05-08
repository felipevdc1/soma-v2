# Tasks: v2.1.4 — `soma manifest baseline` Subcommand

**Feature ID:** 014-manifest-baseline
**Spec:** `core/specs/014-manifest-baseline/spec.md`
**Created:** 2026-05-08

---

## Conventions

- `[P]` — task is parallel-safe (no file overlap with other [P] tasks in same wave)
- `[SPEC:AC-XX]` — traceability link to acceptance criterion
- `[CONTRACT:filename]` — traceability link to contract file
- `[FOUNDATION]` — blocks all waves; must complete before Wave 1 starts
- `[WIRING]` — integration / dispatcher modification, runs after impl waves
- `[SMOKE]` — end-to-end real-environment validation
- **Status:** `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

---

## Coverage Summary

17/17 ACs covered (100%). Mapping in last column. All Wave 2 impl tasks operate sequentially on `core/scripts/manifest.cjs` (single file → no `[P]` allowed); test-only tasks (T-10, T-11, T-12) are `[P]`-parallel since each writes a distinct test file.

---

## Foundation (Step 3)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-01 | [FOUNDATION] Create stub `core/scripts/manifest.cjs` with shebang + arg-parsing skeleton (positional `baseline`, flags `--dry-run`/`--apply`/`--filter`/`--json`/`--help`) returning `INVALID_ARGS` for unknown flag. Register `manifest` entry in `core/scripts/soma.cjs` SUBCOMMANDS. Run `node:test` suite to confirm scaffold compiles. | [SPEC:AC-10] [SPEC:AC-15] | `core/scripts/manifest.cjs` (new), `core/scripts/soma.cjs` (extend SUBCOMMANDS only) | — | TODO |

---

## Wave 1 — Contracts + Contract Tests (Step 4, Wave 1)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-02 | [P] [CONTRACT:cli-baseline] Write RED-phase contract tests covering arguments, output schema, exit codes, side effects, idempotency, and error paths. Tests MUST fail at this point (impl is stub). Use `node:test`, real fixture manifest under `/tmp/soma-baseline-test-{run}/`. | [CONTRACT:cli-baseline] | `core/scripts/__tests__/manifest.test.cjs` (new) | T-01 | TODO |

---

## Wave 2 — Implementation (Step 4, Wave 2)

<!-- All Wave 2 tasks extend core/scripts/manifest.cjs sequentially — no [P] flag. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-03 | Core baseline impl: dry-run mode (compute & report stale entries), `--apply` mode (atomic write tmp→rename), idempotency (2nd run = no-op + byte-identical manifest), empty stale state ("0 stale entries" output), default-mode-is-dry-run + hint emission. Add tests for each path. | [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-13] [SPEC:AC-14] [SPEC:AC-15] | `core/scripts/manifest.cjs`, `core/scripts/__tests__/manifest.test.cjs` | T-02 | TODO |
| T-04 | Filter logic: `--filter <value>` exact-match against `entry.id` OR `entry.path`; literal-string semantics (no glob expansion per D-014-2). Tests for id-match, path-match, and `--filter 'adapters/*'` literal-match (returns 0 entries since no entry's id/path equals the literal `adapters/*`). | [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-17] | `core/scripts/manifest.cjs`, `core/scripts/__tests__/manifest.test.cjs` | T-03 | TODO |
| T-05 | JSON output mode: `--json` flag emits structured output with `schema: "soma-manifest-baseline/v1"`, fields per `contracts/cli-baseline.md` (mode, manifest_path, snapshot_path, entries_considered, entries_rebaseled[], entries_skipped[], entries_clean, filter_applied). Compatible with both dry-run + apply modes. | [SPEC:AC-06] | `core/scripts/manifest.cjs`, `core/scripts/__tests__/manifest.test.cjs` | T-03 | TODO |
| T-06 | Snapshot integration: apply mode invokes `sync.cjs::createSnapshot()` (D-013-8 reuse) BEFORE writing manifest. Snapshot path is reported in human + JSON output. Test: rollback via existing `soma rollback {snapshot-id}` restores pre-write manifest content. | [SPEC:AC-09] | `core/scripts/manifest.cjs`, `core/scripts/__tests__/manifest.test.cjs` | T-03 | TODO |
| T-07 | Error paths: `MANIFEST_MISSING` (passthrough from `lib/manifest.cjs::loadManifest` ENOENT) → exit 2; `MANIFEST_INVALID` (schema validation failure) → exit 2; lab file ENOENT for entry (D-014-1) → emit warning, skip entry, continue, exit 0 if other entries clean. Tests for each error path. | [SPEC:AC-11] [SPEC:AC-12] [SPEC:AC-16] | `core/scripts/manifest.cjs`, `core/scripts/__tests__/manifest.test.cjs` | T-03 | TODO |
| T-08 | Full `--help` flag implementation: usage text documents all flags (`--dry-run`, `--apply`, `--filter`, `--json`, `--help`), exit 0. Replace stub help from T-01 with comprehensive usage. | [SPEC:AC-10] | `core/scripts/manifest.cjs`, `core/scripts/__tests__/manifest.test.cjs` | T-03 | TODO |

---

## Wave 3 — Integration + Wiring (Step 7)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-09 | [WIRING] Extend `core/scripts/soma.cjs` dispatcher to support 2-arg invocation (`soma manifest baseline [flags]` → `manifest.cjs baseline [flags]`). Pass-through extra args via `spawnSync`. Update `--help` table to list `manifest` subcommand. Add dispatcher integration test. | [SPEC:AC-10] | `core/scripts/soma.cjs`, `core/scripts/__tests__/soma-dispatcher.test.cjs` (extend if exists, create otherwise) | T-03, T-04, T-05, T-06, T-07, T-08 | TODO |

---

## Wave 4 — Invariant Tests (Step 5, parallel)

<!-- Invariant tests live in dedicated test files, all touch DIFFERENT files → all [P]-parallel. -->

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-10 | [P] Frozen libs invariant test: assert sha256 of `core/scripts/lib/anchored-blocks.cjs`, `lib/manifest.cjs`, `lib/template-engine.cjs` are byte-identical to baseline `f3c2f0b` (Article XII, AC-07). Fail loudly if any frozen lib touched during 014 implementation. | [SPEC:AC-07] | `core/scripts/__tests__/frozen-libs-invariant-014.test.cjs` (new) | T-09 | TODO |
| T-11 | [P] `sourceSha256` immutability test: setup fixture manifest with all 4 derived entries (`core.hyd-v2`, `core.soma-stsd`, `adapter.codex.AGENTS`, `adapter.global.AGENTS`) having distinct `sourceSha256` values; run `manifest baseline --apply`; assert post-write that EVERY entry's `sourceSha256` field is byte-identical to pre-write (AC-08, D-014). | [SPEC:AC-08] | `core/scripts/__tests__/source-sha-immutable.test.cjs` (new) | T-09 | TODO |
| T-12 | [P] Doctor integration test (post-apply doctor exits 0): setup fixture with stale entries, run `manifest baseline --apply`, then invoke `node doctor.cjs` against same fixture-SOMA_HOME; assert exit 0 + zero `source_staleness` drift findings (AC-03). | [SPEC:AC-03] | `core/scripts/__tests__/manifest-baseline-doctor.test.cjs` (new) | T-09 | TODO |

---

## Wave 5 — Smoke (Step 9)

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-13 | [SMOKE] End-to-end real-environment validation: against actual `~/.soma-v2/`, run `soma manifest baseline --dry-run` (expect: lists 3 stale entries — `core.soma-stsd`, `adapter.codex.AGENTS`, `adapter.global.AGENTS`); take snapshot of `~/.soma-v2/manifest.json`; run `soma manifest baseline --apply`; verify `node doctor.cjs` reports 0 source_staleness findings; verify `soma rollback` (if invoked) restores pre-baseline manifest. Document outcome in handoff Bucket B closure note. | [SPEC:AC-03] [SPEC:AC-09] | (no source mutations beyond `~/.soma-v2/manifest.json` + snapshot) | T-09, T-10, T-11, T-12 | TODO |

---

## DAG Summary

```
T-01 ──→ T-02 ──→ T-03 ──→ T-04 ──┐
                       │           │
                       ├──→ T-05 ──┤
                       │           │
                       ├──→ T-06 ──┼──→ T-09 ──→ {T-10[P], T-11[P], T-12[P]} ──→ T-13
                       │           │
                       ├──→ T-07 ──┤
                       │           │
                       └──→ T-08 ──┘
```

**Wave execution order:**
1. **Foundation:** T-01 (single, blocking)
2. **Wave 1 (Contract):** T-02 (single in this wave; could be parallel if more contracts existed)
3. **Wave 2 (Impl, serial):** T-03 → T-04 → T-05 → T-06 → T-07 → T-08
4. **Wave 3 (Wiring):** T-09
5. **Wave 4 (Invariants, parallel):** T-10, T-11, T-12 dispatched together
6. **Wave 5 (Smoke):** T-13 last (real-env validation)

---

## AC Coverage Verification

| AC | Tasks |
|---|---|
| AC-01 | T-03 |
| AC-02 | T-03 |
| AC-03 | T-12, T-13 |
| AC-04 | T-04 |
| AC-05 | T-04 |
| AC-06 | T-05 |
| AC-07 | T-10 |
| AC-08 | T-11 |
| AC-09 | T-06, T-13 |
| AC-10 | T-01, T-08, T-09 |
| AC-11 | T-07 |
| AC-12 | T-07 |
| AC-13 | T-03 |
| AC-14 | T-03 |
| AC-15 | T-01, T-03 |
| AC-16 | T-07 |
| AC-17 | T-04 |

**Total:** 17/17 ACs referenced. **0 orphan tasks** (every task has `[SPEC:AC-XX]` or `[CONTRACT:...]` or structural tag `[FOUNDATION]`/`[WIRING]`/`[SMOKE]`).
