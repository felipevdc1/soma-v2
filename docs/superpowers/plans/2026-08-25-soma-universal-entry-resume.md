# SOMA Universal Entry and Safe Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/soma-run` the reliable public entry for new, legacy and installed projects, with read-only inspection, snapshot-bound continuation and durable handoff.

**Architecture:** Keep `/soma-run` below 8,000 UTF-8 bytes as a thin Claude adapter. Start requests cross the shell boundary only as a validated request file; inspection emits a complete second slash command whose locator and canonical snapshot are rechecked before mutation. The 10-step orchestration body has one installed reference and loads only after `READY` or `CONTINUE_READY`. Existing `soma run` primitives remain internal, with baseline, checkpoint and handoff added as evidence-backed verbs.

**Tech Stack:** Node.js 22 CommonJS, `node:test`, Git CLI through `spawnSync` argument arrays, existing SOMA install/sync components, JSON and Markdown artifacts.

---

## Acceptance map and file boundaries

| Unit | Responsibility | Acceptance criteria |
|---|---|---|
| `core/scripts/entry/args.cjs`, `request.cjs` | Parse flags and validate request-file envelopes before project access | AC-01 |
| `core/scripts/entry/project.cjs` | Resolve repo/scope without `chdir`; make read-only Git truly read-only | AC-02, AC-05, AC-07 |
| `core/scripts/entry/adoption.cjs` | Inspect and adopt absent `.soma` without executing repository scripts | AC-05, AC-06 |
| `core/scripts/run/baseline.cjs`, `checkpoint.cjs`, dispatch gate | Enforce `T-BASELINE`, bounded evidence and append-only pause facts | AC-14, AC-15 |
| `core/scripts/entry/card.cjs`, `snapshot.cjs`, `entry.cjs` | Build cards and validate continuation before lock/write | AC-02, AC-03, AC-04 |
| `core/scripts/run/handoff.cjs`, schema and `/handoff` adapter | Derive durable continuity only from persisted facts | AC-08, AC-15 |
| Claude adapter, orchestration reference and install targets | Safe request routing, absolute CLI, lazy load and transactional install | AC-09, AC-10, AC-13 |
| Current README/docs | Publish only the canonical command and current artifact paths | AC-11, AC-12 |

Do not add a plugin, daemon, hook, dependency, PATH shim or alternate public command. Do not edit historical files under `core/specs/` or snapshots.

### Task 0: Capture the immutable pre-implementation failure baseline

**Files:**

- Create at runtime only: `.soma/baselines/universal-entry-npm.json`
- Create at runtime only: `.soma/baselines/universal-entry-npm.log`

- [ ] **Step 1: Pin the baseline candidate**

Use the exact `8d2b395` candidate, or the later docs-only correction HEAD. Prove every commit after `8d2b395` changes only these two documents:

```bash
candidate_sha="$(git rev-parse HEAD)"
git merge-base --is-ancestor 1cbebb4 "$candidate_sha"
git merge-base --is-ancestor b3a4997 "$candidate_sha"
git diff --name-only 8d2b395.."$candidate_sha" | rg -v '^docs/superpowers/(specs/2026-08-25-soma-universal-entry-resume-design|plans/2026-08-25-soma-universal-entry-resume)\.md$' > /tmp/soma-universal-entry-nondoc-delta
test ! -s /tmp/soma-universal-entry-nondoc-delta
```

Expected: exit 0 and no non-doc delta.

- [ ] **Step 2: Capture the full suite from a detached worktree**

Create a detached worktree at `candidate_sha`, run `npm test` there, and save stdout/stderr in the project worktree. Parse every `not ok` record into `soma-test-baseline/v1` with `candidateSha`, `command`, `exitCode`, `failures` and `logSha256`. Remove the detached worktree after capture.

```bash
repo_root="$(pwd -P)"
baseline_dir="$(mktemp -d)"
mkdir -p "$repo_root/.soma/baselines"
git worktree add --detach "$baseline_dir" "$candidate_sha"
set +e; (cd "$baseline_dir" && npm test) > "$repo_root/.soma/baselines/universal-entry-npm.log" 2>&1; baseline_exit=$?; set -e
git worktree remove "$baseline_dir"
node -e 'const fs=require("fs"),crypto=require("crypto"); const [logFile,outFile,sha,code]=process.argv.slice(1); const log=fs.readFileSync(logFile,"utf8"); const failures=log.split(/\r?\n/).filter(line=>/^not ok\b/.test(line)); const record={$schema:"soma-test-baseline/v1",candidateSha:sha,command:["npm","test"],exitCode:Number(code),failures,logSha256:crypto.createHash("sha256").update(log).digest("hex")}; fs.writeFileSync(outFile,JSON.stringify(record,null,2)+"\n");' "$repo_root/.soma/baselines/universal-entry-npm.log" "$repo_root/.soma/baselines/universal-entry-npm.json" "$candidate_sha" "$baseline_exit"
```

