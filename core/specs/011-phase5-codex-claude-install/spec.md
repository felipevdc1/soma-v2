# Spec: Phase 5 Codex+Claude Bootloader Operational Install

**Feature ID:** 011-phase5-codex-claude-install
**Branch:** `feature/011-phase5-codex-claude-install`
**Created:** 2026-05-02
**Status:** APPROVED (2026-05-02 — user ACK "ok" → status flip + /plan-sdd unblock)

---

## Context

Phase 4 (sync infrastructure + module cookbook + cookbook commands + Foundation Primitive) shipou em 2026-05-02 com 671/673 tests cumulative. [project B] Bucket D adicionou `soma bootstrap` CLI + 3 adapter skeletons (cursor/aider/chatgpt-desktop) + Article XI capture-defer-gate hook. **D-C11 Adapter Contract** (5 cláusulas A-E) está ATIVO desde 2026-05-01.

**Phase 5 fecha o gap "design intent → operacional"**: `soma sync --apply --tool={codex,claude}` executa write real de anchored blocks em bootloader files reais, com auto-snapshot pré-write + rollback empiricamente validado. Cross-LLM continuity (switching Codex/Claude mid-project sem perdas de contexto) deixa de ser claim teórica e vira behavior verificável.

**Risk surface crítico**: `${CLAUDE_HOME}/CLAUDE.md` é o self-model do orquestrador (~600 linhas com Failure Modes, MemPalace Protocol, Reuse Gate, Voxel theme). Atomic rollback validado via synthetic /tmp cycle ANTES de qualquer write real é não-negociável.

---

## Phase 4b Empirical State (discovered 2026-05-02 via Haiku audit + sync.cjs read)

**SURPRISE DISCOVERY**: Phase 4b sync.cjs (663 linhas) JÁ implementa `--apply` write-mode com snapshot infrastructure. Spec original (escrita pre-discovery) tinha 30% scope redundante. Discovery via failure mode #9 (NEW): "Spec sem verificar current state de módulo existente".

**Empirical evidence**:
- Snapshot dir created: `~/.soma-v2/.snapshots/2026-05-02T22:26:06Z/` (0600 perms ✓)
- ~/AGENTS.md (home-level Codex) has 2 soma-v2 anchors injected manually
- ~/.claude/CLAUDE.md has 2 soma-v2 anchors injected (cbm + soma-stsd; missing hyd-v2)
- ~/.codex/AGENTS.md still has 3 OLD-format markers (untouched)
- Frozen libs shasum preserved (zero modification)

**6 ACs DONE Phase 4b** (no impl needed): AC-02, AC-04, AC-06, AC-18, AC-19, AC-20
**5 ACs PARTIAL Phase 4b** (impl exists but bugs/gaps): AC-03, AC-05, AC-13, AC-14, AC-21
**6 ACs NEW Phase 5** (no impl): AC-01, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-15, AC-16, AC-17
**1 AC N/A sync.cjs scope**: AC-22 (thermal-guard external hook responsibility)

**7 Bugs empíricos surfaced (require fix em Phase 5)**:
1. **BF-01 Position bug**: writeBlock (sync.cjs:317-318) sempre append-end, NÃO honra Q3 lock "BEFORE ## Failure Log"
2. **BF-02 Section header missing**: writeBlock só escreve start+content+end sem wrapper "## SOMA Bootloader (managed by soma sync)" section
3. **BF-03 Consolidation mystery**: 3 install-targets entries Claude → only 2 blocks visíveis em CLAUDE.md (cbm + soma-stsd). hyd-v2 ausente. Snapshot manifest mostra 3 attempts. Possíveis causes: extractBlock matching stale OLD `<!-- hyd-v2:start -->` sub-marker dentro do cbm block content. Needs investigation.
4. **BF-04 Manifest schema shallow**: `soma-snapshot/v1` lacks `relative_path`, `file_size_bytes`, `block_ids_modified[]` per spec AC-05
5. **BF-05 Manifest dedup missing**: same file entry repeated 3x/2x em manifest em vez de 1x per file (snapshot manifest atual tem 5 entries pra 2 files)
6. **BF-06 Conflict warn-and-overwrite vs abort**: D4 path (sync.cjs:482-489) emite WARNING `LOCAL_EDITS_DETECTED` mas writes anyway. Spec AC-13 requer ABORT antes de write quando sha256 mismatch detectado.
7. **BF-07 Dry-run not default**: sync.cjs:67-69 requer `--dry-run` OU `--apply` flag explicit. Sem flag = error. Spec AC-01 requer dry-run como DEFAULT (sem flag).

