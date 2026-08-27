# T-LEAN-13 — Author implementation plan

Documentation-only planning task. Do not edit production code/tests/install state or `.soma/`.

Read the complete approved spec:
`docs/superpowers/specs/2026-08-27-claude-session-identity-export-design.md`

Inspect the exact current hook, helper, request validator, install targets, manifests and relevant test conventions. Write a complete executable plan at:
`docs/superpowers/plans/2026-08-27-claude-session-identity-export.md`

Follow the `writing-plans` format: required header, checkbox steps, exact file paths/functions, concrete test code or precise assertions, exact commands and expected RED/GREEN outputs, minimal implementation shape, scoped commits, and no placeholders. Keep scope to the approved existing-hook design.

Plan tasks must cover, in order:
1. Focused RED tests for AC-01..AC-05, including validator parity and injection corpus.
2. Minimal `session-init.cjs` implementation before fallible work, then focused GREEN.
3. Fake-home install parity/idempotence and zero-model `claude --init-only` proof for AC-06..AC-07 without global activation.
4. Bounded affected regression/full deterministic verification, independent spec and quality review on one immutable candidate.
5. One transactional global install and exactly one interactive `/soma-run --help` + subagent proof for AC-08, with rollback/stop rules.

Do not plan runtime fallback, new hook, unmanaged settings cleanup, mailbox changes, repeated smoke, or unrelated refactors. Self-review spec coverage, placeholders and type/signature consistency. Commit only the plan. Return <=2000 bytes with path, commit SHA, task count and self-review result.