Expected: the structured failure list includes the inherited planned spec 024 RED for absent `operator-gate.cjs`. Do not implement spec 024 or require exit 0.

- [ ] **Step 3: Validate and freeze the baseline**

```bash
node -e 'const fs=require("fs"),crypto=require("crypto"); const p=JSON.parse(fs.readFileSync(".soma/baselines/universal-entry-npm.json","utf8")); const log=fs.readFileSync(".soma/baselines/universal-entry-npm.log"); if(p.$schema!=="soma-test-baseline/v1"||p.candidateSha!==process.argv[1]||p.logSha256!==crypto.createHash("sha256").update(log).digest("hex")||!Array.isArray(p.failures)) process.exit(1);' "$candidate_sha"
```

Expected: exit 0. No later task may replace either baseline file.

### Task 1: Lock the public grammar and safe request boundary

**Files:**

- Create: `core/scripts/entry/args.cjs`
- Create: `core/scripts/entry/request.cjs`
- Create: `core/scripts/entry.cjs`
- Create: `core/scripts/__tests__/entry-args.test.cjs`
- Create: `core/scripts/__tests__/entry-request.test.cjs`
- Modify: `core/scripts/soma.cjs`

- [ ] **Step 1: Write RED parser and request tests**

Assert these modes: `--help`, `--status`, `--resume [runId]`, `--continue <runId> --project <repo> --scope <scope> --snapshot <sha256> [--handoff <path>]`, and start through `--request-file <path>`. Continue rejects a missing locator or snapshot, uppercase/non-64-hex snapshots, duplicate/conflicting flags and unknown tokens before project discovery. Normal shell whitespace between argv tokens is accepted; every value remains byte-exact.

Create `soma-entry-request/v1` fixtures whose objectives contain spaces, both quote styles, `$()`, backticks and a newline. Put a shell-writing sentinel inside the payload and assert it is never created. Reject schema, content hash, session binding, locator and size mismatches.

- [ ] **Step 2: Run RED tests**

```bash
node --test core/scripts/__tests__/entry-args.test.cjs core/scripts/__tests__/entry-request.test.cjs
```

Expected: FAIL because the entry modules do not exist.

- [ ] **Step 3: Implement the narrow interfaces**

`parseEntryArgs(argv)` returns exactly `{mode, requestFile, project, scope, handoff, runId, snapshot}`. Start accepts only `--request-file`; objective text is never an argv value. `validateEntryRequest(path, {sessionId})` reads a regular session-scoped file, validates `soma-entry-request/v1`, canonical `contentSha256`, a bounded size and exact locator, then returns the literal objective. `entry.cjs` dispatches by mode, prints one JSON envelope, maps argument errors to exit 2 and never calls `process.chdir()`.

Register `{ name: 'entry', script: 'entry.cjs' }` in `core/scripts/soma.cjs` without changing existing forms.

- [ ] **Step 4: Run GREEN and dispatcher regression tests**

```bash
node --test core/scripts/__tests__/entry-args.test.cjs core/scripts/__tests__/entry-request.test.cjs core/scripts/__tests__/run.test.cjs
```

Expected: PASS; hostile objectives round-trip literally and no sentinel exists.

- [ ] **Step 5: Commit**

```bash
git add core/scripts/entry/args.cjs core/scripts/entry/request.cjs core/scripts/entry.cjs core/scripts/soma.cjs core/scripts/__tests__/entry-args.test.cjs core/scripts/__tests__/entry-request.test.cjs
git commit -m "feat(entry): add safe universal entry grammar"
```

### Task 2: Resolve project and scope without silent cwd or Git writes

**Files:**

- Create: `core/scripts/entry/project.cjs`
- Create: `core/scripts/__tests__/entry-project.test.cjs`
- Modify: `core/scripts/entry.cjs`

- [ ] **Step 1: Write RED resolver tests with real repositories**

Cover explicit repo/scope, a declared workspace, handoff locator, current Git root, non-Git empty cwd and marker-bearing non-Git cwd. Reject home, filesystem root, non-empty markerless cwd, symlink escape, undeclared nested scope and ambiguous locator. Snapshot `process.cwd()` around every call.

