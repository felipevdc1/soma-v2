# SOMA universal entry, lean result

Date: 2026-08-27

## Delivered in Task 4

- Thin Claude `/soma-run` adapter with fixed prepare, structured Write, consume and abort flow.
- Lazy orchestration reference installed at `~/.claude/references/soma-run-orchestration.md`.
- Automatic project adoption through the existing installer, without running project scripts.
- `T-BASELINE` as the first executor dispatch when adoption reports `baselineRequired`.
- Immutable-review rule: all planned reviewers inspect the same candidate before one consolidated correction.
- Checkpoint and handoff after each safe transition, with exact next-task resume.
- Fake-home tests for hostile argument transport, adoption, closed dispatch, checkpoint, handoff, resume, partial adoption, corrupt mailbox and rollback coverage.

## Consolidated correction

- Correction code SHA: `d861a1ed4d568c8990dbe12c5bede7893a598c66` (`fix(adapter): close universal workflow gaps`).
- Separate Bash calls now compose consume/abort with exact grammar-validated session/request IDs as POSIX single-quoted literals; no model-defined shell variable carries identity across calls.
- New runs pass `--run <runId>` to every SOMA control primitive and the first explicit-run gate succeeds without `.soma.lock`; resume alone owns the canonical continuity lock.
- Read-only status reports durable run/checkpoint/handoff facts or an explicit no-run/invalid/ambiguous state. It verifies canonical handoff/checkpoint bytes, checkpoint SHA, exact run-state path/SHA/currentState and exact run-identity path/SHA before combining facts.
- STEP 5 validation, STEP 6 consolidation/build-test and STEP 8 deterministic/audit work now have explicit executor contracts. The coordinator boundary is limited to SOMA control primitives, task/agent lifecycle, human gates, routing, completed-finding consolidation and durable publication.
- Baseline normalization is limited to recognized generated operator-gate/runtime forms; semantic `pattern`, `session`, `request_id`, arbitrary numbers, paths and commands remain identity-bearing.
- Installed fake-home coverage composes the adapter contract and proves adoption, explicit first gate, closed `T-BASELINE`, status before/after handoff, exact next-task resume, no passed-task replay, durable Git-drift diagnosis, invalid mailbox rejection and injected global-transaction rollback.

## Usage

```text
/soma-run "objective"
/soma-run --status [--project /path]
/soma-run --resume [runId] [--project /path]
```

## Continuity guarantee

`RESUME_READY` requires the authoritative handoff JSON, its Markdown pair, the referenced checkpoint, run state, closed dispatch records, proof hashes and Git facts to match. It returns the exact unfinished task. A recorded `passed` task is not selected again. Any mismatch returns `RESUME_DRIFT` and writes a durable diagnostic before run mutation.

## Verification

- Focused entry, adapter, status, checkpoint, handoff, helper, orchestration and fake-home E2E gate: 102 passed, 0 failed.
- Fake-home vertical partitions: 3 passed, 0 failed.
- Affected global transaction gate: 36 passed, 0 failed. The combined historical contract command remains 44/45 because its pre-existing AC-12 test intentionally rejects the already-approved `soma-run.md` install target; it is part of the inherited 57-failure baseline, not a transaction regression.
- Synthetic environment: 6 passed, 0 failed.
- The fake-home vertical E2E completed global installation, first adoption and exact resume without modifying the live user installation.
- Structured-baseline helper: 15 passed, 0 failed, including semantic `pattern=alpha/beta`, `session=primary/replica` and `request_id=invoice-41/42` counterexamples.
- Strict detached comparison at correction code SHA `d861a1ed4d568c8990dbe12c5bede7893a598c66`: base 57 failures, final 57 failures, 0 unexpected and 0 removed. The unchanged base JUnit and final detached JUnit were parsed by the helper at the correction code.
- Evidence: `.soma/baselines/universal-entry-lean-correction-{base,final}.json`, unchanged `.soma/baselines/universal-entry-lean-strict-base.junit.xml` and `.soma/baselines/universal-entry-lean-correction-final.junit.xml`. JUnit SHA-256: base `796edf6f8b24cd818acd81f3df79c93188d661029930476f8330434007b12edd`; final `7b2567f0325c8f90c79b780c8782e2b41f4e294ec08719a7f911385f545bec64`.

## Review result and activation status

The correction passed the specification review but the independent quality re-review rejected candidate `4de16a383e1cfecf4f44be60181bbc04514d7886` with three residual findings:

1. `--status` accepts a state without its durable run-identity when no handoff exists, while resume rejects the same run.
2. The recovery-marker branch still maps directly to `git reset --hard` instead of an explicit agent contract and dispatch record.
3. `docs/TROUBLESHOOTING.md` still states the obsolete three-failure threshold.

The run is therefore `PAUSED_DIAGNOSTIC`. The live user installation was not modified. Global activation remains prohibited until a newly authorized correction closes all three findings and both review axes approve the same immutable candidate.
