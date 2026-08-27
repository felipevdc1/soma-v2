# T-LEAN-17 — Neutralize stale Claude session identity

## Context

Worktree: `/Users/felipevdc1/Documents/Codex/2026-08-24/soma-efficient-orchestration-budget`
Base/candidate to correct: `33ec3ff721abc316896bbbeb20e6b5268053c1b3`
Run: `run-260825-universal-entry-7f3c2a`
Diagnostic: `.soma/diagnostics/run-260825-universal-entry-7f3c2a-session-identity-stale-invalid.json`
Canonical design: `docs/superpowers/specs/2026-08-27-claude-session-identity-export-design.md`

This is a fresh bounded correction unit with one executor. Do not install globally, change user settings, start Claude, touch `.soma/`, or broaden the hook topology.

## Required behavior

`session_id` from SessionStart remains the only authority. If the current hook input is missing or fails the exact native runtime validator, a prior `CLAUDE_SESSION_ID` in `CLAUDE_ENV_FILE` must not remain effective after the hook. Neutralization must be constant, shell-safe, deterministic, idempotent, and must not create an alternate identity.

Preserve all already-approved behavior:

- a valid current identity becomes the final effective value;
- invalid/missing identity emits the existing exact diagnostic and exits nonblocking;
- invalid/missing identity never reaches `CK_SESSION_ID`, temp state, mailbox, fallback, or native prepare;
- lifecycle sources `startup|resume|clear|compact` keep parity;
- installer source/target/manifest parity remains intact;
- no PID/cwd/time/generated identity fallback.

If the env file is unavailable or the neutralization write fails, keep the existing deterministic nonblocking diagnostic behavior; do not invent success. Tests must distinguish that residual from successful neutralization.

## TDD contract

1. Confirm HEAD is exactly `33ec3ff721abc316896bbbeb20e6b5268053c1b3` and worktree tracked changes are clean. Preserve untracked `.soma/` and coordinator contract files.
2. Add focused tests that load/evaluate the final effective environment, not merely count export lines:
   - stale valid value + current invalid identity => no effective `CLAUDE_SESSION_ID`;
   - stale valid value + missing current identity => no effective `CLAUDE_SESSION_ID`;
   - cover at least `clear` and one of `resume|compact`;
   - duplicate invocations remain final-value correct: invalid/missing neutralizes; later valid restores the exact value; later invalid neutralizes again;
   - no `CK_SESSION_ID` or `ck-session-*` residue in each invalid/missing case.
3. Run the new focused selectors against `33ec3ff` and record the expected RED identities/count. Do not weaken existing assertions.
4. Implement the smallest production correction in the existing `core/hooks/session-init.cjs`. Use a constant shell operation or existing safe primitive; never interpolate invalid input into shell text.
5. Run focused identity tests, the 86-test affected matrix from the plan, installer parity/idempotence checks, syntax checks and `git diff --check`.
6. Inspect the exact diff for unrelated changes. Commit only tracked source/tests with message `fix: neutralize stale Claude session identity`.

## Acceptance criteria

- AC-17.1: RED proves stale+invalid and stale+missing survive before the fix.
- AC-17.2: GREEN proves neither remains effective after the hook.
- AC-17.3: valid/invalid duplicate ordering has last-authoritative-event semantics.
- AC-17.4: invalid/missing creates no legacy identity or temp residue.
- AC-17.5: valid lifecycle/native prepare behavior does not regress.
- AC-17.6: installer parity/idempotence and unmanaged-setting preservation do not regress.
- AC-17.7: change is restricted to hook/tests required for this correction; no global activation.

Return <=3500 bytes: commit SHA, exact changed files, RED proof, GREEN commands/counts, direct effective-env proof, diff scope, residuals and blockers. Do not claim live startup/subagent proof.
