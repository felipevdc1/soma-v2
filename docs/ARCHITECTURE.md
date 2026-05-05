# SOMA v2.1 — Architecture Reference

**Audience:** Developers wanting to understand SOMA internals or contribute.
**Canonical version:** v2.1.0

---

## Overview

SOMA is a **Spec + Test + Steps Driven (STSD)** autonomous execution framework for Claude Code. The core philosophy:

- **Specs are source of truth.** Code serves the spec, not the inverse. Divergence is always a code defect.
- **Tests are tied to acceptance criteria.** Every AC-XX in the spec must have a corresponding test. Tests without AC references are orphaned and flagged.
- **Evidence before claims.** No agent reports `DONE` without providing a commit SHA, list of files changed, and test output.
- **Constitution governs all runs.** Ten articles with HARD and SOFT enforcement mechanisms. Snapshot-locked per run — amendments to the Constitution do not affect runs already in progress.

The **10-step protocol** (STSD) structures every feature:

1. **SPECIFY** — define what/why, user stories, acceptance criteria, open questions
2. **PLAN-SDD** — derive technical plan, contracts, constraints, integration strategy
3. **TASKS** — break work into dependency-aware tasks with AC references and parallel flags
4. **TEAM** — decide execution topology; use parallel agents when beneficial and safe
5. **FOUNDATION** — scaffold, shared contracts, configs, baseline tests
6. **WAVES** — execute independent tasks in dependency-safe waves
7. **VALIDATE** — verify each unit with tests, diffs, and AC traceability
8. **CONSOLIDATE** — merge approved work, update project memory/docs, run full sanity
9. **INTEGRATE** — wire components and run integration/smoke checks
10. **SONAR / FIX / COMMIT** — multi-territory audit, fix blocking findings, finalize with evidence

SOMA dogfooded its own workflow during construction: Wave A and Wave B of v2.1 were executed via `TeamCreate` + `addBlockedBy`, producing 838 tests (836 pass, 0 fail, 2 skip) across 16+ Sonnet/Haiku dispatches without a single frozen-lib drift incident.

---

## The Constitution

`core/docs/constitution.md` — Ratified v1.0.0 (2026-05-05)

The Constitution is the normative reference read by every dispatched agent. It exists because empirical practice showed that markdown memory alone does not enforce behavior — without explicit invariants and structural hooks, the 10-step workflow degrades toward shortcuts.

**10 Articles:**

| Article | Rule | Enforcement |
|---|---|---|
| I — Spec as Source of Truth | Every feature must have an approved `spec.md` before Step 2. | HARD — `spec-completeness-gate.cjs` blocks commit; Gate 1 marker required |
| II — Test-First Imperative | No production code before RED phase is verified in git history. | HARD — `spec-test-traceability.cjs` validates AC→test linkage |
| III — Integration-First Testing | Use real DBs and services over mocks where viable. | SOFT default (SONAR flags) → HARD per domain when spec mandates it |
| IV — Proof Before Done | Every DONE report requires SHA + files list + test output. Also: dispatch preamble post-merge (git fetch + SHA check). | HARD — Step 5 VALIDATE rejects reports without evidence |
| V — Thermal Guard | Max 3 compile/test agents simultaneously. Read-only agents are unlimited (up to 20). | HARD — `thermal-guard.cjs` exits 2 on 4th compile/test agent |
| VI — Zero Deletion | No agent deletes existing code. Options in order: wire, document, disable. Removal only in Step 10 with explicit approval. | HARD — `git diff --stat` in Step 5 flags deletions >50 lines |
| VII — Simplicity Gate | Max 3 new components per feature. No wrappers without written rationale. No speculative features. | SOFT — `/plan-sdd` Phase -1 checklist; SONAR audits abstraction ratio |
| VIII — FAMILY_DOC Persistence | Every agent receives the project FAMILY_DOC. Team learnings merged to project doc after consolidation. | HARD for injection; SOFT for merge quality |
| IX — Explicit Human Gates | Exactly 2 human gates: Gate 1 (spec approval) and Gate 2 (deploy approval). Nothing else is gated. | HARD — controller pauses at `AWAITING_SPEC_APPROVAL` and `AWAITING_DEPLOY_APPROVAL` |
| X — Stop and Replan | 3 consecutive failures on same step → `PAUSED_DIAGNOSTIC`. No automatic retry beyond 2 attempts (1 retry + 1 Sonnet→Opus escalate). | HARD — controller transitions to diagnostic state; human decides continue/rollback/replan |

