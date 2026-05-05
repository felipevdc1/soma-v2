# Contract: Claude CLI Invocation (sense-making layer)

**Type:** External binary spawn contract (LLM tool boundary)
**Spec ACs served:** AC-05, AC-06, AC-07, AC-08, AC-15

---

## Spawn pattern

```js
const { spawnSync } = require('node:child_process');
const result = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], {
  timeout: timeoutMs,            // default 30000
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

**Pre-flight check** (AC-07):
```js
const which = spawnSync('which', ['claude'], { encoding: 'utf-8' });
if (which.status !== 0) {
  return { used: false, warning: { code: 'CLAUDE_CLI_NOT_FOUND', message: '...' } };
}
```

---

## Prompt construction (AC-15 redaction policy)

Prompt template loaded from `~/.soma-v2/templates/audit-prompt.md`. Template interpolation receives:

**ALLOWED context fields** (Q6 lock — header + signatures):
- `module.path` (string)
- `module.loc` (integer)
- `module.exports[]` (array of names — string only, no values)
- `module.recent_commits[]` (sha + date + subject only)
- `module.test_count` (integer)
- `module.help_text` (raw `--help` stdout, captured if module is CLI)
- `module.header_comment` (top comment block — lines until first non-comment line)
- `module.export_signatures[]` (function signatures only — `function foo(a, b)`, no body)

**FORBIDDEN context fields** (AC-15):
- Raw function bodies
- Inline literals (object literals, string contents beyond signatures)
- Environment variable values
- Test file contents

**Template structure** (`audit-prompt.md`):
```markdown
You are auditing a SOMA module to support a future /specify invocation.

## Module facts
Path: {{module.path}}
LOC: {{module.loc}}
Test count: {{module.test_count}}

## Header comment
{{module.header_comment}}

## Exports
{{#module.exports}}- {{.}}{{/module.exports}}

## Export signatures
{{#module.export_signatures}}- {{.}}{{/module.export_signatures}}

## Recent commits (last 10)
{{#module.recent_commits}}- {{sha}} {{date}} — {{subject}}{{/module.recent_commits}}

## Help text
{{module.help_text}}

## Task
Return JSON with:
- capabilities[]: what this module CAN do today (one phrase per item)
- bugs[]: empirical bugs/gaps you can infer (severity: low|medium|high; source: which fact above led you)
- recent_changes[]: human-readable summary of last 10 commits
- recommended_spec_scope: one-paragraph guidance for a /specify invocation that extends this module — what to avoid (already done) and what to include (gaps).

Respond ONLY with raw JSON, no markdown fences.
```

---

## Expected output (AC-06)

`claude -p ... --output-format json` returns JSON envelope. Audit.cjs parses `result.stdout`:

```json
{
  "type": "result",
  "result": "{\"capabilities\":[...],\"bugs\":[...],\"recent_changes\":[...],\"recommended_spec_scope\":\"...\"}"
}
```

Audit.cjs:
1. Parse outer envelope
2. Parse `result` field as JSON
3. Validate keys: `capabilities[]`, `bugs[]`, `recent_changes[]`, `recommended_spec_scope`
4. Merge into final audit output

---

## Failure modes (AC-08)

| Mode | Detection | Warning code | Audit exit |
|---|---|---|---|
| Timeout | `result.signal === 'SIGTERM'` OR `result.error.code === 'ETIMEDOUT'` | `CLAUDE_CLI_TIMEOUT` | exit 0 |
| Non-zero exit | `result.status !== 0` | `CLAUDE_CLI_FAILED` | exit 0 |
| Non-JSON stdout | `JSON.parse()` throws | `CLAUDE_CLI_INVALID_JSON` | exit 0 |
| Missing keys | Inner JSON missing required keys | `CLAUDE_CLI_INVALID_JSON` | exit 0 |

In ALL failure modes: deterministic fields preserved + sense-making fields = `null` + warning appended.

---

## Test mocking strategy (NFR Test style)

Unit tests mock `spawnSync` via fixture injection:

```js
// scripts/tests/fixtures/audit/claude-cli-success.fixture.js
module.exports = {
  status: 0,
  stdout: JSON.stringify({
    type: 'result',
    result: JSON.stringify({
      capabilities: ['dry-run', 'apply mode'],
      bugs: [],
      recent_changes: ['Phase 4b shipped'],
      recommended_spec_scope: 'Skip --apply re-impl'
    })
  })
};
```

Audit.cjs accepts injectable spawn function via DI:
```js
function audit({ spawn = spawnSync } = {}) { /* ... */ }
```

E2E tests (gated by `SOMA_AUDIT_E2E=1`) use real `spawnSync('claude', ...)`.

---

## Performance contract

- Spawn overhead: ~50ms (node child_process)
- Timeout default: 30s
- Total claude CLI roundtrip p95: 5-15s (variable per LLM latency)
