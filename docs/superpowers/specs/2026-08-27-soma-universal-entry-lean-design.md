# SOMA universal entry lean design

**Status:** approved design

**Supersedes for implementation:** `2026-08-25-soma-universal-entry-resume-design.md` and its implementation plan. Those files remain historical evidence. Their same-UID adversarial broker is outside this design's threat model.

## Goal

Make `/soma-run` the single Claude entry point for starting, adopting, inspecting and resuming SOMA work. A user must be able to open Claude in any project, run `/soma-run "objective"`, close the session and later resume without losing completed work, decisions or the next action.

## Success criteria

1. `/soma-run "objective"` works in a Git project with no `.soma/` by adopting it automatically.
2. The same command works in an already installed or legacy SOMA project without destructive migration.
3. `/soma-run --status` reports durable run facts and performs no project mutation.
4. `/soma-run --resume [runId]` in a new Claude session resumes the exact next unfinished task when continuity matches.
5. Resume never repeats a passed task or reconstructs missing facts from model memory.
6. Drift or corrupt durable state produces a durable diagnostic with the mismatch and next decision. It does not continue speculatively.
7. The coordinator remains concise. Executors own implementation and write dispatch records containing prompt, result, commit or artifact, proofs and blockers.
8. The adapter loads long orchestration instructions only after entry returns `READY` or `RESUME_READY`.
9. A fake-home end-to-end test passes before one transactional global activation and a live Claude smoke.

## Threat model

SOMA protects against:

- shell metacharacters and quoting errors turning user text into commands;
- malformed, oversized or stale mailbox data;
- accidental concurrent SOMA sessions for the same request or run;
- process interruption leaving bounded temporary residue;
- corrupt project state, incomplete adoption and Git drift;
- replay of an already consumed request.

SOMA does not try to resist an actively malicious process running as the same OS user and replacing files between system calls. The machine account and the user's explicit Claude request are trusted. This boundary is normative. A reviewer may not block implementation by adding same-UID adversarial requirements.

## Chosen approach

Use a small private mailbox to move exact `$ARGUMENTS` from the Claude command to Node without interpolating user text into Bash.

The fixed command prepares a mailbox entry using only the native Claude session ID. The adapter writes one JSON envelope through Claude's structured file-write tool. A fixed consume command names only validated runtime identifiers. The CLI atomically claims the entry, parses it as data and removes it in `finally`.

The mailbox provides local correctness, not a same-UID security sandbox.

Rejected approaches:

- Direct shell interpolation is smaller but cannot preserve arbitrary arguments safely.
- The adversarial capability broker is outside the approved threat model and created disproportionate code and tests.

## Components

### 1. Lean mailbox

The mailbox lives outside the project under a private user runtime directory.

`prepare(sessionId)`:

- validates the native session ID before filesystem access;
- creates one session directory with mode `0700`;
- creates one request directory with a random request ID;
- creates `request.json` with mode `0600`;
- records `createdAt` and a short fixed expiry;
- returns `{sessionId, requestId, requestPath, expiresAt}`.

`consume(sessionId, requestId)`:

- validates both identifiers;
- verifies containment under the configured runtime root;
- rejects missing, malformed, oversized, mismatched or expired data;
- claims the request with one atomic rename;
- parses the exact JSON envelope;
- removes the claimed request in `finally`.

`abort(sessionId, requestId)` removes only that request and is idempotent. The next prepare may remove expired, structurally valid residue for the same session. Unexpected structures fail closed and remain available for diagnosis.

No capability token, owner spoofing matrix, descriptor identity comparison, multi-level realpath race defense or same-UID swap defense belongs in this component.

### 2. Pure argument parser and entry controller

The envelope contains:

```json
{
  "$schema": "soma-entry-request/v1",
  "sessionId": "native-session-id",
  "requestId": "32-lowercase-hex",
  "rawArguments": "exact user arguments"
}
```

The Node parser classifies only these public forms:

```text
/soma-run "objective"
/soma-run --help
/soma-run --status [--project <path>]
/soma-run --resume [runId] [--project <path>]
```

The parser treats shell syntax as ordinary text. It rejects malformed quoting, duplicate flags, unknown flags and conflicting modes. The controller passes values as JavaScript data and never changes `process.cwd()`.

Help returns before project resolution. Status is read-only. Start and resume resolve a canonical project root and scope before mutation.

### 3. Project resolution and adoption

Resolution accepts:

- an explicit project path;
- the current Git repository;
- an empty non-Git directory chosen explicitly by the user.