**Amendment Protocol:** The Constitution is versioned (semver). Amendments require a human approval gate — the Constitution never changes itself. Runs are snapshot-locked to the version active at start time.

---

## Hook chain

SOMA ships **16 SOMA-CORE hooks** installed to `~/.claude/hooks/`. They register in `settings.json` via `install/merge-settings.cjs`.

| Hook | Event | Role |
|---|---|---|
| `subagent-init.cjs` | PreToolUse (Agent) | Injects Constitution, FAMILY_DOC, and run context into every subagent prompt. **Must run first** — other hooks depend on its context setup. |
| `thermal-guard.cjs` | PreToolUse (Agent/TeamCreate) | Counts in-flight compile/test agents; blocks 4th with exit 2 (Article V HARD) |
| `spec-completeness-gate.cjs` | PreToolUse (Bash `git commit`) | Blocks commit if spec has `[NEEDS CLARIFICATION]` open or ACs without test references |
| `spec-test-traceability.cjs` | PreToolUse (Bash) | Scans test files for `// @spec AC-XX` annotations; produces coverage/orphan/uncovered-AC report |
| `cognitive-gate.cjs` | PreToolUse (Edit/Write) | Warns orchestrator when attempting to write implementation code directly (Orchestrator Mode anti-pattern) |
| `cognitive-gate-unlock.cjs` | UserPromptSubmit | Allows per-turn override of cognitive-gate when orchestrator explicitly authorizes direct edit |
| `hyd-gate.cjs` | UserPromptSubmit | Detects action verbs in prompts; soft-warns if HYD v2 loop was not run for non-trivial tasks |
| `reuse-gate.cjs` | PreToolUse (Write) | Before writing new artifacts (commands, skills, hooks, memory files), enforces vault + skill + memory + extension checks |
| `depth-guard.cjs` | PreToolUse (Bash `git commit`) | Warns if plan has unchecked items (depth decay prevention) |
| `pre-commit-gate.cjs` | PreToolUse (Bash `git commit`) | Combined gate: Constitution compliance + plan completeness |
| `discover-before-specify.cjs` | UserPromptSubmit | Detects "extends X / Phase N+1" patterns; reminds to read existing module before specifying |
| `capture-defer-gate.cjs` | UserPromptSubmit | Detects "defer / later / out of scope" language; requires named capture target before proceeding |
| `insight-action-coupling.cjs` | Stop | Scans last turn for SOMA Insight blocks; warns if no durable capture action was taken in same turn |
| `session-init.cjs` | UserPromptSubmit (first) | Runs wake-up: loads handoff if active, emits memory context |
| `session-end.cjs` | Stop | Prompts diary write if significant work was done; checks for open handoff buckets |
| `write-compact-marker.cjs` | PreToolUse (Bash) | Writes compact marker on PreCompact for context continuity |
| `agent-mode-gate.cjs` | PreToolUse (Agent/TeamCreate) | Enforces dispatch limits (max 3 standalone agents + 3 team agents before requiring override) |

**Dependency note:** `subagent-init.cjs` must execute before other hooks that rely on its context injection. `thermal-guard.cjs` reads agent count from the session state that `subagent-init.cjs` tracks. Installing the full bundle (rather than individual hooks) is the only supported configuration. See Risk #2 in the plan for details.

Hooks in `hooks/lib/` are shared utilities: `auto-load-modules.cjs` (module resolution), `context-tracker.cjs` (in-flight agent accounting).

---

## Slash commands

**11 SOMA-CORE commands** installed to `~/.claude/commands/soma/` and available as `/soma:*` in Claude Code:

| Command | Purpose |
|---|---|
| `/soma:specify` | Generate `specs/{NNN}-{slug}/spec.md` with user stories, AC-XX criteria, `[NEEDS CLARIFICATION]` markers |
| `/soma:plan-sdd` | Derive `plan.md` + `contracts/` + `tasks.md` + `quickstart.md` from approved spec |
| `/soma:run` | Autonomous 10-step state machine. Pauses at Gate 1 and Gate 2 only. |
| `/soma:dispatch` | Dispatch a single Sonnet executor in an isolated worktree for targeted work |
| `/soma:sonar-audit` | Step 8 multi-territory read-only audit: 5 agents scan architecture/modules/tests/config/spec-adherence in parallel |
| `/soma:hyd` | HYD v2 anti-shallowness loop: classify task, select quality dimensions, pressure-test thesis |
| `/soma:quality-check` | Post-dispatch quality scorecard: evidence completeness, test coverage, spec adherence |
| `/soma:depth-score` | Deterministic depth score for dispatched work (traces AC→test→implementation linkage) |
| `/soma:gap-finder` | Pre-feature gap analysis: finds missing coverage, drift, and structural issues |
| `/soma:handoff` | Create structured cross-session handoff: state, open buckets, resume prompts, diary write |
| `/soma:encerrar` | End-of-session ritual: handoff bucket check, diary write, KG update |