For read-only Git, create a stale stat cache by setting the index mtime to an older fixed timestamp. Record index bytes and `mtimeNs`, run help/status/resume resolution, then assert both remain exact.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/entry-project.test.cjs
```

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement canonical resolution**

Export `resolveProject({cwd, project, scope, handoff, runId, homeDir})` and `discoverWorkspaces(repoRoot)`. Canonicalize with real paths before containment checks. A non-Git cwd is a valid `new` project only when it is a real directory, is neither home nor root, and is empty or has a recognized marker. Return `{repoRoot, scopeRoot, monorepo, workspaceRoots, source}`.

Route every Git inspection through one helper with both controls:

```js
spawnSync('git', ['--no-optional-locks', ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
});
```

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/entry-args.test.cjs
git add core/scripts/entry/project.cjs core/scripts/entry.cjs core/scripts/__tests__/entry-project.test.cjs
git commit -m "feat(entry): resolve projects without cwd or index mutation"
```

Expected: PASS, including stale index bytes and mtime.

### Task 3: Adopt safely, checkpoint pauses and gate the baseline

**Files:**

- Create: `core/scripts/entry/adoption.cjs`
- Create: `core/scripts/run/baseline.cjs`
- Create: `core/scripts/run/checkpoint.cjs`
- Create: `core/scripts/__tests__/entry-adoption.test.cjs`
- Create: `core/scripts/__tests__/run-baseline.test.cjs`
- Create: `core/scripts/__tests__/run-checkpoint.test.cjs`
- Modify: `core/scripts/entry.cjs`
- Modify: `core/scripts/install.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/state.cjs`
- Modify: `core/scripts/run/dispatch-record.cjs`

- [ ] **Step 1: Write RED adoption, checkpoint and gate tests**

Assert adoption classifies new non-Git and legacy Git projects, records branch/HEAD/dirty/existing artifacts, remains byte and mtime stable on repeat, and preserves application files. A detected safe command records `pending` plus `{timeoutMs:120000,maxOutputBytesPerStream:262144}` but leaves an execution sentinel absent. Unsafe or unavailable commands record `not_run_budget` or `not_available`, never pass.

For every `pending` run, assert synthetic `T-BASELINE` exists before any user task, even when there is no FOUNDATION task. `dispatch-record begin` permits only `T-BASELINE` until `.soma/evidence/<runId>/baseline.json` validates and its hash appears in proofs. Other attempts return `BASELINE_REQUIRED` without a dispatch record.

Checkpoint tests validate a bounded regular `soma-checkpoint/v1` input, reject symlink/path escape/schema/run mismatch before mutation, publish `.soma/checkpoints/<runId>/<sequence>-<sha256>.json`, append `{path,sha256}` to `continuity.checkpoints[]`, never overwrite, and preserve the prior checkpoint under injected failure.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs
```

Expected: FAIL because adoption and the new run verbs are absent.

- [ ] **Step 3: Implement adoption without script execution**

Extract `installProject({projectPath, tool, mergeClaudeMd, allowLocalEdits, env})` from the existing installer while preserving CLI behavior. Implement `inspectProject` and `adoptProject`; publish `soma-adoption/v1` by sibling temp plus rename. Entry may call adoption but must never import or run `baseline.cjs`.

- [ ] **Step 4: Implement checkpoint, baseline and the global dispatch gate**

Add `soma run checkpoint --run <id> --input-file <json>` and `soma run baseline --run <id> --dispatch <dispatchId>`. Baseline requires the active `T-BASELINE` dispatch, executes the stored argv in explicit scope cwd, stops at 120 seconds or 256 KiB on either stream, publishes a hashed proof and appends it to run proofs. `pass` unlocks later dispatches. `fail` or `timeout` appends a diagnostic checkpoint, transitions to `PAUSED_DIAGNOSTIC`, and never cleans the worktree.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/install-e2e.test.cjs
git add core/scripts/entry/adoption.cjs core/scripts/entry.cjs core/scripts/install.cjs core/scripts/run.cjs core/scripts/run/baseline.cjs core/scripts/run/checkpoint.cjs core/scripts/run/state.cjs core/scripts/run/dispatch-record.cjs core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs
git commit -m "feat(run): gate work on bounded baseline evidence"
```

Expected: PASS; baseline remains executor-owned and no adoption-time sentinel exists.

### Task 4: Build read-only cards and snapshot-bound continuation

