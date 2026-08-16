# Tasks: fixture — 12 `[P]` sem crase + dependência direta (BOM — zero achados)

CONTRACT-CHECK-PARALLEL-01 corpus AC-15, lado especificidade.

Prova que reconhecer `[P]` sem crase não quebra a condição 3 (fecho
transitivo do `depends_on`). T-B declara `depends_on: T-A` — mesmo os dois
sendo `[P]` sem crase e compartilhando arquivo, não colidem, porque estão
em níveis diferentes. Sem este fixture, o reconhecimento do AC-15 só seria
provado isolado da regra de colisão, e o defeito que ele poderia
introduzir — reconhecer o marcador mas ignorar `depends_on` — passaria
despercebido.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | [P] Implementa a parte A | [SPEC:AC-15] | `core/shared.cjs` |  | TODO |
| T-B | [P] Implementa a parte B | [SPEC:AC-15] | `core/shared.cjs` | T-A | TODO |