---

## User Stories

- Como **o usuário (orchestrator) alternando entre Codex e Claude Code num mesmo projeto**, quero que ambos os LLMs leiam os mesmos modules, contracts, e decisions via `~/.codex/AGENTS.md` e `~/.claude/CLAUDE.md` populated pelo SOMA, pra continuity de contexto cross-tool sem manual copy-paste.
- Como **o usuário (owner do `~/.claude/CLAUDE.md` self-model)**, quero que toda write em CLAUDE.md tenha auto-snapshot pré-write + rollback testado em synthetic cycle ANTES de tocar o arquivo real, pra zero risco de corromper Failure Modes / MemPalace / Voxel theme se sync der bug.
- Como **future adapter implementer adicionando Cursor/Aider/ChatGPT-desktop integration (Phase 6+)**, quero que Phase 5 entregue pattern operacional reusable (snapshot + manifest + apply + rollback + migration + conflict-detection) que minimize risk de adicionar adapters N+1 sem refactor SOMA core.
- Como **CI/test runner executando hooks regression**, quero `SOMA_SAFE_PATHS_ONLY=1` env var sandbox que rejeita writes em paths fora de `/tmp/soma-v2-test/*` prefix, pra impossibilitar accidentally corromper real bootloader files durante dev/test.

---

## Acceptance Criteria — Status table

| AC | Description | Phase 4b Status | Action Phase 5 |
|---|---|---|---|
| AC-01 | dry-run default sem `--apply` | ❌ NEW | Implement (BF-07 fix: sem flag = dry-run, não error) |
| AC-02 | Codex 5 entries injection | ✅ DONE | Verify only |
| AC-03 | Claude 3 entries + position+header | 🟡 PARTIAL | Fix BF-01 + BF-02 (positional + section wrapper) |
| AC-04 | auto-snapshot pré-write | ✅ DONE | Verify only |
| AC-05 | per-snapshot manifest schema rich | 🟡 PARTIAL | Fix BF-04 + BF-05 (richer schema + dedup) |
| AC-06 | 0600 perms snapshot files | ✅ DONE | Verify only |
| AC-07 | rollback restore round-trip | ❌ NEW | Implement rollback.cjs |
| AC-08 | sha256 round-trip identity | ❌ NEW | Implement em rollback.cjs |
| AC-09 | rollback errors (NOT_FOUND, MANIFEST_MISSING, ...) | ❌ NEW | Implement em rollback.cjs |
| AC-10 | doctor migration_needed report | ❌ NEW | Extend doctor.cjs `--check-migration` |
| AC-11 | coexist mode default (OLD preserved) | ❌ NEW | Implement em sync.cjs migration logic |
| AC-12 | --migrate flag replaces in-place | ❌ NEW | Implement em sync.cjs |
| AC-13 | conflict detection ABORTS | 🟡 PARTIAL | Fix BF-06 (D4 path warns-and-overwrites; need abort) |
| AC-14 | conflict error msg w/ resolution guidance | 🟡 PARTIAL | Enhance message format pós-BF-06 |
| AC-15 | synthetic /tmp/phase5-validation/ cycle | ❌ NEW | Implement test |
| AC-16 | validation evidence em PR test output | ❌ NEW | Implement test logging |
| AC-17 | sandbox `SOMA_SAFE_PATHS_ONLY=1` enforcement | ❌ NEW | Implement sandbox check em sync.cjs + rollback.cjs |
| AC-18 | idempotent re-apply | ✅ DONE | Verify only (skip action quando sha matches) |
| AC-19 | content preservation outside blocks | ✅ DONE by design | Add explicit test |
| AC-20 | bootstrap install_targets_count=8 | ✅ DONE | Verify only |
| AC-21 | Article IV evidence em test output | 🟡 PARTIAL | Enhance: snapshot path em output mas missing post_write_sha256 |
| AC-22 | Article V thermal-guard | N/A | External hook scope; sync.cjs não muda |

