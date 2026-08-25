# SOMA universal entry and safe resume design

**Status:** approved contract, implementation not started

**Date:** 2026-08-25

**Scope:** Claude `/soma-run`, internal CLI preflight, project adoption, safe resume, structured handoff, installation sync and current documentation

## Context

The current system has two similarly named layers with different jobs:

- `/soma-run` is a Claude command stored at `core/adapters/claude/commands/soma-run.md`. It is a prompt that describes the orchestration state machine. It does not consume `$ARGUMENTS`, so `--help`, `--status` and `--resume` reach Claude as unclassified text.
- `soma run` is an internal CLI family implemented by `core/scripts/run.cjs` and `core/scripts/run/*.cjs`. Its verbs persist state, reports and dispatch records, enforce gates and compute a read-only reentry point.

The global installer already copies the adapter and the complete `core/` tree transactionally. The real installed CLI is `~/.soma-v2/scripts/soma.cjs`; a `soma` shell shim is not part of that contract. Project installation is separate and writes `<project>/.soma/install-state.json`.

The current resume primitive is read-only and evidence-based, but it only returns `reentry` and `last_pass`. It assumes the caller is already in the correct project. The current `/handoff` command can emit prose outside the project and cannot prove the repo, SHA, dirty files, tasks, evidence or closed agents to a later session.

## Quality checklist

- One public user command for project-changing work.
- No project write, lock creation or agent creation in help, status or resume inspection.
- Explicit and testable repo and scope resolution, including monorepos.
- Honest adoption that records observed facts without fabricating history.
- Exact confirmation before a resumed run can mutate.
- Machine-readable and human-readable continuation artifacts in the project.
- No dependency on a shell shim or silent `cd`.
- Compatibility with existing `soma run` primitives and transactional install.

## Initial thesis and challenge

The initial thesis was to teach the existing `soma run` dispatcher to accept public objective, status and resume forms. That would keep all routing under one name.

The challenge falsified it. `soma run` already has a stable primitive grammar whose first token is one of `state`, `report`, `gate`, `resume` or `dispatch-record`. Making the same grammar also mean “start project work” would make `resume` ambiguous and would mix a user entry contract with low-level state transitions. An adapter-only fix also fails because a prompt cannot safely resolve a project started from `~`, and it would leave behavior dependent on Claude interpretation.

The revised thesis is a thin public adapter plus one internal preflight controller:

1. `/soma-run` is the only documented public entry for project-changing work.
2. The adapter consumes `$ARGUMENTS`, classifies the public form, and calls the installed CLI by absolute path. It stays below 8,000 UTF-8 bytes and does not contain the 10-step state machine.
3. `soma entry` is an internal machine preflight. It parses modes, resolves project and scope, adopts when required, and emits a deterministic JSON envelope.
4. Existing `soma run` verbs remain internal orchestration primitives. A new `handoff` verb joins that family because it persists run continuity.
5. Claude orchestrates only after the preflight returns `READY`, or after an exact resume confirmation returns `CONTINUE_READY`.

## Alternatives considered

### Adapter-only parsing

This is the smallest textual change, but it leaves root selection, legacy adoption and resume safety as instructions that Claude may improvise. It does not provide a reusable test boundary. Rejected.

### Dual-purpose `soma run`

This would add public forms alongside existing primitive verbs. It creates grammar collisions and turns a low-level API into a public workflow controller. Rejected.

### Thin adapter plus internal `soma entry`

This adds one focused CLI controller, reuses the installed absolute CLI path and leaves `soma run` compatible. It provides pure modules for argument parsing, project resolution and read-only card generation. Selected.

## Public contract

The only documented public forms are:

```text
/soma-run "objective" [--project <path>] [--scope <path>]
/soma-run --resume [runId] [--project <path>] [--scope <path>] [--handoff <path>]
/soma-run --status [--project <path>] [--scope <path>]
/soma-run --help
```

`/soma-run` must include `$ARGUMENTS`. It must not concatenate the objective into a shell program. It passes data as arguments to the internal Node CLI and invokes this fixed executable:

```bash
node "${SOMA_HOME:-$HOME/.soma-v2}/scripts/soma.cjs" entry ...
```

The `soma` command on `PATH` is never a prerequisite. `soma entry` is an internal adapter API and is not presented as another user workflow command.

