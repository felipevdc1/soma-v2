# SOMA universal entry lean implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one installed `/soma-run` command that safely transports exact arguments, adopts projects without `.soma/`, and resumes the next unfinished task from durable evidence.

**Architecture:** A small trusted-local mailbox keeps user text out of Bash. A pure entry controller resolves help, status, start and resume. Project adoption reuses the existing installer, while checkpoint and handoff modules persist enough evidence to resume without model memory. The Claude adapter stays small and loads the existing orchestration state machine only after `READY` or `RESUME_READY`.

**Tech Stack:** Node.js 22 CommonJS, `node:test`, Git CLI with argument arrays, existing SOMA install/run/global-transaction modules, Claude command markdown.

---

## Fixed scope and review rule

Authority is `docs/superpowers/specs/2026-08-27-soma-universal-entry-lean-design.md`.

The trusted local OS user and explicit user prompt are outside the attacker model. Tests cover shell safety, malformed data, ordinary concurrency, crashes, stale requests, corrupt SOMA state and Git drift. They do not cover an active same-UID process replacing files between syscalls.

There are five tasks. Each gets one executor, one integrated reviewer and at most one correction. A reviewer may reject only a violated requirement in the lean design. New same-UID hardening is non-blocking debt.

## File map

| File | Responsibility |
|---|---|
| `core/scripts/entry/request-schema.cjs` | Validate mailbox identifiers and the one request envelope. |
| `core/scripts/entry/mailbox.cjs` | Prepare, consume, abort and expire trusted-local request entries. |
| `core/scripts/entry/raw-arguments.cjs` | Pure lexer and public mode parser. |
| `core/scripts/entry/project.cjs` | Canonical project and monorepo scope resolution. |
| `core/scripts/entry/git-readonly.cjs` | Git inspection with optional locks disabled. |
| `core/scripts/entry/adoption.cjs` | Inspect and adopt projects through the existing installer. |
| `core/scripts/entry/request.cjs` | Route parsed requests and return stable result codes. |
| `core/scripts/entry/continuity.cjs` | Recompute handoff, checkpoint and Git continuity for resume. |
| `core/scripts/entry.cjs` | Fixed internal CLI for mailbox prepare, consume and abort. |
| `core/scripts/run/checkpoint.cjs` | Validate and atomically publish orchestration checkpoints. |
| `core/scripts/run/handoff.cjs` | Publish immutable JSON and Markdown handoff generations. |
| `core/adapters/claude/commands/soma-run.md` | Small public adapter. |
| `core/adapters/claude/references/soma-run-orchestration.md` | Long state-machine instructions loaded only after readiness. |

### Task 0: Archive and remove the abandoned adversarial broker

**Files:**

- Modify then revert: `core/scripts/__tests__/entry-request-broker.test.cjs`
- Remove through normal Git revert: `core/scripts/entry/request-broker.cjs`
- Remove through normal Git revert: `core/scripts/entry/request-schema.cjs`
- Remove through normal Git revert: `core/scripts/entry.cjs`
- Restore through normal Git revert: `core/scripts/soma.cjs`
- Runtime proof: `.soma/baselines/universal-entry-lean-base.json`

- [ ] **Step 1: Preserve the interrupted matrix as history**

Confirm the only tracked working-tree edit is the interrupted broker test. Commit it without claiming completion:

```bash
git status --short
git diff --check
git add core/scripts/__tests__/entry-request-broker.test.cjs
git commit -m "test(wip): archive abandoned adversarial matrix"
```

Expected: `.soma/` remains untracked; the commit changes only the broker test.

- [ ] **Step 2: Revert every abandoned broker commit without rewriting history**

Capture the WIP SHA, then revert the WIP and the six broker commits newest-first:

```bash
wip_sha="$(git rev-parse HEAD)"
git revert --no-commit "$wip_sha" 9a174e1 eb25cf2 39549fc 2961256 94e7153 48a1104
git diff --check
git commit -m "revert: remove adversarial entry broker"
```

Expected: broker production and tests are absent; `soma.cjs` no longer registers `entry`; the lean design and all pre-broker run-identity work remain.

- [ ] **Step 3: Prove the revert is scoped**

