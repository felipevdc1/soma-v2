# Plan: SOMA v2.1 Phase 2 — Doctor and Sync Dry-Run CLI

**Feature ID:** 001-soma-doctor-sync-cli
**Spec:** `specs/001-soma-doctor-sync-cli/spec.md`
**Created:** 2026-05-01
**Status:** APPROVED

---

## Technical Approach

Two CLI commands (`doctor`, `sync --dry-run`) implemented as standalone Node `.cjs` scripts em `~/.soma-v2/scripts/`, sharing parsing logic via `~/.soma-v2/scripts/lib/anchored-blocks.cjs` (sed-style marker extraction + sha256 computation) and `~/.soma-v2/scripts/lib/manifest.cjs` (schema v1 loader/validator). Doctor reads `manifest.json` + `adapters/*/install-targets.json` + canonical sources (`~/.codex/AGENTS.md`, `~/AGENTS.md`, `~/.claude/constitution.md`) and emits findings categorized by `kind` (`target_drift`, `source_staleness`, `lab_corruption`). Sync `--dry-run` reads same inputs and emits per-entry actions (`insert`/`replace`/`skip`/`drift`) without applying. Both tools are strictly read-only (verified by shasum pre/post run).

The lab `~/.soma-v2/` is the SOMA_HOME root resolved via env `$SOMA_HOME` or `--soma-home` flag (default `$HOME/.soma-v2`). Tests use `/tmp/soma-test-{uuid}/` fixtures replicating manifest + sources structure to avoid touching real state. Fixtures bootstrap from real `~/.soma-v2/` via `cp -R` then mutate copies.

**Stack:**
- Runtime: Node ≥18 (stdlib only — `node:fs`, `node:path`, `node:crypto`, `node:os`, `node:child_process` for tests)
- Framework: none (vanilla CommonJS); reuse `~/.claude/hooks/lib/ck-paths.cjs` + `ck-config-utils.cjs` via `require('../../../.claude/hooks/lib/ck-paths.cjs')` (relative path, lab-extension pattern)
- Storage: filesystem only (manifest.json, install-targets.json, anchored markdown)
- Test runner: `node --test` (built-in, matches `~/.claude/hooks/*.test.cjs` ecosystem)

**Rationale:** Stack lockada via spec D1 decision (`.cjs` vanilla). 100% consistency com hooks ecosystem (38 testes em `.cjs` + zero deps), zero `npm install` friction, `require()` direto de `ck-paths`/`ck-config-utils`. TS opcional via Node 22 strip-types ou tsx foi rejeitado por adicionar deps OU divergir do ecosystem dominante.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** CLI stack `.cjs` vanilla CommonJS Node | Matches hooks ecosystem 100%, zero deps, reuse direto via `require()`. Spec D1. | TS via Node 22 `--experimental-strip-types` (flag experimental); TS via tsx (`npm install` overhead, ecosystem divergence) |
| **AD-02:** install-targets schema v1 preserved + 2 entries duplicadas pra `~/AGENTS.md` | Spec D2. Mínima mudança (schema v1), 5 total entries, doctor pode reportar D1+D2+D3 corretamente. | Schema bump v2 (`target_paths: [...]` array — invalida entries existentes); separate `_global/install-targets.json` (split source-of-truth) |
| **AD-03:** CLI files em `~/.soma-v2/scripts/` (not `cli/`) | Spec D3. Plan rev 3 já reservou. Sentinel `.phase-1-empty` removido como parte de T-01 foundation. Tests em `scripts/__tests__/`. | `~/.soma-v2/cli/` (semantic mas inconsistente com plan) |
| **AD-04:** Manifest.json frozen durante Phase 2 | Spec D4. Manifest é "lab data inventory"; CLI scripts são runtime. Mantém Phase 1 snapshot intacto. PLAN §6.2 `installed-state.json` cobre runtime state em Phase 3+. | Add scripts entries to manifest (cresce + acopla data/runtime); separate `manifest-runtime.json` (split sources) |
| **AD-05:** Shared lib `scripts/lib/{anchored-blocks,manifest}.cjs` | Doctor + sync compartilham 100% da lógica de parsing de anchored blocks (regex marker extract + sha256 compute) e manifest loading. Lib evita duplicação. NÃO é wrapper especulativo — é factor-out de código que ambos consumem. | Inline duplicação em doctor.cjs + sync.cjs (drift hazard); generic helper class (over-abstraction) |
| **AD-06:** Tests em `/tmp/soma-test-{uuid}/` fixtures + `cp -R` from real `~/.soma-v2/` | Article III Integration-First — tests batem em real fs/crypto, sem mocks. Fixtures isolam mutations das tests do real state. | Mock fs + crypto (viola Article III, fragile); test em real `~/.soma-v2/` (mutates the user's lab) |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 2 entry points (doctor.cjs, sync.cjs) + 1 shared lib dir (lib/{anchored-blocks,manifest}.cjs). Total = 4 files runtime. Bem abaixo do limit ≤3 components (lib é 1 componente lógico shared). PASS.
- [x] **Anti-Abstraction Gate** — vanilla Node stdlib direto (`fs`, `crypto`, `path`). Zero wrapper layers. Lib é factor-out de código duplicado entre doctor+sync (justificativa em AD-05), não wrapper especulativo. PASS.
- [x] **Integration-First Gate** — todos integration tests usam real fs em `/tmp/` fixtures + real shasum + real source files copiados. Zero mocks de fs/crypto/path. Unit tests permitidos apenas pra parser de anchored block markers (puro string parsing, não requer fs). PASS.

---

## Complexity Tracking

<!-- Não aplicável — todos gates PASS sem violação. -->

| Gate violated | Reason (must ref AC-XX) | Revisit trigger |
|---|---|---|
| (none) | (none) | (none) |

---

## Dependencies

- **Node ≥18** — stable `node --test` runner, stable `node:fs/promises` (already required by hooks ecosystem)
- **Zero npm packages** — stdlib only per AD-01
- **`~/.claude/hooks/lib/ck-paths.cjs`** — reused via relative `require()` for path constants (CK_TMP_DIR namespace if any temp files needed for tests)
- **`~/.claude/hooks/lib/ck-config-utils.cjs`** — reused for shared utilities like `deepMerge`, `sanitizePath` if needed

**No new dependencies introduced.** All required Node stdlib is present in any Node ≥18 install.

---

## References

- Spec: `specs/001-soma-doctor-sync-cli/spec.md`
- Contracts: `contracts/check-doctor.md`, `contracts/sync-dry-run.md`
- Quickstart: `quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles I (spec source-of-truth), III (Integration-First), VII (Simplicity)
- Phase 1 plan: `~/.claude/plans/tem-mais-conte-do-aqui-iridescent-perlis.md` (frozen conventions)
- Phase 1 inventory: `~/.claude/plans/soma-v2.1-inventory.md` (D1/D2/D3 drifts catalogados)
- PLAN.md: `${HOME}/Documents/Codex/2026-04-24/soma v2/soma-v2-plan/PLAN.md` §6 schemas, §7 Phase 2, §10 risks
- Hook lib: `~/.claude/hooks/lib/{ck-paths,ck-config-utils}.cjs`
