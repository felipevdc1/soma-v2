# Piso de ruído — specs 001 a 015

**Medido em:** 2026-08-16
**Task:** T-10
**Comando:** `soma spec-lint core/specs/{NNN}-*/` para cada uma das 15

O `spec.md` da 017 declara, no Out of Scope, que **silêncio nessas 15 não é promessa** — elas nunca tinham sido varridas. Este documento é a medição que aquele parágrafo prometia, e o resultado não é o que o número bruto sugere.

---

## O número bruto, e por que ele é mentira

```
001..015   →   0 achados em todas as 15
```

**Esse zero é vácuo.** Rodando o parser de contexto contra as 15: **247 tasks lidas, 0 marcadas `[P]`, 0 pares avaliados.** O `parallel-collision` não teve um único candidato para examinar, e o `cli-surface` saiu `skipped` em todas (nenhuma tem a cerca — opt-in funcionando como projetado).

Zero achados porque não há defeito e zero achados porque o check é cego produzem a **mesma saída**. Distinguir os dois exigiu perguntar quantos pares o check chegou a avaliar — e a resposta foi nenhum.

---

## Causa: divergência de formato entre gerações de spec

| Geração | Como marca paralelismo | Specs |
|---|---|---|
| Antiga | `\| T-02 \| [P] Write contract test...` — **sem crase** | 001-015 |
| Atual | `` \| T-02 \| `[P]` Contract test... `` — **com crase** | 016, 017 |

O `context.cjs` testa `/`\[P\]`/`, exigindo crase. Resultado: **204 ocorrências reais de `[P]` lidas como zero**, e o check estruturalmente cego em **14 das 16 specs** do repositório.

A regra veio do contrato `check-parallel-collision.md`, que dizia *"presença do literal `` `[P]` `` no início da coluna Description"*. Foi escrita olhando apenas a 016. É a sexta lacuna de contrato desta spec, e a mais grave — as outras cinco produziam erro visível; esta produz **silêncio**, e silêncio lê como aprovação.

A **013-cbm-deprecation** não tem `tasks.md` — não é defeito, é spec sem fase de tasks.

---

## O que aparece quando o parser enxerga

Simulação com `[P]` aceito **com ou sem** crase, mesma regra de colisão das 3 condições:

```
168 tasks [P] com arquivo declarado | 1208 pares avaliáveis | 99 colisões
```

Distribuídas em **5 specs**: 003, 007, 009, 010, 015.

**Mas as 99 não são 99 defeitos.** Amostragem crítica:

| Spec | Arquivo compartilhado | Leitura |
|---|---|---|
| 015 | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | **Path real.** 10 tasks `[P]` sobre o mesmo arquivo — colisão plausivelmente genuína |
| 003 | `scripts/lib/module-inference.cjs` | **Path real.** Mesmo padrão |
| 010 | `hooks/capture-defer-gate.cjs + test` | **Prosa na coluna `files`**, não lista de paths. O `+ test` não é arquivo |
| 009 | `adapters/{cursor, aider` | **Expansão de chaves partida ao meio** pelo split de vírgula. `adapters/{cursor, aider, codex}` virou dois pseudo-arquivos |

---

## Conclusão: são dois defeitos empilhados, não um

1. **Parser cego ao `[P]` sem crase.** Bug objetivo, conserto de uma linha. Sem ele, nenhuma medição das specs antigas significa coisa alguma.
2. **A coluna `files` das specs antigas é prosa, não lista de paths.** Consertar só o item 1 faz o check enxergar — e despejar dezenas de falso-positivos vindos de `+ test`, `(test in ...)` e expansões de chave partidas.

Consertar 1 sem tratar 2 **transforma cegueira em ruído**, que é a troca que esta spec passou o dia inteiro recusando: foi o motivo de o `path-exists` ser cortado e de o `cli-surface` ser estreitado por D-017-01.

**Tratamento proposto para o item 2**: uma entrada da coluna `files` só conta como arquivo se **parecer path** — sem espaço, sem parêntese, sem `+`, e contendo `/` ou extensão conhecida. Entrada que não passa é **ignorada**, não vira achado. Isso preserva os paths reais de 015 e 003 e descarta a prosa de 010 e 009 sem allowlist e sem convenção nova.

---

## Estado declarado

**O piso de ruído das specs 001-015 permanece não medido de forma útil**, e este documento diz exatamente por quê. O número honesto hoje não é "0 achados" — é **"o check não olhou"**.

O `spec.md` continua correto ao não prometer silêncio nessas 15. A diferença é que agora existe o número que faltava, e ele aponta trabalho concreto em vez de uma lacuna vaga.
