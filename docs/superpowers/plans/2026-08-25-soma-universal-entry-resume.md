# SOMA Universal Entry and Safe Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/soma-run` the reliable public entry for new, legacy and installed projects, with read-only status/resume inspection, exact resume confirmation and durable structured handoff.

**Architecture:** Keep `/soma-run` below 8,000 bytes as a thin Claude adapter and add an internal `soma entry` preflight. Move the long state machine to one installed reference that loads only after `READY` or `CONTINUE_READY`. Reuse existing `soma run` primitives, adding a handoff verb and backward-compatible run context. Resolve repo and scope explicitly, adopt through existing project installation components, and invoke the installed CLI by absolute path.

**Tech Stack:** Node.js 22 CommonJS, `node:test`, Git CLI through `spawnSync` argument arrays, existing SOMA install/sync primitives, JSON and Markdown artifacts.

---

## Acceptance map and file boundaries

| Unit | Responsibility | Acceptance criteria |
|---|---|---|
| `core/scripts/entry/args.cjs` | Parse the public grammar without project access | AC-01 |
| `core/scripts/entry/project.cjs` | Resolve repo/scope and monorepo boundaries without `chdir` | AC-02, AC-07 |
| `core/scripts/entry/adoption.cjs` | Inspect and adopt absent `.soma` idempotently | AC-05, AC-06 |
| `core/scripts/entry/card.cjs` | Build status and resume cards from durable evidence | AC-02, AC-03, AC-04 |
| `core/scripts/entry.cjs` | Coordinate modes and emit one JSON envelope | AC-01 through AC-07, AC-10 |
| `core/scripts/run/handoff.cjs` | Validate and publish JSON plus Markdown continuity | AC-08 |
| Claude adapter, orchestration reference and install targets | Route `$ARGUMENTS`, exact confirmation, lazy load and absolute CLI | AC-01, AC-03, AC-09, AC-10, AC-13 |
| Current README/docs | Publish only `/soma-run` and current state paths | AC-11, AC-12 |

Do not add a plugin, daemon, dependency, PATH shim or alternate public command. Do not edit historical files under `core/specs/` or snapshots.

### Task 1: Lock the public grammar and internal dispatcher

**Files:**

- Create: `core/scripts/entry/args.cjs`
- Create: `core/scripts/entry.cjs`
- Create: `core/scripts/__tests__/entry-args.test.cjs`
- Modify: `core/scripts/soma.cjs`

- [ ] **Step 1: Write RED parser tests**

Cover the five modes and fail-before-discovery behavior:

```js
test('AC-01 parses a normal objective as one start request', () => {
  assert.deepEqual(parseEntryArgs(['fix login retries']), {
    mode: 'start', objective: 'fix login retries', project: null,
    scope: null, handoff: null, runId: null
  });
});

test('AC-01 parses optional resume id and project', () => {
  assert.deepEqual(parseEntryArgs(['--resume', 'run-260825-1200-a1b2c3', '--project', '/repo', '--scope', '/repo/app']), {
    mode: 'resume_inspect', objective: null, project: '/repo',
    scope: '/repo/app', handoff: null, runId: 'run-260825-1200-a1b2c3'
  });
});

for (const args of [['--help', 'x'], ['--status', '--resume'], ['--wat'], []]) {
  test(`AC-01 rejects ${JSON.stringify(args)}`, () => {
    assert.throws(() => parseEntryArgs(args), /INVALID_ENTRY_ARGS/);
  });
}
```

Also assert `--continue` requires `--run`, run IDs match `^run-[a-z0-9-]+$`, and flag values are not treated as objectives. Prove `--project` and `--scope` work consistently with start, status and resume.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test core/scripts/__tests__/entry-args.test.cjs
```

Expected: FAIL because `entry/args.cjs` and `entry.cjs` do not exist.

- [ ] **Step 3: Implement the parser and dispatcher**

Export this contract from `args.cjs`:

```js
class EntryArgsError extends Error {
  constructor(message) {
    super(`INVALID_ENTRY_ARGS: ${message}`);
    this.code = 'INVALID_ENTRY_ARGS';
  }
}

function parseEntryArgs(argv) {
  // Return exactly {mode, objective, project, scope, handoff, runId}.
  // Accept one mode only. Consume --project, --scope, --handoff and --run once.
  // Treat the optional token immediately after --resume as runId unless it begins with "--".
  // Reject empty objective, duplicate flags, unknown flags and conflicting modes.
}

