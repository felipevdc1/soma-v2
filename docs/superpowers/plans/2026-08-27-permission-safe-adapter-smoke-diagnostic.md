# T-LEAN-10 attempt 2 — Diagnose capture, then one final smoke

Role: independent activation verifier. No source edits and no reinstall. Candidate/install: `7981bd7f4c8a1bb362112c98c1bdba1379b28407`; transaction `1787861135989-63809-d071e13d3ad5606e` is already COMMITTED.

## Phase A — zero-model diagnosis

Do not invoke `claude -p` yet. Inspect the activation report, installed adapter/hash, current processes, Claude executable/version/help, relevant non-secret environment shape, recent Claude debug/project artifacts and timestamps, mailbox residue, and any command/capture evidence from attempt 1. Establish a concrete explanation or at least falsifiable candidate for why the runner returned no stdout and no transcript. Verify the normal CLI can start at the command/parser layer without a model call. Do not print secrets or kill user processes.

If no materially improved capture procedure can be justified, stop without a model call and report the blocker.

## Phase B — one final, materially changed smoke

Only after Phase A identifies the flawed capture/invocation assumption, run at most one direct foreground Claude command in a new temporary Git project without `.soma`, under explicit normal/default permissions and structured verbose output. No bypass mode, timeout wrapper, backgrounding, pipe that can hide exit status, or command substitution. Capture exit code, stdout and stderr independently. Record pre/post transcript directories and mailbox state. The prompt is exactly `/soma-run --help`.

Success requires positive evidence of slash-command discovery, no approval/tool denial, native prepare + scoped Write + native consume, terminal `HELP_SHOWN`, no adoption/run lock, no mailbox residue, and clean process exit. A generic text answer without tool-flow evidence is insufficient.

Update the durable result report with diagnosis and evidence, commit report plus the existing plan docs (never `.soma/`). Return <=4000 bytes with verdict, diagnosis, report commit, exact smoke evidence path/session, exit/status, permission/tool-flow proof, cleanup, and residuals. If it fails, no more model calls or code attempts.

## Result

Phase A established that the prior stdout-only capture was incomplete: the original SDK CLI transcript exists and shows `CLAUDE_SESSION_ID` was not exported to the adapter Bash process, so both native `prepare` and `abort` returned `INVALID_SESSION_ID` (exit 2). No model call was made during this phase.

Phase B consumed the one permitted final model call in `/private/tmp/soma-permission-safe-final.8ErppD` (fresh Git project, no `.soma`) using default permissions plus verbose stream JSON and a debug file. It created Claude session `292d11b3-7103-45d9-998c-bcd60947a5ab`; evidence is retained in that directory and the matching Claude project transcript. The CLI returned exit 0 and `permission_denials: []`, but native `prepare` and cleanup `abort` each returned `INVALID_SESSION_ID`; no Write, consume, or `HELP_SHOWN` occurred. No mailbox, adoption/run lock, or live CLI process remained. Verdict is BLOCKED pending a genuinely interactive session that exports the required identity; no further model calls or code attempts were made.
