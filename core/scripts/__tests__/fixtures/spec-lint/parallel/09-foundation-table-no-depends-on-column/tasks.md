# Tasks: fixture — 09 tabela de Foundation sem coluna depends_on (BOM — parseia sem lançar, zero achados espúrios)

CONTRACT-CHECK-PARALLEL-01 corpus item 9. Mesma forma da tabela Foundation
real de `core/specs/017-soma-spec-lint/tasks.md`: sem coluna `depends_on`.
O parser de `context.cjs` lê por nome de coluna, então `dependsOn` fica
`[]` para todas as linhas em vez de lançar ou desalinhar `files`.

## Foundation (Step 3)

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-F1 | `[FOUNDATION]` Prepara a base | [SPEC:AC-09] | `core/shared.cjs` | DONE |
| T-F2 | `[P]` Helper isolado, arquivo próprio | [SPEC:AC-09] | `core/other.cjs` | TODO |
| T-F3 | Outro passo, não é [P], mesmo arquivo de T-F1 | [SPEC:AC-09] | `core/shared.cjs` | TODO |