module.exports = { EntryArgsError, parseEntryArgs };
```

`entry.cjs` must call `parseEntryArgs(process.argv.slice(2))`, dispatch through a mode-to-function table, print one JSON object to stdout and map contract errors to exit 2. Do not call `process.chdir()`.

Add `{ name: 'entry', script: 'entry.cjs', desc: 'Internal preflight for the /soma-run adapter' }` to `SUBCOMMANDS` in `soma.cjs`. Keep every existing subcommand unchanged.

- [ ] **Step 4: Run GREEN tests and the legacy dispatcher test**

Run:

```bash
node --test core/scripts/__tests__/entry-args.test.cjs core/scripts/__tests__/run.test.cjs
```

Expected: PASS. `soma run --help` still lists state, report, gate, resume and dispatch-record.

- [ ] **Step 5: Commit**

```bash
git add core/scripts/entry/args.cjs core/scripts/entry.cjs core/scripts/soma.cjs core/scripts/__tests__/entry-args.test.cjs
git commit -m "feat(entry): add deterministic universal entry parser"
```

### Task 2: Resolve project and monorepo scope without silent cwd changes

**Files:**

- Create: `core/scripts/entry/project.cjs`
- Create: `core/scripts/__tests__/entry-project.test.cjs`
- Modify: `core/scripts/entry.cjs`

- [ ] **Step 1: Write RED resolver tests with real repositories**

Build temporary Git repos with `package.json` workspaces and assert this API:

```js
const resolved = resolveProject({
  cwd: '/tmp/repo/packages/web/src',
  project: '/tmp/repo',
  scope: '/tmp/repo/packages/web',
  handoff: null,
  runId: null,
  homeDir: '/tmp/home'
});
assert.equal(resolved.repoRoot, '/tmp/repo');
assert.equal(resolved.scopeRoot, '/tmp/repo/packages/web');
assert.equal(resolved.monorepo, true);
```

Add a non-Git empty directory and a non-Git marker-bearing directory as known-good new projects. Add known-bad cases for home as implicit project, filesystem root, a non-empty markerless directory, symlink escape, undeclared nested scope, ambiguous resume locator and cwd outside any recognized project. Snapshot `process.cwd()` before and after every call and assert equality.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test core/scripts/__tests__/entry-project.test.cjs
```

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement canonical resolution**

Export:

```js
function resolveProject({ cwd, project, scope, handoff, runId, homeDir }) {
  // Priority: explicit project, validated handoff repo.root, current Git top-level,
  // recognized non-Git cwd, validated run handoff locator.
  // A non-Git cwd is recognized only when non-home/non-root and empty or marker-bearing.
  // Resolve real paths before containment checks.
  // Return {repoRoot, scopeRoot, monorepo, workspaceRoots, source}.
}

function discoverWorkspaces(repoRoot) {
  // Read package.json workspaces, pnpm-workspace.yaml and lerna.json when present.
  // Expand only paths contained by repoRoot and return canonical directories.
}

module.exports = { resolveProject, discoverWorkspaces };
```

Run Git through `spawnSync('git', args, { cwd, encoding: 'utf8' })`. Never interpolate paths into a shell command. A root-level monorepo invocation uses `scopeRoot === repoRoot`; a nested scope must match a discovered workspace or explicit valid `--scope`.

- [ ] **Step 4: Wire the resolver and verify zero mutation**

`entry.cjs` must resolve only after argument parsing. `help` returns before resolution. `status` and `resume_inspect` may read resolved files but cannot create directories, locks or locator files.

Run:

```bash
node --test core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/entry-args.test.cjs
```

Expected: PASS, including unchanged cwd and filesystem snapshots.

- [ ] **Step 5: Commit**

```bash
git add core/scripts/entry/project.cjs core/scripts/entry.cjs core/scripts/__tests__/entry-project.test.cjs
git commit -m "feat(entry): resolve project and monorepo scope safely"
```

### Task 3: Add safe and idempotent adoption

**Files:**

- Create: `core/scripts/entry/adoption.cjs`
- Create: `core/scripts/__tests__/entry-adoption.test.cjs`
- Create: `core/scripts/run/baseline.cjs`
- Create: `core/scripts/__tests__/run-baseline.test.cjs`
- Modify: `core/scripts/entry.cjs`
- Modify: `core/scripts/install.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/state.cjs`

