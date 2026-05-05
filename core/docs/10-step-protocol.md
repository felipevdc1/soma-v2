# SOMA 10-Step Protocol

Extracted from `~/.codex/AGENTS.md` (soma-stsd block) and `~/.claude/commands/soma-run.md` (Recovery Protocol section).

## SOMA / STSD Operating Lens

Use SOMA v2 as the default execution philosophy for non-trivial work. Treat it as an always-on lens, not mandatory ceremony for tiny commands. Scale the artifacts to the risk and size of the task, but keep the core discipline: spec first, tests tied to acceptance criteria, execution in safe waves, validation before claims, audit before done.

## 10 Steps

1. **SPECIFY** — define what/why, user stories, acceptance criteria, and open questions.
2. **PLAN-SDD** — derive technical plan, contracts, constraints, and integration strategy.
3. **TASKS** — break work into dependency-aware tasks with AC references and parallel flags.
4. **TEAM** — decide execution topology; use agents/parallel work only when useful and safe.
5. **FOUNDATION** — establish scaffold, shared contracts, configs, and baseline tests.
6. **WAVES** — execute independent tasks in dependency-safe waves.
7. **VALIDATE** — verify each unit with tests, diffs, traceability, and no unsafe deletion.
8. **CONSOLIDATE** — merge approved work, update project memory/docs when useful, run full sanity.
9. **INTEGRATE** — wire components together and run integration/smoke checks.
10. **SONAR / FIX / COMMIT** — audit, fix blocking findings, then finalize with proof.

## Ceremony Scaling

- **Tiny task**: answer or execute directly, but still check assumptions and verify if a command/test is cheap.
- **Small code change**: compressed loop — specify intent, implement, test, audit, summarize.
- **Medium feature or multi-file change**: explicitly map ACs/tasks, run focused tests, do integration sanity, then final audit.
- **Large feature, risky refactor, or 3+ independent components**: follow the full SOMA flow or propose it before implementation.

## Stop Conditions

Pause and re-plan when:
- acceptance criteria are unclear or contradicted;
- tests cannot be tied back to the requested behavior;
- validation fails twice for the same area;
- a fix requires deleting or weakening existing behavior without explicit approval;
- implementation drifts from the spec.

---

## Recovery Protocol (Article X + CLAUDE.md)

Applicable in any step with failure:

```
failureCountsByStep[STEP] += 1

if count == 1: RETRY
  - Re-dispatch SAME agent with error feedback prepended in prompt.
  - Return to step.

if count == 2: ESCALATE
  - Re-dispatch with model upgrade: Sonnet → Opus (or Haiku → Sonnet).
  - Prompt includes: "Previous attempt with {prev-model} failed because {reason}".

if count >= 3: STOP AND REPLAN
  - Write /tmp/soma-diagnostic-{runId}.json (schema per soma-v2-design.md §3.7).
  - Transition to PAUSED_DIAGNOSTIC.
  - Preserve worktrees + logs + specs.
```

Always log the event (`DISPATCH_RETRY | DISPATCH_ESCALATE | PAUSE_DIAGNOSTIC`) + append to FAMILY_DOC section "Pitfalls" (do not commit yet — only at STEP_6 or STEP_10).
