# Plan: Soma Sync Apply Write-Mode

**Feature ID:** 004-soma-sync-apply
**Spec:** `specs/004-soma-sync-apply/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

Phase 4b extends the existing `~/.soma-v2/scripts/sync.cjs` (Phase 2, ~230 LOC) with a new `--apply` write-mode branch that performs full-file snapshots before any modification of adapter target files. A new helper module `scripts/lib/snapshot.cjs` encapsulates snapshot creation, byte-stable manifest emission, and timestamp generation (D3). The all-or-nothing transactional commit (D2) validates ALL targets pre-write — anchor parse + source shasum + snapshot dir creation — before any source mutation. Local edits are preserved via the snapshot mechanism (D4: warn-loud + continue), and `--apply` + `--dry-run` conflict exits 2 INVALID_ARGS (AC-12). Existing Phase 2 libs (`anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) remain shasum-locked and read-only.

**Stack:**
- Runtime: Node.js v22 (matches Phase 2/3/4a)
- Framework: vanilla CommonJS `.cjs` (D7 from Phase 2: no npm deps, stdlib only)
- Storage: filesystem only (snapshots in `~/.soma-v2/.snapshots/{ISO}/`)
- Test runner: `node:test` + `node:assert/strict`

**Rationale:** Stack consistency with Phase 2/3/4a is non-negotiable — same shasum-lock discipline (AC-15 baseline preservation), zero dep introduction, and reuse of existing `lib/` modules. New `lib/snapshot.cjs` follows the established pattern of single-responsibility helpers (anchored-blocks does parsing; manifest does install-targets; snapshot does pre-write copy+hash).

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** Extend existing `sync.cjs` (single file, 230L → ~400L) instead of forking new `sync-apply.cjs` | DRY: dry-run logic is identical to apply-mode discovery phase. Forking duplicates ~150 LOC and risks drift. | New `sync-apply.cjs` file. Rejected: would require two files maintained in lockstep. |
| **AD-02:** New helper `scripts/lib/snapshot.cjs` (NEW lib, untouched existing 3) | Single-responsibility: snapshot create + manifest emit + timestamp gen. Keeps `sync.cjs` orchestration-only. AC-09 byte-stable manifest needs dedicated hash logic. | Inline snapshot logic in sync.cjs. Rejected: ballooning sync.cjs + harder to unit-test snapshot functions in isolation. |
| **AD-03:** Snapshot mechanism = full-file copy (D-C15 + spec scope) | Simplicity: stat + copyFileSync is 2 stdlib calls. Disk cost trivial (~30KB/sync). All-or-nothing atomicity easy to reason about. | Diff/patch snapshot. Rejected: complex; marginal benefit (Phase 5+ if demand). |
| **AD-04:** All-or-nothing transactional commit (D2 resolution) | Validate ALL targets pre-write (anchor parse + source shasum + snapshot dir creation). Abort entire run on any failure. Source files NEVER partially modified. | Per-file best-effort commit. Rejected: silent partial corruption is the failure mode this spec exists to prevent. |
| **AD-05:** Local edits = warn loud + continue (D4 resolution) | Snapshot mechanism IS the safety net. Aborting on every local edit creates UX friction in frequent workflows. Recovery via copy-from-snapshot is documented. | Abort on local edits (option b). Rejected: friction outweighs marginal safety; snapshot already preserves pre-state. |
| **AD-06:** Snapshot retention = keep all + manual prune Phase 5+ (D1 resolution) | Doctor surfaces warning at >50 snapshots OR >50MB. Auto-prune deletes JUST when you didn't expect to need rollback. Bruno P6 explicit cleanup. | Auto-prune by count or age. Rejected: silent loss of rollback safety. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — extends existing 1 script + 1 NEW helper lib (`scripts/lib/snapshot.cjs`). Total Phase 4b additions: 2 files (1 modified + 1 new). Zero new top-level projects. ≤3 components ✓
- [x] **Anti-Abstraction Gate** — uses node stdlib directly (`fs`, `crypto`, `path`, `child_process`). Zero wrapper layers. New helper `snapshot.cjs` is a pure-function module, not a class abstraction.
- [x] **Integration-First Gate** — all tests via tmp dir + `child_process.spawnSync` against real filesystem. Zero mocks. TDD HARD per Article II + C-2 enforcement (`SOMA_RED_PHASE_STRICT=1` during dispatch).

All gates **PASS**.

---

## Complexity Tracking

(No gate violations; section blank.)

---

## Dependencies

- Node.js v22 stdlib only (`fs`, `path`, `crypto`, `child_process`, `os`)
- Existing read-only libs:
  - `~/.soma-v2/scripts/lib/anchored-blocks.cjs` (shasum-locked)
  - `~/.soma-v2/scripts/lib/manifest.cjs` (shasum-locked)
  - `~/.soma-v2/scripts/lib/template-engine.cjs` (shasum-locked)
- Validator: `~/.claude/hooks/spec-test-traceability.cjs` (post-C-2: validateRedPhase available; dispatch runs strict mode)

---

## References

- Contracts: `contracts/sync-apply.md`
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles II (TDD HARD), III (Integration-First), VII (Simplicity)
- Spec: `spec.md` Resolved Decisions D1-D5
- Phase 2 baseline: `~/.soma-v2/specs/001-soma-doctor-sync-cli/` (sync dry-run reference impl)
- C-2 enforcement: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase`