- [ ] **Step 1: Write RED adoption tests**

Use real temporary projects and the existing fake-home helper. Cover non-Git empty and marker-bearing projects, legacy Git repo, workspace monorepo, complete install, partial/corrupt install state, a safe declared baseline and one rejected by budget policy. Make the safe baseline script write a sentinel if executed; assert adoption leaves the sentinel absent. In `run-baseline.test.cjs`, prove the command runs only through an active dispatch, caps time/output, writes a hashed proof and appends it to continuity.

The central assertions are:

```js
assert.equal(record.$schema, 'soma-adoption/v1');
assert.equal(record.project.repoRoot, fs.realpathSync(repo));
assert.equal(record.project.previousState, 'legacy');
assert.equal(record.git.headSha, git(repo, ['rev-parse', 'HEAD']).trim());
assert.deepEqual(record.existingArtifacts, ['docs/spec.md']);
assert.equal(record.baseline.status, 'pending');
assert.deepEqual(record.baseline.budget, {
  timeoutMs: 120_000,
  maxOutputBytesPerStream: 262_144
});
assert.equal(fs.existsSync(path.join(repo, 'baseline-executed')), false);
assert.equal(fs.readFileSync(path.join(repo, 'src/app.js'), 'utf8'), sourceBefore);
```

Run adoption twice without changing the repo and assert `.soma/adoption.json` is byte-identical and its mtime is unchanged.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-baseline.test.cjs
```

Expected: FAIL because adoption and the executor-only baseline primitive are absent.

- [ ] **Step 3: Extract a callable project-install function**

Keep the current CLI behavior in `install.cjs` and export a function used by adoption:

```js
function installProject({ projectPath, tool, mergeClaudeMd, allowLocalEdits, env }) {
  // Execute the existing init, manifest and sync stages with projectPath explicit.
  // Return {status, installStatePath, changedFiles}; preserve current exit semantics in main().
}

if (require.main === module) main();
module.exports = { installProject };
```

Do not change global `install.sh`, global ledger selection or transactional ownership.

- [ ] **Step 4: Implement inspect, baseline and atomic adoption**

Export:

```js
function inspectProject({ repoRoot, scopeRoot }) {
  // Return classification reasons, Git branch/HEAD/dirty hashes,
  // inferred test command and pre-existing artifact paths.
}

