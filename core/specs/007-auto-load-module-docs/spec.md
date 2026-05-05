# Spec: Auto-Load Module Docs Primitive (C-1 Option A)

**Feature ID:** 007-auto-load-module-docs
**Branch:** `feature/007-auto-load-module-docs`
**Created:** 2026-05-02
**Status:** SHIPPED (2026-05-02 — 18/18 ACs validated + 8/8 D resolutions Bruno-style + C-1 implementation 61 hooks tests + 8 doctor tests + recovery template fix)

---

## User Stories

- Como Sonnet executor dispatched pra task envolvendo área específica (auth/billing/etc), quero auto-receber module docs relevantes injetadas no system prompt sem precisar pedir explicitly, pra não gastar tool calls procurando contexto.
- Como o usuário (orchestrator) dispatching agents pra tasks complexas, quero que keywords no task description triggerm auto-load dos modules relevantes (≤2 max pra token efficiency), pra agents tenham context apropriado sem manual injection.
- Como dev SOMA mantendo `.soma/CONTEXT.md` keyword routing table, quero rodar `soma doctor --check-context-routing` pra validar que cada keyword→slug ref aponta pra module existente + status active, pra evitar broken references silenciosos em production dispatches.

---

## Acceptance Criteria

- **AC-01:** Given um agent dispatch via Agent tool com task description, when `~/.claude/hooks/subagent-init.cjs` executa em PreSubagentSpawn flow, then o hook lê o task description do spawn context (input via env/stdin/argv conforme convenção do hook system).
- **AC-02:** Given um projeto SOMA com `.soma/CONTEXT.md` existente, when o hook é invocado, then ele parses o file: front-matter schema `soma-context/v1` + body table com rows `| keyword | module_slug |` (markdown table format).
- **AC-03:** Given task description + parsed CONTEXT.md, when keyword matching executa, then é case-insensitive substring match (default proposal — D1 NC); cada match recebe score (count de occurrences ou simple binary 1).
- **AC-04:** Given matches with scores, when seleção de modules pra carregar, then no máximo **2 modules** são selecionados (token efficiency cap; D2 hardcoded MVP).
- **AC-05:** Given 2 modules selected, when soma de bytes/tokens excede budget cap (default ~5KB UTF-8 bytes total post-front-matter), then o módulo com maior score é mantido + segundo é dropped + warning emitted.
- **AC-06:** Given selected modules, when status filter aplica, then apenas modules com `status: active` são carregados; `hypothesis` + `deprecated` modules são SKIPPED silenciosamente (não contam pra max 2 cap).
- **AC-07:** Given multiple module candidates with same keyword score, when tie-break aplica, then prioridade é `layer: roots > trunk > leaves`; em mesmo layer, alphabetical slug (deterministic).
- **AC-08:** Given final selected modules, when injection happens, then content é appended ao system prompt do agent em formato delimitado claro:
    ```
    --- soma-auto-loaded-module: {slug} (layer: {layer}) ---
    {module markdown content sem front-matter}
    --- end module ---
    ```
- **AC-09:** Given projeto sem `.soma/CONTEXT.md`, when hook executa, then silent skip — nenhum auto-load + nenhum erro + agent runs without modules. Stderr log único linha INFO ("no .soma/CONTEXT.md found; auto-load skipped").
- **AC-10:** Given CONTEXT.md presente mas zero keywords match no task description, when hook executa, then silent skip — agent runs without modules.
- **AC-11:** Given >0 keywords match mas todos candidatos filtered out por status (e.g. todos hypothesis), when hook executa, then warning loud no stderr ("X keywords matched but all candidate modules are non-active; auto-load skipped"). Agent ainda runs sem modules.
- **AC-12:** Given `.soma/CONTEXT.md` schema, when validator runs, then aceita formato:
    ```yaml
    ---
    schema: soma-context/v1
    project: {project-slug}
    last_updated: {ISO8601}
    ---

    # Module Context Routing

    | Keyword | Module Slug |
    |---------|-------------|
    | auth    | auth-system |
    | billing | billing     |
    ```
    Front-matter parsing reusa `lib/module-store.cjs` regex parser (Phase 4c, shasum-locked). Body table parsing é simple regex per row.
