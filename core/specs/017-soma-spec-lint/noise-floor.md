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

## Estado declarado (histórico — antes do fix)

**O piso de ruído das specs 001-015 permanecia não medido de forma útil**, e a seção anterior deste documento dizia exatamente por quê. O número honesto não era "0 achados" — era **"o check não olhou"**.

O `spec.md` estava correto ao não prometer silêncio nessas 15. A diferença é que a medição acima produziu o número que faltava, e ele apontou trabalho concreto em vez de uma lacuna vaga — que virou AC-15, AC-16 e a T-13.

---

## Medição pós-fix (T-13) — 2026-08-16

`context.cjs` agora reconhece `[P]` **com ou sem** crase (AC-15), e a coluna `files` só conta uma entrada como arquivo se ela **tiver forma de path** — sem espaço, sem parêntese, sem `+`, sem chave `{`/`}` (guarda extra além da redação literal do AC-16, ver nota abaixo), e contendo `/` ou uma extensão de arquivo conhecida (AC-16).

Comando: `soma spec-lint core/specs/{NNN}-*/` para cada uma das 15, medido diretamente (não simulado):

```
001   0    002   0    003  21    004   0    005   0
006   0    007   1    008   0    009   0    010   0
011   0    012   0    013   0*   014   0    015  36
```

`*` 013-cbm-deprecation não tem `tasks.md` — não é defeito, é spec sem fase de tasks (mesma nota da medição original).

**Total: 58 achados em 3 specs (003, 007, 015).** Todos os 58 são classificáveis individualmente:

| Spec | Achados | Arquivo(s) compartilhado(s) | Classificação | Motivo |
|---|---|---|---|---|
| 003 | 21 | `scripts/lib/module-inference.cjs`, `scripts/init.cjs` | **Real** | Paths genuínos, citados limpos (sem prosa colada) em 8 tasks `[P]` no mesmo nível (T-03/T-04/T-05/T-06/T-07/T-08/T-09/T-12/T-13) — a mesma leitura do módulo `module-inference.cjs` |
| 007 | 1 | `~/.claude/hooks/lib/auto-load-modules.cjs` | **Real** | T-12 e T-13, ambas `[P]`, ambas dependem só de T-02, mesmo arquivo de implementação citado limpo |
| 015 | 36 | `core/scripts/install.cjs`, `core/scripts/__tests__/install.test.js` | **Real** | 10 tasks `[P]` da Wave 2a/2b (T-07..T-16) compartilhando o orquestrador `install.cjs`; o grafo `depends_on` já exclui os pares conectados (ex.: T-08→T-10 não aparece) — os 36 restantes são pares genuinamente desconectados no mesmo nível |
| 009 | 0 (era candidato a ruído) | `adapters/{cursor` (fragmento fantasma) | **Ruído eliminado** | T-04/T-05 citam `adapters/{cursor,aider,chatgpt-desktop}/...json\|.md` — o split de vírgula sem consciência de chaves produzia o fragmento `adapters/{cursor` idêntico nas duas, e esse fragmento passa despercebido pela redação literal do AC-16 (sem espaço/parêntese/+, mas CONTÉM `/`). Fixture 13 do corpus reproduz exatamente este caso |
| 010 | 0 (era candidato a ruído) | `hooks/capture-defer-gate.cjs (+ anotação)` | **Ruído eliminado** | Toda entrada de `files` nessa spec tem `+ test`/`(NEW)` colado ao path — cai no filtro por espaço/parêntese/+ da própria redação do AC-16, sem precisar da guarda extra |

Nenhum dos 58 achados restantes depende de artefato de parsing — são todos apontamentos de arquivo real citado sem prosa, compartilhado por duas ou mais tasks `[P]` no mesmo nível de `depends_on`. **Nenhuma classificação ficou pendente.**

**Nota sobre a guarda extra (`{`/`}`)**: a redação literal do AC-16 — "sem espaço, sem parêntese, sem `+`, contendo `/` ou extensão conhecida" — não bastava para o caso real da 009: o fragmento `adapters/{cursor` sobrevive a essa regra (não tem espaço/parêntese/+, e tem `/`), e sem tratamento à parte T-04 e T-05 fabricariam uma colisão pelo fragmento fantasma. Rejeitar `{`/`}` foi acrescentado durante a implementação e é o que fecha esse caso — documentado em `context.cjs` e coberto pelo fixture 13. É a sétima lacuna de contrato desta spec, encontrada contra o corpus real (009) antes de virar bug em produção, não depois.

**16 e 17 seguem em 0 achados** (`soma spec-lint core/specs/016-artifact-gated-trilho` e `core/specs/017-soma-spec-lint`), verificado após o fix — condição de aceitação da T-13.

## Estado declarado

O piso de ruído das specs 001-015 **agora está medido de forma útil**: 58 achados, todos classificados individualmente como reais, em 3 specs. As outras 12 (mais a 013, sem `tasks.md`) seguem em zero — silêncio real, não silêncio de cegueira, porque a medição confirma que o check avaliou pares em todas (ex.: 003 e 015 tinham candidatos de sobra e os encontrou; 001/002/004-006/008/011/012/014 tinham candidatos e não colidiram; 009/010 tinham candidatos e o filtro de forma-de-path corretamente descartou os que eram prosa).

Isto **ainda não é uma promessa de correção do processo histórico dessas specs** — 003/007/015 já foram executadas e mergeadas; o linter não reabre trabalho passado. É a confirmação de que o número deixou de ser "o check não olhou" e passou a ser um veredito real sobre o texto como está escrito hoje.
