# T-LEAN-6 — Permission-safe Claude adapter review

Role: independent architecture/debug reviewer. Read-only; do not edit files or Git state.

Candidate: `9e6bd96ee5dbed22bb739a7a146d94eecbf1db0e`.

Verified failure evidence: the installed `/soma-run` command is discovered by Claude, but its first Bash call using `${HOME}` is denied as `Contains expansion`; Claude's absolute-path fallback then requires interactive approval. The adapter also uses `$PPID`, which may cause the same class of denial. Deterministic SOMA runtime/adoption checks pass.

Review the source adapter and entry prepare/consume ownership semantics. Propose the smallest robust correction that works in normal Claude permission mode without `--dangerously-skip-permissions`. Pressure-test at least: path resolution, owner PID derivation/liveness, restrictive `allowed-tools`, interactive and `claude -p` behavior, and installed/source parity. Define exact tests that should fail before and pass after. Do not accept merely replacing `${HOME}` with `~` unless permission behavior and `$PPID` are both resolved.

Return <=4000 bytes: recommendation, falsified alternatives, files/tests affected, risks/blockers, and evidence inspected.
