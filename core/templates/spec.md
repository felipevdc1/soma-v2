# Spec: {FEATURE_TITLE}

<!-- guidance: Fill every {PLACEHOLDER}. Replace [NEEDS CLARIFICATION: ...] only when you have a real answer from the human. Never assume. -->

**Feature ID:** {NNNN-slug}
**Branch:** `{branch-name}`
**Created:** {YYYY-MM-DD}
**Status:** DRAFT | AWAITING_APPROVAL | APPROVED

---

## User Stories

<!-- guidance: Minimum 1. Format: "Como <user>, quero <action>, pra <outcome>" -->

- Como {user}, quero {action}, pra {outcome}.

---

## Acceptance Criteria

<!-- guidance: Every AC must be testable: "Given X, when Y, then Z". No implementation details. No HOW — only WHAT and WHY. -->

- **AC-01:** Given {context}, when {trigger}, then {observable result}.
- **AC-02:** Given {context}, when {trigger}, then {observable result}.
<!-- Add more ACs as needed. Every AC must have a corresponding test in Step 5. -->

---

## Non-Functional Requirements

<!-- guidance: List explicitly. At minimum: performance SLO, security constraints, test style (integration/unit/contract), monitoring expectations. -->

- **Performance:** {SLO — e.g., p95 < 200ms under 100 rps}
- **Security:** {constraints — e.g., no user data logged, auth required}
- **Test style:** {e.g., integration tests use real SQLite; no DB mocks}
- **Monitoring:** {e.g., error rate alert at 1% on /api/foo}

---

## Out of Scope

<!-- guidance: Explicit "will not" list prevents scope creep. Write at least one entry. -->

- {Explicitly excluded functionality — e.g., "Pagination not in scope for v1"}

---

## Open Questions

<!-- guidance: NEVER assume. Mark every ambiguity. Loop ends when this section is empty. -->

- [NEEDS CLARIFICATION: {specific question about ambiguity}]

---

## Completeness Checklist

<!-- guidance: All boxes must be checked (or replaced with [NEEDS CLARIFICATION]) before Gate 1. -->

- [ ] Every AC is testable (Given/When/Then, observable, not implementation)
- [ ] No implementation details leaked into AC (no HOW, only WHAT)
- [ ] Zero `[NEEDS CLARIFICATION]` markers remaining
- [ ] NFR section has at least: performance SLO, security constraints, test style
- [ ] Out of Scope section has at least one entry
- [ ] Feature ID + Branch filled in