function adoptProject({ repoRoot, scopeRoot, tool = 'claude', env = process.env }) {
  // If install-state is complete, return existing adoption data read-only.
  // If .soma is absent, inspect and classify the baseline without executing it,
  // call installProject,
  // validate soma-adoption/v1 and publish adoption.json via sibling temp + rename.
  // Refuse partial, corrupt or drift-detected state.
}
```

Supported baseline discovery order is the repository's declared test script, then ecosystem-specific commands already represented in project files. Reject as `not_run_budget` scripts that declare watch/dev/serve mode, Docker, browser E2E, integration infrastructure, or fan-out across more than eight workspaces. Record an argv array, `pending` and `{timeoutMs:120000,maxOutputBytesPerStream:262144}` for an accepted command; record `not_available` when no command is proven. Do not spawn the command during adoption.

After `READY`, the orchestration reference makes this pending baseline the first FOUNDATION executor action. Add `baseline` to the internal `soma run` verbs. It accepts only `--run <runId> --dispatch <dispatchId>`, verifies `dispatchId` in `activeDispatchIds` and executes the recorded argv with `spawnSync` argument arrays, explicit scope cwd, `timeout` and `maxBuffer` from the stored budget. It writes `.soma/evidence/<runId>/baseline.json`, hashes it, and calls a new `appendProof()` export in `state.cjs` to append the proof to `continuity.proofs`. `entry.cjs` must never import, spawn or call `run/baseline.cjs`.

Persist `pass`, `fail` or `timeout` without coercion. Only a baseline that changes tracked application files blocks further mutation. The primitive never cleans those changes automatically.

- [ ] **Step 5: Run focused install and adoption tests**

Run:

```bash
node --test core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/install-e2e.test.cjs core/scripts/__tests__/init-existing.e2e-smoke.test.cjs
```

Expected: PASS. A second adoption reports no changes and does not rewrite application source.

- [ ] **Step 6: Commit**

```bash
git add core/scripts/entry/adoption.cjs core/scripts/entry.cjs core/scripts/install.cjs core/scripts/run.cjs core/scripts/run/baseline.cjs core/scripts/run/state.cjs core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-baseline.test.cjs
git commit -m "feat(entry): adopt new and legacy projects safely"
```

### Task 4: Build read-only status, resume cards and exact continuation

**Files:**

- Create: `core/scripts/entry/card.cjs`
- Create: `core/scripts/__tests__/entry-resume-safe.test.cjs`
- Create: `core/hooks/resume-confirmation-gate.cjs`
- Create: `core/hooks/__tests__/resume-confirmation-gate.test.cjs`
- Modify: `core/scripts/entry.cjs`
- Modify: `core/scripts/run/resume.cjs`
- Modify: `core/scripts/run/state.cjs`
- Modify: `core/hooks/hooks.json`
- Modify: `install/soma-hooks-map.json`
- Modify: `core/adapters/claude/install-targets.json`
- Modify: `core/scripts/__tests__/run-resume.test.cjs`
- Modify: `core/scripts/__tests__/run-state.test.cjs`

- [ ] **Step 1: Write RED zero-mutation and handshake tests**

Create a real run state, report files and dirty working tree. Snapshot recursive file hashes, mtimes, Git index hash and process list-visible lock files before calls.

```js
const inspected = runEntry(['--resume', runId, '--project', repo], { cwd: home });
assert.equal(inspected.status, 0);
const card = JSON.parse(inspected.stdout);
assert.equal(card.state, 'AWAITING_CONTINUE');
assert.equal(card.confirmation, `CONTINUAR ${runId}`);
assert.deepEqual(snapshot(repo), before);
assert.equal(fs.existsSync(path.join(repo, '.soma.lock')), false);

const wrong = runEntry(['--continue', '--run', `${runId}x`, '--project', repo]);
assert.notEqual(wrong.status, 0);
assert.deepEqual(snapshot(repo), before);
```

Add status on missing `.soma`, omitted resume ID with zero, one and two non-terminal candidates, v2 state without optional fields, state/report mismatch and branch/SHA/dirty drift after inspection. Feed hook JSON with `prompt` values `CONTINUAR <runId>`, leading/trailing text and near-matches. Only the exact complete trimmed prompt may invoke the CLI.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test core/scripts/__tests__/entry-resume-safe.test.cjs
```

Expected: FAIL because cards and safe continuation do not exist.

- [ ] **Step 3: Export the existing pure resume computation**

Refactor `run/resume.cjs` without changing its CLI output:

```js
function inspectResume({ projectRoot, runId, sessionId }) {
  // Read and validate state, choose latest report per step,
  // return {runId, reentry, lastPass, warnings, state} without writes.
}

if (require.main === module) main();
module.exports = { STEP_ORDER, latestStatusByStep, reentryFromReports, inspectResume };
```

Keep `soma run resume --run <runId>` mandatory and read-only.

- [ ] **Step 4: Add optional run context and card generation**

`freshState()` adds these optional-compatible objects for new states:

```js
entry: {
  objective: null, repoRoot: null, scopeRoot: null,
  adoptionPath: null, baseline: null, ceremony: null
},
continuity: { tasks: [], proofs: [], blocker: null, nextAction: null }
```

Old `soma-state/v2` remains valid. Status and resume normalize absent objects in memory and do not persist that normalization.

`card.cjs` exports `buildStatusCard`, `buildResumeCard`, `captureDirtyState` and `verifyResumeDrift`. The card must include every field named in AC-03. `verifyResumeDrift` compares canonical repo/scope, branch, HEAD and dirty hashes before any lock or state write.

- [ ] **Step 5: Implement exact continuation ordering**

The `UserPromptSubmit` hook supplies exact confirmation, while `entry --continue --run <id>` enforces this order:

```text
resolve project -> read handoff/state -> recompute Git and dirty hashes
-> reject drift -> acquire run lock -> persist reentry -> return CONTINUE_READY
```

No code path may acquire the lock before drift verification. Agent creation remains outside the CLI and is allowed only after `CONTINUE_READY`.

