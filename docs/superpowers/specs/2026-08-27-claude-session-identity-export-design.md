# Claude session identity export design

**Status:** approved design

## Goal

Make Claude's authoritative SessionStart identity available to later Bash calls as `CLAUDE_SESSION_ID`, so the existing native `/soma-run` mailbox path can prepare, consume and abort requests without inventing a session identity.

This is a narrow hook change. It does not change mailbox identity, run identity, public command grammar or Claude settings topology.

## Problem and evidence

The installed `/soma-run` command is discoverable in both an interactive Claude session and `claude -p`. Both modes reach the fixed native preparation command. Neither observed run had a permission denial. Both failed before mailbox creation with:

```text
INVALID_SESSION_ID: CLAUDE_SESSION_ID is required and must be valid
```

The failure is an environment propagation gap. `core/scripts/entry.cjs` correctly requires `CLAUDE_SESSION_ID` and validates it through `isSessionId`. The Bash process did not receive that variable. Claude's SessionStart input already supplies `data.session_id`, and Claude supplies `CLAUDE_ENV_FILE` so a SessionStart hook can append exports for subsequent Bash calls.

The current product already has the correct lifecycle hook. `core/hooks/session-init.cjs` runs for the `startup|resume|clear|compact` matcher, reads `data.session_id`, reads `CLAUDE_ENV_FILE` and uses `writeEnv` for later exports. The missing operation is an early, validated export of the native Claude identity.

Verified facts in this design are the observed failures, the zero permission denials, the current hook and installer wiring, and the runtime validator. Lifecycle behavior not yet exercised locally, especially subagent inheritance, remains a proof obligation in the acceptance criteria.

## Chosen architecture

Extend `core/hooks/session-init.cjs`. Do not add another hook.

Immediately after parsing SessionStart stdin and reading `data.session_id` and `process.env.CLAUDE_ENV_FILE`, the hook shall:

1. validate `data.session_id` with the runtime's exact predicate;
2. append `CLAUDE_SESSION_ID` to `CLAUDE_ENV_FILE` through the existing `writeEnv` helper when both values are available;
3. do this before `loadConfig`, project detection, Git inspection, Python detection, reset-marker writes, plan resolution or any other fallible work.

The exact predicate is:

```js
typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
```

The hook may keep a local predicate to avoid changing installed module boundaries, but tests must compare it with `isSessionId` from `core/scripts/entry/request-schema.cjs` over the full acceptance corpus. The implementation must not introduce a broader or narrower alphabet, normalize the value or trim it.

For a valid identity, the existing helper appends the shell assignment in this form:

```sh
export CLAUDE_SESSION_ID="<validated-session-id>"
```

No hook output or persistent SOMA file stores a second identity source. The export prepares the environment of later Bash calls; it does not replace SessionStart input as the authority.

## Fail-closed behavior and diagnostics

The hook remains nonblocking and exits `0` in all identity-export cases.

- Missing or invalid `data.session_id` appends no `CLAUDE_SESSION_ID` line and emits exactly `SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID` on stderr.
- Missing or empty `CLAUDE_ENV_FILE` appends nothing and emits exactly `SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=CLAUDE_ENV_FILE_MISSING` on stderr.
- An append failure emits `SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=ENV_WRITE_FAILED` through the hook's nonblocking error path and does not set an in-process fallback.

Identity validation precedes the env-file check. If both inputs are missing or invalid, the hook emits only the `INVALID_SESSION_ID` diagnostic.

Diagnostics must not include the rejected identity, env-file path, transcript path or inferred replacement. Existing hook work may continue after an invalid identity or absent env file, but the native mailbox path must still fail closed when later Bash lacks a valid `CLAUDE_SESSION_ID`.

## Lifecycle semantics

Every invocation uses the current hook input. The implementation shall not cache, recover or preserve an earlier value itself.

- `startup` exports the startup input identity before later Bash calls.
- `resume` exports the identity Claude supplies for the resumed session. This preserves identity only because the authority supplied it again; SOMA does not recover it from prior state.
- `clear` exports the new input identity and overrides any stale value already present in the env file. It must not retain the pre-clear identity.
- `compact` re-exports the current input identity. It neither rotates nor reconstructs identity.
- `claude -p` is supported through the same SessionStart contract. There is no print-mode fallback.

Subagent availability of the variable is not assumed from parent-session behavior. Acceptance requires a bounded real subagent probe. Until that probe passes, implementation may claim parent-session and `claude -p` support only.

## Security invariants

1. SessionStart `data.session_id` is the sole identity authority for this export.
2. Model text, PID, parent PID, cwd, project path, time, transcript filename, transcript contents, mailbox enumeration and prior env-file contents are forbidden identity sources.
3. The exact validator excludes quotes, backticks, dollar signs, command substitutions, whitespace, line breaks, backslashes and shell separators. This makes the existing double-quoted `writeEnv` export safe for the accepted value.
4. A pre-existing stale `CLAUDE_SESSION_ID` line is not authority. The validated current export is appended later, so normal shell evaluation leaves the current hook input effective.
5. Repeating the same hook invocation may append the same export more than once. The effective shell value must remain identical. Correctness must not depend on cross-process deduplication or line uniqueness.
6. Invalid input, a missing env file or a write error never creates an alternate identity channel.

## Scope exclusions

This change does not:

