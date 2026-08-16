# Quickstart: fixture com violação de superfície

Passo 1 — rode o comando abaixo para ver o resultado:

```bash
soma spec-lint <dir> --format json
```

Passo 2 — se preferir, este outro também funciona:

```bash
soma frobnicate <spec-dir>
```

> As duas invocações acima são inválidas de propósito: `--format` não é
> declarada na superfície e `frobnicate` não é verbo declarado. Elas vão em
> cerca executável porque **D-017-01** só varre cerca — em crase inline esta
> fixture ficaria indistinguível da `clean/`, que foi exatamente a regressão
> medida em 2026-08-16.
