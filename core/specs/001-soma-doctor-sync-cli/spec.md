# Spec: SOMA v2.1 Phase 2 — Doctor and Sync Dry-Run CLI

<!-- guidance: Fill every {PLACEHOLDER}. Mark every ambiguity; resolve before APPROVED. -->

**Feature ID:** 001-soma-doctor-sync-cli
**Branch:** `feature/001-soma-doctor-sync-cli`
**Created:** 2026-05-01
**Status:** APPROVED

---

## Context

Phase 0+1 do SOMA v2.1 entregou o lab `~/.soma-v2/` (44 files, 14 manifest entries, 3 anchored blocks com IDs em version `2.1.0-draft`). Phase 2 implementa o CLI read-only que torna drift mensurável e reparável **sem aplicar mudanças**: `soma doctor` (status report) e `soma sync --dry-run` (preview edits). Sources canônicos em `~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `~/.claude/CLAUDE.md` permanecem **intocados** durante toda Phase 2.

Frozen conventions herdadas (não reabrir):
- SOMA_HOME = `~/.soma-v2/`
- Anchor format: `<!-- soma-v2:start id={id} version={ver} sha256={hex64} -->` ... `<!-- soma-v2:end id={id} -->`
- Anchor ID naming: `block.{tool}.{file}.{section}` | `core.{section}` | `adapter.{tool}.{kind}`
- Manifest schema v1 com fields `sourceSha256` + `sourceMtime` pra staleness detection

---

## User Stories

<!-- guidance: Minimum 1. Format: "Como <user>, quero <action>, pra <outcome>" -->

- Como agente operador SOMA (orchestrator Opus ou subagente Sonnet/Haiku despachado), quero rodar `soma doctor` antes de tarefas que dependam de anchored blocks atualizados, pra detectar drift entre o lab e os files canônicos sem aplicar mudança e decidir se preciso de `sync` prévio.
- Como o usuário (manutenção do framework), quero `soma sync --dry-run` reportando exatamente quais edits seriam aplicados por anchored block (ação: `insert` | `replace` | `skip` | `drift`) sem mutate, pra revisar e aprovar antes do write-mode futuro (Phase 3+).
- Como auditor de Phase 2 (futuro `soma test` ou Phase 6 Benchmark v2), quero output machine-readable (`--json` flag) com lista estruturada de findings, pra integrar com SONAR ou pipelines automáticos.

---

## Acceptance Criteria

<!-- guidance: Every AC must be testable: "Given X, when Y, then Z". No implementation details. No HOW — only WHAT and WHY. -->

- **AC-01:** Given lab `~/.soma-v2/manifest.json` válido + sources untouched (verified via `shasum -a 256` em estado conhecido), when `soma doctor` é invocado em real `~/`, then output reports exatamente os 3 drifts conhecidos catalogados em `~/.claude/plans/soma-v2.1-inventory.md` (D1: `~/AGENTS.md` missing block `block.codex.AGENTS.soma-stsd`; D2: `~/AGENTS.md` missing block `block.codex.AGENTS.codebase-memory-mcp`; D3: anchored blocks em `~/.codex/AGENTS.md` sem atributos `id=`/`version=`/`sha256=`) e zero false positive em files actually em sync.

- **AC-02:** Given doctor é read-only por contrato, when `soma doctor` roda em qualquer estado de `~/.soma-v2/` + canonical sources, then nenhum dos 4 sources canônicos (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`, `~/.claude/CLAUDE.md`) nem qualquer file em `~/.soma-v2/` é modificado (verificado via `shasum -a 256 -c` pre/post run; todas linhas `OK`).

- **AC-03:** Given `~/.soma-v2/adapters/{codex,claude}/install-targets.json` declaram entries com `target_path` + `target_anchor_id` + `source_doc`, when `soma sync --dry-run` é invocado, then output reports per-entry exatamente um de quatro actions (`insert` quando target sem anchor; `replace` quando anchor existe mas sha256 difere do expected; `skip` quando anchor existe e sha256 bate; `drift` quando anchor existe + sha256 attribute bate mas conteúdo extraído tem sha real diferente — manual edit) e cada finding inclui `target_path`, `target_anchor_id`, `expected_sha256`, `actual_sha256` (quando aplicável), `source_doc`.

- **AC-04:** Given sync é dry-run-only por design em Phase 2, when `soma sync --dry-run` roda em qualquer estado, then nenhum source canônico nem qualquer file em `~/.soma-v2/` é modificado (verificado via `shasum -a 256 -c` pre/post run; todas linhas `OK`).

- **AC-05:** Given hooks runtime estão registered em `~/.claude/settings.json`, when doctor ou sync rodam em qualquer ordem, then `node --test ~/.claude/hooks/*.test.cjs ~/.claude/hooks/lib/__tests__/*.test.cjs` continua passando 38/38 (regression).

- **AC-06:** Given output deve ser auditável programaticamente, when doctor ou sync rodam com flag `--json`, then stdout é JSON parseable (`jq empty` retorna exit 0) com schema documentado em contract: `{tool: "doctor"|"sync", mode: "check"|"dry-run", findings: [{kind, severity, target, expected_sha256?, actual_sha256?, source_doc?, message}]}`.

- **AC-07:** Given exit code semântico é necessário pra CI/scripts, when doctor encontra ≥1 drift, then exit code = 1; when doctor encontra zero drifts, exit code = 0; when sync --dry-run reporta ≥1 ação `insert`/`replace`/`drift` (algo a fazer), exit code = 1; quando todas ações são `skip` (everything in sync), exit code = 0.

