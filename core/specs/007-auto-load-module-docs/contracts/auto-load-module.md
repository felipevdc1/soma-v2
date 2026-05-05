# Contract: Tool Call — subagent-init.cjs auto-load module docs hook extension

**Contract ID:** CONTRACT-AUTO-LOAD-MODULE-01
**spec_ref:** [SPEC:AC-01..AC-18]
**Created:** 2026-05-02
**Type:** internal hook (extension to `~/.claude/hooks/subagent-init.cjs` PreSubagentSpawn flow)

---

## Tool Name

```
~/.claude/hooks/subagent-init.cjs (extended)
~/.claude/hooks/lib/auto-load-modules.cjs (NEW helper)
```

PLUS: `~/.soma-v2/scripts/doctor.cjs --check-context-routing` (extension flag)

---

## Description

Hook extension that scans agent dispatch task description for keywords, matches them against `.soma/CONTEXT.md` routing table, resolves up to 2 active modules from `.soma/modules/{slug}.md`, and injects markdown content into the spawned agent's system prompt. Per-project routing only (D6). Token budget cap default 5KB (D2/D3). Layer priority: roots > trunk > leaves; alphabetical tie-break (D4). Defensive failure mode — hook errors do NOT block dispatch (D8).

---

## Inputs

### subagent-init.cjs hook invocation

Hook is invoked by Claude Code harness PreSubagentSpawn (or equivalent existing hook lifecycle that subagent-init.cjs already participates in — Phase 2 pattern: injection of Constitution + FAMILY_DOC + Spec AC).

Input shape (existing convention; D8 — Sonnet validates empirically):
- task description (from spawn context — Agent tool prompt)
- project root (cwd-derived OR env)
- subagent_type / model

### Auto-load logic input

```json
{
  "task_description": "string (full prompt text)",
  "project_root": "/abs/path/to/project (containing .soma/)",
  "token_cap": 5120,
  "max_modules": 2,
  "context_md_path": ".soma/CONTEXT.md"
}
```

### CONTEXT.md schema (NEW file, soma-context/v1)

```markdown
---
schema: soma-context/v1
project: my-project
last_updated: 2026-05-02T14:30:00Z
---

# Module Context Routing

| Keyword       | Module Slug   |
|---------------|---------------|
| auth          | auth-system   |
| billing       | billing       |
| webhook       | webhooks      |
```

Front-matter parsed via `~/.soma-v2/scripts/lib/module-store.cjs::parseFrontMatter` (Phase 4c).
Body table parsed via simple regex per row: `^\| (\S[^|]*?) \s*\|\s* (\S[^|]*?) \s*\|`.

---

## Outputs

### Auto-load logic output (returned to caller in subagent-init.cjs)

```json
{
  "schema": "soma-auto-load-result/v1",
  "matched_keywords": ["auth", "webhook"],
  "candidate_modules": [
    { "slug": "auth-system", "score": 2, "layer": "trunk", "status": "active" },
    { "slug": "webhooks", "score": 1, "layer": "leaves", "status": "active" }
  ],
  "loaded_modules": [
    { "slug": "auth-system", "bytes": 2048, "content": "<markdown body>" },
    { "slug": "webhooks", "bytes": 1024, "content": "<markdown body>" }
  ],
  "skipped_modules": [
    { "slug": "billing", "reason": "status:hypothesis (filter)" }
  ],
  "warnings": [
    /* e.g. { "code": "TOKEN_BUDGET_EXCEEDED", "message": "..." } */
  ],
  "injection_text": "--- soma-auto-loaded-module: auth-system (layer: trunk) ---\n<content>\n--- end module ---\n\n--- soma-auto-loaded-module: webhooks (layer: leaves) ---\n<content>\n--- end module ---"
}
```

### Injection format (D5)

Injected into agent system prompt as plain text appended:

```
--- soma-auto-loaded-module: {slug} (layer: {layer}) ---
{markdown body without front-matter}
--- end module ---
```

Multiple modules: separated by `\n\n` between blocks.

### `soma doctor --check-context-routing` JSON output

```json
{
  "schema": "soma-doctor/v1",
  "project": "/path",
  "context_routing": {
    "context_md_present": true,
    "keywords_count": 8,
    "broken_refs": [
      { "keyword": "auth", "slug": "auth-system", "reason": "module file not found" },
      { "keyword": "old-api", "slug": "legacy", "reason": "status:deprecated" }
    ]
  },
  "findings": [
    { "severity": "warning", "code": "BROKEN_CONTEXT_ROUTING", "keyword": "auth", "slug": "auth-system", "reason": "module file not found" }
  ],
  "error": null
}
```

