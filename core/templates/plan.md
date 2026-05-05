# Plan: {FEATURE_TITLE}

<!-- guidance: Technical HOW. Never restate spec WHAT. Plan serves spec — if plan contradicts spec, fix plan. Read spec.md + constitution.md before writing. -->

**Feature ID:** {NNNN-slug}
**Spec:** `specs/{NNNN-slug}/spec.md`
**Created:** {YYYY-MM-DD}
**Status:** DRAFT | APPROVED

---

## Technical Approach

<!-- guidance: High-level architecture. No code. Reference contracts/, research.md, quickstart.md. -->

{Describe the approach in 3-5 sentences: what components are involved, how data flows, what the integration boundary is.}

**Stack:**
- Runtime: {e.g., Node 20 / Python 3.12}
- Framework: {e.g., Hono / FastAPI — used directly, no wrappers}
- Storage: {e.g., SQLite via better-sqlite3 / Postgres}
- Test runner: {e.g., Vitest / pytest}

**Rationale:** {Why this stack over alternatives. Link to research.md for details.}

---

## Architecture Decisions

<!-- guidance: Key decisions only. Each must have a rationale and an alternative considered. Use ADR-lite format. -->

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| {Decision 1} | {Why} | {Alt + why rejected} |
| {Decision 2} | {Why} | {Alt + why rejected} |

---

## Phase -1 Gates

<!-- guidance: Constitution Article III (Integration-First) and Article VII (Simplicity). Gates MUST be checked before this plan is marked approved. Violation without rationale = plan is blocked. -->

- [ ] **Simplicity Gate** — ≤3 new projects/components (Article VII)
- [ ] **Anti-Abstraction Gate** — framework used directly, no custom wrappers (Article VII)
- [ ] **Integration-First Gate** — tests use real DB / real services, not mocks (Article III)

---

## Complexity Tracking

<!-- guidance: If any Phase -1 gate is OFF, document rationale here. "Might need it later" is NOT a valid rationale. Rationale must reference an AC. -->

| Gate violated | Reason (must ref AC-XX) | Revisit trigger |
|---|---|---|
| {gate} | {rationale} | {when to reconsider} |

---

## Dependencies

<!-- guidance: External packages, services, or tools this feature requires. Pin versions where possible. -->

- `{package@version}` — {why needed}

---

## References

<!-- guidance: Point to artifacts that informed this plan. Do not duplicate content from them. -->

- Contracts: `contracts/` (see `contracts/` directory in this feature folder)
- Research: `research.md`
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles I, III, VII
