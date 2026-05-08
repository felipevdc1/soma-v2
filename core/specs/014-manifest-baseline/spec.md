# Spec: v2.1.4 — `soma manifest baseline` Subcommand

**Feature ID:** 014-manifest-baseline
**Branch:** `feature/014-manifest-baseline`
**Created:** 2026-05-08
**Status:** DRAFT

---

## Context (Why this exists)

`manifest.json` records authoritative state of lab files (`~/.soma-v2/`) via `files[].sha256`. Over the v2.1.x lifecycle, 3 entries drifted because lab content was intentionally modified (e.g., "DRIFT flag prepended", "anchored attrs added") but the manifest baseline was never updated. `doctor.cjs detectSourceStaleness` correctly flags these as `kind: source_staleness, severity: drift`. There is currently **no CLI primitive** to re-baseline these entries. Bucket B investigation (2026-05-07) deferred remediation to v2.1.4 with 3 candidate paths; this spec ratifies path **(c) — add `soma manifest baseline` subcommand** as the chosen approach.

---

## User Stories

- Como mantenedor SOMA, quero rodar `soma manifest baseline` pra recompute os `sha256` entries do `manifest.json` a partir do conteúdo atual do lab, pra `doctor.cjs` reportar 0 source_staleness drift findings sem precisar editar manifest manualmente.
- Como CI/automation, quero rodar `soma manifest baseline --dry-run --json` pra detectar entries staleadas sem mutar o manifest, pra alertar maintainers que re-baseline é necessário.

---

## Acceptance Criteria

- **AC-01:** Given `manifest.json` with N entries where M entries have `sha256` differing from the actual sha256 of their referenced lab file content, when user runs `soma manifest baseline --dry-run`, then exit code is 0 AND output lists the M stale entries (id/path/old-sha/new-sha) AND zero filesystem mutations occur.

- **AC-02:** Given `manifest.json` with M stale entries, when user runs `soma manifest baseline --apply`, then `manifest.json` is written atomically (tmp→rename), the M entries' `sha256` field is updated to match current lab content sha256, AND a snapshot is created before the write.

- **AC-03:** Given `manifest.json` immediately after a successful `soma manifest baseline --apply`, when user runs `node ~/.soma-v2/scripts/doctor.cjs`, then exit code is 0 AND zero `source_staleness` drift findings are emitted.

- **AC-04:** Given `manifest.json` with multiple stale entries, when user runs `soma manifest baseline --apply --filter core.soma-stsd`, then only the entry whose `id === "core.soma-stsd"` has its `sha256` re-baselined AND all other entries (including stale ones) remain unchanged.

- **AC-05:** Given `manifest.json` with multiple stale entries, when user runs `soma manifest baseline --apply --filter docs/soma-stsd.md`, then only the entry whose `path === "docs/soma-stsd.md"` has its `sha256` re-baselined AND all other entries remain unchanged.

- **AC-06:** Given any mode (dry-run or apply), when user passes `--json`, then output is structured JSON with `schema: "soma-manifest-baseline/v1"` (per D-014-4) instead of human-readable text, with fields covering: mode, entries-considered, entries-rebaseled, entries-skipped, manifest-path, snapshot-path (apply only).

- **AC-07:** Given the implementation of this feature, when sha256 of `core/scripts/lib/anchored-blocks.cjs`, `core/scripts/lib/manifest.cjs`, and `core/scripts/lib/template-engine.cjs` are compared at baseline `f3c2f0b` vs at the v2.1.4 release commit, then all three are byte-identical (frozen libs invariant — Article XII).

- **AC-08:** Given any invocation of `soma manifest baseline` (dry-run or apply), when `manifest.json` is written, then `sourceSha256` field of every entry is preserved unchanged (out-of-scope confirmation — never mutated by this subcommand).

- **AC-09:** Given user runs `soma manifest baseline --apply`, when the write completes, then a snapshot exists at the location reported by the snapshot machinery (consistent with existing `sync.cjs createSnapshot()` pattern at `sync.cjs:688`) AND `soma rollback {snapshot-id}` successfully restores the pre-write `manifest.json` content.

- **AC-10:** Given user runs `soma manifest baseline --help` (or equivalent help invocation), then exit code is 0 AND output documents usage including `--dry-run`, `--apply`, `--filter <id|path>`, `--json`.

- **AC-11:** Given `manifest.json` is missing in `~/.soma-v2/`, when user runs `soma manifest baseline` (any mode), then exit code is 2 AND error message contains `MANIFEST_MISSING` (passthrough from `manifest.cjs loadManifest`).

- **AC-12:** Given `manifest.json` exists but has invalid schema (not `soma-manifest/v1` or missing `files` array), when user runs `soma manifest baseline`, then exit code is 2 AND error message contains `MANIFEST_INVALID`.

- **AC-13:** Given user runs `soma manifest baseline --apply` twice in succession with no intervening lab file changes, when the second run executes, then it reports "0 entries to re-baseline" AND exit code is 0 AND `manifest.json` is byte-identical before and after the second run (idempotency).

- **AC-14:** Given user runs `soma manifest baseline --dry-run`, when no entries are stale, then output indicates "0 stale entries" AND exit code is 0 (clean state report).

