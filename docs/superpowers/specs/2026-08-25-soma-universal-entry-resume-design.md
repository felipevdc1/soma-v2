# SOMA universal entry and safe resume design

**Status:** REPLAN approved, implementation not started

**Date:** 2026-08-25

**Scope:** Claude `/soma-run`, fixed internal CLI preflight, request broker, project adoption, safe resume, structured handoff, transactional installation and current documentation

## Evidence status

### Verified facts

- The current Claude command is `core/adapters/claude/commands/soma-run.md`. It does not consume `$ARGUMENTS`, so it does not provide deterministic help, status or resume routing.
- The installed CLI is `~/.soma-v2/scripts/soma.cjs`. The current contract has no required `soma` executable on `PATH`.
- Existing `soma run` primitives live in `core/scripts/run.cjs` and `core/scripts/run/*.cjs`; project installation and global installation have separate state.
- The repository requires Node 22 or newer. The checked Node 22.15.0 runtime exposes the built-in `node:test` JUnit reporter.
- Claude Code 2.1.245 skills support native `${CLAUDE_SESSION_ID}` substitution. `$ARGUMENTS` is the complete user-entered argument text, and dynamic `!` commands run before Claude receives the expanded skill prompt.
- `UserPromptExpansion` can block or add context but cannot replace the prompt. It is not a request transport.
- The inherited spec 024 failure is present before this feature and remains outside this scope.

### Decisions

- `/soma-run` remains the only public command for starting or resuming project-changing work.
- One `soma-entry-request/v1` envelope carries the unchanged `$ARGUMENTS` text for every mode. No objective, run ID, project, scope, handoff locator or digest crosses Bash as an argument or interpolated command fragment.
- The skill invokes fixed `broker-prepare`, `broker-consume` and `broker-abort` CLI templates. Their only variable shell value is the runtime-supplied `${CLAUDE_SESSION_ID}`. Missing or malformed session ID fails closed.
- The CLI parser, not Claude, classifies start, help, status, resume and continue after one-time consumption.
- Handoff contains durable facts and a canonical resume-inspection command. It contains no continuation digest or continue command.
- Resume inspection computes `continuityDigest` after handoff publication. Continue recomputes it before any project lock or write.
- Entry and adoption only report `baselineRequired`. The orchestrator creates the single logical `T-BASELINE` task after `READY`; an executor runs it through dispatch records.

### Trust model

Text entered by the user in `/soma-run` is trusted user intent and becomes prompt content by platform design. SOMA does not claim to neutralize instructions the user deliberately places in that text. Repository files, handoffs, checkpoints, dispatch records and proofs remain untrusted data and never become shell syntax.

The broker protects against accidental cross-session access, path and shell injection, corrupt files and replay. It is not a sandbox against a hostile process running as the same uid; such a process can already modify the user's files. Owner and mode checks define the normal process boundary without overstating it. The skill sets `disable-model-invocation: true`, so only an explicit user invocation can start it.

## Context and revised thesis

The public slash command and the internal `soma run` family have different jobs. Adding public workflow grammar to `soma run` would make its existing primitive grammar ambiguous. Letting the prompt improvise project resolution would leave start-from-home and resume behavior unsafe.

The selected design keeps a thin adapter and adds a fixed internal controller:

1. A fixed dynamic command validates native `${CLAUDE_SESSION_ID}`, scavenges any expired or invalid prior slot by atomic rename/claim, and creates one empty short-lived broker slot with a bounded TTL and monotonic-safe timestamps before Claude runs.
2. The adapter copies the entire `$ARGUMENTS` string into `rawArguments` and attempts to write the envelope to that already-created slot with a structured Write tool.
3. In a `finally` path for every turn that continues, it invokes fixed consume after a successful Write or fixed abort after a failed or rejected Write. Only the same runtime session ID appears in argv; no request value does.
4. Consume claims, validates and consumes the request once, hashes its exact bytes, then parses `rawArguments` deterministically. Both commands use idempotent cleanup in `finally` after success or error; abort itself is also idempotent.
5. If the host dies before cleanup, the slot remains inert, authorizes no project, Git or run mutation, cannot be consumed after expiry, and is scavenged by the next prepare for that session.
6. The CLI resolves, inspects or adopts the project according to the parsed mode.
7. The adapter loads the long orchestration reference only after `READY` or `CONTINUE_READY`.