**Error codes:**

| Code | When | Exit |
|---|---|---|
| `CONTEXT_MD_PARSE_ERROR` | CONTEXT.md malformed YAML front-matter or invalid table syntax | 1 (doctor only; hook degrades silently per D8) |
| `BROKEN_CONTEXT_ROUTING` | Doctor finding code (warning, non-blocking) — keyword routes to nonexistent/deprecated module | 0 (warning per D7) |
| `TOKEN_BUDGET_EXCEEDED` | Hook warning — 2 modules selected but combined size > token_cap | (logged, hook continues with truncation) |

---

## Side Effects

- **Reads:** `.soma/CONTEXT.md`, `.soma/modules/{slug}.md` files
- **Writes:** none (read-only hook execution)
- **Stderr:** info/warning logs per AC-09/AC-10/AC-11/AC-18 (defensive logging)
- **Stdout:** injection content via existing subagent-init.cjs prompt-injection mechanism (D8 reuse)

---

## Idempotency

- **Idempotent:** yes — same task_description + same CONTEXT.md state + same modules → same loaded_modules + injection_text
- Hook is stateless (no caching, no side effects)

---

## Contract Test Stub

```javascript
// @spec AC-01..AC-18
// @contract CONTRACT-AUTO-LOAD-MODULE-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tmpProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-autoload-')); }

test('AC-01+AC-02: hook reads task + parses CONTEXT.md soma-context/v1', () => { /* ... */ });
test('AC-03: keyword matching case-insensitive substring', () => { /* "Authenticate" matches "auth" */ });
test('AC-04: max 2 modules cap enforced', () => { /* 3 keywords match → only 2 loaded */ });
test('AC-05: token budget exceed → truncate to 1 highest score + warn', () => { /* ... */ });
test('AC-06: status filter — only active modules loaded', () => { /* hypothesis + deprecated skipped */ });
test('AC-07: tie-break — roots > trunk > leaves; alphabetical within layer', () => { /* ... */ });
test('AC-08: injection format — delimited markdown block per module', () => { /* ... */ });
test('AC-09: no CONTEXT.md → silent skip', () => { /* ... */ });
test('AC-10: zero keyword match → silent skip', () => { /* ... */ });
test('AC-11: all candidates filtered out by status → warning loud', () => { /* ... */ });
test('AC-12: CONTEXT.md schema parsing — front-matter + table', () => { /* ... */ });
test('AC-13: doctor --check-context-routing iterates refs', () => { /* ... */ });
test('AC-14: broken refs emitted as severity:warning findings', () => { /* ... */ });
test('AC-15: integration — modules content reaches child agent system prompt', () => {
  /* deferred validation: requires Claude Code harness integration; Sonnet researches existing pattern */
});
test('AC-16: backward compat — 571/571 + 47/47 + 48/48 + shasums preserved', () => { /* ... */ });
test('AC-17: SOMA_AUTO_LOAD_TOKEN_CAP env var override', () => { /* ... */ });
test('AC-18: hook error → defensive degrade (dispatch proceeds)', () => { /* ... */ });
```

---

## Notes

- TDD HARD per Article II + C-2 (`SOMA_RED_PHASE_STRICT=1`)
- D8 research-first directive: Sonnet reads existing `~/.claude/hooks/subagent-init.cjs` (465L Phase 2 baseline) ANTES de implementar; pattern reference é existing Constitution/FAMILY_DOC/Spec AC injection. Se PreSubagentSpawn não suporta auto-load injection (e.g. lifecycle restriction), Sonnet reports partial back to orchestrator
- New helper `~/.claude/hooks/lib/auto-load-modules.cjs` follows existing `lib/` pattern (`ck-config-utils.cjs`, `ck-paths.cjs`, `context-tracker.cjs`)
- CONTEXT.md is per-project (D6) — lives at `{project}/.soma/CONTEXT.md` — projects sem CONTEXT.md → silent skip (AC-09)
- Reuses Phase 4c `~/.soma-v2/scripts/lib/module-store.cjs::parseFrontMatter` for module file parsing — via require, NÃO copy (shasum baseline preserve)
- Reuses Phase 4d `~/.soma-v2/scripts/lib/foundation-check.cjs::resolveModuleLayer` for layer priority resolution
- doctor extension (--check-context-routing flag) lives em `~/.soma-v2/scripts/doctor.cjs` — already Phase 2/4c/4d/4d-bis extended; well-trodden pattern
