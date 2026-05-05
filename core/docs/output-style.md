# SOMA Voxel Theme — Output Style Reference (Canonical)

> Canonical source for the SOMA family visual aesthetic — used by the orchestrator,
> sub-agents, and status updates across SOMA-enabled projects.
>
> **Reference layer:** `~/.claude/CLAUDE.md` §"Output Style — SOMA Voxel Theme"
> points here. If files diverge, this canonical wins.
>
> **Origin:** `SOMA-INSIGHT-THEME.md` (Bruno Moreira / SomaCanvas family),
> internalized into SOMA-v2 docs as canonical on 2026-05-01.

---

## When to use

ALWAYS use themed visual bar blocks for:
- Status updates
- Agent reports (when subagents complete work)
- Learnings / architectural insights
- Sprint / wave / milestone transitions
- Memory captures / pattern documentation

Do NOT use bar blocks for:
- Casual conversational replies
- Short clarifying questions
- Inline tool-result acknowledgements

The block convention exists to mark moments of signal — not as filler. If every reply uses a block, the block stops carrying weight.

---

## 18 bar-block types

```
🧊 SOMA Insight ═══   → architectural discoveries, learnings
🤖 Agent Report ───   → when agents complete work (SHA, files, tests)
★ Sprint Pulse ═══   → phase/wave status changes
🧬 Memory Saved ═══   → when saving lessons or patterns
🏗️ Team Status ───   → team coordination and agent states
⚠️ Warning ▬▬▬       → errors, failures, attention needed
🔎 SONAR ┅┅┅         → pre-sprint scans and exploration
📋 Finding ━━━        → issues to triage
🎯 Mission Brief ═══  → track/sprint kickoff
💎 Crystal AI ✦✦✦    → AI-assisted generation
🌍 World Update ∿∿∿   → VoxelOS/4D spatial changes
🔌 Wire Check ⊕─⊕    → port/wire validation
📊 Health Metrics ▓▒░ → code quality numbers
🚀 Deploy Ready ━━━   → pre-ship checklist
💀 Dead Code ☠─☠     → verified dead code
🧪 Test Report ⚗─⚗   → test breakdown by target
🔐 Security Gate ═══  → Red Team validation
⚡ Quick Win ⚡─⚡    → small victories
```

---

## Canonical format

The 🧊 SOMA Insight block is the most-structured form — use the slots that apply, drop the rest:

```
`🧊 SOMA Insight ═══════════════════════════════`
🔍 Discovery: [what was found]
🧠 Learning: [pattern or technique]
💎 Architecture: [why it matters for SOMA]
🚧 Deferred: [what was punted + why — or "none"]
❓ Missing: [unresolved / still needs attention]
📌 Notes: [caveats, blockers, cross-refs]
`═══════════════════════════════════════════════`
```

Other block types follow the same opening/closing-bar convention; the inner slot labels adapt to the block's intent (e.g. 🤖 Agent Report uses `STATUS:` / `SHA:` / `Files changed:` / `Tests output:` / `Surprises:`).

### Block-specific slot conventions

**🤖 Agent Report**
```
STATUS: [pass/fail/blocked]
SHA: [commit ref]
Files changed: [list]
Tests output: [N/N pass, duration]
Surprises: [unexpected findings — or "none"]
```

**★ Sprint Pulse**
```
PHASE: [phase/wave name]
FROM → TO: [previous state → new state]
Reason: [trigger]
Next: [next step]
```

**🧬 Memory Saved**
```
WHAT: [lesson / pattern / decision]
WHY: [rationale or reference incident]
WHERE: [file path or memory entry]
```

**🏗️ Team Status**
```
TEAMMATES: [active agent count]
WORKING ON: [task per teammate]
BLOCKERS: [or "none"]
```

**⚠️ Warning**
```
WHAT: [error / failure]
WHERE: [location]
ACTION: [recommended next step]
```

**🎯 Mission Brief**
```
TRACK: [track-NNN or sprint name]
GOAL: [success criteria]
DURATION: [estimate]
GUARDRAILS: [what NOT to do]
```

For the remaining 11 block types, use slot labels that match the block's intent (e.g. 🚀 Deploy Ready → checklist with binary pass/fail markers; 📊 Health Metrics → numeric values with thresholds).

---

## Tone

- **Portuguese-BR** for casual chat
- **English** for code, commit messages, file content
- Energetic and confident
- Emojis used naturally (not decoratively — each emoji carries semantic weight in this theme)

