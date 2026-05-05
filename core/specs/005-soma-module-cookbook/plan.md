# Plan: Soma Module Cookbook Commands

**Feature ID:** 005-soma-module-cookbook
**Spec:** `specs/005-soma-module-cookbook/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

Phase 4c ships a new `~/.soma-v2/scripts/module.cjs` orchestrator with 4 subcommands (`add`/`promote`/`remove`/`deprecate`) backed by a new helper `scripts/lib/module-store.cjs` for read/write of `.soma/modules/{slug}.md` front-matter + companion `cookbook/snippets/{slug}.json` skeletons. The existing `scripts/doctor.cjs` (Phase 2) is extended to include the stale-hypothesis warning scan (AC-08 — emits `severity: warning, code: stale_hypothesis` for modules ≥90d old, non-blocking per D6). Module templates instantiate from `templates/project/.soma/modules/module.md.tmpl` (Phase 4a deliverable, canonical source); slug derivation is deterministic (AC-11) with reserved-name guard (AC-12). Cookbook JSON snippets follow Bruno C-1 amendment (search-and-pick pattern) but are opt-in via `--with-snippet` flag (D3 lazy creation). Existing `~/.soma-v2/docs/module-cookbook.md` 449-byte stub is preserved verbatim and gets a new `## Cookbook commands (Phase 4c)` section appended (D2).

**Stack:**
- Runtime: Node.js v22 (matches Phase 2/3/4a)
- Framework: vanilla CommonJS `.cjs` (D7 from Phase 2: zero npm deps, stdlib only)
- Storage: filesystem only (`.soma/modules/` markdown + `~/.soma-v2/cookbook/snippets/` JSON)
- Test runner: `node:test` + `node:assert/strict`

**Rationale:** Same shasum-lock discipline (AC-15 baseline preservation). New `scripts/module.cjs` follows established orchestrator pattern (init.cjs / doctor.cjs / sync.cjs each handle their command). New `lib/module-store.cjs` follows single-responsibility pattern (anchored-blocks does parsing; manifest does install-targets; module-store does module file lifecycle). Front-matter parsing uses simple regex + line scan (no YAML lib dep — preserves zero-dep stack).

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** New `scripts/module.cjs` orchestrator (NOT extend `init.cjs`) | Each top-level command (init/doctor/sync/module) gets its own `.cjs` file per Phase 2/3/4a precedent. init.cjs already 792 LOC after Phase 4a; further extension would create monolith. | Extend `init.cjs` with `--module add/promote/...` flags. Rejected: command surface mixing + LOC bloat. |
| **AD-02:** New helper `scripts/lib/module-store.cjs` (NEW lib, untouched existing 3) | Single-responsibility: read/write `.soma/modules/{slug}.md` front-matter + snippet JSON CRUD + slug derivation + reserved-name guard. Keeps `module.cjs` orchestration-only. | Inline module-store logic in module.cjs. Rejected: would balloon module.cjs to 500+ LOC; harder to unit-test slug rules in isolation. |
| **AD-03:** Snippet JSON = lazy creation default + `--with-snippet` opt-in (D3 + AC-09/AC-10) | YAGNI: most modules don't need code snippets. Skeleton creation costs 1 file write for marginal value. Opt-in matches Bruno P5 "explicit cleanup". | Always create snippet skeleton. Rejected: file pollution; clutters `cookbook/snippets/` for modules that never get snippets. |
| **AD-04:** Front-matter parser via regex + line-by-line read (no YAML lib) | Module front-matter schema is fixed (soma-module/v1 has known keys). Regex parsing is sufficient + zero-dep. Stricter validation via JSON schema-like assertion in module-store.cjs. | Ship `js-yaml` or `yaml` npm dep. Rejected: violates D7 vanilla stack; introduces dep to be locked. |
| **AD-05:** Slug derivation = lowercase + non-alphanumeric→`-` + collapse `--` + trim `-` (AC-11) | Deterministic + single function. User sees derived slug in stdout before file creation (no surprise). | Prompt user when keyword has special chars. Rejected: UX friction; users can re-run if slug derived differently than expected. |
| **AD-06:** Doctor extension = additive findings (no breaking changes to schema) | AC-15 backward compat: existing doctor consumers see same `findings_count` semantics with new `severity: warning` entries. Existing severity:critical/error consumers unaffected. | New `doctor --modules` separate command. Rejected: fragmentation; users want unified health snapshot. |
| **AD-07:** All-or-nothing on `promote` schema validation (D4) | If front-matter has breaking manual edits (extra unknown fields, malformed YAML, missing required keys), abort with SCHEMA_INVALID. User must `deprecate` + `add` again, OR Phase 5+ adds `--rewrite` flag. | Silently rewrite manual edits. Rejected: silent rewrite is exactly the failure mode this feature exists to prevent (Phase 4a Sonnet single-pass surprise pattern). |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — adds 2 NEW files (`scripts/module.cjs`, `scripts/lib/module-store.cjs`) + extends 1 existing file (`scripts/doctor.cjs`). Total: 3 components touched. ≤3 ✓
- [x] **Anti-Abstraction Gate** — uses node stdlib (`fs`, `path`, `crypto`, `child_process`, `os`) directly. New `module-store.cjs` is pure-function module (no class, no inheritance). Front-matter regex is bounded scope (~20 LOC).
- [x] **Integration-First Gate** — all tests via tmp dir + `child_process.spawnSync` against real fs + real init.cjs. Zero mocks. TDD HARD per Article II + C-2 enforcement (`SOMA_RED_PHASE_STRICT=1`).

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
  - `~/.soma-v2/scripts/lib/template-engine.cjs` (shasum-locked) — used to render `module.md.tmpl`
- Phase 4a deliverable:
  - `~/.soma-v2/templates/project/.soma/modules/module.md.tmpl` (canonical module template)
- Phase 2 deliverable extended:
  - `~/.soma-v2/scripts/doctor.cjs` (extended w/ stale-hypothesis check)
- Validator: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase` (post-C-2 strict mode)

---

## References

- Contracts: `contracts/module-commands.md` (4 subcommands + doctor extension)
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles II (TDD HARD), III (Integration-First), VII (Simplicity)
- Spec: `spec.md` Resolved Decisions D1-D6
- Phase 4a baseline: `~/.soma-v2/specs/003-soma-init-existing/` (module template + inference logic)
- Phase 2 baseline: `~/.soma-v2/specs/001-soma-doctor-sync-cli/` (doctor reference impl)
- Bruno C-1 amendment: `${CLAUDE_HOME}/projects/{user}/memory/project_soma_executor.md` §"Bruno material integration → C-1 amendment"
- C-2 enforcement: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase`
