# SOMA hybrid diagnostic recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the terminal diagnostic pause with independent frozen RED creation, bounded automatic recovery, canonical v3 continuity and an idempotent migration that resumes the active Task 0 run without a human gate.

**Architecture:** Six execution pairs separate adversarial tests from production changes. Each RED author commits only tests, fixtures and proof metadata against an immutable candidate; the next implementer receives those bytes frozen and may change only production. Pure recovery policy feeds an append-only generation store, a dispatch-aware state machine and exact-once resume logic; run-state remains the canonical locator, while dispatch records remain the only agent ledger.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, Node built-ins only, atomic filesystem replace, SHA-256 canonical JSON, existing transactional installer. No new dependency.

---

## Verified baseline and constraints

- The approved design is `docs/superpowers/specs/2026-08-26-soma-hybrid-diagnostic-recovery-design.md` and defines AC-01 through AC-12 plus 15 behavioral scenarios.
- `core/scripts/run/state.cjs` writes `soma-state/v2`; `resume.cjs` is read-only and derives only the old step reentry; `dispatch-record.cjs` enforces 8,000-byte prompts, 4,000-byte outputs and attempt numbers 1 or 2.
- The active state file is currently `soma-state/v2` with `currentState: "STEP_1B_PLAN"`, `previousState: "STEP_1A_SPECIFY"`, empty counters and `pausedDiagnostic: null`. This differs from the older observation in the design. Migration must therefore reconstruct recovery from verified Task 0 artifacts, not from either narrative step field or `pausedDiagnostic`.
- `.soma/diagnostics/run-260825-universal-entry-7f3c2a-task0-identity.json` names candidate `75a1296441bc0a678aaffbe47ea496975abbfd94` and two residual findings. The matching attempt-2 implementation and review records exist and identify `impl_task0_baseline` and `review_impl_task0_spec`.
- The codebase-memory graph is not loaded for this worktree. Discovery used the allowed `rg` fallback and direct file reads.
- `.soma/` is pre-existing untracked runtime data. Implementation commits must never add it. The migration task may mutate only the active run-state and new `.soma/recovery/<runId>/` artifacts after focused GREEN.
- The recovery design supersedes `Stop eficiente`. Existing prompt, output and reviewer budgets remain unchanged.

## Execution contract for every pair

1. Record every RED, implementation and review dispatch with `soma run dispatch-record begin` before spawn and `end` before transition. Keep the exact prompt under 8,000 bytes and conversational output under 4,000 bytes.
2. The RED author records the candidate SHA, exact command, failure identity and SHA-256 of every fixture and test file in a `soma-red-proof/v1` JSON artifact in the dispatch record. The test commit is then frozen.
3. The implementer must differ from the RED author, must start from that immutable candidate plus test commit, and must not edit, replace, skip or weaken the frozen test or fixture. A false oracle produces `DIAGNOSTIC_REPLAN`; it does not authorize an implementation rewrite of the oracle.
4. Run focused GREEN, declared regressions and `git diff --check` before the review dispatch. One integrated reviewer reads the same immutable implementation commit and frozen proof. No pair declares an independent second-reviewer risk, so a second reviewer is forbidden throughout this plan.
5. A reviewer finding names an AC or invariant. Otherwise it is `NEW_EVIDENCE` with a minimal reproduction and observed result. Prose alone cannot schedule a correction.

## Stable schemas and module contracts

Use these exact names across all tasks.

```js
// core/scripts/run/recovery-model.cjs
canonicalJson(value) -> string                         // recursively sorted keys, LF, one trailing LF
sha256Hex(bytesOrString) -> lowercase 64-hex
fingerprintFinding(input) -> { fingerprint, canonicalJson }
classifyFinding(input) -> { classification, requirementRef }
computeProgress({ previousOpen, currentOpen, strongerRed, closed }) -> progressDelta
evaluateNoProgress({ generations, fingerprint, executors }) -> { stop, reason }

// core/scripts/run/recovery-store.cjs
validateStateV3(state) -> { valid, violations }
migrateStateV2(v2, diagnosticRecovery) -> stateV3
readStateV3({ projectRoot, runId }) -> stateV3
publishRecoveryGeneration({ projectRoot, runId, expectedStateSha256, generation, fault })
  -> { state, generationPath, generationSha256, semanticSha256, adopted }

// core/scripts/run/recovery-machine.cjs
planRecoveryTransition({ state, event, dispatchRecords }) -> { nextState, effect }
authorizeRecoveryDispatch({ state, intent, dispatchRecords }) -> { allowed, code, reason }

// core/scripts/run/recovery-continuity.cjs
selectRunnableTasks({ taskGraph, branches }) -> { runnable, blocked }
inspectPendingTransition({ state, dispatchRecord }) -> 'completed'|'active'|'missing'
buildRecoveryHandoff({ state, projectRoot }) -> soma-recovery-handoff/v1
resumeRecovery({ projectRoot, runId, activeDispatchIds }) -> { action, transitionKey, command }
```

Canonical fingerprint input is exactly:

```json
{
  "$schema": "soma-finding-fingerprint/v1",
  "requirementRef": "AC or invariant identifier",
  "minimalReproduction": {"command": ["exact", "argv"], "fixtureSha256": "64-hex"},
  "boundary": "canonical module, contract or state-transition identifier",
  "observedResult": {"errorIdentity": "stable value", "resultSha256": "64-hex"}
}
```