---

## Origin

The visual template is the SOMA family aesthetic. Originally hosted in the `somaflow` plugin within SomaCanvas; internalized into individual projects' `CLAUDE.md` so each project owns its style without coupling to a plugin that may be disabled (per SomaCanvas's `.claude/settings.json` JFLOW-only policy).

**Initial adoption (2026-05-01)**: installed as canonical at `${SOMA_HOME}/docs/output-style.md` with reference pointer in `${CLAUDE_HOME}/CLAUDE.md`. Native Claude Code output-style at `${CLAUDE_HOME}/output-styles/soma-voxel.md` may be created later if the harness selector pattern is preferred over global injection.

---

## Reuse in other SOMA-enabled projects

To adopt this theme in another SOMA-family project:
1. Reference this canonical from that project's CLAUDE.md (preferred — single source of truth).
2. Or copy the "18 bar-block types" + "Canonical format" sections into that project's `CLAUDE.md` under a `## Output Style` section if reference indirection is undesirable.
3. The orchestrator/agent persona in that project then renders status updates using these blocks.

---

## Insight → Action Coupling (MANDATORY)

🧊 SOMA Insight blocks signal **discovery moments**. An insight without downstream action becomes decorative noise — future-self snitches present-self about a problem, but nothing is done with the information. The discovery evaporates at session end and the same lesson gets re-learned later.

### Rule

Every 🧊 SOMA Insight block rendered in an assistant turn **MUST be paired with at least one** of the following coupling actions within the same turn:

1. 🧬 **Memory Saved block** with `WHAT/WHY/WHERE` slots — concrete file path indicating durable cross-session persistence
2. 🎯 **Mission Brief block** with `TRACK/GOAL/DURATION/GUARDRAILS` — triggering dispatch or work plan (in-session resolution)
3. **Tool-use evidence** — `Edit`, `Write`, or `Task` tool invocation that materializes capture (memory entry, plan file, spec amendment, ADR, handoff bucket, hook code, etc.)
4. **Explicit "Capture target:" line** — nominal reference to durable target (e.g., `Capture target: ~/.claude/plans/handoff-X.md bucket Y`, `Capture target: memory R-NN`, `Capture target: ADR-0042`)
5. **Decision lock** — `D-Cx:` prefix declaring architectural lock (e.g., `D-C16: ...`)

Any one of the five satisfies the rule. Multi-track Insights (architectural + durable + actionable) commonly trigger 2-3 simultaneously.

### Why

Decoupled-Insight is the same anti-pattern as defer-and-forget (failure mode #8): future-self captured a discovery, but no anchor in durable storage means it evaporates. Insights are valuable PRECISELY because they emerged from work — losing them wastes the discovery and forces re-discovery later.

The 18-block taxonomy separates 🧊 Insight (discovery moment) from 🧬 Memory Saved (persistence moment) **because they should couple, not substitute**. Coupling is the protocol — separation of concerns is the form, coupling is the contract.

### Enforcement

**Default — soft-warn**: `~/.claude/hooks/insight-action-coupling.cjs` Stop hook scans the last assistant turn. If 🧊 Insight is detected without any of the 5 coupling action signatures present in the same turn, the hook emits a stderr warning + writes JSONL telemetry to `~/.claude/logs/insight-coupling-{YYYY-MM-DD}.jsonl` (schema `insight-coupling/v1`). Exit code 0 — non-blocking.

**Hard-block** (env `INSIGHT_COUPLING_HARD=1`): same scan but escalates violations to exit code 1, preventing clean turn completion. Use after telemetry indicates ≥80% coupling rate over 30+ turns to lock the rule in structurally.

**Telemetry schema** (`insight-coupling/v1`):
```json
{
  "schema": "insight-coupling/v1",
  "ts": "ISO-8601",
  "session_id": "string",
  "insight_blocks_count": "integer",
  "coupling_actions_detected": ["memory_saved" | "mission_brief" | "tool_use" | "capture_target_line" | "decision_lock"],
  "coupling_status": "valid" | "violated",
  "hard_mode": "boolean",
  "violation_excerpt": "string (first 200 chars of offending Insight, only when violated)"
}
```

### Future propagation (cross-harness scope)

Layer 4 hook is currently Claude Code-specific (Stop hook architecture). Future LLM-agnostic harness extraction Phase 6+ will require equivalent enforcement in cursor/aider/chatgpt-desktop adapters via their respective hook or post-action mechanisms.
