# Contract: Cross-Harness Skill Metadata Parity

**Contract ID:** CONTRACT-04
**spec_ref:** [SPEC:AC-10] [SPEC:AC-11] [SPEC:AC-15]
**Created:** 2026-05-09
**Type:** cross-harness skill registry contract (Claude slash command + Codex AGENTS.md anchored block)

---

## Scope

Layer 5 — single-backbone CLI (install.cjs) + per-harness skill frontends. Defines metadata parity between:
- **Claude:** `core/adapters/claude/commands/soma-install.md` (slash command source)
- **Codex:** `core/adapters/codex/AGENTS.md` anchored block `id=block.codex.AGENTS.soma-install`

Both materialized via `soma sync --apply --tool=<harness>`.

---

## Claude Skill Source Schema

```markdown
---
name: soma-install
description: Install SOMA in a target project (full instrumentation: .soma/, manifest.json, anchored CLAUDE.md, install-state.json). Disambiguates "instalar SOMA aqui" / "install soma here" intent — invokes canonical CLI instead of editing CLAUDE.md manually.
allowed-tools:
  - Bash
triggers:
  - "instalar o SOMA neste projeto"
  - "instalar SOMA aqui"
  - "configurar SOMA neste repo"
  - "set up SOMA in this repo"
  - "install soma here"
  - "soma install"
  - "/soma:install"
  - "add SOMA to this project"
args_schema:
  project_path:
    type: string
    required: true
    description: Path to target project (supports spaces and leading hyphens)
  tool:
    type: enum [claude, codex, both]
    default: claude
  dry_run:
    type: boolean
    default: false
  merge_claude_md:
    type: boolean
    default: null  # null = ask/auto in interactive
  replace_claude_md:
    type: boolean
    default: false
  allow_local_edits:
    type: boolean
    default: false
---

# /soma:install

When invoked, run:
\`\`\`bash
node ~/.soma-v2/scripts/soma.cjs install <project-path> [flags]
\`\`\`

Then emit a 🤖 Agent Report block summarizing the install:
- STATUS (pass/fail/partial)
- Path created (.soma/, manifest.json, install-state.json)
- Anchored block ID injected
- Snapshot ID for rollback
- Surprises (if any — e.g., custom CLAUDE.md merged)

Refer user to INSTALL.md troubleshooting if exit != 0.
```

---

## Codex Anchored Block Schema (in `core/adapters/codex/AGENTS.md`)

```markdown
<!-- soma-v2:start id=block.codex.AGENTS.soma-install version=2.2.0 sha256={hex64} -->
# Soma Install Skill (Codex)

When user requests "instalar SOMA" / "install soma" (PT or EN, see triggers list below), invoke:
\`\`\`bash
node ~/.soma-v2/scripts/soma.cjs install <project-path> [flags]
\`\`\`

## Triggers (NL phrasings — parity with Claude /soma:install)

- "instalar o SOMA neste projeto"
- "instalar SOMA aqui"
- "configurar SOMA neste repo"
- "set up SOMA in this repo"
- "install soma here"
- "soma install"
- "add SOMA to this project"

## Args (parity with Claude skill)

| Flag | Type | Default | Description |
|---|---|---|---|
| `<project-path>` | string | required | Target project path |
| `--tool` | enum {claude, codex, both} | claude | Which harness adapter |
| `--dry-run` | boolean | false | Preview without writing |
| `--merge-claude-md` | boolean | null | Preserve+append on free-text CLAUDE.md |
| `--replace-claude-md` | boolean | false | Snapshot+replace on free-text CLAUDE.md |
| `--allow-local-edits` | boolean | false | Pass-through to sync escape hatch (intentional drift override) |

## Post-invocation

Emit summary: status (pass/fail/partial), paths created, snapshot ID, recovery hint if exit != 0.
<!-- soma-v2:end id=block.codex.AGENTS.soma-install -->
```

---

## Parity Contract (AC-15)

**Same args schema** between Claude frontmatter `args_schema` AND Codex anchored block "Args" table:
- All 6 args present in both (project_path, tool, dry_run, merge_claude_md, replace_claude_md, allow_local_edits)
  — force_resync REMOVED in v2.2.0 (deferred to v2.3 with proper TDD wire-up)
- Same types (string/enum/boolean)
- Same defaults (with null = ask/auto in interactive)

**Same triggers list** (modulo language):
- Claude `triggers:` array MUST equal Codex `## Triggers` markdown list (sha-equal modulo bullet syntax + whitespace)
- Test: parse both, normalize, assert equality

**Same backbone CLI** invocation:
- Both MUST emit literal `node ~/.soma-v2/scripts/soma.cjs install` as the entry call
- No alternative invocation paths permitted (zero divergence)

---

## Test (AC-15 contract test)

`core/scripts/__tests__/cross-harness-parity.test.js`:

1. Read Claude skill `core/adapters/claude/commands/soma-install.md`, parse frontmatter
2. Read Codex `core/adapters/codex/AGENTS.md`, extract anchored block `id=block.codex.AGENTS.soma-install`, parse Args table
3. Assert: 6 args, same names/types/defaults
4. Assert: triggers list same content (set equality after normalization)
5. Assert: both contain literal `node ~/.soma-v2/scripts/soma.cjs install`

---

## Invariants

- Claude skill frontmatter MUST be valid YAML
- Codex anchored block MUST follow `<!-- soma-v2:start id=block.codex.AGENTS.{name} version=... sha256=... -->` ... `<!-- soma-v2:end id=... -->` format (Layer 0 audit confirmed pattern)
- Args schema parity verified at every commit via Wave 5 Wave 6 contract test
- Both files synced via `soma sync --apply --tool=<harness>` from `core/adapters/` source
