# Claude Session Identity Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export Claude's authoritative SessionStart `session_id` into later Bash calls so `/soma-run` can use its existing fail-closed native mailbox path.

**Architecture:** Extend the existing `session-init.cjs` hook before any fallible project/config work. Validate the hook input with the runtime's exact session-ID predicate, append `CLAUDE_SESSION_ID` through `writeEnv`, and preserve fail-closed behavior when identity or `CLAUDE_ENV_FILE` is unavailable. No new hook or fallback identity channel.

**Tech Stack:** Node.js CommonJS, `node:test`, Claude Code SessionStart hooks, transactional SOMA installer.

---

## Files and ownership

- Create `core/hooks/__tests__/session-init-identity.test.cjs`: focused black-box hook, validator-parity and native-entry integration proofs.
- Modify `core/hooks/session-init.cjs`: early validated identity export and stable nonblocking diagnostics.
- Reuse `core/hooks/lib/ck-config-utils.cjs`: existing shell-escaping `writeEnv`; no change expected.
- Reuse `core/scripts/entry/request-schema.cjs`: authoritative `isSessionId` oracle; no change expected.
- Reuse `core/adapters/claude/install-targets.json`: existing whole-file install target; no new target.
- Update `docs/superpowers/reports/2026-08-27-soma-universal-entry-lean-result.md`: final proof and activation record.

### Task 1: RED identity propagation contract

**Files:**
- Create: `core/hooks/__tests__/session-init-identity.test.cjs`
- Read: `core/hooks/session-init.cjs`
- Read: `core/scripts/entry/request-schema.cjs`

- [ ] **Step 1: Add a black-box hook harness**

Use `node:test`, `assert/strict`, `spawnSync`, `mkdtempSync`, and a temporary `CLAUDE_ENV_FILE`. The helper must invoke the real hook with JSON on stdin and a minimal fake `HOME`, then return exit code, stderr, env-file bytes and fixture paths. It must not inject `CLAUDE_SESSION_ID` itself.

```js
function runSessionInit({ sessionId, source = 'startup', includeEnvFile = true, prelude = '' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-session-identity-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  const envFile = path.join(root, 'claude-env.sh');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  if (includeEnvFile) fs.writeFileSync(envFile, prelude);
  const input = { hook_event_name: 'SessionStart', source, session_id: sessionId, cwd };
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_SESSION_ID;
  if (includeEnvFile) env.CLAUDE_ENV_FILE = envFile;
  else delete env.CLAUDE_ENV_FILE;
  const result = spawnSync(process.execPath, [HOOK], {
    cwd, env, input: JSON.stringify(input), encoding: 'utf8', timeout: 10_000,
  });
  return { root, cwd, envFile, result, bytes: includeEnvFile ? fs.readFileSync(envFile, 'utf8') : '' };
}
```

- [ ] **Step 2: Add AC-01 lifecycle propagation tests**

For `startup`, `resume`, `clear`, and `compact`, pass `A._:-z`, source the produced file with `/bin/sh`, and assert the effective value is exactly `A._:-z`.

```js
const probe = spawnSync('/bin/sh', ['-c', `. "$1"; printf %s "$CLAUDE_SESSION_ID"`, 'sh', run.envFile], { encoding: 'utf8' });
assert.equal(probe.status, 0);
assert.equal(probe.stdout, 'A._:-z');
```

- [ ] **Step 3: Add AC-02 parity and injection corpus**

Import `isSessionId` as the oracle. Cover valid one-byte and 128-byte IDs plus empty/non-string, leading punctuation, slash, backslash, whitespace, quote, backtick, dollar, `$()`, semicolon, CR/LF, Unicode and 129-byte inputs. For every rejected value, assert the hook appends no `CLAUDE_SESSION_ID` and emits only the stable invalid diagnostic for identity export.

- [ ] **Step 4: Add AC-03 and AC-04 failure semantics**

