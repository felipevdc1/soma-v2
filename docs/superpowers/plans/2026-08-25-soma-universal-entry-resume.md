# SOMA Universal Entry and Safe Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/soma-run` the only public entry for new, legacy, installed and monorepo projects, with a fixed shell boundary, a one-time request broker, read-only inspection and drift-bound continuation.

**Architecture:** A fixed dynamic command scavenges only a valid expired same-session entry, then prepares an owner-only TTL-bounded slot bound to native `${CLAUDE_SESSION_ID}` and returns the runtime identity `{sessionId,requestId,capability}`. The adapter attempts to write one `soma-entry-request/v1` containing that identity and exact `$ARGUMENTS` as `rawArguments`; its `finally` path composes fixed-shape consume or abort with the three format-validated runtime tokens. Before opening lease or envelope, consume validates the canonical broker root and every path component for containment, symlinks, owner and mode. It opens both files with no-follow, compares `argv = lease = envelope`, and only then claims. After claim it discards the old descriptor, revalidates the chain, opens the canonical request path anew with no-follow and matches new bytes, device, inode, size and hash with the pre-claim read before parsing `rawArguments`. Host death may leave one inert TTL-bounded slot for deterministic next-prepare scavenging after expiry. Invalid structures fail `BROKER_CORRUPT` and remain untouched. No user request value enters Bash. Handoff publishes facts without a digest; resume inspection computes `continuityDigest` after publication, and continue recomputes every input before any project lock or write. Entry returns baseline facts, while the orchestrator creates one `T-BASELINE` after `READY` and an executor runs it through dispatch records.

**Tech Stack:** Node.js 22 CommonJS, `node:test`, built-in JUnit reporter, Git CLI through argument arrays, SHA-256 canonical JSON, existing SOMA install and sync components.

---

## Acceptance map, dependencies and ownership

Each task has one executor and an exclusive write set. A later task may modify an earlier file only when its file list says so. Every executor reads the design before starting and returns status, commit SHA, commands, results and blockers in at most 4,000 bytes.

| Task | Owner | Depends on | Acceptance criteria |
|---|---|---|---|
| 0 | test-baseline executor | none | AC-15 |
| 1 | broker executor | 0 | AC-01, AC-02 |
| 2 | entry-resolution executor | 1 | AC-01, AC-03, AC-04 |
| 3 | adoption executor | 2 | AC-05 |
| 4 | checkpoint executor | 2 | AC-07 |
| 5 | baseline-gate executor | 3, 4 | AC-06 |
| 6 | handoff executor | 4 | AC-08 |
| 7 | continuity executor | 2, 4, 6 | AC-03, AC-09, AC-10 |
| 8 | adapter-install executor | 1, 3, 5, 7 | AC-01, AC-11, AC-12 |
| 9 | integration-docs executor | 0 through 8 | AC-13, AC-14, AC-15 and full matrix |

Safe waves are `0`, then `1`, then `2`, then `3 + 4`, then `5 + 6`, then `7`, then `8`, then `9`. Do not run tasks with overlapping write sets concurrently. Each task uses one initial attempt and at most one correction under the normal dispatch-record envelope.

Do not add a plugin, daemon, hook, dependency, PATH shim, public alias or silent cwd change. Do not edit historical files under `core/specs/` or snapshots. Do not implement the inherited spec 024 failure.

### Task 0: Capture a structured immutable failure baseline

**Files:**

- Create: `core/scripts/test/junit-failure-set.cjs`
- Create: `core/scripts/__tests__/structured-test-baseline.test.cjs`
- Runtime only: `.soma/baselines/universal-entry-base.junit.xml`
- Runtime only: `.soma/baselines/universal-entry-base.json`

- [ ] **Step 1: Write RED normalization tests**

Test JUnit fixtures with duplicate short names in different files, multiline errors, XML escapes, Windows and POSIX separators, missing stack locations and changed line numbers. `parseFailureSet(xml, {repoRoot})` must return:

```json
{
  "$schema": "soma-test-baseline/v1",
  "candidateSha": "git-sha",
  "command": ["node", "--test", "--test-reporter=junit", "core/scripts/__tests__/*.test.cjs", "core/hooks/__tests__/*.test.cjs"],
  "exitCode": 1,
  "failures": [
    {
      "fullName": "suite > exact test name",
      "file": "core/scripts/__tests__/example.test.cjs",
      "errorName": "AssertionError",
      "message": "exact normalized first error message",
      "failureSha256": "sha256-of-normalized-failure-details"
    }
  ],
  "junitSha256": "sha256-of-exact-xml-bytes"
}
```

Sort failures by UTF-8 bytes of file, then full name, error name, message and failure hash. Normalize CRLF to LF and repo paths to POSIX relative paths. Do not use test ordinal, TAP indentation or line number as identity.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/structured-test-baseline.test.cjs
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the parser and run GREEN**

Use only Node built-ins. Parse `<testcase>` and nested `<failure>` records, decode XML entities, retain the full testcase name, take the first in-repo source path from failure details, split error name and first message, and hash the normalized complete failure detail. Reject malformed XML and duplicate normalized identities.

