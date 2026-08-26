# SOMA exact run identity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every SOMA run boundary reserve and verify one immutable marker for the exact JavaScript `runId`, then reject unsafe, aliased, unprovable or mismatched ownership before any write, authorization, no-op, bypass consumption or delete.

**Architecture:** Four sequential RED, GREEN and integrated-review pairs add one dependency-free identity module, route state and recovery through it, apply the same preflight to artifact producers and consumers, and finish with retention and hook enforcement. The marker is an immutable coordination fact only. State remains the canonical run status, dispatch records remain the agent ledger, and recovery generations remain immutable facts referenced by state.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, Node built-ins, exact UTF-8 bytes, synchronous no-follow file operations and hard-link no-clobber installation. No dependency, daemon, database or normalization library is added.

---

## Verified baseline, thesis and scope

- The immutable implementation base is `516b9fbccd68a8c9c65886ec815ec41f9a63b257`. The approved design is `docs/superpowers/specs/2026-08-26-soma-run-identity-design.md`; `/tmp/soma-run-id-boundary-research.md` is supporting evidence.
- Verified source at that base: `paths.cjs` interpolates a truthy unvalidated ID; state initialization can return a false no-op; report writes before state CAS; gate, resume, dispatch, retention and the hook trust pathname selection at one or more authority points. Recovery already compares `state.runId` exactly and rejects symlinks for its Pair B state/CAS paths.
- The initial thesis, a shared safety predicate plus embedded comparisons, fails for state-less `dispatch-record begin`. The revised approach reserves an immutable two-key marker before the first durable run write and permits missing-marker adoption only from an exact v2 or v3 state.
- A pathname, `dev`/`ino`, hardlink, `fs.realpath()`, normalized string and case-folded string are never run identity. `realpath` may anchor an existing path-safety check, but may not authorize a run.
- Host-dependent NFC/NFD and case alias cases run only after the fixture proves that both spellings have equal `dev` and `ino`. The test calls `t.skip()` with the missing filesystem property. ASCII mismatch and unsafe-value tests always run.
- Task ID and step path sanitization remain a separate finding. This work compares `task_id` and `step` only where an artifact already carries them as authorization data. No task claims that `--task ../x` or `--step ../x` is now safe.
- The hostile local directory-swap race during one synchronous filesystem operation remains outside the threat model. No task adds or claims protection for it.
- `.soma/` is pre-existing untracked runtime data and must never enter a commit. RED proofs and dispatch records listed below are runtime-only.

## Stable module contract and canonical bytes

`core/scripts/run/run-id.cjs` exports exactly:

```js
safeRunId(value) -> boolean
assertSafeRunId(value) -> value | throws Error('RUN_ID_INVALID' or 'RUN_ID_INVALID: detail')
assertExactRunId(actual, requested) -> requested | throws Error('RUN_ID_MISMATCH' or 'RUN_ID_MISMATCH: detail')
reserveRunIdentity({ projectRoot, runId, allowNew })
  -> { status: 'created' | 'matched' | 'adopted', markerPath }
```

`core/scripts/run/state.cjs` adds one shared state-boundary reader while preserving its existing exports:

```js
readExactRunState({ projectRoot, runId, allowV2 })
  -> { state, stateBytes, runStateFile }
```

It reserves or adopts with `allowNew:false`, opens a regular non-symlink state, validates v3 or v2 when `allowV2 === true`, and compares `state.runId` exactly. Report, both gate routes and resume use this reader instead of recopying state proof.

The safety predicate is exact and non-normalizing:

```js
function safeRunId(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    value !== '.' && value !== '..' &&
    !value.includes('/') && !value.includes('\\') && !value.includes('\0') &&
    path.basename(value) === value;
}

function assertExactRunId(actual, requested) {
  assertSafeRunId(requested);
  if (actual !== requested) throw codedError('RUN_ID_MISMATCH');
  return requested;
}
```

The marker has no optional fields. Its only valid bytes are:

```js
const RUN_IDENTITY_SCHEMA = 'soma-run-identity/v1';

function canonicalMarkerBytes(runId) {
  return Buffer.from(JSON.stringify({
    $schema: RUN_IDENTITY_SCHEMA,
    runId,
  }, null, 2) + '\n', 'utf8');
}
```

For `run-é`, this is the UTF-8 encoding of:

```json
{
  "$schema": "soma-run-identity/v1",
  "runId": "run-é"
}
```

No BOM, normalization, timestamp, PID, session, path, inode, task, state, recovery or status field is accepted. Marker validation requires an ordinary non-symlink file, exact keys, literal schema, safe embedded ID, strict embedded/requested equality and byte equality with `canonicalMarkerBytes(requested)`.

`reserveRunIdentity` follows this decision order:

1. Call `assertSafeRunId(runId)` before any interpolation or `path.join` that contains `runId`.
2. Reject a symlink or non-directory `.soma` or `run-identities` component. Never follow a marker symlink.
3. If the marker exists, validate its complete canonical bytes. If state also exists, require a regular non-symlink v2/v3 JSON state with `state.runId === runId`. Return `matched` only after both checks.
4. If the marker is absent and state exists, require the same exact state proof, install the marker without changing state bytes, and return `adopted`.
5. If marker and state are absent, check only the exact requested reports, dispatches and recovery paths. Any existing legacy path makes identity `RUN_ID_IDENTITY_UNPROVABLE`; do not enumerate similar IDs or inspect artifact contents.
6. With no prior artifact, `allowNew: false` is unprovable. With `allowNew: true`, install and return `created`.

Installation creates one unique regular temp file under `.soma/run-identities/` with `wx`, writes canonical bytes, syncs the file, calls `linkSync(temp, marker)`, syncs the directory, removes the temp link and syncs the directory again. `EEXIST` validates the installed marker and returns `matched`; it never overwrites or repairs. A pre-link crash leaves only an inert uniquely named temp file. A post-link crash leaves a complete canonical marker that the exact ID can match on retry. Non-`EEXIST` I/O failures start with `RUN_ID_IDENTITY_INSTALL_FAILED`.

Stable universal failures are `RUN_ID_INVALID`, `RUN_ID_MISMATCH`, `RUN_ID_MARKER_INVALID`, `RUN_ID_IDENTITY_UNPROVABLE` and `RUN_ID_IDENTITY_INSTALL_FAILED`. CLI envelopes may add detail after `:`, but the stable code remains the JSON `error` field or message prefix.

`resolveSomaPaths(projectRoot, runId)` uses `arguments.length >= 2`, not truthiness. A supplied `undefined`, `null`, `''` or blank string therefore fails before it returns any run path. Its result adds:

```js
{
  runIdentitiesDir: path.join(somaDir, 'run-identities'),
  runIdentityFile: path.join(somaDir, 'run-identities', `${runId}.json`),
}
```

## Pair execution and proof contract

Pairs run strictly A, B, C, D. Inside each pair, RED commits first, GREEN commits second, and one integrated reviewer gates the pair. No production implementation runs in parallel. A RED author and its GREEN implementer must have different agent IDs. The GREEN implementer cannot edit, rename, skip or weaken the frozen tests or helper.

Every plan dispatch uses the existing state-backed run `run-260825-universal-entry-7f3c2a`. Its pre-existing exact `soma-state/v2` state authorizes lazy canonical-marker adoption after Pair A GREEN without changing state bytes. Task A RED and GREEN still record their prompts and outputs through the current pre-marker `dispatch-record` behavior. The first marker-aware dispatch then finds the exact state, returns `adopted`, and continues on the same ledger. The Task A records are therefore not an ownerless dispatch-only legacy tree. This plan creates no new run.

Set `TASK_ID` to the concrete ID named by the task, save the exact prompt at `PROMPT_FILE="/tmp/${TASK_ID}.prompt.md"`, and run this before every spawn:

```bash
node core/scripts/run.cjs dispatch-record begin \
  --run run-260825-universal-entry-7f3c2a \
  --task "$TASK_ID" \
  --attempt 1 \
  --prompt-file "$PROMPT_FILE"
```

The concrete task IDs are listed in each task. Prompt bytes must be at most 8,000. Before transitioning from the task, save the conversational result, at most 4,000 bytes, and a valid `soma-dispatch-record/v1` metadata file, then run `dispatch-record end`. The metadata must carry the effective run ID, exact task ID, attempt, model, immutable base SHA, timestamps, AC references, executor and result.

```bash
OUTPUT_FILE="/tmp/${TASK_ID}.output.md"
METADATA_FILE="/tmp/${TASK_ID}.metadata.json"
node core/scripts/run.cjs dispatch-record end \
  --run run-260825-universal-entry-7f3c2a \
  --task "$TASK_ID" \
  --attempt 1 \
  --output-file "$OUTPUT_FILE" \
  --metadata-file "$METADATA_FILE"
```

Every RED task writes a runtime-only `soma-red-proof/v1` beside its dispatch record. The RED author constructs it from observed bytes with this shape, replacing the Task A inputs with the task's exact command and oracle list:

```js
const proof = {
  $schema: 'soma-red-proof/v1',
  taskId: 'T-RUN-ID-A-RED',
  candidateSha: '516b9fbccd68a8c9c65886ec815ec41f9a63b257',
  command: ['node', '--test', 'core/scripts/__tests__/run-id-core.test.cjs'],
  expectedFailureIdentities: ['MODULE_NOT_FOUND', 'RUN_ID_INVALID'],
  observedExit,
  observedOutputSha256: sha256(observedOutputBytes),
  oracles: [
    'core/scripts/__tests__/run-id-core.test.cjs',
    'core/scripts/__tests__/helpers/run-identity-fixture.cjs',
  ].map(oraclePath => ({ path: oraclePath, sha256: sha256(fs.readFileSync(oraclePath)) })),
};
```

`sha256` returns lowercase 64-hex. The RED author writes the pretty-printed object with one trailing LF after the observed run. Before running inherited tests, GREEN verifies every oracle with this exact reader:

```bash
node - "$RED_PROOF" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const proof = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const oracle of proof.oracles) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(oracle.path)).digest('hex');
  if (actual !== oracle.sha256) throw new Error(`ORACLE_HASH_MISMATCH: ${oracle.path}`);
}
process.stdout.write('oracle hashes match\n');
NODE
```

Each integrated reviewer receives immutable `baseSha`, `redSha`, `headSha`, RED proof path and proof SHA-256 in one prompt. It checks spec compliance first, then code quality, in the same agent and dispatch. If it finds a mapped defect, the same GREEN executor gets one correction at `--attempt 2`; the reviewer remains in the original review dispatch and inspects the correction commit before ending it. If a technical finding remains after that correction, create a new task and canonical fingerprint from its requirement, minimal reproduction, boundary and observed identity. Do not authorize a third attempt. No pair declares an independent risk that warrants a second reviewer.

## File map and dependency order

| Pair | Frozen RED write set | GREEN write set | Depends on |
| --- | --- | --- | --- |
| A: identity core | `run-id-core.test.cjs`, `helpers/run-identity-fixture.cjs` | new `run-id.cjs`; `paths.cjs` | base |
| B: state and recovery | `run-id-state-recovery.test.cjs` | `state.cjs`; `recovery-store.cjs` | A approved |
| C: artifact boundaries | `run-id-boundaries.test.cjs` | `report.cjs`; `gate.cjs`; `resume.cjs`; `dispatch-record.cjs`; `validator-invariant.cjs` | B approved |
| D: retention and hook | `run-id-retention-hook.test.cjs` | `retention.cjs`; `spec-completeness-gate.cjs`; `.gitignore`; current runtime contract and command docs | C approved |

The test helper owns fixture setup, canonical marker seeding, exact tree snapshots and host-alias probing. Production never imports it. There are no overlapping concurrent GREEN write sets. `run-id.cjs` is the sole owner of the safety predicate, exact comparison, marker schema and reservation protocol.

### Task 1: Pair A RED author freezes R1, R2 and marker crash/race behavior

**Task ID:** `T-RUN-ID-A-RED`

**Files:**

- Create: `core/scripts/__tests__/helpers/run-identity-fixture.cjs`
- Create: `core/scripts/__tests__/run-id-core.test.cjs`
- Create at runtime only: `.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RUN-ID-A-RED/red-proof.json`

- [ ] **Step 1: Add the reusable exact non-mutation and alias helpers**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function snapshotTree(root) {
  const visit = relative => {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) return {
      path: relative, type: 'directory',
      children: fs.readdirSync(absolute).sort().map(name => visit(path.join(relative, name))),
    };
    if (stat.isFile()) return { path: relative, type: 'file', bytes: fs.readFileSync(absolute) };
    if (stat.isSymbolicLink()) return { path: relative, type: 'symlink', target: fs.readlinkSync(absolute) };
    return { path: relative, type: 'other', mode: stat.mode };
  };
  return visit('.');
}

function assertTreeUnchanged(root, before, message) {
  assert.deepEqual(snapshotTree(root), before, message);
}