Implement `resume-confirmation-gate.cjs` as a fail-closed hook. It reads the standard hook JSON from stdin, matches only `^CONTINUAR (run-[a-z0-9-]+)$` after trimming, and calls:

```js
spawnSync('node', [installedSomaCli, 'entry', '--continue', '--run', runId], {
  cwd: input.cwd,
  encoding: 'utf8',
  env: process.env
});
```

On exit 0 it emits hook additional context containing the unchanged `CONTINUE_READY` payload, `orchestrationReference: ~/.claude/references/soma-run-orchestration.md`, and the instruction to read it before any dispatch. On nonzero, malformed JSON or unresolved installed CLI it returns a blocking hook decision and includes the diagnostic. Other prompts pass through without invoking anything. Register the hook in `hooks.json`, `soma-hooks-map.json` and Claude whole-file install targets.

- [ ] **Step 6: Run focused resume/state tests**

Run:

```bash
node --test core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/run-state.test.cjs core/hooks/__tests__/resume-confirmation-gate.test.cjs
```

Expected: PASS, including old v2 fixtures and byte-identical resume inspection.

- [ ] **Step 7: Commit**

```bash
git add core/scripts/entry/card.cjs core/scripts/entry.cjs core/scripts/run/resume.cjs core/scripts/run/state.cjs core/hooks/resume-confirmation-gate.cjs core/hooks/hooks.json install/soma-hooks-map.json core/adapters/claude/install-targets.json core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/run-state.test.cjs core/hooks/__tests__/resume-confirmation-gate.test.cjs
git commit -m "feat(resume): require read-only card and exact continuation"
```

### Task 5: Replace prose-only handoff with a validated durable pair

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

- [ ] **Step 1: Write RED schema, durability and atomicity tests**

Use the exact `soma-handoff/v2` fields from the design. Assert known-bad payloads fail for missing dirty hashes, temporary-only proof paths, undeclared agents, active agents omitted from `agents.active`, absent blocker and non-canonical resume command.

```js
const result = runRun(['handoff', '--run', runId], { cwd: repo });
assert.equal(result.status, 0, result.stderr);
const generationDir = newestValidGeneration(path.join(repo, '.soma', 'handoffs', runId));
const jsonPath = path.join(generationDir, 'handoff.json');
const mdPath = path.join(generationDir, 'handoff.md');
const json = readJson(jsonPath);
assert.equal(json.$schema, 'soma-handoff/v2');
assert.match(fs.readFileSync(mdPath, 'utf8'), new RegExp(`CONTINUAR ${runId}`));
assert.equal(git(repo, ['check-ignore', jsonPath]).status, 1);
assert.deepEqual(git(repo, ['diff', '--cached', '--name-only']).stdout, indexBefore);
assert.equal(json.artifacts.jsonTracking, 'untracked');
assert.equal(json.artifacts.markdownTracking, 'untracked');
```

Fault-inject between temp writes, JSON validation, Markdown render and rename. Expected: either the previous valid pair remains or neither new file exists.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run-gitignore.test.cjs
```

Expected: FAIL because the verb and schema are absent.

- [ ] **Step 3: Implement schema and paths**

Extend `resolveSomaPaths()` with `handoffsDir`, `runHandoffsDir` and `resolveHandoffGeneration(runId, handoffId)`. Export `HANDOFF_SCHEMA`, `validateHandoff` and `renderHandoffMarkdown` from `handoff-schema.cjs`:

```js
function validateHandoff(payload) {
  return validate(HANDOFF_SCHEMA, payload);
}