```bash
test ! -e core/scripts/entry/request-broker.cjs
test ! -e core/scripts/__tests__/entry-request-broker.test.cjs
git merge-base --is-ancestor f0b7f849 HEAD
node --test core/scripts/__tests__/run-id*.test.cjs core/scripts/__tests__/contract-step-report.test.cjs
git status --short
```

Expected: targeted pre-broker tests pass and status contains only `.soma/`.

- [ ] **Step 4: Record the lean baseline**

Run the existing structured baseline helper in a detached worktree at the revert commit. Store command, exit code and normalized failure identities in `.soma/baselines/universal-entry-lean-base.json`. Cleanup the detached worktree in `trap EXIT INT TERM HUP`.

Expected: the baseline is immutable runtime evidence. Existing unrelated failures are recorded, not fixed in this task.

### Task 1: Build the lean mailbox and pure argument parser

**Files:**

- Create: `core/scripts/entry/request-schema.cjs`
- Create: `core/scripts/entry/mailbox.cjs`
- Create: `core/scripts/entry/raw-arguments.cjs`
- Create: `core/scripts/entry.cjs`
- Modify: `core/scripts/soma.cjs`
- Create: `core/scripts/__tests__/entry-mailbox.test.cjs`
- Create: `core/scripts/__tests__/entry-raw-arguments.test.cjs`
- Create: `core/scripts/__tests__/entry-cli.test.cjs`

- [ ] **Step 1: Write the RED mailbox partitions**

Test these representative partitions, without Cartesian filesystem matrices:

```js
const cases = [
  'exact UTF-8 and shell metacharacter round-trip',
  'identifier rejection before runtime-root access',
  '0700 session directory and 0600 request file',
  'request containment under the configured root',
  'one atomic consumer and replay rejection',
  'expired valid residue removed by next prepare',
  'malformed or unexpected residue preserved as MAILBOX_INVALID',
  'abort is idempotent and never removes another request',
  'two ordinary sessions remain isolated',
];
```

Use a fake `SOMA_ENTRY_ROOT`; do not spoof uid, inode or path components between syscalls.

Run:

```bash
node --test core/scripts/__tests__/entry-mailbox.test.cjs
```

Expected: FAIL because the lean modules do not exist.

- [ ] **Step 2: Implement the mailbox contract**

Export this interface:

```js
function createMailbox(options = {}) {
  return {
    prepare({ sessionId }),
    consume({ sessionId, requestId }, parseEnvelope),
    abort({ sessionId, requestId }),
  };
}
```

Use a five-minute fixed TTL, random 32-hex request IDs, `0700` directories, `0600` files, `path.relative()` containment and directory rename to `{requestId}.claimed` for atomic consumption. `consume` deletes only the claimed directory in `finally`. The next `prepare` removes only expired entries with the exact expected file set.

Run the mailbox test until GREEN.

- [ ] **Step 3: Write RED parser and CLI tests**

The pure parser returns one of:

```js
{ mode: 'help' }
{ mode: 'status', project: string | null }
{ mode: 'start', objective: string, project: string | null }
{ mode: 'resume', runId: string | null, project: string | null }
```

Test quoting, empty strings, newlines, `$()`, backticks, semicolons and pipes as data. Reject malformed quotes, duplicate flags, unknown flags and conflicting modes.

Test only these fixed internal CLI forms:

```text
soma entry prepare --session <sessionId>
soma entry consume --session <sessionId> --request-id <requestId>
soma entry abort --session <sessionId> --request-id <requestId>
```

`entry` must remain absent from public help and valid-name error output.

- [ ] **Step 4: Implement parser, schema and CLI**

The request schema is exact:

```js
{
  $schema: 'soma-entry-request/v1',
  sessionId,
  requestId,
  rawArguments,
}
```

Reject surplus fields and envelopes above 64 KiB. `entry.cjs` prints one JSON result to stdout and stable JSON errors to stderr. It never resolves projects or changes cwd in this task.

Run:

