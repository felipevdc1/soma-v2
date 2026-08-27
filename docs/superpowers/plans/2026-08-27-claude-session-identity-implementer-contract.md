# T-LEAN-14 — Implement Claude SessionStart identity export

You are the implementation owner. Work only in this worktree. Own code, tests and Git commit. Preserve `.soma/` and unrelated untracked plan files. Do not globally install, edit user settings, invoke a Claude model, or clean unmanaged duplicate hooks.

Base: `a23ac1c`. Approved spec: `docs/superpowers/specs/2026-08-27-claude-session-identity-export-design.md`.

## Required TDD behavior

1. Create `core/hooks/__tests__/session-init-identity.test.cjs` as a black-box `node:test` harness around the real `core/hooks/session-init.cjs`.
2. Before production edits, run the new test and record an expected RED caused by the missing export—not harness errors.
3. Cover:
   - `startup`, `resume`, `clear`, `compact` propagation through `CLAUDE_ENV_FILE`, sourced by `/bin/sh`;
   - hook acceptance/rejection parity with runtime `isSessionId`, including valid edge lengths and injection corpus;
   - stale export overridden by current hook input; three identical invocations remain shell-equivalent;
   - missing env file and missing/invalid identity exit 0, append nothing, use exact stable diagnostics and create no fallback;
   - hook-produced environment drives real `entry native prepare` then abort with no mailbox residue.
4. Implement the minimum source change in `core/hooks/session-init.cjs`:
   - exact regex `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`;
   - validate hook `data.session_id` and append `CLAUDE_SESSION_ID` through existing `writeEnv`;
   - execute immediately after input/env parsing and before `loadConfig` or any fallible work;
   - invalid ID diagnostic: `SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID`;
   - missing env diagnostic: `SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=CLAUDE_ENV_FILE_MISSING`;
   - append failure diagnostic: `SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=ENV_WRITE_FAILED`;
   - remain nonblocking and continue existing hook behavior; never infer fallback.
5. Run focused GREEN and affected baseline:

```bash
node --test core/hooks/__tests__/session-init-identity.test.cjs
node --test core/hooks/__tests__/session-init-identity.test.cjs core/scripts/__tests__/entry-cli.test.cjs core/scripts/__tests__/entry-mailbox.test.cjs core/scripts/__tests__/entry-resume-lean.test.cjs core/scripts/__tests__/universal-entry-lean-adapter.test.cjs core/scripts/__tests__/universal-entry-lean-e2e.test.cjs
```

6. Prove install target/source parity and managed SessionStart idempotence with existing fake-home coverage. Add only the smallest test assertion if current tests do not cover the changed hook. Run bounded install/manifest suites; use only supported scoped manifest baseline if the changed hook hash requires it.
7. Attempt AC-07 only as a zero-model, isolated `claude --init-only` proof. If the local CLI cannot expose adequate hook evidence without touching user config, report it as a residual activation proof; do not improvise or call a model.
8. Self-review against AC-01..AC-07 and `git diff --check`. Commit all tracked implementation/test/manifest changes with a focused message. Do not edit the result report.

Stop after one implementation attempt if ownership/SessionStart semantics contradict the spec. Return <=4000 bytes: status, commit SHA, RED proof, GREEN counts/commands, files changed, manifest/install result, zero-model result, and residuals for independent review/activation.
