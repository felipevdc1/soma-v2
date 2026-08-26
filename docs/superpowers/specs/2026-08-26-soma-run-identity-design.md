# SOMA exact run identity design

**Status:** approved design input, ready for implementation planning

**Date:** 2026-08-26

**Scope:** exact `runId` identity, universal identity reservation, lazy migration, and identity preflight at every run boundary

## Decision summary

SOMA will treat a run ID as an exact JavaScript string and exact UTF-8 JSON value. A pathname, inode, `fs.realpath()` result, case-folded string, or Unicode-normalized string is not a run identity. NFC `run-é` and NFD `run-e\u0301` are different identities even when the host filesystem resolves their pathnames to the same inode. The same rule applies to case-distinct strings on a case-insensitive filesystem.

Every run uses one immutable coordination marker at `.soma/run-identities/<runId>.json`. New runs reserve it before their first durable run write. Existing boundaries verify it before reading an artifact as authority, publishing an artifact, returning a successful no-op, consuming a bypass, or deleting anything. An exact legacy state may authorize lazy creation of a missing marker. A legacy dispatch tree without a state or marker cannot prove its identity and fails with `RUN_ID_IDENTITY_UNPROVABLE`.

This design adds no run ledger. Dispatch records remain the only agent ledger, state remains the canonical run status, and recovery generations remain facts referenced by state. The marker contains only the exact run identity.

## Evidence and certainty

### Verified facts at base `38b020655b438a7a521c337ba0c7fba820edade1`

- `core/scripts/run/paths.cjs:54-75` interpolates a truthy `runId` into report, dispatch, recovery, and state paths without validating it. `resolveRunIdFromLock` at lines 114-135 rejects only a non-string or empty value.
- `core/scripts/run/recovery-store.cjs:220-224` already rejects blank, dot, separator, and NUL IDs without normalizing. Its state read and mutation paths compare `state.runId !== runId` at lines 293-304 and 377-398. Pair B tests prove exact NFC/NFD inequality against one inode.
- `state --init` checks the current recovery-owned `safeRunId`, but the existing-file and concurrent-loser paths at `core/scripts/run/state.cjs:233-265` return a successful no-op without checking the embedded `runId`.
- `run report` writes the report at `core/scripts/run/report.cjs:218-221` before `appendReport` reaches the exact state check through CAS. An aliased request can therefore overwrite a report before failing state mutation.
- `gate --step` validates report shape and status but not `report.run_id`; its first-step success exits before any artifact read. `gate --validate` constructs a task metadata path and checks only executor inequality. It does not compare metadata `run_id` or `task_id` with the effective request.
- `resume` parses pathname-selected state and emits success without schema or embedded identity validation. `dispatch-record begin` writes a prompt with no owner proof. `end` compares supplied metadata with invocation fields, but does not prove the destination owner.
- Retention derives identity from the state filename and can delete reports, dispatches, then state without comparing the filename ID with `state.runId`. The spec-completeness hook can select a pathname alias and consumes its bypass before parsing or proving state identity.
- Current contracts require report `run_id` to match state, dispatch metadata to match effective run and task, resume continuity, one seven-day retention rule, prompt-before-dispatch, and the hook migration. Existing tests cover happy paths, schemas, atomic writes, budgets, ordinary dispatch coherence, symlinks in retention, CAS exactness, and recovery crash races. They do not cover the full identity matrix below.
- The approved Pair B amendment requires a safe single component before state access, byte-for-byte `state.runId` equality after read, no Unicode normalization, file-only coordination, and no claim of protection against a hostile local process swapping directories during a filesystem call.

### Decisions

- Move `safeRunId` and exact identity comparison into a dependency-free universal module, `core/scripts/run/run-id.cjs`. Recovery will consume the shared functions rather than own a copy.
- Add one immutable identity marker per exact run ID and make it the pre-state ownership fact needed by dispatch.
- Permit lazy marker adoption only from an exact state. Do not infer identity from directory names, recency, inode equality, report sets, or prompt files.
- Keep task ID and step path safety as a separate finding. This design compares task or step identity only where an artifact already uses it for authorization.

### Hypotheses and host-dependent facts

