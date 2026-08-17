# Plan: `soma install` aprende a instalar arquivo inteiro

**Feature ID:** 018-install-whole-files
**Spec:** `core/specs/018-install-whole-files/spec.md`
**Created:** 2026-08-17

---

## Technical Approach

A máquina de install/sync é hoje inteiramente bloco-ancorado: toda entry tem `block_id`/`source_doc`/`target_path`/`target_anchor_id`, o `block_id` é derivado da âncora (`sync.cjs:666`), e a detecção de conflito (`sync.cjs:774`, `:911`) **exige** âncora pra separar a região do SOMA das edições do usuário em volta.

A extensão é **aditiva e discriminada**: a entry ganha um campo `kind` opcional; ausente significa `"block"`, o que preserva as 8 entries existentes **sem tocá-las**. Entries com `kind: "file"` não têm âncora e são resolvidas por um caminho paralelo.

Toda a lógica que pode ser pura vive num módulo novo, `core/scripts/install/files.cjs` — validação de entry, identidade de conteúdo, decisão limpo-vs-divergido, e o planejamento em duas passadas. Os três consumidores (`sync.cjs`, `install.cjs`, `doctor.cjs`) ganham chamadas finas para ele; **nenhum dos três é reescrito**.

O abort total do AC-04 exige **duas passadas**: a primeira avalia todos os alvos e não escreve nada; a segunda só roda se a primeira aprovou todos. É o que torna "ou tudo, ou nada" verdadeiro em vez de aspiracional.

---

## Superfície fixada (2026-08-17) — autoridade única

**Esta seção é a autoridade.** Toda mudança acontece **aqui primeiro**. Divergir no exemplo e ajustar o documento depois foi como nasceram duas ambiguidades na spec 016.

### Shape da entry de arquivo

```json
{
  "kind": "file",
  "source_path": "hooks/framework-guard.cjs",
  "target_path": "~/.claude/hooks/framework-guard.cjs"
}
```

- **`kind`** — `"file"` ou `"block"`. **Ausente significa `"block"`.** É o que preserva as 8 entries existentes sem editá-las (AC-02).
- **`source_path`** — relativo à raiz do repositório SOMA.
- **`target_path`** — absoluto ou com `~`, mesma convenção do `target_path` das entries de bloco.
- **Sem `target_anchor_id`.** Arquivo não tem âncora — é a diferença que motiva a spec inteira.
- **Sem `file_id`.** Considerado e **rejeitado**: o `target_path` já é único por entry e é a chave natural do ledger. Um id paralelo seria um segundo nome pra mesma coisa, e o `block_id` só existe porque é derivado da âncora.

### Campo novo no `install-state`

`installedFiles` — acrescentado a `ALLOWED_STATE_FIELDS` (`install.cjs:74`), que hoje tem `$schema`, `status`, `timestamp`, `snapshotId`, `harness`, `installedVersion`, `lastError`, `blockIds`.

```json
"installedFiles": {
  "~/.claude/hooks/framework-guard.cjs": {
    "sha256": "<hex>",
    "installedAt": "2026-08-17T05:00:00Z"
  }
}
```

Objeto mapeado por `target_path`, não array. Motivo: a operação é **lookup por path** (AC-03/AC-04 perguntam "este arquivo mudou?"); array exigiria varredura. O `blockIds` é array porque a operação dele é enumeração, não lookup.

### Superfície de CLI

```soma-cli-surface
soma install --tool claude
soma sync --tool claude --dry-run
soma sync --tool claude --apply
soma doctor
```

**Zero flag nova.** O escape hatch por arquivo (`--force-file`) foi **considerado e rejeitado pelo usuário** em 2026-08-17, junto com a decisão de abort total. Reconciliar arquivo divergido é ação manual, informada pelo abort.

---

## Architecture Decisions

**D-018-01 — `kind` explícito, não detecção implícita por ausência de âncora.**
Alternativa rejeitada: inferir "é arquivo" quando `target_anchor_id` está ausente. Rejeitada porque entry de bloco malformada (âncora esquecida) seria silenciosamente reinterpretada como arquivo e sobrescreveria o `CLAUDE.md` inteiro. Discriminador explícito transforma um erro catastrófico e silencioso em erro de validação.