Task name, executor, candidate SHA, timestamps, duration, TAP ordinal and prose title never enter these bytes. The canonical empty fixture is `{}\n`, SHA-256 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`.

`soma-state/v3` is a strict field-preserving superset of v2. It adds only:

```json
{
  "$schema": "soma-state/v3",
  "diagnosticRecovery": {
    "terminalCondition": {"kind": "finish", "active": true},
    "taskGraph": [],
    "branches": []
  }
}
```

Each open branch keeps the design's minimum fields and adds `fingerprintHistory`, `dependencyClosure`, `reviewPlan.declaredRisks` and a stable `transitionKey`. `RED_PENDING` permits `executorRotation.originalExecutor: null`; assigning the first explicit correction sets it. Automatic states require non-null `nextTask` and null `humanGate`. `HUMAN_GATE` requires the inverse. A state with `currentState: "PAUSED_DIAGNOSTIC"` and null `pausedDiagnostic` is invalid.

Generation files live at `.soma/recovery/<runId>/<generation padded to 4 digits>.json`. Publication order is immutable generation write plus file/directory sync, then atomic run-state replacement. Readers use only the state reference. An unreferenced file is inert and may be adopted only when its semantic hash matches the exact expected generation.

Recovery dispatches extend the existing ledger with `intent.json` at begin:

```json
{
  "$schema": "soma-dispatch-intent/v1",
  "role": "RED",
  "agentId": "agent-id",
  "branchId": "stable-branch-id",
  "generation": 1,
  "transitionKey": "stable-key",
  "candidateSha": "git-sha",
  "frozenRedSha256": null,
  "declaredRisk": null
}
```

Allowed roles are `RED`, `IMPLEMENTER` and `INTEGRATED_REVIEW`. Recovery flags are optional for legacy dispatches and mandatory as a coherent set for recovery dispatches. `intent.json`, `prompt.md`, `output.md` and `metadata.json` all remain under `.soma/dispatches`; no recovery artifact copies prompt or output history.

## File map and dependency order

| Pair | RED-only write set | Production-only write set | Depends on |
| --- | --- | --- | --- |
| A: model | `run-recovery-model.test.cjs`, model fixtures | `run/recovery-model.cjs` | none |
| B: v3 store | `run-recovery-store.test.cjs`, state fixtures | `run/recovery-store.cjs`, `run/state.cjs`, `run/paths.cjs` | A |
| C: machine and dispatch | `run-recovery-machine.test.cjs`, `run-dispatch-record.test.cjs` | `run/recovery-machine.cjs`, `run/dispatch-record.cjs` | A, B |
| D: DAG and resume | `run-recovery-continuity.test.cjs`, `run-resume.test.cjs` | `run/recovery-continuity.cjs`, `run/recovery.cjs`, `run/resume.cjs`, `run.cjs` | B, C |
| E: policy and install | `hybrid-recovery-protocol.test.cjs`, protocol/install transaction tests | adapters, protocol docs, manifest and install targets listed in Task 14 | C, D |
| F: active migration | `run-recovery-task0-migration.test.cjs`, migration fixtures | `run/migrations/task0-identity.cjs` | A through E |

The pairs run serially in that order. Within a pair, RED precedes implementation and review. Tests never share a production write set. The universal-entry implementation plan must rebase after this plan because its future run-state, dispatch and resume tasks depend on v3 and must not restore v2 assumptions.

### Task 1: Pair A RED author freezes fingerprint, classification and progress oracles

**Files:**

- Create: `core/scripts/__tests__/run-recovery-model.test.cjs`
- Create: `core/scripts/__tests__/fixtures/recovery/model/same-finding-a.json`
- Create: `core/scripts/__tests__/fixtures/recovery/model/same-finding-transient-fields.json`
- Create: `core/scripts/__tests__/fixtures/recovery/model/new-counterexample.json`
- Create: `.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RECOVERY-A-RED/red-proof.json` at runtime only

- [ ] **Step 1: Write adversarial tests, without production code**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  fingerprintFinding,
  computeProgress,
} = require('../run/recovery-model.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'model');
const readFixture = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const sameFindingA = readFixture('same-finding-a.json');
const sameFindingTransientFields = readFixture('same-finding-transient-fields.json');
const newCounterexample = readFixture('new-counterexample.json');

test('canonical fingerprint ignores task, executor, candidate, time, duration and TAP ordinal', () => {
  const a = fingerprintFinding(sameFindingA);
  const b = fingerprintFinding(sameFindingTransientFields);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
});

test('new minimal counterexample gets a new fingerprint and generation', () => {
  assert.notEqual(
    fingerprintFinding(sameFindingA).fingerprint,
    fingerprintFinding(newCounterexample).fingerprint
  );
});

test('open-set progress is mathematical, not prose or task names', () => {
  assert.equal(computeProgress({ previousOpen: ['a', 'b'], currentOpen: ['b'], strongerRed: false, closed: ['a'] }).setDecreased, true);
  assert.equal(computeProgress({ previousOpen: ['a'], currentOpen: ['b'], strongerRed: false, closed: [] }).setDecreased, false);
});
```

Also cover recursive key sorting, array-order preservation, CRLF-to-LF normalization, the empty fixture hash, `TECHNICAL_DETERMINISTIC`, `EVIDENCE_DEFICIENT`, all four human gate classes, unmapped reviewer requirements, same-fingerprint two-executor exhaustion and two consecutive non-decreasing open sets with changing fingerprints.

- [ ] **Step 2: Run RED against candidate `878852851c4531baa0848a5c877652d86fc553f3`**

Run: `node --test core/scripts/__tests__/run-recovery-model.test.cjs`

Expected: FAIL with `MODULE_NOT_FOUND` for `../run/recovery-model.cjs`. Record command, candidate SHA, test/fixture hashes and this exact failure identity in `soma-red-proof/v1`.

- [ ] **Step 3: Commit only frozen tests and fixtures**

```bash
git add core/scripts/__tests__/run-recovery-model.test.cjs core/scripts/__tests__/fixtures/recovery/model
git commit -m "test(recovery): freeze finding identity policy"
```

### Task 2: Pair A implementer adds the pure recovery model

**Files:**

- Create: `core/scripts/run/recovery-model.cjs`

- [ ] **Step 1: Verify frozen bytes and run the inherited RED**

Run: `shasum -a 256 core/scripts/__tests__/run-recovery-model.test.cjs core/scripts/__tests__/fixtures/recovery/model/*.json && node --test core/scripts/__tests__/run-recovery-model.test.cjs`

Expected: hashes match Task 1 proof; test still fails because production is absent.

- [ ] **Step 2: Implement only the exported pure functions**

```js
module.exports = {
  canonicalJson,
  sha256Hex,
  fingerprintFinding,
  classifyFinding,
  computeProgress,
  evaluateNoProgress,
  EMPTY_FIXTURE_SHA256,
};
```

Use no filesystem, clock, environment, task ID or agent lookup in this module. `classifyFinding` rejects a review lacking requirement mapping unless it carries `NEW_EVIDENCE` plus minimal reproduction and observed result. `evaluateNoProgress` stops after the same fingerprint survives the rotated executor's correction or after two consecutive generations whose sorted unique open set does not shrink.