```bash
node --test core/scripts/__tests__/structured-test-baseline.test.cjs
```

Expected: PASS.

- [ ] **Step 4: Capture at the exact docs-only candidate with cleanup traps**

The script below records the full command rather than claiming it ran `npm test`. `node --test --test-reporter=junit` is the same file set as the current package test script and uses the verified Node 22 reporter.

```bash
candidate_sha="$(git rev-parse HEAD)"
repo_root="$(pwd -P)"
baseline_worktree="$(mktemp -d)"
cleanup_baseline() {
  git -C "$repo_root" worktree remove --force "$baseline_worktree" >/dev/null 2>&1 || true
  rmdir "$baseline_worktree" >/dev/null 2>&1 || true
}
trap cleanup_baseline EXIT INT TERM HUP
git merge-base --is-ancestor 1cbebb4 "$candidate_sha"
git merge-base --is-ancestor b3a4997 "$candidate_sha"
git worktree add --detach "$baseline_worktree" "$candidate_sha"
mkdir -p "$repo_root/.soma/baselines"
set +e
(
  cd "$baseline_worktree"
  node --test --test-reporter=junit core/scripts/__tests__/*.test.cjs core/hooks/__tests__/*.test.cjs
) > "$repo_root/.soma/baselines/universal-entry-base.junit.xml" 2>&1
baseline_exit=$?
set -e
node core/scripts/test/junit-failure-set.cjs \
  --junit "$repo_root/.soma/baselines/universal-entry-base.junit.xml" \
  --out "$repo_root/.soma/baselines/universal-entry-base.json" \
  --repo "$baseline_worktree" \
  --candidate "$candidate_sha" \
  --exit "$baseline_exit"
cleanup_baseline
trap - EXIT INT TERM HUP
```

Expected: the JSON validates, names the inherited spec 024 failure, preserves its source file and error, and hashes the XML. The detached worktree is absent even when tests fail.

- [ ] **Step 5: Commit test infrastructure**

```bash
git add core/scripts/test/junit-failure-set.cjs core/scripts/__tests__/structured-test-baseline.test.cjs
git commit -m "test(entry): capture structured failure identity"
```

### Task 1: Build the native-session-bound request broker

**Files:**

- Create: `core/scripts/entry/request-schema.cjs`
- Create: `core/scripts/entry/request-broker.cjs`
- Create: `core/scripts/entry.cjs`
- Create: `core/scripts/__tests__/entry-request-schema.test.cjs`
- Create: `core/scripts/__tests__/entry-request-broker.test.cjs`
- Modify: `core/scripts/soma.cjs`

- [ ] **Step 1: Write RED schema and broker tests**

Validate the one envelope shape `{sessionId,requestId,capability,rawArguments}` and reject surplus fields, wrong types and oversize content. Require request ID to match `^[0-9a-f]{32}$` and capability to match `^[0-9a-f]{64}$`. Verify that prepare rejects missing or malformed native session IDs, hashes the validated ID into a session directory, uses exact `0700` and `0600` modes, pre-creates an empty regular slot with no-follow plus `O_EXCL`, and returns the validated session ID, random request ID and random capability with the exact pre-created path.

Assert the lease contains only session ID, random request ID/capability, exact path, bounded TTL and monotonic-safe creation and expiry timestamps. It must not require mode or content hash before the Write, and wall-clock adjustment must not extend it. Prepare twice in one session fails or returns the same slot only while it is empty, intact and unexpired. Sessions A and B prepare concurrently into distinct directories; consume B never enumerates A.

