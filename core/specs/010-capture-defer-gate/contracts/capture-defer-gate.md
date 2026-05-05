# Contract: Tool Call — capture-defer-gate (Stop hook)

**Contract ID:** CONTRACT-CAPTURE-DEFER-GATE-01
**spec_ref:** [SPEC:AC-01..AC-15]
**Created:** 2026-05-02
**Type:** Claude Code Stop event hook (.cjs, registered in `~/.claude/settings.json`)

---

## Tool Name

```
~/.claude/hooks/capture-defer-gate.cjs
```

Hook event: `Stop` (Claude Code lifecycle — runs before Stop event finalizes turn)

---

## Description

Detects "defer-and-forget" anti-pattern (failure mode #8) at end-of-turn: scans assistant turn output for defer-phrases (en + pt-br), verifies capture target reference in current OR last turn, emits warning (soft-warn mode default) OR blocks turn (hard-block mode opt-in via env var). Logs every detection to JSONL telemetry for Article XI ratification decision.

---

## Input (stdin JSON, Claude Code Stop hook contract)

```json
{
  "session_id": "string",
  "transcript_path": "/path/to/transcript.jsonl",
  "stop_hook_active": true | false,
  "hookSpecificInput": {
    "stop_reason": "end_turn" | "tool_use" | "max_tokens" | ...
  }
}
```

Hook reads `transcript_path` (JSONL) to access last 2 assistant turns for multi-turn search (D1 lock).

---

## Output

### Soft-warn mode (default — `ARTICLE_XI_HARD` env unset OR `=0`)

#### Defer detected + captured (status `captured`)
- stdout: empty
- stderr: empty
- exit code: 0
- side effect: telemetry entry written

#### Defer detected + uncaptured (status `uncaptured`)
- stdout: empty
- stderr: human-readable warning ("Article XI WARN: defer-phrase '...' detected without capture target")
- exit code: 0
- side effect: telemetry entry written
- TURN NOT BLOCKED

#### No defer detected
- stdout: empty
- stderr: empty
- exit code: 0
- no telemetry entry

### Hard-block mode (`ARTICLE_XI_HARD=1`)

#### Defer detected + uncaptured → BLOCK
- stdout: JSON `{"decision": "block", "reason": "..."}` (Stop hook block contract)
- stderr: empty
- exit code: 1
- side effect: telemetry entry written

#### Defer detected + captured → ALLOW
- stdout: empty
- exit code: 0
- side effect: telemetry entry written

### Override paths (regardless of mode)

#### Marker file `/tmp/article-xi-bypass-{sessionId}` exists
- exit code: 0 immediately, zero scanning, zero telemetry

#### Env var `ARTICLE_XI_DISABLED=1`
- exit code: 0 immediately, zero scanning, zero telemetry

---

## Defer-phrase patterns (D2 lock — en + pt-br)

### English
```
/\bwe(['']ll| will) (do|handle|tackle|implement|build|add|fix) [\w\s-]+ later\b/i
/\bpost-?(phase|sprint|wave|step) \w+/i
/\bdeferred? to (next|later|future) (session|turn|sprint|phase)\b/i
/\bout of scope (for now|for v1)?\b/i
/\bfuture work\b/i
/\bTODO\b(?!.*(specs?\/[0-9]{3}|handoff-|memory\/|ADR-))/  // TODO without ticket reference
/\bFIXME\b(?!.*(specs?\/[0-9]{3}|handoff-|memory\/|ADR-))/
```

### Portuguese (pt-br)
```
/\bvamos? (fazer|implementar|adicionar|resolver|tratar) [\w\s-]+ depois\b/i
/\bfica pra (próxima|proxima|outra) sessão/i
/\bdeferid[oa]\b/i
/\bfora de escopo\b/i
/\bpra (Phase|fase|sprint|wave) \w+/i
```

(Phrase regex non-exhaustive; final list locked in hook source.)

---

## Capture target patterns (regex)

```
/~\/.claude\/plans\/handoff-[a-z0-9-]+\.md/i
/~\/.claude\/projects\/[\w-]+\/memory\/[\w-]+\.md/i
/specs\/[0-9]{3}-[a-z0-9-]+\/spec\.md/i
/\.soma\/decisions\/ADR-[0-9]{4}-[a-z0-9-]+\.md/i
/\.soma\/CONTEXT\.md/i
/handoff bucket [A-Z](?:\.[a-z])?/i  // e.g., "handoff bucket A.bis"
/memory entry [a-z_]+/i              // e.g., "memory entry project_soma"
```

---

## Telemetry schema (JSONL append-only)

File: `~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl`

Per-line:
```json
{
  "schema": "article-xi-telemetry/v1",
  "timestamp": "2026-05-02T17:42:11Z",
  "session_id": "string",
  "phrase_matched": "post-Phase 5",
  "phrase_locale": "en" | "pt-br",
  "status": "captured" | "uncaptured",
  "capture_target": "specs/008-soma-bootstrap/spec.md" | null,
  "search_scope": "current" | "previous-turn",
  "hard_mode": true | false,
  "blocked": true | false
}
```

---

## Side Effects

- **Append** to `~/.claude/logs/article-xi-{date}.jsonl` (only when phrase detected)
- Read-only: `transcript_path` JSONL
- Read-only: `~/.claude/CLAUDE.md` (NOT modified by hook)
- Stdout: `decision: block` JSON only when hard-block triggers
- Stderr: human warning only when soft-warn triggers

---

## Idempotency

- **Idempotent:** yes (re-running same input → same decision)
- Each invocation appends 1 telemetry entry per phrase detected (so re-scans of same turn would duplicate; hook is invoked exactly once per turn end by Claude Code, so no real duplication)

---

## Performance contract

- **Wallclock:** ≤50ms p95 per invocation (regex over ~10KB output + transcript read)
- Excludes external network (none)
- Hook latency budget tight pra not delay turn Stop event UX

---

## Error handling

- **Malformed stdin JSON**: stderr warning + exit 0 (hook fails open — never block legitimate turn due to internal error)
- **Missing transcript_path**: skip multi-turn search + scan current turn only (graceful degradation)
- **Telemetry log write fails (disk full)**: stderr warning + continue (non-fatal)

---

## Contract Test Stub

```javascript
// @spec AC-01..AC-15
// @contract CONTRACT-CAPTURE-DEFER-GATE-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('detects defer-phrase + captures status when target referenced', () => {
  const stdin = JSON.stringify({
    session_id: 'test-session',
    transcript_path: '/tmp/test-transcript.jsonl',
    hookSpecificInput: { stop_reason: 'end_turn' }
  });
  // setup: transcript with assistant output containing defer + capture
  const result = spawnSync('node', ['~/.claude/hooks/capture-defer-gate.cjs'], {
    input: stdin
  });
  assert.equal(result.status, 0);
  // assert telemetry entry: status="captured"
});

test('hard-block mode blocks turn when uncaptured defer', () => {
  const stdin = /* transcript with uncaptured defer */;
  const result = spawnSync('node', ['~/.claude/hooks/capture-defer-gate.cjs'], {
    input: stdin,
    env: { ...process.env, ARTICLE_XI_HARD: '1' }
  });
  assert.equal(result.status, 1);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, 'block');
});

test('marker file bypass skips entirely', () => {
  // touch /tmp/article-xi-bypass-test-session
  // assert exit 0 immediately
});
```

---

## Tracebility

| AC | Output behavior | Test |
|---|---|---|
| AC-01 | en defer-phrase detected | detect-en-phrases.test |
| AC-02 | pt-br defer-phrase detected | detect-ptbr-phrases.test |
| AC-03 | no defer → exit 0 + zero telemetry | no-defer-passthrough.test |
| AC-04 | captured target → status:captured | capture-target-recognized.test |
| AC-05 | uncaptured + soft-warn → stderr only | soft-warn-mode.test |
| AC-06 | uncaptured + hard-block → exit 1 + JSON decision | hard-block-mode.test |
| AC-07 | marker file bypass | marker-bypass.test |
| AC-08 | env var disabled bypass | env-disabled-bypass.test |
| AC-09 | telemetry JSONL schema | telemetry-write.test |
| AC-10 | JSONL parseable per-line | telemetry-parseable.test |
| AC-11 | multi-turn search (current + last 1) | multi-turn-search.test |
| AC-12 | soft-warn default mode | soft-warn-default.test |
| AC-13 | hard-block via env var | hard-block-env.test |
| AC-14 | ≥30 hook tests pass | (test count assertion in regression) |
| AC-15 | hooks/*.test.cjs aggregate 49/49 | phase010-regression.test |
