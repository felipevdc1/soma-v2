# Tasks: fixture — 01 RED-only coverage, AC único + intervalo (RUIM — deve acusar 6 achados)

AC-02 (spec 019) corpus item 1 — conhecido-RUIM. Um AC coberto por uma task única com
etiqueta `RED:`, e um intervalo `[SPEC:AC-01..AC-05]` coberto pela mesma forma — a
expansão do intervalo tem que produzir 5 achados adicionais, um por AC, não um só.

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | `[FOUNDATION]` Implementa o parser puro. RED: a função existe e falha o assert antes do fix | [SPEC:AC-13] | `core/scripts/parser.cjs` | TODO |
| T-02 | `[FOUNDATION]` Esqueleto dos 5 sub-verbos. RED: `cli --help` lista os 5 verbos e verbo desconhecido sai com exit ≠ 0 | [SPEC:AC-01..AC-05] | `core/scripts/cli.cjs` | TODO |
