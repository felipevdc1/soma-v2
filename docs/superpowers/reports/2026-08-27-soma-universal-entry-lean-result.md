# SOMA universal entry — residual continuity correction approved

Date: 2026-08-27

## Immutable candidate and reviews

- Final code SHA: `20b29c27c4bba5bebb5b9446a967c41cc9930372` (`fix(continuity): harden durable authority boundaries`).
- Specification review: **APPROVED** for this exact SHA.
- Independent quality/security review: **APPROVED** for this exact SHA; no Critical or Important findings.
- Correction RED/GREEN: 32/35 RED for the three residual cases (symlinked durable ancestor, governing durable `/tmp` authority, and unlabeled legacy context), then 35/35 GREEN.

## Fresh final verification

- Focused entry/protocol/subagent proof: 35 passed, 0 failed.
- Fresh entry/protocol/subagent vertical: 89 passed, 0 failed.
- Fresh affected callable-installer vertical: 7 passed, 0 failed.
- Manifest hash/provenance suite: 20 passed, 0 failed. `manifest baseline --dry-run --json` reported the expected `soma-manifest-baseline/v1` schema.
- `git diff --check 3ea55b25ee99f353b2e26c639803e2e721320ad1 20b29c27c4bba5bebb5b9446a967c41cc9930372` was clean.
- The known isolated doctor assertion was not rerun; it is independently identical at 10/11 for `8032599` and `20b29c2`.

## Structured inherited-failure baseline

The required full command was run once in a fresh detached worktree at the final code SHA:

```text
node --test --test-reporter=junit core/scripts/__tests__/*.test.cjs core/hooks/__tests__/*.test.cjs
```

It exited 1 with 57 inherited failures. The detached worktree was removed after capture. The unchanged approved base JUnit and new final JUnit were both parsed with `core/scripts/test/junit-failure-set.cjs` from `20b29c2`; full identity comparison is `(file, fullName, errorName, message, failureSha256)`.

| Evidence | Exit | Failures | SHA-256 |
| --- | ---: | ---: | --- |
| Base JUnit: `.soma/baselines/universal-entry-lean-strict-base.junit.xml` | 1 | 57 | `796edf6f8b24cd818acd81f3df79c93188d661029930476f8330434007b12edd` |
| Final JUnit: `.soma/baselines/universal-entry-lean-residual-final.junit.xml` | 1 | 57 | `4e175e2b09e5b206a1de903e2a1418762e88dff8ec76e3078870120cf287da1c` |

- Parsed evidence: `.soma/baselines/universal-entry-lean-residual-{base,final}.json`.
- Baseline delta: **0 unexpected final failures; 0 removals**.
- Parsed JSON SHA-256: base `6e4057ab65bfe2fd67ab742df90a1ac711489ee9307527a8e7f59517f5463c7f`; final `708239b7ce944eb20ce53a628a0ad03eca41c4fcf716bab8d944efb780f2f4b6`.

## Accepted non-blocking findings

The quality review recorded and accepted these three minors:

1. Raw `ENOTDIR` classification remains unrefined.
2. Test snapshot symlink visibility could be more explicit.
3. One ordering assertion is narrower than ideal.

They do not affect the fail-closed durable-identity behavior, immutable source provenance, or executor-owned rollback contract verified above.

## Activation and transaction status

No live installation or global activation was performed. The global-install transaction remains **pending / not activated**. A Claude Code CLI process is active (`PID 73614`), so live installation remains pending.
