# SOMA Adapter Contract v1

**Status**: ACTIVE 2026-05-01 (D-C11 lock)
**Purpose**: Define the contract that any LLM tool adapter (Codex, Claude Code, Cursor, Aider, ChatGPT desktop, future) must satisfy to integrate with SOMA framework. Establishes primitive that unlocks N adapters without refactoring SOMA core.

**Note on operational status**: This contract is **design intent** as of Phase 4. **Operational cross-LLM continuity** (Codex/Claude switching mid-project without losses) requires Phase 5 adapter install (bootloader install in `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`). Phase 4 delivers artifact-level portability foundation; Phase 5 delivers tool-level handoff capability.

## 5 Mandatory Clauses

### Clause A — Anchor ID Convention

Every adapter MUST use the convention `block.{tool}.{file}.{section}` for anchored block identifiers, versioned via `~/.soma-v2/manifest.json`.

Examples:
- Codex: `block.codex.AGENTS.codebase-memory-mcp`, `block.codex.AGENTS.hyd-v2`, `block.codex.AGENTS.soma-stsd`
- Claude: `block.claude.CLAUDE_md.hyd-v2`, `block.claude.CLAUDE_md.soma-stsd`, `block.claude.CLAUDE_md.soma-voxel`
- Future Cursor: `block.cursor.RULES.hyd-v2` (illustrative)

**Note (Spec 013, v2.1.1)**: Legacy `cbm` anchor (claude adapter) deprecated and auto-migrated to `hyd-v2`. Codex `codebase-memory-mcp` source corrected from misroute (`docs/hyd-v2.md` → `docs/codebase-memory-mcp.md`). See `core/specs/013-cbm-deprecation/spec.md`.

Anchor format (frozen rev 2): `<!-- soma-v2:start id={id} version={ver} sha256={hex64} -->` ... `<!-- soma-v2:end id={id} -->`

### Clause B — Read-only access pattern to SOMA_HOME

No adapter writes to `~/.soma-v2/` (the framework canonical home). Any adapter may READ SOMA_HOME to resolve content for its own tool-specific bootloader file. Mutations only happen in tool-specific install targets (`~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, etc.).

Rationale: SOMA_HOME is the single source of truth across N adapters. Multiple writers create drift; single writer (the SOMA CLI itself) ensures consistency.

### Clause C — install-targets schema versioned

Every adapter has an `~/.soma-v2/adapters/{tool}/install-targets.json` conforming to schema `soma-install-targets/v1`:

```json
{
  "schema": "soma-install-targets/v1",
  "tool": "{tool-name}",
  "entries": [
    {
      "block_id": "block.{tool}.{file}.{section}",
      "source_doc": "docs/{relative-path}",
      "target_path": "~/{tool-specific-path}",
      "target_anchor_id": "block.{tool}.{file}.{section}"
    }
  ]
}
```

The delta across adapters is ONLY in `target_path` and the per-adapter `block_id` namespace. The `source_doc` reference, schema version, and entry structure are identical across adapters.

### Clause D — Optional hook/MCP integration appendix

Each adapter may have a per-tool integration appendix in `~/.soma-v2/adapters/{tool}/integration.md` describing how the tool's runtime integrates SOMA hooks/policies:

- **Claude Code**: `~/.claude/hooks/*.cjs` PreToolUse / UserPromptSubmit hooks (thermal-guard, spec-completeness-gate, spec-test-traceability, mempalace-wakeup, etc.)
- **Codex**: MCP servers + system prompt injection
- **Cursor (future)**: extension API + rules system
- **Aider (future)**: command hooks + .aiderignore patterns

The integration layer is OPTIONAL — adapters can ship read-only artifact integration (Clauses A-C) without runtime enforcement, with degraded but functional UX.

### Clause E — Claude anchor strategy concretization

Decision (D-C11, amended Spec 013 v2.1.1): Claude adapter uses `~/.claude/CLAUDE.md` as install target with anchor IDs `block.claude.CLAUDE_md.{hyd-v2,soma-stsd,soma-voxel}`. Codex adapter uses `~/.codex/AGENTS.md` + `~/AGENTS.md` with anchor IDs `block.codex.AGENTS.{codebase-memory-mcp,hyd-v2,soma-stsd}`. Sources: `docs/hyd-v2.md` (HYD discipline), `docs/soma-stsd.md` (operating lens), `docs/output-style.md` (claude soma-voxel theme), `docs/codebase-memory-mcp.md` (codex MCP knowledge graph doc).

This concretization unblocks Phase 5 install: SOMA CLI generates anchored blocks from canonical SOMA_HOME docs, injects into target tool's bootloader file (CLAUDE.md for Claude, AGENTS.md for Codex), preserving existing user content via anchor-based extraction.

## Future adapters (N+1, N+2, ...)

The contract is designed so adding a new adapter (Cursor, Aider, ChatGPT desktop, custom in-house tool) requires:

1. New folder `~/.soma-v2/adapters/{newtool}/`
2. `install-targets.json` conforming to `soma-install-targets/v1`
3. Optional `integration.md` appendix
4. SOMA CLI auto-discovers via folder presence — no SOMA core code changes

## Phase 5 install pre-requisite

Before running `soma sync --apply --tool=codex` or `--tool=claude` (Phase 5+ commands):
1. Adapter folder exists with valid `install-targets.json`
2. `soma doctor` reports zero validation errors for that adapter
3. Auto-snapshot infrastructure operational (`~/.soma-v2/.snapshots/{ISO}/{tool}/{path}`)

## See also

- `~/.soma-v2/manifest.json` — anchor ID convention versioning
- `~/.soma-v2/docs/crescer-limpo.md` — Bruno P6 canon (foundation = SOMA_HOME unchanged across adapters)
- `~/.claude/plans/soma-v2.1-section12-closed-patch.md` — D-C11 source decision

## Related Constitution Articles

- Article IV (Proof Before Done) — write-mode operations require evidence of pre-write snapshot
- Article V (Thermal Guard) — adapter install operations subject to compile/test thermal limits
- Article XI candidate (Capture Imperative — DRAFT, ratify Phase 5+) — deferred items must be captured durably