- **AC-13:** Given novo flag `soma doctor --check-context-routing`, when executado em projeto com CONTEXT.md, then itera cada `keyword → slug` ref + verifica que `.soma/modules/{slug}.md` existe + status é `active`.
- **AC-14:** Given broken ref detected (slug não existe OR module file não tem front-matter parseable OR status é deprecated/hypothesis), when doctor runs, then emite finding `severity: warning` (D7 NC, non-blocking) com `code: BROKEN_CONTEXT_ROUTING` + `keyword` + `slug` + `reason`. Doctor exit 0 (não bloqueia).
- **AC-15:** Given Agent dispatch flow integration, when subagent-init.cjs runs e seleciona modules, then content injection acontece via stdout/file output que o Agent tool harness reconhece e adiciona ao system prompt do child agent.
- **AC-16:** Given existing 571/571 SOMA cumulative + 47/47 hooks subset + 48/48 hooks aggregate baseline, when Phase 4d-bis ships, then todas counts preserved + 6 canonical+lib shasums match baseline.
- **AC-17:** Given env var `SOMA_AUTO_LOAD_TOKEN_CAP` definida (e.g. `8192`), when hook executa, then usa esse cap em vez do default 5KB. Useful para projetos com token budget mais generoso.
- **AC-18:** Given hook integration com agent dispatch, when hook detecta erro (CONTEXT.md malformed, regex fail, etc.), then NÃO bloqueia o spawn — agent dispatch prossegue sem auto-load + erro logged ao stderr (defensive — auto-load é optimization, não critical path).

---

## Non-Functional Requirements

- **Performance:** hook execution <200ms total (CONTEXT.md parse + keyword match + 2 module reads + injection). Tempo total não pode ser perceptível ao user durante dispatch.
- **Security:** module markdown content é sanitized — no injection of shell metacharacters / no eval. Content é treated como plain text. Token budget cap protege contra DoS via large module file.
- **Test style:** integration via tmp project dir + spawnSync simulando subagent-init.cjs invocation com fake task descriptions + verifications de injection content. TDD HARD per Article II + C-2 (`SOMA_RED_PHASE_STRICT=1`). Mock-free — uses real fs + real hook.
- **Backward compat:** 571/571 SOMA + 47/47 hooks (subset) + 48/48 hooks aggregate preserved. Hook continua funcionando pra projects sem `.soma/` (skip auto-load).
- **Idempotência:** hook é stateless — multiple invocations com mesmo input retornam mesmo output deterministic.

---

## Out of Scope

- Option B `/load-module {keyword}` slash command — Phase 5+ if demand surface (>10% dispatches w/ missed auto-load)
- ML-based keyword matching (semantic similarity) — Phase 6+
- Per-agent token budget (different caps por Sonnet vs Opus vs Haiku) — Phase 5+
- Cross-project CONTEXT.md sharing (one CONTEXT.md per multiple projects) — Phase 5+
- Auto-population of CONTEXT.md from module front-matter keywords — Phase 5+
- Snippet injection (Bruno C-1 .json snippets via Phase 4c shipping) — only modules markdown injected MVP

---

## Resolved Decisions (2026-05-02 — user ratified Bruno-style "lock all")

- **D1 (was 007-NC1) — Keyword matching algorithm**: case-insensitive substring match. **Why**: simpler MVP; "authenticate" matches "auth" é forgiving — agents tendem a usar variações naturais. False positive risk é baixo pra MVP; semantic matching Phase 6+ se demand surface.
- **D2 (was 007-NC2) — Max 2 modules cap**: hardcoded 2 MVP. **Why**: simplicity over configurability (Bruno P6 simplicity gate). Configurable via env var Phase 5+ se >5 reports de "preciso 3 modules".
- **D3 (was 007-NC3) — Token budget exceed behavior**: truncate to 1 module com maior score. **Why**: graceful degradation — auto-load com 1 module > nothing. Warning emit pra surface ao user qual módulo foi dropped.
- **D4 (was 007-NC4) — Tie-break dentro do mesmo layer**: alphabetical slug. **Why**: deterministic + zero state tracking required (sem timestamp dependencies). Reproducible em dispatches replays.
- **D5 (was 007-NC5) — Injection format**: markdown delimited com header `--- soma-auto-loaded-module: {slug} (layer: {layer}) ---` + body + `--- end module ---`. **Why**: agents leem markdown natively (zero parsing burden); delimitadores claros pra agent perceber boundaries.
- **D6 (was 007-NC6) — CONTEXT.md location**: per-project `.soma/CONTEXT.md` MVP. **Why**: project-scoped routing alinha com `.soma/modules/` per-project pattern; global routing Phase 5+ se demand cross-project surface.
- **D7 (was 007-NC7) — Broken ref severity**: warning non-blocking (D6/D7 alignment com Phase 4d). **Why**: routing errors são UX issue (broken keyword routing prejudica auto-load) não data integrity issue (modules ainda funcionam manualmente). Warning surface ao user sem bloquear doctor exit 0.
- **D8 (was 007-NC8) — Hook injection mechanism**: extend pattern existente do `subagent-init.cjs` Phase 2 (já injeta Constitution + FAMILY_DOC + Spec AC nos child agents — pattern empiricamente provado). Sonnet faz research first pass via reading existing subagent-init.cjs antes de implementar. Se pattern não suporta auto-load injection (e.g. PreSubagentSpawn não existe ou tem restrições), Sonnet REPORTS partial status pra orchestrator decide adapter approach. **Why**: zero invenção — reusa infra existente shipada Phase 2.

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining
- [x] NFR section has at least: performance SLO, security constraints, test style
- [x] Out of Scope section has at least one entry
- [x] Feature ID + Branch filled in