- [ ] **Step 3: Run GREEN and model regressions**

Run: `node --test core/scripts/__tests__/run-recovery-model.test.cjs core/scripts/__tests__/run.test.cjs`

Expected: PASS.

- [ ] **Step 4: Commit production only**

```bash
git add core/scripts/run/recovery-model.cjs
git commit -m "feat(recovery): add canonical finding policy"
```

### Task 3: Pair A integrated review

**Files:** read-only Task 1 and Task 2 commits.

- [ ] **Step 1: Re-run deterministic checks on the immutable candidate**

Run: `node --test core/scripts/__tests__/run-recovery-model.test.cjs core/scripts/__tests__/run.test.cjs && git diff --check HEAD~1 HEAD`

Expected: PASS and no whitespace errors.

- [ ] **Step 2: Review AC-02, AC-03, AC-05, AC-06 and AC-10**

Attempt to falsify key sorting, transient-field exclusion, requirement mapping and both anti-loop branches. Return `APPROVED` or findings mapped to an AC/invariant. Do not write files. Record one `INTEGRATED_REVIEW` dispatch; a second review dispatch must be rejected.

### Task 4: Pair B RED author freezes v3, generation and orphan behavior

**Files:**

- Create: `core/scripts/__tests__/run-recovery-store.test.cjs`
- Create: `core/scripts/__tests__/fixtures/recovery/state/v2-valid.json`
- Create: `core/scripts/__tests__/fixtures/recovery/state/v2-paused-null.json`
- Create: `core/scripts/__tests__/fixtures/recovery/state/v3-red-pending.json`

- [ ] **Step 1: Write filesystem-backed RED tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  migrateStateV2,
  publishRecoveryGeneration,
} = require('../run/recovery-store.cjs');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('v3 migration preserves every v2 field byte-for-value and adds diagnosticRecovery', () => {
  const v2 = readJson(path.join(__dirname, 'fixtures', 'recovery', 'state', 'v2-valid.json'));
  const recovery = readJson(path.join(__dirname, 'fixtures', 'recovery', 'state', 'v3-red-pending.json')).diagnosticRecovery;
  const v3 = migrateStateV2(v2, recovery);
  for (const [key, value] of Object.entries(v2)) {
    if (key !== '$schema') assert.deepEqual(v3[key], value);
  }
  assert.equal(v3.$schema, 'soma-state/v3');
});

test('publish-before-reference orphan is inert and equal semantic hash is adopted once', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-recovery-store-'));
  const runId = 'run-store-orphan';
  const runStateFile = path.join(projectRoot, '.soma', `run-state-${runId}.json`);
  const originalState = readJson(path.join(__dirname, 'fixtures', 'recovery', 'state', 'v3-red-pending.json'));
  originalState.runId = runId;
  fs.mkdirSync(path.dirname(runStateFile), { recursive: true });
  fs.writeFileSync(runStateFile, `${JSON.stringify(originalState, null, 2)}\n`);
  const input = {
    projectRoot,
    runId,
    expectedStateSha256: sha256File(runStateFile),
    generation: { ...originalState.diagnosticRecovery.branches[0], generation: 1 },
  };
  assert.throws(() => publishRecoveryGeneration({ ...input, fault: 'after-generation-rename' }), /INJECTED/);
  assert.deepEqual(readJson(runStateFile), originalState);
  const retried = publishRecoveryGeneration(input);
  assert.equal(retried.adopted, true);
  assert.equal(fs.readdirSync(path.join(projectRoot, '.soma', 'recovery', runId)).filter(name => name.endsWith('.json')).length, 1);
});
```

Cover strict branch nullability, automatic versus human-gate payloads, immutable existing generation bytes, wrong semantic-hash orphan rejection, atomic state replacement, readers ignoring directory-only artifacts and rejection of `PAUSED_DIAGNOSTIC` plus null payload. Use real temp directories and no mocks.

- [ ] **Step 2: Run RED**

Run: `node --test core/scripts/__tests__/run-recovery-store.test.cjs`

Expected: FAIL with `MODULE_NOT_FOUND` for `recovery-store.cjs`. Freeze test and fixture hashes in the RED proof.

- [ ] **Step 3: Commit tests only**

```bash
git add core/scripts/__tests__/run-recovery-store.test.cjs core/scripts/__tests__/fixtures/recovery/state
git commit -m "test(recovery): freeze v3 publication contract"
```

### Task 5: Pair B implementer adds state v3 and immutable generation storage

**Files:**

- Create: `core/scripts/run/recovery-store.cjs`
- Modify: `core/scripts/run/state.cjs`
- Modify: `core/scripts/run/paths.cjs`

- [ ] **Step 1: Reproduce frozen RED without changing tests**

Run: `node --test core/scripts/__tests__/run-recovery-store.test.cjs`

Expected: the same missing-module failure as Task 4.

- [ ] **Step 2: Extend paths and state APIs**

`resolveSomaPaths(projectRoot, runId)` must add `recoveryDir` and `runRecoveryDir`. `state.cjs` must initialize new runs directly as v3, retain `appendReport`, and export:

```js
module.exports = {
  appendReport,
  readRunState,
  writeRunStateAtomic,
  validateRunState,
  migrateStateV2,
};
```

Existing v2 readers remain supported only through explicit migration; mutation of a v2 state without migration fails closed.

- [ ] **Step 3: Implement generation publication and semantic adoption**

Hash canonical semantic content without path or publication time. Write a no-clobber temporary sibling, sync bytes, rename to the padded immutable path, sync its directory, then atomically replace state with the artifact reference. If the process fails after generation publication, retry may adopt that exact orphan only after verifying semantic hash and expected prior state hash.

- [ ] **Step 4: Run GREEN and v2 regressions**

Run: `node --test core/scripts/__tests__/run-recovery-store.test.cjs core/scripts/__tests__/run-state.test.cjs core/scripts/__tests__/contract-run-state.test.cjs core/scripts/__tests__/run-report.test.cjs core/scripts/__tests__/run-retention.test.cjs`

Expected: PASS. The legacy v2 fixture migrates, existing report and retention behavior remains green.

- [ ] **Step 5: Commit production only**

```bash
git add core/scripts/run/recovery-store.cjs core/scripts/run/state.cjs core/scripts/run/paths.cjs
git commit -m "feat(recovery): persist v3 diagnostic generations"
```

### Task 6: Pair B integrated review

**Files:** read-only Task 4 and Task 5 commits.

- [ ] **Step 1: Run deterministic store checks**

Run: `node --test core/scripts/__tests__/run-recovery-store.test.cjs core/scripts/__tests__/run-state.test.cjs core/scripts/__tests__/contract-run-state.test.cjs && git diff --check HEAD~1 HEAD`

Expected: PASS.

- [ ] **Step 2: Review AC-07 and AC-08 with crash injection**

Verify publication ordering, orphan inertness, exact state references, field preservation and absence of prompts/outputs from generations. One integrated review only.

### Task 7: Pair C RED author freezes recovery transitions and dispatch authorization

**Files:**

- Create: `core/scripts/__tests__/run-recovery-machine.test.cjs`
- Modify: `core/scripts/__tests__/run-dispatch-record.test.cjs`

- [ ] **Step 1: Write transition table tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planRecoveryTransition } = require('../run/recovery-machine.cjs');

const fingerprint = 'a'.repeat(64);
const dispatchRecords = [
  { role: 'IMPLEMENTER', agentId: 'original', attempt: 2, result: 'done' },
  { role: 'IMPLEMENTER', agentId: 'rotated', attempt: 2, result: 'done' },
];
const branchState = overrides => ({
  branchId: 'branch-stable',
  state: 'REVIEWING',
  fingerprint,
  openFindings: [{ fingerprint, requirementRef: 'AC-03' }],
  executorRotation: {
    originalExecutor: 'original',
    rotatedExecutor: null,
    rotationsUsed: 0,
    attemptsByExecutor: { original: 2 },
  },
  ...overrides,
});
const survivedOriginal = { type: 'REVIEW_FINDING', fingerprint, requirementRef: 'AC-03' };
const survivedRotated = { type: 'REVIEW_FINDING', fingerprint, requirementRef: 'AC-03' };

test('same fingerprint surviving original correction schedules one rotated executor', () => {
  const out = planRecoveryTransition({ state: branchState({}), event: survivedOriginal, dispatchRecords });
  assert.equal(out.nextState.nextTask.kind, 'RED');
  assert.equal(out.nextState.executorRotation.rotationsUsed, 1);
});

test('same fingerprint surviving rotated correction enters NO_PROGRESS', () => {
  const rotatedCorrected = branchState({
    executorRotation: {
      originalExecutor: 'original',
      rotatedExecutor: 'rotated',
      rotationsUsed: 1,
      attemptsByExecutor: { original: 2, rotated: 2 },
    },
  });
  const out = planRecoveryTransition({ state: rotatedCorrected, event: survivedRotated, dispatchRecords });
  assert.equal(out.nextState.state, 'HUMAN_GATE');
  assert.equal(out.nextState.classification, 'NO_PROGRESS');
});
```

