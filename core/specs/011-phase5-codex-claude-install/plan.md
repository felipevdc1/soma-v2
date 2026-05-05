# Plan: Phase 5 Codex+Claude Bootloader Operational Install

**Feature ID:** 011-phase5-codex-claude-install
**Spec:** `specs/011-phase5-codex-claude-install/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED (2026-05-02 — user ACK "eu aprovo, o que tu achar melhor" → marker `/tmp/soma-spec-approved-phase5` created → T-01 dispatch unblocked)

---

## Technical Approach

**RE-SCOPED 2026-05-02 per Phase 4b discovery**: Phase 4b sync.cjs (663L) JÁ implementa `--apply` write-mode + snapshot infrastructure (`scripts/lib/snapshot.cjs` SHIPPED). Phase 5 effectively becomes (a) **bug-fix-first** of 7 empirical bugs (BF-01..BF-07 — see spec.md), (b) **new commands** (rollback) + new logic (migration), (c) **new safety** (sandbox enforcement, synthetic validation cycle). NÃO mais "implement from zero" — extend + fix.

Fluxo: `soma sync` (default = dry-run pós-BF-07) lê install-targets.json, resolve source_doc content de SOMA_HOME, computa diff. `soma sync --apply --tool={codex|claude}` adiciona snapshot pré-write (já operacional) + write anchored blocks usando format `<!-- soma-v2:start id={id} version={ver} sha256={hex64} -->` (existing). Pós-BF-01/BF-02: positional logic (insert BEFORE marker X) + section header wrapper (`## SOMA Bootloader (managed by soma sync)`). Pós-BF-06: conflict detection aborta antes de write quando sha256 mismatch (não warn-and-overwrite). Rollback NEW: `soma rollback --snapshot-id {ISO}`. Migration NEW: `--migrate` flag em sync substitui OLD markers; `doctor --check-migration` reporta migration_needed.

**Stack:**
- Runtime: Node 22 (existing SOMA target — NODE_TEST_CONTEXT bridge wrapper for recursive node:test)
- Framework: Node stdlib direct — `node:fs`, `node:crypto` (sha256), `node:child_process` (spawnSync), `node:path`, `node:test` (unit + integration)
- Storage: filesystem (snapshots em `~/.soma-v2/.snapshots/{ISO}/`, logs em `~/.soma-v2/logs/sync-*.jsonl` + `rollback-*.jsonl`)
- Test runner: `node --test` via Phase 4a/4b bridge wrapper pattern (`scripts/__tests__/phase5-regression.test.cjs`)

**Rationale:** Stack escolhido por consistência com Phase 0-4 SOMA infrastructure (zero novas deps). `~/.soma-v2/scripts/lib/anchored-blocks.cjs` (frozen baseline per AC-08) já implementa anchor format v2 read+write — Phase 5 reusa via require, NÃO modifica. Phase 4b sync.cjs (snapshot+manifest+trap+D4 shipped) já tem foundations operacionais — Phase 5 estende com `--apply` write execution, conflict detection, migration logic, e adiciona rollback.cjs irmão. Article VII compliance: 3 NEW components exato (rollback, snapshot lib, migration lib), zero wrappers, zero speculative.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **Snapshot path = `~/.soma-v2/.snapshots/{ISO}/{tool}/{relative-path}`** com per-snapshot manifest.json (Q7 lock) | Immutable per snapshot, no shared global file lock, mirror Phase 4b pattern. Permite N concurrent rollbacks targeting different snapshots sem race condition. | Global manifest em `~/.soma-v2/.snapshots/manifest-global.json` rejeitado: requires file lock, race condition on concurrent rollback, harder to reason about. |
| **Compound key `(block_id, target_path)` para uniqueness** (Q9 lock via discovery) | Codex production já usa block_id duplicate em 2 entries com target_path distintos. manifest.cjs/doctor.cjs não validam standalone block_id uniqueness. Mudar agora quebra Codex install-targets sem ganho. | Force standalone block_id uniqueness rejeitado: requires renomear Codex `block.codex.AGENTS.codebase-memory-mcp` em uma das 2 entries → breaks D-C11 Cláusula A naming convention parallelism. |
| **Sandbox via `SOMA_SAFE_PATHS_ONLY=1` env var inline em snapshot.cjs** (Q10 lock) | Sandbox check é parte de snapshot path validation logic (snapshot path derived from target_path). Inline mantém ≤3 NEW components per Article VII. | Separate `scripts/lib/sandbox.cjs` rejeitado: 4ª NEW component, viola Article VII Simplicity Gate. Logic é pequena (~10 lines), não justifica separate file. |
| **Synthetic `/tmp/phase5-validation/` cycle MANDATORY antes de real CLAUDE.md write** (Q4 lock) | Article IV (Proof Before Done) hard requirement. Risk surface = corrupt the user's self-model file. Synthetic cycle valida sha256 round-trip identity em fixture cópia ANTES de tocar real file. | Skip synthetic + go-direct rejeitado: 1 bug em sync.cjs durante real apply = Failure Modes #11 corrupção catastrófica de CLAUDE.md (Failure Modes / MemPalace / Voxel theme perdidos). Cost de synthetic cycle (~50ms) é trivial vs cost de recovery. |
| **Conflict detection ABORTS sem write em sha256 mismatch** (AC-13) | Article VI Zero Deletion + spirit. User edited inside block manually = signal that user has intent. Auto-merge = lossy. Abort + manual resolution preserva user agency. | Auto-merge via 3-way diff rejeitado: requires complex merge logic, edge cases unbounded, user content em CLAUDE.md is critical (não é code). Manual resolution OK porque conflicts deveriam ser raros. |
| **Migration default = coexist (NOT auto-migrate)** (Q1 lock) | OLD markers em Codex AGENTS.md hoje são WORKING bootloader content. Auto-migration risk = breaking working state on first --apply. Opt-in `--migrate` flag preserva user agency. | Auto-migrate-on-first-apply rejeitado: hidden behavior. User pode não esperar OLD → new conversion sem explicit consent. Coexist + warning é safer default. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 3 new components (rollback CLI + snapshot lib + migration lib) at exact threshold, ≤3 ✓ (Article VII)
- [x] **Anti-Abstraction Gate** — Node stdlib used directly (fs, crypto, child_process, path, node:test). Zero custom wrappers (Article VII)
- [x] **Integration-First Gate** — All tests use real fs em `/tmp/phase5-validation/` fixtures. Zero mocks for fs/sha256/child_process. Spec NFR explicit. (Article III)

