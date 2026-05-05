# Plan: Soma Init Existing — Module Inference From Existing Project

**Feature ID:** 003-soma-init-existing
**Spec:** `specs/003-soma-init-existing/spec.md`
**Created:** 2026-05-01
**Status:** APPROVED (auto-derived from APPROVED spec via `/plan-sdd` 2026-05-01)

---

## Technical Approach

Estende `~/.soma-v2/scripts/init.cjs` com branch `--existing` que detecta módulos automaticamente em projeto pré-existente (em vez do branch greenfield Phase 3 que cria `.soma/` from scratch). Branch `--existing` invoca novo módulo `lib/module-inference.cjs` que aplica duas heurísticas: H2 default (filesystem-only — `src/*` subdirs OR `package.json#workspaces` paths OR root framework dirs) e H1 condicional (`--deep` flag — rank H2 results por commit count em últimos 90 dias via `git log`, fallback automático pra H2 com warning quando `.git/` ausente). Para cada módulo detectado, gera `.soma/modules/{name}.md` instanciado de `templates/project/.soma/modules/module.md.tmpl` com `schema=soma-module/v1`, `status=hypothesis`, `source_confidence=low`. Reusa libs Phase 2/3 (`anchored-blocks.cjs`, `manifest.cjs`, `template-engine.cjs`) sem modificação. Boundary de integração principal: filesystem read-only + git read-only + writes confinados a `$path/.soma/`.

**Stack:**
- Runtime: Node v22+ (matching Phase 2/3 baseline)
- CLI: extends `~/.soma-v2/scripts/init.cjs` (existing file, `--existing` branch added)
- New module: `~/.soma-v2/scripts/lib/module-inference.cjs` (H1 + H2 heuristics + git history scanning)
- Test runner: `node:test` stdlib (no npm deps, matching Phase 2/3 D7 lock)
- Storage: filesystem only (no DB)

**Rationale:** stack `.cjs` vanilla zero-deps locked em D7 (Phase 3 spec 002). Reuse de libs Phase 2/3 honra Article VII (Simplicity Gate) ao não duplicar primitives. Zero npm deps preserva integridade do baseline shasum (regression-free per AC-08).

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| Reuse `init.cjs` (extend `--existing` branch) vs separate `init-existing.cjs` script | CLI surface coeso (`soma init` é um command com 2 modos: greenfield vs existing); evita duplicação de arg parsing + `--soma-home` resolution + JSON formatting | Separate script `init-existing.cjs` — duplicaria ~80 LOC de boilerplate; usuário teria 2 commands quando 1 com flag basta |
| `lib/module-inference.cjs` como novo módulo isolado | Encapsula H2 (filesystem) + H1 (git) heurísticas em funções testáveis em isolamento; reutilizável por future Phase 4c cookbook commands `soma module add` | Inline em `init.cjs` — bloat (~250 LOC heuristic logic), dificulta unit test das heuristics separadamente, trava reuso em 4c |
| Hardcoded 90d window pra `--deep` (NC-2 RESOLVED) | Reduz superfície de configuração no MVP; 90d cobre ~quarter de atividade típica em projetos ativos; parametrização premature sem demanda real | Configurable `--deep-window=N` flag — adiciona arg sem caso de uso justificado; complica spec sem ganhar capability |
| src/-first quando `src/` existe (NC-1 RESOLVED) | Modern Next.js/Remix/Vite default; evita duplicação `app/`+`components/` em projects que usam src/ layout | Detect both src/-subdirs AND root framework dirs — duplica module list, viola "single source per module" expectativa, quebra AC-09 ground-truth tests |
| Module status default = `hypothesis` per D-C9 lock | Forces human review antes de promote → `active`; previne false-positive auto-active em modules detectados por heurística (não verificados por humano) | Auto-active modules — viola D-C9, agentes downstream confiariam em module docs gerados sem review |
| Fixture-based AC-09 ground truth (3 synthetic projects + manual list) | Objective pass/fail (hit rate ≥60%); reproducible; survives team turnover | Human qualitative review — non-binding, drift over time, requires user time per validation |
| Pre/post shasum check pra Phase 2/3 libs (AC-08) | Verifiable via `shasum` em test setup+teardown; binary pass/fail | Code review — non-empirical, depends on reviewer attention |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 1 novo módulo (`lib/module-inference.cjs`) + extension de `init.cjs` (existing) + tests fixtures (test infra, não componente normativo). Total ≤3 new components. (Article VII)
- [x] **Anti-Abstraction Gate** — heurísticas H1+H2 implementadas como funções diretas em `module-inference.cjs`, sem factory/strategy/visitor wrappers. CLI args parsed via stdlib `process.argv` (matching init.cjs Phase 3 pattern), zero arg-parser library. (Article VII)
- [x] **Integration-First Gate** — tests usam fixture filesystem real (criados via `fs.mkdirSync` em `os.tmpdir()`) + `git init` real (via `child_process.execSync('git init')`) quando `--deep` é exercitado. Zero mocks de fs ou git per AC-09 NFR. (Article III)

---

## Complexity Tracking

(Vazio — todos os 3 gates PASS.)

---

## Dependencies

- `node:fs/promises` — stdlib (filesystem ops, async)
- `node:fs` — stdlib (sync ops em casos críticos como pre/post shasum)
- `node:child_process` — stdlib (git invocation pra `--deep` mode via `execSync`)
- `node:path` — stdlib (path resolution + escape detection)
- `node:crypto` — stdlib (sha256 pra manifest entries + module file integrity)
- **Reuse internal:**
  - `~/.soma-v2/scripts/lib/anchored-blocks.cjs` (Phase 2 — leitura/escrita de blocks anchored em AGENTS.md; usado se future flag opt-in pra inject `--existing` mode em AGENTS.md alheio, mas DESABILITADO em Phase 4 per spec Out-of-Scope)
  - `~/.soma-v2/scripts/lib/manifest.cjs` (Phase 2 — soma-manifest/v1 schema operations)
  - `~/.soma-v2/scripts/lib/template-engine.cjs` (Phase 3 — placeholder substitution pra module.md.tmpl)
- **Zero npm deps** (matching D7 Phase 3 lock)

---

## References

- Contracts: `contracts/init-existing.md` (CONTRACT-INIT-EXISTING-01)
- Quickstart: `quickstart.md` (per-AC manual validation steps)
- Spec: `spec.md` (12 ACs, 7/7 NEEDS CLARIFICATION resolved 2026-05-01)
- Constitution: `~/.claude/constitution.md` Articles I (Spec as Source), III (Integration-First), IV (Proof Before Done), VII (Simplicity)
- Phase 3 reference contract: `~/.soma-v2/specs/002-soma-init/contracts/init.md` (sister CLI command, shape inheritance)
- D-C series locks: D-C9 (hypothesis→active human review), D-C10 (evidence dir granularity), D-C15 (backups location — não exercitado em Phase 4a)
- Bruno material integration: `memory/project_soma_executor.md` §"Bruno material integration" (C-1 cookbook + C-7 fundação criteria — NÃO exercitado em Phase 4a, capturado pra Bucket D)