Cover new fingerprint after correction, technical and evidence-deficient automatic branches, evidence disproved as not reproducible, a technical correction with one proved option emitting no human request, all four human gate classes, task rename preserving `{runId,branchId,fingerprint,executorId}` counters, different fingerprints on the same boundary forcing architecture replan, and equal open sets forcing `NO_PROGRESS` on the second generation. For gate payloads, assert:

- `NORMATIVE_DECISION` includes unresolved rule, evidence, no more than three materially different choices and the exact choice required.
- `SCOPE_AUTHORITY` includes protected boundary, requested action, expected effect and exact approval.
- `CONTRADICTORY_REQUIREMENTS` includes both requirement IDs, conflicting behavior and the exact precedence question.
- `NO_PROGRESS` includes fingerprint or two-generation set history, both executor proofs, architecture replan result and the choice among architecture, scope or termination.
- Every rendered decision request is at most 4,000 UTF-8 bytes.

- [ ] **Step 2: Extend dispatch RED tests**

Add real CLI cases for RED author equals implementer, attempt reset via task rename, undeclared second reviewer, one predeclared independent second risk allowed exactly once, reviewer without AC/invariant, frozen RED hash mismatch, prompt/output exact limits and legacy non-recovery compatibility. Assert rejected `begin` writes neither `intent.json` nor `prompt.md`.

- [ ] **Step 3: Run RED**

Run: `node --test core/scripts/__tests__/run-recovery-machine.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs`

Expected: missing `recovery-machine.cjs` plus failed recovery-flag assertions in the existing dispatcher. Freeze hashes.

- [ ] **Step 4: Commit tests only**

```bash
git add core/scripts/__tests__/run-recovery-machine.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs
git commit -m "test(recovery): freeze dispatch and rotation policy"
```

### Task 8: Pair C implementer wires state machine policy into dispatch-record

**Files:**

- Create: `core/scripts/run/recovery-machine.cjs`
- Modify: `core/scripts/run/dispatch-record.cjs`

- [ ] **Step 1: Reproduce frozen RED**

Run: `node --test core/scripts/__tests__/run-recovery-machine.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs`

Expected: same failures as Task 7.

- [ ] **Step 2: Implement pure transition and authorization tables**

`planRecoveryTransition` must never write. It preserves branch identity across task rename/split, applies attempts per stable budget key, schedules one rotation, demands architecture replan for distinct fingerprints on one boundary and creates human-gate payloads only for the four allowed classes.

- [ ] **Step 3: Extend `dispatch-record begin` atomically**

Accept optional `--role`, `--agent`, `--branch`, `--generation`, `--transition-key`, `--candidate`, `--frozen-red-sha256` and `--declared-risk`. When any is present, resolve state v3, validate the coherent set, call `authorizeRecoveryDispatch`, then atomically write `intent.json` and `prompt.md`. `end` cross-checks intent against metadata. Keep `MAX_PROMPT_BYTES = 8000`, `MAX_OUTPUT_BYTES = 4000` and per-dispatch attempt 1 or 2.

- [ ] **Step 4: Run GREEN and ledger regressions**

Run: `node --test core/scripts/__tests__/run-recovery-machine.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/contract-dispatch-record.test.cjs core/scripts/__tests__/run-validator-invariant.test.cjs`

Expected: PASS. Existing three-artifact consumers remain valid; recovery dispatches add intent inside the same ledger.

- [ ] **Step 5: Commit production only**

```bash
git add core/scripts/run/recovery-machine.cjs core/scripts/run/dispatch-record.cjs
git commit -m "feat(recovery): enforce bounded dispatch rotation"
```

