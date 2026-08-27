# T-LEAN-10 — Corrective global activation and real smoke

Role: activation/verification agent. You own process preflight, the one corrective install transaction, installed-state proofs, the one real Claude smoke, report update, and Git commit. Source candidate: `7981bd7f4c8a1bb362112c98c1bdba1379b28407`. Preserve `.soma/` and all user projects. Do not edit source code.

## Preconditions

- Confirm no active user Claude CLI session. Claude.app helper/native-host processes that hold no SOMA/config files are nonblocking; do not kill any user process.
- Confirm source worktree tracked state equals candidate and installer syntax/preflight are clean.
- Inspect existing transaction state before mutation; never blind-retry a pending transaction.

## Activation

Run exactly one new corrective `bash install.sh --force-overwrite` transaction from this worktree. If installation fails, use the installer's supported recovery only; do not improvise deletion/reset. Record transaction ID/status and installed hashes/parity.

## Proofs

1. Installed transaction is COMMITTED; recovery status NONE; no pointer/lock residue.
2. Installed manifest/core parity, Claude/Codex sync dry-runs, doctor, and deterministic entry/adoption/help-purity checks pass.
3. Run exactly one real Claude model command in a fresh temporary Git project without `.soma`: `claude -p '/soma-run --help'` under normal/default permissions, never bypass/dangerous mode. Capture structured transcript/output. It must prove command discovery, no permission denial/approval request, native prepare/write/consume success, terminal `HELP_SHOWN`, no project adoption/run lock, and no mailbox residue. A single noninteractive success is sufficient; do not spend a second model call for an interactive duplicate.
4. Ensure the spawned Claude process exits and no user process was changed.

Update the existing durable result report with correction commits, review outcomes, transaction, installed proof, real-smoke evidence, and honest residuals. Include the untracked correction plan/review docs in the report commit if useful, but never stage `.soma/`. Commit tracked report/plans only.

Return <=4000 bytes: status, final/report commit SHA, transaction ID, installed parity, real-smoke result/evidence path, tests, residuals, and clean-status summary. If the smoke fails, stop with transcript evidence; no second model call and no code hypothesis loop.
