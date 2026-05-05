# Spec: Article XI Capture-or-Defer Gate Hook

**Feature ID:** 010-capture-defer-gate
**Branch:** `feature/010-capture-defer-gate`
**Created:** 2026-05-02
**Status:** APPROVED (2026-05-02 — 8/8 D resolutions locked via defaults-all pattern, user ratified)

---

## User Stories

- Como o usuário trabalhando com Claude Code, quero que toda vez que eu propuser deferir um item ("we'll do X later", "post-Phase Y", "deferred", "TODO without ticket") sem nomear capture target durável, o hook me alerta antes do turn finalizar, pra não acumular débito invisível (failure mode #8 prevention).
- Como o usuário revisando logs de sessão, quero ver quantas vezes o hook detectou defer-phrases e quantos foram capturados vs ignored, pra decidir se Article XI passa de DRAFT a ratificado em Phase 5+ (telemetria-driven decision).
- Como o usuário num turn legítimo (e.g., research-only com defer phrasing em context citation), quero override pontual via marker file ou env var, pra hook não bloquear edge cases válidos sem deletar o gate inteiro.
- Como agent SOMA num project com `.soma/CONTEXT.md` definido, quero que o hook reconheça referências a `.soma/decisions/ADR-NNNN-{slug}.md` ou `specs/{NNN}/spec.md#out-of-scope` como capture targets válidos, pra defer-com-captura passar limpo.

---

## Acceptance Criteria

### Detection logic

- **AC-01:** Given assistant turn output contendo defer-phrase exata (ex: "we'll do X later", "post-Phase 5", "deferred to next session", "out of scope for now", "future work", "TODO" sem ticket reference), when hook é invocado em Stop event, then hook detecta a phrase + emite finding com `phrase_matched`, `position`, `severity`.
- **AC-02:** Given assistant turn output contendo defer-phrase EM PORTUGUÊS-BR (ex: "vamos fazer depois", "fica pra próxima sessão", "deferido", "fora de escopo", "pra Phase X"), when hook é invocado, then hook detecta + emite finding (en + pt-br phrase lists ambos supported per Portuguese-BR language support).
- **AC-03:** Given turn output sem nenhuma defer-phrase, when hook é invocado, then hook exits 0 com `findings: []` + zero stderr output.

### Capture target verification

- **AC-04:** Given defer-phrase detected E mesma turn referencia path durável (regex match em `~/.claude/plans/handoff-{name}.md` OR `~/.claude/projects/.+/memory/{name}.md` OR `specs/[0-9]{3}-[a-z0-9-]+/spec\.md` OR `\.soma/decisions/ADR-[0-9]{4}` OR `\.soma/CONTEXT\.md`), when hook é invocado, then hook emite finding com `status: "captured"` + zero block.
- **AC-05:** Given defer-phrase detected SEM capture target reference em mesma turn, when hook é invocado em soft-warn mode (default), then hook emite finding com `status: "uncaptured"` + warning message em stderr + exit 0 (não bloqueia turn).
- **AC-06:** Given defer-phrase detected SEM capture target E hook em hard-block mode (post-stabilization, env `ARTICLE_XI_HARD=1`), when hook é invocado, then hook output JSON com `decision: "block"` + message field describing missing capture + exit 1 (bloqueia Stop).

### Override mechanisms

- **AC-07:** Given marker file `/tmp/article-xi-bypass-{sessionId}` existe, when hook é invocado, then hook skip-detect + exits 0 sem scan (override pontual).
- **AC-08:** Given env var `ARTICLE_XI_DISABLED=1`, when hook é invocado, then hook skip-detect + exits 0 (override session-wide).

### Telemetry

- **AC-09:** Given hook detecta phrase (capturada OU não), when hook é invocado, then hook append entry em `~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl` com schema `{schema: "article-xi-telemetry/v1", timestamp, sessionId, phrase, status: "captured"|"uncaptured", capture_target: string|null, hard_mode: bool}`.
- **AC-10:** Given log file `~/.claude/logs/article-xi-{date}.jsonl` existe, when developer reads, then arquivo é JSON-Lines parseable (1 entry per line, valid JSON each).

### Multi-turn search scope

- **AC-11:** Given defer-phrase em current turn E capture target reference em previous-turn (last N=1 turn), when hook é invocado, then capture target reference recognized + status `captured` (D2 lock — search scope = 2 turns: current + last).

### Soft-warn ↔ hard-block transition

- **AC-12:** Given hook em default soft-warn mode (env `ARTICLE_XI_HARD` unset), when uncaptured defer detected, then exit 0 + stderr warning não bloqueia turn finalization.
- **AC-13:** Given env `ARTICLE_XI_HARD=1` set, when uncaptured defer detected, then exit 1 + JSON block output bloqueia turn (per Article XI ratified Phase 5+).

### Test infrastructure

- **AC-14:** Given hook test file `~/.claude/hooks/capture-defer-gate.test.cjs`, when `node --test ~/.claude/hooks/capture-defer-gate.test.cjs` é executado, then ≥30 tests pass cobrindo: en+pt-br phrase lists, capture target patterns, override mechanisms, soft-warn vs hard-block, telemetry schema, multi-turn search.
- **AC-15:** Given full hooks regression `node --test ~/.claude/hooks/*.test.cjs` é executado, then 49/49 hooks/*.test.cjs (era 48 + 1 new), pass-or-skip preserved.

---

## Non-Functional Requirements

- **Performance:** ≤50ms p95 wallclock per invocation (regex scan on ~10KB turn output). Stop event invoca hook em todo turn; latency budget tight.
- **Security:** No external network calls. Telemetry log write é local-only. Block decision JSON contém apenas message + decision (no leaked output content).
- **Test style:** Integration tests usam fixtures synthetic em `/tmp/article-xi-fixture-{slug}/` simulando assistant turn JSON inputs. Real Stop event JSON schema. Zero mocks pra fs/path/regex (stdlib direct).
- **Test count target:** ≥30 tests (1.5× per AC mean, larger per regex AC).
- **Output convention:** stdout = JSON when blocking (Stop hook contract); stderr = human warnings (visible to the user in CLI). Log file = JSONL persistent.
- **TDD discipline:** RED commits separated GREEN per Article II + C-2 enforcement (`SOMA_RED_PHASE_STRICT=1`).
- **Monitoring:** Hook self-logs to JSONL. `soma doctor --check-article-xi` future flag (Phase 5+) reads log + reports stats (deferred to Phase 5+ per Q4 sentence).

---

## Out of Scope

- Hard-block default — MVP ships soft-warn only. Hard-block opt-in via env var. Default hard-block toggle deferred to Phase 5+ post-30-day telemetry review (per Article XI draft ratification path).
- Capture target validation depth — hook checks PATH PATTERN match (regex), não verifica que file actually exists ou contains entry. Phase 5+ enhancement.
- Auto-capture suggestion — hook detecta missing capture mas NÃO sugere "add this to handoff bucket Y" (Phase 5+ if false-positive rate too high pra justify enhancement).
- Cross-language false-positive prevention — hook may flag legitimate "later" usage em context citations ou explanations. MVP accepts false-positive rate; bypass via override mechanisms (AC-07/08).
- Stop event output mutation — hook only allows OR blocks; hook NÃO modifica turn output content. (Claude Code Stop hook contract supports mutation; not used here.)
- Hook self-update / migration — hook ships as standalone .cjs. No version migration logic em MVP.

---

## Resolved Decisions

8/8 NCs sentenced 2026-05-02 by the user ("ok" = accept defaults all path mirror Spec 008):

- **D1 — Phrase scanning scope**: current turn (`hookSpecificInput.transcript_path` last entry) + last 1 previous turn = 2 turns total. Wider scope (3+ turns) deferred to Phase 5+ if false-negative rate too high.
- **D2 — Multi-language phrase lists**: en + pt-br ambos supported in MVP. Portuguese-BR language support in MVP; en covers SOMA docs/CLAUDE.md context. Other languages (es, fr) deferred until user demand surfaces.
- **D3 — Telemetry storage**: `~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl` daily-rotation log file. NO server send. Local-only, user-owned.
- **D4 — Soft-warn duration default**: 30 days from hook ship date (timestamp gravado em hook source as constant). Post-30-days, `ARTICLE_XI_HARD` env var gate flip from default-off to default-on. Auto-flip deferred to Phase 5+ ratification spec.
- **D5 — Override mechanism**: marker file `/tmp/article-xi-bypass-{sessionId}` (pontual) + env var `ARTICLE_XI_DISABLED=1` (session-wide) + env var `ARTICLE_XI_HARD=0|1` (mode). 3 mechanisms paralelos a outras gates usadas (cognitive-gate, agent-mode-gate).
- **D6 — Per-project enable/disable**: global hook always-on default (instalado em `~/.claude/hooks/settings.json`). Per-project disable via `.soma/article-xi.disabled` marker file (Phase 5+ if needed). MVP global-only.
- **D7 — Block message format**: short + actionable. Pattern: "Article XI: defer-phrase '{phrase}' detected without capture target. Suggested capture: {nearest_handoff_or_memory}. Override: touch /tmp/article-xi-bypass-{sessionId}". Verbose explanation deferred (failure mode #8 is documented in CLAUDE.md).
- **D8 — Phase 5+ ratification trigger**: 30-day telemetry review. Criteria for ratification: (a) ≥10 detections, (b) false-positive rate ≤20%, (c) zero "blocked legitimate work" complaints from the user. Backout path documented em Article XI draft (DEPRECATED-AT-{date} if criteria fail).

---

## Completeness Checklist

- [x] Every AC is testable (Given/When/Then, observable, not implementation)
- [x] No implementation details leaked into AC (no HOW, only WHAT)
- [x] Zero `[NEEDS CLARIFICATION]` markers remaining (8/8 D1-D8 resolved 2026-05-02 via "defaults all" pattern)
- [x] NFR section has performance SLO + security constraints + test style + monitoring
- [x] Out of Scope section has 6 entries
- [x] Feature ID + Branch filled in