**Files:**

- Create: `core/scripts/entry/card.cjs`
- Create: `core/scripts/entry/snapshot.cjs`
- Create: `core/scripts/__tests__/entry-resume-safe.test.cjs`
- Modify: `core/scripts/entry.cjs`
- Modify: `core/scripts/run/resume.cjs`
- Modify: `core/scripts/run/state.cjs`
- Modify: `core/scripts/__tests__/run-resume.test.cjs`
- Modify: `core/scripts/__tests__/run-state.test.cjs`

- [ ] **Step 1: Write RED inspection and continuation tests**

Create a real run and dirty worktree. `--resume` must return `AWAITING_CONTINUE` plus the exact full command:

```text
/soma-run --continue <runId> --project "<repo>" --scope "<scope>" --snapshot <sha256>
```

Append resolved `--handoff "<path>"` when applicable. Assert recursive hashes, mtimes, index bytes/mtime, locks and agent records remain unchanged. Cover missing/ambiguous run, old v2 state, state/report mismatch, normal whitespace between flags, malformed snapshot, locator change, branch/HEAD/dirty/proof drift, and invocation from home.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/entry-resume-safe.test.cjs
```

Expected: FAIL because cards and snapshot validation are absent.

- [ ] **Step 3: Implement canonical snapshot and continuation ordering**

Export pure `inspectResume`, card builders and canonical JSON hashing. Hash exactly `{run,locator,branch,headSha,dirty,proofs}` with recursively sorted object keys, preserved array order, UTF-8 and no newline. Old state normalization stays in memory.

Continue must run in this order:

```text
parse flags -> resolve exact project/scope/handoff -> reload durable inputs
-> recompute snapshot -> compare exact lowercase digest -> acquire lock
-> persist reentry -> return CONTINUE_READY
```

Any mismatch returns `RESUME_DRIFT` before mutation. The second slash invocation is the authorization; no prompt hook participates.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/run-state.test.cjs
git add core/scripts/entry/card.cjs core/scripts/entry/snapshot.cjs core/scripts/entry.cjs core/scripts/run/resume.cjs core/scripts/run/state.cjs core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/run-state.test.cjs
git commit -m "feat(resume): bind continuation to durable snapshot"
```

Expected: PASS and zero mutation on every inspection or rejected continue.

### Task 5: Publish handoff only from durable run evidence

**Files:**

- Create: `core/scripts/run/handoff.cjs`
- Create: `core/scripts/run/handoff-schema.cjs`
- Create: `core/scripts/__tests__/run-handoff.test.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/paths.cjs`
- Modify: `core/adapters/claude/commands/handoff.md`
- Modify: `core/templates/handoff-template.md`
- Modify: `templates/handoff-template.md`
- Modify: `core/scripts/__tests__/run.test.cjs`
- Modify: `core/scripts/__tests__/run-gitignore.test.cjs`

- [ ] **Step 1: Write RED derivation, durability and atomicity tests**

Build dispatch fixtures under `.soma/dispatches`: prompt without output is active and yields `HANDOFF_ACTIVE_DISPATCH`; prompt plus output plus valid metadata is closed and supplies task, attempt, executor and closure; any missing/contradictory component yields `CORRUPT_DISPATCH_RECORD`. Checkpoint supplies only pause reason, blocker, next decision and task summary. Handoff must not accept caller-supplied agent truth.

Reject proof paths that are ignored by Git, under the OS temp directory, outside repo/scope, symlinked outside or contain `..`. Fault-inject before validation and directory rename. Assert either the previous immutable pair remains or no new generation exists. Compare Git index bytes/mtime before and after.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run-gitignore.test.cjs
```

Expected: FAIL because the writer and schema are absent.

- [ ] **Step 3: Implement schema, derivation and atomic publish**

Add handoff paths to `resolveSomaPaths`. `handoff.cjs` may read only run state, newest valid checkpoint, dispatch records and durable proofs. It derives attempts and closed agents, builds canonical `soma-handoff/v2`, derives Markdown from the validated JSON, and renames one sibling temp directory to `.soma/handoffs/<runId>/<handoffId>/`. It reports `tracked`, `modified`, `untracked` or `non_git` with read-only Git. It never stages, commits or pushes.

- [ ] **Step 4: Route `/handoff` without a second ledger**

With an explicit `--run` or valid active `.soma.lock`, the adapter writes a structured checkpoint input, invokes the absolute CLI `run checkpoint`, then `run handoff`, reports both artifacts and stops. It does not infer attempts or agent closure. Without an active SOMA run, preserve the existing path but mark it `$schema: soma-handoff/legacy` and `resumable_by_soma_run: false`; keep it outside `.soma/handoffs/`.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run.test.cjs core/scripts/__tests__/run-gitignore.test.cjs
git add core/scripts/run.cjs core/scripts/run/paths.cjs core/scripts/run/handoff.cjs core/scripts/run/handoff-schema.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run.test.cjs core/scripts/__tests__/run-gitignore.test.cjs core/adapters/claude/commands/handoff.md core/templates/handoff-template.md templates/handoff-template.md
git commit -m "feat(handoff): derive continuity from durable records"
```

