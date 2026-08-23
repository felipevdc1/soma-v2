# Tasks: fixture — 02 RED-only coverage: par compartilhado, formas negativas e intervalo silencioso (BOM — zero achados)

AC-02 (spec 019) corpus item 2 — conhecido-BOM, não-vácuo. Cobre os três casos que a régua
não pode acusar: (a) AC com duas tasks referenciadoras, uma RED e outra não — a contagem
de referenciadoras já falsifica antes de olhar a etiqueta; (b) AC com task única sem
etiqueta RED, inclusive quando a referência chega por intervalo; (c) as 7 outras formas de
"RED" que convivem no repo (`RED phase`, `RED commit`, `validateRedPhase`,
`SOMA_RED_PHASE_STRICT`, prefixo `red:` de commit, `RED genuíno`, `expected-RED`) — nenhuma
casa a régua `/\bRED:\s/`, que exige maiúsculas exatas seguidas de dois-pontos e espaço.

| ID | Description | spec_ref | files | Status |
|---|---|---|---|---|
| T-01 | `[FOUNDATION]` Implementa a primeira metade do parser. RED: o teste falha antes do fix | [SPEC:AC-01] | `core/scripts/parser-a.cjs` | TODO |
| T-02 | `[FOUNDATION]` Implementa a segunda metade do parser, cobre o mesmo AC-01 e mais um exclusivo. Sem etiqueta de parada | [SPEC:AC-01] [SPEC:AC-02] | `core/scripts/parser-b.cjs` | TODO |
| T-03 | Cobertura do AC-03. Ver `docs/DECISOES.md` §3 sobre RED phase e TDD ordering | [SPEC:AC-03] | `core/scripts/x03.cjs` | TODO |
| T-04 | Cobertura do AC-04. Commit desta task é um RED commit por convenção do Article III | [SPEC:AC-04] | `core/scripts/x04.cjs` | TODO |
| T-05 | Cobertura do AC-05. Usa `validateRedPhase` para a asserção de fase | [SPEC:AC-05] | `core/scripts/x05.cjs` | TODO |
| T-06 | Cobertura do AC-06. Env obrigatório no dispatch: `SOMA_RED_PHASE_STRICT=1` | [SPEC:AC-06] | `core/scripts/x06.cjs` | TODO |
| T-07 | Cobertura do AC-07. Commit desta task usa o prefixo `red:` por convenção (git log) | [SPEC:AC-07] | `core/scripts/x07.cjs` | TODO |
| T-08 | Cobertura do AC-08. A retomada exige RED genuíno nos dois testes antes do fix | [SPEC:AC-08] | `core/scripts/x08.cjs` | TODO |
| T-09 | Cobertura do AC-09. Este é o caso expected-RED do corpus, sem etiqueta formal | [SPEC:AC-09] | `core/scripts/x09.cjs` | TODO |
| T-10 | `[FOUNDATION]` Esqueleto do sub-verbo novo, cobre os três ACs seguintes de uma vez, sem condição de parada nomeada | [SPEC:AC-10..AC-12] | `core/scripts/x10.cjs` | TODO |
