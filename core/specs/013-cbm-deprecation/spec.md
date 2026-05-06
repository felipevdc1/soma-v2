# Spec 013 — cbm Deprecation + codebase-memory-mcp Source Restoration

**Status**: DRAFT
**Owner**: Felipe (orchestrator) + Sonnet (executor)
**Target release**: v2.1.1 patch
**Phase**: post-Phase-6 (v2.1.0 SHIPPED PUBLIC 2026-05-06)
**Issues addressed**: #8 (target_drift category), #9 (install-targets duplicate source)
**Created**: 2026-05-06

---

## Background

Phase 5 spec 011 (Q2 lock) intended that `cbm`, `hyd-v2`, and `soma-stsd` be three distinct anchored blocks per adapter (claude + codex), with `cbm` "extracted as sub-section of `docs/hyd-v2.md` per existing Codex convention". Implementation closed claiming 0-fail suite (2026-05-04), but two residual gaps surfaced via Issue #5 dispatch (PR #7) on 2026-05-06:

1. **Claude `cbm` is alias-redundant**: `block.claude.CLAUDE_md.cbm` and `block.claude.CLAUDE_md.hyd-v2` both source from `docs/hyd-v2.md`. Source has only one block (single `<!-- hyd-v2:start --><!-- hyd-v2:end -->` wrapper, 23 lines). Both targets would inject identical content under different anchor IDs.

2. **Codex `codebase-memory-mcp` source misroute**: `block.codex.AGENTS.codebase-memory-mcp` install-target points to `docs/hyd-v2.md` — but lab `~/.codex/AGENTS.md` lines 1-23 contain SEMANTICALLY DISTINCT content (Codebase Knowledge Graph MCP doc, with `search_graph`/`trace_call_path`/etc. tool guidance). Source `docs/codebase-memory-mcp.md` does NOT exist. Sync apply would silently overwrite the MCP doc with hyd-v2 content (silent data loss).

Phase 5 BF-03 mechanical fix (`isLegacyBlockNested()` in `core/scripts/sync.cjs:161-194`) handles the silent no-op write symptom. This spec addresses the residual semantic gap discovered via HYD pressure-test falsifier #9 during brainstorming session 2026-05-06.

---

## User Story

> As a SOMA user, when I run `install.sh`, `soma sync --apply`, or `soma migrate --cbm-deprecation`, my lab files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/AGENTS.md`) should:
>
> 1. Have a clean anchor naming convention (no legacy `cbm` alias)
> 2. Have soma-v2 anchors matching the canonical 3-block convention per adapter (claude: `{hyd-v2, soma-stsd, soma-voxel}`; codex: `{codebase-memory-mcp, hyd-v2, soma-stsd}`)
> 3. Preserve any pre-existing legacy content (codebase-memory-mcp MCP documentation) by promoting it to a proper source doc instead of dropping or overwriting
> 4. Have `doctor.cjs` report 0 drift findings post-migration
>
> The migration must be reversible (snapshot-then-mutate), idempotent (re-run is safe), and atomic (all-or-nothing across 3 lab files).

---

## Acceptance Criteria

### Path 1A — Claude cbm cleanup

- **AC-01**: `core/adapters/claude/install-targets.json` has 3 entries (was 4) — `block.claude.CLAUDE_md.cbm` is dropped. Remaining: `hyd-v2`, `soma-stsd`, `soma-voxel`.
- **AC-02**: Felipe's `~/.claude/CLAUDE.md` has soma-v2 anchor `block.claude.CLAUDE_md.hyd-v2` (replacing former `cbm`). Inner content preserved byte-identical.
- **AC-03**: No nested legacy `<!-- hyd-v2:start -->` / `<!-- hyd-v2:end -->` markers remain inside the renamed soma-v2 block in `~/.claude/CLAUDE.md`.

### Path 1B — Codex codebase-memory-mcp source restoration

- **AC-04**: `core/docs/codebase-memory-mcp.md` exists with content extracted from `~/.codex/AGENTS.md` between `<!-- codebase-memory-mcp:start -->` and `<!-- codebase-memory-mcp:end -->` markers (exclusive of markers themselves; robust to line-shift if Felipe pre-edits file). Header `# Codebase Knowledge Graph (codebase-memory-mcp)` preserved.
- **AC-05**: `core/manifest.json` has `core.codebase-memory-mcp` entry with `path: "docs/codebase-memory-mcp.md"`, valid `sha256` matching file content, `sourceMtime` ISO-8601, `status: "released"`, `targets: ["global", "project"]`.
- **AC-06**: `core/adapters/codex/install-targets.json` `codebase-memory-mcp` entries (×2: target_path `~/.codex/AGENTS.md` + `~/AGENTS.md`) have `source_doc: "docs/codebase-memory-mcp.md"` (NOT `docs/hyd-v2.md`).
- **AC-07**: Felipe's `~/.codex/AGENTS.md` has 3 soma-v2 anchors (`codebase-memory-mcp`, `hyd-v2`, `soma-stsd`) with content from respective sources. Legacy `<!-- codebase-memory-mcp:start -->` and `<!-- hyd-v2:start -->` markers replaced by soma-v2 equivalents.
- **AC-08**: Felipe's `~/AGENTS.md` has 3 proper soma-v2 anchors with correctly-separated content. Previously-nested hyd-v2 inside codebase-memory-mcp anchor → now properly separated into distinct soma-v2 anchors.

