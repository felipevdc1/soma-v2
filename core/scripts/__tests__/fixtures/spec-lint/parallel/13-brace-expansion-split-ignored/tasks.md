# Tasks: fixture — 13 expansão de chaves partida pelo split de vírgula é ignorada (BOM — zero achados)

CONTRACT-CHECK-PARALLEL-01 corpus AC-16, reprodução do caso real de
`009-adapter-skeletons` T-04/T-05 (ver `noise-floor.md`).

`context.cjs` não tem consciência de chaves ao separar a coluna `files`
por vírgula — `` `adapters/{cursor,aider,codex}/z1.json` (NEW × 3) `` vira
três pedaços: `adapters/{cursor`, `aider`, `codex}/z1.json\` (NEW × 3)`.
T-A e T-B abaixo têm essa MESMA abertura de chave (`adapters/{cursor,...`)
— excluindo apenas espaço/parêntese/`+` (a redação literal do AC-16), o
pedaço `adapters/{cursor` sobrevive ao filtro: não tem espaço, não tem
parêntese, não tem `+`, e **contém `/`**. As duas tasks apontariam para
esse mesmo pedaço fantasma e fabricariam uma colisão que não existe — foi
exatamente isso que aconteceu na medição da 009. Rejeitar `{` e `}` no
filtro (extensão feita nesta task, além da lista literal do AC-16) é o que
fecha esta lacuna.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | [P] Implementa a parte A | [SPEC:AC-16] | `adapters/{cursor,aider,codex}/z1.json` (NEW × 3) |  | TODO |
| T-B | [P] Implementa a parte B | [SPEC:AC-16] | `adapters/{cursor,aider,codex}/z2.json` (NEW × 3) |  | TODO |
