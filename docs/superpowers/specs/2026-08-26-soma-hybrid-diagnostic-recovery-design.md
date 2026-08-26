# SOMA hybrid diagnostic recovery design

**Status:** approved design input, ready for implementation planning

**Date:** 2026-08-26

**Scope:** orchestration policy, diagnostic recovery, canonical run-state, dispatch integration and migration of the active universal-entry run

## Evidence and problem

### Verified facts

The universal-entry run produced 22 dispatches: 13 ended `DONE` and 9 reviews ended `REJECTED`. It reached four diagnostic pauses and produced 10 commits. Eight commits changed only documentation and two changed only the Task 0 parser or tests. No universal-entry feature was implemented.

The active run has three durable diagnostic files, but its `soma-state/v2` says `previousState: PAUSED_DIAGNOSTIC`, `pausedDiagnostic: null`, and has empty failure counters. The diagnostic truth is outside the canonical state.

`core/adapters/codex/AGENTS.md:64-67` gives one executor an initial attempt plus one correction, then sends a residual blocker to `PAUSED_DIAGNOSTIC` without automatic dispatch. Existing diagnostics already name the candidate, proof, residual finding and next technical correction.

### Root-cause inference

The executor and test author shared blind spots. Reviewers therefore discovered requirements and counterexamples after a candidate existed. Narrow corrections closed the named finding without rechecking the whole boundary. The stop rule treated executor thrash as if the system had stopped learning, while the run-state failed to retain that learning.

This explanation fits the dispatch record but remains a hypothesis until later runs show fewer late semantic findings after independent RED creation.

## Decision

Adopt a hybrid model. Shift adversarial test design before implementation, then recover automatically when later evidence still finds a defect. The two-attempt limit applies to one executor, not to the run.

| Alternative | Benefit | Failure mode | Decision |
| --- | --- | --- | --- |
| Strict shift-left | Finds more contract gaps before code | Assumes the pre-implementation oracle can enumerate every boundary case | Reject alone |
| Rolling recovery | Preserves overnight progress after any finding | Can spend generations rediscovering requirements late | Reject alone |
| Hybrid | Reduces shared blind spots and preserves learning after a late counterexample | Needs canonical fingerprints, progress accounting and exact human gates | Adopt |

The recovery rules in this document supersede the older `Stop eficiente` rule. Existing prompt and conversational output limits remain 8,000 and 4,000 bytes.

## Shift-left pipeline

Every implementation task MUST follow this order:

1. The orchestrator records an AC and invariant map. Each invariant names its source, boundary, deterministic check and owning task.
2. An adversarial RED agent, independent from the implementer, creates the minimal failing oracle. It MUST challenge boundary behavior, not restate the happy path.
3. The orchestrator records the RED command, exact failure identity, artifact hashes and candidate base SHA. These bytes become an immutable `soma-red-proof/v1` artifact.
4. The implementer receives the map and frozen RED proof. The implementer MUST NOT weaken, replace or rewrite a frozen oracle. A false or contradictory oracle returns to `DIAGNOSTIC_REPLAN` with evidence.
5. The executor runs the frozen RED, focused GREEN checks and declared deterministic regressions.
6. One integrated reviewer reads the same immutable candidate and proofs. A second reviewer is allowed only when the plan declared a separate risk boundary before implementation.
7. Each review finding MUST either name an existing AC or invariant, or use `NEW_EVIDENCE` with a minimal reproduction and observed result. A reviewer MUST NOT silently create a requirement. Evidence that implies a new product rule becomes `NORMATIVE_DECISION` before any correction.

The implementer may add tests for uncovered behavior, but those tests become a new frozen proof through an independent RED task before they authorize a correction.

## Recovery state machine

`DIAGNOSTIC_REPLAN` is an active, nonterminal branch state. It does not mean human pause.

```text
IMPLEMENTING
  -> REVIEWING
  -> CLOSED                                      when no finding remains
  -> CORRECTION                                  after attempt 1 finding
  -> DIAGNOSTIC_REPLAN                           after attempt 2 residual or NEW_EVIDENCE

DIAGNOSTIC_REPLAN
  -> RED_PENDING -> RED_FROZEN -> EXECUTOR_PENDING
  -> IMPLEMENTING -> REVIEWING
  -> CLOSED                                      when proof closes the finding
  -> HUMAN_GATE                                  only for the four gate classes below
```

The orchestrator classifies every residual finding as exactly one of:

