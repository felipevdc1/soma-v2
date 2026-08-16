# Plan: fixture sem spec.md

Fixture usado por `contract-lint-output.test.cjs` (T-03) para provar o
AC-03 / CONTRACT-LINT-OUTPUT-01: `<spec-dir>` existe, mas sem `spec.md` — a
CLI sai com código 2 nomeando o que falta, e não executa nenhum check.

Este diretório tem `plan.md` de propósito (pra provar que a checagem é
especificamente por `spec.md`, não por "diretório vazio").