- NFC/NFD pathname aliasing and ASCII case aliasing depend on the filesystem. Tests must prove a shared `dev` and `ino` before running an alias-only assertion. A skip is allowed only when it names the missing filesystem property.
- A universal marker should eliminate false ownership across all listed boundaries. R1-R12 and G1-G3 are the falsification suite; a missed boundary disproves this hypothesis.

## Threat model

SOMA protects against unsafe requested components, accidental or stale aliases, process crashes, restarts, normal concurrent local writers, pre-existing symlinks in resolved marker/state/recovery components, partial publication, and retention retries. Unsafe means a non-string, empty or Unicode-blank string, `.` or `..`, any `/`, `\\`, or NUL, or a value for which `path.basename(runId) !== runId`.

SOMA does not normalize Unicode and does not case-fold. It does not claim protection against a hostile local process that swaps a parent directory during one synchronous filesystem operation or mutates marker bytes through an independently held hardlink. The protocol itself never rewrites an installed marker. A hardlink and `fs.realpath()` may describe storage topology; neither proves a unique run identity.

## Alternatives considered

| Alternative | Benefit | Failure | Decision |
| --- | --- | --- | --- |
| Normalize to NFC or lower case | Makes some aliases compare equal | Collapses identities the user approved as distinct and still does not cover every filesystem alias | Reject |
| Validate and compare independently in each boundary | Small local edits | Repeats the drift already present and cannot authorize state-less dispatch | Reject |
| Use inode, hardlink count, or `fs.realpath()` as identity | Detects some shared storage | Path aliases and hardlinks share storage without sharing logical identity; topology is unstable across replacement | Reject |
| Require state before every operation | Reuses Pair B checks | Breaks the contract that dispatch may predate state | Reject |
| Universal exact marker plus embedded checks | Gives pre-state dispatch a no-clobber owner fact and preserves exact state/artifact checks | Adds one small immutable file and migration rules | Adopt |

## Universal module contract

`core/scripts/run/run-id.cjs` owns these operations. It depends only on Node built-ins and does not import a verb.

```js
safeRunId(value) -> boolean
assertSafeRunId(value) -> value | throws RUN_ID_INVALID
assertExactRunId(actual, requested) -> requested | throws RUN_ID_MISMATCH
reserveRunIdentity({ projectRoot, runId, allowNew })
  -> { status: 'created' | 'matched' | 'adopted', markerPath }
```

`safeRunId` implements the threat-model predicate exactly. It returns the original string unchanged. `assertSafeRunId` must run before any `runId`-derived call to `path.join`, template interpolation, filesystem lookup, or directory creation. `assertExactRunId` uses strict string equality. Neither function calls `normalize`, locale comparison, lowercasing, `realpath`, or inode comparison.

Errors are `Error` instances whose message starts with the stable code. CLI boundaries may add detail after `": "`, but tests assert the code, not free prose. Recovery may map the universal error to its established public identities `RECOVERY_STATE_RUN_ID_INVALID`, `RECOVERY_REFERENCE_RUN_ID_INVALID`, and `RECOVERY_STATE_RUN_ID_MISMATCH` so Pair B compatibility remains intact.

`resolveSomaPaths(projectRoot, runId)` calls `assertSafeRunId` whenever the second argument is supplied, including a falsy supplied value. It rejects before returning any run path. Its run result adds `runIdentitiesDir` and `runIdentityFile`. `resolveRunIdFromLock` returns `{status: 'invalid_run_id'}` for every unsafe ID and never normalizes it. Callers must not fall back to a scan after a present lock yields `invalid_run_id`.

## Marker schema and installation

The marker has exactly two keys:

```json
{
  "$schema": "soma-run-identity/v1",
  "runId": "run-é"
}
```

The exact schema is:

- an object with only `$schema` and `runId`;
- `$schema` is the literal `soma-run-identity/v1`;
- `runId` passes `safeRunId` and equals the requested string with `===`;
- canonical bytes are `Buffer.from(JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2) + '\n', 'utf8')`; no BOM, normalization, timestamps, session, pathname, inode, task, status, or recovery data is allowed.

