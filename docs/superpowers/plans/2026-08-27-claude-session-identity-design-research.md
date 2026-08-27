# T-LEAN-11 — Claude session identity design research

Read-only architecture/debug task. Do not edit source, install, commit, or invoke a Claude model.

Verified evidence:
- Interactive `/soma-run --help` discovers the installed command but `entry native prepare` returns `INVALID_SESSION_ID` because Bash has no `CLAUDE_SESSION_ID`.
- The same occurs in `claude -p`; permission denials are zero.
- Official Claude docs say every hook input includes `session_id`; `SessionStart` receives `CLAUDE_ENV_FILE`, and exports appended there are available to subsequent Bash calls.

Inspect candidate `334f9cb` in `/Users/felipevdc1/Documents/Codex/2026-08-24/soma-efficient-orchestration-budget`, current source/installed hook configuration, install targets/manifest, and existing hook tests. Compare exactly three designs:
1. Extend an existing SOMA SessionStart hook to validate hook input `session_id` and append a safely shell-quoted `CLAUDE_SESSION_ID` export to `CLAUDE_ENV_FILE`.
2. Add a dedicated minimal SessionStart identity hook.
3. Keep hooks unchanged and implement a runtime/mailbox fallback.

Evaluate interactive startup/resume/clear/compact, `claude -p`, subagents, hook ordering/deduplication, injection/quoting, env-file absence, duplicate exports, installed/source parity, rollback, and whether a hook can safely preserve the same Claude session identity across resume/compact. Recommend the smallest product fix and exact RED tests. Distinguish verified facts from inferences. Return <=4000 bytes; no implementation.