### Task 9: Pair C integrated review

**Files:** read-only Task 7 and Task 8 commits.

- [ ] **Step 1: Run deterministic transition and dispatch checks**

Run: `node --test core/scripts/__tests__/run-recovery-machine.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/contract-dispatch-record.test.cjs && git diff --check HEAD~1 HEAD`

Expected: PASS.

- [ ] **Step 2: Review AC-01 through AC-06, AC-08, AC-10 and AC-12**

Use the behavioral cases as falsifiers. Confirm a second reviewer without predeclared risk fails before spawn and unmapped review prose cannot authorize a correction.

### Task 10: Pair D RED author freezes DAG, restart, resume and handoff continuity

**Files:**

- Create: `core/scripts/__tests__/run-recovery-continuity.test.cjs`
- Modify: `core/scripts/__tests__/run-resume.test.cjs`

- [ ] **Step 1: Write DAG and terminal-condition tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectRunnableTasks } = require('../run/recovery-continuity.cjs');

const taskGraph = [
  { taskId: 'T-AFFECTED', dependsOn: [], status: 'blocked', recoveryBranchId: 'branch-a' },
  { taskId: 'T-DOWNSTREAM', dependsOn: ['T-AFFECTED'], status: 'pending' },
  { taskId: 'T-INDEPENDENT', dependsOn: [], status: 'pending' },
];
const humanGatedBranch = {
  branchId: 'branch-a',
  state: 'HUMAN_GATE',
  dependencyClosure: ['T-AFFECTED', 'T-DOWNSTREAM'],
};

test('a recovery branch blocks only its dependency closure', () => {
  const out = selectRunnableTasks({ taskGraph, branches: [humanGatedBranch] });
  assert.deepEqual(out.runnable, ['T-INDEPENDENT']);
  assert.deepEqual(out.blocked.sort(), ['T-AFFECTED', 'T-DOWNSTREAM']);
});

test('global WAITING_HUMAN_GATE appears only with no independent runnable task', () => {
  const resumeWithIndependent = { currentState: selectRunnableTasks({ taskGraph, branches: [humanGatedBranch] }).runnable.length ? 'DIAGNOSTIC_REPLAN' : 'WAITING_HUMAN_GATE' };
  const resumeWithoutIndependent = { currentState: selectRunnableTasks({ taskGraph: taskGraph.filter(task => task.taskId !== 'T-INDEPENDENT'), branches: [humanGatedBranch] }).runnable.length ? 'DIAGNOSTIC_REPLAN' : 'WAITING_HUMAN_GATE' };
  assert.notEqual(resumeWithIndependent.currentState, 'WAITING_HUMAN_GATE');
  assert.equal(resumeWithoutIndependent.currentState, 'WAITING_HUMAN_GATE');
});
```

- [ ] **Step 2: Write host and session restart tests**

Cover restart before generation reference, restart after pending task record, matching completed dispatch adoption, matching active dispatch wait, missing dispatch start exactly once, no rotation/attempt allocation on host change, byte-identical candidate/proofs/counters/nextTask across sessions, task rename and canonical resume command.

- [ ] **Step 3: Write handoff and corruption tests**

Assert `soma-recovery-handoff/v1` contains branch, generation path/hash, pending transition and `soma run recovery resume --run <runId>`, fits 4,000 UTF-8 bytes and contains no prompt/output ledger. Resume from `PAUSED_DIAGNOSTIC` plus null payload must fail before dispatch.

- [ ] **Step 4: Run RED and commit tests**

Run: `node --test core/scripts/__tests__/run-recovery-continuity.test.cjs core/scripts/__tests__/run-resume.test.cjs`

Expected: missing continuity module and old resume output lacking recovery action.

```bash
git add core/scripts/__tests__/run-recovery-continuity.test.cjs core/scripts/__tests__/run-resume.test.cjs
git commit -m "test(recovery): freeze overnight continuity"
```

### Task 11: Pair D implementer adds the recovery CLI and exact-once resume

**Files:**

- Create: `core/scripts/run/recovery-continuity.cjs`
- Create: `core/scripts/run/recovery.cjs`
- Modify: `core/scripts/run/resume.cjs`
- Modify: `core/scripts/run.cjs`

- [ ] **Step 1: Reproduce frozen RED**

Run: `node --test core/scripts/__tests__/run-recovery-continuity.test.cjs core/scripts/__tests__/run-resume.test.cjs`

Expected: same Task 10 failures.

- [ ] **Step 2: Add the recovery verb with an exact CLI**

```text
soma run recovery advance --run <runId> --event-file <path>
soma run recovery resume --run <runId>
soma run recovery migrate --run <runId> --profile task0-identity --diagnostic <path> --candidate <sha> [--dry-run]
```

`advance` validates and publishes one generation. `resume` follows state references and returns `adopt-completed`, `wait-active` or `start-missing` with the existing transition key. `migrate` dynamically loads the named built-in profile; it never accepts an arbitrary module path.

- [ ] **Step 3: Implement DAG-local blocking and handoff derivation**

Keep terminal conditions active through generations. Derive handoff from state plus referenced generation and exact dispatch paths. Do not enumerate recovery files to infer truth.

- [ ] **Step 4: Make legacy resume recovery-aware**

For v3 with an open recovery branch, `soma run resume --run` delegates to recovery inspection and remains mutation-free. For v2 or v3 without recovery, preserve current report-based output. Corrupt paused state fails closed.

- [ ] **Step 5: Run GREEN and regressions**

Run: `node --test core/scripts/__tests__/run-recovery-continuity.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/contract-run-state.test.cjs core/scripts/__tests__/run.test.cjs`

Expected: PASS, including independent DAG and both host-restart windows.

- [ ] **Step 6: Commit production only**

```bash
git add core/scripts/run/recovery-continuity.cjs core/scripts/run/recovery.cjs core/scripts/run/resume.cjs core/scripts/run.cjs
git commit -m "feat(recovery): resume pending generations exactly once"
```

### Task 12: Pair D integrated review

**Files:** read-only Task 10 and Task 11 commits.

- [ ] **Step 1: Run deterministic continuity checks**

Run: `node --test core/scripts/__tests__/run-recovery-continuity.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/contract-run-state.test.cjs && git diff --check HEAD~1 HEAD`

Expected: PASS.

- [ ] **Step 2: Review AC-07, AC-09 and restart scenarios**

Kill at both publication windows, rename a task, resume from a new session and verify the same transition key and budgets. Confirm independent work continues beside a human-gated branch.

### Task 13: Pair E RED author freezes adapter precedence, protocol and transactional installation

**Files:**

- Create: `core/scripts/__tests__/hybrid-recovery-protocol.test.cjs`
- Modify: `core/scripts/__tests__/efficient-orchestration-protocol.test.cjs`
- Modify: `core/scripts/__tests__/install-targets-set.test.cjs`
- Modify: `install/__tests__/global-install-transaction.test.cjs`

- [ ] **Step 1: Replace old protocol assertions with the approved precedence**

Assert Codex, `_global`, Claude command/reference, constitution, STSD, 10-step protocol, architecture and quickstart all describe `DIAGNOSTIC_REPLAN` as active, RED independence, one rotation, the four human gates, dispatch-record as the sole ledger and 8,000/4,000-byte budgets. Assert the old sentence "blocker residual ... PAUSED_DIAGNOSTIC ... sem novo agente automático" no longer governs any canonical source.

- [ ] **Step 2: Freeze Claude reference and install tests**

Require `core/adapters/claude/references/soma-run-orchestration.md` and an exact `kind:"file"` target at `~/.claude/references/soma-run-orchestration.md`. Update the real inventory expectation to 19 hooks, 13 commands and one reference. In the global transaction test, inject faults after core copy and file sync and compare the reference's prior hash or absence with the rolled-back state.

- [ ] **Step 3: Run RED**

Run: `node --test core/scripts/__tests__/hybrid-recovery-protocol.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs`

Expected: FAIL on old stop text, missing reference and missing install target.

- [ ] **Step 4: Commit tests only**

```bash
git add core/scripts/__tests__/hybrid-recovery-protocol.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
git commit -m "test(recovery): freeze adapter and install precedence"
```

### Task 14: Pair E implementer updates canonical policy and transactional targets

**Files:**

- Modify: `core/adapters/codex/AGENTS.md`
- Modify: `core/adapters/_global/AGENTS.md`
- Modify: `core/adapters/claude/commands/soma-run.md`
- Modify: `core/adapters/claude/commands/dispatch.md`
- Create: `core/adapters/claude/references/soma-run-orchestration.md`
- Modify: `core/adapters/claude/install-targets.json`
- Modify: `core/docs/soma-stsd.md`
- Modify: `core/docs/10-step-protocol.md`
- Modify: `core/docs/constitution.md`
- Create: `core/docs/constitution-amendments/1.4.0-hybrid-diagnostic-recovery.md`
- Modify: `core/adapters/claude/commands/sonar-audit.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/QUICKSTART.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `core/manifest.json`

