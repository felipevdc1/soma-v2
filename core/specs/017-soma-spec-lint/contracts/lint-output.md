# Contract: Artifact — Lint Output

**Contract ID:** CONTRACT-LINT-OUTPUT-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-03] [SPEC:AC-06]
**Created:** 2026-08-16

---

## Artifact

Não há arquivo. O artefato é a **saída do processo**: linhas em stdout e um exit code. Isto é deliberado — o linter não produz estado, e por isso pode rodar contra qualquer worktree histórico sem sujá-lo.

---

## Payload

Uma linha por achado, em stdout:

```
{check}: {arquivo}:{linha}: {mensagem}
```

Uma linha de rodapé, **sempre emitida**, inclusive quando não há achado:

```
checks executados: {lista}  |  pulados: {lista ou "-"}  |  achados: {n}
```

**Field constraints:**

| Campo | Tipo | Obrigatório | Restrições |
|---|---|---|---|
| `check` | string | sim | Nome do módulo de check. Um de `cli-surface`, `parallel-collision` |
| `arquivo` | string | sim | Path relativo ao `<spec-dir>`. Nunca absoluto — saída absoluta vaza o home do usuário e quebra diff entre máquinas |
| `linha` | inteiro | sim | 1-indexado. `0` é inválido |
| `mensagem` | string | sim | Não-vazia. Descreve a divergência **concreta**, nomeando o token ofensor |
| rodapé `executados` | lista | sim | Nomes separados por `, `. Nunca vazio: ao menos um check sempre roda |
| rodapé `pulados` | lista | sim | Nomes separados por `, `, ou o literal `-` quando nenhum foi pulado |
| rodapé `achados` | inteiro | sim | Igual ao número de linhas de achado emitidas |

---

## Exit codes

| Situação | Exit |
|---|---|
| Zero achados | `0` |
| ≥1 achado | `1` |
| Argumento ausente, `<spec-dir>` inexistente, ou `<spec-dir>` sem `spec.md` | `2` |

Erro de argumento sai **antes** de qualquer check rodar, e não emite rodapé — não houve execução para resumir.

---

## Emitter

- **Produtor:** `soma spec-lint <spec-dir>`
- **Quando emitido:** achados em ordem determinística — por check na ordem `cli-surface`, `parallel-collision`; dentro de cada check, por arquivo e depois por linha. Ordem instável faz diff de saída virar ruído

---

## Consumers

| Consumidor | O que faz com o artefato |
|---|---|
| Humano no terminal | Lê a linha, abre `arquivo:linha` |
| Prova de aceitação (AC-11, AC-12) | Compara conjunto de achados entre estado histórico e estado corrigido |
| Futuro wiring de hook (**fora desta fase**) | Consumiria o exit code |

---

## Side Effects

Nenhum. O linter é read-only: lê os artefatos da spec e escreve em stdout/stderr. Não grava, não emite telemetria, não toca em `.soma/`, e não lê nada fora do `<spec-dir>`.

Ausência de telemetria é decisão desta fase: o log do Article XI está sendo saneado e escrever nele agora atrapalharia aquela medição.

---

## Contract Test Stub

```javascript
// @spec AC-01
// @spec AC-02
// @spec AC-03
// @spec AC-06
// @contract CONTRACT-LINT-OUTPUT-01

describe('CONTRACT-LINT-OUTPUT-01', () => {
  it('spec limpa → exit 0, nenhuma linha de achado, mas rodapé presente', () => {
    // o rodapé sai mesmo com zero achados — é como se distingue "limpo" de "não rodou"
  });

  it('spec com violação → exit 1 e cada achado nomeia check, arquivo e linha', () => {
    // formato exato: "{check}: {arquivo}:{linha}: {mensagem}"
  });

  it('CONTEÚDO: a mensagem nomeia o token ofensor, não só a categoria', () => {
    // "verbo desconhecido 'mark-done'" passa; "invocação inválida" é falso-verde
  });

  it('argumento ausente → exit 2, nenhum check executado, nenhum rodapé', () => {});

  it('<spec-dir> existe mas sem spec.md → exit 2 nomeando o que falta', () => {});

  it('path na saída é relativo ao spec-dir, nunca absoluto', () => {
    // rodar de dois cwd diferentes → saída idêntica
  });

  it('check pulado aparece no rodapé como pulado, não some', () => {
    // AC-06: silêncio de check pulado é indistinguível de silêncio de check limpo
  });

  it('ordem de achados é determinística entre execuções', () => {
    // rodar 2× no mesmo fixture → saída byte-a-byte igual
  });
});
```
