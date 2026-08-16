# Spec: fixture com violação de superfície

**Feature ID:** fixture-violation

Fixture usado por `contract-lint-output.test.cjs` (T-03) para exercitar
CONTRACT-LINT-OUTPUT-01 contra achados reais uma vez que `cli-surface`
(T-06) deixe de ser stub: formato da linha de achado, conteúdo da mensagem
(nomeia o token ofensor), path relativo ao `<spec-dir>`, e ordem
determinística entre execuções.

Não tem `tasks.md` — as violações aqui são só de `cli-surface`, pra não
misturar achados de `parallel-collision` na mesma saída.
