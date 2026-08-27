# T-LEAN-12 — Author approved Claude session identity design

Documentation-only task. Do not modify production code, tests, install state, or `.soma/`.

Write `docs/superpowers/specs/2026-08-27-claude-session-identity-export-design.md` from the approved design and commit only that spec.

Required normative content:
- Problem evidence: interactive and `claude -p` discover `/soma-run`, zero permission denial, but native prepare fails `INVALID_SESSION_ID` because Bash lacks `CLAUDE_SESSION_ID`.
- Chosen architecture: extend existing `core/hooks/session-init.cjs`; validate SessionStart `data.session_id` with the exact runtime predicate and append an export to `CLAUDE_ENV_FILE` before fallible work.
- Preserve fail-closed behavior: invalid/missing ID or absent env file never invents identity; emit stable nonblocking diagnostic.
- Lifecycle: startup/resume/clear/compact; resume preserves Claude-provided identity, clear uses new input, compact re-exports current input. `claude -p` supported through SessionStart. Subagents are an explicit proof requirement, not an unverified claim.
- Security: hook input is authority; model/PID/cwd/time/transcript inference forbidden; validation makes shell export safe; stale export must be overridden; duplicate identical hook invocations must be harmless.
- Scope exclusions: no new hook, no runtime fallback, no cleanup of unmanaged duplicate settings entries in this change.
- Acceptance criteria numbered and testable: RED hook-to-env propagation, validator parity/injection corpus, stale/duplicate export semantics, env-file absence, entry native prepare/abort integration, fake-home install parity/idempotence, zero-model init proof, then one bounded interactive `/soma-run --help` smoke with no permission denial and HELP_SHOWN.
- Rollback and continuity impact.

Self-review for placeholders, contradictions, ambiguity and scope. Commit with a focused docs message. Return <=2000 bytes: spec path, commit SHA, self-review result, and any unresolved decision.