**Score**: 6 DONE + 5 PARTIAL + 10 NEW + 1 N/A. Effective work: ~15 tasks (não 22).

---

## Acceptance Criteria

### Apply gating + dry-run default

- **AC-01:** Given `soma sync --tool={codex|claude}` invocado SEM flag `--apply`, when run, then output mostra dry-run preview com diff por entry (anchor inserts/replaces) + zero writes em real bootloader files (sha256 of target unchanged post-run).
- **AC-02:** Given `soma sync --apply --tool=codex`, when run, then 5 entries injetados (3 unique block_ids × 2 target paths: `~/.codex/AGENTS.md` + `~/AGENTS.md`) com anchor format `<!-- soma-v2:start id={id} version={ver} sha256={hex64} -->` ... `<!-- soma-v2:end id={id} -->` per Cláusula A.
- **AC-03:** Given `soma sync --apply --tool=claude`, when run, then 3 entries injetados em `~/.claude/CLAUDE.md` numa nova section `## SOMA Bootloader (managed by soma sync)` posicionada ANTES de existing `## Failure Log` section.

### Snapshot infrastructure (D-C15)

- **AC-04:** Given any `--apply` invocation, when sync starts, then auto-snapshot criado em `~/.soma-v2/.snapshots/{ISO-timestamp}/{tool}/{file-relative-path}` BEFORE any write attempt; if snapshot creation fails, sync aborts with exit 1 + zero writes.
- **AC-05:** Given snapshot directory criada, when sync completes (or aborts), then per-snapshot manifest em `~/.soma-v2/.snapshots/{ISO-timestamp}/manifest.json` contém entry per file com `{relative_path, sha256_pre_write, file_size_bytes, block_ids_modified[]}`.
- **AC-06:** Given snapshot files written, when permissions inspected, then files have user-only perms (0600 ou stricter) — no group/other read access.

### Rollback (NEW command)

- **AC-07:** Given snapshot ID `{ISO-timestamp}` exists em `~/.soma-v2/.snapshots/`, when `soma rollback --snapshot-id {ISO}` invoked, then for each manifest entry: file restored from snapshot copy + post-restore sha256 verified vs `sha256_pre_write` em manifest + exit 0 only if all match.
- **AC-08:** Given rollback completes successfully, when target files inspected, then sha256 of each restored file equals `sha256_pre_write` from manifest (round-trip identity).
- **AC-09:** Given snapshot ID not found OR manifest sha256 mismatch detected post-restore, when rollback run, then exit 1 com explicit error citing snapshot path + which file failed + recovery guidance.

### Migration (Q1 lock — Validate-then-migrate)

- **AC-10:** Given pre-existing OLD-format markers em `~/.codex/AGENTS.md` (ex: `<!-- codebase-memory-mcp:start -->` ... `<!-- codebase-memory-mcp:end -->`), when `soma doctor` run, then output reports `migration_needed=true` com count of OLD markers detected per file + level=WARNING (yellow), exit 0 (não-fatal).
- **AC-11:** Given OLD markers present E `--apply` invoked WITHOUT `--migrate` flag, when sync runs, then OLD markers preserved byte-identical (coexist mode) + new soma-v2 anchors written em positions OUTSIDE OLD marker ranges.
- **AC-12:** Given OLD markers present E `--apply --migrate` invoked, when sync runs, then OLD markers replaced em-place by equivalent soma-v2 v2 anchors (same `id` derived from OLD marker name, e.g. `codebase-memory-mcp` → `block.codex.AGENTS.codebase-memory-mcp`) + auto-snapshot preserves OLD content for rollback.

### Conflict detection (Q6 lock — user-initiated re-sync only)

