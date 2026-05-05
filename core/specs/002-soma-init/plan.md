# Plan: SOMA v2.1 Phase 3 — Init Command + Sample Project

**Feature ID:** 002-soma-init
**Spec:** `specs/002-soma-init/spec.md`
**Created:** 2026-05-01
**Status:** APPROVED

---

## Technical Approach

One CLI command (`init`) implemented as standalone Node `.cjs` script em `~/.soma-v2/scripts/init.cjs`, reusing Phase 2 shared libs (`scripts/lib/anchored-blocks.cjs` pra `parseAnchorAttrs` + `computeBlockSha256`, e `scripts/lib/manifest.cjs` pra `expandHome`) e introduzindo 2 novas libs: `scripts/lib/template-engine.cjs` (placeholder substitution via regex sobre `{{KEY}}` markers) e `scripts/lib/agents-md-injector.cjs` (parse existing AGENTS.md → detect existing block → append bootloader preservando content). Templates são lidos diretamente de `~/.soma-v2/templates/project/` em cada invocação (não bundled). O comando opera em modo write por default (greenfield create), modo dry-run preview (zero side effects), ou modo redirect (quando `.soma/` já existe — exit 1 + suggestion mensagem pra `doctor`/`sync`).

Tests usam `/tmp/soma-init-test-{uuid}/` fixtures replicando estrutura do lab via `cp -R` quando precisam de templates reais; ou diretórios temporários puros pra exercícios de greenfield. Sample project ephemeral (per AC-07) é criado em `/tmp/soma-sample-{slug}/` durante test/quickstart e cleanado after — não é first-class CLI feature, é validation fixture pra pipeline init→doctor→sync.

**Stack:**
- Runtime: Node ≥18 (stdlib only — `node:fs`, `node:path`, `node:crypto`, `node:os`, `node:child_process` for tests)
- Framework: none (vanilla CommonJS); reuse Phase 2 shared libs via `require('./lib/anchored-blocks.cjs')` (sibling path)
- Storage: filesystem only (markdown templates, JSON state, anchored markdown output)
- Test runner: `node --test` (built-in, matches Phase 2 + hooks ecosystem)

**Rationale:** Stack lockada via spec D7 decision (`.cjs` vanilla). Mantém 100% consistency com Phase 2 (110 tests verde) + hooks ecosystem (38 tests verde). Template engine custom (regex substitution) é trivial — uma função de ~10 linhas — e evita dep em Mustache/Handlebars. AGENTS.md injection algorithm é parse + append (não rewrite), preservando byte-for-byte content existente fora do block.

---