Falsify traversal, parent symlink, request symlink, slot swap, wrong owner/mode, replay, two consumers, concurrent preparation, expired lease and hostile `rawArguments`. Exactly one consume wins by atomic claim. Prove that malformed session, request ID or capability fails before filesystem access. Before opening lease or envelope, replace each parent in turn with a symlink, wrong-owner/mode component or canonical escape and assert rejection without either file opening or a claim. Prove that a well-formed but incorrect argv token fails before claim and leaves the slot intact; and consume validates the lease and envelope without mutation before requiring identity agreement across argv, lease and envelope. Add an explicit case where only the envelope capability differs: it must create no claim, preserve the slot for diagnosis or authorized abort, and cause no project, Git or run mutation. Swap the envelope between the pre-read and claim. Assert consume discards the old descriptor, revalidates the chain, opens the canonical request path anew with no-follow, compares new bytes, device, inode, size and hash with the pre-read, and rejects the swap before parsing `rawArguments`. Prove the parser receives only the new opening's bytes and cleanup stays limited to the authenticated slot. Prove that failed or rejected Write selects abort and removes the matching slot; a consume error cleans in `finally`; repeated abort is harmless; and normally continuing flows leave zero slot. Kill the host after prepare and assert one inert slot may remain through its bounded TTL with no project, Git or run mutation. Expire R1, prepare R2, then invoke delayed consume and abort with R1 tokens; neither may claim, parse or remove R2. Assert consume after expiry fails closed, the next same-session prepare atomically renames/claims and removes a schema-valid, owner/mode-valid expired slot before creating another, and an invalid schema, wrong owner/mode or symlink returns `BROKER_CORRUPT` without automatic removal. Send SIGINT, SIGTERM and SIGHUP to a child consumer. Document that tests cover corruption and normal cross-session isolation, not a sandbox against a hostile same-uid process.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/entry-request-schema.test.cjs core/scripts/__tests__/entry-request-broker.test.cjs
```

Expected: FAIL because broker modules and CLI forms are absent.

- [ ] **Step 3: Implement fixed preparation, consumption and abort**

Register only these internal forms:

```text
entry broker-prepare --session <native-session-id>
entry broker-consume --session <native-session-id> --request-id <32-lowercase-hex> --capability <64-lowercase-hex>
entry broker-abort --session <native-session-id> --request-id <32-lowercase-hex> --capability <64-lowercase-hex>
```

Prepare requires `--session <native-session-id>`. Consume and abort require `--session`, `--request-id` and `--capability` in fixed-shape templates. Validate all token alphabets and lengths before any filesystem access. Prepare claims only a schema-valid, owner/mode-valid expired same-session slot by atomic rename and removes it, then creates a minimal lease and empty slot with a short bounded TTL and monotonic-safe timestamps. A malformed lease, wrong owner/mode, symlink or other invalid structure returns `BROKER_CORRUPT` and remains untouched. Prepare returns the validated session ID, random request ID, random capability, path and expiry.

Consume must implement this order: validate the canonical broker root, session directory, slot containment and every parent component with `lstat` and `realpath`; reject any symlink, owner/mode error, non-directory parent or canonical escape before opening lease or envelope; then open both as regular files with no-follow and validate schema, live expiry, size and formats. Retain the envelope's exact bytes, device, inode, size and content hash; compare `argv sessionId/requestId/capability = lease = envelope`; and fail without claim, cleanup or project/Git/run mutation on any mismatch. Preserve a mismatched slot for diagnosis or authorized abort. Only after equality may consume create the exclusive claim. Close and never reuse the pre-claim descriptor. Revalidate the canonical chain, open `request.json` again by the authenticated canonical path with no-follow, revalidate the regular file and compare its new bytes, device, inode, size and content hash with the pre-read. Post-claim drift fails closed before parsing `rawArguments`, and cleanup removes only the authenticated slot. Parse and route only the bytes returned by the new opening. Abort compares the same argv tuple with the lease before claiming without parse or route, then performs the same cleanup. Cleanup in both commands is idempotent, and abort itself is idempotent. A malformed token never reaches the filesystem; a well-formed mismatch removes nothing. Signal handlers enter the same cleanup path. Host death may leave one inert slot; after expiry, the next prepare scavenges it only if it remains structurally valid.

- [ ] **Step 4: Run GREEN and dispatcher regressions**

```bash
node --test core/scripts/__tests__/entry-request-schema.test.cjs core/scripts/__tests__/entry-request-broker.test.cjs core/scripts/__tests__/soma-dispatcher.test.cjs
```

Expected: PASS; sessions A/B cannot cross, parent symlinks and canonical escapes fail before file opening, an envelope-only capability mismatch creates no claim and preserves the slot, a swap between pre-read and claim is detected by a new canonical no-follow opening before `rawArguments` parsing, the parser receives only the new bytes, one same-session consumer wins, replay fails, normal flows leave zero slot, crash residue is TTL-bounded and scavenged, stale cleanup preserves a newer lease, and the lease never predicts request fields.

- [ ] **Step 5: Commit**

```bash
git add core/scripts/entry/request-schema.cjs core/scripts/entry/request-broker.cjs core/scripts/entry.cjs core/scripts/soma.cjs core/scripts/__tests__/entry-request-schema.test.cjs core/scripts/__tests__/entry-request-broker.test.cjs
git commit -m "feat(entry): add one-time request broker"
```

### Task 2: Route envelopes and resolve project scope read-only

**Files:**

- Create: `core/scripts/entry/request.cjs`
- Create: `core/scripts/entry/raw-arguments.cjs`
- Create: `core/scripts/entry/project.cjs`
- Create: `core/scripts/entry/git-readonly.cjs`
- Create: `core/scripts/entry/card.cjs`
- Create: `core/scripts/__tests__/entry-raw-arguments.test.cjs`
- Create: `core/scripts/__tests__/entry-request-routing.test.cjs`
- Create: `core/scripts/__tests__/entry-project.test.cjs`
- Modify: `core/scripts/entry.cjs`

- [ ] **Step 1: Write RED mode and resolver tests**

Feed exact `rawArguments` strings for help, status, resume, continue and start to a pure lexer/parser. Whitespace separates outside quotes; single and double quotes group; backslash escapes outside single quotes; quoted newlines remain literal. `$()`, backticks, semicolons and pipes are ordinary characters and never execute. Cover empty quoted values, duplicate/conflicting flags, malformed quoting, run IDs and digests. Assert the original string remains byte-exact and mode classification contains no Claude interpretation.

Feed parser results to the controller. Cover explicit repo and scope, Git cwd, declared workspaces, empty non-Git cwd, marker-bearing cwd and handoff generation. Reject home, root, markerless non-empty cwd, outside scope, symlink escape and ambiguous monorepo.

Create a stale Git stat cache, record index bytes and nanosecond mtime, then run help, status and resume. Record project tree bytes and mtimes, run state, lock and agent records. After external broker cleanup, all project observations must remain exact. Assert `process.cwd()` never changes.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/entry-raw-arguments.test.cjs core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/entry-project.test.cjs
```