- [ ] **Step 1: Verify RED and freeze test hashes**

Run: `node --test core/scripts/__tests__/hybrid-recovery-protocol.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs`

Expected: same Task 13 failures.

- [ ] **Step 2: Publish amendment 1.4.0 and remove old precedence**

The amendment must explicitly supersede Article X and Amendment 1.3.0 only for diagnostic recovery. Preserve the two attempts per executor, one reviewer by default, optional predeclared second risk, dispatch ledger and byte budgets. Update the constitution header and Article X to the hybrid state machine.

- [ ] **Step 3: Align Codex, global and Claude sources**

Replace `Stop eficiente` in `core/adapters/codex/AGENTS.md`; update the anchored block version and checksum. Rewrite `_global` failure recovery. Move the long state-machine body into the new Claude orchestration reference and keep the command's dispatch entry concise, with the same current public behavior. Both must require independent RED before implementation and automatic technical recovery. `dispatch.md` must emit role, agent, branch, generation and transition-key flags for recovery dispatches.

- [ ] **Step 4: Add the transactionally installed reference**

Add exactly:

```json
{
  "kind": "file",
  "source_path": "adapters/claude/references/soma-run-orchestration.md",
  "target_path": "~/.claude/references/soma-run-orchestration.md"
}
```

The existing global transaction derives its snapshot allowlist from install targets, so no second writer is added. Update `core/manifest.json` SHA-256 entries for constitution, STSD, protocol and Codex source after content stabilizes.

- [ ] **Step 5: Run GREEN and transactional regressions**

Run: `node --test core/scripts/__tests__/hybrid-recovery-protocol.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs core/scripts/__tests__/install-targets-set.test.cjs core/scripts/__tests__/install-files-e2e.test.cjs install/__tests__/global-install-transaction.test.cjs`

Expected: PASS. Fault injection restores the reference bytes or absence, and no `rsync` writer appears for it.

- [ ] **Step 6: Commit production and docs only**

```bash
git add core/adapters/codex/AGENTS.md core/adapters/_global/AGENTS.md core/adapters/claude/commands/soma-run.md core/adapters/claude/commands/dispatch.md core/adapters/claude/references/soma-run-orchestration.md core/adapters/claude/install-targets.json core/docs/soma-stsd.md core/docs/10-step-protocol.md core/docs/constitution.md core/docs/constitution-amendments/1.4.0-hybrid-diagnostic-recovery.md core/adapters/claude/commands/sonar-audit.md docs/ARCHITECTURE.md docs/QUICKSTART.md docs/TROUBLESHOOTING.md core/manifest.json
git commit -m "docs(recovery): supersede terminal diagnostic stop"
```

### Task 15: Pair E integrated review

**Files:** read-only Task 13 and Task 14 commits.

- [ ] **Step 1: Run protocol and transaction checks**

Run: `node --test core/scripts/__tests__/hybrid-recovery-protocol.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs && git diff --check HEAD~1 HEAD`

Expected: PASS.

- [ ] **Step 2: Review AC-01, AC-02, AC-04, AC-05, AC-08, AC-09 and AC-12**

Confirm the new rule has precedence in every installed source, the old rule survives only as historical text clearly marked superseded, transaction rollback includes the reference and no new agent ledger exists.

### Task 16: Pair F RED author freezes the active Task 0 migration

**Files:**

- Create: `core/scripts/__tests__/run-recovery-task0-migration.test.cjs`
- Create: `core/scripts/__tests__/fixtures/recovery/migration/task0-state-v2.json`
- Create: `core/scripts/__tests__/fixtures/recovery/migration/task0-diagnostic.json`
- Create: `core/scripts/__tests__/fixtures/recovery/migration/task0-dispatches.json`

