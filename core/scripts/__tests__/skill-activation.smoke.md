# Cross-Harness Skill Activation — Smoke Test Procedure

**Spec:** AC-10 (Claude side) + AC-11 (Codex side)
**Type:** Manual smoke test — real automation requires an active Claude / Codex session.
**Task:** T-34

This procedure validates that SOMA's skill integration correctly routes natural-language install
intent to the canonical `soma install` CLI, rather than letting the agent free-form edit CLAUDE.md.
The guardrail exists because free-form CLAUDE.md edits produce anchor sha mismatch and broken state.

---

## AC-10: Claude side (manual)

### Prerequisites

1. A target project directory with `.soma/` already present (run `soma install <project>` first).
2. Claude Code session open in that project (`claude` or `code` with Claude Code extension).
3. The SOMA skill is registered (verify with `/skills list` or equivalent).

### Procedure

1. Open Claude Code in the target project.
2. Type the prompt: `instalar o SOMA neste projeto`
3. Observe the agent response.

### PASS criteria (all must hold)

| # | Assertion | Check |
|---|-----------|-------|
| P1 | Response contains literal `soma install` | Skill source ref OR backbone CLI invocation |
| P2 | Response does NOT contain `"let me edit CLAUDE.md"` | No free-form edit intent |
| P3 | Response does NOT contain `"I'll modify CLAUDE.md"` | No free-form edit intent |
| P4 | Response does NOT contain `"editar CLAUDE.md manualmente"` | No free-form edit intent (pt-br) |
| P5 | Skill `/soma:install` fires (Claude Code shows skill activation indicator) | Optional visual confirmation |

### FAIL criteria

Any of the following indicates regression:

- Agent emits `"let me edit CLAUDE.md"`, `"I'll add"`, `"I'll modify"`, or equivalent — skill did NOT fire.
- Agent runs `edit CLAUDE.md` tool call directly — bypass of canonical CLI.
- Response contains no reference to `soma install` — wrong skill matched or no skill matched.

### Why this matters

The skill disambiguates install intent → must invoke canonical CLI, not free-form CLAUDE.md edits.
Without this guardrail, Claude may "helpfully" modify CLAUDE.md in a way that produces anchor sha
mismatch (drift), breaking subsequent `soma install` idempotency (AC-02) and drift detection (AC-03).

---

## AC-11: Codex side (deferred — requires Codex env)

**Status:** Stub — real test deferred until Codex env is available.

### Expected equivalent procedure

1. Open a Codex CLI session in the target project (with `.soma/` present).
2. Type: `install SOMA in this project`
3. **PASS criteria:** Equivalent to Claude side (P1–P4 above), adapted for Codex output format.
   - Response contains `soma install` literal (or `node install.cjs` invocation).
   - Response does NOT contain free-form `AGENTS.md` or `CLAUDE.md` edit intent.

### Why deferred

Codex skill activation requires a live Codex session. The equivalent skill file lives at
`core/adapters/codex/` and follows the same routing pattern as the Claude adapter. When a Codex
test environment is available, run the same sequence with:

- Prompt: `install SOMA in this project`
- Target file: `AGENTS.md` (Codex equivalent of CLAUDE.md)
- PASS assertions: same P1–P4 logic, swapping "CLAUDE.md" for "AGENTS.md"

---

## Recording smoke test results

1. Capture a transcript or screenshot of the session.
2. Store evidence at `core/specs/015-soma-install/smoke-evidence/` (directory is gitignored by
   spec untracked status — create it locally before storing).
3. Update `core/specs/015-soma-install/spec.md` AC-10 / AC-11 traceability rows when smoke run
   completes successfully:
   ```
   | AC-10 | smoke run PASS — [date] — [operator] | manual (Claude) |
   | AC-11 | deferred — no Codex env              | manual (Codex)  |
   ```

---

## Automation path (future)

The Claude side (AC-10) could be automated by:
- Injecting the install prompt into a headless Claude Code session via the MCP test harness.
- Asserting the tool-call log contains `soma install` and no `Edit(CLAUDE.md)` call.
- This is tracked as a future enhancement; manual procedure is sufficient for pre-SONAR sign-off.