Expected: FAIL because routing and resolution are absent.

- [ ] **Step 3: Implement controller and read-only Git helper**

`parseRawArguments(raw)` returns exactly `{mode, objective, runId, project, scope, handoff, continuityDigest}` or a typed argument error. It is a data parser, not a shell parser or model prompt. `routeEntryRequest(parsed, context)` dispatches one mode and returns one JSON result. It passes literal values as function data, never shell text. `resolveProject` canonicalizes before containment checks and never calls `process.chdir()`. Route every Git inspection through:

```js
spawnSync('git', ['--no-optional-locks', ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
});
```

Help returns before project resolution. Status and resume use read-only cards. Continue is still a non-mutating placeholder that rejects until Task 7 supplies digest validation.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/entry-raw-arguments.test.cjs core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/entry-request-broker.test.cjs
git add core/scripts/entry/request.cjs core/scripts/entry/raw-arguments.cjs core/scripts/entry/project.cjs core/scripts/entry/git-readonly.cjs core/scripts/entry/card.cjs core/scripts/entry.cjs core/scripts/__tests__/entry-raw-arguments.test.cjs core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/entry-project.test.cjs
git commit -m "feat(entry): route envelopes without cwd mutation"
```

Expected: PASS and zero project mutation in read-only modes.

### Task 3: Inspect and adopt projects without running baseline

**Files:**

- Create: `core/scripts/entry/adoption.cjs`
- Create: `core/scripts/__tests__/entry-adoption.test.cjs`
- Modify: `core/scripts/entry/request.cjs`
- Modify: `core/scripts/install.cjs`
- Modify: `core/scripts/__tests__/install-e2e.test.cjs`

- [ ] **Step 1: Write RED adoption tests**

Cover new non-Git, legacy dirty Git, installed and monorepo projects. Verify canonical paths, detection reasons, branch, HEAD, dirty hashes, existing artifacts and baseline detection. Safe commands produce `baselineRequired:true` plus `pending` and budgets. Watch, dev, serve, Docker, browser E2E, integration infrastructure and more than eight workspaces produce `not_run_budget`; absence produces `not_available`.

Place an execution sentinel in every detected script. Assert entry returns `READY` without creating a task, dispatch record, agent or sentinel. Repeat adoption and compare bytes and mtime. Partial, corrupt or drifted `.soma` must remain byte-identical and return `ADOPTION_BLOCKED`.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/install-e2e.test.cjs
```

Expected: FAIL because adoption is absent.

- [ ] **Step 3: Implement inspection and adoption**

Extract a callable project installation function without changing the existing CLI. Adoption may write only SOMA metadata and the established anchored bootloader. Publish canonical `soma-adoption/v1` with sibling temporary file plus rename. Return baseline facts in readiness output; do not import baseline execution or dispatch code.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/install-e2e.test.cjs
git add core/scripts/entry/adoption.cjs core/scripts/entry/request.cjs core/scripts/install.cjs core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/install-e2e.test.cjs
git commit -m "feat(entry): adopt projects without script execution"
```

Expected: PASS; no task or agent exists before `READY`.

### Task 4: Make checkpoint publication recoverable

**Files:**

- Create: `core/scripts/run/checkpoint.cjs`
- Create: `core/scripts/__tests__/run-checkpoint.test.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/paths.cjs`
- Modify: `core/scripts/run/state.cjs`

- [ ] **Step 1: Write RED transaction and orphan tests**

Validate bounded regular `soma-checkpoint/v1` input, run ID, semantic content hash and exact sequence. Inject failure before temporary fsync, before rename and after rename but before state replacement. Assert only state-referenced checkpoints are returned by readers.

Retry identical content after the publish/state gap. It must validate and reuse the exact same-hash orphan at the expected sequence, then append one reference. Put a valid different-hash orphan and an invalid same-name file beside it; neither may be selected or affect handoff inputs. Race two writers and require one ordered state result.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-state.test.cjs
```

Expected: FAIL because checkpoint and recovery are absent.

- [ ] **Step 3: Implement the transaction**