**All gates PASS.** No Complexity Tracking entries needed.

---

## Complexity Tracking

_(empty — all Phase -1 gates passed)_

---

## Dependencies

- **Existing (no new install)**: `node:fs`, `node:crypto`, `node:child_process`, `node:path`, `node:test` (Node 22 stdlib)
- **Existing SOMA infrastructure (require, do not modify)**:
  - `~/.soma-v2/scripts/lib/anchored-blocks.cjs` (anchor v2 read/write — frozen per AC-08, baseline shasum)
  - `~/.soma-v2/scripts/lib/manifest.cjs` (install-targets schema validation — frozen)
  - `~/.soma-v2/scripts/lib/template-engine.cjs` (frozen)
  - `~/.soma-v2/scripts/sync.cjs` (Phase 4b — extend via internal function add, NÃO rewrite signature)
  - `~/.soma-v2/scripts/doctor.cjs` (extend with `--check-migration` flag, preserve existing flags)
  - `~/.soma-v2/scripts/bootstrap.cjs` (NO change — already auto-discovers adapters via folder presence)
- **NEW files (created by Phase 5, RE-SCOPED 2026-05-02)**:
  - `~/.soma-v2/scripts/rollback.cjs` (NEW CLI command, Q5 lock)
  - ~~`~/.soma-v2/scripts/lib/snapshot.cjs`~~ — JÁ EXISTE (Phase 4b shipped). Phase 5 EXTENDS com BF-04 (richer schema) + BF-05 (dedup) + sandbox check (AC-17).
  - `~/.soma-v2/scripts/lib/migration.cjs` (NEW OLD-format detection + replace logic)
- **Hooks integration**:
  - `~/.claude/hooks/spec-test-traceability.cjs` (existing — C-2 SHIPPED — Phase 5 dispatch sets `SOMA_RED_PHASE_STRICT=1`)
  - `~/.claude/hooks/thermal-guard.cjs` (existing — Article V — sync --apply detected via keyword `apply`)

---

## Test Strategy

**Test counts target (per AC):** ≥40 tests across 3 layers (unit + integration + e2e).

**Layer 1 — Unit tests** (~25 tests):
- `scripts/lib/__tests__/snapshot.test.cjs` (~10 tests): snapshot path derivation, manifest schema, sandbox enforcement, sha256 hashing, file copy with 0600 perms
- `scripts/lib/__tests__/migration.test.cjs` (~8 tests): OLD marker regex (positive + negative cases), in-place replacement byte-position math, source-doc content extraction
- `scripts/__tests__/rollback-unit.test.cjs` (~7 tests): manifest parse, rollback decision logic, idempotency check, error code mapping

**Layer 2 — Integration tests** (~12 tests):
- `tests/phase5/sync-apply.test.cjs` (~6 tests): full sync --apply cycle on /tmp fixture, dry-run vs apply, conflict abort, migration coexist + replace
- `tests/phase5/rollback.test.cjs` (~3 tests): full rollback round-trip, sha256 verification, snapshot-not-found error
- `tests/phase5/doctor-migration.test.cjs` (~3 tests): doctor migration_needed report, install_targets_count=8, INSTALL_TARGETS_EMPTY warnings

**Layer 3 — E2E synthetic validation** (~3 tests, AC-15/AC-16 critical):
- `tests/phase5/synthetic-validation.test.cjs`: full apply → simulated SIGKILL mid-write → rollback → sha256 round-trip identity assertion against fixture copy of real CLAUDE.md
- `tests/integration/phase5-e2e.test.cjs`: full lifecycle (sync → snapshot → manual edit → conflict abort → rollback → state restored)

