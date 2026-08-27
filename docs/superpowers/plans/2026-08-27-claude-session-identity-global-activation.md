# T-LEAN-20 — One transactional global activation and live proof

You own this activation. Do not edit or commit repository code. Do not kill Claude processes. Do not repeat installation or live smoke to force green.

Worktree: `/Users/felipevdc1/Documents/Codex/2026-08-24/soma-efficient-orchestration-budget`
Immutable approved candidate: `289ddb7d43126f8e04b206f1bc87291df6016aa5`
Run: `run-260825-universal-entry-7f3c2a`
Plan/spec: `docs/superpowers/plans/2026-08-27-claude-session-identity-export.md`

## Phase A — fail-before-write preflight

1. Verify HEAD exact, tracked worktree clean, untracked `.soma/`/contracts preserved.
2. Verify no active Claude CLI/session process that the transaction could invalidate. Ignore this Codex process and unrelated desktop UI. If a Claude CLI is active, STOP before install with PID/evidence; never kill it.
3. Run fresh deterministic gates on the approved SHA:
   - focused identity + affected native matrix (expected 91/91);
   - fake-home installer parity/idempotence test;
   - settings/install-target/manifest tests (expected 14/14);
   - syntax and `git diff --check`.
4. Record pre-install hashes of the source hook, installed hook if present, install state and relevant managed settings. Do not print secrets or unrelated settings.

## Phase B — exactly one transaction

Run exactly once: `bash install.sh --force-overwrite` from the worktree. Capture transaction ID, exit and recovery status. On failure, do not retry; use only installer-supported rollback if the transaction says rollback is required, then stop with evidence.

After success prove:

- transaction COMMITTED and recovery NONE/no active lock or pointer;
- installed hook byte hash equals candidate source;
- install state is complete and manifest/source/target parity holds;
- managed SessionStart hook is present without deleting unmanaged entries;
- sync dry-run(s) and doctor pass using supported installed commands;
- no tracked or untracked project files were altered by activation.

## Phase C — one bounded live interactive session

Use one fresh interactive Claude CLI session after installation. Capture a transcript/evidence directory under a fresh `mktemp -d`; do not expose unrelated environment values. Do not reuse a previous session ID.

In that single session:

1. Invoke `/soma-run --help` once and prove it reaches native prepare/help without `INVALID_SESSION_ID`, permission denial or identity fallback.
2. Capture the parent identity only from the SessionStart hook evidence/runtime state, never invent it.
3. Send one subsequent minimal request in the same session to dispatch exactly one subagent whose only Bash action compares its `CLAUDE_SESSION_ID` with the parent identity supplied through the task contract and returns only `MATCH` or `MISMATCH`; it must not print environment contents.
4. Require `MATCH`. Then exit the Claude session cleanly. Confirm no Claude CLI remains.

This is one live session, not one prompt. Do not open a second session or repeat either smoke. Keep prompts terse. If the CLI cannot expose sufficient proof, report the exact residual and stop; do not infer success from exit 0.

## Completion evidence

Return <=3500 bytes with: candidate SHA, deterministic counts, transaction ID/status, source/installed hashes, doctor/sync results, evidence directory/transcript path, real parent session ID hash or redacted suffix (not unrelated env), help result, subagent MATCH/MISMATCH, process cleanup, project git status and blockers. Do not claim DONE unless every item above is directly proved.
