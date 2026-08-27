# SOMA residual quality correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three residual quality blockers while preserving pre-handoff status and the coordinator-only control boundary.

**Architecture:** Validate one exact run-identity snapshot before any successful durable status result and reuse it during handoff comparison. Encode rollback as an executor dispatch contract. Lock both behavioral rules and the retry doctrine with focused tests.

**Tech Stack:** Node.js CommonJS, `node:test`, Markdown contract tests, Git.

---

## File map

- Modify `core/scripts/entry/status.cjs`: exact early identity validation and single-snapshot handoff comparison.
- Modify `core/scripts/__tests__/entry-request-routing.test.cjs`: pre-handoff missing/valid identity RED cases and read-only proof.
- Modify `core/adapters/claude/references/soma-run-orchestration.md`: agent-owned rollback contract.
- Modify `core/scripts/__tests__/universal-entry-lean-adapter.test.cjs`: recovery delegation contract test.
- Modify `docs/TROUBLESHOOTING.md`: current attempt budget and durable evidence paths.
- Modify `core/scripts/__tests__/efficient-orchestration-protocol.test.cjs`: reject the old troubleshooting rule.
- Modify `docs/superpowers/reports/2026-08-27-soma-universal-entry-lean-result.md`: final candidate and proof after reviews.

### Task 1: Write and verify the RED tests

- [ ] **Step 1: Add the missing-identity status reproduction**

In `entry-request-routing.test.cjs`, create a real temporary Git project with a structurally valid `soma-state/v2` and no handoff or identity marker. Snapshot files and mtimes, call status, and assert:

```js
assert.equal(result.run.state, 'DURABLE_STATUS_INVALID');
assert.match(result.run.diagnostic, /identity/i);
assert.deepEqual(snapshotFiles(project), before);
```

- [ ] **Step 2: Add the valid pre-handoff control**

Add the exact canonical identity marker and assert status returns the run facts with null checkpoint and handoff generations while preserving the snapshot.

- [ ] **Step 3: Add recovery and doctrine contract tests**

Extract the `PAUSED_DIAGNOSTIC` section and assert it orders `dispatch-record begin`, `Agent`, and `dispatch-record end`; assigns `git reset --hard` to the executor; validates a 40-hex baseline SHA; and never tells the coordinator to run Git. Assert `docs/TROUBLESHOOTING.md` contains initial attempt plus one correction and does not contain an active three-failure rule.

- [ ] **Step 4: Run RED**

Run:

```bash
node --test core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/universal-entry-lean-adapter.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs
```

Expected: the new missing-identity, rollback delegation and troubleshooting assertions fail for the recorded causes; existing tests remain interpretable.

- [ ] **Step 5: Commit RED**

```bash
git add core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/universal-entry-lean-adapter.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs
git commit -m "test(entry): reproduce residual quality blockers"
```

### Task 2: Implement the minimal correction

- [ ] **Step 1: Add a single-snapshot identity reader**

In `status.cjs`, add an internal helper equivalent to:

```js
function readIdentityFacts(projectRoot, runId) {
  const file = path.join(projectRoot, '.soma', 'run-identities', `${runId}.json`);
  const bytes = readRegular(file);
  const value = JSON.parse(bytes);
  const canonical = `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2)}\n`;
  if (value.$schema !== 'soma-run-identity/v1' || value.runId !== runId || bytes.toString('utf8') !== canonical) {
    throw new Error('run identity is invalid');
  }
  return { bytes, path: exactRelative(projectRoot, file), sha256: sha256(bytes) };
}
```

Call it after state validation and before `readHandoffFacts()`. Pass the returned facts into `readHandoffFacts()` and compare the handoff path/hash against them without reopening the marker.

- [ ] **Step 2: Encode the rollback executor contract**

Replace the direct recovery mapping with a contract that records begin before `Agent`, closes end before transition, validates repository root and `baselineSha` against `/^[0-9a-f]{40}$/`, gives Git reads and `git reset --hard <baselineSha>` only to the executor, and keeps failure paused with no automatic extra agent.

- [ ] **Step 3: Correct troubleshooting**

Replace the three-failure cause with initial attempt plus one correction. Point recovery inspection to `.soma/diagnostics`, `.soma/checkpoints/<runId>/` and `.soma/handoffs/<runId>/`.

- [ ] **Step 4: Run GREEN**

Run the same focused command from Task 1. Expected: all tests pass.

- [ ] **Step 5: Run the affected vertical gate**

```bash
node --test core/scripts/__tests__/entry-*.test.cjs core/scripts/__tests__/universal-entry-lean-*.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/efficient-orchestration-protocol.test.cjs
git diff --check
```

Expected: zero failures and a clean whitespace check.

- [ ] **Step 6: Commit implementation**

```bash
git add core/scripts/entry/status.cjs core/adapters/claude/references/soma-run-orchestration.md docs/TROUBLESHOOTING.md
git commit -m "fix(entry): close residual status and recovery gaps"
```

### Task 3: Immutable reviews and activation gate

- [ ] **Step 1: Record the candidate SHA and clean worktree proof**

Run `git rev-parse HEAD`, `git status --short` and focused tests. Store results in the existing report without changing production code.

- [ ] **Step 2: Spec review**

Dispatch an independent reviewer against the immutable candidate for AC-01 through AC-07. No edits.

- [ ] **Step 3: Quality and security review**

After spec approval, dispatch a separate reviewer against the same candidate. It must reproduce the missing-identity counterexample, inspect the destructive recovery contract and scan normative retry text. No edits.

- [ ] **Step 4: Full structured baseline**

Run the existing detached structured-baseline comparison. Expected: no unexpected and no removed failures relative to the approved base.

- [ ] **Step 5: Global activation**

Only after both reviews approve, require global transaction status `NONE`, no active Claude Code CLI process, `bash -n install.sh` and the forced dry run. Run `bash install.sh --force-overwrite` exactly once. Verify `COMMITTED`, installed source hashes, sync dry-run, doctor and live `/soma-run --help`. Never retry a failed global transaction automatically.
