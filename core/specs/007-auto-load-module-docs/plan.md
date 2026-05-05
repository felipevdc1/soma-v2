# Plan: Auto-Load Module Docs Primitive (C-1 Option A)

**Feature ID:** 007-auto-load-module-docs
**Spec:** `specs/007-auto-load-module-docs/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

C-1 Option A ships an extension to `~/.claude/hooks/subagent-init.cjs` (Phase 2 base, 465L) that auto-loads relevant `.soma/modules/{slug}.md` content into spawned agent system prompts based on keyword matching against per-project `.soma/CONTEXT.md` routing table. A new helper `~/.claude/hooks/lib/auto-load-modules.cjs` encapsulates CONTEXT.md parsing, keyword matching (case-insensitive substring per D1), candidate scoring, status/layer filtering (D6 active-only; D4 roots>trunk>leaves alphabetical), token-budget enforcement (D2/D3 — 2 modules max, 5KB cap, truncate-to-1 on exceed), and markdown-delimited injection formatting (D5). Existing `~/.soma-v2/scripts/lib/module-store.cjs::parseFrontMatter` (Phase 4c, shasum-locked) is reused via `require` for module front-matter parsing. `~/.soma-v2/scripts/doctor.cjs` gains `--check-context-routing` flag (per AC-13/AC-14) that validates each routing entry's keyword→slug ref points to an existing active module, emitting `BROKEN_CONTEXT_ROUTING` warning findings (D7 non-blocking). Defensive failure mode (D8): hook errors during auto-load do NOT block dispatch — failures degrade silently with stderr log; auto-load is optimization, not critical path.

**Stack:**
- Runtime: Node.js v22 (matches Phase 2/3/4* convention)
- Framework: vanilla CommonJS `.cjs` (D7 from Phase 2: zero npm deps, stdlib only)
- Storage: filesystem only (`.soma/CONTEXT.md`, `.soma/modules/`)
- Test runner: `node:test` + `node:assert/strict`
- Hook ecosystem: Claude Code hooks (existing `~/.claude/hooks/subagent-init.cjs` PreSubagentSpawn-style flow)

**Rationale:** Same shasum-lock discipline. Reuse existing subagent-init.cjs base (Phase 2 already injects Constitution + FAMILY_DOC + Spec AC into child agents — auto-load is additive injection in same pattern). New `lib/auto-load-modules.cjs` follows established `~/.claude/hooks/lib/` pattern (siblings: `ck-config-utils.cjs`, `ck-paths.cjs`, `context-tracker.cjs`). Doctor extension is well-trodden (Phase 2/4c/4d/4d-bis extended doctor.cjs successfully).

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** Extend existing `~/.claude/hooks/subagent-init.cjs` (NOT new hook) | Pattern continuation — Phase 2 already added Constitution/FAMILY_DOC/Spec AC injection to this hook. Auto-load is conceptually same: pre-spawn context enrichment for child agent. | New hook file `auto-load-modules-hook.cjs`. Rejected: hook fragmentation; harder to reason about hook execution order. |
| **AD-02:** New helper `~/.claude/hooks/lib/auto-load-modules.cjs` (NEW lib in hooks/lib/) | Single-responsibility: CONTEXT.md parsing + keyword matching + scoring + filtering + injection formatting. Follows existing `hooks/lib/` pattern (siblings ck-config-utils/ck-paths/context-tracker). | Inline in subagent-init.cjs. Rejected: would balloon subagent-init.cjs; harder to unit-test logic in isolation. |
| **AD-03:** Per-project `.soma/CONTEXT.md` location (D6) | Project-scoped routing aligns with `.soma/modules/` per-project pattern; agents working on project A don't accidentally load project B's modules. | Global `~/.soma-v2/CONTEXT.md`. Rejected: cross-project leakage risk; Phase 5+ if demand surfaces. |
| **AD-04:** Reuse Phase 4c `module-store.cjs::parseFrontMatter` via require (NOT copy/inline) | Single source of truth for front-matter parsing; preserves shasum baseline (`module-store.cjs` not modified). Cross-package reuse via Node `require()` of absolute path. | Copy parseFrontMatter into hooks/lib/auto-load-modules.cjs. Rejected: divergence risk; Phase 4c lib is canonical. |
| **AD-05:** Doctor extension `--check-context-routing` (NOT new doctor command) | doctor.cjs is the established health surface (Phase 2/4c/4d). Routing validation is health check semantically. Continues additive flag pattern. | New `~/.soma-v2/scripts/context.cjs` CLI. Rejected: command surface fragmentation. |
| **AD-06:** Token budget enforcement at byte-level (UTF-8 string length) (NOT token-aware) | Simpler MVP; bytes are deterministic; token-counting requires LLM-specific tokenizer (Claude vs GPT differ). 5KB UTF-8 ≈ 1.25K tokens for typical Latin text — reasonable proxy. | tiktoken/anthropic tokenizer integration. Rejected: introduces dep + LLM-coupling. |
| **AD-07:** Defensive failure mode (D8) — hook errors degrade silently | Auto-load is optimization, not critical path. Hook crash should NOT block dispatch — agents work fine without auto-loaded modules (just less context). Stderr log preserves audit trail. | Hard fail — abort dispatch on hook error. Rejected: brittle UX; one CONTEXT.md typo blocks all dispatches. |
| **AD-08:** D8 research-first directive — Sonnet validates pattern empirically | `~/.claude/hooks/subagent-init.cjs` is 465L Phase 2 code. Sonnet reads it BEFORE implementing extension to confirm injection point exists for auto-load (vs only Constitution/FAMILY_DOC) AND that PreSubagentSpawn lifecycle supports stdout-based prompt extension. If pattern unsupported → REPORT partial. | Implement blind without research. Rejected: failure mode #1 (assumed understanding). |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — extends `~/.claude/hooks/subagent-init.cjs` (1 file modified) + adds `~/.claude/hooks/lib/auto-load-modules.cjs` (1 NEW lib) + extends `~/.soma-v2/scripts/doctor.cjs` (1 file modified, additive flag). + 1 NEW template `~/.soma-v2/templates/project/.soma/CONTEXT.md.tmpl`. Total: 3 code components touched (excluding template). ≤3 ✓
- [x] **Anti-Abstraction Gate** — uses node stdlib (`fs`, `path`, `crypto`) directly. New `auto-load-modules.cjs` is pure-function module (no class). Reuses `module-store.cjs::parseFrontMatter` (Phase 4c) via require — no wrapper layer.
- [x] **Integration-First Gate** — all tests via tmp project dir + `child_process.spawnSync` against real fs + real subagent-init.cjs invocation. Zero mocks. TDD HARD per Article II + C-2 (`SOMA_RED_PHASE_STRICT=1`).

All gates **PASS**.

---

## Complexity Tracking

(No gate violations; section blank.)

---

## Dependencies

- Node.js v22 stdlib only (`fs`, `path`, `crypto`)
- Existing read-only libs (shasum-locked):
  - `~/.soma-v2/scripts/lib/anchored-blocks.cjs`
  - `~/.soma-v2/scripts/lib/manifest.cjs`
  - `~/.soma-v2/scripts/lib/template-engine.cjs`
- Existing libs to REUSE via require (NOT modify):
  - `~/.soma-v2/scripts/lib/module-store.cjs` (Phase 4c, parseFrontMatter)
  - `~/.soma-v2/scripts/lib/foundation-check.cjs` (Phase 4d, resolveModuleLayer)
- Existing hook to EXTEND:
  - `~/.claude/hooks/subagent-init.cjs` (Phase 2 base, 465L, currently injects Constitution + FAMILY_DOC + Spec AC)
- New components:
  - `~/.claude/hooks/lib/auto-load-modules.cjs` (NEW helper)
  - `~/.soma-v2/templates/project/.soma/CONTEXT.md.tmpl` (NEW template for `soma init`)
- Validator: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase` (post-C-2 strict mode)

---

## References

- Contracts: `contracts/auto-load-module.md`
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles II (TDD HARD), III (Integration-First), V (Read-Only — auto-load hook is read-only), VII (Simplicity)
- Spec: `spec.md` Resolved Decisions D1-D8 (all Bruno-style "lock all" ratifications)
- Phase 2 hook baseline: `~/.claude/hooks/subagent-init.cjs` (465L)
- Phase 4c lib reuse: `~/.soma-v2/scripts/lib/module-store.cjs::parseFrontMatter`
- Phase 4d lib reuse: `~/.soma-v2/scripts/lib/foundation-check.cjs::resolveModuleLayer`
- C-1 Option B (deferred Phase 5+): `${CLAUDE_HOME}/projects/{user}/memory/project_soma_executor.md` §"C-actions roadmap" → C-1 entry
- C-2 enforcement: `~/.claude/hooks/spec-test-traceability.cjs::validateRedPhase`
