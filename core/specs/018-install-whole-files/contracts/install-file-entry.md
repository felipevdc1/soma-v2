# Contract: Artifact — Entry de arquivo no `install-targets`

**Contract ID:** CONTRACT-FILE-ENTRY-01
**Serve:** `[SPEC:AC-01]` `[SPEC:AC-02]` `[SPEC:AC-05]` `[SPEC:AC-12]`

---

## Artifact Path

`core/adapters/{tool}/install-targets.json`, campo `entries[]`. O mesmo array que hoje carrega as entries de bloco.

⚠️ **As 8 entries de bloco existentes estão em DOIS arquivos, e nenhum array tem 8**: `claude` tem **3**, `codex` tem **5** (medido em 2026-08-21; é o mesmo número da §Discovery da `spec.md`). O `target_path` desta seção é por adapter — ler "as 8" como "as 8 deste array" é erro de leitura que a T-02 flagrou em vez de assumir. O AC-02 fala em **3** porque é escopado ao adapter `claude`; não há contradição entre os dois números.

---

## Payload

```json
{
  "kind": "file",
  "source_path": "hooks/framework-guard.cjs",
  "target_path": "~/.claude/hooks/framework-guard.cjs"
}
```

**Field constraints:**

| Campo | Tipo | Obrigatório | Restrições |
|---|---|---|---|
| `kind` | string | não | `"file"` ou `"block"`. **Ausente = `"block"`** — é o que preserva intactas as entries existentes (3 no `claude` + 5 no `codex`) |
| `source_path` | string | sim (se `kind: "file"`) | Relativo à raiz do repo SOMA. Não-vazio. Sem `..`. Tem que existir no repo |
| `target_path` | string | sim | Absoluto ou iniciado por `~`. Sem `..`. Mesma convenção do `target_path` das entries de bloco |
| `target_anchor_id` | — | **proibido** quando `kind: "file"` | Arquivo não tem âncora. Presença é erro de validação, não campo ignorado |
| `source_doc` | — | **proibido** quando `kind: "file"` | É o campo equivalente do mundo de bloco. Usar `source_path` |
| `block_id` | — | **proibido** quando `kind: "file"` | Deriva de âncora (`sync.cjs:666`), que não existe aqui |

**Campos proibidos são erro, não ruído.** Uma entry de arquivo com `target_anchor_id` é quase certamente uma entry de bloco malformada, e tratá-la como arquivo sobrescreveria o alvo inteiro — o `CLAUDE.md` do usuário, no pior caso. É a razão do `kind` explícito (D-018-01).

---

## Semântica de validação — fixado em 2026-08-21, depois da T-01

Duas coisas que o contrato não dizia e que a T-01 teve de decidir. Ficam aqui para que T-02 (contract test) e T-07 (consumidor) não inventem respostas diferentes.

**`repoRoot` é opcional na validação, e o que ele liga é a checagem de existência.**

| Chamada | O que é verificado |
|---|---|
| sem `repoRoot` | **shape apenas** — `kind`, campos obrigatórios, campos proibidos, `..`, forma do `target_path` |
| com `repoRoot` | tudo acima **mais** existência do `source_path` no repo e a checagem de escape abaixo |

O caminho real (`planFileInstall`) **sempre** passa `repoRoot`, então a checagem de existência nunca é pulada em produção. A forma sem `repoRoot` existe para validar formato de entry sem precisar de fixture de repo.

**`source_path` que escapa do `repoRoot` é REJEITADO — não só o `..` literal.**

O contrato original citava apenas `..`. Isso deixava passar um `source_path` **absoluto** apontando para fora do repositório, que é o mesmo dano por outro caminho: o instalador copiaria conteúdo arbitrário do disco para dentro do `~/.claude` do usuário. A regra é resolvida, não textual — `path.resolve(repoRoot, source_path)` tem de cair **dentro** de `repoRoot`. Coerente com o §"Invariante de propriedade" abaixo: o instalador só toca o que uma entry declara, e só carrega o que o repositório possui.

---

## Coexistência com entries de bloco (AC-02)

O mesmo `entries[]` carrega os dois tipos. Garantias:

- As entries de bloco existentes — **3 no adapter `claude`, 5 no `codex`** — **não são editadas** por esta spec e continuam produzindo findings idênticos.
- O gate de schema (`sync.cjs:1130`) continua exigindo `soma-install-targets/v1` — **a versão do schema não muda**, porque `kind` é aditivo e opcional.
- Entries de arquivo aparecem no output com o **mesmo vocabulário de `action`** das de bloco. Um consumidor que só conta ações não precisa saber que arquivos existem.

---

## Invariante de propriedade (AC-05)

**O instalador só toca o que uma entry declara.** Nunca varre diretório, nunca espelha, nunca remove.

Medido em 2026-08-17: o repo tem 19 hooks e `~/.claude/hooks/` tem 36. Os 17 de diferença são hooks do usuário (`mempalace-wakeup`, `insight-action-coupling`, `vault-sync`, `reuse-gate`, `cognitive-gate`, entre outros). Qualquer implementação que derive o conjunto do **diretório** em vez das **entries** apaga os 17.

---

## Exclusão declarada (AC-12)

`core/adapters/claude/commands/soma-run.md` **não tem entry** nesta spec, e a razão fica registrada junto ao conjunto: o usuário quer rodar um laboratório à mão com a versão de 296 linhas antes de ela substituir a de 474 que ele roda hoje — que tem **0** `Gate:`, **0** `Report:` e state ainda em `/tmp`.

Ausência silenciosa seria indistinguível de esquecimento. A entry ausente é intencional e o teste do AC-12 prova a intenção.

---

## Contract Test Stub

```javascript
// CONTRACT-FILE-ENTRY-01
// 1. entry sem `kind` é tratada como bloco — as 8 existentes não mudam de comportamento
// 2. entry com kind:"file" e os 2 campos obrigatórios valida
// 3. entry com kind:"file" + target_anchor_id é REJEITADA (não ignorada)
// 4. entry com kind:"file" + source_path contendo ".." é REJEITADA antes de qualquer path ser construído
// 5. entry com kind:"file" apontando source_path inexistente no repo é REJEITADA
// 6. kind desconhecido (ex: "directory") é REJEITADO — não cai em default silencioso
// 7. o conjunto declarado do adapter claude NÃO contém soma-run.md
// 8. entry com kind:"file" e source_path ABSOLUTO apontando fora do repoRoot é
//    REJEITADA (o ".." literal nao e' a unica forma de escapar) — ver §Semantica
//    de validacao. Fixado em 2026-08-21 depois da T-01.
```