Preload `export CLAUDE_SESSION_ID="stale"`, invoke once with `current`, source the file and assert `current`. Invoke three times and assert the effective value remains `current`. Without `CLAUDE_ENV_FILE`, assert exit `0`, exact `CLAUDE_ENV_FILE_MISSING`, and no fallback identity file under the fixture. With missing/invalid identity, assert exact `INVALID_SESSION_ID` takes precedence.

- [ ] **Step 5: Add AC-05 native integration**

Source only the hook-produced env file, then run the real `soma.cjs entry native prepare`; assert `REQUEST_PREPARED`. Run native abort with the same environment; assert `REQUEST_ABORTED` and no mailbox residue. Use a fixture-specific `SOMA_ENTRY_ROOT` only for containment, never as identity.

- [ ] **Step 6: Run RED and record the expected cause**

Run:

```bash
node --test core/hooks/__tests__/session-init-identity.test.cjs
```

Expected: lifecycle/stale/native tests fail because the hook does not export `CLAUDE_SESSION_ID`; invalid/env-file diagnostics are absent. Test harness errors are not acceptable RED.

### Task 2: Minimal hook implementation and GREEN

**Files:**
- Modify: `core/hooks/session-init.cjs` in `main()`, immediately after stdin parsing
- Test: `core/hooks/__tests__/session-init-identity.test.cjs`

- [ ] **Step 1: Add the exact local predicate and exporter**

Add near the hook helpers:

```js
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isValidSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function exportClaudeSessionIdentity(sessionId, envFile) {
  if (!isValidSessionId(sessionId)) {
    console.error('SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=INVALID_SESSION_ID');
    return false;
  }
  if (typeof envFile !== 'string' || envFile.length === 0) {
    console.error('SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=CLAUDE_ENV_FILE_MISSING');
    return false;
  }
  try {
    writeEnv(envFile, 'CLAUDE_SESSION_ID', sessionId);
    return true;
  } catch (_) {
    console.error('SOMA_SESSION_IDENTITY_NOT_EXPORTED reason=ENV_WRITE_FAILED');
    return false;
  }
}
```

- [ ] **Step 2: Call it before fallible work**

Immediately after parsing stdin and reading `envFile`/`sessionId`, call:

```js
exportClaudeSessionIdentity(sessionId, envFile);
```

This call must precede `loadConfig()`, reset markers, project detection, Git/Python probes and session-state writes. Do not return early; existing non-identity hook behavior continues.

- [ ] **Step 3: Run focused GREEN**

```bash
node --test core/hooks/__tests__/session-init-identity.test.cjs
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 4: Run affected hook and native-entry regression suites**

```bash
node --test \
  core/hooks/__tests__/session-init-identity.test.cjs \
  core/scripts/__tests__/entry-cli.test.cjs \
  core/scripts/__tests__/entry-mailbox.test.cjs \
  core/scripts/__tests__/entry-resume-lean.test.cjs \
  core/scripts/__tests__/universal-entry-lean-adapter.test.cjs
```

Expected: zero failures. If a historical test fails, reproduce it on `17932dc` before classifying it.

- [ ] **Step 5: Commit the implementation unit**

```bash
git add core/hooks/session-init.cjs core/hooks/__tests__/session-init-identity.test.cjs
git commit -m "fix(hooks): export Claude session identity"
```

### Task 3: Install parity and zero-model proof

**Files:**
- Modify only if coverage is absent: `core/scripts/__tests__/universal-entry-lean-e2e.test.cjs`
- Read: `core/adapters/claude/install-targets.json`
- Read: installer/fake-home helpers

- [ ] **Step 1: Prove AC-06 in the fake-home installer E2E**

Install twice into the test home. After each install, compare source and `~/.claude/hooks/session-init.cjs` bytes. Parse settings and assert exactly one `_soma_managed: true` SessionStart entry for the existing matcher/command; do not assert unmanaged entries were removed.

- [ ] **Step 2: Run the bounded installer and manifest suites**

```bash
node --test \
  core/scripts/__tests__/universal-entry-lean-e2e.test.cjs \
  core/scripts/__tests__/install-targets-set.test.cjs \
  core/scripts/__tests__/manifest-baseline.test.cjs