- **AC-13:** Given user manually edited content INSIDE a soma-v2 anchored block range em `~/.codex/AGENTS.md` ou `~/.claude/CLAUDE.md` between sync apply runs, when `--apply` invoked, then sha256 of current block content mismatch detected vs last-known sha256 em latest manifest + sync aborts with exit 1 + zero writes.
- **AC-14:** Given conflict detected, when error displayed, then output includes: target file path + block_id + expected sha256 (from manifest) + actual sha256 (current state) + manual resolution guidance ("Inspect block, decide: rollback to pre-edit state via `soma rollback`, OR re-extract content into source doc and re-sync").

### Synthetic validation cycle (Q4 lock — mandatory pre-real-write)

- **AC-15:** Given test fixture em `/tmp/phase5-validation/CLAUDE.md.fixture` (cópia de real CLAUDE.md no test setup), when validation test executes accidental-crash scenario (sync starts, mid-write SIGKILL simulated, then rollback invoked), then post-rollback sha256 of fixture file equals pre-sync sha256 (round-trip identity asserted).
- **AC-16:** Given validation test passes em /tmp fixture, when same logic invoked against real `~/.claude/CLAUDE.md` for first time, then validation evidence (sha256 round-trip log) presente em PR test output per Article IV (Proof Before Done).
- **AC-17:** Given sandbox env `SOMA_SAFE_PATHS_ONLY=1` set em test runs, when sync attempts write em path NOT prefixed with `/tmp/soma-v2-test/`, then exit 1 com sandbox violation error + zero writes (prevents accidental real-file corruption during dev/test).

### Idempotency + content preservation

- **AC-18:** Given `--apply` just executed successfully, when same sync command re-run WITHOUT any source doc changes, then dry-run preview reports "no diff" + idempotent re-apply produces zero changes (no-op).
- **AC-19:** Given `--apply` executed, when sha256 computed for non-anchored regions of `~/.codex/AGENTS.md` + `~/.claude/CLAUDE.md` (regions OUTSIDE all soma-v2 block ranges), then matches sha256 of same regions PRE-apply (user content outside anchored blocks preserved byte-identical).

### Bootstrap integration

- **AC-20:** Given `~/.soma-v2/adapters/claude/install-targets.json` populated with 3 entries (cbm/hyd-v2/soma-stsd) per D-C11 Cláusula E, when `soma bootstrap` run, then output reports `install_targets_count=8` (Codex 5 + Claude 3) + per-tool breakdown.

### Constitutional compliance

- **AC-21:** Article IV (Proof Before Done) — every `--apply` test run logs pre-write snapshot path + manifest sha256 + post-write file sha256 to test output, providing evidence trail for PR review.
- **AC-22:** Article V (Thermal Guard) — `sync --apply` operations counted toward 3-simultaneous compile/test limit enforced by `thermal-guard.cjs` hook (PreToolUse Agent|TeamCreate); concurrent `--apply` invocations beyond limit blocked.

---

## Bug Fix Requirements (Phase 4b empirical bugs)

These are remediation work items (not new features). Each blocks the corresponding AC from being satisfied.

