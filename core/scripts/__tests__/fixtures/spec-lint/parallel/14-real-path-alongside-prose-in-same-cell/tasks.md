# Tasks: fixture — 14 path real ao lado de prosa na mesma célula (RUIM — 1 achado, só o path real)

CONTRACT-CHECK-PARALLEL-01 corpus AC-16, prova de que o filtro não
super-rejeita: um path de verdade compartilhado entre T-A e T-B tem que
continuar acusando **mesmo quando a mesma célula `files` também carrega
prosa** (padrão real das specs antigas, onde uma task lista um path limpo
e, na vírgula seguinte, uma anotação como `+ test additions` ou uma
expansão de chave partida).

`core/real-shared.cjs` é o único arquivo genuíno e aparece nas duas
tasks. O restante de cada célula é ruído do mesmo tipo dos fixtures 010 e
009 (espaço+parênteses+`+`, e o fragmento de chave partida do fixture 13)
— nenhum dos dois deve aparecer na mensagem do achado.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | [P] Implementa a parte A | [SPEC:AC-16] | `core/real-shared.cjs`, `hooks/x.cjs` (NEW) + test additions |  | TODO |
| T-B | [P] Implementa a parte B | [SPEC:AC-16] | `core/real-shared.cjs`, `adapters/{cursor,aider,codex}/y.json` (NEW × 3) |  | TODO |