| Classification | Required transition |
| --- | --- |
| `TECHNICAL_DETERMINISTIC` | Create a new recovery task, obtain an independent frozen RED, rotate to a fresh executor and continue automatically |
| `EVIDENCE_DEFICIENT` | Create an independent proof task. Close as not reproducible if the oracle disproves the report, or continue automatically with a frozen RED if it proves it |
| `NORMATIVE_DECISION` | Pause for a product, policy, UX or trust decision that evidence cannot select |
| `SCOPE_AUTHORITY` | Pause for authority to expand scope, perform a destructive action or weaken protected behavior |
| `CONTRADICTORY_REQUIREMENTS` | Pause with the conflicting sources and ask which source prevails |
| `NO_PROGRESS` | Pause only after the anti-loop rule below is satisfied |

Findings with different classifications or boundaries use separate recovery branches. Findings on the same boundary with the same classification may share a generation, but retain separate fingerprints.

One executor may make an initial attempt and one correction. The original executor for a fingerprint is the first executor who receives that fingerprint as an explicit correction target. If a review first discovers the fingerprint after an unrelated correction, the next fresh executor becomes its original executor and does not consume the rotation. If the same fingerprint survives its original executor's correction, the orchestrator creates a new task and permits one automatic executor rotation. The rotated executor also has an initial attempt and one correction. If the fingerprint survives that correction, classify it `NO_PROGRESS`. Task names do not own this budget.

A new counterexample after a correction receives a new fingerprint. It starts a new diagnostic generation and does not count as repetition of the prior fingerprint. This distinction does not permit an infinite loop: `NO_PROGRESS` also applies when the canonical open-finding set fails to decrease for two consecutive diagnostic generations.

## Fingerprint and progress contract

The fingerprint is lowercase SHA-256 of canonical UTF-8 JSON containing only:

```json
{
  "$schema": "soma-finding-fingerprint/v1",
  "requirementRef": "AC or invariant identifier",
  "minimalReproduction": {"command": "exact argv array or test id", "fixtureSha256": "64-hex"},
  "boundary": "canonical module, contract or state-transition identifier",
  "observedResult": {"errorIdentity": "stable value", "resultSha256": "64-hex"}
}
```

Canonicalization sorts object keys recursively, preserves array order, uses LF and excludes task name, executor, candidate SHA, timestamps, duration, TAP ordinal and prose title. When no fixture exists, `fixtureSha256` is the hash of a canonical empty fixture. `NEW_EVIDENCE` receives a provisional requirement reference derived from the cited contract boundary; if no existing requirement governs it, the branch MUST enter `NORMATIVE_DECISION` before implementation.

Measurable progress is any of: a finding closed with proof, a smaller canonical open set, a stronger frozen RED while preserving the candidate, or a new fingerprint classified with evidence. A stronger RED fails against the unchanged candidate for the same fingerprint while removing a nonsemantic input or adding a deterministic boundary assertion. Progress is recorded per generation. The no-decrease comparison uses the sorted, unique open fingerprint set for the stable recovery branch and boundary after integrated review. For anti-loop purposes, a newly classified fingerprint does not override the stricter two-generation rule when that set does not shrink.

Renaming, splitting or recreating a task MUST preserve its recovery branch ID, fingerprint history, executor identities and attempts. The budget key is `{runId, branchId, fingerprint, executorId}`, never `taskId`.

Different fingerprints that cite the same boundary trigger an architecture replan before another correction. The replan remains automatic when evidence selects one deterministic change. It enters a human gate only under `NORMATIVE_DECISION`, `SCOPE_AUTHORITY`, `CONTRADICTORY_REQUIREMENTS` or `NO_PROGRESS`.

## Canonical continuity and schemas

Introduce `soma-state/v3` as a strict field-preserving superset of v2. Run-state remains the canonical locator and status source. It MUST contain `diagnosticRecovery.branches[]`. Each active branch has this minimum shape:

```json
{
  "branchId": "stable-id",
  "generation": 3,
  "state": "DIAGNOSTIC_REPLAN",
  "classification": "TECHNICAL_DETERMINISTIC",
  "fingerprint": "64-hex",
  "boundary": "contract identifier",
  "candidate": {"sha": "git-sha", "preserved": true},
  "proofs": [{"kind": "RED", "path": ".soma/...", "sha256": "64-hex"}],
  "closedFindings": [{"fingerprint": "64-hex", "proof": ".soma/..."}],
  "openFindings": [{"fingerprint": "64-hex", "requirementRef": "AC-01"}],
  "nextTask": {"taskId": "T-RECOVERY-G3-RED", "kind": "RED", "status": "pending"},
  "humanGate": null,
  "executorRotation": {
    "originalExecutor": "agent-id",
    "rotatedExecutor": null,
    "rotationsUsed": 0,
    "attemptsByExecutor": {"agent-id": 2}
  },
  "progressDelta": {
    "closed": 1,
    "opened": 1,
    "previousOpenCount": 2,
    "currentOpenCount": 2,
    "setDecreased": false,
    "strongerRed": true
  },
  "generationArtifact": {"path": ".soma/recovery/<runId>/0003.json", "sha256": "64-hex"}
}
```