function renderHandoffMarkdown(payload) {
  // Render repo, run/tasks, dirty files, proofs, agent closure,
  // pause reason, blocker, next decision and exact resume instructions.
}
```

The real implementation returns `valid:false` with field paths for every violation. Markdown must derive only from the validated payload.

- [ ] **Step 4: Implement atomic publish without Git index mutation**

`handoff.cjs` reads run state and project evidence, creates `.soma/handoffs/<runId>/.<handoffId>.tmp/`, builds and validates `handoff.json` plus `handoff.md`, then publishes the immutable generation with one directory rename to `.soma/handoffs/<runId>/<handoffId>/`. Resume selects the newest schema-valid `createdAt`. It queries tracking status read-only with:

```js
spawnSync('git', ['status', '--porcelain=v1', '--', relativeJsonPath, relativeMarkdownPath], {
  cwd: projectRoot, encoding: 'utf8'
});
```

It must not stage, commit or push. Record each artifact as `tracked`, `modified`, `untracked` or `non_git`. Add `handoff` to `VERBS` without changing existing verb forms.

Keep `.soma/handoffs/` unignored. Add explicit tests on both sides instead of a broad `.soma/` ignore rule.

- [ ] **Step 5: Make the Claude `/handoff` adapter invoke the primitive**

Add one router at the start of `/handoff`. If explicit `--run` or a valid `.soma.lock` identifies an active SOMA run, collect required run data, close or declare agents, persist non-temporary proofs, call `node "${SOMA_HOME:-$HOME/.soma-v2}/scripts/soma.cjs" run handoff --run <runId>`, report both paths and stop. It may not also write the legacy plan handoff. Without an active run, preserve the current general-session path but mark its header `$schema: soma-handoff/legacy` and `resumable_by_soma_run: false`; it stays outside `.soma/handoffs/`. The templates must make those modes explicit.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run.test.cjs core/scripts/__tests__/run-gitignore.test.cjs
```

Expected: PASS. The previous pair survives injected failure, the Git index is unchanged, and active-run `/handoff` produces only the structured pair.

- [ ] **Step 7: Commit**

```bash
git add core/scripts/run.cjs core/scripts/run/paths.cjs core/scripts/run/handoff.cjs core/scripts/run/handoff-schema.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run.test.cjs core/scripts/__tests__/run-gitignore.test.cjs core/adapters/claude/commands/handoff.md core/templates/handoff-template.md templates/handoff-template.md
git commit -m "feat(handoff): persist structured resumable continuity"
```

### Task 6: Make `/soma-run` thin, lazy-loaded, installed and PATH-independent

**Files:**

- Modify: `core/adapters/claude/commands/soma-run.md`
- Create: `core/adapters/claude/references/soma-run-orchestration.md`
- Create: `core/scripts/__tests__/universal-entry-adapter.test.cjs`
- Modify: `core/scripts/__tests__/install-targets-set.test.cjs`
- Modify: `install/__tests__/global-install-transaction.test.cjs`

- [ ] **Step 1: Write RED adapter contract tests**

Assert the command source:

```js
assert.match(source, /\$ARGUMENTS/);
assert.match(source, /\$\{SOMA_HOME:-\$HOME\/\.soma-v2\}\/scripts\/soma\.cjs/);
assert.doesNotMatch(source, /(?:^|\s)soma\s+(?:entry|run)/m);
assert.match(source, /CONTINUAR <runId>/);
assert.match(source, /resume-confirmation-gate/);
assert.match(source, /CONTINUE_READY/);
assert.ok(Buffer.byteLength(source, 'utf8') <= 8_000);
assert.doesNotMatch(source, /STEP_1A_SPECIFY|STEP_10_COMMIT|Recovery Protocol/);
assert.match(reference, /STEP_1A_SPECIFY/);
assert.match(reference, /STEP_10_COMMIT/);

const routes = parseModeRoutes(source);
assert.deepEqual(routes.help.reads, []);
assert.deepEqual(routes.status.reads, []);
assert.deepEqual(routes.resume_inspect.reads, []);
assert.deepEqual(routes.ready.reads, ['~/.claude/references/soma-run-orchestration.md']);
assert.deepEqual(routes.continue_ready.reads, ['~/.claude/references/soma-run-orchestration.md']);
```

Prove the route parser itself with a known-bad fixture that reads the reference before help and a known-good fixture that reads it only after readiness. Assert each state-machine heading exists in exactly one current source file, the reference. Exercise installed copies in a fake HOME with `PATH` excluding any `soma` shim.

- [ ] **Step 2: Run RED tests**

Run:

```bash
node --test core/scripts/__tests__/universal-entry-adapter.test.cjs install/__tests__/global-install-transaction.test.cjs
```

Expected: FAIL because the adapter omits `$ARGUMENTS` and absolute entry routing.

- [ ] **Step 3: Extract the single orchestration source and rewrite the adapter**

Move the current 10-step, gates, recovery and efficiency body from `soma-run.md` into `core/adapters/claude/references/soma-run-orchestration.md`. Do not copy it. Add the reference as a Claude `kind:"file"` target at `~/.claude/references/soma-run-orchestration.md`.