- add a dedicated SessionStart hook;
- add a runtime, mailbox or CLI fallback;
- infer identity from process or filesystem state;
- change the mailbox schema, request identifiers, run identifiers or continuity artifacts;
- clean up unmanaged duplicate `settings.json` entries;
- change the `startup|resume|clear|compact` matcher or other hook registration;
- claim subagent support without the required live proof.

Unmanaged duplicate settings entries are operational debt. If they invoke the same hook with the same authoritative input, duplicate identical exports are harmless. Removing those entries is a separate change with separate rollback risk.

## Acceptance criteria

The implementation must pass these criteria in order. Deterministic tests precede any Claude smoke.

1. **AC-01, RED hook-to-env propagation.** A new focused hook test shall first fail against the current hook. For each source `startup`, `resume`, `clear` and `compact`, invoke `core/hooks/session-init.cjs` with a temporary home, cwd and env file plus valid edge identity `A._:-z`. Source the resulting env file in `/bin/sh` and assert that `CLAUDE_SESSION_ID` is exactly `A._:-z`.

2. **AC-02, validator parity and injection rejection.** Run the hook predicate and runtime `isSessionId` over the same corpus and assert identical results. The corpus must include a one-character ID, a 128-character valid ID, empty and non-string values, a leading punctuation mark, slash, backslash, space, tab, quote, backtick, dollar sign, `$()`, semicolon, newline, carriage return, Unicode and a 129-character value. Every rejected value must append no identity export.

3. **AC-03, stale and duplicate export semantics.** Preload the env file with a different valid `CLAUDE_SESSION_ID`, invoke the hook and source the file. The current hook input must win. Invoke the hook three times with the same input and assert the effective value remains exact. The test shall not require only one export line.

4. **AC-04, env-file absence.** Invoke the hook without `CLAUDE_ENV_FILE` and with a valid identity. It must exit `0`, emit the exact `CLAUDE_ENV_FILE_MISSING` diagnostic and create no fallback identity file. Repeat with invalid and missing identity and assert the exact `INVALID_SESSION_ID` diagnostic and no identity export.

5. **AC-05, native prepare and abort integration.** Source the env file produced by SessionStart, run `entry native prepare` and assert `REQUEST_PREPARED`. Run native abort in the same environment, assert `REQUEST_ABORTED`, and prove that no request residue remains. The test must use the propagated value rather than injecting `CLAUDE_SESSION_ID` directly into the entry command.

6. **AC-06, fake-home install parity and idempotence.** Install into a fake home twice. After each run, the installed `~/.claude/hooks/session-init.cjs` must be byte-identical to the source. The second install must add no managed SessionStart entry, and settings must contain exactly one `_soma_managed: true` entry for the existing matcher and command. Unmanaged entries remain untouched.

7. **AC-07, zero-model initialization proof.** With the candidate installed in an isolated home, run bounded `claude --init-only` startup and resume cases. Capture the SessionStart input and env-file result without requesting a model response. Each case must exit successfully and prove that the exported value equals that invocation's `session_id`. Synthetic focused tests remain the deterministic proof for clear and compact.

8. **AC-08, one bounded interactive smoke.** Only after AC-01 through AC-07 pass, run one controlled interactive Claude session. `/soma-run --help` must discover the installed command, report zero permission denials, complete native prepare and abort cleanup, and finish with `HELP_SHOWN`. In the same bounded session, run one minimal subagent probe and assert that its Bash environment contains the exact current parent `CLAUDE_SESSION_ID`. If that equality is not observed, subagent support remains unaccepted and the implementation is not complete.

No repeated live smoke is authorized to turn an inconclusive result green. Diagnose a failure with captured evidence and return to deterministic tests or the design decision.

## Rollback

The implementation changes the existing source hook, its focused tests and install verification only. The existing install target already owns `~/.claude/hooks/session-init.cjs`; no new settings entry or installed path is needed.

Activation shall use the existing transactional installer and its source-to-installed parity check. If activation or either bounded proof fails, restore the prior installed hook through that transaction. Rollback requires no mailbox migration, settings cleanup or continuity rewrite. It restores the old behavior, including the known lack of `CLAUDE_SESSION_ID` in later Bash for affected modes.

## Continuity impact

This export supplies a missing prerequisite to the current continuity design. Native prepare, consume and abort continue to bind requests to Claude's validated session identity. Resume and compact take the identity from the current SessionStart event; clear replaces it with the new event identity. No SOMA run, checkpoint, handoff, lock or report changes ownership because of this hook.

The counterexample that constrains the design is an absent env file during resume. Even if a prior run or transcript exposes a plausible identifier, SOMA must not recover it. The resumed native entry remains unavailable until Claude provides both authoritative hook input and the env-file channel.

## Challenge pass

The first thesis was that exporting `data.session_id` anywhere in the existing hook would close the gap. That is too weak. `loadConfig`, project detection and external command probes can fail or delay the hook before the current env-writing block, leaving the native command broken even though SessionStart supplied the identity.

The revised design places the validated export immediately after input parsing and before fallible work. It also treats duplicate invocation as shell-equivalent append behavior instead of adding shared deduplication state. A stale line is defeated by ordering, while an invalid current value cannot authorize reuse of the stale one.

The remaining uncertainty is host propagation into real subagents. Parent-session success does not falsify a subagent-specific environment boundary. AC-08 therefore makes equality in a live bounded probe a release condition instead of a documentation claim.
