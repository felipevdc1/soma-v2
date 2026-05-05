# Plan: Foundation Primitive (Phase 4d)

**Feature ID:** 006-foundation-primitive
**Spec:** `specs/006-foundation-primitive/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

Phase 4d ships Bruno's "fundação sólida" 9-criterion verifier as a `--foundation-check` extension to `~/.soma-v2/scripts/doctor.cjs` (already Phase 2 + 4c extended). A new helper `scripts/lib/foundation-check.cjs` encapsulates the 9 individual criterion verifiers (each pure-function with pass/fail/skipped semantics) plus orchestration of subprocess-based criteria (test/build/typecheck/lint via `spawnSync` shell:false). `.soma/project.md` schema gains 8 new optional fields (`foundation_layers`, `expansion_layers`, `decisions`, `tech_stack`, `test_command`, `build_command`, `typecheck_command`, `lint_command`) — lenient backward compat (D6: legacy projects without these fields → warning + skip foundation-check). Module front-matter gains optional `layer: roots|trunk|leaves` field (default `leaves`). `--gate` mode emits rhetorical "fundação sólida o suficiente?" line + binary exit code (D7). Bruno P6 binary all-9 enforcement (D4) — no weighted scoring.

**Stack:**
- Runtime: Node.js v22 (matches Phase 2/3/4a/4b/4c)
- Framework: vanilla CommonJS `.cjs` (D7 from Phase 2: zero npm deps, stdlib only)
- Storage: filesystem only (`.soma/project.md`, `.soma/modules/{slug}.md`)
- Test runner: `node:test` + `node:assert/strict`
- Subprocess: `child_process.spawnSync` with `shell: false` (Security NFR — command injection prevention)

**Rationale:** Same shasum-lock discipline (canonical+lib preserved). Reuse Phase 2/4c doctor.cjs as orchestrator host (no new top-level command — `doctor --foundation-check` is the natural surface). New `lib/foundation-check.cjs` follows established single-responsibility helper pattern (anchored-blocks/manifest/template-engine/snapshot/module-store all single-responsibility). Front-matter parsing reuses `module-store.cjs` regex parser (Phase 4c) — no YAML lib introduction.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** Extend `doctor.cjs` (NOT new `foundation.cjs` orchestrator) | `--foundation-check` is naturally a doctor extension (project health check). Forking new command adds CLI surface w/ marginal benefit; doctor is the established health surface. | New `scripts/foundation.cjs`. Rejected: command surface fragmentation. |
| **AD-02:** New helper `scripts/lib/foundation-check.cjs` (NEW lib, untouched existing 4 — anchored-blocks/manifest/template-engine/snapshot/module-store) | Single-responsibility per AD pattern. 9 criterion verifiers + shared orchestration. Allows unit testing each criterion in isolation. | Inline in doctor.cjs. Rejected: balloons doctor.cjs to 700+ LOC; harder to test criteria. |
| **AD-03:** Bruno binary all-9 enforcement (D4 lock) | Per Bruno P6 "crescer limpo até base estar forte" — categórico. ANY criterion fail = foundation NOT done in `--gate` mode. Aligned with spec philosophy. | Weighted scoring (≥7/9 acceptable). Rejected: re-introduces "kinda done" pattern this spec exists to prevent. |
| **AD-04:** Lenient legacy state (D6 lock) — projects without `foundation_layers` → warning + skip | Gateway pattern facilita migração de projetos pré-Phase-4d. Warning loud garante user awareness sem block. Strict abort = barreira artificial. | Hard abort PROJECT_NOT_PHASE_4D_READY. Rejected: friction outweighs marginal safety. |
| **AD-05:** All command fields explicit in project.md (D5) — NO auto-detect | Bruno P6 explicit cleanup pattern. Auto-detect (npm test / npm run build / etc) = silent assumption (anti-pattern). User opt-in keeps intentionality. | Auto-detect from package.json or common conventions. Rejected: silent magic = drift surface. |
| **AD-06:** spawnSync with `shell: false` mandatory (Security NFR) | Command injection prevention. User-provided test_command/build_command/etc treated as argv arrays (split on whitespace) OR rejected if contain shell metacharacters (`;`, `&`, `|`, `$`, backticks). | shell: true with escaping. Rejected: escaping is fragile; argv array is bulletproof. |
| **AD-07:** Front-matter schema migration backward-compat (D6 alignment) | New fields are optional; existing project.md files continue to work. No version bump (still soma-project/v1) — fields are additive within v1 schema's "extensible" clause. | Schema version bump to v1.1. Rejected: complicates migration; v1 was designed extensible. |
| **AD-08:** Layer enum strict {roots, trunk, leaves} (D3) | Bruno P6 ontology fixed 3 layers. Custom layer names dilute concept. Custom layers Phase 5+ if demand. | Free-form string. Rejected: ontology drift. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — extends 1 existing file (doctor.cjs) + adds 1 NEW helper lib (foundation-check.cjs). Module template + project.md schema migration are documentation-only (no code). Total: 2 components touched. ≤3 ✓
- [x] **Anti-Abstraction Gate** — uses node stdlib (`fs`, `path`, `crypto`, `child_process`, `os`) directly. New `foundation-check.cjs` is pure-function module (9 verifiers, no class hierarchy). Front-matter parsing reuses Phase 4c `module-store.cjs` regex.
- [x] **Integration-First Gate** — all tests via tmp project dir + `child_process.spawnSync` against real fs + real subprocesses. Zero mocks. TDD HARD per Article II + C-2 (`SOMA_RED_PHASE_STRICT=1`).

All gates **PASS**.

---

## Complexity Tracking

(No gate violations; section blank.)

---

## Dependencies

- Node.js v22 stdlib only (`fs`, `path`, `crypto`, `child_process`, `os`)
- Existing read-only libs (shasum-locked):
  - `~/.soma-v2/scripts/lib/anchored-blocks.cjs`
  - `~/.soma-v2/scripts/lib/manifest.cjs`
  - `~/.soma-v2/scripts/lib/template-engine.cjs`
- Phase 4c deliverables (extend, not modify):
  - `~/.soma-v2/scripts/doctor.cjs` (extend with --foundation-check flag)
  - `~/.soma-v2/scripts/lib/module-store.cjs` (reuse front-matter parser)
  - `~/.soma-v2/templates/project/.soma/modules/module.md.tmpl` (extend with optional `layer` field)
- Phase 4b deliverable (untouched):
  - `~/.soma-v2/scripts/sync.cjs` + `lib/snapshot.cjs`
- Validator: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase` (post-C-2 strict mode)

---

## References

- Contracts: `contracts/foundation-check.md`
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles II (TDD HARD), III (Integration-First), V (Read-Only — thermal-guard exempt), VII (Simplicity)
- Spec: `spec.md` Resolved Decisions D1-D7 (all Bruno-style ratifications)
- Bruno P6: memory `project_soma_executor.md` §"Bruno material integration" (8-item fundação checklist + crescer-limpo ladder)
- Phase 4c baseline: `~/.soma-v2/specs/005-soma-module-cookbook/` (doctor extension precedent, module front-matter precedent)
- C-2 enforcement: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase`
