# Spec: SOMA v2.2 — Soma Install Canonical Command

<!-- guidance: Fill every {PLACEHOLDER}. Replace [NEEDS CLARIFICATION: ...] only when you have a real answer from the human. Never assume. -->

**Feature ID:** 015-soma-install
**Branch:** `feature/015-soma-install`
**Created:** 2026-05-09
**Status:** APPROVED — Felipe Gate #1 approval 2026-05-09 ("só vai... tu já tá aprendendo como eu penso"). Transitioning to /plan-sdd Step 2.

**Layer 0 Discovery Reference:** `core/specs/015-soma-install/discovery.json` (Haiku audit 2026-05-09T14:45:00Z, sourceRepoSha: 51c3272). Empirical state captured pre-spec satisfies failure mode #9 (Discover Before Specify).

**Plan Reference:** `~/.claude/plans/o-que-acontece-eu-precious-tulip.md` (6 layers: L0 done; L1 install CLI; L2 docs; L3 slash prereqs; L4 hydra retroactive; L5 cross-harness skills; L6 BF-06 sync abort fix).

**Scope Bundle:** install command (L1) + canonical docs (L2) + slash command prereqs (L3) + cross-harness skill frontends (L5) + BF-06 sync.cjs abort fix (L6) + retroactive hydra fix (L4 post-merge).

---

## User Stories

<!-- guidance: Minimum 1. Format: "Como <user>, quero <action>, pra <outcome>" -->

- **US-01:** Como Felipe (developer com novo projeto fresh), quero rodar `soma install <project-path> --tool=claude` em uma única chamada, pra que SOMA fique **completamente instrumentado** (`.soma/`, manifest.json, `.soma/install-state.json`, CLAUDE.md anchored bootloader block) sem editar arquivos manualmente nem rodar 3 sub-comandos em sequência.

- **US-02:** Como agente Sonnet em sessão Claude Code, quero invocar `/soma:install <path>` automaticamente quando o user pedir "instalar SOMA aqui" (ou variantes em PT-BR/EN), pra que o full install execute em vez de só fazer scaffold conceitual com edits livres em CLAUDE.md (failure que aconteceu no projeto hydra em 2026-05-08).

- **US-03:** Como agente Codex em sessão Codex (cross-harness equivalent), quero ativar a skill via mecanismo Codex-nativo (AGENTS.md registry entry — exato schema TBD), pra que o install command opere de forma consistente cross-harness com mesmo backbone Node.js (zero divergência runtime entre Claude e Codex).

- **US-04:** Como Felipe re-instalando em projeto já com SOMA + edições manuais minhas em CLAUDE.md, quero que `soma install` **detecte drift** (sha mismatch no anchored block) e **ABORTE** com mensagem de recovery clara (snapshot-id + flag options), em vez de silently sobrescrever minhas edições — corrige BF-06 em `sync.cjs` que atualmente warn-and-overwrites.

---

## Acceptance Criteria

<!-- guidance: Every AC must be testable: "Given X, when Y, then Z". No implementation details. No HOW — only WHAT and WHY. ACs grep-based / objective per Verification Plan no plan file. -->

## Note on User-Globals

