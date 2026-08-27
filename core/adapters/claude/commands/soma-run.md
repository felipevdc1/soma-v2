---
description: Start, inspect or resume the durable SOMA workflow
argument-hint: '"objective" | --help | --status [--project path] | --resume [runId] [--project path]'
allowed-tools:
  - Bash(exec node ~/.soma-v2/scripts/soma.cjs entry native prepare)
  - Bash(exec node ~/.soma-v2/scripts/soma.cjs entry native consume)
  - Bash(exec node ~/.soma-v2/scripts/soma.cjs entry native abort)
  - Edit(~/.soma-v2/state/entry-mailbox-v1/**)
  - Read(~/.claude/references/soma-run-orchestration.md)
---

You are the thin `/soma-run` adapter. Transport the request, route the structured result and do nothing else here.

## 1. Prepare

Run this fixed command. Node reads and validates `CLAUDE_SESSION_ID` inside Node; do not infer a fallback.

```bash
exec node ~/.soma-v2/scripts/soma.cjs entry native prepare
```

Require `REQUEST_PREPARED` and use the returned `requestPath` only with Write. Node owns the validated session and request identity inside Node; never put either identity in a command.

## 2. Write the envelope

Use the structured Write tool on the exact returned `requestPath`. Write one JSON object with exactly these fields:

- `"$schema": "soma-entry-request/v1"`
- `"sessionId"`: the validated prepare result
- `"requestId"`: the validated prepare result
- `"rawArguments": the exact `$ARGUMENTS` value`, JSON-encoded as data

Do not parse, normalize, quote for a shell, interpolate into a command or execute the argument text.

## 3. Consume or abort

Separate calls share no model-defined shell variables. In a `finally` path:

- after a successful Write, run the fixed consume command;
- after a failed or rejected Write, or if consume cannot be invoked, run the fixed abort command;
- never put objective, request path, project path, run ID or argument text into either command.

```bash
exec node ~/.soma-v2/scripts/soma.cjs entry native consume
```

```bash
exec node ~/.soma-v2/scripts/soma.cjs entry native abort
```

## 4. Route once

Parse the consume output as JSON.

- For `READY` or `RESUME_READY`, use the Read tool exactly once on `~/.claude/references/soma-run-orchestration.md`, then follow it with the entry result as authority.
- For `HELP_SHOWN`, `STATUS_SHOWN`, `RESUME_DRIFT`, `ARGUMENT_ERROR`, `PROJECT_UNRESOLVED`, `ADOPTION_BLOCKED`, `MAILBOX_INVALID`, `MAILBOX_EXPIRED`, `RESUME_BUSY`, `RESUME_IDENTITY_REQUIRED` or any other result, print a concise result and stop.

`PROJECT_UNRESOLVED` and `ADOPTION_BLOCKED` replace manual `soma install` remediation in this entry path; do not install from model memory.

Do not call Agent or Read the orchestration reference for a terminal result. Do not retry an adoption, mailbox or continuity failure from model memory.
