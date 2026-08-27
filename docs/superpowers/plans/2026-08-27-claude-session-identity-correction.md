# T-LEAN-14 attempt 2 — Close invalid legacy identity channels

Same implementation owner. One correction only. Base candidate `59b6656f639f7ff7d8486bde1bd61594efd44ee6`. Preserve `.soma/`, plans and user/global state. No install or Claude call.

Verified Important finding: `bad;identity` is rejected for `CLAUDE_SESSION_ID` but still reaches legacy `CK_SESSION_ID` and `writeSessionState`, creating `ck-session-bad;identity.json` under `os.tmpdir()`. This violates the approved fail-closed/no alternate identity-channel contract.

TDD correction:
1. Extend the focused test first. For invalid/missing identity, assert no `CLAUDE_SESSION_ID`, no `CK_SESSION_ID`, and no new `ck-session-*` file in a controlled temp directory. Use an isolated temp root (`TMPDIR`/platform equivalent before spawning) or exact before/after snapshot so the falsifier observes `os.tmpdir()` rather than only HOME/cwd.
2. Run and record RED against `59b6656`; it must fail on the verified legacy export/state residue.
3. Implement the minimum root fix: preserve raw hook input only for validation/diagnostic, but pass a valid-or-null `sessionId` to every legacy identity consumer. Never normalize or invent a value. Keep valid lifecycle behavior unchanged and keep identity export before fallible work.
4. Run focused test, required 86-test affected suite, two-install parity and bounded manifest/settings checks. Prove the direct `bad;identity` falsifier leaves no legacy export/temp state. Run diff/syntax checks.
5. Commit the correction. No unrelated refactor or duplicate-settings cleanup.

Return <=3000 bytes: commit, RED/Green, exact invalid-channel proof, files changed and residual AC-07/activation status.