Existing `soma run` verbs remain internal orchestration primitives. New baseline, checkpoint and handoff verbs add durable evidence without changing the public command.

## Alternatives considered

### Direct flag forwarding

Rejected. Status, resume and continue contain external paths and identifiers just as start contains external objective text. Validating a string before interpolating it does not close the shell boundary.

### Caller-selected request path

Rejected. A path accepted from the adapter arguments permits traversal, symlink substitution and cross-session reuse. The CLI must create and later rediscover the slot from its own broker state.

### Capability-only or inferred session identity

Rejected. Capability alone does not stop another normal session from finding a shared slot, and prompt text, pid, cwd or time is not session identity. Native `${CLAUDE_SESSION_ID}` is the sole session authority.

### Digest stored in handoff

Rejected. Publishing the handoff changes the dirty tree and therefore changes continuity. A handoff that stores its own digest or continue command is stale or self-referential at creation.

## Public grammar

The documented user forms remain:

```text
/soma-run "objective" [--project <path>] [--scope <path>]
/soma-run --status [--project <path>] [--scope <path>]
/soma-run --resume [runId] [--project <path>] [--scope <path>] [--handoff <path>]
/soma-run --continue <runId> --project <path> --scope <path> --digest <sha256> [--handoff <generation>]
/soma-run --help
```

These are slash-command forms, not shell commands. The adapter copies the complete text to one envelope without classifying it. Prepare is a fixed dynamic command in the skill. Consume or abort is a fixed Bash tool call from the adapter's `finally` path after the Write attempt:

```bash
node ~/.soma-v2/scripts/soma.cjs entry broker-prepare --session "${CLAUDE_SESSION_ID}"
node ~/.soma-v2/scripts/soma.cjs entry broker-consume --session "${CLAUDE_SESSION_ID}"
node ~/.soma-v2/scripts/soma.cjs entry broker-abort --session "${CLAUDE_SESSION_ID}"
```

`${CLAUDE_SESSION_ID}` is native runtime data, not user input. It is the only variable substitution in any broker command and must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` before any path derivation. The fixed tilde path resolves the installed CLI without a configurable command fragment. `$ARGUMENTS` and all parsed request values are absent from Bash. The `soma` command on `PATH` is not required. `soma entry` remains an internal adapter API and is not documented as another workflow entry.

After consume, a pure CLI lexer handles quoting and escapes without shell evaluation. Whitespace separates tokens outside quotes; single and double quotes group values; backslash escapes the next character outside single quotes; newline is literal inside quotes and a separator outside them. `$()`, backticks, semicolons and pipes have no special meaning. The parser then rejects unknown or conflicting flags, duplicate single-value flags, malformed run IDs and non-lowercase 64-hex digests. The exact `rawArguments` string is retained for audit and tests.

## Session-bound request broker

### Storage and preparation

The broker root is outside every project. The CLI chooses an OS runtime directory owned by the current uid, preferring a verified owner-only runtime directory and otherwise a private directory under the platform temporary root. It hashes the validated native session ID for the directory name and creates this layout without following links:

```text
<runtime>/soma-entry/<uid>/<sha256(sessionId)>/<requestId>/
  lease.json
  request.json