```bash
node --test core/scripts/__tests__/entry-mailbox.test.cjs core/scripts/__tests__/entry-raw-arguments.test.cjs core/scripts/__tests__/entry-cli.test.cjs core/scripts/__tests__/soma-dispatcher.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/scripts/entry core/scripts/entry.cjs core/scripts/soma.cjs core/scripts/__tests__/entry-mailbox.test.cjs core/scripts/__tests__/entry-raw-arguments.test.cjs core/scripts/__tests__/entry-cli.test.cjs
git commit -m "feat(entry): add lean local mailbox"
```

### Task 2: Resolve and adopt projects, then return READY

**Files:**

- Create: `core/scripts/entry/git-readonly.cjs`
- Create: `core/scripts/entry/project.cjs`
- Create: `core/scripts/entry/adoption.cjs`
- Create: `core/scripts/entry/request.cjs`
- Modify: `core/scripts/entry.cjs`
- Modify: `core/scripts/install.cjs`
- Create: `core/scripts/__tests__/entry-project.test.cjs`
- Create: `core/scripts/__tests__/entry-adoption.test.cjs`
- Create: `core/scripts/__tests__/entry-request-routing.test.cjs`
- Modify: `core/scripts/__tests__/install-e2e.test.cjs`

- [ ] **Step 1: Write RED project-resolution tests**

Cover explicit project, Git cwd, declared monorepo scope and explicitly selected empty non-Git directory. Reject home, filesystem root, outside scope, symlink escape, ambiguous monorepo and non-empty markerless non-Git directory.

Every Git read uses:

```js
spawnSync('git', ['--no-optional-locks', ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
});
```

Record tree bytes, mtimes and Git index mtime before help/status. Assert exact identity after the request.

- [ ] **Step 2: Expose a callable installer without changing CLI behavior**

Refactor the existing lock check to throw a typed install error instead of calling `process.exit()`. `main()` catches it and preserves the current message and exit code. Then export:

```js
function assertInstallableDirectory(projectPathAbs) {
  if (!fs.existsSync(projectPathAbs) || !fs.statSync(projectPathAbs).isDirectory()) {
    const error = new Error(`project-path does not exist or is not a directory: ${projectPathAbs}`);
    error.code = 'PROJECT_PATH_INVALID';
    throw error;
  }
}

function installProject(projectPathAbs, options = {}) {
  const flags = {
    tool: 'claude',
    dryRun: false,
    mergeClaudioMd: true,
    replaceClaudioMd: false,
    allowLocalEdits: false,
    ...options,
  };
  assertInstallableDirectory(projectPathAbs);
  try {
    checkLockConflict(projectPathAbs); // throws INSTALL_BUSY, never exits
    return orchestrateWithLock(projectPathAbs, flags);
  } finally {
    releaseLock(projectPathAbs);
  }
}
```

`main()` must still produce the same exit codes and messages. Add regression tests around greenfield, already-complete, partial and drifted installs.

- [ ] **Step 3: Write RED adoption tests**

Test new Git, legacy dirty Git, complete SOMA, partial `.soma/`, corrupt install state and monorepo scope. Put execution sentinels in every package script. Start must never run them.

Expected results:

```js
{ status: 'READY', adopted: true, baselineRequired: true, projectRoot, scope, facts }
{ status: 'READY', adopted: false, baselineRequired: false, projectRoot, scope, facts }
{ status: 'ADOPTION_BLOCKED', diagnostic, projectRoot }
```

- [ ] **Step 4: Implement adoption and request routing**

`inspectAdoption()` is read-only. `adoptProject()` calls `installProject()` once and atomically writes `.soma/adoption.json` with pre-adoption HEAD, branch, dirty paths and detected test command names. It records commands but never executes them.

`routeEntryRequest()` returns help before project resolution, read-only status, or start readiness. If `baselineRequired` is true, the adapter's next action is an orchestrator-created `T-BASELINE`; entry creates no task or agent.

- [ ] **Step 5: Run and commit**

```bash
node --test core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/install-e2e.test.cjs core/scripts/__tests__/entry-mailbox.test.cjs
git diff --check
git add core/scripts/entry core/scripts/entry.cjs core/scripts/install.cjs core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/install-e2e.test.cjs
git commit -m "feat(entry): adopt projects before orchestration"
```

Expected: all listed tests pass and project scripts remain unexecuted.

### Task 3: Publish handoff and resume the exact next task

**Files:**

