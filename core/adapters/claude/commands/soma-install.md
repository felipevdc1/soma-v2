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
  project_path: "string (required) — path to target project (supports spaces and leading hyphens)"
  tool: "enum [claude, codex, both] — default: claude"
  dry_run: "boolean — default: false — preview without writing"
  merge_claude_md: "boolean — default: null — preserve+append on free-text CLAUDE.md"
  replace_claude_md: "boolean — default: false — snapshot+replace on free-text CLAUDE.md"
  allow_local_edits: "boolean — default: false — pass-through to sync escape hatch (intentional drift override)"
---

# /soma:install — Install SOMA in a project

This skill installs SOMA instrumentation into a target project via the canonical backbone CLI.
It creates `.soma/`, `manifest.json`, `install-state.json`, and injects anchored blocks into
the project's `CLAUDE.md` (or creates one). It is the single entry point for SOMA onboarding —
never edit CLAUDE.md manually to add SOMA blocks.

## When to invoke

Invoke this skill when the user says any of the following (PT or EN):
- "instalar o SOMA neste projeto" / "instalar SOMA aqui"
- "configurar SOMA neste repo" / "set up SOMA in this repo"
- "install soma here" / "soma install" / "/soma:install"
- "add SOMA to this project"

Do NOT attempt to modify CLAUDE.md or create `.soma/` files manually. Always delegate to the CLI.

## Prereqs

- SOMA v2 installed at `~/.soma-v2/` (verify with `ls ~/.soma-v2/scripts/soma.cjs`)
- Node.js ≥ 18 on PATH

## Invocation

Translate slash-command args to the backbone CLI:

```bash
node ~/.soma-v2/scripts/soma.cjs install <project_path> \
  --tool=<tool> \
  [--dry-run] \
  [--merge-claude-md] \
  [--replace-claude-md] \
  [--allow-local-edits]
```

### Args

| Arg | CLI flag | Notes |
|---|---|---|
| `project_path` | positional | Required. Wrap in quotes if path has spaces or leading hyphens. |
| `tool` | `--tool=claude\|codex\|both` | Default: `claude` |
| `dry_run` | `--dry-run` | Preview without writing. Shows diff of what would change. |
| `merge_claude_md` | `--merge-claude-md` | Preserve existing free-text content, append anchored blocks. |
| `replace_claude_md` | `--replace-claude-md` | Snapshot existing CLAUDE.md, then replace with SOMA-managed version. |
| `allow_local_edits` | `--allow-local-edits` | Pass-through escape hatch for intentional drift override. |

### Examples

```bash
# Basic install (Claude only, interactive CLAUDE.md handling)
node ~/.soma-v2/scripts/soma.cjs install /path/to/my-project

# Install for both harnesses, dry run first
node ~/.soma-v2/scripts/soma.cjs install /path/to/my-project --tool=both --dry-run

# Install replacing existing CLAUDE.md (snapshot created automatically)
node ~/.soma-v2/scripts/soma.cjs install /path/to/my-project --replace-claude-md

# Install with intentional drift override (user accepts local edits will be preserved)
node ~/.soma-v2/scripts/soma.cjs install /path/to/my-project --allow-local-edits
```

## Post-invocation

After running, emit a 🤖 Agent Report block summarizing:

```
🤖 Agent Report ───────────────────────────────────────────────
STATUS: [pass | fail | partial]
SHA: [git HEAD if project is a repo, else "n/a"]
Files changed:
  - <project_path>/.soma/ (created)
  - <project_path>/.soma/manifest.json
  - <project_path>/.soma/install-state.json
  - <project_path>/CLAUDE.md (anchored blocks injected or created)
install-state.json: status=[complete | partial | failed]
Snapshot: [path if --replace-claude-md was used, else "none"]
Surprises: [or "none"]
═══════════════════════════════════════════════════════════════
```

If exit code != 0, refer the user to `~/.soma-v2/docs/INSTALL.md` for troubleshooting and include
the CLI stderr in the Surprises field.