- **BF-01: Position bug** — `writeBlock` em `~/.soma-v2/scripts/sync.cjs:317-318` sempre append-end. Fix: implementar positional logic suportando "insert BEFORE marker X" para honrar Q3 lock (blocks BEFORE `## Failure Log`). Blocks AC-03.
- **BF-02: Section header missing** — `writeBlock` só escreve start+content+end markers sem wrapper section. Fix: optional flag em install-targets entry `wrapper_section: "## SOMA Bootloader (managed by soma sync)"` que sync.cjs respeita criando section header se ausente. Blocks AC-03.
- **BF-03: Consolidation mystery** — 3 install-targets entries Claude → only 2 blocks visíveis em CLAUDE.md (cbm + soma-stsd; hyd-v2 ausente). Snapshot manifest mostra 3 attempts. Fix: investigate `extractBlock`/`computeEntryAction` logic — possível: extractBlock retorna found=true para `block.claude.CLAUDE_md.hyd-v2` quando encontra OLD `<!-- hyd-v2:start -->` (sub-marker dentro do cbm block), causando computeEntryAction → 'skip' OR writeBlock em-place edit destrói cbm content. Test cases needed para reproduce + fix. Blocks AC-03.
- **BF-04: Manifest schema shallow** — `~/.soma-v2/.snapshots/{ISO}/manifest.json` schema `soma-snapshot/v1` lacks `relative_path`, `file_size_bytes`, `block_ids_modified[]` per spec AC-05. Fix: bump schema to `soma-snapshot-manifest/v1` (per spec) com richer fields. Backward compat: read both v1 schemas. Blocks AC-05.
- **BF-05: Manifest dedup missing** — atual manifest tem entry repetida 3x para CLAUDE.md (1 per install-targets entry). Esperado: 1 entry per UNIQUE file path (regardless of number of blocks written nesse file). Fix: dedup em `createSnapshot` helper antes de write manifest. Blocks AC-05.
- **BF-06: Conflict warn-and-overwrite vs abort** — D4 path em sync.cjs:482-489 emite WARNING `LOCAL_EDITS_DETECTED` mas writes anyway (preserves snapshot pra rollback). Spec AC-13 requer ABORT antes de write quando sha256 mismatch (compound: block atual sha256 != manifest expected sha256). Fix: adicionar `--allow-local-edits` opt-in flag (default OFF); without flag, conflict detection aborta com BLOCK_CONFLICT error. Existing D4 warn-and-write behavior preservado via opt-in. Blocks AC-13.
- **BF-07: Dry-run not default** — sync.cjs:67-69 requer `--dry-run` OU `--apply` flag explicit. Sem flag = error. Spec AC-01 quer dry-run como DEFAULT. Fix: remover error condition; default mode = dry-run; `--apply` opt-in for write. Backward compat: `--dry-run` flag continua valid (no-op vs default but preservado). Blocks AC-01.

---

## Non-Functional Requirements

- **Performance:** `sync --apply` on 8 entries (Codex 5 + Claude 3) completes ≤2s wallclock excluding snapshot copy; snapshot copy ≤500ms per file (≤4MB CLAUDE.md typical).
- **Security:** Snapshot files user-only perms (0600). Rollback requires explicit `--snapshot-id` (no auto-rollback). Sandbox via `SOMA_SAFE_PATHS_ONLY=1` env mandatory em CI test runs. Zero external network calls — single-machine local-only operations.
- **Test style:** Integration tests usam real fs ops em `/tmp/phase5-validation/{test-name}/` fixtures. Real `~/.codex/AGENTS.md` + `~/.claude/CLAUDE.md` files NUNCA tocados em test runs (sandbox enforced via `SOMA_SAFE_PATHS_ONLY=1`). Zero mocks pra fs/path/sha256 (stdlib direct).
- **Test count target:** ≥40 tests cobrindo: dry-run vs apply, snapshot creation + manifest schema, rollback round-trip, migration coexist + replace modes, conflict detection sha256 mismatch, synthetic validation cycle, sandbox enforcement, idempotency, content preservation, bootstrap integration count.
- **Backward compat:** `sync --apply` ainda default-to-dry-run-when-no-`--apply-flag` per Phase 4b behavior. Existing Phase 4b sync workflows não-disruptados.
- **TDD discipline:** RED commits separated from GREEN per Article II HARD + C-2 enforcement. Dispatch prompt MUST set `SOMA_RED_PHASE_STRICT=1` env. RED phase tests for AC-15/AC-16/AC-17 trap scenarios são especialmente críticos.
- **Monitoring:** Sync execution logs to `~/.soma-v2/logs/sync-{YYYY-MM-DD}.jsonl` com schema `{schema: "soma-sync-log/v1", timestamp, tool, mode: "dry-run"|"apply"|"migrate", entries_count, snapshot_id, exit_code, duration_ms}`. `soma doctor --check-sync-log` future flag (Phase 6+) reads log for ops review.

---

## Out of Scope

