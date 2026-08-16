# Tasks: fixture — 08 duas [P] mesmo arquivo, B alcança A por caminho transitivo B→C→A (BOM — deve ficar em zero)

CONTRACT-CHECK-PARALLEL-01 corpus item 8 — o que o fecho transitivo compra.
T-C não é `[P]` e não compartilha arquivo com ninguém; existe só para
formar o caminho B→C→A no grafo `depends_on`. Uma implementação que só
olhasse dependência direta erraria este fixture.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | `[P]` Implementa a parte A | [SPEC:AC-09] | `core/shared.cjs` |  | TODO |
| T-C | Passo intermediário, não é [P] | [SPEC:AC-09] | `core/other.cjs` | T-A | TODO |
| T-B | `[P]` Implementa a parte B | [SPEC:AC-09] | `core/shared.cjs` | T-C | TODO |
