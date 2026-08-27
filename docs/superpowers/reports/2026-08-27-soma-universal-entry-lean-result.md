# SOMA universal entry — residual continuity correction approved

Date: 2026-08-27

## Immutable candidate and reviews

- Final code SHA: `20b29c27c4bba5bebb5b9446a967c41cc9930372` (`fix(continuity): harden durable authority boundaries`).
- Specification review: **APPROVED** for this exact SHA.
- Independent quality/security review: **APPROVED** for this exact SHA; no Critical or Important findings.
- Correction RED/GREEN: 32/35 RED for the three residual cases (symlinked durable ancestor, governing durable `/tmp` authority, and unlabeled legacy context), then 35/35 GREEN.

## Fresh final verification

- Focused entry/protocol/subagent proof: 35 passed, 0 failed.
- Fresh entry/protocol/subagent vertical: 89 passed, 0 failed.
- Fresh affected callable-installer vertical: 7 passed, 0 failed.
- Manifest hash/provenance suite: 20 passed, 0 failed. `manifest baseline --dry-run --json` reported the expected `soma-manifest-baseline/v1` schema.
- `git diff --check 3ea55b25ee99f353b2e26c639803e2e721320ad1 20b29c27c4bba5bebb5b9446a967c41cc9930372` was clean.
- The known isolated doctor assertion was not rerun; it is independently identical at 10/11 for `8032599` and `20b29c2`.

## Structured inherited-failure baseline

The required full command was run once in a fresh detached worktree at the final code SHA:

```text
node --test --test-reporter=junit core/scripts/__tests__/*.test.cjs core/hooks/__tests__/*.test.cjs
```

It exited 1 with 57 inherited failures. The detached worktree was removed after capture. The unchanged approved base JUnit and new final JUnit were both parsed with `core/scripts/test/junit-failure-set.cjs` from `20b29c2`; full identity comparison is `(file, fullName, errorName, message, failureSha256)`.

| Evidence | Exit | Failures | SHA-256 |
| --- | ---: | ---: | --- |
| Base JUnit: `.soma/baselines/universal-entry-lean-strict-base.junit.xml` | 1 | 57 | `796edf6f8b24cd818acd81f3df79c93188d661029930476f8330434007b12edd` |
| Final JUnit: `.soma/baselines/universal-entry-lean-residual-final.junit.xml` | 1 | 57 | `4e175e2b09e5b206a1de903e2a1418762e88dff8ec76e3078870120cf287da1c` |

- Parsed evidence: `.soma/baselines/universal-entry-lean-residual-{base,final}.json`.
- Baseline delta: **0 unexpected final failures; 0 removals**.
- Parsed JSON SHA-256: base `6e4057ab65bfe2fd67ab742df90a1ac711489ee9307527a8e7f59517f5463c7f`; final `708239b7ce944eb20ce53a628a0ad03eca41c4fcf716bab8d944efb780f2f4b6`.

## Accepted non-blocking findings

The quality review recorded and accepted these three minors:

1. Raw `ENOTDIR` classification remains unrefined.
2. Test snapshot symlink visibility could be more explicit.
3. One ordering assertion is narrower than ideal.

They do not affect the fail-closed durable-identity behavior, immutable source provenance, or executor-owned rollback contract verified above.

## Activation and transaction status

Live activation ran once on 2026-08-27 after fresh preflight. `bash -n install.sh` and `bash install.sh --dry-run --force-overwrite` passed; recovery returned `{"status":"NONE"}`. The only matching processes were the documented Claude.app Chrome native hosts (PIDs 91991/91992), not Claude Code CLI processes.

- Install command: `bash install.sh --force-overwrite` (one invocation only).
- Transaction: `1787857958957-1294-7d4c23bf6023cada`; journal `/Users/felipevdc1/.soma-v2-backups/1787857958957-1294-7d4c23bf6023cada/transaction.json`; journal state `COMMITTED`.
- Post-commit recovery returned `{"status":"NONE"}`. No active transaction pointer or lock was found.
- Installation wrote five Claude file targets: `spec-completeness-gate.cjs`, `subagent-init.cjs`, `sonar-audit.md`, `soma-run.md`, and `soma-run-orchestration.md`. The installed core tree has 615 source files and 0 SHA-256 mismatches against the candidate.

