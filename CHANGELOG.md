# Changelog

All notable changes to SOMA will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Semver vs. "SOMA v3":** o `v3` das fases (Fase 0–5 do desenho em
> `~/Documents/- forge/framework/08-desenho-soma-v3.md`) é a **geração conceitual** do framework, não o
> semver deste repositório. O repo segue semver normal a partir de `2.3.0`. Não existe e não haverá uma
> tag `v3.0.0` só por causa do nome do desenho — quando houver, será por breaking change de verdade.

## [2.3.0] - 2026-08-14 — Fase 0 SOMA v3 (housekeeping + D23/D24)

### Fixed

- **Deriva de versão de 4 vias reconciliada** (F0.1). Antes: `VERSION`=2.1.2 · `package.json`=2.2.0 ·
  `core/manifest.json`=2.1.0 · última tag=`v2.2.4`. Agora as quatro convergem em **2.3.0** (próxima minor
  após a maior referência real, `v2.2.4`). Também corrigidos 2 rótulos stale de mesma origem:
  `package.json.description` ("SOMA v2.1 —" → "SOMA —") e `core/manifest.json.release`
  ("soma-v2.1-lab-mvp" → "soma-v3-fase0"). Verificado antes da troca que nenhum script consome
  `manifest.version`/`manifest.release` (`install.cjs` lê `package.json`; os `attrs.version` do `sync.cjs`
  são de doc-blocks ancorados, entidade distinta).

### Notes

- Fase 0 completa cobre F0.1–F0.9. Esta entrada é atualizada conforme cada task fecha.
- Terreno re-verificado em 2026-08-14 contra o ground-truth de 2026-07-06 (`09-plano` §C): intacto,
  com 3 divergências corrigidas no plano (36 hooks registrados em vez de 34; `handoff-forge.md`
  inexistente; F0.8/F0.9 criadas).

## [2.1.2] - 2026-07-03

### Changed

- **Implicit-team model migration** (Claude Code 2.1.199 removed `TeamCreate`/`TeamDelete`; teammates are now spawned via the Agent tool's `name` parameter — implicit per-session team):
  - `hooks/agent-mode-gate.cjs` — rewritten name-aware: 2-axis 4h dispatch budget (anonymous subagents cap 3 / distinct named teammates cap 8; repeat names free; `soma-` prefix exempt). Messages no longer recommend the removed `TeamCreate`.
  - `hooks/thermal-guard.cjs` — removed `'apply'` false-positive keyword and dead `team_name` fallback; matcher is `Agent` only.
  - **New hook `hooks/subagent-stop-thermal.cjs`** (`SubagentStop` event) — releases the thermal slot on real agent termination (FIFO; the 15min TTL becomes a fallback). Fixes false-positive thermal blocks.
  - `commands/soma-run.md` (+ `core/adapters` mirror) — STEP_2_TEAM → STEP_2_TASKS; `activeTeamId` → `teammateNamePrefix`; STEP_6 layered cleanup (`SendMessage shutdown_request` → `TaskStop` → log) replaces `TeamDelete`.
  - `commands/plan-sdd.md` (+ mirror) — Step 2 wording updated to named teammates.
  - `install/soma-hooks-map.json` — thermal matcher `Agent|TeamCreate` → `Agent`; new `SubagentStop` entry registering `subagent-stop-thermal.cjs`.
  - `core/docs/constitution.md` — **Constitution 1.2.0** (amendment `core/docs/constitution-amendments/1.2.0-implicit-teams.md`; also ships the previously missing `1.1.0-fable-era-topology.md`). Articles I, V, VIII, IX updated to the implicit-team model.
  - Docs (`ARCHITECTURE.md`, `QUICKSTART.md`, `crescer-limpo.md`) aligned.

### Upgrade notes

- On machines with a previous install, `merge-settings.cjs` dedupes by command path, so the stale `Agent|TeamCreate` matcher entry in existing `settings.json` is kept as-is — harmless (the regex still matches `Agent`). The new `SubagentStop` entry IS added. `rsync` replaces the hook files themselves, so all machines get the name-aware gate + slot release on re-install.
- `VERSION` file was stale at 2.1.0 (CHANGELOG already had 2.1.1); both now read 2.1.2.

## [2.1.1] - 2026-05-06

### BREAKING

- **`cbm` anchor deprecated** in claude adapter. Auto-migrated to `hyd-v2` anchor by `install.sh`, `soma sync --apply`, or explicit `node ~/.soma-v2/scripts/migrate-cbm-deprecation.cjs`. Snapshot retained for 30 days; revert via `--revert <snapshot-id>` flag.

### Fixed

- **codex `codebase-memory-mcp` source restored** from Phase 5 Q2 misroute. Source doc now `docs/codebase-memory-mcp.md` (was incorrectly `docs/hyd-v2.md`, which would have silently overwritten user's MCP knowledge graph documentation on sync apply). Closes #9.
- **Manifest drift `target_drift` category** resolved via cbm migration. Closes remaining `doctor.cjs` target_drift findings from #8.
- **`sync.cjs` macOS pipe inheritance bug**: replaced 13 `process.stdout.end()` calls with `process.stdout.write()` to avoid SIGPIPE/Broken pipe errors when sync is invoked via `install.sh` → `soma.cjs` → `sync.cjs` flow on macOS bash 3.2.

### Migration

If your installation has `cbm` anchor in `~/.claude/CLAUDE.md` or legacy `<!-- codebase-memory-mcp:start -->` markers in `~/.codex/AGENTS.md`:

1. Re-run `bash install.sh` (auto-detects + migrates), OR
2. Run `node ~/.soma-v2/scripts/migrate-cbm-deprecation.cjs` explicitly, OR
3. Run `soma sync --apply` (auto-detects + migrates first).

All 3 paths invoke the same library function (`migrateCbmDeprecation()`) with snapshot + auto-rollback safety.

### Spec / contracts

- New: `core/specs/013-cbm-deprecation/spec.md` (22 ACs, 9 locked decisions)
- New: `core/specs/013-cbm-deprecation/plan.md` (25 tasks across 8 waves)
- Amended: `core/docs/adapter-contract.md` D-C11 (cbm dropped from claude triplet, codebase-memory-mcp source restored)

## [2.1.0] - 2026-05-05

### Initial Release

First public release of SOMA v2.1.

### Added
- Core framework with 12 specs (001-soma-doctor → 012-soma-audit)
- 17 SOMA-CORE hooks for anti-shallowness enforcement
- 11 slash commands (`/soma:run`, `/soma:specify`, `/soma:plan-sdd`, ...)
- 7 templates (decision, spec, plan, tasks, handoff, FAMILY_DOC, contracts)
- Multi-adapter architecture (Codex, Claude — production; cursor, aider, chatgpt-desktop — EXPERIMENTAL)
- SOMA Voxel output-style theme (18 bar-block types — inspired by [@zbrunomoreira](https://instagram.com/zbrunomoreira))
- Snapshot-based rollback (2ms byte-identical restore validated)
- Article XII Discover-Before-Specify enforcement (3 layers — Constitution + slash hook + telemetry)
- Insight→Action Coupling (Layer 4 hook + telemetry)

### Acknowledgments
- **Bruno Moreira** ([@zbrunomoreira](https://instagram.com/zbrunomoreira)) — SOMA Voxel theme inspiration, original SomaCanvas family aesthetic, fundação sólida 8-item checklist
