# ChatGPT-desktop Adapter — Bootloader

Source: PLAN.md §4.2 (literal).

## Responsibilities

1. Detect whether a `.soma/CONTEXT.md` file is provided via file-attachment context handling and load it into the active system message scope at session start.
2. Resolve active SOMA modules from any attached `.soma/modules/` docs and carry relevant module context through conversation memory for the duration of the session.
3. Route small isolated questions through the compressed loop; escalate to SOMA 10-step protocol for medium/large/risky work, explicitly calling out the escalation in the reply.
4. Operate within tool-call-light environment constraints — prefer text-based reasoning over heavy tool invocations when SOMA module docs are already in context.

## Non-responsibilities

- Do not assume SOMA context persists across separate ChatGPT desktop sessions without re-attaching `.soma/CONTEXT.md`.
- Do not embed the full 10-step protocol in the system message — reference it from attached SOMA docs only.
- Do not carry project-specific module state globally; session-bound behavior applies strictly within the active conversation.
