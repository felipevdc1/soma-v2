# Spec: Soma Sync Apply Write-Mode

**Feature ID:** 004-soma-sync-apply
**Branch:** `feature/004-soma-sync-apply`
**Created:** 2026-05-02
**Status:** SHIPPED (2026-05-02 — 12/12 ACs validated + 5/5 D resolutions + stdout-flush regression fix `4311eef`)

---

## User Stories

- Como dev usando SOMA num projeto multi-adapter (Codex + Claude), quero rodar `soma sync --apply` com confiança, pra atualizar `~/.codex/AGENTS.md` e `~/AGENTS.md` sem risco de perder estado pré-existente.
- Como dev que cometeu `--apply` errado (anchor parse error, stale source, sync no momento errado), quero recuperar do snapshot mais recente em `~/.soma-v2/.snapshots/{ISO}/`, pra reverter mudanças sem perda de trabalho local pré-existente.
- Como agent SOMA executando dentro de `/soma-run` Step 5 VALIDATE, quero que `sync --apply` falhe HARD em qualquer trap (missing snapshot dir, stale source, parse error), pra que source files canônicos NUNCA sejam corrompidos por sync mal-formed.

---

## Acceptance Criteria

- **AC-01:** Given `sync` invocado sem `--apply`, when comando completa, then comportamento idêntico ao Phase 2 dry-run (zero writes em source files, zero snapshot dir criado, exit code 0 ou 1 conforme drift detectado).
- **AC-02:** Given `sync --apply` em estado com drift detectado, when comando começa write phase, then snapshot completo de cada arquivo destino é escrito em `~/.soma-v2/.snapshots/{ISO-timestamp}/{adapter}/{file-relative-path}` ANTES de qualquer modificação no source.
- **AC-03:** Given snapshot escrito (per AC-02), when comando completa, then `~/.soma-v2/.snapshots/{ISO-timestamp}/manifest.json` existe com schema `{ schema: "soma-snapshot/v1", timestamp: ISO8601, files: [{adapter, path, sha256}], total_bytes }`, ordenado alfabeticamente por `{adapter}/{path}`.
- **AC-04:** Given `sync --apply` em estado com drift detectado, when comando inicia, then summary preview impresso no stdout ANTES de qualquer write, em formato `## Sync preview\n- {adapter}/{path}: {action}\n...` listando todos os files que serão tocados (action ∈ {insert, replace, skip-unchanged}).
- **AC-05:** Given `sync --apply` em estado already synced (zero drift detectado), when comando completa, then comportamento é noop: zero writes em source, zero snapshot dir criado, stdout imprime "already in sync", exit 0.
- **AC-06:** Given `sync --apply` quando o snapshot dir não pode ser criado (permission denied, disk full, etc.), when erro detectado, then comando aborta ANTES de qualquer write em source, exit 1 com `error_code: "SNAPSHOT_CREATE_FAILED"`, source files untouched (verificável via shasum pre/post).
- **AC-07:** Given `sync --apply` quando source mudou desde dry-run anterior (sha256 do source muda entre preview computation e write start), when stale source detectado, then comando aborta com `error_code: "SOURCE_STALE"`, snapshot NÃO escrito, source untouched. User instruído a re-rodar.
- **AC-08:** Given `sync --apply` quando anchored block parse error em qualquer file alvo, when erro detectado, then comando aborta com `error_code: "ANCHOR_PARSE_ERROR"`, snapshot NÃO escrito (todos os snapshots all-or-nothing por run), source untouched.
- **AC-09:** Given snapshot manifest escrito (per AC-03), when manifest re-derivado de mesma input, then `manifest.json` é byte-stable (mesma sequência de keys + sha256 hex64 lowercase em ordem alfabética por `{adapter}/{path}` composite key).
- **AC-10:** Given `sync --apply` execution, when comando completa exit 0 (success path), then existing `sync --dry-run` behavior preserved: re-run de `sync` (sem `--apply`) imediatamente após retorna `findings_count: 0` (idempotência confirmed).
- **AC-11:** Given trap scenarios em ambiente synthetic `/tmp/soma-sync-trap-{slug}/`, when cada trap testado isoladamente (accidental --apply with no targets, missing snapshot dir, stale source, parse error em fake AGENTS.md), then todos exit 1 sem corruption do fake source file. Validation MUST run em /tmp ANTES de qualquer execution real contra `~/.codex/AGENTS.md` ou `~/AGENTS.md`.
- **AC-12:** Given conflito entre flags `--apply` e `--dry-run` no mesmo invoke, when comando inicia, then exit 2 `INVALID_ARGS` com mensagem clara ("--apply and --dry-run are mutually exclusive"), zero side effects.