| Installed target | SHA-256 | Candidate comparison |
| --- | --- | --- |
| `~/.claude/hooks/spec-completeness-gate.cjs` | `e4d633f6cdc6770f840b8b8a546a44b903d8688bbdb86ce8a4a24c040cdeeb8f` | match |
| `~/.claude/hooks/subagent-init.cjs` | `0fbb19f23a26f6acfd77309ac98636e3c2ca1f393222f22ef2d2a2f2a54fd311` | match |
| `~/.claude/commands/sonar-audit.md` | `1e2364410b537bb778ef25b6f42f21bc1ea05fb14b7d23a28e8d9c3a717f4857` | match |
| `~/.claude/commands/soma-run.md` | `a9daeef222fe422f66b487f9f98e08767b56bf64519c54f894167bce409464cf` | match |
| `~/.claude/references/soma-run-orchestration.md` | `e9b268027a75b54ac1a472755b3e8de22eb9b1ca621243e07a0f47b7c834f07c` | match |
| `~/.soma-v2/scripts/entry.cjs` | `4aea9429338e8ae5a93968f8b7b8070531c0d12a4006e4bd78e46df4d6651576` | match |
| `~/.soma-v2/scripts/entry/status.cjs` | `4e98ccfc9705e19f317aa33acec969ebfd4d5e3a89fa7b0609450fcb11fcca21` | match |
| `~/.soma-v2/scripts/soma.cjs` | `03811305235165caf3e1549bd5eb9574c7cb7abd9f8afe9df220723c8e17c80b` | match |
| `~/.soma-v2/docs/constitution.md` | `234d56532ff8897d5a0bf5e42aec6a2cc413a0ce074a08ac91fd37d4dbd6e5da` | match |
| `~/.soma-v2/docs/10-step-protocol.md` | `61f566e2b1e153ae5079102d3f7fa7973c0e6334942cea496811f02d64a7e5a3` | match |
| `~/.soma-v2/docs/00-overview.md` | `e5a24f68a6e7a26fb32ccfb5840c5e3b44c550b97f51222eece00b78a66be594` | match |
| `~/.soma-v2/manifest.json` | `9c286db3ecdd7af34e395bac7a2d4ea06ab752e485a5d24572a0427253906094` | match |
| `~/.soma-v2/adapters/claude/install-targets.json` | `90e919611d40d2e1e09956e24b049349a6d8fddef725a27f9047119ca17ddf43` | match |

Installed `sync --dry-run` passed for both Claude and Codex with `All entries in sync. No actions needed.` Installed `doctor --json` exited 0 with no errors or warnings; its sole finding is the expected worktree-local `file_never_installed` notice because this activation preserves the repository `.soma/` directory.

The direct installed entry command was exercised read-only. The initial `entry.cjs --help` and `status` invocation used an invalid direct CLI shape and returned `INVALID_ARGUMENTS`; no project changed. The adapter's mailbox route is the supported surface.

Claude Code smoke used exactly one bounded `claude -p '/soma-run --help'` call in a fresh temporary Git repository. The child ended cleanly and no Claude process remained, but it returned no captured stdout. Therefore discovery of the expected help text is **not evidenced** and no second model call was made.

The deterministic installed-runtime adoption smoke used no model call in `/tmp/soma-adoption-live-Qi9AbK`, which began as a Git project without `.soma`. The entry route returned `READY` (`adopted: true`, `baselineRequired: true`), created `soma-adoption/v1` plus `install-state.json`, and the installed status route returned `STATUS_SHOWN`, `adoption: installed`, and `NO_DURABLE_RUN`.

No rollback occurred. Activation is committed, but the overall live-smoke proof remains blocked solely by the CLI's empty captured response.

## Permission-safe adapter correction activation

Candidate `7981bd7f4c8a1bb362112c98c1bdba1379b28407` scopes the Claude adapter to `Edit(~/.soma-v2/state/entry-mailbox-v1/**)` and `Read(~/.claude/references/soma-run-orchestration.md)`. The corrected quality review was approved after checking the installed Claude Code 2.1.247 permission documentation and binary evidence that Edit rules cover built-in file-editing tools, including Write.

Fresh preflight found recovery `NONE`, clean tracked candidate state, valid installer syntax and no active Claude Code CLI. The two Claude.app Chrome native hosts remained nonblocking. Exactly one corrective `bash install.sh --force-overwrite` transaction ran:

- Transaction `1787861135989-63809-d071e13d3ad5606e`, journal `/Users/felipevdc1/.soma-v2-backups/1787861135989-63809-d071e13d3ad5606e/transaction.json`, reached `COMMITTED`.
- Post-commit recovery returned `NONE`; no active pointer or lock remained. No rollback occurred.
- One installed target changed: `~/.claude/commands/soma-run.md`, SHA-256 `b7eb8823a876331f605d96284ceb87af3844bcd4405c1fc976a298d855666569`, byte-identical to the candidate source.
- Installed Claude and Codex sync dry-runs reported `All entries in sync. No actions needed.` Doctor exited 0 with no errors or warnings; its only informational finding remains the preserved worktree-local `file_never_installed` state.

The required one normal-permission `claude -p '/soma-run --help'` call was attempted in a fresh temporary Git project with no `.soma`, with output redirected to `claude-smoke.txt`. The command runner returned no output and left neither a live Claude process nor a discoverable temporary transcript directory. Consequently it does not prove command discovery, permission behavior, `REQUEST_PREPARED`/`HELP_SHOWN`, or mailbox cleanup. No second model call was made. This is the sole residual blocker for real-smoke completion.

## Permission-safe smoke diagnostic (attempt 2)

