# Spec: Soma Bootstrap CLI + Onboarding Doc

**Feature ID:** 008-soma-bootstrap
**Branch:** `feature/008-soma-bootstrap`
**Created:** 2026-05-02
**Status:** APPROVED (2026-05-02 — 8/8 D resolutions locked)

---

## User Stories

- Como dev externo que clonou um repo SOMA-enabled fresh do GitHub, quero rodar `soma bootstrap` uma única vez no project root, pra ter o projeto pronto pra trabalhar em <5min sem editar files manualmente.
- Como dev SOMA num projeto compartilhado em time, quero rodar `soma bootstrap` ao trocar de branch/projeto, pra revalidar drift entre `.soma/` artifacts e meu SOMA_HOME local sem precisar memorizar comandos `doctor`/`sync`.
- Como agent orchestrator (Codex/Claude) integrando com SOMA-enabled project, quero parsear stdout JSON de `soma bootstrap` pra extrair modules detected + adapters available, pra rotear contexto auto-load corretamente.
- Como dev externo enfrentando erro durante bootstrap (ex: SOMA_HOME missing), quero ler `~/.soma-v2/docs/onboarding.md` step-by-step pra resolver o erro com instructions claras + ≥3 common error scenarios documentados.

---

## Acceptance Criteria

### Detection (Step 1)

- **AC-01:** Given um repo com `.soma/` no current working dir, when `soma bootstrap` é executado sem args, then comando avança pro Step 2 (validate SOMA_HOME) sem erro.
- **AC-02:** Given current working dir SEM `.soma/`, when `soma bootstrap` é executado, then comando aborta com exit 1 + `error_code: "NO_SOMA_PROJECT"` + suggestion field apontando pra `soma init` ou cd into existing SOMA project root.

### SOMA_HOME validation (Step 2)

- **AC-03:** Given `~/.soma-v2/` existe com `manifest.json` schema-valid (`soma-manifest/v1`), when bootstrap valida SOMA_HOME, then comando avança pro Step 3 (delegate to doctor) sem erro.
- **AC-04:** Given `~/.soma-v2/` missing OR `manifest.json` ausente/inválido, when bootstrap tenta validar SOMA_HOME, then comando aborta com exit 1 + `error_code: "INVALID_SOMA_HOME"` + suggestion field apontando pra onboarding doc + opção de override via `SOMA_HOME` env var.

### Doctor delegation (Step 3 + 4)

- **AC-05:** Given valid SOMA_HOME + valid `.soma/`, when bootstrap delegates pra `soma doctor --check-context-routing`, then doctor output (findings array) é capturado integralmente em memória sem escrita disco.
- **AC-06:** Given doctor reports zero findings, when bootstrap renders summary, then output inclui `findings: []` + `status: "ready"` + exit 0.
- **AC-07:** Given doctor reports apenas warnings (drift / stale-hypothesis / no critical), when bootstrap renders summary, then exit code é 0 + warnings array preserved no output + suggestion field apontando pra `soma sync --apply` se user wants to remediate drift.
- **AC-08:** Given doctor reports ≥1 critical findings (manifest corrupt, schema invalid, SOMA_HOME drift unrecoverable), when bootstrap renders, then exit code é 1 + critical findings clearly identified em separate critical[] array no output JSON.

### Project ready summary (Step 5)

- **AC-09:** Given bootstrap success path, when bootstrap completes, then output JSON inclui campos: `schema: "soma-bootstrap/v1"`, `status: "ready" | "drift" | "error"`, `modules: [{slug, status: "hypothesis" | "active" | "deprecated"}]` (lista módulos detectados em `.soma/modules/`), `adapters: [{tool, install_targets_count}]` (lista adapters em SOMA_HOME), `findings: []`, `duration_ms: <int>`.
- **AC-10:** Given bootstrap is invoked sem `--quiet` flag, when bootstrap renders, then stdout contém human-readable summary + JSON em final block (Phase 2/3/4 default convention per D1 lock).
- **AC-11:** Given bootstrap is invoked com `--quiet`, when bootstrap renders, then ONLY JSON é emitido em stdout (zero human-readable text), permitindo orchestrator parsing direto.

### Onboarding doc deliverable

- **AC-12:** Given `~/.soma-v2/docs/onboarding.md` existe (criado nesta spec), when external dev reads, then doc contém: (a) Prerequisites section (Node version mínimo + git + SOMA_HOME install link placeholder), (b) Quickstart section com clone→bootstrap→ready flow exemplificado com commands literais, (c) Troubleshooting section com ≥3 common errors documentados (SOMA_HOME missing, `.soma/` missing, drift findings) cada um com remediation steps clear.

### Performance + integrity

- **AC-13:** Given a well-formed project (~10 modules, valid SOMA_HOME, no extreme repo size), when `soma bootstrap` é invocado, then wallclock duration ≤5000ms medida em test environment (excluindo network).
- **AC-14:** Given bootstrap completes (success path OR failure path), when sha256 de cada arquivo em `~/.soma-v2/` é comparado pre/post bootstrap, then ZERO modifications detected (Adapter Contract Cláusula B read-only HARD enforcement).