The FOUNDATION section of that reference must make `soma run baseline --run <runId> --dispatch <dispatchId>` the first executor action when adoption recorded `pending`. It parses the persisted proof before any later mutation.

Rewrite `soma-run.md` with frontmatter argument hints and an explicit raw argument block containing `$ARGUMENTS`. Keep it at or below 8,000 UTF-8 bytes, with an implementation target near 4,000. The adapter must:

1. classify help/status/resume/start before the 10-step prompt;
2. call the fixed absolute Node CLI;
3. stop on every non-`READY` start response;
4. print resume cards without state writes;
5. wait for the `UserPromptSubmit` confirmation hook to emit `CONTINUE_READY`;
6. fail closed when the hook blocks or emits any other state;
7. read `~/.claude/references/soma-run-orchestration.md` exactly once only after `READY` or `CONTINUE_READY`;
8. dispatch no agent before that authorized lazy read.

Keep the current orchestration invariants, report gates, efficiency envelope and compressed/full ceremony rules. Do not add `/soma:run` or a plugin.

- [ ] **Step 4: Prove install and live-sync parity**

Extend the global transaction test so the watched set includes installed `soma.cjs`, `entry.cjs`, `entry/args.cjs`, `entry/project.cjs`, `entry/adoption.cjs`, `entry/card.cjs`, `commands/soma-run.md` and `references/soma-run-orchestration.md`. Add a fault point after core copy and after file sync. Assert rollback restores all watched hashes.

Run:

```bash
node --test core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
```

Expected: PASS with no `soma` executable on `PATH`.

- [ ] **Step 5: Commit**

```bash
git add core/adapters/claude/commands/soma-run.md core/adapters/claude/references/soma-run-orchestration.md core/adapters/claude/install-targets.json core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
git commit -m "feat(adapter): route soma-run through absolute safe entry"
```

### Task 7: Migrate current documentation to the canonical public name

**Files:**

- Modify: `README.md`
- Modify: `docs/QUICKSTART.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `core/scripts/__tests__/universal-entry-docs.test.cjs`

- [ ] **Step 1: Write the RED documentation scan**

Scan only current user docs, not `core/specs/`, snapshots or archived evidence:

```js
for (const file of ['README.md', 'docs/QUICKSTART.md', 'docs/INSTALL.md', 'docs/ARCHITECTURE.md']) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.doesNotMatch(text, /\/soma:run\b/, file);
  assert.match(text, /\/soma-run\b/, file);
}
```

Also assert architecture names `.soma/run-state-<runId>.json`, `.soma/handoffs/<runId>/<handoffId>/handoff.json`, the installed orchestration reference and the exact confirmation.

- [ ] **Step 2: Run RED test**

Run:

```bash
node --test core/scripts/__tests__/universal-entry-docs.test.cjs
```

Expected: FAIL on the existing `/soma:run` references and temporary-state description.

- [ ] **Step 3: Update current docs**

Document only `/soma-run` as the public entry, show normal, help, status and resume examples, explain the absolute installed CLI prerequisite, describe automatic adoption and state that starting from home requires `--project` or a validated handoff. Replace the old `/tmp/soma-state-{sessionId}.json` architecture claim with project run state and structured handoff paths.

Do not rewrite historical specs that quote old behavior.

- [ ] **Step 4: Run GREEN test**

Run:

```bash
node --test core/scripts/__tests__/universal-entry-docs.test.cjs
```

Expected: PASS with zero `/soma:run` in current user docs.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/QUICKSTART.md docs/INSTALL.md docs/ARCHITECTURE.md core/scripts/__tests__/universal-entry-docs.test.cjs
git commit -m "docs(soma): make soma-run the canonical public entry"
```

### Task 8: Prove the full contract and normal-command regression

**Files:**

- Create: `core/scripts/__tests__/universal-entry-e2e.test.cjs`
- Modify: `core/scripts/__tests__/trilho-e2e.test.cjs`
- Modify: `core/scripts/__tests__/cross-harness-parity.test.cjs`

- [ ] **Step 1: Capture the inherited full-suite baseline**

Before implementation commits change behavior, run:

```bash
npm test > .soma/universal-entry-npm-baseline.log 2>&1; test $? -ne 0
rg -n "operator-gate\.cjs|not ok|fail" .soma/universal-entry-npm-baseline.log
git merge-base --is-ancestor 1cbebb4 HEAD
git merge-base --is-ancestor b3a4997 HEAD
```