Installation is no-clobber. The writer creates a unique temporary regular file in `.soma/run-identities/` with `wx`, writes and syncs the canonical bytes, links it to `<runId>.json`, syncs the directory, and removes the temporary link. `EEXIST` means the writer must open the installed marker without following a symlink, validate its exact schema and canonical bytes, and compare its embedded `runId` exactly. It never overwrites or repairs an installed marker. A malformed, non-regular, symlinked, noncanonical, or mismatched marker fails closed.

A crash before the final link leaves only an inert temporary file. A crash after the link leaves a complete marker. A retry by the same exact ID adopts it. A retry through an NFC/NFD or case alias reads different embedded bytes and fails. With two new exact initiators, one installs the marker and the other returns `matched`; with two aliased initiators, scheduling may choose the winner, but the deterministic postcondition is one exact marker, at most one successful identity, and no artifact write by the loser.

## Reservation, adoption, and identity states

Before marker installation, `reserveRunIdentity` checks existing marker and state components with no symlink following. It does not enumerate other run IDs.

| Marker at requested pathname | State at requested pathname | Existing run artifact path | `allowNew` | Result |
| --- | --- | --- | --- | --- |
| exact, canonical | absent or exact | any | either | `matched`; an existing state must also match |
| exact, canonical | different/corrupt | any | either | fail before mutation |
| different, malformed, symlink, or non-regular | any | any | either | fail before mutation |
| absent | exact legacy state | any | either | install canonical marker, then `adopted` |
| absent | different/corrupt state | any | either | fail before mutation |
| absent | absent | none of state, reports, dispatches, or recovery paths | true | install marker, then `created` |
| absent | absent | any legacy run artifact path | either | `RUN_ID_IDENTITY_UNPROVABLE` |
| absent | absent | none | false | `RUN_ID_IDENTITY_UNPROVABLE` |

Only `state --init` and dispatch `begin` or `end` use `allowNew: true`, because each may be the first durable action for a run. All other boundaries require a marker or exact state adoption. Prompt bytes, dispatch metadata, report contents, directory recency, and same-inode evidence cannot authorize adoption. This rule is the safe lazy migration: it upgrades one requested exact legacy state, never scans for a similar spelling and never guesses among aliases.

Marker and state are independent evidence that must agree. A marker/state mismatch fails before a no-op, CAS claim, report write, gate result, resume payload, dispatch write, bypass consumption, or retention delete. Marker creation from an exact legacy state is the only permitted mutation during migration preflight.

## Boundary preflight order

Every boundary performs its ordinary argument and source-file validation as early as useful, but all `runId` checks below happen before a `runId`-derived path or durable run mutation.

| Boundary | Required order |
| --- | --- |
| `state --init`, absent | safe ID, resolve paths, reserve marker as new or adopt exact legacy state, build/validate state with exact `runId`, no-clobber state install |
| `state --init`, existing/no-op | safe ID, verify or adopt marker, parse state, compare `state.runId`, validate permitted state version, then and only then emit no-op success |
| `state --init`, concurrent loser | after state no-clobber loses, remove its temporary state files, re-read marker and winner state, require both exact, then return no-op; mismatch returns no success text |
| `state --set`, `appendReport`, and CAS | safe ID, verify or adopt marker, read and validate state, compare exact `state.runId`, verify exact next-state/claim identity, then install claim or replace state |
| `report` | validate flags and payload inputs, safe ID, verify or adopt marker and exact state, construct report with exact `run_id`, then write report, then append through CAS |
| `gate --step` | safe ID and identity/state preflight before `previousStep` can return the first-step success; for later steps parse report, require exact `run_id` and exact expected `step`, then inspect status |
| `gate --validate` | safe ID and identity/state preflight, parse metadata, require exact `run_id` and requested `task_id`, then evaluate executor inequality |
| `resume` | require and validate safe explicit ID, verify or adopt marker, validate state schema and exact `state.runId`, then compute and emit the reentry payload |
| dispatch `begin` | validate flags, attempt, prompt readability, and budgets; safe ID; reserve or verify marker even when state is absent; only then derive the record destination and write prompt |
| dispatch `end` | validate all supplied metadata, budgets, local `run_id`/`task_id`/attempt coherence; safe ID; reserve or verify marker even when state is absent; only then write output and metadata |
| retention | extract and validate the filename ID, verify exact marker, parse and validate state, require filename ID `=== marker.runId === state.runId`, then evaluate DONE/age and delete in the order below |
| spec-completeness hook | resolve a candidate, validate its filename or lock ID, verify/adopt marker and exact state, then consume a bypass or read `specPath`/`tasksPath`; an unsafe lock is terminal and cannot fall back to scan |
| recovery | safe ID; verify the marker, or if it is absent read and exactly validate state only to adopt the marker; then keep the Pair B order and errors for referenced recovery reads, publication, and CAS |