function aliasSharesInode(t, existingPath, aliasPath, reason) {
  let left;
  let right;
  try {
    left = fs.statSync(existingPath);
    right = fs.statSync(aliasPath);
  } catch (_error) {
    t.skip(reason);
    return false;
  }
  if (left.dev !== right.dev || left.ino !== right.ino) {
    t.skip(reason);
    return false;
  }
  return true;
}

module.exports = { snapshotTree, assertTreeUnchanged, aliasSharesInode };
```

The helper compares every pre-existing regular file as a `Buffer`, records directory names, symlink targets and non-regular entries, and ignores directory metadata such as mtime. Every later identity-failure test reuses it.

- [ ] **Step 2: Freeze the core identity matrix**

```js
const UNSAFE = [undefined, null, 42, '', ' \t\n', '.', '..', 'a/b', 'a\\b', 'a\0b'];
const NFC = 'run-\u00e9';
const NFD = 'run-e\u0301';

test('R1 rejects the exact unsafe matrix and preserves safe Unicode code points', () => {
  const { safeRunId, assertSafeRunId, assertExactRunId } = require('../run/run-id.cjs');
  for (const value of UNSAFE) {
    assert.equal(safeRunId(value), false, JSON.stringify(value));
    assert.throws(() => assertSafeRunId(value), /^Error: RUN_ID_INVALID/);
  }
  assert.equal(assertSafeRunId(NFC), NFC);
  assert.equal(assertSafeRunId(NFD), NFD);
  assert.throws(() => assertExactRunId(NFD, NFC), /^Error: RUN_ID_MISMATCH/);
});