- [ ] **Step 1: Copy only sanitized, deterministic facts into fixtures**

The v2 fixture must match the currently observed `STEP_1B_PLAN` state shape. The diagnostic fixture carries the exact candidate and two summaries. The dispatch fixture carries attempt, base SHA, agent, result and referenced paths for Task 0 attempt 2 and its review, without copying conversational prose into recovery state.

- [ ] **Step 2: Write idempotent dry-run and apply tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateTask0Identity } = require('../run/migrations/task0-identity.cjs');

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'recovery', 'migration');
const readFixture = name => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const evidenceFiles = projectRoot => [
  path.join(projectRoot, '.soma', 'diagnostics', 'run-260825-universal-entry-7f3c2a-task0-identity.json'),
  path.join(projectRoot, '.soma', 'dispatches', 'run-260825-universal-entry-7f3c2a', 'T-IMPL-0', 'attempt-2', 'metadata.json'),
  path.join(projectRoot, '.soma', 'dispatches', 'run-260825-universal-entry-7f3c2a', 'T-IMPL-0-SPEC-REVIEW', 'attempt-2', 'metadata.json'),
];
const snapshotLegacyEvidence = projectRoot => Object.fromEntries(evidenceFiles(projectRoot).map(file => [file, sha256File(file)]));
const migrationInput = projectRoot => ({
  projectRoot,
  runId: 'run-260825-universal-entry-7f3c2a',
  diagnosticPath: evidenceFiles(projectRoot)[0],
  candidateSha: '75a1296441bc0a678aaffbe47ea496975abbfd94',
});
const makeMigrationFixture = () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-task0-migration-'));
  const runId = 'run-260825-universal-entry-7f3c2a';
  writeJson(path.join(projectRoot, '.soma', `run-state-${runId}.json`), readFixture('task0-state-v2.json'));
  writeJson(evidenceFiles(projectRoot)[0], readFixture('task0-diagnostic.json'));
  const dispatches = readFixture('task0-dispatches.json');
  writeJson(evidenceFiles(projectRoot)[1], dispatches.implementation);
  writeJson(evidenceFiles(projectRoot)[2], dispatches.review);
  return projectRoot;
};