Expected: the suite is nonzero because spec 024 deliberately expects the absent `operator-gate.cjs`; both ancestry checks exit 0. Record the exact failing test names in the run evidence. Do not create `operator-gate.cjs`, change its assertions or otherwise implement spec 024 in this plan.

- [ ] **Step 2: Write the RED end-to-end matrix**

Use real filesystem and child processes. The matrix must contain:

```text
new explicit project + objective -> adopted -> READY
legacy project without .soma + dirty files -> adopted with matching hashes -> READY
installed project + objective -> no adoption rewrite -> READY
non-Git empty or marker-bearing cwd outside home -> classified new -> READY
home cwd + no project/handoff -> PROJECT_UNRESOLVED, no mutation
monorepo valid workspace -> READY with repoRoot and scopeRoot distinct
monorepo invalid nested scope -> MONOREPO_SCOPE_AMBIGUOUS, no mutation
status/help -> recursive snapshot identical
resume inspection -> card, no lock, no agent
wrong confirmation -> hook pass-through, no mutation
exact confirmation after drift -> RESUME_DRIFT, no mutation
exact confirmation without drift -> CONTINUE_READY at first non-pass step
handoff generation directory -> validated JSON and Markdown, index unchanged -> resume from home through newest valid generation
help/status/resume inspect -> orchestration reference read count 0
READY/CONTINUE_READY -> orchestration reference read count 1 -> first FOUNDATION executor records bounded baseline proof
normal objective -> existing gate/report orchestration remains reachable
```

- [ ] **Step 3: Run the focused matrix**

Run:

```bash
node --test core/scripts/__tests__/universal-entry-e2e.test.cjs core/scripts/__tests__/trilho-e2e.test.cjs core/scripts/__tests__/cross-harness-parity.test.cjs
```

Expected before final wiring: at least one RED on normal objective or handoff-based resume. Apply the smallest wiring correction, then rerun until PASS.

- [ ] **Step 4: Run deterministic delta verification**

Run:

```bash
npm test > .soma/universal-entry-npm-final.log 2>&1; test $? -ne 0
node --test install/__tests__/*.test.cjs
bash install/__tests__/synthetic-env.test.sh
git diff --check
git status --short
```

Expected:

```text
npm test: nonzero only for the exact spec 024 failure set captured before implementation
install node tests: exit 0
synthetic environment: exit 0
git diff --check: no output
git status --short: only intended implementation/docs and pre-existing .soma/ entries
```

Compare the failing test names from the two npm logs. Any new failure is a blocker. The known spec 024 RED is not a blocker for this feature and must not be repaired here.

- [ ] **Step 5: Run the lightweight SONAR self-audit**

Check architecture, state compatibility, test coverage, install ownership and spec adherence against AC-01 through AC-13. Confirm:

```text
no production dependency added
no plugin or PATH shim added
no historical spec rewritten
no application source written during adoption
no write before exact resume confirmation
no critical proof limited to temporary or ignored storage
```

Fix only blocking findings and rerun their focused tests plus the npm delta comparison once.

- [ ] **Step 6: Commit integration proof**

```bash
git add core/scripts/__tests__/universal-entry-e2e.test.cjs core/scripts/__tests__/trilho-e2e.test.cjs core/scripts/__tests__/cross-harness-parity.test.cjs
git commit -m "test(entry): prove universal start and safe resume"
```

## Completion gate

- [ ] Every AC maps to at least one passing behavioral test.
- [ ] Help, status and resume inspection are byte and mtime identical.
- [ ] Adoption is byte-stable on repeat and preserves application source.
- [ ] Resume needs exact confirmation and rechecks drift before lock/state writes.
- [ ] Handoff JSON and Markdown validate, survive fault injection, stay project-resident and do not change the Git index.
- [ ] Global install rollback covers the adapter and internal entry modules.
- [ ] Thin adapter is at most 8,000 bytes and the single long reference is loaded only after `READY` or `CONTINUE_READY`.
- [ ] `/soma:run` is absent from current user docs.
- [ ] Normal `/soma-run "objective"` still reaches orchestration.
- [ ] Focused suites pass, install suites pass, `git diff --check` passes, and the npm full-suite failure set has no delta beyond the captured spec 024 RED.