test('R2 validates a supplied runId before resolveSomaPaths returns a path', () => {
  const { resolveSomaPaths } = require('../run/paths.cjs');
  for (const value of UNSAFE) assert.throws(() => resolveSomaPaths('/project', value), /RUN_ID_INVALID/);
  assert.notEqual(resolveSomaPaths('/project', NFC).runStateFile, resolveSomaPaths('/project', NFD).runStateFile);
});
```

Add exact lock cases for every JSON-representable unsafe value. `resolveRunIdFromLock` must return `{status:'invalid_run_id'}` and the caller must not scan for a fallback. NFC and NFD return unchanged. NUL is exercised directly against the module because operating systems cannot carry NUL in an argv or pathname.

- [ ] **Step 3: Freeze marker schema, adoption, no-clobber, crash and race cases**

| Test name | Fixture | Required assertion |
| --- | --- | --- |
| `marker bytes are canonical and immutable` | fresh exact ID | exact two-key bytes; second call is `matched`; bytes unchanged |
| `marker never repairs malformed or noncanonical bytes` | extra key, reversed key order, missing LF, BOM, wrong schema, wrong embedded ID | `RUN_ID_MARKER_INVALID` or exact mismatch; marker and tree unchanged |
| `marker rejects symlink and nonregular destinations` | marker symlink and marker pathname as directory | fail closed; target bytes unchanged |
| `legacy adoption requires exact regular state` | marker absent, exact v2 and exact v3 state | `adopted`; only canonical marker is new; state snapshot equal |
| `legacy artifacts alone are unprovable` | reports, dispatches or recovery requested path with no marker/state | `RUN_ID_IDENTITY_UNPROVABLE`; no marker or temp |
| `allowNew false is unprovable without evidence` | empty run tree | same stable failure and no mutation |
| `stranded pre-link temp is inert` | canonical-looking unique temp but no final marker | reservation installs the final marker and does not treat temp as authority |
| `post-link crash converges on retry` | monkeypatch `fs.linkSync` to install the complete link and throw an injected crash before cleanup | first call exposes injected interruption; exact retry returns `matched`; marker bytes canonical |
| `two exact initiators converge` | two child processes reserve the same new ID | results are one `created`, one `matched`; one final marker; no temp |
| `aliased initiators admit at most one identity` | probe first proves NFC/NFD or case names share `dev`/`ino`; start two children | exactly one embedded identity wins; only requests equal to its bytes can succeed |

The case-alias test uses `run-Case` and `run-case` and skips only with `filesystem is case-sensitive`. The Unicode case skips only with `filesystem preserves distinct NFC/NFD pathnames`.

- [ ] **Step 4: Run RED, write proof and commit only tests**

Run: `node --test core/scripts/__tests__/run-id-core.test.cjs`

Expected: exit 1. R1/marker tests fail with `MODULE_NOT_FOUND` for `../run/run-id.cjs`; existing `paths.cjs` R2 assertions fail because unsafe supplied IDs do not throw and lock values are accepted. Record all observed stable identities and both oracle hashes in `soma-red-proof/v1`.

```bash
git add core/scripts/__tests__/helpers/run-identity-fixture.cjs core/scripts/__tests__/run-id-core.test.cjs
git commit -m "test(run): freeze exact identity core"
```

### Task 2: Pair A GREEN implementer adds the universal marker and safe paths

**Task ID:** `T-RUN-ID-A-GREEN`

**Files:**

- Create: `core/scripts/run/run-id.cjs`
- Modify: `core/scripts/run/paths.cjs`

- [ ] **Step 1: Verify immutable base and frozen oracle before execution**

Set `RED_PROOF=.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RUN-ID-A-RED/red-proof.json`, run the proof reader above, then run the focused test.

Expected: `oracle hashes match`; the same RED identities reproduce. Run `git diff --exit-code HEAD -- core/scripts/__tests__/run-id-core.test.cjs core/scripts/__tests__/helpers/run-identity-fixture.cjs` before and after implementation.

- [ ] **Step 2: Implement the exact public API and marker protocol**

```js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function codedError(code, detail) {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function markerBytes(runId) {
  return Buffer.from(`${JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2)}\n`, 'utf8');
}

module.exports = {
  safeRunId,
  assertSafeRunId,
  assertExactRunId,
  reserveRunIdentity,
};
```

Use `lstatSync` on every existing component and open the marker/state with `O_RDONLY | O_NOFOLLOW`, followed by `fstatSync(fd).isFile()`. Parse state only to require `$schema` equal to `soma-state/v2` or `soma-state/v3`, a safe `runId`, and strict equality. Validate an existing marker against exact canonical bytes before returning. Never call `normalize`, `toLowerCase`, `localeCompare`, `realpath` or inode comparison to decide ownership.

In `paths.cjs`, import `assertSafeRunId`, validate when `arguments.length >= 2`, add `runIdentitiesDir` globally, add `runIdentityFile` for valid supplied IDs, and make `resolveRunIdFromLock` call `safeRunId` after JSON parsing. A present unsafe lock returns `invalid_run_id`; callers do not receive a candidate ID.

- [ ] **Step 3: Run focused GREEN and foundation regressions**

Run:

```bash
node --test \
  core/scripts/__tests__/run-id-core.test.cjs \
  core/scripts/__tests__/run.test.cjs \
  core/scripts/__tests__/run-state-init-safety.test.cjs
git diff --check
```

Expected: PASS, with alias-only skips only when their named filesystem property is absent. No `.soma/` path is staged.

- [ ] **Step 4: Commit production only**

```bash
git add core/scripts/run/run-id.cjs core/scripts/run/paths.cjs
git commit -m "feat(run): reserve exact run identity"
```

### Task 3: Pair A integrated review

**Task ID:** `T-RUN-ID-A-REVIEW`

**Files:** read-only Pair A RED and GREEN commits, proof and source.

- [ ] **Step 1: Freeze reviewer inputs and rerun checks**

Capture `baseSha=516b9fbccd68a8c9c65886ec815ec41f9a63b257`, `redSha`, `headSha`, proof path and proof SHA-256 in the prompt. Run Task 2 Step 3 plus `git diff --check "$redSha" "$headSha"`.

Expected: PASS and no frozen-oracle diff.

- [ ] **Step 2: Review spec first, then code quality in the same dispatch**

Falsify AC-01 through AC-06, AC-11 through AC-13 and invariants 1, 2, 3, 5 and 6. Try blank Unicode, NUL, basename edge cases, noncanonical bytes, a marker symlink, marker directory, exact-state adoption, artifact-only legacy ownership, stranded temp, crash after link, exact race and host-proven aliases. Confirm `resolveSomaPaths` validates a supplied falsy argument before building a run path.

Return `APPROVED` or findings mapped to an AC/invariant. One mapped correction may go to `T-RUN-ID-A-GREEN --attempt 2`; any residual technical finding becomes a new task/fingerprint.

### Task 4: Pair B RED author freezes state initialization, mutation and recovery compatibility

**Task ID:** `T-RUN-ID-B-RED`

**Files:**

- Create: `core/scripts/__tests__/run-id-state-recovery.test.cjs`
- Read: `core/scripts/__tests__/helpers/run-identity-fixture.cjs`
- Read: `core/scripts/__tests__/fixtures/recovery/state/v2-valid.json`
- Read: `core/scripts/__tests__/fixtures/recovery/state/v3-red-pending.json`
- Create at runtime only: `.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RUN-ID-B-RED/red-proof.json`

- [ ] **Step 1: Freeze R3 through R5 with exact non-mutation checks**

```js
test('R4 existing v2 and v3 state never false-no-op for a different exact ID', t => {
  for (const schema of ['soma-state/v2', 'soma-state/v3']) {
    const fixture = seedState({ schema, runId: NFC });
    if (!aliasSharesInode(t, fixture.statePath, statePath(fixture.projectRoot, NFD),
      'filesystem preserves distinct NFC/NFD pathnames')) continue;
    const before = snapshotTree(fixture.projectRoot);
    const result = runState(fixture.projectRoot, ['--init', '--run', NFD]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RUN_ID_MISMATCH/);
    assert.doesNotMatch(result.stdout, /no-op|already initialized/);
    assertTreeUnchanged(fixture.projectRoot, before, 'mismatch must not mutate');
  }
});
```

R3 runs fresh `state --init` with `''`, Unicode blank, `.`, `..`, slash and backslash. It snapshots the entire project before the process and requires `RUN_ID_INVALID`, no final run path and no temp. NUL is covered by the direct core test because argv cannot contain it. R4 repeats v2/v3 with ordinary ASCII state/request mismatch without a skip.

R5 monkeypatches the state writer's `fs.linkSync` seam. For an NFD requester, it installs an NFC winner state at the no-clobber target and forces `EEXIST`; the loser removes its own state temps, emits no no-op text and fails exact marker/state verification. The same fixture with one exact ID re-reads marker and winner state and succeeds as a no-op.

- [ ] **Step 2: Freeze G1 through G3**

| Test | Required assertion |
| --- | --- |
| `G1 state --set rejects alias and ASCII mismatch` | marker, state, reports, claim and recovery bytes unchanged; no success text |
| `G1 appendReport rejects alias and ASCII mismatch` | `{ok:false, reason}` starts with stable exact-mismatch identity; no ledger append or CAS artifact |
| `G2 shared marker preserves recovery read errors` | unsafe `readStateV3` remains `RECOVERY_REFERENCE_RUN_ID_INVALID`; unsafe mutations remain `RECOVERY_STATE_RUN_ID_INVALID`; exact mismatch remains `RECOVERY_STATE_RUN_ID_MISMATCH` |
| `G2 marker preflight precedes recovery read/CAS/publication` | wrong/malformed/symlink marker fails before reference read, claim install, generation publication or state replacement |
| `G3 migrateStateV2 preserves code points` | NFC and NFD values survive the pure transform with `===`; monkeypatched fs methods receive zero calls |

The focused command also includes all existing G2 crash, symlink, generation and competing-claim tests. Those files stay untouched and their public error assertions remain authoritative.

- [ ] **Step 3: Run RED, record proof and commit only the new test**

Run: `node --test core/scripts/__tests__/run-id-state-recovery.test.cjs`

Expected: exit 1. Existing/no-clobber init paths false-no-op on mismatched embedded state, state mutation lacks marker preflight, and recovery does not yet verify/adopt the marker. Record the exact failing test names, output hash and oracle hash.

```bash
git add core/scripts/__tests__/run-id-state-recovery.test.cjs
git commit -m "test(run): freeze state identity preflight"
```

### Task 5: Pair B GREEN implementer routes state and recovery through exact identity

**Task ID:** `T-RUN-ID-B-GREEN`

**Files:**

- Modify: `core/scripts/run/state.cjs`
- Modify: `core/scripts/run/recovery-store.cjs`

- [ ] **Step 1: Verify the Pair B oracle hashes before executing RED**

Use the proof reader with `RED_PROOF=.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RUN-ID-B-RED/red-proof.json`. Verify `git diff --exit-code HEAD -- core/scripts/__tests__/run-id-state-recovery.test.cjs core/scripts/__tests__/helpers/run-identity-fixture.cjs`, then reproduce RED.

- [ ] **Step 2: Make marker and exact state proof precede every state outcome**

Replace the `safeRunId` import from `recovery-store.cjs` with:

```js
const {
  assertSafeRunId,
  reserveRunIdentity,
} = require('./run-id.cjs');
```

`cmdInit` performs `assertSafeRunId`, resolves paths, then calls `reserveRunIdentity({projectRoot, runId, allowNew:true})`. Existing/no-op reads a regular non-symlink state, accepts only permitted v2/v3 schema, and compares `state.runId` exactly before output. A concurrent state-install loser cleans its temporary paths, calls reservation again, re-reads the winner state and applies the same checks before no-op.

`mutateExistingState`, `cmdSet` and `appendReport` call `reserveRunIdentity({allowNew:false})` before reading state or building report/CAS paths. The transform and next-state bytes must retain the same exact `runId`. A mismatch returns before claim, next-state or replacement writes. Exact legacy adoption may add only the marker.

Add and export `readExactRunState({projectRoot, runId, allowV2})` with the contract above. Route `mutateExistingState`, existing/no-op validation and the concurrent-loser reread through the same regular-file/schema/exact-ID logic. Production consumers in Pair C may call it without importing recovery internals.

- [ ] **Step 3: Preserve Pair B recovery identities while adding marker preflight**

Remove the local `safeRunId` definition and import the universal functions. Add one internal adapter:

```js
function preflightRecoveryIdentity({ projectRoot, runId, invalidCode }) {
  try {
    assertSafeRunId(runId);
    return reserveRunIdentity({ projectRoot, runId, allowNew: false });
  } catch (error) {
    if (/^RUN_ID_INVALID(?::|$)/.test(error.message)) throw codedError(invalidCode);
    if (/^RUN_ID_/.test(error.message)) {
      throw codedError('RECOVERY_STATE_RUN_ID_MISMATCH', error.message);
    }
    throw error;
  }
}
```

`readStateV3` passes `RECOVERY_REFERENCE_RUN_ID_INVALID`; mutation and publication pass `RECOVERY_STATE_RUN_ID_INVALID`. Call the adapter before state/reference read, generation installation or CAS layout. Keep exact state, claim and next-state comparisons, file-only CAS, symlink rejection, crash adoption and competing-claim rules unchanged. Export `safeRunId` as an alias imported from `run-id.cjs` for existing consumers until they migrate; do not keep a second implementation.

- [ ] **Step 4: Run focused GREEN and Pair B regressions**

Run:

```bash
node --test \
  core/scripts/__tests__/run-id-state-recovery.test.cjs \
  core/scripts/__tests__/run-state-init-safety.test.cjs \
  core/scripts/__tests__/run-state-cas-pivot.test.cjs \
  core/scripts/__tests__/run-state.test.cjs \
  core/scripts/__tests__/contract-run-state.test.cjs \
  core/scripts/__tests__/run-recovery-store.test.cjs \
  core/scripts/__tests__/run-recovery-store-g2.test.cjs
git diff --check
```

Expected: PASS. Host alias skips remain conditional; ASCII and unsafe cases execute. No test/helper hash changes.

- [ ] **Step 5: Commit production only**

```bash
git add core/scripts/run/state.cjs core/scripts/run/recovery-store.cjs
git commit -m "feat(run): preflight state and recovery identity"
```

### Task 6: Pair B integrated review

**Task ID:** `T-RUN-ID-B-REVIEW`

**Files:** read-only Pair B commits, proof, state and recovery modules.

- [ ] **Step 1: Verify immutable inputs and deterministic checks**

Capture Pair A approved head as `baseSha`, Pair B RED and GREEN SHAs, and proof hash. Run Task 5 Step 4 plus `git diff --check "$redSha" "$headSha"`.

- [ ] **Step 2: Review conformity, then code quality**

Falsify AC-03 through AC-08, AC-11, AC-12 and AC-14. Inspect fresh init, existing v2/v3 no-op, injected loser, direct set, append, every recovery entry point, next-state identity, claim identity and migration purity. Confirm exact adoption preserves state bytes and marker/state disagreement never self-heals. Re-run pre-created symlink, crash and competing-claim cases. Confirm no normalization, realpath identity or hostile-swap promise entered comments or tests.

Return `APPROVED` or mapped findings. One same-executor correction is permitted; a residual finding becomes a new task/fingerprint, never attempt 3.

### Task 7: Pair C RED author freezes report, gate, resume and dispatch preflight

**Task ID:** `T-RUN-ID-C-RED`

**Files:**

- Create: `core/scripts/__tests__/run-id-boundaries.test.cjs`
- Read: `core/scripts/__tests__/helpers/run-identity-fixture.cjs`
- Create at runtime only: `.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RUN-ID-C-RED/red-proof.json`

- [ ] **Step 1: Freeze R6 report preflight**

Seed a canonical NFC marker, exact state and sentinel report. Request NFD first through `--run`, then through an exact NFD value in `.soma.lock`, after proving shared inode. Both calls must fail before report replacement or `appendReport`; sentinel report, state, marker and CAS/recovery snapshots stay equal. Repeat with an ordinary ASCII mismatch and every argv-safe unsafe value without a skip.

The test asserts `report.cjs` validates flags and payload inputs, then proves marker plus exact state, then constructs and writes a report whose `run_id === effectiveRunId`, then appends through CAS. A missing marker with exact state may add only the marker before continuing.

- [ ] **Step 2: Freeze R7 and R8 gate authorization**

```js
test('R7 first-step success cannot bypass run identity preflight', () => {
  const result = runGate(projectRoot, ['--run', '..', '--step', 'STEP_1A_SPECIFY']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RUN_ID_INVALID/);
});
```

For later steps, seed exact marker/state and require report `run_id === runId` and `step === previousStep(args.step)` before status inspection. An NFC/NFD request, ASCII wrong `run_id`, and ASCII wrong `step` all block.

For validator gate, seed dispatch metadata with a different exact `run_id` or `task_id` and an executor different from the proposed validator. The gate must still block before executor inequality can authorize. Alias-only metadata/request uses the host probe; ASCII mismatches never skip.

- [ ] **Step 3: Freeze R9 and R10 resume/dispatch ownership**

| Test | Required assertion |
| --- | --- |
| `R9 resume rejects unsafe explicit ID before path` | no stdout success payload; tree unchanged |
| `R9 resume rejects aliased or ordinary embedded-state mismatch` | no `ok:true`/reentry output; marker/state bytes unchanged |
| `R10 begin cannot overwrite another exact owner` | existing NFC marker and prompt sentinel survive NFD and ASCII requests |
| `R10 end cannot overwrite another exact owner` | coherent attacker metadata still cannot replace NFC output/metadata |
| `R10 new state-less begin reserves before prompt` | marker exists with canonical bytes before prompt path appears; success |
| `R10 new state-less end reserves before output/metadata` | same ordering and exact ownership |
| `R10 legacy dispatch tree is unprovable` | marker/state absent plus dispatch path returns `RUN_ID_IDENTITY_UNPROVABLE`; old bytes unchanged |
| `R10 invalid calls leave no partial files` | prompt/output/metadata/temp absent and snapshot equal |

Keep current budgets: prompt at most 8,000 bytes, output at most 4,000 bytes and attempt at most 2. Input and metadata validation still happen before destination writes.

- [ ] **Step 4: Run RED, record proof and commit only the test**

Run: `node --test core/scripts/__tests__/run-id-boundaries.test.cjs`

Expected: exit 1 with sentinel-overwrite or false-authorization assertions at report/gate/resume/dispatch boundaries. Record each failing test name and the single oracle hash.

```bash
git add core/scripts/__tests__/run-id-boundaries.test.cjs
git commit -m "test(run): freeze artifact identity boundaries"
```

### Task 8: Pair C GREEN implementer preflights every artifact producer and consumer

**Task ID:** `T-RUN-ID-C-GREEN`

**Files:**

- Modify: `core/scripts/run/report.cjs`
- Modify: `core/scripts/run/gate.cjs`
- Modify: `core/scripts/run/resume.cjs`
- Modify: `core/scripts/run/dispatch-record.cjs`
- Modify: `core/scripts/run/validator-invariant.cjs`

- [ ] **Step 1: Verify frozen Pair C hashes and reproduce RED**

Use the proof reader. Check no diff in `run-id-boundaries.test.cjs` or the helper before and after implementation.

- [ ] **Step 2: Move report identity proof before its first destination write**

After flags, status, reason and source payload validation, call `assertSafeRunId(runId)` and `readExactRunState({projectRoot, runId, allowV2:true})` before building `runReportsDir`, `filePath` or payload. Then write the report and call `appendReport`. Preserve current CLI envelopes while retaining the stable `RUN_ID_*` code.

- [ ] **Step 3: Gate on exact state and artifact provenance before authority**

Both gate routes resolve and assert the ID, call `readExactRunState({projectRoot, runId, allowV2:true})` before `previousStep` or any metadata/report path, and therefore reserve/adopt plus prove exact state. First-step `{none:true}` occurs only after this preflight.

After report parse/schema validation, add:

```js
assertExactRunId(parsed.run_id, runId);
if (parsed.step !== prev.step) fail(`RUN_ID_MISMATCH: report step does not match ${prev.step}`);
```

Extend the existing validator API compatibly:

```js
checkValidatorAssignment({
  metadataPath,
  proposedValidator,
  expectedRunId,
  expectedTaskId,
}) -> { allowed, reason }
```

It reads metadata once, requires exact `metadata.run_id` and `metadata.task_id` when expectations are supplied, then evaluates executor inequality. Existing callers that omit expectations retain their behavior.

- [ ] **Step 4: Make resume and state-less dispatch prove ownership**

Resume requires a safe explicit ID and calls `readExactRunState({projectRoot, runId, allowV2:true})` before deriving reports/reentry and emitting output.

Dispatch `begin` keeps this order: flags, task/attempt, prompt readability, attempt/prompt budget, safe ID, `reserveRunIdentity({allowNew:true})`, destination derivation, prompt write. `end` keeps: flags, source metadata parse/schema, budgets and local exact `run_id`/`task_id`/attempt coherence, safe ID, `reserveRunIdentity({allowNew:true})`, destination derivation, output and metadata writes. Artifact directories, prompt bytes and metadata never authorize adoption.

Do not add task or step path sanitization. The new comparisons are provenance checks only.

- [ ] **Step 5: Run focused GREEN and boundary regressions**

Run:

```bash
node --test \
  core/scripts/__tests__/run-id-boundaries.test.cjs \
  core/scripts/__tests__/run-report.test.cjs \
  core/scripts/__tests__/run-gate.test.cjs \
  core/scripts/__tests__/run-validator-invariant.test.cjs \
  core/scripts/__tests__/run-resume.test.cjs \
  core/scripts/__tests__/run-dispatch-record.test.cjs \
  core/scripts/__tests__/contract-dispatch-record.test.cjs \
  core/scripts/__tests__/trilho-e2e.test.cjs
git diff --check
```

Expected: PASS. Exact new state-less dispatch succeeds; legacy state-less dispatch fails unprovable; all budgets and ordinary coherence tests remain green.

- [ ] **Step 6: Commit production only**

```bash
git add \
  core/scripts/run/report.cjs \
  core/scripts/run/gate.cjs \
  core/scripts/run/resume.cjs \
  core/scripts/run/dispatch-record.cjs \
  core/scripts/run/validator-invariant.cjs
git commit -m "feat(run): enforce identity at artifact boundaries"
```

### Task 9: Pair C integrated review

**Task ID:** `T-RUN-ID-C-REVIEW`

**Files:** read-only Pair C commits, proof and five boundary modules.

- [ ] **Step 1: Verify immutable candidate and regressions**

Capture Pair B approved head, RED/GREEN SHAs and proof hash. Run Task 8 Step 5 and `git diff --check "$redSha" "$headSha"`.

- [ ] **Step 2: Review boundary ordering before implementation style**

Falsify AC-01, AC-02, AC-03, AC-05, AC-06, AC-08, AC-09, AC-11 and AC-13. Place sentinels at every final/temp destination, exercise explicit and lock IDs, first-step early return, wrong report step, validator metadata with a different executor, resume success output, state-less begin/end, legacy dispatch and budget failures. Confirm each identity error precedes the protected action and all pre-existing bytes remain equal.

Then inspect code for duplicated normalization, path creation before validation, repeated metadata reads at the authorization point and changed legacy budgets. Return `APPROVED` or mapped findings under the bounded correction rule.

### Task 10: Pair D RED author freezes retention and hook identity ordering

**Task ID:** `T-RUN-ID-D-RED`

**Files:**

- Create: `core/scripts/__tests__/run-id-retention-hook.test.cjs`
- Read: `core/scripts/__tests__/helpers/run-identity-fixture.cjs`
- Create at runtime only: `.soma/dispatches/run-260825-universal-entry-7f3c2a/T-RUN-ID-D-RED/red-proof.json`

- [ ] **Step 1: Freeze R11 retention three-way proof and deletion order**

```js
const DELETE_ORDER = ['reports', 'dispatches', 'recovery', 'state', 'marker'];

test('R11 retention deletes marker last after exact three-way proof', () => {
  const fx = seedOldDoneRun({ filenameRunId: 'run-exact', markerRunId: 'run-exact', stateRunId: 'run-exact' });
  const removed = [];
  const originalRm = fs.rmSync;
  fs.rmSync = function observed(target, options) {
    removed.push(classifyTarget(target));
    return originalRm.call(this, target, options);
  };
  try {
    const result = sweepExpiredArtifacts({ projectRoot: fx.projectRoot, now: fx.now });
    assert.deepEqual(result.swept.map(x => x.runId), ['run-exact']);
    assert.deepEqual(removed, DELETE_ORDER);
  } finally {
    fs.rmSync = originalRm;
  }
});
```

Add old DONE fixtures for filename NFC/state NFD, reverse spelling, ASCII mismatch and exact marker mismatch. Each snapshots reports, dispatches, recovery, state and marker and requires zero delete attempts. Alias cases first prove shared `dev`/`ino`; ASCII runs always.

Inject a failure at each deletion position. A failure stops the sequence immediately. Reports precede dispatches, recovery, state and marker; marker is always last. A retry after a valid partial prefix removes the remaining prefix in order. If state is already absent, the marker orphan remains because three-way proof is impossible.

- [ ] **Step 2: Freeze R12 hook proof before bypass or source paths**

Use the real hook process with a `git commit -m test` payload, isolated session ID and isolated temp bypass. Cases:

| Candidate | Required assertion |
| --- | --- |
| lock NFC, state NFD | identity failure/warning before bypass unlink; spec/tasks sentinels unread |
| scan filename NFC, state NFD | same, with no lock |
| unsafe present lock plus valid scannable state | unsafe lock is terminal; no scan fallback; bypass remains |
| exact legacy state, marker absent | hook may add only canonical marker, then consumes bypass or reads spec/tasks |
| exact marker/state with bypass | proof completes first, then bypass is removed and hook exits 0 |

Patch `fs.readFileSync`/`unlinkSync` only in a child preload so the test records access order without changing hook semantics. Keep the old temp-state fallback only when no new lock/candidate exists; it cannot authorize a new run identity.

- [ ] **Step 3: Freeze runtime documentation and ignore expectations**

The test requires `.soma/run-identities/` to be ignored while `.soma/install-state.json` remains trackable. It also requires the current persistence contract to name canonical marker bytes and marker-last retention, and `core/adapters/claude/commands/soma-run.md` to state that `state --init` reserves the marker before state and retention removes recovery/state before marker.

No install-target manifest change is expected: `run-id.cjs` ships inside the already transactional whole `core` tree, and `core/adapters/claude/install-targets.json` already maps the existing hook file.

- [ ] **Step 4: Run RED, record proof and commit only the new test**

Run: `node --test core/scripts/__tests__/run-id-retention-hook.test.cjs`

Expected: exit 1. Retention lacks three-way proof/recovery/marker deletion, the hook consumes bypass before state identity proof and an unsafe lock can fall back, and marker ignore/docs are absent.

```bash
git add core/scripts/__tests__/run-id-retention-hook.test.cjs
git commit -m "test(run): freeze retention and hook identity"
```

### Task 11: Pair D GREEN implementer completes retention, hook and current contracts

**Task ID:** `T-RUN-ID-D-GREEN`

**Files:**

- Modify: `core/scripts/run/retention.cjs`
- Modify: `core/hooks/spec-completeness-gate.cjs`
- Modify: `.gitignore`
- Modify: `core/specs/016-artifact-gated-trilho/contracts/persist-run-state.md`
- Modify: `core/adapters/claude/commands/soma-run.md`

- [ ] **Step 1: Verify the Pair D oracle before execution**

Use the proof reader and confirm no diff in the frozen Pair D test/helper. Reproduce every named RED failure.

- [ ] **Step 2: Require filename, marker and state equality before retention eligibility**

Replace retention's local `isSafeRunId` with universal assertions. For each matched state filename: validate the extracted ID before constructing further paths; call `reserveRunIdentity({allowNew:false})`; open marker and state without following symlinks; validate state schema; require:

```js
filenameRunId === marker.runId && marker.runId === state.runId
```

Only then inspect `currentState`, mtime and age. Delete sequentially and stop on first failure:

```js
for (const target of [runReportsDir, runDispatchesDir, runRecoveryDir, runStateFile, runIdentityFile]) {
  const outcome = removeSafely(somaDir, target);
  if (!outcome.removed) {
    result.errors.push({ runId, reason: outcome.reason });
    break;
  }
}
```

Push `swept` only after marker deletion succeeds. An exact legacy state may add its marker during preflight. Identity failure happens before the first delete. A partial valid deletion remains retryable because state and marker are last; a marker without state is never deleted by retention.

- [ ] **Step 3: Make the hook prove identity before bypass consumption**

Load `resolveRunIdFromLock`, `assertSafeRunId` and `reserveRunIdentity` from the universal modules. In the source tree, resolve them from `../scripts/run/`. In an installed hook, resolve them from `${SOMA_HOME}/scripts/run/` when `SOMA_HOME` is set, otherwise from `path.join(os.homedir(), '.soma-v2', 'scripts', 'run')`. Test both layouts; never silently fall back to a duplicated predicate. Refactor new-state selection to return the extracted candidate ID and path without building an ID-derived path first. A present lock with `invalid_run_id` is terminal and cannot enter the scan branch. A selected scan filename is validated before its path is used.

For a new-state candidate, call `reserveRunIdentity({allowNew:false})`, parse a regular permitted state, and compare its embedded ID exactly. Only after this proof may the hook test/unlink the bypass marker or read `specPath` and `tasksPath`. On identity failure, emit a warning containing the stable code and fail open under the hook's existing compatibility contract, but leave the bypass and all source paths untouched. Preserve the legacy temp-state fallback when no new candidate or authoritative invalid lock exists.

- [ ] **Step 4: Update only source-map-proven runtime artifacts**

Add `.soma/run-identities/` to the selective runtime ignore block; keep `.soma/install-state.json` unignored. Update the current persistence contract with the exact two-key marker, additive exact-state adoption, identity preflight, recovery deletion and marker-last order. Update `soma-run.md` initialization and DONE cleanup paragraphs to reflect automatic reservation and the full deletion order.

Do not change install manifests or copy files into an installed home. Whole-tree installation already includes new `core/scripts/run/run-id.cjs`, and the existing hook mapping remains correct.

- [ ] **Step 5: Run focused GREEN, hook/retention regressions and install source-map checks**

Run:

```bash
node --test \
  core/scripts/__tests__/run-id-retention-hook.test.cjs \
  core/scripts/__tests__/run-retention.test.cjs \
  core/hooks/__tests__/spec-completeness-gate.test.cjs \
  core/scripts/__tests__/contract-run-state.test.cjs \
  core/scripts/__tests__/run-gitignore.test.cjs \
  core/scripts/__tests__/efficient-orchestration-protocol.test.cjs \
  core/scripts/__tests__/install-targets-set.test.cjs \
  install/__tests__/global-install-transaction.test.cjs
git diff --check
```

Expected: PASS. Identity mismatch performs no delete/unlink/source read; exact retention deletes marker last; the marker is ignored selectively; installer tests prove no manifest edit is required.

- [ ] **Step 6: Commit production/docs only**

```bash
git add \
  core/scripts/run/retention.cjs \
  core/hooks/spec-completeness-gate.cjs \
  .gitignore \
  core/specs/016-artifact-gated-trilho/contracts/persist-run-state.md \
  core/adapters/claude/commands/soma-run.md
git commit -m "feat(run): close retention and hook identity"
```

### Task 12: Pair D integrated review and final gate

**Task ID:** `T-RUN-ID-D-REVIEW`

**Files:** read-only complete four-pair history, all proofs and final source.

- [ ] **Step 1: Verify immutable Pair D inputs and focused regressions**

Capture Pair C approved head, Pair D RED/GREEN SHAs and proof hash. Run Task 11 Step 5 and `git diff --check "$redSha" "$headSha"`.

- [ ] **Step 2: Review retention and hook conformity before code quality**

Falsify AC-01, AC-02, AC-04, AC-05, AC-08, AC-10 through AC-13 and invariants 5 through 8. Verify filename/marker/state equality, marker-last deletion, one-failure stop, partial retry, safe orphan, lock terminality, scan exactness and bypass/source-read order. Confirm all existing symlink checks remain and no hardlink/inode/realpath identity claim was added.

Review the docs and ignore change against the source map. Confirm no install manifest change, no `.soma` staging, and no claim that task/step sanitization is fixed. Return `APPROVED` or mapped findings under the bounded correction rule.

- [ ] **Step 3: Run the full repository gate after approval**

```bash
node --test \
  core/scripts/__tests__/run-id-core.test.cjs \
  core/scripts/__tests__/run-id-state-recovery.test.cjs \
  core/scripts/__tests__/run-id-boundaries.test.cjs \
  core/scripts/__tests__/run-id-retention-hook.test.cjs
npm test
git diff --check
git status --short
```

Expected: both test commands PASS; alias-only skips name the absent filesystem property; `git diff --check` is silent; status contains no staged or tracked `.soma/` content.

## AC-to-task traceability

| Acceptance criterion | RED proof | GREEN owner | Review |
| --- | --- | --- | --- |
| AC-01 unsafe before derived path | A R1/R2; B R3; C R6-R10; D R11/R12 | 2, 5, 8, 11 | 3, 6, 9, 12 |
| AC-02 exact Unicode/case preservation | A R1 and alias races; B R4/R5/G3; C aliases; D three-way aliases | 2, 5, 8, 11 | all reviews |
| AC-03 marker before first durable write | A marker/race; B fresh init; C state-less dispatch | 2, 5, 8 | 3, 6, 9 |
| AC-04 existing marker canonical and immutable | A malformed/symlink/nonregular; all later boundary fixtures | 2 | all reviews |
| AC-05 exact legacy state adoption only | A v2/v3 adoption; B init/recovery; C boundary adoption; D hook/retention | 2, 5, 8, 11 | all reviews |
| AC-06 artifact-only legacy unprovable | A artifact paths; C legacy dispatch | 2, 8 | 3, 9 |
| AC-07 init existing/loser exact no-op | B R4/R5 | 5 | 6 |
| AC-08 every artifact boundary preflights | B G2; C R6-R10; D R12 | 5, 8, 11 | 6, 9, 12 |
| AC-09 embedded authorization fields exact | B next state/claim; C report, metadata, task, attempt, step; D filename/state | 5, 8, 11 | 6, 9, 12 |
| AC-10 retention three-way and marker last | D R11 | 11 | 12 |
| AC-11 failure preserves bytes and leaves no temp/final artifact | shared snapshot helper across A-D | 2, 5, 8, 11 | all reviews |
| AC-12 crash/race convergence | A reservation crash/races; B state loser and recovery crash | 2, 5 | 3, 6 |
| AC-13 conditional alias skips only | helper plus every alias test | test-only invariant frozen in Task 1 | all reviews |
| AC-14 Pair B compatibility | B G1-G3 plus existing recovery suites | 5 | 6 |
| AC-15 task/step sanitization stays separate | C provenance-only assertions; final source scan | 8 | 9, 12 |

Every AC has a RED, a named production owner and an integrated review. The four pairs produce testable software after Tasks 2, 5, 8 and 11.

## Self-review checklist for the plan author

- [x] Map AC-01 through AC-15 to a RED proof, GREEN owner and review. No gap remains.
- [x] Run `rg -n -i 'T[B]D|T[O]DO|implement l[a]ter|similar t[o]|rest foll[o]ws|as need[e]d|\.\.\.' docs/superpowers/plans/2026-08-26-soma-run-identity.md`; the scan returns no hits.
- [x] Confirm names and signatures are consistent: `safeRunId`, `assertSafeRunId`, `assertExactRunId`, `reserveRunIdentity`, `readExactRunState`, `runIdentitiesDir`, `runIdentityFile`, `expectedRunId`, `expectedTaskId` and `sweepExpiredArtifacts`.
- [x] Confirm exactly four sequential pairs and 12 tasks; RED and GREEN authors differ; tests freeze after each RED commit; one integrated reviewer/dispatch covers spec then code quality; one correction is the maximum before a new task/fingerprint.
- [x] Confirm production uses Node 22/CommonJS/built-ins only and adds no dependency, normalization, run ledger, database, daemon or hostile-directory-swap claim.
- [x] Confirm the only plan-author worktree change is this plan file, `.soma/` remains untouched, and the plan diff has no whitespace error.

## Execution handoff

Plan complete at `docs/superpowers/plans/2026-08-26-soma-run-identity.md`. Implement it with `superpowers:subagent-driven-development` for distinct RED/GREEN authors and the single integrated reviewer per pair, or use `superpowers:executing-plans` only if the executor can preserve the same author separation, frozen-oracle hashes and dispatch-record envelope.
