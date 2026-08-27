# SOMA residual quality correction design

Date: 2026-08-27
Status: approved by the user's authorization to execute the recorded three-finding correction

## Goal

Close the three blockers recorded in `run-260825-universal-entry-7f3c2a` without widening the universal-entry design or touching the live Claude installation before review.

## Evidence and root causes

1. `durableStatus()` validates the run identity inside `readHandoffFacts()`. That function returns before the identity check when no handoff exists. A state without `.soma/run-identities/<runId>.json` is therefore accepted by status and rejected by resume.
2. The normal STEP 5, STEP 6 and STEP 8 paths have explicit executor contracts, but the `PAUSED_DIAGNOSTIC` rollback branch still maps its marker directly to `git reset --hard`. The coordinator boundary is incomplete on the destructive recovery path.
3. `docs/TROUBLESHOOTING.md` kept the old three-failure rule after QUICKSTART and ARCHITECTURE moved to one initial attempt plus one correction.

## Considered approaches

### A. Validate at the status boundary and cover recovery explicitly

Read and validate the exact run-identity marker immediately after the state, before status can return with or without a handoff. Pass the observed identity facts into handoff validation. Rewrite rollback as an executor contract and add tests for the recovery section and troubleshooting rule.

This is the selected approach. It fixes the missing boundaries with a small change set and preserves pre-handoff status.

### B. Reuse `checkpoint.cjs` identity reading

Export and extend the checkpoint reader, then make status depend on it. This centralizes more code, but changes a shared checkpoint boundary and still needs new canonical-byte guarantees. The extra blast radius is not justified for this correction.

### C. Require a handoff for every successful status

This makes the existing identity check unavoidable, but breaks the intended pre-handoff status used during adoption and first-run setup. Rejected.

## Design

### Durable status

Add one internal identity reader to `core/scripts/entry/status.cjs`. It must:

- resolve exactly `.soma/run-identities/<runId>.json`;
- read a regular file with no symlink following;
- require the exact canonical `soma-run-identity/v1` bytes for the requested run;
- return the observed path, SHA-256 and bytes;
- run before `readHandoffFacts()`, including when no handoff exists;
- let handoff validation compare against the same observed identity instead of reading it again.

Missing, malformed, non-canonical, wrong-run or non-regular identity markers produce `DURABLE_STATUS_INVALID`. Status remains read-only.

### Recovery delegation

The `PAUSED_DIAGNOSTIC` rollback marker authorizes a rollback workflow, not coordinator-side Git execution. The coordinator records an exact rollback executor contract with `dispatch-record begin`, dispatches one `Agent`, waits for its result and closes `dispatch-record end` before the state transition. The executor verifies repository root, the 40-hex `baselineSha`, the marker and the expected worktree scope, runs the reset, and returns the resulting HEAD plus status proof. Failure remains paused and does not trigger another agent automatically.

### Normative documentation

Troubleshooting must say that the initial attempt plus one correction exhausted the budget. It must point to project `.soma/` diagnostic, checkpoint and handoff artifacts, not the obsolete session-state snapshot as the authority.

## Acceptance criteria

- AC-01: A valid v2 or v3 state without its exact run-identity marker returns `DURABLE_STATUS_INVALID` before and after handoff discovery, without changing project bytes or mtimes.
- AC-02: A valid pre-handoff state with its exact identity remains reportable.
- AC-03: Handoff identity path, hash and bytes remain checked against the single observed identity snapshot.
- AC-04: The rollback branch names `dispatch-record begin -> Agent -> dispatch-record end`, assigns all Git inspection and mutation to the executor, validates `baselineSha`, and contains no coordinator-side `git reset` action.
- AC-05: Troubleshooting contains the initial-plus-one-correction rule and no active three-failure instruction.
- AC-06: Focused entry, adapter and efficient-protocol tests pass; the strict structured baseline has no unexpected or removed failures.
- AC-07: Global activation remains forbidden until independent spec and quality reviews approve the same immutable candidate.

## Failure modes pressure-tested

- Identity exists when state is read but changes before handoff validation: status uses one identity snapshot, so the handoff comparison cannot silently observe different bytes.
- No handoff exists yet: identity validation still runs and valid early status remains supported.
- A rollback marker exists with an invalid or missing baseline SHA: no Git command runs and the run stays paused.
- Documentation changes without executable protection: tests scan the recovery section and troubleshooting text, so both regressions fail deterministically.

## Scope

Modify only the status reader, focused tests, the Claude orchestration reference, troubleshooting and the result report. Do not refactor continuity, change retry budgets, modify live HOME or activate globally inside the correction task.
