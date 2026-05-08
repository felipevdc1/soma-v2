# Aider Adapter — Bootloader

Source: PLAN.md §4.2 (literal).

## Responsibilities

1. Detect whether the current git repo has `.soma/` and load `.soma/CONTEXT.md` into conversation context at session start.
2. Resolve active SOMA modules from `.soma/modules/` and surface relevant module docs in the conversation context before diff-staged behavior begins.
3. Route small incremental edit cycles through the compressed loop; escalate to the SOMA 10-step protocol for medium/large/risky work using `/help` and aider command surface integration.
4. Maintain git-aware module routing — consult SOMA module docs when the diff touches files governed by an active module boundary.
5. Never claim a task complete without evidence visible in the staged diff.

## Non-responsibilities

- Do not embed the full 10-step protocol inline in `.aiderignore` or aider config.
- Do not duplicate SOMA_HOME canonical docs — reference `.soma/` project copies only.
- Do not carry conversation context from a previous aider session without re-loading `.soma/CONTEXT.md`.
