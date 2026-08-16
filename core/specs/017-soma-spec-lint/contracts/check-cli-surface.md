# Contract: Check — cli-surface

**Contract ID:** CONTRACT-CHECK-CLI-SURFACE-01
**spec_ref:** [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07]
**Created:** 2026-08-16

---

## Módulo

```
core/scripts/lib/spec-lint/checks/cli-surface.cjs
```

```javascript
module.exports = {
  name: 'cli-surface',
  run(ctx),   // -> { status: 'ran'|'skipped', reason?, findings: Finding[] }
};
```

`ctx` conforme `plan.md` §"Interface de check". O módulo **não lê o disco** — tudo que precisa está em `ctx.artifacts`.

---

## Autoridade

O bloco cercado com o info-string `soma-cli-surface` dentro do `plan.md` da spec sob análise:

````
```soma-cli-surface
soma spec-lint <spec-dir>
```
````

**Gramática de cada linha do bloco:**

| Forma | Significado |
|---|---|
| `soma <sub> <verbo>` | verbo declarado |
| `<token>` sem hífen, após o verbo | subverbo posicional (ex.: `dispatch-record begin`) |
| `--flag <valor>` | flag **obrigatória** para aquele verbo |
| `[--flag <valor>]` | flag **opcional** |
| `<arg>` sem hífen, em maiúscula ou minúscula | argumento posicional obrigatório |
| `a\|b\|c` | enumeração de valores aceitos |

Duas linhas com o mesmo verbo declaram **duas formas alternativas** do mesmo verbo — uma invocação satisfaz o check se casar com qualquer uma delas.

---

## Opt-in

| Situação | `status` | Consequência |
|---|---|---|
| `plan.md` tem o bloco `soma-cli-surface` | `ran` | check executa contra todos os artefatos |
| `plan.md` não tem o bloco | `skipped` | `reason: "plan.md sem bloco soma-cli-surface"`, zero achados |
| `plan.md` ausente | `skipped` | `reason: "plan.md ausente"` |
| Bloco presente mas vazio | `ran` | qualquer invocação encontrada vira achado de verbo desconhecido |

**Medido em 2026-08-16:** dos 16 `plan.md` do repo, 1 tem seção de superfície de CLI. Sem opt-in, 15 specs acenderiam à toa. O opt-in é o que separa este check de um gerador de ruído.

---

## Detecção

Varre `ctx.artifacts` procurando invocações do binário declarado na cerca (o primeiro token de cada linha da superfície, ex.: `soma`).

**A fronteira entre "comando" e "texto sobre comando" é tipográfica, não semântica** — duas regras, e só elas:

**D-017-01 — só cerca é varrida.** Um bloco cercado cujo info-string **não** seja `text` contém coisa que alguém vai rodar, e portanto é afirmação sobre a superfície. Tudo o mais — **crase inline incluída** — é menção, nunca invocação. Uma cerca `text` é dado que o documento está *exibindo*.

**D-017-02 — `--help` e `--version` não são verbos.** Logo após o binário, são universais do dispatcher e nunca produzem achado de verbo desconhecido.

Ambas foram fixadas em 2026-08-16 a partir de medição, não de intuição. O linter rodado contra a própria 017 devolveu **10 achados, todos falso-positivo, todos crase inline em prosa**: a linha de tabela `` | `soma <sub> <verbo>` | verbo declarado | `` virava "verbo desconhecido `<sub>`"; o título `` ## Superfície de CLI do `soma spec-lint` `` virava "posicional ausente"; a frase *"o corpus item 2 testa `soma spec-lint` sem o `<spec-dir>`"* — que **descreve** um caso de teste — virava achado. No outro sentido, o `quickstart.md` da 016, que é onde os defeitos reais moravam, escreve **todas** as invocações como linha nua dentro de cerca `bash`. A distinção separa exatamente os dois grupos.

Sem essas regras, um documento não consegue **falar sobre** invocação sem ser denunciado por ela — que é a mesma patologia estrutural que tirou o `path-exists` desta spec. A diferença é que aqui ela tem cura, porque a classe de verdadeiro-positivo mora do outro lado da fronteira.