## Architecture Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **AD-01:** CLI stack `.cjs` vanilla CommonJS Node | Spec D7. Matches Phase 2 + hooks ecosystem 100%, zero deps, reuse direto via `require()` das libs Phase 2. | TS via Node 22 strip-types (flag experimental); TS via tsx (npm install + ecosystem divergence) |
| **AD-02:** Idempotence policy = stop+redirect (greenfield-only) | Spec D1. Init é write-mode entry-point; updates são via sync (Phase 4). Re-run em `.soma/` existente retorna exit 1 + sugestão `doctor`/`sync` em vez de silently mutate. | No-op + warn (ambiguous: "what changed?"); update timestamps only (rewrites file silently); fail explicit sem suggestion (user-hostile) |
| **AD-03:** AGENTS.md injection algorithm = parse → detect-or-append → preserve | Spec D6. Lê file existente, detecta block `project.AGENTS.bootloader` via `lib/anchored-blocks.cjs`. Se ausente, append separado por blank line; nunca toca content fora do block. Se presente sem `.soma/` → erro `AGENTS_MD_PARSE_ERROR` (estado anômalo). | Full file rewrite from template (perde content); regex replace inline (frágil; pode corromper markdown); generic "merge" lib (over-abstraction) |
| **AD-04:** Template engine = simple regex `{{KEY}}` substitution | Trivial implementação (~10 linhas), zero deps, sem build step. Templates têm 2 placeholders apenas (`{{PROJECT_NAME}}`, `{{ISO8601_DATE}}`). | Mustache/Handlebars (npm dep + overkill); JS template literals via eval (security risk + dep on JS in templates) |
| **AD-05:** Sample project = test/quickstart fixture (não first-class) | Spec D4. `/tmp/soma-sample-{slug}/` é validation pra AC-07 pipeline (init→doctor→sync), não comando próprio. Slug via `crypto.randomBytes(4).toString('hex')` em testes. | First-class `init --sample` flag (escopo extra, não em PLAN §7); fixed `/tmp/soma-sample/` path (collision entre tests paralelos) |
| **AD-06:** New shared libs em `scripts/lib/` (`template-engine.cjs` + `agents-md-injector.cjs`) | Factor-out de código novo: template-engine é usado por init.cjs sozinho hoje mas será reused por future `soma sync` write-mode (Phase 4); agents-md-injector é encapsulamento da lógica complex parse+inject. NÃO é wrapper especulativo — encapsula algoritmo concreto definido em AD-03. | Inline em init.cjs (drift hazard quando Phase 4 reusa); generic helper class (over-abstraction); 1 lib monolítica (mistura preocupações: templating ≠ markdown surgery) |

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 1 entry point (init.cjs) + 2 new libs (template-engine.cjs, agents-md-injector.cjs) + reuse Phase 2 libs (anchored-blocks.cjs, manifest.cjs já existing). Total **3 new files runtime** + reuse de 2 existing. Bem abaixo do limit ≤3 components — libs são 2 arquivos lógicos shared. PASS.
- [x] **Anti-Abstraction Gate** — vanilla Node stdlib direto (`fs`, `crypto`, `path`). Template engine é 1 função regex (~10 LOC), não framework. AGENTS.md injector é factor-out concreto (algorithm de AD-03), não wrapper especulativo. Spec D7 explicit zero npm deps. PASS.
- [x] **Integration-First Gate** — todos integration tests usam real fs em `/tmp/soma-init-test-*/` fixtures + real shasum + real templates lidos do lab. Zero mocks de fs/crypto/path. Unit tests permitidos apenas pra parser puro (template-engine placeholder substitution + agents-md-injector parse logic) — não requer fs. PASS.

---

## Complexity Tracking

<!-- Não aplicável — todos gates PASS sem violação. -->

| Gate violated | Reason (must ref AC-XX) | Revisit trigger |
|---|---|---|
| (none) | (none) | (none) |

---

## Dependencies

- **Node ≥18** — stable `node --test` runner, stable `node:fs/promises` (already required by Phase 2 + hooks ecosystem)
- **Zero npm packages** — stdlib only per AD-01
- **`~/.soma-v2/scripts/lib/anchored-blocks.cjs`** — reused via `require('./lib/anchored-blocks.cjs')` para `parseAnchorAttrs` + `computeBlockSha256`
- **`~/.soma-v2/scripts/lib/manifest.cjs`** — reused via `require('./lib/manifest.cjs')` para `expandHome`
- **`~/.soma-v2/templates/project/`** — read directly per invocation (4 templates: AGENTS.md.tmpl + .soma/{project,CONTEXT,modules/index}.md.tmpl) — verified intact pre-dispatch

**No new external dependencies introduced.** Tudo Node stdlib + reuse de Phase 2 libs + read templates from disk.

---

## References

- Spec: `specs/002-soma-init/spec.md`
- Contract: `specs/002-soma-init/contracts/init.md`
- Quickstart: `specs/002-soma-init/quickstart.md`
- Constitution: `~/.claude/constitution.md` Articles I (spec source-of-truth), III (Integration-First), VII (Simplicity)
- Phase 2 plan (pattern reference): `~/.soma-v2/specs/001-soma-doctor-sync-cli/plan.md`
- Phase 2 libs (reuse): `~/.soma-v2/scripts/lib/{anchored-blocks,manifest}.cjs`
- Templates: `~/.soma-v2/templates/project/{AGENTS.md.tmpl, .soma/project.md.tmpl, .soma/CONTEXT.md.tmpl, .soma/modules/index.md.tmpl}`
- PLAN.md canonical: `${HOME}/Documents/Codex/2026-04-24/soma v2/soma-v2-plan/PLAN.md` §7 Phase 3, §6.5 project.md schema, §6.2 installed-state.json schema, §5.2 project AGENTS.md
- Approved orchestrator plan: `~/.claude/plans/bora-pro-phase-3-velvety-clarke.md`
- Active handoff: `~/.claude/plans/handoff-soma-v2.1.md`
