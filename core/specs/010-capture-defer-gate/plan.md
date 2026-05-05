# Plan: Article XI Capture-or-Defer Gate Hook

**Feature ID:** 010-capture-defer-gate
**Spec:** `specs/010-capture-defer-gate/spec.md`
**Created:** 2026-05-02
**Status:** APPROVED

---

## Technical Approach

Sprint 010 ships a single self-contained Stop hook `~/.claude/hooks/capture-defer-gate.cjs` (~250-350 LOC) that intercepts every assistant turn end-of-generation, scans output text for defer-phrases (en + pt-br regex lists D2), verifies same-turn or last-turn capture target reference (regex over `~/.claude/plans/handoff-*`, `memory/*`, `specs/{NNN}/spec.md`, `.soma/decisions/ADR-*`, `.soma/CONTEXT.md` patterns), and emits decision per mode (soft-warn default = stderr only + exit 0; hard-block opt-in via `ARTICLE_XI_HARD=1` env = stdout decision JSON + exit 1). Multi-turn search reads `transcript_path` JSONL (Claude Code Stop hook contract) following the auto-load-modules.cjs precedent shipped in C-1 Phase 4d. Telemetry persists to `~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl` for the 30-day Article XI ratification decision (Phase 5+). Override mechanisms (3): marker file `/tmp/article-xi-bypass-{sessionId}` (turn-pontual), env var `ARTICLE_XI_DISABLED=1` (session-wide), env var `ARTICLE_XI_HARD=0|1` (mode toggle).

**Stack:**
- Runtime: Node.js v22 (matches hooks ecosystem)
- Framework: vanilla CommonJS `.cjs` + Node stdlib only (matches existing hooks: depth-guard, hyd-gate, cognitive-gate, spec-test-traceability, etc.)
- Storage: filesystem (read transcript JSONL, append telemetry JSONL, no DB)
- Test runner: `node:test` + `node:assert/strict`

**Rationale:** Single-file hook matches existing pattern (depth-guard 250L, hyd-gate 380L, cognitive-gate 200L). No new lib needed — regex patterns and decision logic small enough to inline. Telemetry JSONL daily-rotation is greppable + zero deps.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** Single self-contained hook file (NO new lib in `hooks/lib/`) | Hook size ~300 LOC; existing pattern (depth-guard.cjs / hyd-gate.cjs) is single-file; lib introduction is YAGNI for MVP. Phase 5+ may extract patterns to lib if 2nd hook needs same regex. | Extract phrase patterns + capture target patterns to `hooks/lib/article-xi-patterns.cjs`. Rejected: premature abstraction; only 1 consumer. |
| **AD-02:** Multi-turn search reads `transcript_path` JSONL directly (mirror C-1 auto-load-modules pattern) | C-1 (Phase 4d) shipped this pattern — read transcript JSONL, parse last N entries, extract assistant content. Reuse identical approach for D1 lock (current + last 1 turn). | Cache turn output to `/tmp/article-xi-last-turn-{sessionId}.txt`. Rejected: cache invalidation complexity, race conditions with rapid sequential turns. |
| **AD-03:** Telemetry = JSONL daily-rotation (NOT SQLite, NOT remote) | Append-only JSONL is simplest. Daily rotation prevents single-file unbounded growth. Greppable + jq-friendly for review. Phase 5+ can ETL to SQLite if analysis tooling justifies. | SQLite database em `~/.claude/logs/article-xi.db`. Rejected: introduces sqlite dep + lock concerns; overkill for 30-day telemetry MVP. |
| **AD-04:** Soft-warn ↔ hard-block toggle via env var (NOT config file) | Env var is simplest override; matches existing gate patterns (`HYD_ENFORCE`, `COGNITIVE_GATE_*`). No config file = no lock issues, no schema migrations. | YAML config em `~/.claude/article-xi.yaml`. Rejected: introduces yaml parser dep; complexity > value for 1-bit toggle. |
| **AD-05:** Phrase lists inline JS arrays (en + pt-br) | Patterns ~10-15 each; inline keeps hook self-contained + grep-debuggable. Modifying patterns = edit hook source = git-trackable diff. | External `~/.claude/hooks/article-xi-phrases.json`. Rejected: another file to maintain; loading adds 1-3ms; YAGNI. |
| **AD-06:** Capture target = regex pattern match ONLY (NOT fs.existsSync verification) | Spec D Out of Scope: hook checks PATH PATTERN, không verifies file actually exists. Verification depth = Phase 5+ enhancement if false-positive rate justifies. Avoids 1-3 disk hits per turn. | `fs.existsSync(capturePath)` per match. Rejected: perf hit (3-10ms p95 added) + filesystem race (file might exist but be empty/corrupt). |
| **AD-07:** Hook event = `Stop` (NOT `PreToolUse`) | Stop event fires at end-of-turn = correct moment to scan complete turn output. PreToolUse fires per tool call (too granular + misses pure-text turns). | Subscribe to `PreToolUse` + check stop reason. Rejected: incorrect lifecycle binding; doubles hook invocations per turn. |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — adds 1 NEW hook file (`capture-defer-gate.cjs`) + 1 NEW test file (`capture-defer-gate.test.cjs`). Total: 2 new components. ≤3 ✓
- [x] **Anti-Abstraction Gate** — uses Node stdlib (`fs`, `path`, `process`) directly. Inline regex arrays. No wrappers, no helpers, no factories.
- [x] **Integration-First Gate** — all tests via real stdin JSON fixtures + real transcript JSONL files in `/tmp/article-xi-fixture-{slug}/`. Zero mocks. TDD HARD per Article II + C-2 enforcement.

All gates **PASS**.

---

## Complexity Tracking

(No gate violations; section blank.)

---

## Dependencies

**External packages:** none (stdlib only)

**Internal artifacts (read-only references):**
- `~/.soma-v2/docs/constitution-amendments/article-xi-capture-imperative.md` — Layer 2 draft (defines defer-phrases + capture targets canonical lists)
- `~/.claude/hooks/lib/auto-load-modules.cjs` — pattern reference for transcript_path JSONL reading (C-1 Phase 4d)
- `~/.claude/hooks/spec-test-traceability.cjs` — pattern reference for git heuristic + stdin JSON parsing
- `~/.claude/CLAUDE.md` Failure Mode #8 — semantic basis

**Hook registration (post-impl, post-user-approval):**
- Add entry to `~/.claude/settings.json` `hooks.Stop[]` array

---

## References

- Spec: `specs/010-capture-defer-gate/spec.md`
- Contracts: `contracts/capture-defer-gate.md` (CONTRACT-CAPTURE-DEFER-GATE-01)
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles II (TDD HARD), VII (Simplicity), Article XI candidate (DRAFT in `~/.soma-v2/docs/constitution-amendments/article-xi-capture-imperative.md`)
- Memory: `~/.claude/CLAUDE.md` Failure Mode #8 (defer-and-forget) — semantic origin
- Capture Before Defer Layer 1+2 SHIPPED 2026-05-01; Layer 3 = this spec