---

## Adapter system

SOMA supports multiple LLM tools via an adapter layer in `core/adapters/`.

**Production adapters (fully wired):**

- `core/adapters/claude/` — Claude Code adapter. Install target: `~/.claude/CLAUDE.md`. Anchor IDs: `block.claude.CLAUDE_md.{cbm,hyd-v2,soma-stsd}`.
- `core/adapters/codex/` — OpenAI Codex adapter. Install target: `~/.codex/AGENTS.md`. Anchor IDs: `block.codex.AGENTS.{cbm,hyd-v2,soma-stsd}`.
- `core/adapters/_global/` — Shared content used across adapters.

**Experimental adapters (skeletons only):**

- `core/adapters/EXPERIMENTAL/cursor/`
- `core/adapters/EXPERIMENTAL/aider/`
- `core/adapters/EXPERIMENTAL/chatgpt-desktop/`

These ship with a banner README making their status explicit. They have `install-targets.json` with placeholder entries but no production wiring. Contributions welcome — see the adapter contract below.

**Adapter contract** (`core/docs/adapter-contract.md`): Five mandatory clauses govern any adapter:

- **Clause A** — Anchor ID convention: `block.{tool}.{file}.{section}` versioned via `manifest.json`
- **Clause B** — Read-only access to `~/.soma-v2/` (SOMA_HOME). Only the SOMA CLI writes to SOMA_HOME.
- **Clause C** — `install-targets.json` conforming to schema `soma-install-targets/v1`
- **Clause D** — Optional hook/MCP integration appendix per tool
- **Clause E** — Tool-specific anchor strategy (Claude uses CLAUDE.md; Codex uses AGENTS.md)

Adding a new adapter requires only: new folder `core/adapters/{newtool}/`, valid `install-targets.json`, optional `integration.md`. No SOMA core changes needed — the CLI auto-discovers by folder presence.

---

## State machine

The `/soma:run` state machine tracks per-run state in `/tmp/soma-state-{sessionId}.json`. States:

```
IDLE
  └─ AWAITING_SPEC_APPROVAL    ← Gate 1 (human)
       └─ TEAM
            └─ FOUNDATION
                 └─ WAVES
                      └─ VALIDATE
                           └─ CONSOLIDATE
                                └─ INTEGRATE
                                     └─ SONAR
                                          └─ AWAITING_DEPLOY_APPROVAL  ← Gate 2 (human)
                                               └─ DEPLOY_EXECUTING
                                                    └─ DONE
```

**Error path:** Any step hitting 3 consecutive failures transitions to `PAUSED_DIAGNOSTIC`. The controller snapshots current state, last successful step, produced artifacts, failure reasons, and an Opus-generated replan suggestion. The user then creates a marker:

```bash
touch /tmp/soma-diagnostic-{runId}-continue    # resume with hint
touch /tmp/soma-diagnostic-{runId}-rollback    # revert all commits from this run
touch /tmp/soma-diagnostic-{runId}-replan      # return to Step 1 with spec amendments
```

**Recovery Protocol (3 layers):**
1. 1st failure → retry same agent with error context
2. 2nd failure → escalate model (Sonnet → Opus for that specific task)
3. 3rd failure → `PAUSED_DIAGNOSTIC` — STOP AND REPLAN, no more automatic retries

---

## Memory architecture

SOMA maintains several layers of memory:

**In-session (ephemeral):**
- `/tmp/soma-state-{sessionId}.json` — state machine state
- `/tmp/soma-log-{runId}.jsonl` — per-run event log

**Cross-session (durable):**
- `~/.claude/CLAUDE.md` — SOMA bootloader anchored block (system rules injected by `soma sync`)
- `~/.claude/projects/.../memory/project_*.md` — project-specific memory (decisions, architecture, learnings)
- `~/.claude/projects/.../memory/feedback_*.md` — feedback and lessons captured by the system
- `~/.claude/plans/handoff-{project-slug}.md` — active handoff file with open buckets and resume prompts