Expected: PASS; active/corrupt dispatches and non-durable proofs block without a new generation or index change.

### Task 6: Make `/soma-run` safe, thin, lazy and transactionally installed

**Files:**

- Modify: `core/adapters/claude/commands/soma-run.md`
- Create: `core/adapters/claude/references/soma-run-orchestration.md`
- Modify: `core/adapters/claude/install-targets.json`
- Create: `core/scripts/__tests__/universal-entry-adapter.test.cjs`
- Modify: `core/scripts/__tests__/install-targets-set.test.cjs`
- Modify: `install/__tests__/global-install-transaction.test.cjs`

- [ ] **Step 1: Write RED adapter, injection and lazy-load tests**

Assert the adapter contains `$ARGUMENTS`, calls only `node "${SOMA_HOME:-$HOME/.soma-v2}/scripts/soma.cjs"`, is at most 8,000 UTF-8 bytes with a target near 4 KiB, and contains none of the 10-step headings. Assert each heading exists exactly once in the current source tree, in `soma-run-orchestration.md`.

Instrument reference reads. Help, status and resume inspection must read it zero times; `READY` and `CONTINUE_READY` read it exactly once before dispatch. Continue routes validated flags to entry. Start uses structured Write to create a session-scoped `soma-entry-request/v1`, verifies schema/hash and calls fixed `entry --request-file <path>`. Exercise spaces, quotes, `$()`, backticks and newline with a sentinel and prove no payload executes. Use a fake HOME and remove every `soma` shim from PATH.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/universal-entry-adapter.test.cjs install/__tests__/global-install-transaction.test.cjs
```

Expected: FAIL because routing and the separate reference are absent.

- [ ] **Step 3: Extract the single long reference and rewrite the adapter**

Move, do not copy, the 10-step body into `core/adapters/claude/references/soma-run-orchestration.md`. Its first execution rule creates and dispatches `T-BASELINE` before every other task whenever adoption says `pending`; FOUNDATION is not a prerequisite. It parses the baseline proof and stops in diagnostics on fail/timeout.

The thin adapter classifies modes before reading the reference. Help/status/resume only print the preflight result. Start stops unless it receives `READY`. Continue stops unless it receives `CONTINUE_READY`. Only those two states permit exactly one reference read; no agent dispatch occurs earlier. Do not add a hook.

- [ ] **Step 4: Extend transactional install coverage**

The watched set must include the adapter, reference, `soma.cjs`, entry modules, `run.cjs`, baseline, checkpoint, handoff/schema and every changed manifest or install target. Inject faults after core copy and file sync; compare every pre-state hash after rollback.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
git add core/adapters/claude/commands/soma-run.md core/adapters/claude/references/soma-run-orchestration.md core/adapters/claude/install-targets.json core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
git commit -m "feat(adapter): lazy-load universal entry safely"
```

Expected: PASS, zero sentinel execution and full rollback parity without a PATH shim.

### Task 7: Migrate current documentation to the canonical contract

**Files:**

- Modify: `README.md`
- Modify: `docs/QUICKSTART.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `core/scripts/__tests__/universal-entry-docs.test.cjs`

- [ ] **Step 1: Write and run the RED documentation scan**

Scan only current user docs. Require `/soma-run`, full snapshot-bound continuation, safe request-file routing, `.soma/run-state-<runId>.json`, checkpoint and handoff paths, `T-BASELINE`, and the installed lazy reference. Reject `/soma:run` and claims that resume inspection writes.

```bash
node --test core/scripts/__tests__/universal-entry-docs.test.cjs
```

Expected: FAIL on current naming and temporary-state claims.

- [ ] **Step 2: Update docs and run GREEN**

Document normal/help/status/resume/continue examples, new non-Git cwd rules, explicit project/scope from home, absolute installed CLI, adoption without script execution, executor-owned bounded baseline, durable checkpoint/handoff and zero staging.

```bash
node --test core/scripts/__tests__/universal-entry-docs.test.cjs
```

Expected: PASS with zero `/soma:run` in current user docs.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/QUICKSTART.md docs/INSTALL.md docs/ARCHITECTURE.md core/scripts/__tests__/universal-entry-docs.test.cjs
git commit -m "docs(soma): publish universal entry contract"
```

