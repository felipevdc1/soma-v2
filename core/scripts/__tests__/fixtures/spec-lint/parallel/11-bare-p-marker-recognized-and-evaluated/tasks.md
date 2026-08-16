# Tasks: fixture — 11 `[P]` sem crase é reconhecida E avaliada (RUIM — 1 achado)

CONTRACT-CHECK-PARALLEL-01 corpus AC-15, lado sensibilidade.

Specs 001-015 escrevem paralelismo como `[P]` **sem** crase (ex.:
`| T-02 | [P] Write contract test...`) — só 016 e 017 usam `` `[P]` ``.
Antes do fix, `PARALLEL_MARKER_RE` exigia a crase e este par nunca virava
`parallel: true` — o `parallel-collision` lia **0 pares em 247 tasks** das
15 specs antigas (ver `noise-floor.md`). "0 achados" por limpeza e "0
achados" por cegueira têm a mesma saída; este fixture prova que agora não
é a segunda: o par é reconhecido E o achado dispara de verdade.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | [P] Implementa a parte A | [SPEC:AC-15] | `core/shared.cjs` |  | TODO |
| T-B | [P] Implementa a parte B | [SPEC:AC-15] | `core/shared.cjs` |  | TODO |
