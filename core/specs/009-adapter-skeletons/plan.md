# Plan: Adapter Skeletons — Cursor / Aider / ChatGPT-desktop

**Feature ID:** 009-adapter-skeletons
**Spec:** `specs/009-adapter-skeletons/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

Sprint 009 é pure artifact creation: 3 new adapter folders (`cursor/`, `aider/`, `chatgpt-desktop/`) sob `~/.soma-v2/adapters/`, cada uma com 2 files (`install-targets.json` schema-conformant + `bootloader.md` mirror-codex-pattern). Zero code changes em `scripts/`, `lib/`, ou hooks — Sprint 008 já expôs `enumerateAdapters()` em bootstrap.cjs e doctor.cjs já enumera adapters via existing reader. Single new test file `~/.soma-v2/scripts/__tests__/adapter-skeletons.test.cjs` valida estrutural conformance per CONTRACT-ADAPTER-SKELETON-01 (folder existence, JSON schema, bootloader structure, kebab-case naming, integration.md absence). Validation run via `soma doctor` + `soma bootstrap` confirma adapter ecosystem reads sem error + bootstrap output `adapters[]` cresce 2 → 5 entries.

**Stack:**
- Runtime: Node.js v22 (test file only)
- Framework: vanilla CommonJS `.cjs` (D7 from Phase 2)
- Storage: filesystem only (markdown + JSON files)
- Test runner: `node:test` + `node:assert/strict`

**Rationale:** Smallest sprint scope to date (post-Phase 4d). Pure artifact = zero new code paths to test in unit-style; structural assertions cobrem 100% of contract conformance. Reuse Sprint 008 bootstrap output for AC-08 cross-spec integration validation.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** Adapter folder content authored manually (NOT generated programmatically) | 3 adapters × 2 files = 6 files. Hand-authored ensures wording adaptation per tool nature (D2 lock). Generator wouldn't know tool-specific framing. | Write `scripts/scaffold-adapter.cjs` generator. Rejected: YAGNI — zero adapters in queue beyond these 3; generator costs more than it saves. |
| **AD-02:** Single test file `adapter-skeletons.test.cjs` (NOT per-adapter test files) | Tests are parameterized over adapter list (`['cursor', 'aider', 'chatgpt-desktop']`). DRY validation logic. ≥10 tests via 5 assertions × 3 adapters + cross-cutting tests. | 3 separate test files (one per adapter). Rejected: code duplication; harder maintenance when contract evolves. |
| **AD-03:** install-targets.json `entries: []` empty MVP (D1 lock) | Real `target_path` research deferred Phase 5+. Empty array still validates schema-conformant per AC-04. Mirrors `claude/install-targets.json` precedent (entries: []). | Pre-populate with researched paths. Rejected: D1 lock; speculative without runtime testing per tool. |
| **AD-04:** bootloader.md hand-written per tool (D2 lock) | Each tool's nature differs (Cursor IDE / Aider CLI / ChatGPT desktop chat). Wording must reflect primary use mode. Structural mirror of codex/bootloader.md pattern preserved. | Copy-paste codex/bootloader.md verbatim into each. Rejected: wording would lie about tool behavior. |
| **AD-05:** Test resilience via parameterization (D5 lock) | Test loops over `NEW_ADAPTERS = ['cursor', 'aider', 'chatgpt-desktop']` array — adding 4th adapter Phase 5+ adds 1 line in array, all assertions auto-extend. | Hardcoded test file per adapter. Rejected: maintenance burden grows linearly with adapter count. |
| **AD-06:** Zero code changes em `scripts/`, `lib/`, hooks (D4 lock) | Sprint 008 bootstrap.cjs already exposed `enumerateAdapters()` reading `~/.soma-v2/adapters/*` filesystem; doctor.cjs already iterates adapters folder. Sprint 009 just adds 3 dirs the existing readers find. | Extend doctor.cjs to validate per-adapter schema strictness. Rejected: doctor.cjs already does this generically; specific adapter validation = test responsibility (AC-09). |
| **AD-07:** Sprint 009 ships ZERO write-mode operations on `~/.soma-v2/canonical files` (Cláusula B HARD reaffirmed) | AC-11 + shasum baseline diff confirms zero canonical mod. Adapter folder writes are NEW dir creation, not canonical mod. | N/A — Cláusula B is constitutional, no alternative. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — adds 6 NEW artifact files (3 adapter dirs × 2 files) + 1 NEW test file. Total: 7 file additions, 0 modifications. Zero new components (no .cjs scripts, no libs). Far below ≤3 component threshold ✓
- [x] **Anti-Abstraction Gate** — all artifacts are static markdown + JSON. Test file uses `fs` + `path` + `node:test` directly. No wrappers, no factories.
- [x] **Integration-First Gate** — tests use real `~/.soma-v2/adapters/` filesystem reads (no mocks). Cross-cutting validation via real `soma bootstrap --quiet` invocation.

All gates **PASS**.

---

## Complexity Tracking

(No gate violations; section blank.)

---

## Dependencies

**External packages:** none

**Internal dependencies:**
- `~/.soma-v2/scripts/bootstrap.cjs` (Sprint 008) — `enumerateAdapters()` reads adapters folder; AC-08 cross-spec integration test uses this
- `~/.soma-v2/scripts/doctor.cjs` (Phase 2/3/4 + 4d) — adapter enumeration unchanged; AC-07 confirms zero ERROR findings
- `~/.soma-v2/adapters/codex/` — pattern reference for new bootloader.md authoring (read-only)
- `~/.soma-v2/adapters/claude/` — pattern reference for `entries: []` empty array MVP (read-only)
- `~/.soma-v2/docs/adapter-contract.md` — D-C11 Adapter Contract source of truth (5 cláusulas)

---

## References

- Spec: `specs/009-adapter-skeletons/spec.md`
- Contracts: `contracts/adapter-skeleton.md` (CONTRACT-ADAPTER-SKELETON-01)
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles I (Spec as truth), III (Integration-First), VII (Simplicity)
- Adapter Contract: `~/.soma-v2/docs/adapter-contract.md` (D-C11, 5 cláusulas)
- Memory: `project_soma_executor.md` §"v2.1 Phase 4 SHIPPED" + Sprint 008 cumulative