Under the existing run mutation lock, hash canonical semantic input, return an already referenced equal hash, validate one expected-sequence equal-hash orphan, or publish a new immutable file by fsync and rename. Atomically replace run state with one new reference only after publication. Readers follow references and ignore directory enumeration results.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-state.test.cjs core/scripts/__tests__/run.test.cjs
git add core/scripts/run/checkpoint.cjs core/scripts/run.cjs core/scripts/run/paths.cjs core/scripts/run/state.cjs core/scripts/__tests__/run-checkpoint.test.cjs
git commit -m "feat(run): recover checkpoint publication by hash"
```

Expected: PASS, including the publish/state fault window.

### Task 5: Gate all work on one orchestrator-created baseline task

**Files:**

- Create: `core/scripts/run/baseline.cjs`
- Create: `core/scripts/__tests__/run-baseline.test.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/state.cjs`
- Modify: `core/scripts/run/dispatch-record.cjs`
- Modify: `core/scripts/__tests__/run-dispatch-record.test.cjs`
- Create: `core/adapters/claude/references/soma-run-orchestration.md`

- [ ] **Step 1: Write RED ownership and gate tests**

Starting from `READY` with `baselineRequired:true`, prove no logical baseline task exists until the orchestration reference creates it. A first `T-01` dispatch must fail `BASELINE_REQUIRED` without a record. The orchestrator then creates one `T-BASELINE`, records its dispatch and assigns an executor. A duplicate live logical baseline fails `BASELINE_ALREADY_ACTIVE`. Attempts stay under the same task and obey the two-attempt limit.

The executor command validates the active dispatch, explicit scope cwd and stored argv. Cover pass, nonzero exit, 120-second timeout, 256-KiB stdout and stderr limits and spawn failure. Pass records a hashed proof and unlocks later tasks. Failure records proof plus authoritative diagnostic checkpoint and pauses without deleting or resetting files.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs
```

Expected: FAIL because baseline execution and the global gate are absent.

- [ ] **Step 3: Implement executor-owned baseline and gate**

The entry result remains input to orchestration. The reference must create and dispatch `T-BASELINE` only after `READY` and before any other task. The baseline primitive accepts only a valid active baseline dispatch, runs the detected argv with limits, writes proof and updates state. `dispatch-record begin` enforces the gate independently of prompt behavior.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-state.test.cjs
git add core/scripts/run/baseline.cjs core/scripts/run.cjs core/scripts/run/state.cjs core/scripts/run/dispatch-record.cjs core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-dispatch-record.test.cjs core/adapters/claude/references/soma-run-orchestration.md
git commit -m "feat(run): gate tasks on executor baseline proof"
```

Expected: PASS; the task name stays exactly `T-BASELINE` and identifies one logical task.

### Task 6: Publish fact-only immutable handoff generations

**Files:**

- Create: `core/scripts/run/handoff-schema.cjs`
- Create: `core/scripts/run/handoff.cjs`
- Create: `core/scripts/__tests__/run-handoff.test.cjs`
- Modify: `core/scripts/run.cjs`
- Modify: `core/scripts/run/paths.cjs`
- Modify: `core/adapters/claude/commands/handoff.md`
- Modify: `core/templates/handoff-template.md`
- Modify: `templates/handoff-template.md`
- Modify: `core/scripts/__tests__/run-gitignore.test.cjs`

- [ ] **Step 1: Write RED derivation and publication tests**

Build dispatch fixtures with prompt, metadata and output hashes. Active or contradictory records must block. Task attempt and agent closure must derive from records, while pause reason, blocker, next decision and summary come only from the latest state-referenced checkpoint. Caller-supplied task or agent truth must be rejected.

Reject ignored, OS-temporary, external, escaped and symlinked proof paths. Fault-inject validation, fsync and generation rename. Assert an immutable JSON/Markdown pair or no generation, never a half pair. Compare Git index bytes and mtime. Verify the JSON has only durable facts and `/soma-run --resume <runId>`; it has no continuation digest or continuation invocation. Tracking status appears in CLI output after publication, not inside the generation.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run-gitignore.test.cjs
```

Expected: FAIL because the handoff writer is absent.

- [ ] **Step 3: Implement schema, derivation and atomic publish**

Read only run state, the selected referenced checkpoint, dispatch components and durable proofs. Validate canonical JSON and derived Markdown in a sibling temporary directory, fsync them and publish with one directory rename. Existing generations stay immutable. After publication, report `tracked`, `modified`, `untracked` or `non_git` without changing the index.

