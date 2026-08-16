# Contract: Check — parallel-collision

**Contract ID:** CONTRACT-CHECK-PARALLEL-01
**spec_ref:** [SPEC:AC-08] [SPEC:AC-09]
**Created:** 2026-08-16

---

## Módulo

```
core/scripts/lib/spec-lint/checks/parallel-collision.cjs
```

```javascript
module.exports = {
  name: 'parallel-collision',
  run(ctx),   // -> { status: 'ran'|'skipped', reason?, findings: Finding[] }
};
```

Consome `ctx.tasks`, já parseado por `lib/spec-lint/context.cjs`. **Não reparseia o `tasks.md`** — um único parser é o que faz o formato quebrar num lugar só.

---

## Entrada

Cada entrada de `ctx.tasks`:

| Campo | Origem no `tasks.md` | Restrições |
|---|---|---|
| `id` | coluna `ID` | ex.: `T-07` |
| `parallel` | presença do literal `` `[P]` `` no início da coluna `Description` | booleano |
| `files` | coluna `files`, separada por `, ` e des-crasada | array, pode ser vazio |
| `dependsOn` | coluna `depends_on`, separada por `, ` | array; **ausente** na tabela de Foundation, onde vale `[]` |

A coluna `depends_on` **não existe na tabela de Foundation** e existe nas demais. O parser tem que ler por nome de coluna do cabeçalho, nunca por índice fixo — tabelas com número de colunas diferente convivem no mesmo arquivo.

---

## Regra de colisão

Duas tasks `A` e `B` colidem quando **todas** as condições valem:

1. `A.parallel` **e** `B.parallel`
2. `A.files ∩ B.files ≠ ∅`
3. Nenhuma alcança a outra no grafo `depends_on` (fecho transitivo, nos dois sentidos)

A condição 3 é derivada do grafo, **não do cabeçalho da wave**. Cabeçalho é prosa, e prosa é exatamente o que este linter existe para parar de confiar.

⚠️ **Armadilha registrada, com custo medido:** o validador ad hoc de 2026-08-15 errou **três versões seguidas** — lia o próprio `id` da task como se fosse dependência, o que fazia toda task "alcançar" a si mesma e derrubava a condição 3 para todo par. Reportou **"0 conflitos"** num `tasks.md` com 8 tasks `[P]` escrevendo no mesmo arquivo. A quarta versão acertou. **`0 conflitos` lê como sucesso** — é por isso que o fixture ruim é obrigatório.

---

## Achado

Um achado por **par** colidente, por arquivo compartilhado:

```
parallel-collision: tasks.md:{linha da segunda task}: T-07 e T-09 são [P] no mesmo nível e escrevem em core/scripts/run/gate.cjs
```

Três tasks `[P]` no mesmo arquivo produzem **três** achados (os três pares), não um. Cada par é uma decisão de sequenciamento distinta.

---

## Emitter

- **Produtor:** `soma spec-lint <spec-dir>`
- **Quando emitido:** segundo dos dois checks

---

## Consumers

| Consumidor | O que faz |
|---|---|
| `spec-lint.cjs` | agrega achados |
| Orquestrador antes de despachar wave | decide o que pode ir em paralelo sem `isolation: "worktree"` |

---

## Corpus de selftest (AC-10) — os DOIS lados são obrigatórios

**Conhecido-RUIM** (TEM que acusar):

1. duas `[P]` sem dependência entre si, mesmo arquivo → 1 achado
2. três `[P]` sem dependência, mesmo arquivo → **3** achados (todos os pares)
3. duas `[P]` compartilhando **um** de vários arquivos → 1 achado nomeando só o compartilhado
4. **o fixture de regressão**: o `tasks.md` que fez o validador de 2026-08-15 dizer "0 conflitos" com 8 `[P]` no mesmo arquivo. Este fixture existe para provar que o bug do auto-alcance não voltou

**Conhecido-BOM** (TEM que ficar quieto):

5. duas tasks no mesmo arquivo, **nenhuma** `[P]` → zero achados
6. duas tasks no mesmo arquivo, uma `[P]` e outra não → zero achados
7. duas `[P]` no mesmo arquivo onde **B depende de A** → zero achados (níveis diferentes)
8. duas `[P]` no mesmo arquivo onde B alcança A por **caminho transitivo** (B→C→A) → zero achados
9. `tasks.md` cuja tabela de Foundation não tem coluna `depends_on` → parseia sem lançar, zero achados espúrios

O caso 8 é o que o fecho transitivo compra. O caso 9 é o que quebra um parser por índice de coluna.

---

## Contract Test Stub

```javascript
// @spec AC-08
// @spec AC-09
// @contract CONTRACT-CHECK-PARALLEL-01

describe('CONTRACT-CHECK-PARALLEL-01', () => {
  it('SENSIBILIDADE: os 4 fixtures ruins acusam, com a contagem exata de pares', () => {});
  it('ESPECIFICIDADE: os 5 fixtures bons ficam em zero', () => {});
  it('REGRESSÃO: o tasks.md que produziu "0 conflitos" em 2026-08-15 agora acusa', () => {
    // o bug era ler o proprio id como dependencia — auto-alcance derrubava a condicao 3
  });
  it('três [P] no mesmo arquivo → 3 achados (pares), não 1', () => {});
  it('dependência transitiva B→C→A não é colisão', () => {});
  it('tabela sem coluna depends_on parseia por nome de coluna, não por índice', () => {});
});
```