```

Every directory is mode `0700`. Prepare creates both `lease.json` and an empty regular `request.json` with no-follow, exclusive creation and mode `0600` before the structured Write can run. It generates random request ID and at least 256 bits of capability. The minimal lease contains only `sessionId`, `requestId`, `capability`, exact request path, bounded `ttlMs` and monotonic creation and expiry timestamps, all known at preparation time. Wall-clock adjustment never extends a lease. It contains no request mode or content hash.

Missing or malformed `${CLAUDE_SESSION_ID}` returns `SESSION_UNAVAILABLE` before broker access. Before creating a slot, prepare validates the current same-session entry. A live valid entry returns `BROKER_BUSY`, or the existing lease only when the slot is still empty, regular, owner/mode-correct and unexpired. An expired or invalid entry is first moved to a unique cleanup name by atomic rename/claim, then a new request directory is created with `O_EXCL`; prepare never overwrites in place. Sessions A and B hash to distinct directories, and consume for B derives only B's directory; it never scans A's slots.

Preparation output gives the adapter the exact pre-created path, request ID and capability. The adapter uses those values only in the structured envelope and Write operation. It copies `$ARGUMENTS` once as `rawArguments`. None of these values enters Bash, environment overrides, command substitutions or shell redirections.

### Validation and one-time consumption

`broker-consume` and `broker-abort` validate the native session ID and derive only that session directory. An exclusive `claim` file created with `O_EXCL` gives exactly one same-session operation the right to continue. Before parsing request data, consume verifies:

- every ancestor stays under the canonical broker root;
- directory and file owners equal the effective uid;
- directory mode is exactly `0700` and file mode is exactly `0600`;
- the request is one regular file opened with no-follow semantics;
- session ID, request ID, capability, exact path and expiry agree with the minimal lease;
- request schema and `rawArguments` type are valid;
- size and string limits hold before JSON parsing completes;
- the lease is live and the claim is unique.

After the claim, consume opens the pre-created slot with no-follow semantics, validates its current inode/type/owner/mode and hashes the exact content bytes. It returns that hash as internal `requestSha256`; the lease does not predict it. A swapped or linked slot returns `INVALID_ENTRY_REQUEST` before parser, project resolution or run mutation. An expired request fails closed and cannot be routed. It then parses `rawArguments` and routes the request. Replay and a second consumer fail. Abort claims the prepared request without parsing or routing it. Both operations remove their claimed request directory in `finally` after success or error; repeated abort of an already absent request succeeds without mutation. SIGINT, SIGTERM and SIGHUP handlers request cancellation, run the same cleanup and then exit.

Cleanup always operates on the directory it claimed and removes it only while the lease snapshot's `requestId` and `capability` still match. Scavenging uses the same match and atomic rename/claim rule. A delayed cleanup from an older invocation therefore cannot remove a newer live lease. Cleanup skips links, unknown owners and structures it cannot safely claim.

If Claude or its host dies after prepare, no broker process remains alive to run `finally`. The bounded residual slot is inert and never authorizes parser, project, Git or run access. It cannot be consumed after expiry. The next prepare for the same session deterministically claims and removes the expired or invalid slot before creating a new one. Normal flows that continue after prepare leave zero slot because successful Write selects consume and failed or rejected Write selects abort.

No-follow and `O_EXCL` prevent accidental replacement through the normal broker API. The structured Write itself is not a same-uid security boundary; consume detects a changed slot before touching project or run state. This matches the stated trust limit rather than promising protection from an already-hostile process with the user's uid.

The ephemeral request is the only filesystem effect allowed before a read-only mode completes, and it is outside the project. Help, status and resume inspection preserve project bytes and mtimes, Git index bytes and mtime, run state, locks and agent records. Rejected continue has the same zero-project-mutation rule.

### Entry request schema

```json
{
  "$schema": "soma-entry-request/v1",
  "sessionId": "native-Claude-session-id",
  "requestId": "random-128-bit-id",
  "capability": "random-256-bit-secret",
  "rawArguments": "exact complete $ARGUMENTS string"
}
```

The adapter does not add mode, parsed payload, expiry or content hash. Expiry belongs to the lease, and consume calculates the request content hash after its no-follow open. The schema rejects surplus fields. Only after validation and claim does the CLI parser produce `{mode, objective, runId, project, scope, handoff, continuityDigest}`.

## Project and scope resolution

`core/scripts/entry/project.cjs` resolves paths without `process.chdir()`:

1. A canonical project path from the validated envelope has priority.
2. Otherwise the current Git top-level is used.
3. Without Git, canonical cwd is a new project only if it is a real directory, is neither filesystem root nor home, and is empty or has a recognized marker.
4. A handoff generation is accepted only if it resolves under the selected repo and validates as `soma-handoff/v2`.
5. Anything else returns `PROJECT_UNRESOLVED`.

The resolver returns canonical `repoRoot` and `scopeRoot`. A nested monorepo scope must be a declared workspace or an explicit contained scope. It rejects home, filesystem root, symlink escapes and paths outside the repo. Every child process receives an explicit cwd. Every read-only Git call sets `GIT_OPTIONAL_LOCKS=0` and invokes `git --no-optional-locks`.

## Adoption and run readiness

Inspection classifies `new`, `legacy`, `installed` and `monorepo` projects. `monorepo` describes structure; `previousState` records new or legacy status.

Adoption records canonical repo and scope, detection reasons, branch, HEAD, dirty paths and hashes, existing artifacts, installed version and a detected baseline command. It never runs the command, edits application source, fabricates earlier SOMA progress or overwrites partial or corrupt `.soma` state. An unchanged second adoption is byte-stable.

Entry returns `READY` with:

```json
{
  "baselineRequired": true,
  "baseline": {
    "command": ["npm", "test"],
    "status": "pending",
    "budget": {"timeoutMs": 120000, "maxOutputBytesPerStream": 262144}
  }
}
```

Entry and adoption do not create a task or dispatch record. After `READY`, the orchestrator creates exactly one logical task named `T-BASELINE`, records its dispatch before every other task and assigns it to an executor. Attempts remain records under that one task. The executor invokes the internal baseline primitive. `dispatch-record begin` rejects another task while a required baseline lacks a valid proof, rejects a duplicate live `T-BASELINE`, and preserves the normal two-attempt envelope.

The executor runs the recorded argv in the explicit scope cwd with the time and output limits. Pass records a hashed proof. Fail or timeout records the proof and diagnostic checkpoint, then transitions to `PAUSED_DIAGNOSTIC` without cleaning the working tree. Do not call this task FOUNDATION.

## Checkpoint publication and orphan recovery

The checkpoint input contains run ID, step, pause reason, blocker, next decision and task summaries. The primitive canonicalizes semantic content and computes its SHA-256 before choosing storage.

Under the run mutation lock, checkpoint uses this transaction:

1. Read the authoritative checkpoint references from run state and compute the next sequence.
2. If that content hash is already referenced, return the referenced checkpoint unchanged.
3. Look only for an unreferenced regular checkpoint at the expected sequence with the same content hash. Validate owner, mode, schema, run ID, bytes and hash. Reuse it if valid.
4. Otherwise write and fsync a sibling temporary file, validate it and rename it to `.soma/checkpoints/<runId>/<sequence>-<contentSha256>.json` without overwrite.
5. Atomically replace run state with one new `{sequence,path,sha256}` reference.
6. Release the lock.

Only state-referenced checkpoints are authoritative. A crash after step 4 and before step 5 leaves an orphan. Retrying the identical payload may reuse that exact valid orphan and then reference it. A different hash, sequence, owner, mode or schema is never selected implicitly and never influences handoff or continuity. The operation is idempotent by content hash.

## Handoff publication

The internal handoff primitive reads only authoritative run state, the selected referenced checkpoint, dispatch records and durable proofs. It derives task attempts and agent closure from dispatch records. A prompt without a completed record is active and blocks publication; missing or contradictory components are corrupt and also block.

It validates canonical JSON and derived Markdown in a sibling temporary generation, then publishes one immutable directory rename:

```text
.soma/handoffs/<runId>/<generationId>/handoff.json
.soma/handoffs/<runId>/<generationId>/handoff.md
```

Handoff contains repo, scope, branch, HEAD, dirty facts observed before publication, run and last safe state, selected checkpoint facts, task summaries and attempts, ordered proofs, blocker, next decision, declared and closed agents, and this inspection command:

```text
/soma-run --resume <runId>
```

It contains no digest, snapshot or continue command. It also does not try to store the post-publication tracking state of its own files. The CLI reports tracking status after publication as command output. It never stages, commits, pushes or changes the Git index.

The existing `/handoff` adapter routes an active SOMA run to checkpoint followed by handoff. Without an active SOMA run it may retain the legacy session handoff, marked non-resumable and stored outside `.soma/handoffs/`.

## Resume inspection and continuity digest

Resume inspection selects an explicit run or the only non-terminal run. When a handoff is used, it selects the newest schema-valid immutable generation by `createdAt`, breaking ties by UTF-8 byte order of generation ID. It rejects inconsistent JSON/Markdown pairs.

Only after the handoff generation exists, resume inspection rereads all durable facts and the complete current dirty tree. The handoff generation and both handoff files therefore appear in continuity normally. Handoff never contains its own digest.

The digest input has schema `soma-continuity/v1` and these fields:

```json
{
  "$schema": "soma-continuity/v1",
  "run": {"id": "run-id", "lastSafeState": "STEP_5_VALIDATE", "stateSha256": "64-hex"},
  "locator": {
    "repoRoot": "/canonical/repo",
    "scopeRoot": "/canonical/repo/package",
    "handoff": {"generationId": "id", "jsonSha256": "64-hex", "markdownSha256": "64-hex"}
  },
  "git": {"branch": "main-or-null", "headSha": "git-id-or-null"},
  "dirty": [{"path": ".soma/handoffs/run/id/handoff.json", "status": "??", "worktreeSha256": "64-hex-or-null", "indexSha256": "64-hex-or-null"}],
  "checkpoint": {"sequence": 3, "path": ".soma/checkpoints/run/3-hash.json", "sha256": "64-hex"},
  "dispatches": [{"taskId": "T-01", "attempt": 1, "status": "done", "executor": "worker-1", "baseSha": "git-id", "promptSha256": "64-hex", "metadataSha256": "64-hex", "outputSha256": "64-hex"}],
  "proofs": [{"kind": "test", "path": ".soma/evidence/run/test.json", "status": "fail", "sha256": "64-hex"}],
  "pause": {"blocker": {"code": "TEST_FAILURE", "summary": "focused test fails", "evidenceRefs": [".soma/evidence/run/test.json"]}, "nextDecision": "approve scope change or stop"},
  "tasks": [{"id": "T-01", "summary": "focused correction", "status": "blocked", "attempts": 2}],
  "agents": {"declared": ["worker-1"], "closed": ["worker-1"], "active": []}
}
```

If no handoff or checkpoint applies, the field is explicit `null`. The digest never omits a category because it is empty.

### Canonicalization and ordering

- Paths are canonical repo-relative POSIX strings where they are inside the repo; repo and scope roots are canonical absolute paths.
- Hashes are lowercase hex over exact file bytes. Null means the file or Git value is genuinely unavailable, not unread.
- Dirty entries sort by UTF-8 bytes of path, then status. Each includes both worktree and staged-content SHA-256 when present.
- Checkpoint selection comes only from the latest valid state reference by numeric sequence. Orphans are ignored.
- Dispatches sort by UTF-8 task ID, then numeric attempt. Status is derived from the component set. Prompt, metadata and output hashes are separate; absent output is explicit null.
- Proofs sort by UTF-8 kind, then path, then hash. Their status is copied from validated proof content.
- Task summaries sort by UTF-8 task ID. Agent ID arrays sort by UTF-8 bytes and contain no duplicates.
- Blocker keys and evidence references are normalized and sorted. `nextDecision` remains exact UTF-8 text.
- Objects serialize with keys in UTF-8 byte order. Domain arrays use the orders above. Integers use base-10 JSON numbers, strings are preserved byte-for-byte after valid UTF-8 decoding, nulls remain explicit, and output has no insignificant whitespace or trailing newline.

`continuityDigest` is SHA-256 of those canonical bytes. Resume inspection prints a short card and a complete second slash invocation:

```text
/soma-run --continue <runId> --project "<repo>" --scope "<scope>" --digest <continuityDigest> --handoff "<generationId>"
```

The adapter places those values in a new structured envelope. Continue resolves the same locator, reloads every digest input, recalculates canonical bytes and compares the lowercase digest before any project lock, run-state write or agent creation. Any changed item returns `RESUME_DRIFT` with zero project mutation.

## Lazy orchestration and state transitions

The single long orchestration source lives at `core/adapters/claude/references/soma-run-orchestration.md` and installs transactionally with the adapter. Help, status and resume inspection never read it and never create agents. Start reads it once after `READY`. Continue reads it once after `CONTINUE_READY`.

```text
HELP -> BROKER_PREPARED -> REQUEST_CONSUMED -> HELP_SHOWN
STATUS -> BROKER_PREPARED -> REQUEST_CONSUMED -> PROJECT_RESOLVED -> STATUS_SHOWN
START -> BROKER_PREPARED -> REQUEST_CONSUMED -> PROJECT_RESOLVED
      -> PROJECT_INSPECTED -> ADOPTION_IF_REQUIRED -> RUN_INITIALIZED -> READY
      -> ORCHESTRATOR_CREATES_T_BASELINE_IF_REQUIRED -> EXECUTOR_RUNS_BASELINE
      -> SOMA_FLOW