The report producer and gate consumer compare `run_id`. The gate also compares the expected report `step`. Dispatch `end` and validator authorization compare `run_id`, `task_id`, and attempt where applicable. Recovery claims compare `runId`. These are provenance checks, not a general task or step sanitization project. This design does not make `--task ../x` or `--step ../x` safe; that remains a separate finding and implementation.

## Retention

Retention may delete a run only after it proves, byte for byte, that the `run-state-<filenameId>.json` filename ID, canonical marker `runId`, and embedded `state.runId` are the same safe string. The marker and state must be regular non-symlink files, and all existing path components covered by Pair B remain symlink-rejected. Any identity failure occurs before the first delete and preserves reports, dispatches, recovery, state, and marker.

After the existing DONE and age checks pass, deletion order is reports, dispatches, recovery, state, then marker. A failure stops the sequence. The marker is always last. If a crash removes state but leaves the marker, the marker is a safe orphan: retention does not delete it without the three-way proof, the same exact ID may reuse it, and every alias still fails. No directory scan or pathname guess may turn that orphan into a different identity.

## Compatibility and migration

- Exact existing v2 or v3 state can create its marker on first access. Migration preserves state bytes; marker installation is additive.
- Markerless dispatches without state are left untouched and rejected as unprovable. The operator must supply external authority through a separate migration decision; this implementation does not guess.
- Markerless report, recovery, and dispatch directories do not authorize identity. An exact state beside them does.
- `.soma/run-identities/` may be absent in a legacy project. Its absence is not itself corruption. An authorized new reservation or exact state adoption creates it.
- Recovery schemas, claims, generations, and public Pair B error identities remain compatible. The marker is a coordination fact, not another history of state transitions or agents.
- Existing safe ASCII run IDs retain their spelling and paths. No bulk scan, rename, or Unicode rewrite occurs.

## Failure identities and non-mutation

| Stable identity | Meaning |
| --- | --- |
| `RUN_ID_INVALID` | Requested explicit ID is unsafe; lock resolution reports the established status `invalid_run_id` |
| `RUN_ID_MISMATCH` | Requested, marker, state, report, claim, or metadata identity differs by exact string comparison |
| `RUN_ID_MARKER_INVALID` | Marker is unreadable, non-regular, symlinked, has the wrong exact schema, or has noncanonical bytes |
| `RUN_ID_IDENTITY_UNPROVABLE` | No marker or exact state exists, but legacy artifacts exist or the boundary may not create a new identity |
| `RUN_ID_IDENTITY_INSTALL_FAILED` | No-clobber installation fails for an I/O reason other than an adoptable `EEXIST` |

For recovery callers, established `RECOVERY_*` codes remain their external identities. For report, gate, resume, dispatch, retention, and hook, the implementation plan may wrap the stable code in the existing CLI envelope, but must retain the code as a machine-checkable field or message prefix.

An identity-related failure must leave every pre-existing regular file byte-for-byte equal and create no final marker, report, dispatch, recovery, state, claim, next-state, output, metadata, or temporary file. Directory metadata is not part of byte equality. Successful exact legacy adoption may add only the canonical marker before the boundary continues. Successful retention is intentionally destructive; an I/O failure after deletion begins may leave a prefix removed, but state and marker ordering keeps the remaining identity from being reassigned.

## RED matrix

All alias fixtures use NFC `run-é` and NFD `run-e\u0301`. Case-alias fixtures use distinct ASCII spellings such as `run-Case` and `run-case`. Alias-only tests first prove that both pathnames resolve to the same `dev` and `ino`. They may skip only with a message such as `filesystem preserves distinct NFC/NFD pathnames` or `filesystem is case-sensitive`; an unconditional platform skip is forbidden. ASCII mismatch and unsafe cases never skip.