**TDD discipline:** Per Article II + C-2 enforcement, RED tests committed BEFORE GREEN impl. Dispatch prompt sets `SOMA_RED_PHASE_STRICT=1`. Each AC's test commit must precede its impl commit (verifiable via `git log --diff-filter=A`).

**Sandbox:** All tests run with `SOMA_SAFE_PATHS_ONLY=1` env var. Real `~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/CLAUDE.md` NEVER touched in test runs. Test fixtures live in `/tmp/phase5-validation/{test-name}/`.

---

## Rollout Strategy

**Phase 5 dispatch sequence** (DAG-aware, thermal-guard ≤3):

1. **Wave 0** (Foundation, T-01) — Setup test fixtures + populate Claude `install-targets.json` with 3 entries. Zero impl. ~30 min.
2. **Wave 1** (Contract Tests, T-02..T-04) — 3 contract tests in parallel ([P]). Each writes contract test stub from `contracts/{name}.md`. RED phase committed first. ~1 day.
3. **Wave 2** (Implementation, T-05..T-13) — 9 impl tasks across 3-4 parallel waves (thermal-guard limit). Snapshot + sync apply + rollback + migration + conflict + sandbox + idempotency + content-preservation + Article IV/V compliance. ~5-7 days.
4. **Wave 3** (Integration, T-14..T-15) — Wire CLI dispatcher + e2e smoke. ~1 day.
5. **Validation gate** — Synthetic /tmp cycle MUST pass before any real ~/.codex/AGENTS.md or ~/.claude/CLAUDE.md write attempt.
6. **Real-write canary** — `--apply --tool=codex` first (lower risk: AGENTS.md vs CLAUDE.md). Then `--apply --tool=claude` after user ACK + manual review of dry-run output.

**Estimated total**: 5-7 days RE-SCOPED 2026-05-02 (was 8-10 days pre-discovery). Phase 4b shipped reduces ~30% scope. Bug-fix tasks são lighter than from-zero impl. Sonnet dispatches sequenciais (não paralelos) pra conservar usage budget — 3-paralelos esgotaram em ~10min (T-02/T-03/T-04 attempt 2026-05-02 19:00Z, all returned 0 tokens "out of extra usage").

---

## References

- **Spec**: `specs/011-phase5-codex-claude-install/spec.md` (22 ACs, 12/12 NCs resolved)
- **Contracts**: `contracts/sync-apply.md`, `contracts/rollback.md`, `contracts/doctor-migration-check.md`
- **Quickstart**: `quickstart.md`
- **Constitution**: `~/.claude/constitution.md` Articles II HARD (Test-First), III HARD (Integration-First), IV HARD (Proof Before Done), V HARD (Thermal Guard), VI HARD (Zero Deletion), VII SOFT (Simplicity)
- **D-C11 Adapter Contract**: `~/.soma-v2/docs/adapter-contract.md` (5 cláusulas A-E, locked 2026-05-01)
- **D-C15 Backups location**: snapshots em `~/.soma-v2/.snapshots/{ISO}/{adapter}/{file-relative-path}` + sha256 manifest (locked 2026-05-01)
- **C-2 enforcement**: `~/.claude/hooks/spec-test-traceability.cjs` validateRedPhase (SHIPPED 2026-05-02)
- **Phase 4b sync infrastructure**: `~/.soma-v2/scripts/sync.cjs` (snapshot+manifest+trap+D4 shipped 2026-05-02)
- **Handoff**: `~/.claude/plans/handoff-soma-v2.1.md` (Bucket E primary next)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Real `~/.claude/CLAUDE.md` corruption during dev/test | CRITICAL | `SOMA_SAFE_PATHS_ONLY=1` env var enforced em CI + synthetic /tmp validation cycle pré-real-write (AC-15/AC-16/AC-17). |
| `~/.codex/AGENTS.md` OLD-format markers conflict with new soma-v2 anchors | MEDIUM | Validate-then-migrate (Q1 lock): coexist default + opt-in `--migrate` flag. Doctor surfaces migration need with WARNING level. |
| User edits inside anchored block between syncs (lost on next apply) | HIGH | Conflict detection (AC-13/AC-14): sha256 mismatch detected, sync aborts, no write, manual resolution required. |
| Snapshot disk usage growth unbounded | LOW | Out-of-scope per Phase 5 (snapshot pruning deferred to Phase 6+). Document in Out of Scope. Manual `rm -rf ~/.soma-v2/.snapshots/{old-ISO}` viable interim. |
| Concurrent `--apply` invocations race | LOW | Article V thermal-guard enforces ≤3 simultaneous (apply counts). DAG dispatch from /soma-run sequential per tool. Manual concurrent apply = user's responsibility (warning in docs). |
| sync.cjs Phase 4b internal API breakage from extension | MEDIUM | Phase 4b shasum baseline preserved (AC-08 freeze). Extension via internal function ADD, signature preserved. Pre/post shasum check em dispatch preamble. |