### Task 8: Prove the integrated contract and failure-set delta

**Files:**

- Create: `core/scripts/__tests__/universal-entry-e2e.test.cjs`
- Modify: `core/scripts/__tests__/trilho-e2e.test.cjs`
- Modify: `core/scripts/__tests__/cross-harness-parity.test.cjs`

- [ ] **Step 1: Write the RED end-to-end matrix**

Cover new non-Git, legacy dirty, installed and monorepo starts; home/invalid scope rejection; hostile objective request files; help/status/resume byte and mtime identity with stale index cache; full locator-bearing continuation from home; snapshot drift before lock; `T-BASELINE` as the first and only allowed pending dispatch; bounded baseline proof; checkpoint plus dispatch-derived handoff; ignored/temp/escaped proof rejection; immutable handoff pair with zero staging; zero lazy reads for inspection and exactly one for readiness; and normal objective reachability.

- [ ] **Step 2: Run focused RED, wire only integration gaps, rerun GREEN**

```bash
node --test core/scripts/__tests__/universal-entry-e2e.test.cjs core/scripts/__tests__/trilho-e2e.test.cjs core/scripts/__tests__/cross-harness-parity.test.cjs
```

Expected: initial RED on an integration seam, then PASS after the smallest in-scope wiring change.

- [ ] **Step 3: Run deterministic global and delta checks**

Run `npm test` once and save `.soma/baselines/universal-entry-npm-final.log`. Parse it using the same algorithm as Task 0 and compare structured failure identities. Require no new failure; the inherited spec 024 RED may remain.

```bash
node --test install/__tests__/*.test.cjs
bash install/__tests__/synthetic-env.test.sh
git diff --check
git status --short
```

Expected: install and focused suites exit 0, synthetic environment exits 0, diff check is empty, and the full-suite failure set is equal to or smaller than Task 0. A new failure blocks completion. Do not repair spec 024 in this feature.

- [ ] **Step 4: Run the lightweight SONAR audit**

Audit architecture, backward-compatible state, test-to-AC traceability, install ownership and scope against AC-01 through AC-15. Confirm no production dependency, plugin, daemon, hook, PATH shim, historical-spec rewrite, adoption script execution, pre-snapshot resume write, auto-stage, non-durable proof or duplicate state-machine body. Fix only blocking findings and rerun focused tests plus the failure-set delta once.

- [ ] **Step 5: Commit integration proof**

```bash
git add core/scripts/__tests__/universal-entry-e2e.test.cjs core/scripts/__tests__/trilho-e2e.test.cjs core/scripts/__tests__/cross-harness-parity.test.cjs
git commit -m "test(entry): prove universal start and safe continuation"
```

## Completion gate

- [ ] AC-01 through AC-15 each map to a passing behavioral test.
- [ ] Help, status and resume inspection preserve project bytes, mtimes, Git index, locks and agent records.
- [ ] Start objectives cross the shell only through a validated `soma-entry-request/v1`; hostile payloads never execute.
- [ ] Continue carries resolved project/scope/handoff and exact canonical snapshot; drift fails before lock or write.
- [ ] Pending adoption always creates `T-BASELINE`; the dispatch gate blocks all other tasks until a valid proof exists.
- [ ] Baseline runs only in its executor with 120-second and 256-KiB-per-stream limits; fail/timeout checkpoints diagnostics without cleanup.
- [ ] Checkpoint is append-only; handoff derives attempts and closed agents from dispatch records and rejects active/corrupt dispatches or non-durable proofs.
- [ ] Handoff JSON/Markdown survive fault injection, stay project-resident and never change the Git index.
- [ ] Adapter is at most 8,000 bytes; the single long reference loads once only after `READY` or `CONTINUE_READY`.
- [ ] Global rollback covers adapter, reference, entry, baseline, checkpoint, handoff and changed manifests/targets.
- [ ] Current docs use `/soma-run`; historical evidence remains untouched.
- [ ] Focused and install suites pass, `git diff --check` passes, and the full-suite failure set adds nothing beyond the Task 0 baseline.