- **AC-15:** Given user runs `soma manifest baseline` (no mode flag, neither `--dry-run` nor `--apply`), then the default behavior is dry-run AND a hint is emitted reminding the user to pass `--apply` to write changes.

- **AC-16:** Given a manifest entry whose lab path does not exist on disk (`fs.readFileSync` throws ENOENT), when user runs `soma manifest baseline` (any mode), then a warning is emitted for that entry, the entry is SKIPPED (not re-baselined), other entries proceed normally, AND the overall exit code is 0 if all other entries process cleanly (per D-014-1). Behavior is consistent with `doctor.cjs detectSourceStaleness:298-308` which emits `severity:'missing'` finding without aborting.

- **AC-17:** Given user runs `soma manifest baseline --filter 'adapters/*'` (glob pattern), when filter is parsed, then the filter is treated as a literal exact-match string (NOT expanded as a glob) per D-014-2 — exit code 0 with output "0 entries matched filter" (since no entry's `id` or `path` literally equals `adapters/*`).

---

## Decisions Locked

These decisions resolve the original [NEEDS CLARIFICATION] markers (Felipe approved defaults 2026-05-08).

- **D-014-1** — Lab file ENOENT for an entry: **skip-with-warning + continue + exit 0**. Rationale: consistent with `doctor.cjs detectSourceStaleness:298-308` pattern (emits `severity:'missing'` finding without aborting). Re-baseline op is best-effort; absent lab file is config issue, not a baseline-op fault. Tested by AC-16.

- **D-014-2** — `--filter <value>` accepts **exact match on `id` OR `path` field only**. Glob/regex NOT supported in v2.1.4. Rationale: exact match satisfies known use cases (`core.soma-stsd`, `adapters/codex/AGENTS.md`); glob defers to v2.1.5+ if real use case emerges. Tested by AC-04 (id), AC-05 (path), AC-17 (literal string with `*`).

- **D-014-3** — CLI shape: **`soma manifest baseline [flags]`** (nested-verb pattern). Implementation: extend `soma.cjs` dispatcher to support 2-arg subcommand routing OR have `manifest.cjs` parse `baseline` as first positional arg (plan-phase decision). Rationale: future-proof for `soma manifest validate/list/add` without further dispatcher changes. Tested implicitly via AC-04, AC-05, AC-10.

- **D-014-4** — JSON output schema: **`soma-manifest-baseline/v1`**. Rationale: clarity > concision; matches existing schema naming pattern (`soma-manifest/v1`, `soma-bootstrap/v1`). Tested by AC-06.

- **D-014-5** — Snapshot retention: **reuse existing `soma rollback` cleanup policy unchanged**. No new retention logic introduced. Rationale: scope discipline — baseline subcommand creates snapshots via existing `createSnapshot()` primitive (D-013-8) but does not manage their lifecycle. Tested implicitly by AC-09 (snapshot exists + rollback works).

---

## Non-Functional Requirements

- **Performance:** subcommand completes in < 1s for manifests up to 100 entries (current manifest has 15). Sha256 computation is O(file-size) per entry; no network or DB I/O.
- **Security:** no user data logged; output contains only file paths, manifest entry IDs, and sha256 hex strings. No secrets or PII surface.
- **Test style:** integration tests use real fixture manifest + lab structure under `/tmp/soma-baseline-test-{run}/` (not mocked filesystem). Unit tests for sha256 computation logic + filter matching. RED→GREEN linear per Article II HARD.
- **Frozen libs invariant:** `core/scripts/lib/anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs` zero-touched. New tooling lives in new file (suggested location: `core/scripts/manifest.cjs` or `core/scripts/lib/manifest-baseline.cjs` — plan-phase decision).
- **Snapshot reuse:** apply-mode snapshot uses existing `createSnapshot()` from `sync.cjs:688` (D-013-8 lock — no new snapshot infra).
- **Backwards compat:** existing `soma <subcmd>` invocations unaffected. Adding `manifest` subcommand to dispatcher does not change behavior of other subcommands.

---

## Out of Scope

- **`sourceSha256` re-baseline** — separate concern about source derivation pipeline (e.g., re-running sed extraction from `~/.codex/AGENTS.md`). May become v2.1.5 spec. Explicitly excluded here.
- **Re-derivation of file content** from canonical sources (Bucket B path b) — rejected because risks overwriting intentional lab modifications (e.g., "DRIFT flag prepended" in `adapters/_global/AGENTS.md`).
- **Automatic baseline integration with `soma sync --apply`** — would couple two distinct operations. Standalone subcommand only for v2.1.4. Future enhancement separate.
- **Manifest schema migration** (e.g., upgrading from `soma-manifest/v1` to v2). Out of scope.
- **Multi-manifest support** (project-level + lab-level baseline coordination). Out of scope.
- **`install-targets.json` re-baseline** — different schema, different drift mechanism. Out of scope.

---

## Open Questions

_(none — all 5 original markers resolved as Decisions Locked above on 2026-05-08)_

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW — only WHAT and WHY)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining (resolved via D-014-1 through D-014-5)
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry (6 entries)
- [x] Feature ID + Branch filled in