- **Cursor/Aider/ChatGPT-desktop adapter install** — those adapters keep `entries: []` MVP per Sprint 009; adapter install for them deferred to Phase 6+.
- **`--full-canaries` real LLM benchmark** — cross-LLM continuity validation via real Codex+Claude API canaries deferred to Phase 6 (Bucket F).
- **Multi-host distributed sync** — Phase 5 é single-machine only. Distributed sync (e.g., team shared `.soma/`) é Phase 7+ research.
- **Auto-merge of conflicting user edits** — sync aborts on conflict (AC-13); manual resolution required. No auto-merge logic.
- **Auto-rollback on detect-failure** — rollback always requires explicit `soma rollback --snapshot-id {ISO}` invocation by the user. No auto-rollback on health check failures.
- **Per-block partial migration** — `--migrate` é all-or-nothing per `--apply` call (atomic). Per-block selective migration deferred Phase 6+ if false-pattern surfaced.
- **Cross-tool block sharing** — each tool has isolated block namespace per Cláusula A (`block.codex.*` ≠ `block.claude.*`). No shared block_ids cross-tools.
- **Snapshot pruning / retention policy** — snapshots accumulate indefinitely em `~/.soma-v2/.snapshots/`. Pruning command `soma snapshot prune --older-than {N}d` deferred Phase 6+.
- **GUI / TUI for sync preview** — dry-run output is plain text + diff format. Interactive preview deferred Phase 6+.

---

## Resolved Decisions

12/12 NCs sentenced 2026-05-02 by the user ("aceito tua recomendação" pattern em Q1-Q4; Q5-Q12 derived defaults documented com rationale + codebase discovery evidence):

- **Q1 — Pre-existing OLD-format markers handling**: Validate-then-migrate. `soma doctor` warns (level=WARNING, exit 0); `--migrate` opt-in flag converts OLD markers em-place; default behavior is coexist (don't touch OLD markers, write new soma-v2 anchors elsewhere in file).
- **Q2 — Claude source_doc mapping**: Mirror Codex pattern. `block.claude.CLAUDE_md.cbm` → `docs/hyd-v2.md`; `block.claude.CLAUDE_md.hyd-v2` → `docs/hyd-v2.md`; `block.claude.CLAUDE_md.soma-stsd` → `docs/soma-stsd.md` (cbm extracted as sub-section of hyd-v2.md per existing Codex convention).
- **Q3 — Injection point in `~/.claude/CLAUDE.md`**: Append new section `## SOMA Bootloader (managed by soma sync)` at end-of-file, BEFORE existing `## Failure Log` section. Anchor blocks live as children of new section.
- **Q4 — Atomic rollback empirical validation**: Mandatory synthetic test cycle em `/tmp/phase5-validation/{test-name}/` (cópia do CLAUDE.md, simulate crash mid-write, restore from snapshot, sha256 round-trip identity assertion) BEFORE first real `--apply` against `~/.claude/CLAUDE.md`. Validation evidence required em PR test output (Article IV).
- **Q5 — `soma rollback --snapshot-id` é NEW command**: parte da Phase 5 spec scope (necessário pra trap test AC-15 + AC-07/08/09 round-trip assertion). Não é separate spec.
- **Q6 — Conflict re-sync trigger**: User-initiated only. `soma sync --apply` always re-checks block sha256 vs latest manifest before write; aborts on mismatch. Auto-sync (e.g., file watcher) deferred Phase 6+.
- **Q7 — Manifest format**: Per-snapshot manifest em `~/.soma-v2/.snapshots/{ISO-timestamp}/manifest.json` (immutable per snapshot, no shared global file lock). Mirror existing Phase 4b snapshot-manifest pattern.
- **Q8 — `--migrate` behavior**: Destructive but reversible. OLD markers replaced in-place by soma-v2 v2 anchors at same byte position; auto-snapshot preserves OLD content for rollback. `soma rollback --snapshot-id {ISO}` restores OLD markers if migration causes regression.
- **Q10 — Sandbox enforcement em dev/test**: `SOMA_SAFE_PATHS_ONLY=1` env var force writes só em `/tmp/soma-v2-test/*` prefixed paths. Pre-condition validated em test fixture setUp. CI test runs MUST set this env var.
- **Q11 — Doctor migration warning level**: `level=WARNING` (yellow), `exit 0` only if 0 ERRORS (migration is non-fatal — coexist mode is functional). Easy to ignore intentionally; visible in doctor output for awareness.
- **Q12 — Codex `~/AGENTS.md` (home-level) vs `~/.codex/AGENTS.md` (tool-level) priority**: Both targets independently injected per existing 5 entries layout. Bootstrap reports total count = 5 (NOT 3 unique block_ids; counts entries not unique IDs). No deduplication logic needed.
- **Q9 — block_id collision across entries em mesma `install-targets.json`**: Permitted when target_path differs. Uniqueness key is compound `(block_id, target_path)`, not standalone `block_id`. Discovery evidence (2026-05-02): `~/.soma-v2/scripts/lib/manifest.cjs:74` validates 4 required fields per entry but NOT block_id uniqueness across entries; `~/.soma-v2/scripts/doctor.cjs` has zero collision checks. Codex production today has duplicate `block.codex.AGENTS.codebase-memory-mcp` em 2 entries with distinct target_paths (`~/.codex/AGENTS.md` + `~/AGENTS.md`) — works as intended. Per-snapshot manifest.json references files by `relative_path` (not block_id), so no ambiguity downstream. Phase 5 sync logic must respect compound key when computing diffs and writes.

---

## Open Questions

_(none — all 12 NCs resolved 2026-05-02)_

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT — except AC-22 references thermal-guard.cjs hook by name which is constitutional reference, acceptable)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining (12/12 NCs resolved 2026-05-02; Q9 lock via codebase discovery evidence — manifest.cjs+doctor.cjs both permissive for compound-key uniqueness)
- [x] NFR section has performance SLO + security constraints + test style + monitoring
- [x] Out of Scope section has 9 entries
- [x] Feature ID + Branch filled in
- [x] Constitutional compliance ACs (AC-21 Article IV + AC-22 Article V) explicit
- [x] Synthetic validation cycle pre-real-write requirement (AC-15/AC-16) explicit per Q4 lock