The thin adapter handles parsing, preflight and mode routing. The single long orchestration source lives at `core/adapters/claude/references/soma-run-orchestration.md` and installs to `~/.claude/references/soma-run-orchestration.md`. Help, status and resume inspection return before that file is read. A start response of `READY`, or hook context containing `CONTINUE_READY`, authorizes one lazy read of the reference. No other repo file duplicates the state machine body.

## Architecture

### Entry parser

`core/scripts/entry/args.cjs` parses exactly one mode:

- `help`
- `status`
- `resume_inspect`
- `continue`
- `start`

Unknown flags, conflicting modes, missing flag values and invalid run IDs return exit 2 before project discovery. A normal objective is preserved as one UTF-8 string. No shell tokenization occurs inside the parser.

### Project and scope resolver

`core/scripts/entry/project.cjs` resolves paths without calling `process.chdir()`:

1. An explicit `--project` or a validated handoff `repo.root` has priority.
2. Otherwise the current Git top-level is used.
3. Without Git, the canonical cwd is accepted as a new project when it is a real directory, is neither filesystem root nor home, and is empty or contains a recognized project marker such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` or `.project`.
4. A resume run ID may use a handoff locator only when that locator points to a valid `soma-handoff/v2` whose repo path still contains the same handoff.
5. Any other cwd without an explicit project or handoff returns `PROJECT_UNRESOLVED`.

The resolver returns both `repoRoot` and `scopeRoot`. In a monorepo, a nested scope is accepted only when it matches a declared workspace or an explicit `--scope`. The filesystem root, the user's home directory and a path outside `repoRoot` are rejected. Symlinks are resolved before containment checks.

No mode performs a silent `cd`. Child processes receive an explicit `cwd`.

### Project inspection and adoption

`core/scripts/entry/adoption.cjs` classifies the observed project as `new`, `legacy`, `monorepo` or `installed`. `monorepo` describes structure; `adoption.previousState` records whether it was new or legacy.

When `.soma/install-state.json` is complete, inspection is read-only. When `.soma` is absent, `start` performs adoption through the existing project install/init components, then atomically writes `.soma/adoption.json`. The record contains:

- canonical repo and scope paths;
- classification and detection reasons;
- branch, HEAD and whether either is unavailable;
- porcelain dirty entries with working-tree hashes where readable;
- detected test command, budget classification and status `pending`, `not_run_budget` or `not_available`;
- existing specs, plans, task files, manifests and handoffs found before adoption;
- installed SOMA version and adoption timestamp.

Adoption never edits application source. It may create SOMA metadata and the existing anchored project bootloader through the established install path. It never claims earlier SOMA steps, decisions or proofs. A second adoption with the same observed state is byte-stable. If the pre-existing `.soma` is partial, corrupt or drifted, adoption stops with a diagnostic instead of overwriting it.

Adoption never executes a project script. It detects an argv array and records `pending` only when the command fits the baseline policy. Scripts that declare watch/dev/serve mode, Docker, browser E2E, integration infrastructure, or fan-out across more than eight workspaces are `not_run_budget`; missing commands are `not_available`. The first FOUNDATION executor invokes `soma run baseline --run <runId> --dispatch <dispatchId>`. The primitive verifies that the dispatch is active, runs the recorded argv with 120 seconds, 256 KiB of stdout and 256 KiB of stderr, writes `.soma/evidence/<runId>/baseline.json`, hashes it and appends the proof to run continuity. `soma entry` never calls this primitive. A failing, timed-out or budget-skipped baseline is pre-existing uncertainty and does not become a fabricated pass. A baseline that modifies tracked application files is a blocker and does not get cleaned automatically.

### Run context and ceremony

New runs keep `soma-state/v2` and add optional backward-compatible `entry` and `continuity` objects. Existing v2 files remain readable. `entry` stores objective, repo, scope, adoption snapshot and baseline. `continuity` stores task summaries, proofs, blocker and next action.

Small work may use a compressed specify, test, implement, validate and audit sequence. Work with multiple components, cross-package scope, migration, security, data, install or unclear blast radius uses the full SOMA sequence. This choice affects ceremony only. It never removes RED, focused GREEN, final validation or audit.

Agents perform implementation. The orchestrator resolves state, records dispatches, validates reports and coordinates transitions.

### Read-only status and resume

`status` reads install state, adoption, run states, reports and handoffs. It does not initialize, migrate, repair, lock, touch timestamps or create directories.

`resume_inspect` resolves an explicit run ID. If omitted, it selects the only non-terminal run in the resolved project. Zero or multiple candidates produce a diagnostic. It normalizes old v2 state in memory, reuses the evidence ordering from `run/resume.cjs`, and emits a short card containing:

- project, repo root and scope;
- branch and current SHA;
- run ID and last safe state;
- tasks and attempts;
- dirty files and hashes;
- proofs and their artifact hashes;
- blocker and next action;
- exact confirmation `CONTINUAR <runId>`.

Inspection does not write any file and does not create a lock or agent. The follow-up is enforced by `core/hooks/resume-confirmation-gate.cjs`, a `UserPromptSubmit` hook. It reacts only when the complete trimmed prompt matches `^CONTINUAR (run-[a-z0-9-]+)$`. The hook invokes the absolute installed `soma.cjs entry --continue --run <runId>` through `spawnSync` arguments and forwards the project locator. On exit 0, its additional context contains the unchanged `CONTINUE_READY` payload, the installed orchestration reference path and an instruction to read that reference before any dispatch. Any parse, resolution, drift or CLI failure blocks the prompt before Claude can mutate or create an agent. Before mutation, `continue` repeats repo, branch, SHA and dirty-hash checks. Drift returns `RESUME_DRIFT` and a new card. Only a matching hook and preflight may recreate the run lock, persist the reentry transition and dispatch agents.

### Structured handoff

`soma run handoff --run <runId>` builds two siblings inside one immutable generation directory:

```text
.soma/handoffs/<runId>/<handoffId>/handoff.json
.soma/handoffs/<runId>/<handoffId>/handoff.md
```

The writer creates and validates both files in a sibling temporary directory, then publishes the generation with one directory rename. Existing generations are immutable. Resume chooses the newest schema-valid generation by `createdAt`, not a mutable pointer. The files are intentionally not ignored. The writer never stages, commits, pushes or otherwise changes the Git index. It reports each artifact as `tracked`, `modified`, `untracked` or `non_git`, so STEP_10 can make the normal commit decision. Project-resident atomic files survive sessions without contaminating an unrelated commit.

The JSON is canonical. Markdown is derived from it and carries all information that restricts the next action inline. Informative details may remain path references. The writer refuses a handoff if required proofs are temporary-only, a declared agent is neither closed nor explicitly active, or dirty hashes cannot be represented honestly.

The existing `/handoff` adapter has one routing rule. With an active SOMA run, resolved from explicit `--run` or a valid `.soma.lock`, it must call `soma run handoff` and may not write a second continuation ledger. Without an active run, it may keep the current general session handoff, but its header must mark `$schema: soma-handoff/legacy`, `resumable_by_soma_run: false`, and it must stay outside `.soma/handoffs/`. `/soma-run --resume` never treats a legacy handoff as run evidence.

## State transitions

```text
HELP -> HELP_SHOWN
STATUS -> PROJECT_RESOLVED -> STATUS_SHOWN

