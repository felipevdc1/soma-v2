# Contract: Artifact — Ledger de arquivos instalados

**Contract ID:** CONTRACT-FILES-LEDGER-02
**Serve:** `[SPEC:AC-03]` `[SPEC:AC-04]` `[SPEC:AC-06]` `[SPEC:AC-07]` `[SPEC:AC-08]` `[SPEC:AC-09]` `[SPEC:AC-10]`

---

## Artifact Path

`{projeto}/.soma/install-state.json`, campo `installedFiles`.

⚠️ **Este arquivo não existe em lugar nenhum hoje** — nem no repo, nem em `~/.soma-v2`. Medido em 2026-08-17. O caminho "primeira instalação" é o **comum**, não a exceção, e é o que o AC-10 governa.

---

## Payload

```json
"installedFiles": {
  "~/.claude/hooks/framework-guard.cjs": {
    "sha256": "<hex de 64 chars>",
    "installedAt": "2026-08-17T05:00:00Z"
  }
}
```

| Campo | Tipo | Restrições |
|---|---|---|
| chave | string | O `target_path` da entry, verbatim. É a chave natural — a operação é lookup por path, não enumeração |
| `sha256` | string | Hex do conteúdo **que o SOMA gravou**, via `node:crypto`. Não do que está em disco agora |
| `installedAt` | string | ISO 8601 UTC |

**Por que objeto e não array**: `blockIds` é array porque a operação dele é enumerar. Aqui a operação é perguntar "este path mudou?", milhares de vezes menos custosa num mapa.

**Por que `sha256` e não `mtime`/tamanho** (D-018-04): as duas dão falso-negativo trivialmente — edição do mesmo tamanho, `touch`. Esta decisão **destrói ou preserva trabalho do usuário**; é o lugar errado pra régua barata.

---

## Whitelist (AC-07)

`installedFiles` é **acrescentado** a `ALLOWED_STATE_FIELDS` (`install.cjs:74`), que hoje contém `$schema`, `status`, `timestamp`, `snapshotId`, `harness`, `installedVersion`, `lastError`, `blockIds`.

A validação por whitelist **continua rejeitando campo desconhecido**. Estender a lista não pode virar afrouxar a validação — é o teste dos dois lados.

---

## A decisão limpo-vs-divergido

Para cada entry de arquivo, na **primeira** passada:

| Estado em disco | `sha256` bate com o ledger? | Veredito |
|---|---|---|
| ausente | — | **limpo** (primeira instalação) |
| presente | sim | **limpo** (não editado desde a instalação) |
| presente | não | **divergido** |
| presente | sem entrada no ledger | **divergido** |

A última linha importa: arquivo que existe mas que o SOMA nunca registrou **não é dele**, e sobrescrever seria exatamente o dano que o AC-04 previne. É o caso dos 2 hooks que hoje divergem com o repo à frente.

---

## Abort total (AC-04)

**Duas passadas, e a fronteira entre elas é o contrato.**

1. **Avaliar todas** as entries de arquivo. Nada é escrito. Acumular a lista de divergidos.
2. Se a lista de divergidos é **não-vazia** → **abortar**. Nenhum arquivo escrito, nem os limpos. A saída nomeia **todos** os divergidos de uma vez.
3. Se é vazia → escrever todos, e só então atualizar o ledger.

**Nomear todos, não o primeiro.** Abortar no primeiro divergido faria o usuário descobrir os problemas um por rodada — e ele tem 2 divergidos hoje.

**Precedente que fixa esta semântica**: é o que o `sync --apply` já faz para bloco. O teste `AC-13: sync --apply aborts with BLOCK_CONFLICT` mostra que conflito aborta a aplicação inteira. Estado final sempre previsível: ou tudo mudou, ou nada.

**Exit code sinaliza abort, nunca sucesso.** E abort **não é** o status `partial-failed` que já existe em `VALID_STATUSES` — nada foi aplicado parcialmente; a instalação recusou-se a começar.

---

## O que o `doctor` lê (AC-08, AC-09, AC-10)

O `doctor.cjs` tem `detectTargetDrifts(somaHome, adapters)` para blocos e **não confere arquivo nenhum** — toca `~/.claude/hooks/` num único ponto (`:441`, procurando `auto-load-modules.cjs` para o check de context-routing). Foi cego para 6 hooks defasados por 3 meses.

| Situação | Saída exigida |
|---|---|
| `install-state` ausente | **"nunca instalado"**, explicitamente — nunca `No drift detected` |
| arquivo declarado divergindo da fonte do repo | finding nomeando o arquivo |
| todos os declarados idênticos | **silêncio** quanto a arquivos |

A primeira linha é o coração do AC-10: **silêncio de check que não rodou é indistinguível de silêncio de check limpo.** Foi assim que 6 hooks ficaram invisíveis para a ferramenta construída para detectá-los.

---

## Contract Test Stub

```javascript
// CONTRACT-FILES-LEDGER-02
// 1. install grava o ledger com sha256 do conteúdo QUE GRAVOU (não do que estava lá antes)
// 2. installedFiles é aceito pela whitelist; campo desconhecido continua REJEITADO (dois lados)
// 3. arquivo ausente em disco -> limpo -> escrito
// 4. arquivo presente com sha256 batendo -> limpo -> sobrescrito sem perguntar
// 5. arquivo presente com sha256 diferente -> divergido -> ABORT, e NENHUM arquivo escrito
// 6. arquivo presente sem entrada no ledger -> divergido (não é do SOMA)
// 7. 2 divergidos -> a saída nomeia OS DOIS, não só o primeiro
// 8. abort não produz status 'partial-failed' — nada foi aplicado
// 9. rodar install 2x sem mudança no repo -> zero escrita na segunda (idempotência)
// 10. doctor sem install-state -> diz "nunca instalado", NÃO "No drift detected"
// 11. doctor com tudo idêntico -> silêncio quanto a arquivos
// 12. doctor com 1 declarado defasado -> nomeia o arquivo
```