⚠️ **Consequência para o corpus**: fixture de invocação inválida vai **dentro de cerca executável**. Escrita em crase inline, ela deixa de ser vista — e um fixture ruim que não dispara é um teste que mente.

| Divergência | Mensagem |
|---|---|
| Verbo não declarado na superfície | `` verbo desconhecido '{verbo}' — a superfície declara: {lista} `` |
| Subverbo não declarado | `` subverbo desconhecido '{sub}' para '{verbo}' `` |
| Flag obrigatória ausente | `` '{verbo}' exige {--flag}, ausente aqui `` |
| **Argumento posicional obrigatório ausente** | `` '{verbo}' exige o posicional {<arg>}, ausente aqui `` |
| Flag não declarada | `` flag '{--flag}' não declarada para '{verbo}' `` |
| Valor fora da enumeração | `` '{valor}' fora dos aceitos para {--flag}: {a\|b\|c} `` |

> A linha do **posicional** foi acrescentada em 2026-08-16, depois que o executor da T-04 esbarrou nela: o corpus item 2 testa `soma spec-lint` sem o `<spec-dir>`, que é posicional, e a tabela só tinha template para flag. Ele **sinalizou em vez de escolher em silêncio**, e essa é a razão de a linha existir — sem ela, cada implementador inventaria a sua mensagem. Mesmo defeito que apareceu duas vezes na spec 016.

Uma invocação pode gerar **mais de um achado** (verbo certo, duas flags erradas → dois achados). Colapsar em um só esconderia trabalho.

---

## Emitter

- **Produtor:** `soma spec-lint <spec-dir>`, que instancia este módulo via `lib/spec-lint/context.cjs`
- **Quando emitido:** primeiro dos dois checks, por ordem determinística de saída

---

## Consumers

| Consumidor | O que faz |
|---|---|
| `spec-lint.cjs` | agrega `findings` e alimenta o rodapé com `status` |
| Prova AC-11 | espera que o `--mark-done` do quickstart histórico da 016 apareça aqui |

---

## Corpus de selftest (AC-10) — os DOIS lados são obrigatórios

**Conhecido-RUIM** (o check TEM que acusar). As invocações vão em bloco cercado de propósito: são **dados de teste**, não invocações que este documento faz, e escrevê-las em crase inline faria o próprio linter acusá-las quando varresse esta spec.

```text
1. verbo inexistente        soma run mark-done --step X      (superfície não declara `mark-done`)
2. obrigatória ausente      soma spec-lint                    (falta o <spec-dir> posicional)
3. flag não declarada       soma spec-lint <dir> --format json
4. subverbo errado          soma run dispatch-record start    (superfície declara begin/end)
```

**Conhecido-BOM** (o check TEM que ficar quieto):

5. invocação exata da superfície
6. invocação com a flag **opcional** presente, e outra com ela ausente — as duas passam
7. duas formas alternativas do mesmo verbo declaradas, invocação casando com a segunda
8. prosa mencionando o nome do verbo **sem** invocá-lo (ex.: "o verbo `gate` decide a transição")
9. `plan.md` sem a cerca → `skipped`, e **zero** achados mesmo com invocação divergente presente

O caso 8 é o que separa este check de um `grep`. O caso 9 é o AC-06 e é onde a primeira implementação vai errar.

---

## Contract Test Stub

```javascript
// @spec AC-05
// @spec AC-06
// @spec AC-07
// @contract CONTRACT-CHECK-CLI-SURFACE-01

describe('CONTRACT-CHECK-CLI-SURFACE-01', () => {
  it('SENSIBILIDADE: os 4 fixtures ruins produzem achado, cada um nomeando o token ofensor', () => {});
  it('ESPECIFICIDADE: os 5 fixtures bons produzem zero achado', () => {});
  it('sem cerca no plan.md → status skipped com reason, e zero achados', () => {});
  it('uma invocação com duas flags erradas produz DOIS achados, não um', () => {});
  it('menção em prosa ao nome do verbo não é invocação', () => {});
  it('flag opcional presente e ausente: ambas passam', () => {});
});
```
