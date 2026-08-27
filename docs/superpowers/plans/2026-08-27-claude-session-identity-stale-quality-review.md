# T-LEAN-19 — Stale identity correction quality review

Review only. Do not edit, commit, install, change settings, or start Claude.

Worktree: `/Users/felipevdc1/Documents/Codex/2026-08-24/soma-efficient-orchestration-budget`
Immutable candidate: `289ddb7d43126f8e04b206f1bc87291df6016aa5`
Base: `33ec3ff721abc316896bbbeb20e6b5268053c1b3`
Contract: `docs/superpowers/plans/2026-08-27-claude-session-identity-stale-neutralization.md`

Pressure-test independently:

- constant shell neutralization syntax and injection impossibility;
- actual source/evaluation semantics, including duplicate ordering and stale values;
- both current and legacy variables, invalid and missing input;
- lifecycle ordering before fallible work;
- write-failure honesty and nonblocking diagnostics;
- no hidden identity path or temp residue;
- test isolation from host env/os.tmpdir and whether helper logic mirrors production falsely;
- exact two-file scope and installer source/target/manifest parity.

Run bounded focused commands only. Reproduce at least one direct stale+invalid effective-env falsifier, syntax/diff checks, focused identity suite and installer parity test. Treat live startup/resume/subagent equality as residual.

Reject any Critical/Important defect; otherwise approve. Return <=2500 bytes with severity, file/line/proof, counts, SHA and residuals.