Route an active SOMA `/handoff` through checkpoint then handoff. Keep non-run legacy handoff outside `.soma/handoffs/` and mark it non-resumable.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run-gitignore.test.cjs core/scripts/__tests__/run.test.cjs
git add core/scripts/run/handoff-schema.cjs core/scripts/run/handoff.cjs core/scripts/run.cjs core/scripts/run/paths.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/run-gitignore.test.cjs core/adapters/claude/commands/handoff.md core/templates/handoff-template.md templates/handoff-template.md
git commit -m "feat(handoff): publish durable facts before continuity"
```

Expected: PASS and no digest cycle.

### Task 7: Compute and verify complete post-publication continuity

**Files:**

- Create: `core/scripts/entry/canonical-json.cjs`
- Create: `core/scripts/entry/continuity.cjs`
- Create: `core/scripts/__tests__/entry-continuity.test.cjs`
- Create: `core/scripts/__tests__/entry-resume-safe.test.cjs`
- Modify: `core/scripts/entry/card.cjs`
- Modify: `core/scripts/entry/request.cjs`
- Modify: `core/scripts/run/resume.cjs`
- Modify: `core/scripts/run/state.cjs`
- Modify: `core/scripts/__tests__/run-resume.test.cjs`

- [ ] **Step 1: Write RED canonicalization and completeness tests**

Build the complete `soma-continuity/v1` fixture. Randomize object insertion order and input enumeration; digest must remain equal. Randomize each domain array before normalization; expected orders are dirty path/status, checkpoint numeric sequence, dispatch task/attempt, proof kind/path/hash, task ID and agent ID. Cover explicit nulls, UTF-8 paths, staged-only files and absent Git branch.

Mutate one field at a time: run state hash, last safe state, repo, scope, handoff generation, either handoff file, branch, HEAD, dirty status or content, selected checkpoint, each dispatch component, executor, base SHA, proof status or bytes, blocker, next decision, task summary or attempts, and agent closure. Every mutation must change the digest.

- [ ] **Step 2: Write RED resume and handoff-cycle tests**

Publish a handoff into a clean fixture. A digest computed before publication must fail because the generation hashes and two new dirty paths are absent. Resume inspection must reread after publication and print:

```text
/soma-run --continue <runId> --project "<repo>" --scope "<scope>" --digest <lowercase-64-hex> --handoff "<generationId>"
```

Feed those values through a new envelope. Continue must reload all facts and compare before lock creation or state write. Assert `RESUME_DRIFT` and byte/mtime identity for every mutation above, missing or ambiguous run, corrupt generation pair and a different checkpoint orphan.

- [ ] **Step 3: Run RED**

```bash
node --test core/scripts/__tests__/entry-continuity.test.cjs core/scripts/__tests__/entry-resume-safe.test.cjs
```

Expected: FAIL because canonical continuity is absent.

- [ ] **Step 4: Implement canonical continuity and continue ordering**

Hash canonical JSON with UTF-8 key order, domain array normalization, explicit nulls and no trailing newline. Build continuity only from reread durable facts after handoff publication. Select checkpoints from state references only. Continue order is:

```text
validate consumed envelope -> resolve exact locator -> reread all continuity inputs
-> canonicalize and hash -> compare digest -> acquire project/run lock
-> persist reentry -> return CONTINUE_READY
```

No hook participates.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/entry-continuity.test.cjs core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/run-resume.test.cjs core/scripts/__tests__/run-state.test.cjs
git add core/scripts/entry/canonical-json.cjs core/scripts/entry/continuity.cjs core/scripts/entry/card.cjs core/scripts/entry/request.cjs core/scripts/run/resume.cjs core/scripts/run/state.cjs core/scripts/__tests__/entry-continuity.test.cjs core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/run-resume.test.cjs
git commit -m "feat(resume): bind continue to complete continuity"
```

Expected: PASS and drift always precedes project mutation.

### Task 8: Make the adapter fixed, lazy and transactionally installed

**Files:**

- Modify: `core/adapters/claude/commands/soma-run.md`
- Create or complete: `core/adapters/claude/references/soma-run-orchestration.md`
- Modify: `core/adapters/claude/install-targets.json`
- Create: `core/scripts/__tests__/universal-entry-adapter.test.cjs`
- Modify: `core/scripts/__tests__/install-targets-set.test.cjs`
- Modify: `install/__tests__/global-install-transaction.test.cjs`

- [ ] **Step 1: Write RED adapter boundary and lazy-load tests**

Assert the adapter contains `$ARGUMENTS`, frontmatter `disable-model-invocation: true`, and the fixed dynamic prepare command with only `${CLAUDE_SESSION_ID}` substitution. Consume and abort must have fixed argument shape and interpolate only the prepare-returned session ID, request ID and capability after format validation. The adapter must be at most 8,000 UTF-8 bytes and contain none of the 10-step headings. Each heading must exist once in the long reference. Reject any `UserPromptExpansion` transport.

Use the real skill harness to make prepare return validated native session ID plus 32-lowercase-hex request ID and 64-lowercase-hex capability. Instrument structured writes: preparation also supplies the pre-created path; the adapter writes `{sessionId,requestId,capability,rawArguments}` and copies `$ARGUMENTS` byte-for-byte without classifying mode or calculating a hash. After successful Write, the adapter invokes consume in `finally`; after failed or rejected Write, it invokes abort there instead. The adapter validates the three tokens before composing either call. Both calls carry `--session`, `--request-id` and `--capability`; they have the same fixed identity-argument shape but are not byte-identical. Neither contains `$ARGUMENTS`, objective, request path, SOMA run ID, project, scope, handoff or digest. Assert malformed tokens never invoke the CLI, well-formed incorrect tokens leave the slot intact, both cleanup paths are idempotent, and normally continuing flows leave zero slot.

Exercise raw text containing objective, run ID, project, scope, handoff and digest syntax with quotes, `$()`, backticks, newlines and a sentinel. Assert the raw string round-trips, the CLI parser produces the expected mode and the sentinel is absent. This proves shell safety, not resistance to instructions the user intentionally gives Claude. Also test missing/mismatched session ID, sessions A/B and a slot swapped after prepare. The swap must fail before project/run mutation. Use a fake home and remove any `soma` shim from `PATH`.

