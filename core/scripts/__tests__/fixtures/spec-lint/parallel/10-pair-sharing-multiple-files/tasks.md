# Tasks: fixture — 10 duas [P] compartilhando DOIS arquivos (RUIM — 1 achado, não 2)

Não é um dos 9 itens numerados do corpus original. Existe pra provar a
correção de 2026-08-16 em `contracts/check-parallel-collision.md` §Achado:
"um achado por par colidente — não por arquivo". Nenhum dos fixtures 01-09
exercita um par com mais de um arquivo em comum, então essa divergência de
leitura ("por par" vs "por arquivo compartilhado") ficava invisível.

T-A e T-B são `[P]`, mesmo nível (sem `depends_on`), e compartilham
`core/shared1.cjs` **e** `core/shared2.cjs` — cada uma tem também um
arquivo próprio, não compartilhado, que **não** pode aparecer na mensagem
do achado.

Esperado: **1** achado (o par é uma decisão de sequenciamento, não duas),
nomeando os dois arquivos compartilhados e nenhum dos dois exclusivos.

| ID | Description | spec_ref | files | depends_on | Status |
|---|---|---|---|---|---|
| T-A | `[P]` Implementa a parte A | [SPEC:AC-08] | `core/a-only.cjs`, `core/shared1.cjs`, `core/shared2.cjs` |  | TODO |
| T-B | `[P]` Implementa a parte B | [SPEC:AC-08] | `core/shared1.cjs`, `core/shared2.cjs`, `core/b-only.cjs` |  | TODO |
