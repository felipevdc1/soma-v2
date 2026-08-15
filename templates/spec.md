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

## Outcome & Guardrails

<!-- guidance: v3 Fase 1 (D3). Se existe um brief.md gerado por /elicit, estes campos vêm DELE —
     não reescreva, transcreva. Se não existe brief e você não tem a resposta, marque
     [NEEDS CLARIFICATION] em vez de inventar. Estes 3 campos são o guardrail de escopo da feature:
     o OUTCOME diz quando parar, o APPETITE diz quanto gastar, os NO-GOS dizem o que recusar. -->

**OUTCOME** — como o usuário SABE que deu certo, em comportamento observável (não em feature):
{ex: "Eu rodo o comando e vejo o resumo do mês sem abrir a planilha" — não "tem um dashboard"}

**APPETITE** — quanto vale investir nisto (orçamento, não estimativa):
{ex: "2 dias. Se passar disso, corta escopo, não estende o prazo."}

**NO-GOS** — o que esta feature explicitamente NÃO vai fazer (mínimo 2):
- {ex: não suporta multi-usuário}
- {ex: não substitui o fluxo manual atual, roda ao lado}

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
- [ ] OUTCOME/APPETITE/NO-GOS preenchidos (ou marcados N/A com justificativa)
