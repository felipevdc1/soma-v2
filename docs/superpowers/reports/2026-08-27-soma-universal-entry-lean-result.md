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

## Usage

```text
/soma-run "objective"
/soma-run --status [--project /path]
/soma-run --resume [runId] [--project /path]
```

## Continuity guarantee

`RESUME_READY` requires the authoritative handoff JSON, its Markdown pair, the referenced checkpoint, run state, closed dispatch records, proof hashes and Git facts to match. It returns the exact unfinished task. A recorded `passed` task is not selected again. Any mismatch returns `RESUME_DRIFT` and writes a durable diagnostic before run mutation.

## Verification

- Adapter, entry, checkpoint, handoff and lean E2E gate: 74 passed, 0 failed.
- Installer transaction gate: 129 passed, 0 failed.
- Focused installer and adoption regression: 22 passed, 0 failed.
- Synthetic environment: 6 passed, 0 failed.
- The fake-home vertical E2E completed global installation, first adoption and exact resume without modifying the live user installation.
- Structured-baseline helper: 14 passed, 0 failed. It preserves semantic numbers, paths, commands, expected/actual values and `type`/`location` lines outside TAP YAML.
- Strict detached comparison at candidate `327485b5f41c22fabbb0a7b6027b373e174f84ac`: base 57 failures, final 57 failures, 0 unexpected and 0 removed. Both artifacts were parsed by the helper at that candidate.
- Evidence: `.soma/baselines/universal-entry-lean-strict-{base,final}.{junit.xml,json}`. JUnit SHA-256: base `796edf6f8b24cd818acd81f3df79c93188d661029930476f8330434007b12edd`; final `341949900ca5d14fa2a87b463794e0c7e94c095219a20ed5cfb4df52805c83a5`.

## Activation status

Task 4 does not modify the live user installation. Global transactional activation, installed-file hash comparison and live Claude smoke run only after code review.