The state writer validates nullability by state. Every open recovery branch MUST have a generation, classification, fingerprint, candidate, proofs and open findings. An automatic state MUST have non-null `nextTask` and null `humanGate`. `HUMAN_GATE` MUST have null `nextTask` and a non-null gate payload with `decisionNeeded` and proof references. Branch state, rather than task prose, is authoritative. The run may continue an independent DAG frontier while one branch is human-gated. It uses global `currentState: WAITING_HUMAN_GATE` only when no independent task is runnable. A run MUST NOT persist `currentState: PAUSED_DIAGNOSTIC` with `pausedDiagnostic: null`.

Each generation publishes one immutable, append-only `soma-recovery-generation/v1` artifact before the atomic run-state replacement references it. The artifact records the full classification input, fingerprint bytes, proof hashes, candidate, closed and open sets, executor rotation, progress delta and next task. Readers follow run-state references and never infer current truth by enumerating the directory. A published but unreferenced artifact is an orphan and cannot authorize a dispatch; retry may adopt it only when its semantic hash matches the expected generation.

Dispatch records remain the single agent ledger. Recovery artifacts contain facts and references, not a second history of prompts or agent outputs. Every RED, implementation and review dispatch still uses `dispatch-record begin` and `end`.

## DAG, overnight and multisession behavior

A terminal condition such as "finish" remains active across diagnostic generations. `TECHNICAL_DETERMINISTIC` and `EVIDENCE_DEFICIENT` never ask for approval when the next correction is proved.

A recovery branch blocks only its dependency closure. Runnable tasks with no path to that branch continue. If a shared contract blocks several tasks, the orchestrator marks those dependents blocked and continues the independent frontier.

Before dispatch, the state atomically records the generation and pending `nextTask`. After restart, a new session resumes that pending transition idempotently: it adopts a matching completed dispatch, waits on a matching active dispatch, or starts the missing dispatch once. It never allocates another rotation or attempt merely because the host changed. Every handoff includes the recovery branch, generation artifact hash, pending transition and canonical resume command, so another session can resume the next dispatch without reconstructing truth from conversation.

## Human gates

Only these outputs may stop automatic recovery:

| Gate | Required short decision request |
| --- | --- |
| `NORMATIVE_DECISION` | State the unresolved rule, evidence, at most three materially different choices and the exact choice needed |
| `SCOPE_AUTHORITY` | State the protected boundary, requested scope or destructive action, expected effect and exact approval needed |
| `CONTRADICTORY_REQUIREMENTS` | Quote the identifiers of both requirements, show the conflicting behavior and ask which one prevails |
| `NO_PROGRESS` | Show the fingerprint or two-generation set history, both executor proofs, architecture replan result and ask whether to change architecture, scope or terminate |

The output MUST fit the existing 4,000-byte limit and reference durable details. It MUST NOT ask a human to choose a single technical correction already selected by deterministic evidence.

## Budgets and anti-loop rules

- Maximum two attempts per executor: initial plus one correction.
- Maximum one automatic executor rotation per fingerprint.
- A second integrated reviewer requires an independent risk declared before implementation; it is not a retry budget.
- Different fingerprints on the same boundary force architecture re-evaluation before another implementation dispatch.
- The same fingerprint after both executors' corrections, or no reduction in the open set for two generations, forces `NO_PROGRESS`.
- Task rename, session restart, branch split and regenerated prose do not reset any counter.
- Prompt and conversational output limits stay at 8,000 and 4,000 bytes.

## Migration

Implementation MUST give this recovery design precedence over the existing `Stop eficiente` paragraph in every installed adapter and canonical source.

The active `run-260825-universal-entry-7f3c2a` migrates atomically from v2 and the Task 0 diagnostic, not from its misleading empty `pausedDiagnostic` field. Migration validates the referenced dispatches and `.soma/diagnostics/run-260825-universal-entry-7f3c2a-task0-identity.json`, records candidate `75a1296441bc0a678aaffbe47ea496975abbfd94`, creates fingerprints for both residual findings, classifies them `TECHNICAL_DETERMINISTIC`, and publishes the first recovery generation. It then continues automatically with an independent RED author and fresh executor. Because neither residual was an explicit target of the prior correction, that fresh executor is the original executor for these fingerprints. Migration preserves all dispatch records and does not rewrite prior diagnostics.

## Failure modes