It rejects the filesystem root, the user's home as a project, symlink escapes, ambiguous monorepo scope and a non-empty markerless directory that is not a Git repository.

For a valid project without a complete SOMA installation, start invokes the existing callable installer transaction. Adoption writes only SOMA metadata and the established anchored bootloader. It does not run project scripts, tests, dev servers, Docker or browsers.

Adoption records the pre-existing Git HEAD, branch, dirty paths and detected test commands as facts. It returns `baselineRequired: true`; the coordinator then creates `T-BASELINE` and dispatches it to an executor. Entry itself never executes the baseline.

Partial, corrupt or drifted `.soma/` returns `ADOPTION_BLOCKED` without rewriting it.

### 4. Durable handoff and resume

Each safe transition writes a checkpoint under the run directory. The checkpoint contains:

- exact run ID and current state;
- last completed task and next unfinished task;
- task statuses and attempts;
- closed dispatch-record references;
- commit SHAs and durable proof paths;
- blocker and next decision when paused;
- Git HEAD, branch and a deterministic dirty-tree digest.

`soma run handoff` publishes an immutable JSON and Markdown generation from durable state. The Markdown is for humans. The JSON is authoritative.

`/soma-run --resume [runId]`:

1. resolves the project and exact run;
2. reads the latest valid handoff and referenced checkpoint;
3. recomputes Git and durable-artifact continuity;
4. returns `RESUME_READY` with the exact next task when it matches;
5. returns `RESUME_DRIFT` with a durable diagnostic when it differs.

Resume is read-only until continuity passes. On `RESUME_READY`, the coordinator reacquires the run lock and continues. No separate digest command or second human confirmation is required.

### 5. Claude adapter

`core/adapters/claude/commands/soma-run.md` stays below 8,000 UTF-8 bytes. It does only this:

1. prepare the mailbox with a fixed command using the native session ID;
2. write the exact envelope to the returned path with the structured Write tool;
3. consume it with a fixed command using validated session and request IDs;
4. abort in `finally` when write or consume fails;
5. print and stop for help, status, errors or drift;
6. load `references/soma-run-orchestration.md` once for `READY` or `RESUME_READY`.

The long reference owns orchestration rules. It requires dispatch-record begin before every executor spawn and dispatch-record end before transition. The coordinator never implements code.

## Error handling

Stable result codes:

- `HELP_SHOWN`
- `STATUS_SHOWN`
- `READY`
- `RESUME_READY`
- `ARGUMENT_ERROR`
- `PROJECT_UNRESOLVED`
- `ADOPTION_BLOCKED`
- `MAILBOX_INVALID`
- `MAILBOX_EXPIRED`
- `RESUME_DRIFT`

Every failure states whether retry is safe and names the durable diagnostic when one exists. Mailbox cleanup failures never delete unrelated paths. Project-state failures never reconstruct files from model memory.

## Testing boundary

Tests prove only the approved threat model.

Mailbox tests cover exact argument round-trip, validation before filesystem access, private modes, containment, expiry, atomic single consumption, replay rejection, abort idempotence, crash residue cleanup and two normal concurrent sessions.

Entry tests cover the four public forms, hostile shell text as inert data, project resolution and read-only help/status.

Adoption tests cover new, legacy, complete, partial and corrupt projects without executing project scripts.

Resume tests cover exact next-task recovery, no repeat of passed tasks, Git drift, missing proof, corrupt handoff and checkpoint mismatch.

The integration test starts in a fake home with no `.soma/`, adopts, creates a run, records one completed task, publishes handoff, starts a new simulated session and resumes the next task.

Reviewers must review against these acceptance criteria. New requirements outside the threat model are recorded as non-blocking debt unless the user expands scope.

## Delivery and rollback

The existing global transaction owns activation. The watched set includes the adapter, orchestration reference, entry modules, adoption, handoff, resume, manifests and install targets.

Verification order:

1. focused unit and integration tests;
2. fake-home install and end-to-end resume;
3. transaction rollback fault injection;
4. one global install attempt with no Claude process running;
5. source-to-installed hash comparison;
6. live Claude smoke for help, new project adoption and resume.

Any activation failure uses the transaction rollback. There is no blind second global install attempt.

## Scope and execution limits

- At most five implementation tasks.
- One executor and one integrated reviewer per task.
- One correction per task.
- A reviewer cannot expand the threat model.
- A residual finding after correction produces one durable diagnostic and a coordinator decision. It does not automatically create another agent or test matrix.
- Test matrices use representative partitions, not Cartesian products of equivalent filesystem attacks.
- No plugin, daemon, hook, PATH shim, dependency, Windows support or public alias.