---

## Non-Functional Requirements

<!-- guidance: List explicitly. At minimum: performance SLO, security constraints, test style (integration/unit/contract), monitoring expectations. -->

- **Performance:** doctor + sync each complete em < 5s em real `~/` (~14 manifest entries + 5 install-targets entries). Não há SLA crítico — esses são tools de manutenção, não hot path.
- **Security:** zero shell-out pra valores user-controlled (no command injection). Path validation via `path.resolve` + check que paths permanecem dentro de `$HOME`. Fail-safe: erro não-fatal silencioso pra files faltando (com warning), fatal pra manifest inválido.
- **Test style:** integration tests usam `/tmp/soma-v2-test-{uuid}/` fixtures replicando estrutura do lab + sources canônicos copy. Sem mocks de fs/path/crypto — tests batem em real fs, real shasum (Article III Integration-First). Unit tests OK pra parsing helpers puros (parser de anchored block markers).
- **Dependencies:** zero `npm install` em Phase 2 — runtime usa apenas Node stdlib (`fs`, `path`, `crypto`, `os`). Stack lockada em `.cjs` vanilla CommonJS Node (per D1 decision).
- **Portability:** macOS (primary platform). Linux/WSL2 best-effort (no Windows-specific syscalls). Path separators via `path.join` only.
- **Output format:** default = human-readable summary com colored severity (`OK`/`WARN`/`DRIFT`/`MISSING`); `--json` flag retorna stable JSON schema (per AC-06).
- **Logging:** zero stdout output em modo `--quiet`; stderr reservado pra warnings/errors. Default mode: stdout = summary, stderr = vazio em sucesso.
- **Idempotence:** doctor/sync invocados N vezes em mesmo estado retornam outputs e exit codes idênticos.

---

## Out of Scope

<!-- guidance: Explicit "will not" list prevents scope creep. Write at least one entry. -->

- **Write-mode sync** — `soma sync` (sem `--dry-run` flag) que efetivamente aplica edits — defer pra Phase 3+ com user approval explícito por anchored block.
- **Repair/fix command** — `soma fix` ou auto-remediation — Phase 3+.
- **Hook migration** — `soma sync --target=claude-hooks` — Phase 4+.
- **Real `~/.codex/AGENTS.md` anchor attribute add** — adding `id=`/`version=`/`sha256=` attrs em ~/.codex/AGENTS.md source — defer pra Phase 3+ write-mode (não em Phase 2 mesmo se sync --dry-run reporta a ação).
- **Sample project init** — `soma init` + `.soma/project.md` template population — Phase 3.
- **Multi-project sync** — sync em múltiplos projetos via single command — Phase 5+.
- **Secret scanner** — checagem de credentials em managed blocks — out of MVP per PLAN §11.
- **`installed-state.json`** — ledger de what was installed em targets — Phase 3+ (sync write-mode).
- **TypeScript build pipeline** (tsc compile step com `dist/`) — fora de scope mesmo se TS for escolhido em D1, preferindo runtime sources only.
- **CI integration** — GitHub Actions workflow rodando doctor — fora de Phase 2.

---

## Resolved Decisions

<!-- guidance: D1-D6 resolvidos em 2026-05-01 pela equipe (caminho rápido — todos defaults). Mantidos em-spec pra audit trail. -->

- **D1 — CLI stack:** `.cjs` vanilla CommonJS Node. Matches `~/.claude/hooks/` ecosystem 100%, zero deps, reuse direto de `ck-paths.cjs`/`ck-config-utils.cjs` via `require()`. Sem build step, sem flags experimentais, sem npm install.

- **D2 — install-targets schema pra cobrir drifts D1+D2 (`~/AGENTS.md`):** Duplicar 2 entries (CBM + soma-stsd) em `~/.soma-v2/adapters/codex/install-targets.json` com `target_path: "~/AGENTS.md"`, total 5 entries. Schema v1 preserved. Phase 2 implementação edita esse JSON antes de implementar doctor (Sonnet task explicit).

- **D3 — CLI location:** `~/.soma-v2/scripts/` (per plan rev 3). Sentinel `.phase-1-empty` lá hoje vira removed quando primeiro file é criado. Tests em `~/.soma-v2/scripts/__tests__/`.

- **D4 — manifest.json evolution:** Frozen — manifest fica snapshot Phase 1; CLI scripts vivem fora dele (são runtime, não lab data). PLAN §6.2 `installed-state.json` cobre runtime state em Phase 3+. Manifest **não é tocado** durante Phase 2 (exception: regression check via shasum confirms imutabilidade).

- **D5 — sync --dry-run finding granularity:** Emitir uma finding por entry em todos os install-targets (independente da ação) pra full audit trail. Default human output suprime `skip` findings; `--verbose` flag mostra todos. JSON output (`--json`) sempre emite todos.

- **D6 — doctor scope:** Ambos perspectives (full coverage). Findings categorizados por `kind`: `target_drift` (install-targets vs canonical, e.g., D1/D2/D3), `source_staleness` (manifest.sourceSha256 vs current source sha256), `lab_corruption` (manifest.sha256 vs lab file actual sha256). Per-finding fields incluem `kind` pra filtering.

---

## Completeness Checklist

<!-- guidance: All boxes must be checked before Gate 1. -->

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT — 6 D-decisions resolvidas em Resolved Decisions)
- [x] Zero open clarification markers (D1-D6 resolved 2026-05-01)
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry (10 entries)
- [x] Feature ID + Branch filled in