| Failure | Required behavior |
| --- | --- |
| RED author and implementer resolve to the same agent | Reject dispatch before work; allocate an independent RED agent |
| Reviewer cites no AC or invariant | Require `NEW_EVIDENCE`; do not create a correction task from prose alone |
| Frozen RED bytes change | Reject proof and retain prior candidate and generation |
| Task renamed to obtain more attempts | Resolve the stable branch and reject budget reset |
| Fresh executor makes no progress | Permit its one correction, then enter `NO_PROGRESS` if the fingerprint survives |
| New fingerprints continue on one boundary | Replan architecture; enter `NO_PROGRESS` when the open set does not shrink for two generations |
| Independent DAG branch is runnable | Continue it while the affected dependency closure waits |
| Host dies after generation publication | Ignore an unreferenced artifact; resume or adopt only by expected semantic hash |
| Host dies after pending task is recorded | Resume the same task and budget; do not duplicate dispatch |
| State says paused but diagnostic payload is absent | Reject as corrupt canonical state; migration or repair must reconstruct from verified references before resume |

## Acceptance criteria

- **AC-01:** Every implementation task has an AC and invariant map, an independent frozen RED proof and deterministic checks before integrated review.
- **AC-02:** A reviewer maps each finding to an existing requirement or `NEW_EVIDENCE`; no silent requirement can authorize implementation.
- **AC-03:** An executor receives at most two attempts. A fingerprint receives at most one automatic fresh-executor rotation.
- **AC-04:** Technical and evidence-deficient residuals enter active `DIAGNOSTIC_REPLAN` and continue without human approval.
- **AC-05:** Human pause occurs only for `NORMATIVE_DECISION`, `SCOPE_AUTHORITY`, `CONTRADICTORY_REQUIREMENTS` or proven `NO_PROGRESS`.
- **AC-06:** Canonical fingerprints distinguish a new counterexample from repetition and survive task rename, executor rotation and session restart.
- **AC-07:** Run-state and its referenced immutable generation contain the current classification, fingerprint, candidate, proofs, finding sets, next task, rotation and progress delta.
- **AC-08:** Dispatch records remain the only agent ledger; recovery artifacts are append-only facts referenced by state.
- **AC-09:** A recovery branch blocks only dependent DAG work, and terminal conditions continue across generations and sessions.
- **AC-10:** Same-fingerprint exhaustion and two generations without a smaller open set enter `NO_PROGRESS`; new names or fingerprints cannot create an unbounded loop on one boundary.
- **AC-11:** The current Task 0 diagnostic migrates to `TECHNICAL_DETERMINISTIC` and schedules independent RED plus a fresh executor automatically.
- **AC-12:** Recovery preserves the existing 8,000-byte prompt, 4,000-byte output and reviewer-count budgets.

## Behavioral tests

| Scenario | Expected proof |
| --- | --- |
| New finding appears after correction | New fingerprint and generation; prior repetition count unchanged; automatic technical recovery |
| Same fingerprint survives original correction | One fresh executor is scheduled with frozen RED |
| Same fingerprint survives rotated correction | `NO_PROGRESS` human gate with both executor proofs |
| Open set decreases each generation | Recovery continues and the two-generation no-decrease gate does not fire |
| Open set stays equal while fingerprints change | Architecture replan occurs and the second non-decreasing generation enters `NO_PROGRESS` |
| Task is renamed after rejection | Branch counters and executor attempts remain unchanged; extra attempt is rejected |
| Reviewer invents a requirement | Review cannot schedule correction until mapped or classified as normative `NEW_EVIDENCE` |
| Independent DAG task is ready | Independent task dispatches while affected dependents remain blocked |
| Second reviewer is requested without declared risk | Dispatch is rejected before spawn |
| Host restarts before or after state reference | Orphan is inert; referenced generation resumes the same pending transition exactly once |
| A different session resumes | Candidate, proofs, counters and next task match the prior session byte for byte |
| State has `PAUSED_DIAGNOSTIC` and null payload | Canonical-state validation fails; no dispatch starts |
| Technical correction has one proved option | No human prompt is emitted |
| Trust or UX evidence admits two valid behaviors | `NORMATIVE_DECISION` asks for the exact product choice |
| Task 0 migration runs | Both residuals become technical fingerprints and the next RED task is pending without rewriting old ledgers |

## Challenge pass

The first thesis was that independent RED tests would remove the review loop. That is too strong. A pre-implementation oracle can still miss a host-restart or boundary interaction, so rolling recovery remains necessary.

The opposite thesis, that any new fingerprint proves progress, also fails. A reviewer could emit endless distinct examples at the same boundary. The stable boundary key, architecture replan and two-generation open-set rule close that loop. Requirement mapping prevents a reviewer from manufacturing work. Stable branch identity prevents task renaming from buying attempts. Rotation accounting prevents a fresh executor from hiding no progress. DAG-local blocking preserves unrelated work. Append-only generation publication plus an atomic state reference makes host restart recoverable without treating an orphan as authority.

The remaining hypothesis is empirical: independent RED authors should reduce late review rejection. The implementation plan should capture review timing and classification counts so later runs can confirm or falsify it without making those metrics a gate for this contract.
