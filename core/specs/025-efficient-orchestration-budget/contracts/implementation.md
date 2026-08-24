# Contract: implementation da Feature 025

## Papel

Executor único. Não altera escopo nem decisões normativas.

## Entrada imutável

- base: commit que contém `spec.md`, `plan.md` e `tasks.md` desta feature;
- autoridade: `spec.md`;
- arquivos permitidos: os seis paths listados em `plan.md` §Mudanças.

## Entrega

- TDD: testes novos falham pela ausência do comportamento antes da implementação;
- AC-01..07 verdes;
- nenhum novo comando, store, schema ou dependência;
- um commit candidato;
- retorno de até 4.000 bytes: status, SHA, testes, paths e blockers; detalhe adicional em arquivo dentro de `core/specs/025-efficient-orchestration-budget/proofs/`.

## Stop

Pare sem improvisar se o mesmo teste falhar em duas correções, se o runtime exigir formato novo ou se algum arquivo fora da allowlist precisar mudar.
