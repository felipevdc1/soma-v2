# Claude Adapter — Bootloader

Source: PLAN.md §4.2 (literal). Initially same as Codex bootloader.md — Phase 5 may diverge them.

## Responsibilities

1. Detect whether the current project has `.soma/`.
2. If yes, read `.soma/CONTEXT.md` and the relevant module docs.
3. If no, use lightweight global SOMA behavior and optionally suggest `soma init`.
4. Use the compressed loop for small tasks.
5. Escalate to the 10-step protocol for medium/large/risky work.
6. Never claim done without evidence.

## Non-responsibilities

- Do not embed the full 10-step protocol inline.
- Do not duplicate all SOMA docs.
- Do not carry project-specific knowledge globally.
