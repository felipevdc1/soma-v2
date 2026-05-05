# Cursor Adapter — Bootloader

Source: PLAN.md §4.2 (literal).

## Responsibilities

1. Detect whether the current project has `.soma/` and load `.soma/CONTEXT.md` via extension-loaded behavior into active IDE context.
2. Read `.cursor/rules.md` surface (or equivalent Cursor rules file) to determine which SOMA modules are active for the project.
3. If `.soma/` is present, resolve module docs from `.soma/modules/` and surface relevant context inline during code generation and autocomplete.
4. Route work through the fast-path autocomplete branch for small isolated tasks, escalating to deep-thinking branches for medium/large/risky work per SOMA step protocol.
5. Never claim a task complete without verifiable evidence in the IDE diff view.

## Non-responsibilities

- Do not embed the full SOMA 10-step protocol inline in the rules file.
- Do not duplicate canonical SOMA_HOME docs — read from `.soma/` project copies only.
- Do not carry project-specific state across unrelated workspaces.