| ID | Boundary and setup | Required RED behavior |
| --- | --- | --- |
| R1 | Shared helper with non-string, empty, Unicode blank, `.`, `..`, `a/b`, `a\\b`, and `a\0b`, plus NFC/NFD | Unsafe values produce `RUN_ID_INVALID`; NFC/NFD pass unchanged and compare unequal |
| R2 | `resolveSomaPaths` and lock with the unsafe matrix and aliases | Unsafe rejects before path return; lock reports `invalid_run_id`; no normalization or fallback occurs |
| R3 | Fresh `state --init` with every unsafe ID | Entire durable tree remains byte-identical and no run path or temp is created |
| R4 | Existing NFC v2 and v3 state selected through NFD and through an ordinary ASCII mismatch | Exact mismatch before no-op output; state and all artifacts remain byte-identical |
| R5 | Inject an NFC winner at the state `linkSync` race while the requester is NFD; repeat same exact ID | Alias loser fails with no no-op and no temp; exact loser verifies marker/state and succeeds as no-op |
| R6 | NFC state and sentinel report, requested by NFD through explicit and lock origins; repeat unsafe matrix | Marker/state preflight fails before report replacement or append; sentinel report and state bytes remain exact |
| R7 | NFC state/report requested by NFD, ASCII wrong `report.run_id`, wrong `step`, and unsafe first-step request | Gate never authorizes an alias or mismatched artifact; unsafe rejects before the first-step early exit |
| R8 | NFC dispatch metadata requested by NFD, plus ASCII wrong `run_id` or `task_id` | Validator gate blocks before executor comparison; metadata cannot authorize the request |
| R9 | NFC state requested by NFD, ordinary embedded-state mismatch, and unsafe IDs | Resume emits no success payload and changes no bytes |
| R10 | NFC-owned prompt/output destination requested by NFD for both begin and end; new state-less run; legacy dispatch tree without marker/state | Alias cannot overwrite; new run reserves marker before write; legacy tree returns `RUN_ID_IDENTITY_UNPROVABLE`; invalid calls leave no partial files |
| R11 | Old DONE filename NFC/state NFD, reverse pair, ASCII mismatch, exact marker mismatch, and partial prior retention | No identity mismatch deletes reports, dispatches, recovery, state, or marker; authorized deletion removes marker last |
| R12 | Hook lock NFC/state NFD, scan filename NFC/state NFD, unsafe lock, and existing bypass | Hook neither consumes bypass nor uses spec paths before identity proof; unsafe lock cannot fall back |
| G1 | Direct `state --set` and `appendReport` alias/ASCII mismatch | Existing Pair B CAS path still returns exact mismatch with state, report, claim, and recovery bytes unchanged |
| G2 | Every recovery read, CAS, generation publication, crash adoption, symlink, and competing-claim case | Shared marker preflight preserves current Pair B errors and deterministic no-clobber behavior |
| G3 | `migrateStateV2` with NFC and NFD `runId` values | Pure transform preserves the original `runId` code points and performs no filesystem access |

## Acceptance criteria

