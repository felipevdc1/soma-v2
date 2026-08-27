# SOMA v2.1 — Installation Guide

**Audience:** Any developer cloning `soma-v2` for the first time.
**Platform:** macOS, Linux, and Windows via WSL2.

---

## Prerequisites

| Requirement | How to verify | Notes |
|---|---|---|
| **Node.js v22+** | `node --version` → `v22.x.x` or higher | Enforced by `engines` field in `package.json` |
| **git** | `git --version` | Any modern git 2.x+ |
| **rsync** | `rsync --version` | Pre-installed on macOS; `apt install rsync` on Debian/Ubuntu |
| **Claude Code CLI** _(optional)_ | `claude --version` | Required only for `soma audit`. Absent → SOMA installs fine; `soma audit` degrades gracefully (see §MCP & CLI below). |

Windows users: install via WSL2 (Ubuntu 22.04+) and run all commands inside the WSL terminal.

---

## Install in one command

```bash
git clone https://github.com/felipevdc1/soma-v2.git
cd soma-v2
bash install.sh
```

Flags available:

| Flag | Effect |
|---|---|
| `--dry-run` | Show what would be done without modifying anything |
| `--no-codex` | Skip Codex / `~/.codex/AGENTS.md` injection |
| `--no-claude-md` | Skip CLAUDE.md bootloader injection |
| `--force-overwrite` | Auto-rename any conflicting hooks to `.bak` without prompting |

The `--force-overwrite` flag is also available as an environment variable: `FORCE_OVERWRITE=1 bash install.sh`. Either form is supported.

After install completes, **restart Claude Code** (close and reopen the app) before using any `/soma:*` commands.

Start from the target project directory with `/soma-run "objective"`. No project-local setup command is required first. Use `/soma-run --status` to inspect without writing and `/soma-run --resume <runId>` after opening a new Claude session.

---

## What gets installed

`install.sh` runs 10 phases idempotently. Here is what lands on your machine:

- **`~/.soma-v2/`** — the SOMA framework home: scripts, docs, templates, adapters, benchmarks, specs
- **`~/.claude/hooks/`** — 17 SOMA-CORE hooks registered in `settings.json` (16 event-registered + 1 utility callable; merged safely with any existing hooks you have)
- **`~/.claude/commands/`** — SOMA slash commands, including the primary `/soma-run` entrypoint
- **`~/.claude/references/soma-run-orchestration.md`** — long orchestration contract, loaded only after `READY` or `RESUME_READY`
- The existing lower-level commands remain available:
  - `/soma:run` — autonomous 10-step state machine
  - `/soma:specify` — generate `spec.md` from intent
  - `/soma:plan-sdd` — derive plan, contracts, and tasks from approved spec
  - `/soma:dispatch` — single Sonnet executor in an isolated worktree
  - `/soma:sonar-audit` — multi-territory parallel read-only audit
  - `/soma:hyd` — anti-shallowness loop (HYD v2)
  - `/soma:quality-check` — post-dispatch scorecard
  - `/soma:depth-score` — AC → test → implementation traceability score
  - `/soma:gap-finder` — pre-feature gap analysis
  - `/soma:handoff` — cross-session handoff with resume prompts
  - `/soma:encerrar` — end-of-session ritual (handoff + diary + KG)
- **`~/.claude/output-styles/soma-voxel.md`** — the SOMA Voxel visual theme file
- **`~/.claude/CLAUDE.md`** — a SOMA bootloader anchored block injected into your existing CLAUDE.md (system rules only; your personal content is preserved)
- **`~/.claude/templates/`** — 7 essential templates: decision, spec, plan, tasks, handoff, FAMILY_DOC, contracts
- **`~/.claude/settings.json`** — SOMA hooks merged into your existing settings (idempotency-tagged, safe to re-run)

A timestamped backup of your pre-install state is written to `~/.soma-v2-backups/{timestamp}/` before any modifications.

---

## Idempotency

Running `install.sh` multiple times is safe. The installer uses two mechanisms to prevent duplicate writes:

1. **Hook entries** in `settings.json` are tagged with `_soma_managed: true`. Re-install detects existing tags and skips duplication.
2. **Anchored blocks** in CLAUDE.md (and `~/.codex/AGENTS.md` if present) carry anchor IDs like `block.claude.CLAUDE_md.soma-bootloader`. `soma sync` detects existing anchors by ID and replaces rather than appends.

If you need to reset from scratch: `bash uninstall.sh` then re-run `bash install.sh`.

---

## MCP server dependencies (optional)

SOMA integrates with three MCP servers that enhance memory and search capabilities:

| MCP server | Role | Absent behavior |
|---|---|---|
| `mempalace` | Cross-session memory (diary, knowledge graph) | Memory features degrade; diary hooks warn and continue |
| `vault` | Skill vault resolution | Vault commands unavailable; hooks warn and continue |
| `codebase-memory-mcp` | Codebase indexing and graph queries | Code graph features unavailable; hooks warn and continue |

During install, `install/check-mcp-deps.cjs` probes for each MCP server and emits a warning if absent. **Install is never blocked** by missing MCP servers — you get a warning and proceed. All hooks use a warn-and-continue strategy for optional dependencies.

To install MCP servers later, refer to each server's own documentation and re-run `bash install.sh` to register them.

---

## Privacy disclosure

SOMA writes local telemetry to track protocol compliance. **No data is sent externally.**

Local files written:

- `~/.claude/logs/insight-coupling-{YYYY-MM-DD}.jsonl` — tracks whether architectural insights are paired with durable captures (schema `insight-coupling/v1`)
- `~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl` — tracks Capture Before Defer protocol adherence

To opt out entirely, set this environment variable in your shell profile (`~/.zshrc` or `~/.bashrc`) before launching Claude Code:

```bash
export INSIGHT_COUPLING_DISABLED=1
```

---

## Verification (smoke pack)

After install, run the 12-gate smoke pack to confirm everything is wired correctly:

```bash
node install/verify-portability.cjs
```

The 12 gates checked:

| # | Gate | What it validates |
|---|---|---|
| 1 | Version | `VERSION` file matches `plugin.json` version |
| 2 | Doctor | `soma doctor` exits 0 |
| 3 | Audit | `soma audit` exits 0 or reports "unavailable" (if Claude CLI absent) |
| 4 | Slash command discovery | `/soma:run` resolves in Claude Code |
| 5 | Spec gen | `/soma:specify` creates `specs/NNN-slug/spec.md` |
| 6 | Hook fire (thermal guard) | 4th compile agent is blocked with exit 2 |
| 7 | Bootloader injected | `grep "SOMA Bootloader" ~/.claude/CLAUDE.md` returns a match |
| 8 | Test suite | Node test runner reports ≥99% pass rate |
| 9 | Output-style file | `~/.claude/output-styles/soma-voxel.md` exists |
| 10 | Plugin manifest valid | `plugin.json` parses without error |
| 11 | Constitution ratified | `core/docs/constitution.md` contains `v1.0.0` and no `DRAFT` |
| 12 | No coupling leak | Zero hardcoded machine-specific paths in `core/`, `commands/` |

Gates 2–4 require a live Claude Code session. In CI mode (`--mode=ci`), those gates are skipped automatically.

---

## Uninstall

```bash
bash uninstall.sh
```

The uninstaller:

1. Reverts the CLAUDE.md bootloader anchored block via `rollback.cjs` (Phase 5 primitive — byte-identical restore validated at 2ms)
2. Strips all `_soma_managed: true` hook entries from `settings.json` (your existing non-SOMA hooks are preserved)
3. Removes SOMA hooks from `~/.claude/hooks/` (only the ones SOMA installed)
4. Removes `~/.soma-v2/` entirely (unless you pass `--keep-soma-home`)

Optional: restore a specific backup:

```bash
bash uninstall.sh --restore-backup <timestamp>
# timestamp = the number in ~/.soma-v2-backups/{timestamp}/
```

Backups are preserved at `~/.soma-v2-backups/` even after uninstall.

---

## Troubleshooting

See `docs/TROUBLESHOOTING.md` for symptom → cause → fix entries covering install issues,
runtime hook conflicts, audit failures, and update/migration scenarios.