**D-018-02 — duas passadas, não escrita incremental com rollback.**
Alternativa rejeitada: escrever incrementalmente e desfazer no primeiro conflito. Rejeitada porque rollback é código que só roda no caminho de erro — o menos exercitado e o mais fácil de estar quebrado sem ninguém saber. Avaliar-tudo-antes-de-escrever-nada não tem caminho de desfazer.

**D-018-03 — módulo novo em `core/scripts/install/`, não em `core/scripts/lib/`.**
Alternativa rejeitada: `core/scripts/lib/install-files.cjs`. Rejeitada por razão medida: o guarda "frozen libs invariant" acende em **qualquer** branch que adicione ou modifique arquivo em `core/scripts/lib/` (2 testes em `manifest.test.cjs` rodando `git diff main -- core/scripts/lib/`), somando **+2 fails** à suíte de toda worktree que tocasse o módulo. Isso é ruído recorrente em cada task da wave. `core/scripts/install/` segue o precedente que a spec 016 estabeleceu com `core/scripts/run/`.

**D-018-04 — a identidade de conteúdo é `sha256` do `node:crypto`.**
Alternativa rejeitada: comparar `mtime` ou tamanho. Rejeitada porque as duas dão falso-negativo trivialmente (edição do mesmo tamanho, `touch`), e a decisão do AC-04 **destrói ou preserva trabalho do usuário** — é o lugar errado pra régua barata. `node:crypto` é stdlib, então a restrição de zero dependência é respeitada.

---

## Phase -1 Gates

- [x] **Simplicity Gate** — 1 módulo novo (`core/scripts/install/files.cjs`), 0 libs novas, 0 dependências. Abaixo do teto de 3.
- [x] **Anti-Abstraction Gate** — o módulo novo não é wrapper especulativo: cada função nele é exigida nominalmente por um AC (validação → AC-02/AC-07, hash → AC-06, decisão limpo/divergido → AC-03/AC-04, duas passadas → AC-04). Nenhuma "infraestrutura que pode ser útil depois".
- [x] **Integration-First Gate** — `node --test` com filesystem real em diretório temporário, zero mock de `fs`. Coerente com Article III e com as suítes existentes.

Nenhum gate violado. **Complexity Tracking:** vazio, de propósito.

---

## Dependencies

**Zero novas.** O `package.json` não tem as chaves `dependencies` nem `devDependencies`, e isso é decisão de arquitetura, não esquecimento. Tudo usado é stdlib do Node: `node:fs`, `node:path`, `node:crypto`, `node:os`.

---

## Baseline a preservar

**1378 tests / 1370 pass / 5 fail / 3 skip**, medido em `c3019f7`. As 5 falhas são pré-existentes (`doctor drift`, `CC-07`, `phase4a-regression`, `AC-13 BLOCK_CONFLICT`, `SANDBOX_VIOLATION`) e **não devem ser consertadas**. Qualquer fail novo é regressão desta spec.

---

## Notas que valem para quem implementa

- **Nunca espelhar diretório.** O repo tem 19 hooks; `~/.claude/hooks/` tem 36. Os **17 de diferença são hooks do usuário** que o SOMA não possui (`mempalace-wakeup`, `insight-action-coupling`, `vault-sync`, `reuse-gate`, `cognitive-gate`, entre outros). Instalação é **por entry declarada**, sempre. É o AC-05, e é a diferença entre uma ferramenta e um acidente.
- **O primeiro `soma install` vai abortar, e isso é o AC-04 funcionando.** Dos 19 hooks do repo: 16 estão vivos e byte-idênticos, 1 não está instalado (`framework-guard.cjs`), e 2 divergiram com o repo à frente (`spec-completeness-gate.cjs`, curado pelo K2 da 016; `spec-test-traceability.cjs`, consertado pela T-15). Os 2 divergidos disparam o abort. Reconciliá-los é ação manual do usuário. **Não "consertar" isso relaxando o AC-04.**
- **`install-state.json` não existe em lugar nenhum** — nem no repo, nem em `~/.soma-v2`. O caminho "primeira instalação" é o caminho comum, não a exceção, e o AC-10 existe porque ausência de state precisa ser distinguível de ausência de drift.
- **A ordem importa no abort.** A primeira passada avalia **todas** as entries e acumula os divergidos; a mensagem nomeia **todos** de uma vez, não só o primeiro. Abortar no primeiro faria o usuário descobrir os problemas um por rodada.
