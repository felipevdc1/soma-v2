# Contract: Adapter Skeleton — install-targets.json + bootloader.md

**Contract ID:** CONTRACT-ADAPTER-SKELETON-01
**spec_ref:** [SPEC:AC-01..AC-13]
**Created:** 2026-05-02
**Type:** filesystem artifact contract (per-adapter folder structure)

---

## Scope

Defines the structural contract that ANY new adapter folder under `~/.soma-v2/adapters/{tool}/` MUST satisfy. Sprint 009 ships 3 adapters (cursor / aider / chatgpt-desktop) — each conforms to this contract.

---

## Per-adapter folder structure

```
~/.soma-v2/adapters/{tool}/
├── install-targets.json    REQUIRED
└── bootloader.md           REQUIRED
```

`integration.md` is OPTIONAL and NOT shipped in MVP (D3 lock — deferred Phase 5+).

---

## install-targets.json schema

**Schema version:** `soma-install-targets/v1` (frozen rev 2 — D-C11 Adapter Contract Cláusula C)

```json
{
  "schema": "soma-install-targets/v1",
  "tool": "{tool-name}",
  "entries": []
}
```

### Field constraints

| Field | Type | Required | Constraints |
|---|---|---|---|
| `schema` | string | yes | Exact match `"soma-install-targets/v1"` |
| `tool` | string | yes | Lowercase kebab-case; matches folder basename (cursor / aider / chatgpt-desktop) |
| `entries` | array | yes | MAY be empty `[]` MVP per D1 lock; future Phase 5+ adapter rollout populates real entries |

### Per-entry schema (when entries[] is populated Phase 5+)

```json
{
  "block_id": "block.{tool}.{file}.{section}",
  "source_doc": "docs/{relative-path}.md",
  "target_path": "~/{tool-specific-path}",
  "target_anchor_id": "block.{tool}.{file}.{section}"
}
```

---

## bootloader.md structure

```markdown
# {Tool} Adapter — Bootloader

Source: PLAN.md §4.2 (literal).

## Responsibilities

1. {Numbered item — tool-specific framing}
2. {Numbered item}
3. {Numbered item — minimum 3}

## Non-responsibilities

- {Bulleted item — minimum 2}
- {Bulleted item}
```

### Structural requirements (validated via AC-05)

| Element | Requirement |
|---|---|
| H1 title | `# {Tool} Adapter — Bootloader` (tool name capitalized) |
| H2 `## Responsibilities` | numbered list, ≥3 items |
| H2 `## Non-responsibilities` | bulleted list, ≥2 items |

### Wording adaptation per tool (D2 lock)

Each adapter's bootloader.md MIRRORS codex/bootloader.md structural pattern but adapts wording to tool nature:
- **Cursor**: IDE-context phrasing ("extension-loaded behavior", "rules.md surface")
- **Aider**: CLI-pair-programming phrasing ("conversation context", "diff-staged behavior")
- **ChatGPT-desktop**: chat-context phrasing ("system message scope", "conversation memory")

Avoid copy-paste literal of codex bootloader text — wording must reflect tool's primary use mode.

---

## Folder-name conventions (D6 lock)

| Convention | Rule |
|---|---|
| Case | lowercase only |
| Separator | hyphen `-` (NO underscore, NO PascalCase) |
| Examples | ✓ `cursor`, `aider`, `chatgpt-desktop`, `gpt5-cli` (hypothetical future) |
| Counter-examples | ✗ `Cursor`, `aider_cli`, `ChatGPT_Desktop` |

---

## Side Effects

- File creation only: 6 files total (3 adapters × 2 files each)
- Read-only on existing SOMA_HOME canonical files (Cláusula B HARD)
- No code changes in `scripts/`, `lib/`, or hooks
- Tests added to `~/.soma-v2/scripts/__tests__/adapter-skeletons.test.cjs` (1 NEW test file)

---

## Idempotency

- **Idempotent ship:** yes (re-running Sprint 009 = no-op if files already match)
- File overwrites use atomic write (or skip if content matches)

---

## Validation contract (test stub)

```javascript
// @spec AC-01..AC-13
// @contract CONTRACT-ADAPTER-SKELETON-01
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ADAPTERS_DIR = path.join(os.homedir(), '.soma-v2', 'adapters');
const NEW_ADAPTERS = ['cursor', 'aider', 'chatgpt-desktop'];

NEW_ADAPTERS.forEach(tool => {
  test(`adapter '${tool}' folder exists`, () => {
    const dir = path.join(ADAPTERS_DIR, tool);
    assert.ok(fs.existsSync(dir), `${dir} missing`);
    assert.ok(fs.statSync(dir).isDirectory());
  });

  test(`adapter '${tool}' has install-targets.json + bootloader.md`, () => {
    const dir = path.join(ADAPTERS_DIR, tool);
    assert.ok(fs.existsSync(path.join(dir, 'install-targets.json')));
    assert.ok(fs.existsSync(path.join(dir, 'bootloader.md')));
  });

  test(`adapter '${tool}' install-targets.json schema valid`, () => {
    const json = JSON.parse(fs.readFileSync(path.join(ADAPTERS_DIR, tool, 'install-targets.json'), 'utf8'));
    assert.equal(json.schema, 'soma-install-targets/v1');
    assert.equal(json.tool, tool);
    assert.ok(Array.isArray(json.entries));
  });

  test(`adapter '${tool}' bootloader.md has required sections`, () => {
    const content = fs.readFileSync(path.join(ADAPTERS_DIR, tool, 'bootloader.md'), 'utf8');
    assert.match(content, /^# .+ Adapter — Bootloader/m);
    assert.match(content, /^## Responsibilities/m);
    assert.match(content, /^## Non-responsibilities/m);
  });

  test(`adapter '${tool}' has NO integration.md (D3 lock)`, () => {
    assert.ok(!fs.existsSync(path.join(ADAPTERS_DIR, tool, 'integration.md')));
  });
});
```

---

## Tracebility

| AC | Validation |
|---|---|
| AC-01 | folder existence per adapter (cursor / aider / chatgpt-desktop) |
| AC-02 | 2 required files present per adapter |
| AC-03 | install-targets.json root keys (schema/tool/entries) |
| AC-04 | schema = "soma-install-targets/v1", tool = folder basename, entries = array |
| AC-05 | bootloader.md H1 + 2 H2 sections + counts |
| AC-06 | folder names match `^[a-z]+(-[a-z]+)*$` regex |
| AC-07 | doctor processes new adapters w/o ERROR findings |
| AC-08 | bootstrap output adapters[] ≥5 entries |
| AC-09 | adapter-skeletons.test.cjs has ≥10 tests pass |
| AC-10 | SOMA cumulative tests preserve (no regression) |
| AC-11 | 6 canonical+lib shasums diff empty |
| AC-12 | hooks aggregate 48+/48+ preserved |
| AC-13 | NO integration.md per adapter |
