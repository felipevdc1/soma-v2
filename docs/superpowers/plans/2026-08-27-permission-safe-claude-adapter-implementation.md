# T-LEAN-7 — Permission-safe Claude adapter implementation

Role: implementation agent. You own code, tests, Git, and the task commit. Work only in this worktree. Preserve untracked `.soma/`; do not globally install or invoke a real Claude model.

Base: `9e6bd96ee5dbed22bb739a7a146d94eecbf1db0e`.

## Problem

The installed `/soma-run` is discovered, but normal Claude permissions deny `${HOME}` as shell expansion; the adapter also uses `$PPID`. An absolute fallback requires approval. Runtime/adoption itself passes.

## Required outcome

1. The Claude adapter has restrictive `allowed-tools` and only fixed Bash invocations; no `${HOME}`, `$HOME`, `$PPID`, command substitution, model-generated request ID, or arbitrary PID in a Bash command.
2. Add native entry CLI behavior so validated `CLAUDE_SESSION_ID` is resolved inside Node. Resolve owner identity inside Node; preserve continuity live-owner/reclaim safety. Prefer `exec node ~/.soma-v2/scripts/soma.cjs ...` if tests confirm the direct parent is the Claude process.
3. Native consume/abort resolve the correct request internally and fail closed on absent, foreign, ambiguous, or claimed residue. Keep existing explicit CLI forms backward compatible unless a verified contract requires otherwise.
4. Installed/source adapter parity and manifest integrity remain correct.
5. Help must not start/adopt a run. If current `/soma-run --help` behavior would do so, fix and test it within this scope.

## TDD and proof

Write focused failing tests first and record RED output. Cover adapter no-expansion/exact allowlist, native session validation, owner PID/liveness semantics, mailbox selection/fail-closed cases, help purity, and fake-home install parity. Then implement the minimum change. Run focused tests, affected vertical suite, installer/manifest checks, and the full deterministic suite. If a pre-existing failure appears, prove it against base instead of guessing.

Do not weaken permission checks, use broad `Bash`, hardcode a home path, or depend on `--dangerously-skip-permissions`. Do not globally install. One implementation attempt only; stop with evidence if the design cannot satisfy ownership semantics.

Commit all tracked changes with a focused message. Return <=4000 bytes: status, commit SHA, RED/GREEN proof, files/contracts changed, full-suite result, and residual blocker for the final real Claude smoke.