Instrument reference reads and agent creation. Help, status, resume, broker rejection and `RESUME_DRIFT` read it zero times and create zero agents. `READY` and `CONTINUE_READY` read it exactly once. When readiness says `baselineRequired`, the first orchestration action is creation and recorded dispatch of the logical `T-BASELINE` to an executor.

- [ ] **Step 2: Run RED**

```bash
node --test core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
```

Expected: FAIL because the adapter and install set do not implement the contract.

- [ ] **Step 3: Rewrite the adapter and finish the single reference**

Add `disable-model-invocation: true`. The dynamic command scavenges only valid expired residue, then prepares the session slot before Claude and returns the validated session ID, request ID and capability. The adapter copies `$ARGUMENTS` once into the structured envelope at the returned path, with the same identity tuple. It does not classify the mode or calculate a hash. In `finally`, it validates the three returned token formats, then composes fixed-shape consume after successful Write or abort after failed or rejected Write with `--session`, `--request-id` and `--capability`, and follows any consume result. Print help, status and resume results and stop. Start stops unless result is `READY`; continue stops unless result is `CONTINUE_READY`. Only those states load the long reference once.

Keep the state machine body only in `soma-run-orchestration.md`. Its readiness section follows Task 5 ownership and dispatch rules. Add no hook.

- [ ] **Step 4: Extend transaction rollback coverage**

The watched set must include adapter, reference, `soma.cjs`, entry and broker modules, adoption, baseline, checkpoint, handoff, continuity, manifests and install targets. Inject faults after core copy and target sync. Compare all pre-state hashes and absent paths after rollback.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
git add core/adapters/claude/commands/soma-run.md core/adapters/claude/references/soma-run-orchestration.md core/adapters/claude/install-targets.json core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/install-targets-set.test.cjs install/__tests__/global-install-transaction.test.cjs
git commit -m "feat(adapter): route universal entry through fixed broker"
```

Expected: PASS, no sentinel and full rollback parity.

### Task 9: Publish current docs and prove the integrated contract

**Files:**

- Modify: `README.md`
- Modify: `docs/QUICKSTART.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `core/scripts/__tests__/universal-entry-docs.test.cjs`
- Create: `core/scripts/__tests__/universal-entry-e2e.test.cjs`
- Modify: `core/scripts/__tests__/trilho-e2e.test.cjs`
- Modify: `core/scripts/__tests__/cross-harness-parity.test.cjs`

- [ ] **Step 1: Write RED documentation and end-to-end tests**

Current docs must name `/soma-run`, all public forms, the runtime-issued session/request/capability tuple, exact `rawArguments` transport, fixed-shape cleanup calls, valid-expired-only scavenging, `BROKER_CORRUPT` preservation, external ephemeral broker effects, project read-only guarantees, post-publication digest, two-step resume, fact-only handoff, orchestrator-owned `T-BASELINE`, executor mutation and installed absolute CLI. Document the same-uid limit and trusted user-intent model. Reject `/soma:run`, public alternate entry, inferred session identity, `UserPromptExpansion` transport, caller-selected broker paths and claims that resume inspection writes project state.

The end-to-end matrix covers new non-Git, legacy dirty, installed and monorepo start; home and invalid scope rejection; real skill prepare/Write/consume-or-abort with validated session/request/capability tokens; failed Write abort cleanup; consume failure cleanup; repeated abort; malformed tokens stopped before filesystem access; well-formed incorrect tokens preserving the slot; argv/lease/envelope agreement; sessions A/B isolation; exact metacharacter and newline round-trip; CLI mode parsing; traversal, slot swap, replay, concurrent consume and signal cleanup; host kill after prepare leaving one inert TTL-bounded R1; valid-expired R1 scavenging before R2; delayed consume and abort with R1 tokens preserving R2; invalid slot returning `BROKER_CORRUPT` without scavenging; consume rejection after expiry without project, Git or run mutation; read-only byte and mtime identity; baseline-first gate; checkpoint crash recovery; fact-only handoff; pre-publication digest rejection; drift of every continuity category; zero lazy reads before readiness; one lazy read after readiness; transactional rollback and normal objective reachability.

- [ ] **Step 2: Run RED, update docs and wire only integration gaps**

```bash
node --test core/scripts/__tests__/universal-entry-docs.test.cjs core/scripts/__tests__/universal-entry-e2e.test.cjs core/scripts/__tests__/trilho-e2e.test.cjs core/scripts/__tests__/cross-harness-parity.test.cjs
```

Expected: initial FAIL on documentation and integration seams, then PASS after current docs and the smallest in-scope wiring changes.

- [ ] **Step 3: Run focused and install verification**

