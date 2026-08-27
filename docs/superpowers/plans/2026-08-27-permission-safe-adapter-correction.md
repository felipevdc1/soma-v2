# T-LEAN-7 attempt 2 — Scope adapter file authority

Role: correction implementer. You own code, tests, Git, and the correction commit. Preserve `.soma/`; no global install and no real Claude model call. Base candidate: `3258d54acb8420d1df3bc85beed22ae997aab545`.

## Verified review finding

The adapter's bare `Read` and `Write` entries pre-approve arbitrary file access while the skill is active. Official Claude docs state `allowed-tools` grants permission rather than restricting availability, support permission-rule specifiers, and state `Edit` rules cover built-in file-edit tools. Therefore prose-only path restrictions are insufficient.

Primary docs:
- https://code.claude.com/docs/en/slash-commands
- https://code.claude.com/docs/en/permissions

## Required correction

1. Replace broad file permissions with exact path-scoped permission rules. The orchestration reference must be the sole pre-approved read. The request envelope must be the sole pre-approved write subtree.
2. Because `os.tmpdir()` is not a portable frontmatter path, move only the default mailbox root to a stable user-scoped SOMA state path that can be expressed portably with `~`; preserve `SOMA_ENTRY_ROOT` override behavior for tests/internal callers. Avoid source/install tree mutation during command execution.
3. Keep all three Bash rules exact and all native identity/ownership/mailbox invariants from attempt 1.
4. Add RED→GREEN tests proving no bare `Read`/`Write`/`Edit`, exact scoped rules, default-root agreement between adapter and runtime, fake-home parity, and no regression in native entry/help behavior.
5. Verify actual Claude permission grammar from the installed CLI/docs if cheaply inspectable; do not invent unsupported `Write(path)` syntax. Prefer the documented edit-rule form that governs Write.

Run focused, affected vertical, manifest/installer, and bounded deterministic regression proofs. Do not rerun a wildcard suite known to hang; use the repository's established bounded/full runner or the prior final-verification command. Commit the correction. Return <=4000 bytes: status, commit SHA, RED/GREEN evidence, exact permission rules/default root, compatibility, and residual real-smoke blocker.