### Migration mechanism

- **AC-09**: Library function `migrateCbmDeprecation({somaHome, target, dryRun, force})` exists at `core/scripts/lib/migrate.cjs`. Exports 8 sub-functions (`extractMcpContentFromLab`, `deleteLegacyBlock`, `renameAnchor`, `atomicWrite`, `createMigrationSnapshot`, `verifyMigration`, `rollbackFromSnapshot`, `preFlightGates`).
- **AC-10**: CLI `core/scripts/migrate-cbm-deprecation.cjs` accepts `--dry-run`, `--force`, `--revert <snapshot-id>` flags.
- **AC-11**: `install.sh` detects cbm anchors / legacy markers in lab files via grep before applying main install. Auto-invokes migration if found.
- **AC-12**: `core/scripts/sync.cjs --apply` detects cbm anchors / legacy markers via pre-apply check. Auto-invokes migration before block injection.
- **AC-13**: Migration creates snapshot at `~/.soma-v2/.snapshots/{ISO-8601-with-colons-Z}-cbm-deprecation/` (example: `2026-05-06T20:00:00Z-cbm-deprecation/`) before any mutation. Reuses `createSnapshot()` from `core/scripts/sync.cjs:688`.
- **AC-14**: All Phase 1 (repo) and Phase 2 (lab) mutations are atomic — if any verification fails, snapshot restore rolls back lab atomically; repo branch preserved for review.
- **AC-15**: Pre-flight gates G1-G6 abort cleanly if violated:
  - G1: lab files exist (graceful skip if missing target)
  - G2: idempotency check (exit 0 "nothing to migrate" if no cbm/legacy)
  - G3: content alignment (lab MCP doc matches eventual source extraction; abort with diff unless `--force`)
  - G4: no concurrent migration (`.soma-v2/.migration.lock`)
  - G5: snapshot disk space (≥1MB free)
  - G6: frozen libs baseline match (3 shasums per AC-17)

### Verification

