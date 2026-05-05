# SOMA v2.1 — Internal Design History

This directory contains the original specifications used during SOMA v2.1's development. They serve as **internal design history and architectural rationale**, not user-facing documentation.

If you're looking for how to USE SOMA, see:
- `~/.soma-v2/docs/onboarding.md` (post-install)
- Top-level `README.md` and `docs/QUICKSTART.md`

The 12 specs below trace the empirical journey from MVP to v2.1:

- `001-soma-doctor-sync-cli` — initial doctor + sync CLI primitives
- `002-soma-init` — bootstrap project workflow
- `003-soma-init-existing` — module inference for existing repos
- `004-soma-sync-apply` — write-mode adapter injection
- `005-soma-module-cookbook` — cookbook lifecycle commands
- `006-foundation-primitive` — Bruno's 8-item fundação binary gate
- `007-auto-load-module-docs` — context routing automation
- `008-soma-bootstrap` — CLI entry-point primitive
- `009-adapter-skeletons` — multi-harness adapter framework (cursor/aider/chatgpt-desktop)
- `010-capture-defer-gate` — Article XI Layer 3 hook
- `011-phase5-codex-claude-install` — operational install across adapters
- `012-soma-audit-cli-primitive` — Article XII (c) δ enforcement layer

Reading order: 001 → 012 chronologically traces decisions. Each spec includes `spec.md`, `plan.md`, `contracts/`, and `tasks.md` per SDD methodology.