**Project-level:**
- `{project}/FAMILY_DOC.md` — persistent cross-run memory shared by all agents on the project. Patterns, pitfalls, decisions, session logs. Every agent receives its relevant sections via `subagent-init.cjs`.

**Optional (MCP-dependent):**
- mempalace — semantic search across drawers and knowledge graph with temporal predicates. Used by `session-init.cjs` (wake-up) and `session-end.cjs` (diary write). Absent → hooks warn and continue.

---

## Cost profile

Approximate token usage per workflow phase (based on v2.1 empirical data — 16+ Sonnet/Haiku dispatches during Phase 6 construction):

| Phase | Agent | Approximate tokens | Notes |
|---|---|---|---|
| `/soma:specify` | Sonnet | 15–30K | Varies with feature complexity |
| `/soma:plan-sdd` | Sonnet | 20–40K | Includes contract derivation |
| WAVES (per wave) | Sonnet | 40–80K | Per executor per wave |
| `/soma:sonar-audit` | 5× Haiku | 5× 10–20K | Read-only parallel |
| `/soma:quality-check` | Haiku | 5–15K | Fast validation pass |

These are approximate and vary significantly with codebase size and feature scope. The +36% latency cost of the full STSD protocol over ad-hoc implementation is offset by measurable gains in process score and auditability, not raw per-task correctness on isolated small tasks.

---

## Frozen libs philosophy

Three libraries in `core/scripts/lib/` are designated **frozen** and must never be mutated after Phase 3:

- `core/scripts/lib/anchored-blocks.cjs` — anchor read/write/replace primitives
- `core/scripts/lib/manifest.cjs` — manifest schema validation and versioning
- `core/scripts/lib/template-engine.cjs` — template expansion engine

These are frozen because:

1. Every downstream script depends on their stable API. A mutation in `anchored-blocks.cjs` could corrupt CLAUDE.md or AGENTS.md for any user who re-runs `soma sync`.
2. Their `sha256` checksums are verified before and after every dispatch as part of the proof-before-done contract. Any drift is immediately detectable and treated as a blocking error.

**Empirical validation:** 16+ Sonnet/Haiku dispatches across Phases 4–6 without a single frozen-lib drift incident. The constraint works because it is enforced structurally (checksum gate), not by convention.

If you need to fix a bug in a frozen lib: open a spec for the change, get Gate 1 approval, implement under TDD in an isolated branch, and verify that downstream scripts all pass before bumping the library version.

---

## Telemetry

SOMA writes two local JSONL telemetry files. No data leaves your machine.

**`~/.claude/logs/insight-coupling-{YYYY-MM-DD}.jsonl`** — schema `insight-coupling/v1`:
```json
{
  "schema": "insight-coupling/v1",
  "ts": "ISO-8601",
  "session_id": "string",
  "insight_blocks_count": 1,
  "coupling_actions_detected": ["memory_saved"],
  "coupling_status": "valid",
  "hard_mode": false,
  "violation_excerpt": null
}
```
Emitted by `insight-action-coupling.cjs` (Stop hook). Tracks whether architectural insight blocks are paired with a durable capture action in the same turn.

**`~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl`** — tracks Capture Before Defer protocol adherence. Emitted by `capture-defer-gate.cjs`.

**Opt out:** Set `INSIGHT_COUPLING_DISABLED=1` in your shell environment before launching Claude Code.

---

## Complementary systems

SOMA is part of a broader workflow research family. **JFLOW** ([@zbrunomoreira](https://instagram.com/zbrunomoreira)'s state-driven workflow system in SomaCanvas) takes a complementary approach: a centralized state envelope at `.jflow/state.json` with uniform Era → Phase → Track → Wave → Task decomposition, explicit transitions via JSON edits, and background agents coordinating via state-file polling. Where SOMA emphasizes hooks + constitution + rollback as enforcement primitives, JFLOW emphasizes state envelope + transitions as enforcement. Both systems ship in the same SOMA family aesthetic and inform each other's evolution.

The SOMA Voxel visual theme (18 bar-block types: `🧊 SOMA Insight`, `🤖 Agent Report`, `★ Sprint Pulse`, and 15 others) originated in the SomaCanvas family and is documented in `core/docs/output-style.md`. Install places a copy at `~/.claude/output-styles/soma-voxel.md`.
