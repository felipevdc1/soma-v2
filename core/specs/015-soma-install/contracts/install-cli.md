# Contract: Tool Call — soma install

**Contract ID:** CONTRACT-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07] [SPEC:AC-08] [SPEC:AC-09]
**Created:** 2026-05-09
**Type:** internal CLI tool (Node.js dispatcher subcommand)

---

## Tool Name

```
soma install
```

Invoked as: `node core/scripts/soma.cjs install <project-path> [flags]` (lab) OR `node ~/.soma-v2/scripts/soma.cjs install ...` (post-install).

---

## Description

Orchestrate full SOMA project installation in target directory by composing `soma init`, `soma manifest baseline`, and `soma sync --apply --tool=<harness>` in a single idempotent fail-loud pipeline.

---

## Arguments

```json
{
  "type": "object",
  "required": ["project-path"],
  "properties": {
    "project-path": {
      "type": "string",
      "description": "Absolute or relative path to target project directory. Must exist. Path with spaces or leading hyphens supported (quote required in shell).",
      "examples": [".", "/tmp/soma-test-fresh", "/Users/felipevdc1/Documents/- projetos claude code/hydra"]
    },
    "--tool": {
      "type": "string",
      "enum": ["claude", "codex", "both"],
      "default": "claude",
      "description": "Which harness adapter to install. 'both' runs sync twice (once per harness). Codex requires `~/.codex/` to exist; aborts with hint if missing."
    },
    "--dry-run": {
      "type": "boolean",
      "default": false,
      "description": "Preview operations without mutating target. Outputs diff + exit 0 OR exit 2 if would-conflict detected."
    },
    "--merge-claude-md": {
      "type": "boolean",
      "default": null,
      "description": "When CLAUDE.md has free-text content (no anchor markers), preserve original text and append anchored block after. Default in interactive mode."
    },
    "--replace-claude-md": {
      "type": "boolean",
      "default": false,
      "description": "When CLAUDE.md has free-text content, snapshot original to ~/.soma-v2/.snapshots/<timestamp>/ and replace with anchored block only. Mutually exclusive with --merge-claude-md."
    },
    "--allow-local-edits": {
      "type": "boolean",
      "default": false,
      "description": "Pass-through to underlying sync.cjs. When set, drift detection becomes warning instead of abort. Escape hatch for advanced users."
    }
  },
  "constraints": {
    "mutually_exclusive": [["--merge-claude-md", "--replace-claude-md"]]
  }
}
```

---

## Output (stdout)

On success (exit 0):
```
SOMA install complete: <project-path>
  Harness: claude
  .soma/ created
  manifest.json baseline captured
  CLAUDE.md anchored block injected (block_id=<id>)
  Snapshot: ~/.soma-v2/.snapshots/<ISO-timestamp>/
  install-state.json status=complete
```

On idempotent re-run (exit 0):
```
SOMA already installed: <project-path>
  No changes (state matches snapshot)
  Last installed: <ISO-timestamp>
```

On dry-run (exit 0):
```
SOMA install (dry-run): <project-path>
  Would create: .soma/, .soma/install-state.json
  Would inject anchored block in CLAUDE.md (block_id=<id>)
  No mutations applied.
```

---

## Errors (stderr + exit code)

| Exit | Trigger | Stderr Format |
|---|---|---|
| 1 | Generic invocation error (missing path arg, invalid `--tool`) | `usage: soma install <project-path> [--tool=<claude\|codex\|both>] ...` |
| 2 | Drift detected (sha mismatch in anchored block, no flag) | `BF-06 ABORT: anchored block sha mismatch.\n  File: <path>\n  Block ID: <id>\n  Expected: <sha>\n  Actual: <sha>\n  Recovery: (1) soma rollback --snapshot-id <X>, (2) re-extract content + re-sync, OR (3) pass --allow-local-edits for intentional drift override.` |
| 2 | Custom CLAUDE.md no flag + non-interactive | `CLAUDE.md has free-text content. Specify --merge-claude-md or --replace-claude-md (non-interactive mode requires explicit choice).` |
| 2 | Mid-pipeline failure (init OK, baseline failed) | `Install partial-failed at step <N>.\n  Snapshot: <path>\n  Recovery: soma rollback --snapshot-id <X>` |
| 2 | Lockfile contention | `Install in progress (PID <pid>, started <timestamp>). Lock: <project>/.soma/install.lock` |
| 2 | Codex requested but `~/.codex/` missing | `--tool=codex requires ~/.codex/ to exist. Install Codex CLI first OR use --tool=claude.` |

---

## Side Effects

- Creates `<project-path>/.soma/` directory
- Creates `<project-path>/manifest.json` (baseline manifest)
- Creates `<project-path>/.soma/install-state.json` (see CONTRACT-02)
- Creates `<project-path>/.soma/install.lock` during operation (removed in finally)
- Injects anchored block(s) in `<project-path>/CLAUDE.md` (if --tool=claude or both) AND/OR `<project-path>/AGENTS.md` (if --tool=codex or both)
- Creates snapshot at `~/.soma-v2/.snapshots/<ISO-timestamp>/<tool>/<file>` for rollback
- Updates `~/.soma-v2/.snapshots/<ISO-timestamp>/manifest.json` with sha256 + block_ids

---

## Idempotence Contract

| Pre-state | Behavior | Exit |
|---|---|---|
| Empty (greenfield) | Full pipeline | 0 |
| Full-installed (state matches) | Detect via sha + emit "no changes" | 0 |
| Partial (`.soma/` exists, no anchor) | Resume from sync step | 0 |
| Drift (anchor exists, sha mismatch) | ABORT exit 2 + recovery hint | 2 |
| Mid-failure (init OK, baseline failed) | Rollback partial + emit snapshot-id | 2 |

---

## Performance

- p50 < 3s greenfield install
- p95 < 8s greenfield install
- < 1s for idempotent re-run (no changes case)
- All operations local fs; zero network calls
