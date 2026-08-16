# Tasks: fixture — 07 duas [P] mesmo arquivo, B depende diretamente de A (BOM — deve ficar em zero)

CONTRACT-CHECK-PARALLEL-01 corpus item 7. Níveis de dependência distintos:
B alcança A diretamente pelo grafo `depends_on`, então a condição 3 do
contrato (nenhuma alcança a outra) falha e não há colisão a reportar.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | `[P]` Implementa a parte A | [SPEC:AC-09] | `core/shared.cjs` |  | TODO |
| T-B | `[P]` Implementa a parte B | [SPEC:AC-09] | `core/shared.cjs` | T-A | TODO |