START -> PROJECT_RESOLVED -> PROJECT_INSPECTED
      -> ADOPTION_REQUIRED -> ADOPTING -> ADOPTED
      -> RUN_INITIALIZED -> READY -> SOMA_FLOW

RESUME_INSPECT -> PROJECT_RESOLVED -> RUN_RESTORED_READ_ONLY
               -> AWAITING_CONTINUE
               -> exact CONTINUAR <runId>
               -> RESUME_PREFLIGHT
               -> CONTINUE_READY -> SOMA_FLOW

RESUME_PREFLIGHT -> RESUME_DRIFT -> AWAITING_CONTINUE
```

`HELP_SHOWN`, `STATUS_SHOWN`, `RUN_RESTORED_READ_ONLY`, `AWAITING_CONTINUE` and `RESUME_DRIFT` are non-mutating states. No agent may exist before `READY` or `CONTINUE_READY`.

## Schemas

### Adoption

```json
{
  "$schema": "soma-adoption/v1",
  "project": {
    "repoRoot": "/abs/repo",
    "scopeRoot": "/abs/repo/packages/app",
    "classification": "monorepo",
    "previousState": "legacy",
    "reasons": ["git-root", "package-workspaces"]
  },
  "git": {
    "branch": "main",
    "headSha": "40-hex-sha",
    "dirty": [{"path": "src/a.js", "status": " M", "sha256": "64-hex-or-null"}]
  },
  "baseline": {
    "command": ["npm", "test", "--", "--runInBand"],
    "status": "pending",
    "budget": {"timeoutMs": 120000, "maxOutputBytesPerStream": 262144},
    "exitCode": null,
    "capturedAt": "ISO-8601"
  },
  "existingArtifacts": ["docs/spec.md"],
  "installedVersion": "2.3.0",
  "adoptedAt": "ISO-8601"
}
```

`branch`, `headSha`, `sha256`, `command` and `exitCode` may be null only when the corresponding facility is unavailable or pending. Adoption-time `baseline.status` is `pending`, `not_run_budget` or `not_available`; FOUNDATION proof status is `pass`, `fail` or `timeout`.

### Handoff

```json
{
  "$schema": "soma-handoff/v2",
  "schemaVersion": 2,
  "createdAt": "ISO-8601",
  "repo": {
    "root": "/abs/repo",
    "scope": "/abs/repo",
    "branch": "main",
    "headSha": "40-hex-sha"
  },
  "dirty": {
    "capturedAt": "ISO-8601",
    "files": [{"path": "src/a.js", "status": " M", "worktreeSha256": "64-hex-or-null", "indexBlob": "40-hex-or-null"}]
  },
  "run": {
    "id": "run-260825-1200-a1b2c3",
    "step": "STEP_5_VALIDATE",
    "lastSafeState": "STEP_4_WAVES",
    "tasks": [{"id": "T-01", "status": "blocked", "attempt": 2}]
  },
  "proofs": [{"kind": "test", "command": "node --test test.cjs", "status": "fail", "exitCode": 1, "path": "evidence/test.log", "sha256": "64-hex"}],
  "agents": {
    "declared": [{"id": "worker-1", "role": "executor", "task": "T-01"}],
    "closed": ["worker-1"],
    "active": []
  },
  "pause": {
    "reason": "correction exhausted",
    "blocker": {"code": "TEST_FAILURE", "summary": "one focused test still fails", "evidenceRefs": ["evidence/test.log"]},
    "nextDecision": "accept a scope change or stop the run"
  },
  "resume": {
    "command": "/soma-run --resume run-260825-1200-a1b2c3 --project /abs/repo",
    "confirmation": "CONTINUAR run-260825-1200-a1b2c3"
  },
  "artifacts": {
    "jsonTracking": "untracked",
    "markdownTracking": "untracked"
  }
}
```

## Invariants

1. `/soma-run` is the only documented public command that starts or resumes project mutation.
2. Help, status and resume inspection cause zero filesystem, Git, process-lock and agent mutation.
3. Every mutating child process receives an explicit validated `cwd`.
4. Home, filesystem root, unresolved paths and ambiguous monorepo scopes fail closed.
5. Adoption writes SOMA metadata only, never executes project scripts and never invents completed steps, history or evidence.
6. Resume evidence comes from durable reports and handoff data. Prose never upgrades a failed or absent proof to pass.
7. No resume mutation or agent creation occurs before exact confirmation and a fresh drift preflight.
8. JSON handoff validates before Markdown is published. Both represent the same snapshot.
9. Handoff artifacts do not live in temporary or ignored paths, and the writer does not mutate the Git index.
10. Existing project install and global install ownership remain separate.
11. Installed adapter and core CLI update in the same existing global transaction.
12. Normal `/soma-run "objective"` behavior remains available after adding flags.

## Failure modes

| Failure | Required result |
|---|---|
| Unknown or conflicting flags | `INVALID_ENTRY_ARGS`, exit 2, no project access |
| Started from `~` without project or handoff | `PROJECT_UNRESOLVED`, no `cd`, no write |
| Explicit path outside allowed repo scope | `PROJECT_SCOPE_INVALID`, no write |
| Monorepo scope not declared or ambiguous | `MONOREPO_SCOPE_AMBIGUOUS`, show valid scopes |
| Partial, corrupt or drifted `.soma` | `ADOPTION_BLOCKED`, preserve bytes |
| Test baseline unavailable | record `not_available`, do not fabricate pass |
| Test baseline exceeds policy before execution | record `not_run_budget`; do not execute it during adoption |
| FOUNDATION baseline exceeds runtime budget | executor stops it at 120 seconds or output limit and persists `timeout` proof |
| Missing resume run | `NO_SUCH_RUN`, read-only |
| Multiple runs and omitted run ID | `RUN_AMBIGUOUS`, list IDs, read-only |
| State/report disagreement | report warning and trust latest durable report |
| Branch, SHA or dirty hash changed after card | `RESUME_DRIFT`, no mutation |
| Confirmation differs by any character | remain `AWAITING_CONTINUE` |
| Confirmation hook cannot resolve or verify the run | block `UserPromptSubmit`; Claude receives no mutation authorization |
| Temporary-only critical proof | `HANDOFF_NOT_DURABLE`, no partial pair |
| Handoff pair or schema mismatch | `CORRUPT_HANDOFF`, no resume |
| Installed core missing | diagnostic names `~/.soma-v2/scripts/soma.cjs`; never suggest a nonexistent shim |

## Compatibility and migration

- Keep every existing `soma run` verb and CLI form. Add `handoff`; do not rename `resume` or change `--run` for the primitive.
- Read old `soma-state/v2` without rewriting it in status or resume. Optional fields appear only on new writes or post-confirmation updates.
- Keep project install at `<project>/.soma/install-state.json` and global install at `~/.soma-v2/.soma/install-state.json`.
- Update the existing Claude `kind:"file"` target. Do not add a Claude plugin or `/soma:run` alias.
- Install the orchestration reference as one `kind:"file"` target. The adapter and reference must update or roll back in the same global transaction.
- Run global transaction tests to prove the adapter and CLI core update together and rollback together.
- Replace current documentation references to `/soma:run` with `/soma-run`. Historical specs remain historical evidence and are not rewritten.
- Update architecture documentation that still claims run state lives only under a temporary directory.
- The branch inherits the planned RED from spec 024 for missing `operator-gate.cjs` through commits `1cbebb4` and `b3a4997`. This feature uses a delta gate: its focused suites must pass and the full suite may contain only the captured pre-existing failure set. Implementing spec 024 is outside this scope.

## Acceptance criteria

### AC-01: Public parsing is deterministic

Given each supported `/soma-run` form, when the adapter and entry parser receive it, then help, status, resume, continue and normal objective select one mode, while unknown or conflicting input fails before project discovery.

### AC-02: Help and status are read-only

Given a filesystem snapshot, when `--help` or `--status` runs, then bytes, mtimes, Git index, locks and agent records remain identical.

### AC-03: Resume requires an exact handshake

Given a resumable run, when `--resume` runs, then it emits the required card and creates no file, lock or agent. Only exact `CONTINUAR <runId>` permits a mutating preflight.

### AC-04: Resume detects drift

Given a card followed by a branch, SHA or dirty-file hash change, when exact confirmation arrives, then resume returns `RESUME_DRIFT` and performs no mutation.

### AC-05: Adoption covers new and legacy projects

Given an empty or marker-bearing non-home directory without Git, or a legacy Git project without `.soma`, when a normal objective starts, then adoption records classification, paths, branch, HEAD, dirty state, a pending or budget-classified baseline and existing artifacts without executing project scripts, modifying application source or inventing history.

### AC-06: Adoption is idempotent and fail-closed

Given an unchanged adopted project, when start runs again, then adoption bytes do not change. Partial, corrupt or drifted SOMA state blocks without overwrite.

### AC-07: CWD and monorepo scope are protected

Given a session in home, an invalid nested path or ambiguous workspace, when entry resolves the project, then it stops with a readable diagnostic. Explicit valid repo and workspace paths succeed without silent `cd`.

### AC-08: Handoff is structured and durable

Given a paused run, when handoff is emitted, then validated JSON and derived Markdown contain repo, branch, SHA, dirty hashes, run, step, tasks, proofs, agents, pause reason, blocker, next decision, Git tracking status and canonical resume command. No required proof points only to temporary or ignored storage, and the Git index remains byte-identical.

### AC-09: Install and live sync stay transactional

Given global install from any worktree, when the changed adapter, orchestration reference and CLI are activated, then all match the candidate source and share the existing transaction. Fault injection restores every pre-state.

### AC-10: Normal command regresses neither behavior nor ceremony

Given `/soma-run "objective"` in an installed project, when preflight succeeds, then the run reaches `READY`, lazy-loads the orchestration reference, chooses compressed or full ceremony from declared risk, and delegates the pending baseline plus all project mutation to agents.

### AC-11: Current documentation uses the canonical name

Given current README and user documentation, when scanned outside historical specs and snapshots, then `/soma:run` has zero occurrences and `/soma-run` is documented as the public entry.

### AC-12: Scope stays bounded

The implementation adds no Claude plugin, daemon, external dependency, PATH shim, automatic third attempt, application-code adoption write or rewrite of historical specs.

### AC-13: The long state machine loads lazily within budget

Given help, status or resume inspection, when `/soma-run` routes the request, then the adapter is at most 8,000 UTF-8 bytes and does not read the orchestration reference. Given `READY` or `CONTINUE_READY`, it reads the single installed reference before orchestration. The reference has one repo source and updates transactionally with the adapter.
