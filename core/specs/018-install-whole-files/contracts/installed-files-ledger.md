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

## A chave do ledger é o `target_path` VERBATIM — não expandido

Fixado em 2026-08-21 depois da T-01, porque T-05 e T-07 escrevem e leem este mesmo ledger e **têm de usar a mesma string**.

A chave é o `target_path` **exatamente como a entry o declara** — `~/.claude/hooks/framework-guard.cjs`, com o `~` intacto. A forma expandida (`/Users/<user>/.claude/...`) é usada **apenas** para tocar o filesystem, **nunca** como chave.

⚠️ **O modo de falhar é silencioso, e é por isso que está escrito aqui.** Se um consumidor gravar com a chave expandida e outro procurar com a verbatim, o lookup do AC-04 devolve `undefined` → o arquivo é classificado como *"presente sem entrada no ledger"* → **divergido** → a instalação aborta com uma acusação falsa. Nenhum teste de unidade dos dois lados pegaria isso; só o encontro entre eles.

---

## `needsWrite` — campo composto, e o que ele NÃO é

Fixado em 2026-08-21 depois da T-01. Não estava no contrato original; a T-01 precisou dele para tornar a idempotência (stub #9) decidível no módulo puro, em vez de cada consumidor recomputar sha e comparar por conta própria — que é como três cópias divergentes nasceriam.

`planFileInstall` devolve, por item do `plan[]`: `source_path`, `target_path`, `sourcePathAbs`, `targetPathAbs`, `state`, `sourceSha256`, `needsWrite`.

- **`state`** é fiel à tabela literal acima (`clean` | `diverged`) e **não muda**.
- **`needsWrite`** é derivado: `state === 'clean'` **e** (alvo ausente do disco **ou** sem entrada no ledger **ou** sha do ledger ≠ sha da fonte).

⚠️ **A cláusula "alvo ausente do disco" não é redundante.** `state` devolve `clean` tanto para *"ausente, primeira instalação"* quanto para *"presente e idêntico ao registrado"* — são situações opostas quanto a precisar de escrita. Sem essa cláusula, um arquivo **apagado pelo usuário** com o ledger ainda em dia produz `needsWrite: false`, e o `soma install` vira no-op silencioso com exit 0: o hook nunca volta. Isso contradiz o AC-01 diretamente. Medido e reproduzido com controle em 2026-08-21, contra a primeira implementação da T-01.

**Consumidor escreve quando `needsWrite` é `true`.** Não recompute a decisão — se ela precisar mudar, muda aqui e no módulo, não no consumidor.

---

## `writeLedger` não valida a whitelist — quem valida é a T-05

Fixado em 2026-08-21 depois da T-01. O módulo `core/scripts/install/files.cjs` **não** requer `install.cjs`: a dependência corre `install.cjs → files.cjs`, nunca o inverso, para não fechar ciclo. Consequência prática: `writeLedger` faz merge do campo `installedFiles` preservando o resto do state, e **não** roda `ALLOWED_STATE_FIELDS` nem `validateInstallState`.

Portanto o stub #2 deste contrato — *"os dois lados da whitelist"* — é responsabilidade da **T-05**, que é dona do `install.cjs`. Os testes da T-01 provam apenas o merge e o round-trip. **T-05: a validação não está feita; ela é sua.**

---

## 🔴 ONDE o ledger mora — resolvido em 2026-08-21, depois da T-07

**Este é o mesmo defeito da chave verbatim, um nível acima: dois consumidores, duas réguas, e a falha aparece só no encontro.** A T-07 o nomeou antes de eu ver.

Medido:

| Quem escreve | Caminho que usa hoje | No caminho real do `soma install` isso é |
|---|---|---|
| `sync.cjs` (T-07) | `<somaHome>/.soma/install-state.json` | `<repo>/core/.soma/install-state.json` — porque `install.cjs:837` passa `--soma-home=${SOURCE_CORE}` |
| `install.cjs` (T-05) | `<projectPathAbs>/.soma/install-state.json` | o diretório do projeto |

**São dois arquivos diferentes.** Se ficar assim, o `install` grava num, o `sync` lê do outro, todo arquivo aparece como *"presente sem entrada no ledger"* → **divergido** → e a instalação aborta acusando arquivos perfeitos. Exit code de conflito, causa inexistente, e o usuário perseguindo um fantasma.

**A regra, e ela é normativa para T-05 e T-09**: o ledger de arquivos vive em **`<projectPathAbs>/.soma/install-state.json`** — o mesmo arquivo, na mesma localização, que o `install.cjs` já usa para `blockIds` e os outros 7 campos de `ALLOWED_STATE_FIELDS`. Não existe segundo ledger.

**Consequência para o `sync.cjs`**: ele não tem noção de "projeto" na CLI — só `--soma-home`. Portanto, quando o `sync` precisar do ledger, o `projectPathAbs` chega até ele por `process.cwd()`, que é o que o `install.cjs` já define ao invocá-lo (`runStep(..., { cwd: projectPathAbs })`, `install.cjs:841`). **T-05 e T-09 conferem essa igualdade explicitamente**: um teste que roda os dois verbos e prova que escreveram e leram **o mesmo arquivo**, não dois.

⚠️ **Como este defeito falharia sem o teste**: silenciosamente e com sintoma trocado. Nenhum teste de unidade de qualquer um dos lados o pega — cada um está certo sozinho.

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

## Vocabulário e código de erro — fixados em 2026-08-21, depois da T-07

Inventados pela T-07 por analogia, porque nenhum documento os definia. Ficam aqui para que T-05, T-06 e T-09 usem os mesmos e não criem sinônimos.

- **`action` de arquivo divergido é `'drift'`.** `insert` / `replace` / `skip` mapeiam 1:1 do mundo de bloco; `'diverged'` não é valor do vocabulário existente, e `'drift'` é o rótulo que bloco já usa para "edição manual detectada". O `CONTRACT-FILE-ENTRY-01` pede *"mesmo vocabulário de `action`"* — esta é a leitura que o cumpre sem inventar termo novo.
- **`FILE_CONFLICT`**, paralelo ao `BLOCK_CONFLICT`, com **exit 2**. Shape: `{ code: 'FILE_CONFLICT', message, details: { diverged: [<target_path verbatim>] } }`. O `diverged` nomeia **todos**, nunca só o primeiro — §"Abort total" abaixo.
- **`FILE_CONFLICT` não é `partial-failed`.** Nada foi aplicado parcialmente; a instalação recusou-se a começar. Mesma distinção que o §"Abort total" já faz.

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