v2.1 introduced three user-global blocks that SOMA writes to `~/.claude/CLAUDE.md` (the user's global Claude config):

- `block.claude.CLAUDE_md.soma-voxel` — output-style theme (SOMA Voxel)
- `block.claude.CLAUDE_md.hyd-v2` — HYD v2 cognitive discipline
- `block.claude.CLAUDE_md.soma-stsd` — SOMA / STSD operating lens

These three blocks remain **user-global in v2.2** — they carry cross-project disciplinary context that belongs to the developer's global config, not to individual projects.

v2.2 **adds** a new project-scoped block (`block.claude.CLAUDE_md.project-bootloader`) that SOMA writes to `<project>/CLAUDE.md` (the project-local Claude config). This block provides project-specific SOMA context: installed version, harness, manifest sha, install timestamp, and workflow reminders. It is SEPARATE from user-globals — `soma install` writes it to the project dir, not to `~/.claude/CLAUDE.md`.

**Resolution of AC-01 gap (T-08bis):** The spec literal "CLAUDE.md anchored bootloader block" in AC-01 refers to `<project>/CLAUDE.md`, not `~/.claude/CLAUDE.md`. This was the gap identified pre-implementation: `soma install` previously wrote only to user-globals, leaving the project dir CLAUDE.md untouched. T-08bis closes this by adding Step 3b in `install.cjs` that syncs `install-targets.project.json` with `cwd=projectPath`.

### Greenfield + Idempotence (4 cenários)

- **AC-01 (greenfield install):** Given empty git-initialized project at `/tmp/soma-test-fresh`, when `soma install . --tool=claude` runs, then exit code is 0 AND `.soma/` directory exists AND `manifest.json` exists at project root AND `.soma/install-state.json` exists AND `grep -c '<!-- soma-v2:start' CLAUDE.md` returns exactly 1.

- **AC-01b (project-bootloader block content):** Given greenfield install as above (AC-01 passing), when `cat <project>/CLAUDE.md` is inspected, then the anchored block content MUST contain ALL of the following literal substrings:
  - `## SOMA install` (section heading present)
  - `## Project artifacts` (section heading present)
  - `## Workflow` (section heading present)
  - `This project uses SOMA v` (preamble with version prefix)
  - `2.2.0` (resolved version — no unresolved `{{version}}` placeholder)
  - `claude` (resolved harness — no unresolved `{{harness}}` placeholder)
  - No occurrence of `{{` anywhere in the block (all template vars resolved)

  **Verification:** `grep -c '{{' <project>/CLAUDE.md` must return 0 AND `grep -c '## SOMA install' <project>/CLAUDE.md` must return 1 AND `grep -c '2\.2\.0' <project>/CLAUDE.md` must return ≥ 1.

- **AC-02 (idempotent re-run clean):** Given project full-installed (state matches snapshot), when `soma install . --tool=claude` runs again, then exit code is 0 AND `grep -c '<!-- soma-v2:start' CLAUDE.md` returns exactly 1 (no duplicate block) AND output contains literal "no changes" OR equivalent in `--dry-run` mode.

- **AC-03 (drift detection abort):** Given anchored block exists in CLAUDE.md but user added text inside the anchored region (sha mismatch), when `soma install . --tool=claude` runs without `--force-resync` or `--allow-local-edits`, then exit code is 2 AND stderr contains literal substring "soma rollback" OR "force-resync" hint with snapshot-id.

- **AC-04 (partial state recovery):** Given `.soma/` directory exists but anchored block missing in CLAUDE.md, when `soma install` runs, then exit code is 0 AND anchored block is injected AND init step is skipped (verified via timing or log entry).

- **AC-05 (mid-pipeline failure rollback):** Given init succeeded but manifest baseline failed (simulated via fs permissions), when install detects partial state, then exit code is 2 AND stderr contains snapshot-id reference AND `.soma/install-state.json` field `status` is "partial-failed".

### Edge Cases

- **AC-06 (path com espaço + hyphen leading):** Given path `/tmp/- soma test fresh hyphen` exists (matches hydra real path pattern), when `soma install "/tmp/- soma test fresh hyphen" --tool=claude` runs, then argv parsing succeeds AND child_process spawn correctly handles quoted path AND exit code is 0.

### Custom CLAUDE.md handling (3 flags)

- **AC-07 (custom CLAUDE.md merge default):** Given CLAUDE.md has 35 lines of free-text "SOMA-managed" content without anchor markers (matches hydra `d388fcc...`), when `soma install <path> --merge-claude-md` runs, then no original lines are deleted (`grep -c '^<' diff_pre_post` returns 0) AND anchored block is appended after existing content AND exit code is 0.

- **AC-08 (custom CLAUDE.md replace):** Given CLAUDE.md has free-text content, when `soma install <path> --replace-claude-md` runs, then snapshot of original is captured to `~/.soma-v2/.snapshots/<timestamp>/` AND CLAUDE.md is replaced with anchored block only AND exit code is 0 AND snapshot rollback path is documented in stdout.

- **AC-09 (abort default non-interactive):** Given CLAUDE.md has free-text "SOMA-managed" content (no anchors), when `soma install <path>` runs in non-interactive mode (e.g., piped or CI) without `--merge-claude-md` or `--replace-claude-md` flag, then exit code is 2 AND stderr names both flags as remediation options.

### Cross-harness frontend (Layer 5)

- **AC-10 (Claude skill `/soma:install` activation):** Given Claude Code session in project without `.soma/`, when user prompt is "instalar o SOMA aqui" (Portuguese) OR "install soma here" (English), then agent invokes Bash tool with command containing literal substring `node ~/.soma-v2/scripts/soma.cjs install` (or equivalent invocation path) AND agent response does NOT contain instruction "edit CLAUDE.md manually".

- **AC-11 (Codex equivalent activation):** Given Codex CLI session, when user invokes equivalent skill activation per Codex convention (mechanism per AC-NEEDS-CLARIFICATION-1), then Codex invokes same backbone CLI with identical args schema as Claude skill (verified via transcript inspection or test harness).

- **AC-15 (cross-harness args schema parity):** Given args schema defined in `install.cjs`, when Claude skill `core/adapters/claude/commands/soma-install.md` and Codex AGENTS.md entry both expose the install command, then both expose identical flags: `--tool`, `--dry-run`, `--merge-claude-md`, `--replace-claude-md`, `--force-resync`, `--allow-local-edits` (verified via skill metadata frontmatter diff modulo translation).

### Slash command guard (Layer 3)

- **AC-12 (slash command prereq guard):** Given project without `.soma/` directory, when user invokes `/soma-run` or `/specify` or `/plan-sdd`, then command body emits warning containing `soma install` as remediation OR aborts with exit message naming the install command.

### Cleanup (Layer 0 confirmed orphan)

- **AC-13 (`.no-execute` deletion):** Given Layer 0 discovery.json field `noExecuteSentinel.verdict === "orphan-safe-to-delete"` AND zero consumers found via grep audit, when v2.2 ships, then `core/.no-execute` (if exists) AND `~/.soma-v2/.no-execute` are removed AND post-merge `grep -rn '\.no-execute' core/ ~/.claude/hooks/` returns zero matches.

### BF-06 fix (Layer 6 — bundled per Felipe decision)

- **AC-14 (BF-06 sync.cjs abort behavior):** Given anchored block sha mismatch in target file, when `soma sync --apply` runs without `--allow-local-edits` flag, then sync aborts with exit code 2 AND stderr contains snapshot-id reference for recovery AND `core/scripts/__tests__/sync-bf06-abort.test.js` covers 3 test cases (sha match → proceed exit 0; sha mismatch no flag → abort exit 2; sha mismatch with `--allow-local-edits` → proceed with warning exit 0). **Closes Spec 011 AC-13.**

- **AC-19 (conflict error msg w/ resolution guidance — paired with BF-06):** Given conflict detected (sha mismatch from BF-06), when error msg displayed, then output contains: target file path AND block_id AND expected sha256 (from manifest) AND actual sha256 (current state) AND manual resolution guidance naming both options ("inspect block + run `soma rollback --snapshot-id <X>` to revert OR re-extract content into source doc + re-sync OR pass `--force-resync` to overwrite"). **Closes Spec 011 AC-14.** Test: `core/scripts/__tests__/sync-bf06-abort.test.js` extended to assert error message contains all 5 elements via grep.

### State + invariants

- **AC-16 (state file location cross-harness):** Given install completes successfully, when state file is written, then file path is `<project>/.soma/install-state.json` (NOT `/tmp/`) AND file is valid JSON containing fields: `status` (one of "complete"/"partial-failed"/"drift-detected"), `timestamp` (ISO-8601), `snapshotId`, `harness` (one of "claude"/"codex"), `installedVersion`.

- **AC-17 (frozen libs HARD invariant):** Given v2.2 implementation commits, when shipped, then `core/scripts/lib/anchored-blocks.cjs` sha256 == `6db9bbcb...` AND `core/scripts/lib/manifest.cjs` sha256 == `08a0f164...` AND `core/scripts/lib/template-engine.cjs` sha256 == `f13ae144...` (Constitution Article XII HARD invariant — byte-identical to f3c2f0b baseline).

- **AC-18 (Layer 0 discovery consumption traceability):** Given spec references `discovery.json` findings, when `/plan-sdd` runs in Step 2, then `plan.md` cites specific `discovery.json` fields/values for: adapter paths (claude+codex), BF-06 evidence quote, hydra `d388fcc...` sha, bucket A NOT-blocking verdict — no assumptions re-introduced.

---

## Non-Functional Requirements

<!-- guidance: List explicitly. At minimum: performance SLO, security constraints, test style (integration/unit/contract), monitoring expectations. -->

- **Performance:** Install command completes in < 5 seconds for greenfield project (no network calls — all local fs operations + sub-process invocations of init/manifest/sync). p95 < 8s under sequential test runs.
- **Host prereq (NCL-2 resolution):** Node v22+ on host machine (the dev's Mac/Linux/WSL2 running Claude Code). Target project's app runtime (Bun, Python, Go, etc.) is INDEPENDENT — install does not impose runtime choice on the project. INSTALL.md docs Node v22+ as system prereq with version check + install hint if absent.
- **Security:** Install does NOT require sudo or root permissions; uses user-level fs perms only. Secrets/tokens NEVER logged to stdout/stderr/state files. ANTHROPIC_API_KEY (per memory `feedback_api_key_explicit_permission.md`) NOT consumed by install.
- **Test style:** Integration tests use real fs operations + real `.soma/` directory creation (NO mocks per failure log lesson — "don't mock the database in these tests"). Unit tests for argv parsing acceptable. Cross-harness skill smoke test requires actual Claude Code session OR documented stub.
- **Monitoring:** Install emits structured JSON to stderr on exit 2 (drift abort or partial failure) for downstream telemetry capture (format TBD in plan-sdd contracts/). Insight-coupling hook (`~/.claude/hooks/insight-action-coupling.cjs`) NOT triggered by install command (out of scope).
- **Compatibility:** Backwards compatible with `soma init` standalone — `soma install` is a new orchestrator subcommand, NOT a replacement.
- **Idempotency:** install must be safe to re-run from any state without data loss — drift always triggers fail-loud, never silent overwrite.
- **Concurrency (NCL-4 resolution):** file-based lock at `<project>/.soma/install.lock` containing `{pid, timestamp, hostname}`. On install start: check lock → if exists + age < 60min, abort exit 2 naming PID; if exists + age ≥ 60min, treat as orphan + auto-clean with warning. On install end (success/failure): lock removed in finally block.

---

## Out of Scope

<!-- guidance: Explicit "will not" list prevents scope creep. Write at least one entry. -->

- **AIOS framework integration** — workspace `.claude/CLAUDE.md` mentions `@dev`, `@qa`, etc. SOMA install fica agnostic, não toca AIOS-specific paths.
- **Telemetry events emission** to `~/.claude/logs/insight-coupling-*.jsonl` — install command does not write telemetry in this version.
- **Symlink global `/usr/local/bin/soma`** — separable, ships independent post-v2.2 if Felipe wants.
- **Snapshot retention policy / cleanup** — `~/.soma-v2/.snapshots/` accumulation handled in v2.3.
- **Spec 011 PARTIAL ACs not bundled in v2.2** (NCL-7 RESOLVED): AC-13 (BF-06) ✅ bundled (Layer 6) + AC-14 (conflict error msg) ✅ bundled (paired with BF-06). DEFERRED to v2.3: AC-03 (Claude position+wrapper BF-01/BF-02), AC-05 (manifest schema rich BF-04/BF-05), AC-21 (Article IV evidence post_write_sha256 logging). Capture-Before-Defer: tracked in plan file Out of Scope + Risks R22.
- **Legacy v2.1.x bootloader migration** (NCL-3 RESOLVED — no migration support; user cleans manually OR uses --force-resync flag).
- **Reescrever todos os 11 slash command prereq stanzas** — só os 3 críticos (`run.md`, `specify.md`, `plan-sdd.md`) em v2.2; outros 8 ficam pra v2.3 polish pass.
- **Migrar `soma-v2-build-68-test/install.sh` pra canonical** — system-level install já é solved problem; v2.2 foco em project-level install.
- **Concurrent install lockfile mechanism implementation** — flagged Open Question; design decided in plan-sdd if NEEDS_CLARIFICATION-4 resolved.
- **Hook-based runtime guard** que detecta install ambíguo at edit-time — futuro work se cross-harness skill triggers prove insufficient.

---

## Open Questions — RESOLVED 2026-05-09

<!-- All 8 markers resolved via Felipe input + self-resolved reads. Original markers preserved for traceability. -->

- ✅ **[NCL-1: Codex AGENTS.md schema] RESOLVED via read of `core/adapters/codex/AGENTS.md`**
  Schema = anchored block format `<!-- soma-v2:start id=block.codex.AGENTS.{name} version=... sha256=... -->` + markdown body + `<!-- soma-v2:end id=block.codex.AGENTS.{name} -->`. Existing blocks: `codebase-memory-mcp`, `hyd-v2`, `soma-stsd`. v2.2 Layer 5b adds new block `id=block.codex.AGENTS.soma-install` containing skill description + activation guidance (PT/EN triggers + invocation example).

- ✅ **[NCL-2: Bun vs Node target] RESOLVED via Felipe**
  Felipe distinção crítica: target project's runtime (Bun for hydra, Python for X, etc.) é INDEPENDENTE de install command runtime. Install requires **Node v22+ on host machine** (hard requirement; documented in INSTALL.md prereqs). Every Claude Code dev already has Node — non-issue practically. SOMA does NOT impose Bun/Node choice on the project.

- ✅ **[NCL-3: Legacy migration v2.1.x] RESOLVED via Felipe — OUT OF SCOPE**
  v2.2 install does NOT support v2.1.x bootloader format upgrade. If pre-existing v2.1.x bootloader detected → abort with hint "manual cleanup required OR use --force-resync to overwrite". No `--migrate` flag. Out-of-Scope item updated to reflect this.

- ✅ **[NCL-4: Concurrent install lockfile] RESOLVED via Felipe — confirmed approach**
  File-based lock at `<project>/.soma/install.lock` (~10 LOC implementation). On install start: check lock exists → if yes, abort exit 2 + name PID/timestamp from lock content. On install end (success or failure): lock removed. Stale lock detection: if lock older than 60min, treat as orphan + auto-clean with warning.

- ✅ **[NCL-5: NL trigger phrasings] RESOLVED via Felipe approval — 8 canonical phrasings**
  Skill description frontmatter `triggers:` array:
  1. `"instalar o SOMA neste projeto"` (PT)
  2. `"instalar SOMA aqui"` (PT short)
  3. `"configurar SOMA neste repo"` (PT formal)
  4. `"set up SOMA in this repo"` (EN)
  5. `"install soma here"` (EN short)
  6. `"soma install"` (CLI direct)
  7. `"/soma:install"` (slash command)
  8. `"add SOMA to this project"` (EN alt)
  Drift testing: cross-harness contract test verifies same `triggers` array (modulo language) em Claude `/soma:install` skill source AND Codex AGENTS.md anchored block.

- ✅ **[NCL-6: SONAR spec-adherence dimension] RESOLVED via read of `~/.claude/commands/sonar-audit.md`**
  spec-adherence existe **implicitamente** no Test agent (Step 2 — Agent 3 Tests, line 99: "Verifique se cada AC do spec.md tem pelo menos 1 teste que o exercita"). AC-18 traces to existing SONAR test agent dimension — no addition needed. Plan + spec wording adjusted to clarify "spec-adherence checked via test agent's AC↔test mapping" rather than as separate dimension.

- ✅ **[NCL-7: Spec 011 PARTIAL ACs scope] RESOLVED via read of `core/specs/011-phase5-codex-claude-install/spec.md`**
  5 PARTIAL ACs enumerated:
  - **AC-13 (BF-06 abort)** — already bundled in v2.2 Layer 6 ✅
  - **AC-14 (conflict error msg post-BF-06)** — **ADDED to v2.2 Layer 6 bundle** (paired with BF-06, ~10 LOC msg formatting; closes UX gap)
  - AC-03 (BF-01+BF-02 Claude position+section wrapper) — DEFER v2.3 (não afeta install command core path; v2.1.4 ships with this partial)
  - AC-05 (BF-04+BF-05 manifest schema rich + dedup) — DEFER v2.3 (snapshot ergonomics, não bloqueia install)
  - AC-21 (Article IV evidence post_write_sha256 logging) — DEFER v2.3 (test logging, não runtime behavior)

  Layer 6 scope expanded to include AC-14 alongside AC-13. New AC added below: **AC-19** — see Acceptance Criteria.

- ✅ **[NCL-8: v2.1.5 timing] RESOLVED via Felipe — v2.2 first, urgência high**
  Felipe: "2.2 é mil vezes mais urgente porque tá me impedindo de avançar a trazer a qualidade do soma nos meus outros projetos." v2.2 ships ASAP. v2.1.5 (Bucket A source manifest re-baseline) deferred — not parallel, not folded. v2.1.5 ressuscita post-v2.2 ship as separate Bucket A work. Layer 0 confirmed v2.1.5 NOT blocking v2.2 — clean to defer.

---

## Completeness Checklist

<!-- guidance: All boxes must be checked (or replaced with [NEEDS CLARIFICATION]) before Gate 1. -->

- [x] Every AC is testable (Given/When/Then, observable, not implementation) — 19 ACs all grep/sha/exit-code based
- [x] No implementation details leaked into AC (no HOW, only WHAT) — argv parsing details, child_process specifics deferred to plan-sdd contracts/
- [x] **Zero `[NEEDS CLARIFICATION]` markers remaining** — all 8 RESOLVED 2026-05-09 (5 via Felipe + 3 via self-resolved reads)
- [x] NFR section has at least: performance SLO (< 5s), security constraints (no sudo, no secret logging), test style (integration, no mocks), host prereq (Node v22+), concurrency (lockfile)
- [x] Out of Scope section has 11 explicit entries
- [x] Feature ID + Branch filled in — 015-soma-install / feature/015-soma-install
- [x] Layer 0 discovery artifact referenced — `core/specs/015-soma-install/discovery.json`
- [x] Plan reference linked — `~/.claude/plans/o-que-acontece-eu-precious-tulip.md`
- [x] BF-06 bundled scope explicit — AC-14 + AC-19 (paired post-resolution)
- [x] Cross-harness contract ACs present — AC-10/AC-11/AC-15
- [x] Idempotence 4-cenário coverage — AC-01 (greenfield) + AC-02 (re-run clean) + AC-03 (drift) + AC-04 (partial) + AC-05 (mid-failure)
- [x] **Spec ready for Gate #1 APPROVED** — Felipe explicit approval signals transition AWAITING_APPROVAL → APPROVED → `/plan-sdd` triggers Step 2

---

## Spec → Test Traceability (preview, full mapping em plan-sdd tasks.md)

| AC | Test target file | Test type |
|---|---|---|
| AC-01 | `core/scripts/__tests__/install.test.js` | integration (greenfield) |
| AC-01b | `core/scripts/__tests__/install.test.cjs` (T-08bis-S1) | integration (bootloader content) |
| AC-02 | `core/scripts/__tests__/install.test.cjs` (T-10-S1) | integration (re-run) |
| AC-03 | `core/scripts/__tests__/install.test.cjs` (T-11-S1) + `core/scripts/__tests__/sync-bf06-abort.test.cjs` | integration (drift) + contract (sync abort) |
| AC-04 | `core/scripts/__tests__/install.test.cjs` (T-12-S1) | integration (partial) |
| AC-05 | `core/scripts/__tests__/install.test.cjs` (T-13-S1) | integration (mid-failure) |
| AC-06 | `core/scripts/__tests__/install.test.js` | integration (path edge) |
| AC-07 | `core/scripts/__tests__/install.test.cjs` (T-14-S1) | integration (--merge-claude-md) |
| AC-08 | `core/scripts/__tests__/install.test.cjs` (T-15-S1) | integration (--replace-claude-md) |
| AC-09 | `core/scripts/__tests__/install.test.cjs` (T-16-S1) | integration (abort default) |
| AC-10 | `core/adapters/claude/commands/soma-install.md` (T-27) + smoke transcript inspection | manual + future hook test |
| AC-11 | `core/adapters/codex/AGENTS.md` block `id=block.codex.AGENTS.soma-install` (T-28) | manual + parse anchored block |
| AC-12 | `core/scripts/__tests__/slash-prereq-guard.test.cjs` (T-26) + 3 slash command sources + 2 bootloaders (T-21..T-25) | integration + manual review |
| AC-13 | `core/scripts/__tests__/no-execute-deletion.test.cjs` (T-30) | unit (deletion + grep) |
| AC-14 | `core/scripts/__tests__/sync-bf06-abort.test.cjs` (T-17 closes) | contract (BF-06 abort) |
| AC-15 | `core/scripts/__tests__/cross-harness-parity.test.cjs` (T-29 closes — T-05 GREEN) | contract (parity) |
| AC-16 | `core/scripts/__tests__/install.test.js` | integration (state file) |
| AC-17 | `core/scripts/__tests__/frozen-libs-invariant-014.test.cjs` (T-31) | invariant (SHA baselines) |
| AC-18 | `core/scripts/__tests__/plan-cites-discovery.test.cjs` (T-32) | static (plan traceability) |
| AC-19 | `core/scripts/__tests__/sync-bf06-abort.test.cjs` (T-17 closes — 5-element msg) | contract (BF-06 msg) |
| AC-13 sub-effect | `README.md` + `core/README.md` (T-18 docs cleanup) | manual review |
| OOS cross-link | `core/docs/onboarding.md` + `core/INSTALL.md` (T-19, T-20) | manual review (SONAR Step 8) |

---

**Next step**: Felipe reviews + resolves 8 NEEDS_CLARIFICATION markers → spec status DRAFT → AWAITING_APPROVAL → APPROVED → `/plan-sdd` derives technical plan + contracts + tasks + quickstart.