---

## Source Decisions Lineage

- **D-C11** (Adapter Contract, locked 2026-05-01) — Cláusula E concretization é Phase 5 deliverable
- **D-C15** (Backups location, locked 2026-05-01) — `~/.soma-v2/.snapshots/{ISO}/{adapter}/{path}` + sha256 manifest is Phase 5 implementation target
- **C-2** (validateRedPhase Article II HARD operacionalizado, shipped 2026-05-02) — Phase 5 dispatch MUST set `SOMA_RED_PHASE_STRICT=1`
- **Phase 4b sync infrastructure** (shipped 2026-05-02) — snapshot+manifest+trap+D4 já operational; Phase 5 extends with `--apply` write-mode execution + rollback command + migration logic + conflict detection
- **Discovery 2026-05-02** — Haiku audit + sync.cjs full read revelou: Phase 4b já implementa `--apply` write-mode (663 linhas, comment header explicit). Original Spec 011 era ~30% redundante. Re-spec executed (this revision): Bug Fix Requirements section added (BF-01..BF-07); AC status table added; tasks.md scope reduzido de 15 → ~12 tasks. Failure Mode #9 added to ~/.claude/CLAUDE.md ("Spec sem verificar current state de módulo existente"). Lesson estrutural: Haiku audit READ-ONLY como pre-Sonnet verification gate quando feature extende módulo existente.

---

## Phase 5 → Phase 6 unblock conditions

After Phase 5 ships:
- ✅ `soma sync --apply --tool={codex,claude}` operational with rollback empirically validated
- ✅ `~/.codex/AGENTS.md` + `~/AGENTS.md` + `~/.claude/CLAUDE.md` contain soma-v2 v2 anchored blocks
- ✅ Bootstrap reports `install_targets_count=8`
- ✅ Cross-LLM continuity foundation operational (artifact-level → tool-level handoff capability)

→ Unblocks Phase 6 Benchmark v2 real LLM canaries (Bucket F) — empirical validation of cross-LLM consistency claim via Codex+Claude API runs against same `.soma/` context.