- **AC-16**: `doctor.cjs` reports 0 drift findings in lab post-migration.
- **AC-17**: Frozen libs (`core/scripts/lib/anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) shasums byte-identical pre/post migration. Baseline (locked at `e868fab`):
  - `anchored-blocks.cjs`: `6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f`
  - `manifest.cjs`: `08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462`
  - `template-engine.cjs`: `f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b`
- **AC-18**: BF-03 reproducer (`core/scripts/__tests__/bf-03-consolidation-reproducer.test.cjs`) still passes (no regression).
- **AC-19**: BF-04 reproducer (`core/scripts/__tests__/bf-04-cbm-deprecation-reproducer.test.cjs`) transitions RED → GREEN linearly in branch `fix/issue-9-cbm-deprecation` commit history; preserved as linear sequence in `main` via rebase-merge (Article II HARD compliance, per PR #7 / Issue #2 pattern).
- **AC-20**: Full test suite (838+ existing + ~12 NEW = ~850 tests) all pass, 2 skipped allowed (existing).

### Documentation

- **AC-21**: `core/docs/adapter-contract.md` D-C11 updated:
  - Claude triplet description: `{cbm, hyd-v2, soma-stsd}` → `{hyd-v2, soma-stsd, soma-voxel}` (cbm dropped, soma-voxel canonicalized as 3rd block)
  - Codex triplet annotation: `codebase-memory-mcp` source explicitly `docs/codebase-memory-mcp.md` (not inherited from hyd-v2.md)
- **AC-22**: `CHANGELOG.md` v2.1.1 entry includes:
  - **BREAKING**: `cbm` anchor deprecated in claude adapter, auto-migrated to `hyd-v2` by install.sh / sync apply / `soma migrate --cbm-deprecation`
  - **FIXED**: codex `codebase-memory-mcp` source restored from Phase 5 Q2 misroute (closes #9)
  - **FIXED**: Issue #8 target_drift category resolved via migration

---

## Non-Functional Requirements

- **Atomic per-file**: tmp+rename POSIX pattern. All-or-nothing across 3 lab files in Phase 2.
- **Reversible**: snapshot retained 30 days. `--revert <snapshot-id>` flag restores lab byte-identical to pre-migration state.
- **Idempotent**: re-running migration after partial completion or full success exits 0 with "nothing to migrate" message.
- **Cross-platform**: install.sh works on macOS (BSD sed) + Linux (GNU sed). Reuses Phase 6.4 PLATFORM detect pattern (validated in Phase 6.8 Docker test).
- **Frozen libs invariant**: `core/scripts/lib/{anchored-blocks,manifest,template-engine}.cjs` shasums MUST remain byte-identical through entire migration. Hard-stop if violated.
- **No regression**: Phase 5 BF-03 reproducer + all 838+ existing tests must remain GREEN.
- **TDD-strict (Article II HARD)**: RED commit precedes GREEN commit linearly in main (no merge commit noise — rebase merge).

---

## Locked Decisions

- **D-013-1** [Q1=B]: Scope = claude + codex parallel. Both adapters fixed in single patch for symmetry of adapter contract.
- **D-013-2** [Q2=B]: Migration semantic = replace via sync (delete legacy block, fresh inject from source), not rename in-place. Cleanest end state, exercises BF-03 fix path in PROD.
- **D-013-3** [Q3=B]: Test coverage = comprehensive — 4 layers (BF-04 reproducer + migration unit + e2e integration + existing assertion updates) + frozen libs invariant. Belt-and-suspenders (Q3=C) deferred as Phase 7 hardening.
- **D-013-4** [Q4=A]: Versioning = v2.1.1 patch. Framing: BF-03 was Phase 5 incomplete refactor; this is bug-fix continuation. Explicit BREAKING disclosure in CHANGELOG.
- **D-013-5** [Q5=C]: Migration trigger = 3 entry points (install.sh + sync apply + explicit `soma migrate --cbm-deprecation` CLI). All call same library function `migrateCbmDeprecation()`.
- **D-013-6** [HYD pivot Y]: Codex `codebase-memory-mcp` is NOT alias dedup — has real semantic content (MCP doc) requiring source doc creation. Path 1B distinct from Path 1A. Initial Path 1 thesis (drop both legacies) rejected after falsifier #9 verification.
- **D-013-7**: Source doc location for MCP content = `core/docs/codebase-memory-mcp.md` (top-level docs/, parallel to `hyd-v2.md` and `soma-stsd.md`). Spec 011 Q2 hypothesis ("sub-section of hyd-v2.md") rejected — semantically distinct content deserves separate file. Q9 spec lock (compound key block_id × target_path) preserved unchanged.
- **D-013-8**: Snapshot mechanism = reuse existing `createSnapshot()` from `core/scripts/sync.cjs:688`. No new snapshot infrastructure. Snapshot retention = 30 days (matches existing SOMA convention).
- **D-013-9**: Pre-flight gate G3 (content alignment) is HARD by default — abort with diff report unless `--force` flag. Protects Felipe's lab MCP doc from silent overwrite if it has hand-edited drift.

---

## Test plan (AC → test mapping)

| AC | Test artifact | Type |
|---|---|---|
| AC-01 | `bf-04-cbm-deprecation-reproducer.test.cjs` test 1 | unit |
| AC-02 | `bf-04-cbm-e2e.test.cjs` scenario 1 (install.sh trigger) post-state assertion | e2e |
| AC-03 | `migrate-cbm-deprecation.test.cjs` `deleteLegacyBlock()` unit | unit |
| AC-04 | `bf-04-cbm-deprecation-reproducer.test.cjs` test 3 | unit |
| AC-05 | `migrate-cbm-deprecation.test.cjs` manifest entry validity unit | unit |
| AC-06 | `bf-04-cbm-deprecation-reproducer.test.cjs` test 2 | unit |
| AC-07 | `bf-04-cbm-e2e.test.cjs` scenario 2 (sync trigger) post-state assertion | e2e |
| AC-08 | `bf-04-cbm-e2e.test.cjs` scenarios 1/2/3 cover ~/AGENTS.md | e2e |
| AC-09 | `migrate-cbm-deprecation.test.cjs` covers 8 sub-functions | unit |
| AC-10 | `bf-04-cbm-e2e.test.cjs` scenario 3 (CLI) + scenarios 5/6 (--dry-run, --revert) | e2e |
| AC-11 | `bf-04-cbm-e2e.test.cjs` scenario 1 | e2e |
| AC-12 | `bf-04-cbm-e2e.test.cjs` scenario 2 | e2e |
| AC-13 | `migrate-cbm-deprecation.test.cjs` `createMigrationSnapshot()` unit | unit |
| AC-14 | `bf-04-cbm-e2e.test.cjs` failure scenario (Phase 2 verify fail → rollback) | e2e |
| AC-15 | `migrate-cbm-deprecation.test.cjs` `preFlightGates()` unit (G1-G6 individually) | unit |
| AC-16 | `bf-04-cbm-e2e.test.cjs` post-state doctor assertion | e2e |
| AC-17 | NEW `bf-04-frozen-libs-invariant.test.cjs` | invariant |
| AC-18 | regression run of `bf-03-consolidation-reproducer.test.cjs` | regression |
| AC-19 | git history check: RED commit SHA precedes GREEN commit SHA linearly in branch | manual (orchestrator validates pre-merge) |
| AC-20 | full suite run output captured in PR description | full-suite |
| AC-21 | manual review of `core/docs/adapter-contract.md` diff | manual (Felipe approves) |
| AC-22 | manual review of `CHANGELOG.md` v2.1.1 entry | manual (Felipe approves) |

---

## Definition of Done

- [ ] All 22 ACs pass (per test mapping above)
- [ ] Test gate checklist all green (full suite ≥850 pass / 0 fail / 2 skip; BF-03 still GREEN; BF-04 RED→GREEN; frozen libs CLEAN; doctor 0 findings post-migration)
- [ ] PR opened (DRAFT) on branch `fix/issue-9-cbm-deprecation`
- [ ] PR closes #8 (target_drift category) and #9 (install-targets dup) on merge
- [ ] CHANGELOG v2.1.1 entry approved by Felipe
- [ ] adapter-contract.md D-C11 update approved by Felipe
- [ ] Felipe's lab post-migration: doctor.cjs reports 0 findings empirically verified
- [ ] Frozen libs CLEAN through merge (verified via shasum diff baseline vs HEAD)
- [ ] gap-finder pass: no subtle gaps surfaced (audit per skill, post-implementation)
- [ ] quality-check pass (per /quality-check command)
- [ ] Git tag v2.1.1 annotated, GitHub Release published with explicit BREAKING disclosure

---

## Out of scope

- Belt-and-suspenders test invariant guards beyond frozen libs (Q3=C content) — deferred to Phase 7 hardening
- Bruno alpha test re-run validation — handled separately as post-release feedback (per D-P6-16)
- `rollback.cjs --revert-soma` convenience flag (Phase 6.4 deferred bucket) — not in this spec's scope; remains v2.2 enhancement candidate
- `soma sync --rebuild-manifest` convenience CLI (Issue #8 deferred enhancement) — not blocking, captured for v2.2

---

## References

- **Issue #8**: https://github.com/felipevdc1/soma-v2/issues/8 — manifest drift (partial fix shipped via Path B in 2026-05-06 ~16h, source_staleness cleared)
- **Issue #9**: https://github.com/felipevdc1/soma-v2/issues/9 — install-targets duplicate source pattern (this spec resolves)
- **Spec 011**: `core/specs/011-phase5-codex-claude-install/spec.md` — Phase 5 source (Q2 lock + BF-03 mechanical fix)
- **BF-03 reproducer**: `core/scripts/__tests__/bf-03-consolidation-reproducer.test.cjs` — regression test (must remain GREEN)
- **adapter-contract.md D-C11**: `core/docs/adapter-contract.md` — anchor naming convention contract
- **HYD pressure-test record**: brainstorming session 2026-05-06 — falsifier #9 pivot from initial Path 1 thesis (Y option locked)
- **Failure mode #9** (`~/.claude/CLAUDE.md` Failure Modes): "Spec sem verificar current state" — this spec was written WITH source verification (read sync.cjs, ran reproducer test, grep'd cbm references, read Felipe's lab files for AC-04 source extraction)

---

**Status transition**: DRAFT → APPROVED requires Felipe sign-off after spec review (skill brainstorming step 8).