```bash
node --test core/scripts/__tests__/entry-request-schema.test.cjs core/scripts/__tests__/entry-request-broker.test.cjs core/scripts/__tests__/entry-raw-arguments.test.cjs core/scripts/__tests__/entry-request-routing.test.cjs core/scripts/__tests__/entry-project.test.cjs core/scripts/__tests__/entry-adoption.test.cjs core/scripts/__tests__/run-checkpoint.test.cjs core/scripts/__tests__/run-baseline.test.cjs core/scripts/__tests__/run-handoff.test.cjs core/scripts/__tests__/entry-continuity.test.cjs core/scripts/__tests__/entry-resume-safe.test.cjs core/scripts/__tests__/universal-entry-adapter.test.cjs core/scripts/__tests__/universal-entry-docs.test.cjs core/scripts/__tests__/universal-entry-e2e.test.cjs
node --test install/__tests__/*.test.cjs
bash install/__tests__/synthetic-env.test.sh
```

Expected: all focused, install and synthetic tests pass.

- [ ] **Step 4: Capture final structured suite and compare failure identities**

Use the same Node command and parser as Task 0. The `finally` path must remove the detached worktree and temporary files even when the suite fails or receives INT, TERM or HUP. Write `.soma/baselines/universal-entry-final.junit.xml` and `.json`, validate their hashes, then compare normalized `(file,fullName,errorName,message,failureSha256)` sets. The final set must be a subset of the base set. The inherited spec 024 failure may remain; do not fix it here.

- [ ] **Step 5: Run SONAR and scope checks**

```bash
git diff --check
git status --short
rg -n -- '--request''-file|continue''Command' docs/superpowers/specs/2026-08-25-soma-universal-entry-resume-design.md docs/superpowers/plans/2026-08-25-soma-universal-entry-resume.md README.md docs/QUICKSTART.md docs/INSTALL.md docs/ARCHITECTURE.md
baseline_bad='entry create''s T-BASE''LINE|adoption create''s T-BASE''LINE|T-BASE''LINE.*FOUN''DATION'
orphan_bad='newest or''phan|select.*orphan automatic''ally'
session_bad='un''bound|capability fall''back|channel''Binding|adapter classif''ies'
lease_bad='lease contains mo''de|lease contains content ha''sh'
rg -n -i "$baseline_bad|$orphan_bad|$session_bad|$lease_bad" docs/superpowers/specs/2026-08-25-soma-universal-entry-resume-design.md docs/superpowers/plans/2026-08-25-soma-universal-entry-resume.md README.md docs/QUICKSTART.md docs/INSTALL.md docs/ARCHITECTURE.md
```

Expected: diff check passes; status lists only planned implementation and documentation files; contradiction scans return no normative match. Audit architecture, backward-compatible state, test-to-AC traceability, transaction ownership and absence of plugin, daemon, hook, shim, silent cwd, auto-stage or spec 024 implementation.

- [ ] **Step 6: Commit integration and docs**

```bash
git add README.md docs/QUICKSTART.md docs/INSTALL.md docs/ARCHITECTURE.md core/scripts/__tests__/universal-entry-docs.test.cjs core/scripts/__tests__/universal-entry-e2e.test.cjs core/scripts/__tests__/trilho-e2e.test.cjs core/scripts/__tests__/cross-harness-parity.test.cjs
git commit -m "test(entry): prove universal continuity boundary"
```

## Completion gate

- [ ] AC-01 through AC-15 each map to a passing behavioral test above.
- [ ] All modes use one raw envelope; consume and abort have fixed argument shape and interpolate only format-validated runtime session ID, request ID and capability. No user request value enters Bash.
- [ ] The CLI parser alone classifies mode; `$ARGUMENTS` round-trips and never appears in Bash.
- [ ] Native-session A/B isolation, malformed and mismatched identity, traversal, slot swap, replay, concurrency and signal tests pass; normal flows leave zero slot, valid expired residue is scavenged, corrupt residue remains untouched, and delayed R1 consume/abort cannot touch R2.
- [ ] The lease contains only preparation-time facts; request hashing occurs during consume.
- [ ] The skill disables model invocation and docs state the trusted user-intent and same-uid limits without a prompt-injection guarantee.
- [ ] Help, status and resume preserve project bytes and mtimes, Git index, run state, locks and agent records.
- [ ] Entry returns baseline facts only; one orchestrator-created `T-BASELINE` is the first logical task and its executor uses dispatch records.
- [ ] Checkpoint retry recovers only the equal-hash expected-sequence orphan and references it atomically.
- [ ] Handoff publishes facts and resume inspection command only; it contains no digest or continuation invocation.
- [ ] Continuity includes run, locator, handoff pair hashes, Git, full dirty state, selected checkpoint, dispatch components, proofs, pause facts, tasks and agents in deterministic order.
- [ ] Handoff publication occurs before digest calculation; continue rereads and compares before lock or write.
- [ ] Adapter is at most 8,000 bytes and the long reference loads once only after `READY` or `CONTINUE_READY`.
- [ ] Global rollback covers every changed runtime and target.
- [ ] Structured baseline comparison adds no failure beyond the pinned set; detached worktree cleanup is proven on failure and signal.
- [ ] Current docs use `/soma-run`; historical evidence and inherited spec 024 remain untouched.
