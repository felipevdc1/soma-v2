# T-LEAN-18 — Stale identity correction spec review

Review only; do not edit, commit, install, change settings, or start Claude.

Worktree: `/Users/felipevdc1/Documents/Codex/2026-08-24/soma-efficient-orchestration-budget`
Immutable candidate: `289ddb7d43126f8e04b206f1bc87291df6016aa5`
Base: `33ec3ff721abc316896bbbeb20e6b5268053c1b3`
Contract: `docs/superpowers/plans/2026-08-27-claude-session-identity-stale-neutralization.md`
Diagnostic: `.soma/diagnostics/run-260825-universal-entry-7f3c2a-session-identity-stale-invalid.json`

Independently verify AC-17.1 through AC-17.7. Reproduce final effective environment for stale+invalid, stale+missing, duplicate ordering, later valid restoration, later invalid neutralization, and absence of legacy/temp residue. Verify valid lifecycle/native behavior and installer parity have not regressed. Inspect exact diff and tests for false-green logic. The constant neutralization must not interpolate input. A write failure may remain nonblocking with an honest diagnostic; do not treat it as successful neutralization. Live startup/resume/subagent proof remains residual and must not be claimed.

Reject any Critical/Important defect; otherwise approve. Return <=2500 bytes with verdict, findings, candidate SHA, commands/counts and residuals. No speculative redesign.
