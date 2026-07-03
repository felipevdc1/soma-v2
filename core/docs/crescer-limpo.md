# CRESCER LIMPO — Bruno P6 Canonical Reference

**Source**: Bruno Moreira (zbrunomoreira), shared with the user 2026-05-01.
**Adopted**: 2026-05-01 as SOMA v2.1 canonical reference for Phase ordering, agent dispatch patterns, and foundation/expansion zone discipline.
**Visual canon**: Imagem #5 (tree metaphor) — see Section "Visual Reference" below.

## Core philosophy

"CRESCER LIMPO ATÉ A BASE ESTAR FORTE" — grow clean until the foundation is strong. Once foundation is solid, expand safely with parallel agents.

## 3-layer ontology (tree metaphor)

| Layer | Tree part | What lives here | Rule |
|---|---|---|---|
| **RAÍZES (Roots)** | Below ground | Architecture base, infrastructure, core layer | Foundation — NO MESS allowed |
| **TRONCO (Trunk)** | Stem to first branches | Business rules, domain, abstractions | Foundation — NO MESS allowed |
| **GALHOS + FOLHAS (Branches + Leaves)** | Above first branches | Features, agents, worktrees | Expansion zone — safe parallel mess |

**Foundation zone** = roots + trunk (everything below the first branches).
**Expansion zone** = branches + leaves (everything above).

## 3 Regras de Ouro (Golden Rules)

1. **Na fundação NÃO PODE FAZER BAGUNÇA** — qualquer bagunça aqui custa caro depois.
2. **Até a base estar forte, CRESCEMOS LIMPO** — disciplina agora = velocidade depois.
3. **Galhos e folhas é onde podemos FAZER BAGUNÇA COM SEGURANÇA** — cada agente, sua worktree, seu pedaço.

## 6-step ladder

1. **DEFINIR BASE** — Missão clara, limites e princípios.
2. **CRESCER LIMPO** — Fundação sólida sem atalhos nem bagunça.
3. **VALIDAR TUDO CLEAN** — Testes, qualidade e arquitetura validados.
4. **EXPANDIR COM AGENTES** — Disparar agentes em worktrees (paralelismo).
5. **INTEGRAR SEM QUEBRAR** — Merge validado, sem bagunça na base.
6. **PRÓXIMA ETAPA** — Entregar valor e seguir crescendo.

## Agent-per-worktree pattern

`AGENTE 1..N → WORKTREE per agent → MERGE VALIDADO → IMPLEMENTA → TUDO VALIDADO CLEAN SEM ERROS → PRÓXIMA ETAPA`

Each parallel agent operates in isolated git worktree. Merge happens only after validation. No partial states reach base.

## Mapping to SOMA 10-step protocol

| Bruno step | SOMA step | Implementation |
|---|---|---|
| 1. DEFINIR BASE | Step 0 (SPECIFY) + /specify command | `/specify "feature description"` → spec.md with ACs |
| 2. CRESCER LIMPO | Step 4 (FOUNDATION) | First task implemented + tested cleanly before next |
| 3. VALIDAR TUDO CLEAN | Step 5 (VALIDATE) + Step 8 (SONAR) | Tests + 5-territory sonar audit |
| 4. EXPANDIR COM AGENTES | Step 6 (WAVES) + named teammates (`Agent name:`) + thermal-guard | Parallel Sonnets in worktrees |
| 5. INTEGRAR SEM QUEBRAR | Step 9 (INTEGRATE) | Sequential merge with validation gates |
| 6. PRÓXIMA ETAPA | Step 10 (COMMIT) → next feature | git commit + handoff for next session/feature |

## Foundation/Expansion zone delineation (Phase 4d primitive — pending C-7 spec)

Open question: how does an agent know "foundation done"? Today vibe-based.

Future: `.soma/project.md` gains `foundation_layers: [roots, trunk]` field + binary criteria for "foundation done":
- All ACs in foundation specs pass
- Step 5 VALIDATE passes
- Zero Critical SONAR findings in foundation territories (architecture, modules, config-state)
- Manual user sentence: "fundação está sólida"

Until C-7 ships (Phase 4d separate spec), agents fall back to manual judgment + user gate.

## Visual reference

The original visual (imagem #5) shows a tree diagram with:
- Roots (RAÍZES) labeled "Arquitetura base, Infraestrutura, Camada núcleo"
- Trunk (TRONCO) labeled "Regras de negócio, Domínio, Abstrações"
- Branches+Leaves (GALHOS E FOLHAS) labeled "Features, Agentes, Worktrees"
- Right side: workflow diagram AGENTE 1..N → WORKTREE → MERGE VALIDADO → IMPLEMENTA → TUDO VALIDADO CLEAN SEM ERROS → PRÓXIMA ETAPA
- Bottom: 6-step icon sequence + 3 Regras de Ouro

## Adoption status

- ✅ Mapped to SOMA 10-step (this doc)
- ✅ Karpathy 4 Behavioral Baseline aligns (project.md.tmpl Section)
- ⏳ Foundation/Expansion zone primitive (C-7 Phase 4d spec pending)
- ⏳ Cross-LLM continuity narrative aligned ("Phase 5 will unlock" per Q1 2026-05-01)

## See also

- `~/.soma-v2/templates/project/.soma/project.md.tmpl` — Karpathy 4 Behavioral Baseline (#1-#4)
- `~/.soma-v2/docs/adapter-contract.md` — Adapter Contract for cross-LLM (D-C11)
- `~/.claude/constitution.md` — 10 Articles (especially Article V Thermal Guard, Article VII Simplicity)