- Create: `core/scripts/run/checkpoint.cjs`
- Create: `core/scripts/run/handoff-schema.cjs`
- Create: `core/scripts/run/handoff.cjs`
- Create: `core/scripts/entry/continuity.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/paths.cjs`
- Modify: `core/scripts/run/resume.cjs`
- Modify: `core/scripts/entry/request.cjs`
- Create: `core/scripts/__tests__/run-checkpoint.test.cjs`
- Create: `core/scripts/__tests__/run-handoff.test.cjs`
- Create: `core/scripts/__tests__/entry-resume-lean.test.cjs`
- Modify: `core/scripts/__tests__/run.test.cjs`

- [ ] **Step 1: Write RED checkpoint tests**

Add internal run verbs:

```text
soma run checkpoint --run <runId> --input-file <path>
soma run handoff --run <runId>
```

The input schema contains only orchestration facts:

```js
{
  $schema: 'soma-checkpoint-input/v1',
  runId,
  sequence,
  currentState,
  nextTask,
  tasks: [{ id, status, attempts }],
  blocker: string | null,
  nextDecision: string | null,
}
```

The checkpoint module derives run-state hash, closed dispatch references, commit proofs and Git facts. Reject active or contradictory dispatch records, decreasing sequence and proof paths outside the project. Publish atomically; existing checkpoints are immutable.

- [ ] **Step 2: Implement checkpoint publication**

Write `.soma/checkpoints/{runId}/{sequence}.json` with canonical JSON and a sibling temporary file plus rename. Add checkpoint and handoff paths to `resolveSomaPaths()`.

Run checkpoint tests until GREEN.

- [ ] **Step 3: Write RED handoff and resume tests**

`soma run handoff` publishes:

```text
.soma/handoffs/<runId>/<generation>/handoff.json
.soma/handoffs/<runId>/<generation>/handoff.md
```

The JSON contains checkpoint hash, run-state hash, dispatch hashes, Git HEAD, branch, deterministic dirty-tree digest and the exact next task. The Markdown derives from JSON and contains `/soma-run --resume <runId>`.

Test:

- resume in a new session returns the same next task;
- passed tasks are not returned again;
- clean matching continuity returns `RESUME_READY`;
- changed HEAD, dirty tree, proof, checkpoint or handoff returns `RESUME_DRIFT`;
- missing or ambiguous run returns a stable error;
- help, status and rejected resume do not create a lock or mutate project files.

- [ ] **Step 4: Implement lean continuity**

Use canonical JSON with sorted object keys and path-sorted arrays. The digest includes only durable facts named by the design. `routeEntryRequest({mode:'resume'})` rereads every input and compares before creating `.soma.lock` or changing run state.

On success return:

```js
{
  status: 'RESUME_READY',
  runId,
  reentryState,
  nextTask,
  handoffGeneration,
}
```

On mismatch atomically write `.soma/diagnostics/{runId}-resume-drift.json` and return `RESUME_DRIFT`.

- [ ] **Step 5: Run and commit**

```bash
node --test core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/entry-resume-lean.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/run-state.test.cjs core/scripts/__tests__/run.test.cjs
git diff --check
git add core/scripts/run core/scripts/run.cjs core/scripts/entry/continuity.cjs core/scripts/entry/request.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/entry-resume-lean.test.cjs core/scripts/__tests__/run.test.cjs
git commit -m "feat(resume): restore runs from durable handoff"
```

### Task 4: Install the adapter and prove the vertical path

**Files:**

- Rewrite: `core/adapters/claude/commands/soma-run.md`
- Create: `core/adapters/claude/references/soma-run-orchestration.md`
- Modify: `core/adapters/claude/install-targets.json`
- Create: `core/scripts/__tests__/universal-entry-lean-adapter.test.cjs`
- Create: `core/scripts/__tests__/universal-entry-lean-e2e.test.cjs`
- Modify: `core/scripts/__tests__/install-targets-set.test.cjs`
- Modify: `install/__tests__/global-install-transaction.test.cjs`
- Modify: `README.md`
- Modify: `docs/QUICKSTART.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/superpowers/reports/2026-08-27-soma-universal-entry-lean-result.md`

- [ ] **Step 1: Write RED adapter and install tests**

Assert:

