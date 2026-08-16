# Tasks: fixture — 04 REGRESSÃO: 8 [P] no mesmo arquivo (RUIM — deve acusar 28 achados, C(8,2))

CONTRACT-CHECK-PARALLEL-01 corpus item 4 — o fixture de regressão.

O validador ad hoc de 2026-08-15 errou três versões seguidas: lia o próprio
`id` da task como se fosse dependência, o que fazia toda task "alcançar" a
si mesma e derrubava a condição 3 (nenhuma alcança a outra) para TODO par.
Reportou "0 conflitos" contra um `tasks.md` com exatamente esta forma — 8
tasks `[P]` sem dependência entre si, todas escrevendo no mesmo arquivo.

Se o bug do auto-alcance voltar, este fixture é o que grita: 0 achados aqui
é sempre errado, nunca sucesso.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-R1 | `[P]` Implementa o passo 1 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R2 | `[P]` Implementa o passo 2 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R3 | `[P]` Implementa o passo 3 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R4 | `[P]` Implementa o passo 4 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R5 | `[P]` Implementa o passo 5 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R6 | `[P]` Implementa o passo 6 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R7 | `[P]` Implementa o passo 7 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
| T-R8 | `[P]` Implementa o passo 8 | [SPEC:AC-08] | `core/scripts/run/gate.cjs` |  | TODO |