---

## Non-Functional Requirements

- **Performance:** write + snapshot completes em <500ms para typical install-targets list (≤10 files). Snapshot full-copy (não diff/patch — D2 de implementation simplicity).
- **Security:** snapshot dir criado com permissions 0700 (user-only read/write). Manifest paths NÃO escapam de SOMA_HOME (`..` em path = INVALID_TARGET error). Sync NÃO segue symlinks fora de SOMA_HOME.
- **Test style:** integration tests via tmp dir + `child_process.spawnSync` (sem DB mocks — 100% file-system real). Contract test em `contracts/sync-apply.md` com schema completo + error codes. TDD HARD per Article II + C-2 enforcement: `SOMA_RED_PHASE_STRICT=1` env durante test runs.
- **Monitoring:** stdout summary preview default; flag `--json` substitui human-readable preview por JSON estruturado pra agent consumption.
- **Backward compat:** existing 315/315 SOMA-v2.1 tests preserved; 48/48 hooks regression preserved; 6 canonical+lib shasums match baseline (`/tmp/phase4bc-shasum-before.txt`).
- **Idempotência:** re-run `sync --apply` em estado synced = noop (AC-05 + AC-10). Não exigir flag adicional pra detectar.

---

## Out of Scope

- Multi-adapter parallel writes (sequential only — simpler reasoning + D-C13 latency bracket)
- `soma rollback {ISO-timestamp}` CLI command pra restaurar de snapshot (Phase 5+, separate spec)
- Differential snapshot (Δ patch only) — Phase 4b ships full-file copy snapshot por simplicidade
- Snapshot prune/retention auto-management (Phase 5+ via `doctor` warning + `soma snapshots prune` command)
- Network-mounted SOMA_HOME (assume local filesystem only — Phase 6+ se demand surface)
- `sync --apply` em adapters não declarados em install-targets v1 schema (Phase 5+ adapter rollout)

---

## Resolved Decisions (2026-05-02 — user ratified)

- **D1 (was 004-NC1) — Snapshot retention**: keep all snapshots + manual prune via `soma snapshots prune` (Phase 5+ CLI). Doctor surface warning quando snapshot count > 50 OR total size > 50MB. **Why**: snapshots são safety net designed exatamente pra raros eventos de regressão imprevista; auto-prune silencioso apaga JUSTO quando você não esperava precisar. Disk growth trivial (~30-50KB por sync × 3 adapters); 1000 syncs ≈ 30MB. Bruno P6 explicit cleanup principle + D-C14 manual consolidate pattern.
- **D2 (was 004-NC2) — Mid-run failure**: all-or-nothing transactional. Validate ALL files (anchor parse + source shasum + snapshot dir creation) PRE-WRITE; if any fails, abort entire run with zero source modification. AC-08 + AC-06 + AC-07 cobrem casos individuais. **Why**: write phase é o ponto crítico onde corruption pode acontecer; commit-or-abort é o único pattern safe.
- **D3 (was 004-NC3) — Snapshot timestamp**: ISO 8601 UTC with seconds resolution (`2026-05-02T14:30:45Z`). Em rapid collision (<1s gap), append `-{N}` suffix (`2026-05-02T14:30:45Z-2`). **Why**: seconds é human-readable; `-{N}` suffix evita rare collision sem precisar nanoseconds.
- **D4 (was 004-NC4) — Local edits handling**: sync writes anyway + snapshot escrito (preserves full pre-state) + WARN loud no stdout + exit code 0 on success. Recovery via copy from snapshot. **Why**: snapshot mechanism já existe e é exactly the safety net pra esse caso. Smooth UX pra workflows frequentes (Phase 5+ adapter rollout). Granular anchor-aware diff (option c) adicionaria complexidade significativa pra benefit marginal; deferido pra Phase 5+ se demand surface.
- **D5 (was 004-NC5) — `--json` output schema**: same schema for success+error response paths. `error` field populated apenas em failure path; `null` em success. Schema documentado em `contracts/sync-apply.md`. **Why**: consumer-side parsing simplification; um único shape pra parse.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry
- [x] Feature ID + Branch filled in
