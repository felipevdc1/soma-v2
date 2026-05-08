# Plan: v2.1.4 — `soma manifest baseline` Subcommand

**Feature ID:** 014-manifest-baseline
**Spec:** `specs/014-manifest-baseline/spec.md`
**Created:** 2026-05-08
**Status:** DRAFT

---

## Technical Approach

Add a new CLI subcommand `soma manifest baseline [flags]` that recomputes `sha256` field of `manifest.json` `files[]` entries from current lab content. Implementation lives in **a new script** `core/scripts/manifest.cjs` (parses sub-verb `baseline` as first positional arg per D-014-3) which reads manifest via the FROZEN `lib/manifest.cjs::loadManifest`, iterates entries, computes sha256 of each `path` lab file via `crypto.createHash('sha256')`, compares to stored `file.sha256`, and either reports diff (dry-run) or writes updated manifest atomically (apply mode). Apply mode invokes the existing `sync.cjs::createSnapshot()` primitive (D-013-8 reuse) BEFORE write to enable rollback. Dispatcher integration: extend `core/scripts/soma.cjs` SUBCOMMANDS to register `manifest` and pass-through extra args via `spawnSync`. Test suite uses real fixture manifests under `/tmp/soma-baseline-test-{run}/` (NO mocked fs).

**Stack:**
- Runtime: Node 22 (matches soma-v2 conventions)
- Framework: Node stdlib only (`fs`, `path`, `crypto`, `child_process`) — no new deps
- Storage: filesystem (`manifest.json`, snapshots dir)
- Test runner: `node:test` (per ARGUMENTS — NOT bun for sync.cjs/manifest.cjs domain)

**Rationale:** zero new dependencies; reuse existing primitives (`loadManifest`, `createSnapshot`); stay aligned with v2.1.x Node-only test convention to keep frozen libs untouched.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| Implementation in NEW file `core/scripts/manifest.cjs` (NOT in `lib/`) | Frozen libs invariant (Article XII) — `lib/manifest.cjs` is read-only API, must not gain write functions. New scripts/ file follows existing convention (`bootstrap.cjs`, `init.cjs`, `doctor.cjs`, `sync.cjs` all live in `scripts/`). | Extend `lib/manifest.cjs` with write API → violates frozen invariant HARD |
| CLI shape `soma manifest baseline` (D-014-3, nested-verb pattern) | Future-proof for `soma manifest validate/list/add` without further dispatcher rework; matches Bucket B language. | Flat `soma baseline` → ambiguous; hyphenated `soma manifest-baseline` → ugly UX |
| Snapshot reuse via `sync.cjs::createSnapshot()` (D-013-8 lock) | Existing primitive proven by Spec 013. Avoids new snapshot infra (Article VII Simplicity). Snapshot retention managed by existing `soma rollback` policy (D-014-5). | Build new snapshot subsystem → over-engineering, violates Simplicity gate |
| Dry-run is DEFAULT mode; apply requires `--apply` flag (AC-15) | Safety: a re-baseline mutates manifest.json, the authoritative state file. Default-dry prevents accidental writes. | Default-apply with `--dry-run` opt-in → unsafe; one wrong invocation overwrites baseline |
| Atomic write via tmp→rename | Standard pattern, consistent with `sync.cjs::runApplyMode` write semantics. Prevents partial-write corruption on crash. | In-place write → corruption risk if process killed mid-write |
| Lab content is source-of-truth (lab → manifest, NOT manifest → lab) | Lab files have intentional modifications (e.g., "DRIFT flag prepended" in `_global/AGENTS.md`). Manifest must record current truth, not impose stale baseline. | Re-derive content from canonical source (Bucket B path b) → would overwrite intentional lab modifications |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — ≤3 new projects/components (Article VII)
  - 1 new script file (`manifest.cjs`)
  - 1 dispatcher modification (`soma.cjs` SUBCOMMANDS extension)
  - 1 new test file (`manifest.test.cjs`)
  - = 3 total. PASS.
- [x] **Anti-Abstraction Gate** — framework used directly, no custom wrappers (Article VII)
  - Uses `crypto`, `fs`, `path` directly. No abstraction layers. PASS.
- [x] **Integration-First Gate** — tests use real DB / real services, not mocks (Article III)
  - Tests use real fixture manifest.json + real lab dir under `/tmp/soma-baseline-test-{run}/`. No fs mocking. PASS.

All gates green. No Complexity Tracking required.

---

## Complexity Tracking

_(none — all Phase -1 gates passed without violation)_

---

## Dependencies

- Node stdlib only: `node:fs`, `node:path`, `node:crypto`, `node:child_process` — no new packages
- Internal reuse: `core/scripts/lib/manifest.cjs::loadManifest` (frozen, read-only — call only, no modification)
- Internal reuse: `core/scripts/sync.cjs::createSnapshot()` at line 688 (D-013-8 lock)

---

## References

- Spec: `core/specs/014-manifest-baseline/spec.md`
- Contracts: `core/specs/014-manifest-baseline/contracts/cli-baseline.md`
- Tasks: `core/specs/014-manifest-baseline/tasks.md`
- Quickstart: `core/specs/014-manifest-baseline/quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles III (Integration-First), IV (Proof Before Done), V (Thermal Guard), VI (Zero Deletion), VII (Simplicity), XII (Frozen Libs Invariant)
- Frozen lib (read-only API, MUST NOT modify): `core/scripts/lib/manifest.cjs`
- Reuse target (snapshot primitive): `core/scripts/sync.cjs:688` (`createSnapshot`)
- Drift detector reference: `core/scripts/doctor.cjs:287-326` (`detectSourceStaleness`)
- Bucket B investigation: `~/.claude/plans/handoff-soma-v2.1.md` Bucket B (drift root cause + 3 candidate paths)