test('Task0 profile validates evidence and plans two technical fingerprints', () => {
  const projectRoot = makeMigrationFixture();
  const { runId, diagnosticPath, candidateSha } = migrationInput(projectRoot);
  const result = migrateTask0Identity({ projectRoot, runId, diagnosticPath, candidateSha, dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(result.state.$schema, 'soma-state/v3');
  assert.equal(result.state.currentState, 'DIAGNOSTIC_REPLAN');
  assert.equal(result.branch.state, 'RED_PENDING');
  assert.equal(result.branch.classification, 'TECHNICAL_DETERMINISTIC');
  assert.equal(result.branch.openFindings.length, 2);
  assert.equal(result.branch.humanGate, null);
});

test('second apply is byte-idempotent and never rewrites prior diagnostics or dispatches', () => {
  const projectRoot = makeMigrationFixture();
  const input = migrationInput(projectRoot);
  const first = migrateTask0Identity(input);
  const before = snapshotLegacyEvidence(projectRoot);
  const second = migrateTask0Identity(input);
  assert.equal(second.changed, false);
  assert.deepEqual(snapshotLegacyEvidence(projectRoot), before);
  assert.equal(second.generationSha256, first.generationSha256);
});
```

Also reject wrong candidate, missing or mismatched dispatch, modified diagnostic, v3 state with a different generation, and any plan that creates a human gate. Assert `nextTask` is `T-RECOVERY-TASK0-RED`, role `RED`, status `pending`, transition key stable, and requires a RED author independent from the future fresh implementer. `originalExecutor` remains null until that implementer receives the explicit target; rotations used and attempts are zero.

- [ ] **Step 3: Run RED**

Run: `node --test core/scripts/__tests__/run-recovery-task0-migration.test.cjs`

Expected: FAIL with missing `run/migrations/task0-identity.cjs`. Freeze fixture and test hashes.

- [ ] **Step 4: Commit tests only**

```bash
git add core/scripts/__tests__/run-recovery-task0-migration.test.cjs core/scripts/__tests__/fixtures/recovery/migration
git commit -m "test(recovery): freeze Task0 migration"
```

### Task 17: Pair F implementer builds and executes the Task 0 migration

**Files:**

- Create: `core/scripts/run/migrations/task0-identity.cjs`
- Runtime only: `.soma/run-state-run-260825-universal-entry-7f3c2a.json`
- Runtime only: `.soma/recovery/run-260825-universal-entry-7f3c2a/0001.json`

- [ ] **Step 1: Reproduce frozen migration RED**

Run: `node --test core/scripts/__tests__/run-recovery-task0-migration.test.cjs`

Expected: same missing-module failure.

- [ ] **Step 2: Implement the built-in idempotent profile**

Export only:

```js
module.exports = { migrateTask0Identity, PROFILE_ID: 'task0-identity' };
```

Validate run ID, v2/v3 state, candidate, diagnostic SHA and both attempt-2 dispatch records. Build one stable branch for boundary `core/scripts/test/junit-failure-set.cjs#failure-identity`, two separate fingerprints and one pending independent RED task. The generation stores proof references and hashes, never copied prompt/output history. Publish through `publishRecoveryGeneration`; do not edit JSON directly.

- [ ] **Step 3: Run focused GREEN and all recovery regressions**

Run: `node --test core/scripts/__tests__/run-recovery-task0-migration.test.cjs core/scripts/__tests__/run-recovery-*.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/run-resume.test.cjs`

Expected: PASS.

- [ ] **Step 4: Dry-run the real migration and inspect hashes**

```bash
RECOVERY_DRY_OUT="$(mktemp)"
node core/scripts/run.cjs recovery migrate \
  --run run-260825-universal-entry-7f3c2a \
  --profile task0-identity \
  --diagnostic .soma/diagnostics/run-260825-universal-entry-7f3c2a-task0-identity.json \
  --candidate 75a1296441bc0a678aaffbe47ea496975abbfd94 \
  --dry-run > "$RECOVERY_DRY_OUT"
```

Expected: exit 0; `changed:true`; two distinct 64-hex fingerprints; classification `TECHNICAL_DETERMINISTIC`; `humanGate:null`; next task `T-RECOVERY-TASK0-RED`; no filesystem hash changes.

- [ ] **Step 5: Apply once after GREEN and verify idempotency**

```bash
node core/scripts/run.cjs recovery migrate \
  --run run-260825-universal-entry-7f3c2a \
  --profile task0-identity \
  --diagnostic .soma/diagnostics/run-260825-universal-entry-7f3c2a-task0-identity.json \
  --candidate 75a1296441bc0a678aaffbe47ea496975abbfd94
node core/scripts/run.cjs recovery migrate \
  --run run-260825-universal-entry-7f3c2a \
  --profile task0-identity \
  --diagnostic .soma/diagnostics/run-260825-universal-entry-7f3c2a-task0-identity.json \
  --candidate 75a1296441bc0a678aaffbe47ea496975abbfd94
```

Expected: first call publishes and references generation `0001`; second returns `changed:false` with identical state and generation hashes. The state ends in v3 `DIAGNOSTIC_REPLAN`; the branch is `RED_PENDING` with two open technical findings, no human gate, zero rotations and pending `T-RECOVERY-TASK0-RED`. Old diagnostics and all dispatch records are byte-identical.

- [ ] **Step 6: Commit production only, never runtime `.soma`**

```bash
git add core/scripts/run/migrations/task0-identity.cjs
git commit -m "feat(recovery): migrate active Task0 diagnostic"
```

### Task 18: Pair F integrated review and automatic-resume gate

**Files:** read-only Task 16, Task 17 and active runtime artifacts.

- [ ] **Step 1: Run final deterministic suite**

Run: `node --test core/scripts/__tests__/run-recovery-*.test.cjs core/scripts/__tests__/run-state.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/hybrid-recovery-protocol.test.cjs && git diff --check HEAD~1 HEAD`

Expected: PASS.

- [ ] **Step 2: Verify the live migration without mutation**

Read state and referenced generation. Recompute their SHA-256 values and both fingerprints. Confirm candidate, two review-proof references, classification, open set, pending RED transition, zero rotation, terminal condition and no human gate. Recompute hashes for the old diagnostic and Task 0 dispatch files against the pre-apply dry-run record.

- [ ] **Step 3: Exercise resume inspection only**

Run: `node core/scripts/run.cjs recovery resume --run run-260825-universal-entry-7f3c2a`

Expected: exit 0, action `start-missing`, exact pending transition key and dispatch command for `T-RECOVERY-TASK0-RED`. This review does not spawn the RED author; approval releases the orchestrator to do so automatically with `dispatch-record begin`.

## Acceptance and behavioral traceability matrix

| Requirement | Primary tasks/tests |
| --- | --- |
| AC-01 independent frozen RED and deterministic review | 7-9, 13-15; `run-recovery-machine`, protocol tests |
| AC-02 requirement mapping or `NEW_EVIDENCE` | 1-3, 7-9 |
| AC-03 two attempts per executor, one rotation | 1-3, 7-9 |
| AC-04 active automatic technical/evidence recovery | 7-12, 16-18 |
| AC-05 only four human gate classes | 1-3, 7-9, 13-15 |
| AC-06 stable canonical fingerprints | 1-3, 10-12 |
| AC-07 v3 plus immutable referenced generation | 4-6, 10-12 |
| AC-08 dispatch ledger only | 7-9, 13-15 |
| AC-09 DAG-local blocking and cross-session terminal condition | 10-12 |
| AC-10 same-fingerprint and no-decrease anti-loop | 1-3, 7-9 |
| AC-11 active Task 0 migration and pending RED | 16-18 |
| AC-12 prompt/output/reviewer budgets | 7-9, 13-15 |

| Behavioral scenario | Exact proof |
| --- | --- |
| New finding after correction | Task 1 new-counterexample fixture plus Task 7 transition test |
| Same fingerprint survives original correction | Task 7 schedules one fresh executor |
| Same fingerprint survives rotated correction | Task 7 produces `NO_PROGRESS` with both proofs |
| Open set decreases each generation | Task 1 progress test continues recovery |
| Equal open set while fingerprints change | Task 1 plus Task 7 architecture replan and second-generation gate |
| Task rename after rejection | Task 7 stable budget-key test and Task 10 restart test |
| Reviewer invents requirement | Task 1 classification and Task 7 dispatch rejection |
| Independent DAG task ready | Task 10 `selectRunnableTasks` test |
| Undeclared second reviewer | Task 7 begin rejection before artifact write |
| Host restart before/after reference | Task 4 orphan injection and Task 10 exact-once resume |
| Different session resumes | Task 10 byte-identity test |
| `PAUSED_DIAGNOSTIC` with null payload | Task 4 validation and Task 10 no-dispatch assertion |
| Technical correction has one proved option | Task 7 asserts no human output |
| Trust/UX admits two behaviors | Task 1 classification plus exact `NORMATIVE_DECISION` request |
| Task 0 migration | Tasks 16-18 fixture, dry-run, real apply and resume inspection |

## Final integrated checks

After all six reviews approve and before any release/activation:

```bash
node --test core/scripts/__tests__/run-recovery-*.test.cjs \
  core/scripts/__tests__/run-state.test.cjs \
  core/scripts/__tests__/contract-run-state.test.cjs \
  core/scripts/__tests__/run-dispatch-record.test.cjs \
  core/scripts/__tests__/contract-dispatch-record.test.cjs \
  core/scripts/__tests__/run-resume.test.cjs \
  core/scripts/__tests__/hybrid-recovery-protocol.test.cjs \
  core/scripts/__tests__/efficient-orchestration-protocol.test.cjs \
  core/scripts/__tests__/install-targets-set.test.cjs \
  install/__tests__/global-install-transaction.test.cjs
npm test
git diff --check
git status --short
```

Expected focused result: all PASS. For `npm test`, reconcile inherited failures by identity against `.soma/baselines/universal-entry-base.json`; no new failure identity is allowed. `git status --short` may still show pre-existing `.soma/`, but implementation commits contain no runtime file. The active state must reference one immutable generation whose hash recomputes, and the next automatic action is the independent Task 0 RED dispatch, not a human gate.