- **AC-01:** WHEN any boundary receives a `runId`, the SOMA runtime SHALL reject an unsafe value before constructing or returning a `runId`-derived path.
- **AC-02:** WHEN two safe strings differ by code point or ASCII case, the SOMA runtime SHALL preserve both strings unchanged and SHALL compare them with exact equality without Unicode normalization or case folding.
- **AC-03:** WHEN a new run performs its first durable write, the SOMA runtime SHALL install the canonical two-key identity marker with no-clobber semantics before that write.
- **AC-04:** WHEN an identity marker already exists, the SOMA runtime SHALL accept it only when its canonical bytes and embedded `runId` exactly match the request, and SHALL never overwrite or repair it.
- **AC-05:** WHEN a marker is absent and an exact legacy state exists, the SOMA runtime SHALL permit additive marker adoption without changing state bytes.
- **AC-06:** IF a marker and exact legacy state are both absent while legacy run artifacts exist, THEN the SOMA runtime SHALL fail with `RUN_ID_IDENTITY_UNPROVABLE` and SHALL not infer identity from pathname, inode, recency, or artifact enumeration.
- **AC-07:** WHEN state initialization finds an existing file or loses a race, the SOMA runtime SHALL verify marker and embedded state identity before returning a successful no-op.
- **AC-08:** WHEN report, gate, resume, dispatch, hook, or recovery uses a run artifact, the SOMA runtime SHALL complete the boundary-specific identity preflight before mutation, authorization, success output, or bypass consumption.
- **AC-09:** WHEN an artifact already carries `run_id`, `runId`, `task_id`, attempt, or step as authorization data, the SOMA runtime SHALL compare those fields exactly with the effective request before trusting the artifact.
- **AC-10:** WHEN retention evaluates a run, the SOMA runtime SHALL require exact equality among filename ID, marker `runId`, and state `runId` before any delete, and SHALL remove the marker last.
- **AC-11:** IF an identity preflight fails, THEN the SOMA runtime SHALL preserve every pre-existing regular file byte-for-byte and SHALL leave no final or temporary run artifact.
- **AC-12:** WHEN a process crashes or two initiators race during reservation, the SOMA runtime SHALL converge to at most one complete immutable marker and SHALL allow only the exact embedded identity to continue.
- **AC-13:** WHEN an alias-only RED test cannot create two spellings for one inode, the test suite SHALL skip only that case with an explicit filesystem-property reason and SHALL still run ASCII mismatch and unsafe cases.
- **AC-14:** WHEN Pair B recovery reads or mutates state, the SOMA runtime SHALL preserve its exact state equality, file-only CAS, symlink rejection, crash recovery, and public error compatibility while adding universal marker preflight.
- **AC-15:** WHERE task ID or step path safety is not already an artifact authorization comparison, the implementation SHALL leave that separate finding out of scope and SHALL not claim it is fixed.

## Invariants

1. One exact safe string maps to one marker payload. A pathname may map several strings to one file, but the embedded exact string authorizes only one.
2. No identity proof depends on Unicode normalization, case folding, inode equality, `fs.realpath()`, timestamps, PID, TTL, or session ID.
3. A marker is immutable under the SOMA protocol and contains no status or agent history.
4. State remains canonical for run status. Dispatch records remain the only agent ledger. Recovery generations remain immutable facts referenced by state.
5. Marker creation precedes the first run artifact write. Identity mismatch precedes every no-op, authority decision, publication, bypass consumption, and delete.
6. Exact state can authorize lazy marker creation. No other legacy artifact can.
7. Retention never removes a marker before reports, dispatches, recovery, and state.
8. Pair B's hostile directory-swap exclusion remains explicit. No test or implementation claim extends beyond it.

## Challenge pass

The initial thesis was that a shared safety predicate plus exact embedded comparisons would close the problem. It does close state, report, gate, resume, retention, hook, and recovery once they can read an embedded owner. It fails for `dispatch-record begin`, because the prompt must be written before state or metadata may exist. No comparison helper can prove ownership when there is nothing to compare.

The revised design adds the minimal missing fact: a universal immutable marker reserved before the first write. This also resolves a crash after reservation. A marker with no state is not corruption; the same exact ID can continue, while an aliased spelling cannot. A state without a marker is a safe lazy-migration source. A marker without state is sufficient for pre-state dispatch but not for state-dependent report, gate, resume, hook, or recovery.

Several counterexamples constrain the design. A symlinked marker or component fails closed. A hardlink does not become identity; exact marker bytes remain the check, and hostile mutation through another link stays outside the approved threat model. NFC/NFD and case-insensitive races may have a scheduling-dependent winner, but they cannot have two successful identities. Marker/state divergence never self-heals. A legacy dispatch tree without either owner fact remains unprovable. Partial retention can leave a marker orphan, but deleting that marker without state would violate the three-way proof, so the orphan remains safe. Legacy directories authorize nothing on their own.

The remaining hypothesis is completeness: R1-R12 and G1-G3 must demonstrate that every current boundary invokes the same identity layer at the right time. A future run artifact boundary must add its own preflight case before it can claim this invariant.