- adapter is at most 8,000 UTF-8 bytes;
- `$ARGUMENTS` appears only as the structured envelope value, never in Bash;
- prepare, consume and abort commands contain only validated session/request identifiers;
- help, status and drift never load the reference or create an agent;
- `READY` and `RESUME_READY` load the reference exactly once;
- when `baselineRequired`, the first dispatch is exactly `T-BASELINE`;
- install targets include the reference and global rollback watches every new module and target.

- [ ] **Step 2: Implement the adapter and long reference**

The adapter flow is fixed:

```text
prepare -> structured Write envelope -> consume
finally abort if write/consume did not close the request
result terminal? print and stop
READY or RESUME_READY? read long reference once and orchestrate
```

Move the current 10-step state machine body from `soma-run.md` into the reference. Update its bootstrap to trust the entry result, create `T-BASELINE` through dispatch records when requested, and checkpoint after every safe task transition.

- [ ] **Step 3: Write the vertical end-to-end test**

In a fake home and temporary Git repository with no `.soma/`:

1. install global artifacts transactionally;
2. prepare/write/consume `/soma-run "objective with $(touch sentinel)"`;
3. prove the sentinel is absent and adoption returns `READY`;
4. initialize a run and close one dispatch/task;
5. publish checkpoint and handoff;
6. simulate a new Claude session;
7. consume `/soma-run --resume <runId>`;
8. assert `RESUME_READY` names the next task and does not repeat the passed task.

Add negative cases for Git drift, corrupt mailbox, partial adoption and transaction rollback.

- [ ] **Step 4: Run the full delivery gate**

```bash
node --test core/scripts/__tests__/entry-*.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/universal-entry-lean-*.test.cjs
node --test install/__tests__/*.test.cjs
bash install/__tests__/synthetic-env.test.sh
git diff --check
```

Capture a new structured final suite in a detached worktree and compare it with `.soma/baselines/universal-entry-lean-base.json`. The final failure set must be a subset of the base set.

- [ ] **Step 5: Commit implementation and current docs**

```bash
git add core/adapters/claude/commands/soma-run.md core/adapters/claude/references/soma-run-orchestration.md core/adapters/claude/install-targets.json core/scripts/__tests__/universal-entry-lean-adapter.test.cjs core/scripts/__tests__/universal-entry-lean-e2e.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs README.md docs/QUICKSTART.md docs/INSTALL.md docs/ARCHITECTURE.md docs/superpowers/reports/2026-08-27-soma-universal-entry-lean-result.md
git commit -m "feat(adapter): activate lean universal soma run"
```

- [ ] **Step 6: Perform one transactional global activation**

Preflight:

```bash
node install/global-transaction.cjs status --backup-root "$HOME/.soma-v2-backups"
pgrep -fl 'claude|Claude' || true
bash -n install.sh
bash install.sh --dry-run --force-overwrite
```

Require transaction status `NONE` and no active Claude process. Then run exactly once:

```bash
bash install.sh --force-overwrite
```

Do not retry automatically. Verify transaction `COMMITTED`, source-to-live hashes, sync dry-runs and doctor. Run one minimal live Claude smoke for `/soma-run --help`, then use a temporary project to prove start/adoption and resume without spending another model session if the adapter harness already exercises the same installed files.

Write transaction ID, hashes, commands and results into the result report. Commit only the report update.

## Completion gate

- [ ] The abandoned broker remains only in Git history and historical docs.
- [ ] The lean mailbox has no capability token or same-UID adversarial machinery.
- [ ] Exact hostile argument text reaches the parser as data and executes nothing.
- [ ] Start adopts a project without `.soma/` and returns `READY`.
- [ ] Entry never runs project scripts; `T-BASELINE` belongs to an executor.
- [ ] Handoff contains the exact next task and durable proof references.
- [ ] A new simulated session resumes without repeating passed work.
- [ ] Drift produces a durable diagnostic before lock or run mutation.
- [ ] Adapter is under 8,000 bytes and lazy-loads the long reference once.
- [ ] Fake-home install, rollback and vertical end-to-end tests pass.
- [ ] Final structured failure set adds nothing beyond the baseline.
- [ ] One global transaction commits and the installed `/soma-run` smoke passes.