---

## Non-Functional Requirements

- **Performance:** p95 ≤5s wallclock pra projeto well-formed (~10 modules). Tests usam fixture sintética com module count fixo. Larger repos out of scope pra v1 NFR.
- **Security:** No user data logged além de paths absolutos do project. No external network calls (zero version checks externos em v1). Read-only access HARD enforced em SOMA_HOME via shasum check em integration test (AC-14).
- **Test style:** Integration tests usam fixtures sintéticas em `/tmp/soma-bootstrap-fixture-{slug}/`. Smoke test E2E em real `/tmp/soma-sample-{slug}/` (init + bootstrap chain). Reuse Phase 2/3/4 libs (`anchored-blocks.cjs`, `manifest.cjs`, `module-inference.cjs`, `doctor.cjs` API surface) — zero duplicação. Node v22 recursive `node:test` workaround via bridge wrapper (Phase 2/3/4 precedent).
- **Test count target:** ≥40 tests cobrindo 14 ACs (média ~3 tests/AC).
- **Output convention:** stderr pra logs estruturados, stdout pra payload JSON. Exit codes: 0 success/warnings, 1 error, 2 invalid args (consistent with Phase 2/3/4).
- **TDD discipline:** RED commits separados de GREEN commits via SOMA_RED_PHASE_STRICT=1 enforcement (C-2 hook ativo).
- **Monitoring:** N/A (CLI tool, não service). Log structured pra stderr.

---

## Out of Scope

- Instalar SOMA framework (`~/.soma-v2/`) — bootstrap PRESSUPÕE SOMA_HOME existe e erros out claramente se missing. Install flow é Phase 5+ separate spec/feature.
- Modificar `~/.codex/AGENTS.md` ou `~/.claude/CLAUDE.md` — adapter rollout em hosts é Phase 5+ via `soma sync --apply --tool=...`. Bootstrap NÃO chama sync write-mode.
- Auto-fix drift findings — bootstrap apenas REPORTS findings; user decide se roda `soma sync --apply` separately. Bootstrap não invoca sync internally.
- GitHub repo template / scaffolding / scaffolding generators — bootstrap opera num repo já clonado, não cria repo.
- Distribution mechanism — publish/SDK pra distribuir SOMA framework é fora desta spec.
- Module re-inference — bootstrap não re-roda H1+H2 heuristics se `.soma/modules/` já populated. Re-inference fica reservado pra `soma init --existing` (Spec 003).

---

## Resolved Decisions

8/8 NCs sentenced 2026-05-02 by the user ("defaults all + Tier 1 recommendations accepted"):

- **D1 — Output mode default**: human-readable summary + JSON em final block (Phase 2/3/4 convention). `--quiet` flag emite ONLY JSON pra orchestrator parsing direto. Default consistency com doctor/sync/init.
- **D2 — SOMA_HOME env var**: bootstrap respeita `SOMA_HOME` env var override igual outros commands. Default fallback `~/.soma-v2/`. Behavior consistent with Phase 2/3/4 commands.
- **D3 — Interactive prompt**: NO interactive prompt em drift detection. Bootstrap apenas reporta drift findings + populates `suggestion` field apontando pra `soma sync --apply`. User decide manualmente quando rodar sync. Mantém scope clean + scriptability.
- **D4 — init overlap**: (b) clean separation. Se `.soma/` existe mas `.soma/modules/` está vazio, bootstrap aborta com `error_code: "MODULES_MISSING"` + suggestion pra rodar `soma init --existing` primeiro. Bootstrap NUNCA re-roda inference (1 comando = 1 responsabilidade).
- **D5 — Onboarding audience**: power user terse. `~/.soma-v2/docs/onboarding.md` text-only, sem screenshots. Future audience expansion (zero-CLI, verbose+screenshots) deferred a future spec se external user demand surfaces.
- **D6 — Bootstrap vs doctor boundary**: bootstrap é fast-path "is this project usable right now?". Bootstrap NÃO duplica doctor's full inspection (`--check-context-routing` / `--foundation-check` / `--gate` flags ficam doctor-only). Bootstrap output = fast subset (status + modules + adapters + critical findings). Doctor permanece source of truth pra full project health.
- **D7 — Performance budget escopo**: 5s wallclock cobre apenas SOMA_HOME validation + doctor delegation + summary rendering. Module inference EXCLUÍDA do budget (per D4, bootstrap não re-roda inference). Fixed cap independente de repo size pra fast-path UX.
- **D8 — Schema version handling**: strict match em v1. Bootstrap lê `manifest.json` → checa `schema: "soma-manifest/v1"` exact string match. Mismatch (incluindo future v2) → exit 1 + `error_code: "SCHEMA_VERSION_UNSUPPORTED"`. Compatibility window decision deferred até v2 schema actually emerge.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining (8/8 D1-D8 resolved 2026-05-02)
- [x] NFR section has performance SLO + security constraints + test style + monitoring
- [x] Out of Scope section has 6 entries
- [x] Feature ID + Branch filled in
