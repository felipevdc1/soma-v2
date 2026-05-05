# Constitution Amendment Candidate — Article XI: Capture Imperative

**Status**: DRAFT — pending ratification (Phase 5+)
**Proposed**: 2026-05-01 (user ratification: Q4 in §12 closure session)
**Source**: Failure mode #8 (defer-and-forget) discovered empirically in Path A session 2026-05-01
**Enforcement layer**: HARD (when ratified)

---

## Article XI — Capture Imperative

No work item may be acknowledged and deferred without simultaneous capture in a durable artifact. Conversational acknowledgment without capture is prohibited.

**Durable capture targets** (one of):
- `~/.claude/plans/handoff-{project}.md` bucket entry
- `~/.claude/projects/{user}/memory/{project}.md` entry
- `specs/{NNN}-{slug}/spec.md` Out-of-Scope section
- `.soma/decisions/ADR-NNNN-{slug}.md` (per-project ADR)
- Project `.soma/CONTEXT.md` routing notes

**Defer-phrase triggers** (require capture before deferral lands):
- "we'll do X later"
- "post-Phase Y"
- "deferred to next session"
- "out of scope for now"
- "future work"
- "TODO" without ticket/file reference
- "FIXME" without ticket/file reference

**Capture metadata required**:
- Item description (what is being deferred)
- Target file path where item is captured
- Timestamp (ISO 8601)
- Reason for deferral (size? dependency? priority?)

## Rationale

Failure mode #8 (defer-and-forget) was discovered empirically: in Path A session 2026-05-01, repeated proposals to "defer X to next session" left 9 simulation gaps (G1-G9) + 3 priority decisions (R3-R4) in conversational-only context. The user caught the pattern: "TUDO É PRIORIDADE, NADA DEVE SER DEIXADO PRA TRÁS... isso deve existir e ser obrigatório no SOMA".

Without enforcement, the pattern reasserts. Conversational acknowledgment FEELS like capture (we said it, didn't we?) but is volatile. Sessions end. Context windows fill. Items vanish. They reappear later as if new — wasting context, eroding trust, breaking project memory continuity.

## Enforcement (Phase 5+)

Hook `capture-or-defer-gate.cjs` (PreToolUse on Stop event):

1. Scan assistant turn output for defer-phrase regex
2. For each defer-phrase, search same-turn + previous-turn output for explicit capture target reference (file path matching durable capture target patterns)
3. If gap (defer-phrase without target) → soft warn first 30 days, hard block after stabilization
4. Block error message names the defer-phrase + suggests capture target

Schema additions (Phase 5+):
- `soma-handoff/v1` ganha field `deferred_items: [{item: string, captured_at: file_path, captured_when: ISO8601, reason: string}]`
- `soma-evidence/v1` ganha `outstanding_followups: [{description, target_capture_path, due: ISO8601 or null}]`

## Relationship to existing Articles

- **Article I (Spec as Source of Truth)**: ADR captures complement spec; deferred decisions become ADR drafts.
- **Article IV (Proof Before Done)**: capture is part of proof; "we'll do X" without capture is a false claim of completeness.
- **Article VIII (FAMILY_DOC)**: capture entries flow into FAMILY_DOC for cross-session continuity.
- **Article IX (Explicit Human Gates)**: deferred items requiring user ratification become explicit gate items, captured per this Article.

## Ratification path

1. **Now (2026-05-01)**: Drafted as candidate (this file). Karpathy #5 ships as Behavioral Baseline equivalent in `project.md.tmpl`.
2. **Phase 5 prep**: Hook `capture-or-defer-gate.cjs` implemented in soft-warn mode. Telemetry collected for 30 days.
3. **Phase 5 stabilization**: If telemetry shows hook detects real defer-and-forget patterns without false-positive flood, ratify Article XI as part of Constitution v1.0.0 → v1.1.0 amendment.
4. **Snapshot-lock implication**: Existing runs locked at v1.0.0 unaffected; new runs post-amendment use v1.1.0.

## Backout path (if amendment fails post-trial)

If hook produces excessive false positives or developer fatigue:
1. Mark Article XI as DEPRECATED-AT-{date}
2. Keep Karpathy #5 in Behavioral Baseline (lighter enforcement)
3. Log retro in failure log explaining why HARD enforcement didn't work

## See also

- `~/.claude/CLAUDE.md` Failure Mode #8 (personal self-model equivalent)
- `~/.soma-v2/templates/project/.soma/project.md.tmpl` Karpathy #5 (Behavioral Baseline equivalent)
- `~/.claude/plans/como-voce-faria-para-snazzy-coral.md` Section "Sequential Execution Plan" (origin)
- Failure Log entry 2026-05-01 in CLAUDE.md