RESUME -> BROKER_PREPARED -> REQUEST_CONSUMED -> PROJECT_RESOLVED
       -> RUN_RESTORED_READ_ONLY -> DIGEST_COMPUTED -> AWAITING_CONTINUE
CONTINUE -> BROKER_PREPARED -> REQUEST_CONSUMED -> DIGEST_RECOMPUTED
         -> RESUME_DRIFT | CONTINUE_READY -> SOMA_FLOW
```

Broker preparation and cleanup may touch only the external broker. `HELP_SHOWN`, `STATUS_SHOWN`, `RUN_RESTORED_READ_ONLY`, `AWAITING_CONTINUE` and `RESUME_DRIFT` are non-mutating with respect to project, Git and run state. No agent exists before `READY` or `CONTINUE_READY`.

## Invariants

1. `/soma-run` is the only public entry for start and resume.
2. Every mode uses `soma-entry-request/v1`; `$ARGUMENTS` and parsed external values never appear in Bash argv or interpolation.
3. The only variable shell value is native `${CLAUDE_SESSION_ID}`. Absence or invalid format fails closed; no inferred or alternate ID exists.
4. The CLI pre-creates broker storage. Requests are owner-only, no-follow, session-bound and claimed once. Consume or abort cleans every normally continuing flow in `finally`; host death may leave only an inert TTL-bounded slot for next-prepare scavenging.
5. Help, status and resume inspection mutate only the external ephemeral broker.
6. No mode silently changes cwd. Every child process receives an explicit validated cwd.
7. Adoption never executes project scripts or invents history.
8. Entry returns baseline facts but never creates or dispatches `T-BASELINE`.
9. The orchestrator creates one logical `T-BASELINE` after `READY`; an agent executes it through dispatch records before any other task.
10. Only state-referenced checkpoints are authoritative; identical orphan reuse is the sole recovery exception.
11. Handoff contains no continuity digest or continue command.
12. Continuity is calculated after handoff publication and includes every durable decision input plus the resulting dirty tree.
13. Continue validates continuity before any project lock or write.
14. Handoff and resume never use ignored, temporary, escaped or external proof paths.
15. Global installation updates or rolls back adapter, reference and CLI together.
16. The skill has `disable-model-invocation: true`; user-entered instructions are trusted intent, while repository and continuity artifacts remain untrusted data.
17. No plugin, daemon, hook, `UserPromptExpansion` transport, PATH shim, public alias or silent third attempt is added.

## Failure modes

| Failure | Required result |
|---|---|
| Missing or malformed native session ID | `SESSION_UNAVAILABLE`; no broker or project access |
| Unknown, conflicting or malformed `rawArguments` | `INVALID_ENTRY_ARGS`; broker cleans up, no project access |
| Traversal, symlink, wrong owner/mode or invalid request schema in broker | `INVALID_ENTRY_REQUEST`; no project access |
| Session B tries to consume session A's request | B derives only B's directory and returns `NO_ENTRY_REQUEST`; A remains intact |
| Replayed or concurrently consumed request | `REQUEST_ALREADY_CONSUMED` or `BROKER_BUSY`; no project access |
| Write fails or is rejected while the turn continues | adapter invokes idempotent abort in `finally`; owned request directory removed, no project access |
| Signal or error during consume | owned claimed directory removed by `finally`; project result remains atomic |
| Host dies after prepare and before cleanup | no process remains alive; one inert slot may remain until its short TTL expires, with no project, Git or run authority |
| Next prepare finds an expired or invalid slot | atomically rename/claim and remove it before creating a new slot; old cleanup cannot remove the new lease |
| Started from home without a valid project locator | `PROJECT_UNRESOLVED`; no silent cwd or project write |
| Partial, corrupt or drifted `.soma` | `ADOPTION_BLOCKED`; preserve bytes |
| Baseline task omitted or another task starts first | `BASELINE_REQUIRED`; no dispatch record for that task |
| Duplicate live logical baseline task | `BASELINE_ALREADY_ACTIVE`; no second logical task |
| Crash after checkpoint publish but before state update | orphan remains non-authoritative; identical retry may reference it |
| Different checkpoint orphan exists | ignore it; never select it implicitly |
| Active or corrupt dispatch at handoff | `HANDOFF_ACTIVE_DISPATCH` or `CORRUPT_DISPATCH_RECORD`; no generation |
| Handoff contains non-durable proof | `HANDOFF_NOT_DURABLE`; no generation |
| Handoff is edited or dirty/checkpoint/dispatch/proof/task/agent facts drift | `RESUME_DRIFT`; no lock, write or agent |
| Installed core missing | diagnostic names the absolute installed CLI; no shim suggestion |

## Challenge pass and falsifiers

| Boundary | Counterexample | Required test |
|---|---|---|
| Shell | `rawArguments` contains path ``/tmp/x$(touch sentinel)``, quotes, backticks and newline | The raw string round-trips through Write; no Bash contains `$ARGUMENTS`, the CLI lexer treats metacharacters as data and the sentinel stays absent |
| Broker session | Sessions A and B prepare concurrently, then B consumes | Session-directory derivation uses their native IDs, so B never searches A and both requests remain isolated |
| Broker lease | Prepare runs before mode or request bytes exist | Lease contains only session ID, random request ID/capability, path and expiry; consume validates request schema and calculates its hash later |
| Broker swap | The pre-created slot is replaced before consume and two consumers race | One claim wins; no-follow/inode/type checks reject the swap before project access, replay fails and cleanup removes the owned slot |
| Broker crash recovery | The host dies after prepare, or an old cleanup races a new prepare | The residual slot stays inert through expiry; next prepare claims and removes it before replacement, and request ID/capability matching prevents old cleanup from deleting the new lease |
| Trust limit | A hostile same-uid process edits broker files | SOMA detects ordinary corruption when possible but makes no sandbox claim against a process that already has the user's file permissions |
| Handoff and digest | Digest is calculated before publishing handoff, then publication adds two dirty files | Pre-publication digest is rejected; post-publication digest includes generation hashes and both dirty files, then succeeds until any fact changes |
| Checkpoint | Process fails after checkpoint rename and before state replacement | Orphan is ignored by reads; identical retry reuses and references it; different orphan hash remains ignored |
| Baseline | Entry returns `baselineRequired`, but orchestrator tries `T-01` first or creates two baseline tasks | Gate rejects `T-01` and the duplicate; one recorded `T-BASELINE` runs through an executor before all other tasks |

## Compatibility and migration

- Preserve all current internal `soma run` forms. Add baseline, checkpoint and handoff without renaming existing primitives.
- Read old `soma-state/v2` in memory. Status and resume do not rewrite it.
- Keep project install state under the project and global install state under `~/.soma-v2`.
- Install the adapter and single long reference through existing `kind:"file"` targets and the existing global transaction.
- Update current user docs to `/soma-run`; do not rewrite historical specs or snapshots.
- Preserve the inherited spec 024 RED. The implementation baseline uses structured `node:test` events or the verified Node 22 JUnit reporter, never TAP ordinals or indentation.
- Baseline capture and final comparison remove detached worktrees and temporary reporter files through `trap` or `finally`, including test failure and interruption.

## Acceptance criteria

### AC-01: One structured envelope covers every mode

Start, help, status, resume and continue use the same envelope containing native session binding, request ID, capability and exact `rawArguments`. The CLI parser classifies the mode after consume. `$ARGUMENTS` never appears in Bash; shell metacharacters round-trip as data and execute nothing.

### AC-02: Broker binding and cleanup fail closed

Preparation, consumption and abort require valid native `${CLAUDE_SESSION_ID}`, distinct session directories, canonical containment, owner, mode, a pre-created regular slot, no-follow access, matching request ID/capability, bounded monotonic-safe expiry, schema, computed content hash where applicable and an atomic claim. Every flow in which the host continues after prepare runs consume after a successful Write or abort after a failed or rejected Write, and leaves zero slot. If the host dies first, at most one inert slot remains until expiry; it cannot be consumed or mutate project, Git or run state, and the next same-session prepare atomically scavenges it before creating a replacement. Idempotent cleanup verifies request ID and capability, so cleanup from an older invocation cannot remove a newer live lease.

### AC-03: Read-only modes preserve project state

Help, status and resume inspection may create and remove only the external broker request. Project bytes and mtimes, Git index bytes and mtime, run state, locks and agent records remain identical. Read-only Git disables optional locks.

### AC-04: Project and scope resolution fail closed

New, legacy, installed and monorepo projects resolve without `chdir`. Home, root, ambiguity, containment failures and symlink escapes stop before project mutation.

### AC-05: Adoption is honest and idempotent

Adoption records observed repo, scope, Git, dirty, artifact and baseline facts without running a script or editing application code. Repeat input is byte-stable; partial or corrupt SOMA state blocks.

### AC-06: Baseline ownership is unambiguous

Entry returns `baselineRequired` and detected facts only. After `READY`, the orchestrator creates one logical `T-BASELINE`; its executor and dispatch record precede every other task. Failure or timeout pauses diagnostically without cleanup.

### AC-07: Checkpoint recovery is transactional

Checkpoint publication is idempotent by semantic content hash. Only state references are authoritative. A valid same-hash orphan at the expected sequence may be reused on retry; no different orphan is selected.

### AC-08: Handoff is durable and non-self-referential

Handoff JSON and Markdown derive from state-referenced checkpoint, dispatches and durable proofs, publish atomically and contain only durable facts plus `/soma-run --resume <runId>`. They contain no digest or continue command and never change the Git index.

### AC-09: Continuity covers every restricting input

The canonical digest includes run state, repo, scope, handoff generation and pair hashes, branch, HEAD, full dirty state, selected checkpoint, dispatch component hashes, proofs, blocker, next decision, task summaries and attempts, and agent closure with the specified ordering and null rules.

### AC-10: Resume handshake detects all drift

Resume inspection computes continuity only after handoff publication and prints a complete second slash command. Continue receives a new envelope, rereads every input and returns `RESUME_DRIFT` before lock or write if any input changes.

### AC-11: Lazy loading and agent timing remain bounded

The adapter stays at most 8,000 UTF-8 bytes. Help, status and resume do not read the long reference or create agents. Start and continue read it once only after `READY` or `CONTINUE_READY`.

### AC-12: Installation remains transactional

Adapter, orchestration reference, broker, entry, baseline, checkpoint, handoff, continuity modules and changed targets activate together. Fault injection restores every previous byte.

### AC-13: Current docs use the canonical command

Current README and user docs use `/soma-run`, document broker-backed envelopes and the two-step resume, and make no claim that inspection mutates project state.

### AC-14: Scope stays bounded

The skill sets `disable-model-invocation: true`. The feature adds no plugin, daemon, hook, `UserPromptExpansion` transport, external dependency, PATH shim, public alias, adoption-time script execution, automatic stage or historical-spec rewrite. It does not claim resistance to user-authored prompt instructions and does not implement spec 024.

### AC-15: Structured baseline comparison is deterministic

The pre-implementation and final full-suite runs use a stable `node:test` event or JUnit representation that preserves full test name, source file, normalized error and artifact hashes. Cleanup runs on pass, failure and signal. The final failure identity set adds nothing beyond the pinned baseline.