**Verdict: BLOCKED (runtime identity contract, not output capture).** Phase A found that the first attempt's “no transcript” conclusion was false: its project transcript exists at `/Users/felipevdc1/.claude/projects/-private-tmp-soma-permission-safe-smoke-M5zEbw/04f1e8d7-ad52-466e-8e1f-b486a0fb13e9.jsonl`. It records slash-command discovery and then `entry native prepare`/`abort` both failing with `INVALID_SESSION_ID`: the non-interactive SDK CLI session has transcript metadata but does not export a valid `CLAUDE_SESSION_ID` to the Bash child. The original stdout-only capture therefore hid decisive structured evidence; it was not a successful smoke.

One and only one materially corrected foreground smoke was then run with normal/default permissions (no bypass or explicit permission mode), `--verbose --output-format stream-json --include-partial-messages --debug-file`, independent stdout/stderr, no timeout wrapper, backgrounding, pipe, or command substitution. Its fresh Git project had no `.soma`:

- Evidence directory: `/private/tmp/soma-permission-safe-final.8ErppD`; stdout `claude.stdout.jsonl` (77,060 bytes), stderr `claude.stderr.log` (0 bytes), debug `claude.debug.log` (105,328 bytes), shell exit `0`.
- Claude session/transcript: `292d11b3-7103-45d9-998c-bcd60947a5ab`, `/Users/felipevdc1/.claude/projects/-private-tmp-soma-permission-safe-final-8ErppD/292d11b3-7103-45d9-998c-bcd60947a5ab.jsonl`.
- Positive discovery/tool-flow evidence: the injected adapter was discovered; it invoked the fixed native `prepare`, received exit 2 `INVALID_SESSION_ID`, then invoked the fixed native `abort`, which received the same exit 2. The final stream result reports `permission_denials: []`.
- There was no scoped Write, consume, or `HELP_SHOWN`, because prepare could not establish the executor-owned session identity. No mailbox files, project adoption/run lock, or live Claude CLI process remained.

No further model calls, source edits, reinstalls, or global activation were performed. The remaining decision is to run the adapter in a genuinely interactive Claude Code session that exports the validated session identity, or to change the runtime contract under a separately authorized implementation task.

## Claude SessionStart identity closure

The prior interactive blocker is resolved. Its root cause was not command discovery or permission handling: `entry native prepare` requires a valid `CLAUDE_SESSION_ID`, but later Bash calls did not receive Claude Code's authoritative SessionStart `session_id`. The canonical fix uses the existing `SessionStart` hook and appends the validated value to `CLAUDE_ENV_FILE`, the lifecycle channel Claude Code provides to subsequent Bash calls. It does not derive identity from PID, cwd, time, mailbox state, or another fallback.

Two review failures prevented unsafe candidates from reaching the global installation:

1. Candidate `59b6656` rejected an invalid value for the new Claude export but still allowed it into legacy `CK_SESSION_ID` and temporary state.
2. Candidate `33ec3ff` closed those legacy channels but let an already effective stale `CLAUDE_SESSION_ID` survive an invalid or missing current SessionStart event.

The final reviewed candidate is `289ddb7d43126f8e04b206f1bc87291df6016aa5`. Invalid or missing current identity now appends a constant shell-safe neutralization, so a prior value cannot remain effective; a valid current identity remains the sole authority. The reviewed code scope is exactly two files: `core/hooks/session-init.cjs` and `core/hooks/__tests__/session-init-identity.test.cjs`.

Fresh activation gates passed: affected identity/native matrix `91/91`, fake-home installer parity/idempotence `1/1`, settings/install-target/manifest matrix `14/14`, and installed manifest/source/target parity `33/33`. Exactly one global install transaction ran: `1787872578839-81599-09f7349aae7ff23d`, state `COMMITTED`, recovery `NONE`. The candidate and installed hook hashes both equal `ef746d329ab3feaf50c0086403159a7e131ffc0e655420a92d7bd152618233e9`. Installed Claude and Codex sync dry-runs exited 0 with no pending action; doctor exited 0 with zero blockers. The managed SessionStart entry remained singular and five unmanaged entries were preserved.

One fresh interactive Claude Code session exercised `/soma-run --help` through native prepare, scoped mailbox write, native consume, cleanup, and terminal `HELP_SHOWN`. It had no identity error, permission denial, or fallback. In the same session exactly one minimal subagent compared its inherited identity with the parent contract and returned `MATCH`. The mailbox ended empty, the session exited 0, and no Claude Code CLI process remained. The parent identity is recorded only as SHA-256 `0370d1bbbc5e29fe3ae268c54e359ab68c78dc67b594dc6662a77554e895818b`.

The accepted runtime limitation remains explicit: if `CLAUDE_ENV_FILE` exists but is unwritable, the hook stays nonblocking and emits `ENV_WRITE_FAILED`, but it cannot erase a stale variable that was already effective in that file. This is a bounded property of a failed lifecycle channel, not an untracked blocker or an alternate identity path.

Sanitized durable evidence: `.soma/diagnostics/run-260825-universal-entry-7f3c2a-session-identity-activation.json`. The normative status is **installed and verified** for interactive startup/help and subagent identity inheritance. Windows migration, chezmoi, and unmanaged-hook cleanup remain outside this unit's scope.