```

Expected: zero failures and no supported manifest mutation. If the supported manifest checker requests a hash refresh for the changed hook, use only its scoped baseline command and verify immutable source hashes remain unchanged.

- [ ] **Step 3: Run AC-07 without a model call**

Create an isolated Claude config/settings fixture whose only SessionStart hook command is the candidate source hook, then run bounded `claude --init-only` startup and resume flows. Capture hook events/debug output and the generated env-file contents. Assert each exported value equals that invocation's hook `session_id`. Do not use `claude -p`, send a prompt or globally install.

- [ ] **Step 4: Commit any test-only parity addition**

If Step 1 required a test edit:

```bash
git add core/scripts/__tests__/universal-entry-lean-e2e.test.cjs
git commit -m "test(hooks): prove installed identity export parity"
```

Otherwise leave the implementation commit unchanged.

### Task 4: Immutable-candidate review and deterministic verification

**Files:** no edits by reviewers.

- [ ] **Step 1: Freeze one candidate SHA and diff-check it**

```bash
git diff --check 17932dc..<candidate>
git status --short
```

Expected: clean tracked worktree; `.soma/` may remain untracked.

- [ ] **Step 2: Run the repository's established bounded final verification**

Reuse the previously successful detached/bounded runner recorded in `docs/superpowers/reports/2026-08-27-soma-universal-entry-lean-result.md`; do not invoke the wildcard suite known to hang in historical doctor/sync children. Compare baseline and candidate counts and prove zero unexpected/removed tests.

- [ ] **Step 3: Spec review, then quality review**

Dispatch independent read-only reviewers against the same candidate. Spec review maps AC-01..AC-07 to code/proofs. Quality review pressures hook ordering, injection, env-write failure, duplicate exports, lifecycle semantics, install parity and test validity. Any Critical/Important finding rejects the candidate; implementer gets at most one correction.

### Task 5: Transactional activation and AC-08

**Files:**
- Update: `docs/superpowers/reports/2026-08-27-soma-universal-entry-lean-result.md`
- Installed target: `~/.claude/hooks/session-init.cjs` through installer only

- [ ] **Step 1: Activation preflight**

Confirm no active user Claude CLI, no pending installer transaction/pointer/lock, candidate/source parity and clean installer syntax. Never kill a user process.

- [ ] **Step 2: Run one transactional corrective install**

```bash
bash install.sh --force-overwrite
```

Expected: transaction `COMMITTED`, recovery `NONE`, installed hook hash equals candidate source, sync dry-runs and doctor pass.

- [ ] **Step 3: Run one bounded interactive acceptance session**

Launch Claude normally in a temporary Git project and invoke exactly `/soma-run --help`. Capture the transcript/debug evidence. Success requires command discovery, zero permission denials, native prepare, scoped Write, native consume/cleanup and terminal `HELP_SHOWN` with no adoption/run/mailbox residue.

- [ ] **Step 4: Probe subagent inheritance in the same session**

Dispatch one minimal subagent whose only action is reporting whether its Bash `CLAUDE_SESSION_ID` equals the parent session identity captured from SessionStart. Do not print unrelated environment values. Equality is required for AC-08; otherwise stop with evidence and do not claim subagent support.

- [ ] **Step 5: Report, commit and publish continuity**

Record deterministic tests, reviewers, transaction ID/hashes, transcript path, lifecycle/subagent result and residuals in the durable report. Commit only tracked report/plan changes, transition the run to `DONE` only if every AC passed, then publish a new checkpoint and handoff. On activation/smoke failure, use supported rollback if needed and publish `PAUSED_DIAGNOSTIC`; never repeat the smoke to force green.
