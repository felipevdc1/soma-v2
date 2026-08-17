# Contract: Artifact — Dispatch Record

**Contract ID:** CONTRACT-DISPATCH-RECORD-03
**spec_ref:** [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-12]
**Created:** 2026-08-15

---

## Artifact Path

```
{projeto}/.soma/dispatches/{runId}/{taskId}/
├── prompt.md        — o prompt exato enviado ao agente
├── output.md        — a saída exata que voltou
└── metadata.json    — modelo, SHA base, timestamps, ACs referenciados
```

`{taskId}` é o ID da task como aparece no `tasks.md` (ex: `T-03`). Retentativa do mesmo `taskId` grava em `{taskId}/attempt-{n}/`, preservando a anterior — Article VI, zero deleção.

**Escopo (`D-F2-01`):** produzido pelos steps do `soma-run` que despacham agentes — `STEP_3_FOUNDATION`, `STEP_4_WAVES`, `STEP_7_INTEGRATE`, `STEP_9_FIX_LOOP`. O command `/dispatch` de `~/.claude/commands/` é live-only e está **fora** deste contrato.

---

## Payload — `metadata.json`

```json
{
  "schema": "soma-dispatch-record/v1",
  "run_id": "run-260815-2340-a1b2c3",
  "task_id": "T-03",
  "attempt": 1,
  "model": "sonnet",
  "base_sha": "2929f50",
  "started_at": "2026-08-15T23:50:00.000Z",
  "finished_at": "2026-08-15T23:58:30.000Z",
  "ac_refs": ["AC-01", "AC-02"],
  "executor_agent": "soma-016-artifact-gated-trilho-T-03",
  "result": "done"
}
```

**Field constraints:**

| Campo | Tipo | Obrigatório | Restrições |
|---|---|---|---|
| `schema` | string | sim | Literal `"soma-dispatch-record/v1"` |
| `run_id` | string | sim | Casa o run-state corrente |
| `task_id` | string | sim | Existe no `tasks.md` do run |
| `attempt` | number | sim | Inteiro ≥ 1 |
| `model` | string | sim | Não-vazio. **Model pinning é obrigatório** (Amendment 1.1.0) — omissão herda o modelo da sessão principal e custa 2-10× |
| `base_sha` | string | sim | SHA do HEAD no momento do dispatch |
| `started_at` / `finished_at` | string | sim | ISO 8601 |
| `ac_refs` | array de string | sim | Pode ser vazio para task `[FOUNDATION]`/`[WIRING]` |
| `executor_agent` | string | sim | Nome do agente. **É a chave do invariante AC-06** |
| `result` | string | sim | Um de `"done"`, `"failed"`, `"rejected"` |

### O que `end` valida, e o que não valida (fechado em 2026-08-17)

As restrições da tabela acima misturam duas naturezas, e a coluna não distingue — achado da executora da T-10, que implementou umas e não outras e **sinalizou em vez de deixar a diferença implícita no código**.

**Validado — coerência local, custo zero:**
- forma do payload: `schema` literal, tipos, `model` não-vazio, `attempt` inteiro ≥ 1, `result` no enum
- **`run_id` e `task_id` do metadata casam com o `--run` e o `--task` da invocação**, e `attempt` casa com `--attempt`

Esta última é a que fechava um buraco de integridade: sem ela era possível gravar `metadata.json` com `task_id: "T-05"` **dentro do diretório de `--task T-09"`**, e o artefato mentiria sobre a própria localização. Um registro de proveniência que pode mentir sobre a que task pertence não serve pra auditar nada — que é a única razão de este contrato existir.

**NÃO validado, de propósito:**
- *"`task_id` existe no `tasks.md` do run"* — exigiria parsear o `tasks.md`, e o `dispatch-record` passaria a depender do formato de um documento que ele não possui. O `spec-lint` já é o dono desse parsing.
- *"`run_id` casa o run-state corrente"* no sentido de **existir** um run-state — o `dispatch-record` grava proveniência de dispatch, que pode acontecer antes do state existir. Casar com o flag da CLI, sim; exigir state inicializado, não. É a diferença que o verbo `report` resolveu no sentido oposto, e de propósito: lá o append **é** no state, aqui não.

A tabela acima descreve o **formato pretendido**; esta seção descreve o que o código **impõe**. Onde as duas divergirem, esta seção é a que corresponde ao comportamento real.

---

## Invariante executor ≠ validador (AC-06)

`executor_agent` existe para tornar o invariante **verificável em artefato**, não em memória do orquestrador.

Quando o `STEP_5_VALIDATE` monta a validação da task `{taskId}`, ele lê `metadata.json` daquela task e recusa a atribuição se o validador proposto for igual ao `executor_agent` registrado. A recusa é registrada no report do step (CONTRACT-STEP-REPORT-01).

Consequência de design: sem o run-dir, o invariante dependeria do orquestrador lembrar quem executou o quê — que é exatamente o tipo de julgamento fuzzy que esta fase remove.

---

## Emitter

- **Produtor:** os steps do `soma-run` que despacham, via `soma run dispatch-record`
- **Quando:** `prompt.md` é gravado **antes** do dispatch; `output.md` e `metadata.json` ao retorno, **antes** de registrar o resultado da task

Gravar o prompt antes tem propósito: se o agente morrer ou a sessão cair, o run-dir ainda mostra o que foi pedido.

### Superfície de CLI (fixada em 2026-08-15)

Duas fases, porque o artefato nasce em dois momentos — antes e depois do dispatch:

```
soma run dispatch-record begin [--run <runId>] --task <taskId> [--attempt <n>] --prompt-file <path>
soma run dispatch-record end   [--run <runId>] --task <taskId> [--attempt <n>] --output-file <path> --metadata-file <path>
```

> **Correção de 2026-08-17 — `--run` é opcional.** Esta seção escrevia `--run` **sem** colchetes enquanto o bloco ` ```soma-cli-surface ` do `plan.md` escrevia **com**. Duas autoridades discordando sobre a mesma flag, e nada detecta: o `spec-lint` checa deriva entre o `plan.md` e os exemplos, não contradição entre um contrato e o `plan.md`. A executora da T-10 seguiu esta seção (mais específica) e implementou obrigatório; o achado é dela.
>
> **O `plan.md` ganha, e não por hierarquia — por coerência.** `report`, `state` e `gate` resolvem o `runId` pelo `.soma.lock` quando omitido, e a nota do `plan.md` diz que o `resume` é *"o único caso em que resolver pelo lock seria errado"*. "Único" exclui o `dispatch-record`. Fazer dele o segundo verbo a exigir `--run` criaria uma inconsistência que ninguém decidiu e que só apareceria pra quem usa a CLI à mão.
>
> Os contract tests da T-04 **nunca omitem `--run`**, então a mudança é puramente aditiva — nenhum teste existente muda de resultado.

- `begin` grava `prompt.md`. `attempt` 1 vai direto em `{taskId}/`; `attempt >= 2` em `{taskId}/attempt-{n}/`
- `end` valida o metadata, grava `output.md` + `metadata.json`, e é **tudo-ou-nada**: metadata inválido não deixa escrita parcial
- Módulo do invariante: `run/validator-invariant.cjs` exporta `checkValidatorAssignment({ metadataPath, proposedValidator }) -> { allowed, reason }`

**Procedência desta seção:** o contrato original não definia a superfície de CLI nem a assinatura do módulo. O executor da T-04 precisou de uma para escrever o contract test, propôs esta, e **sinalizou a decisão em vez de deixá-la implícita no código de teste**. Promovida a contrato aqui para que T-10 e T-11 implementem contra a mesma forma — se ficasse só no cabeçalho do arquivo de teste, cada task inventaria a sua e a divergência só apareceria na integração.

Se T-10/T-11 tiverem motivo para divergir, a mudança é **aqui primeiro**, e os testes de T-04 ajustam flags/assinatura — nunca lógica.

---

## Consumers

| Consumidor | O que faz |
|---|---|
| `STEP_5_VALIDATE` | Lê `executor_agent` para aplicar o invariante AC-06 |
| Humano / auditoria | Diff entre o que foi pedido e o que voltou, sem depender de scrollback |
| Recovery Protocol | `attempt` + `result` mostram o histórico de retry/escalate da task |

---

## Retenção (AC-12)

7 dias após `DONE` — mesma janela do state e dos reports.

---

## Contract Test Stub

```javascript
// @spec AC-05
// @spec AC-06
// @spec AC-12
// @contract CONTRACT-DISPATCH-RECORD-03

describe('CONTRACT-DISPATCH-RECORD-03', () => {
  it('dispatch materializa os 3 arquivos antes de registrar o resultado', () => {});

  it('CONTEÚDO: prompt.md contém o prompt EXATO enviado, não um resumo', () => {
    // comparação byte-a-byte com o que foi passado ao dispatch
  });

  it('prompt.md existe mesmo quando o agente morre sem retornar', () => {
    // gravado antes do dispatch, não depois
  });

  it('metadata sem `model` → rejeitado (model pinning é obrigatório)', () => {});

  it('AC-06: validador == executor_agent registrado → atribuição recusada', () => {
    // e a recusa aparece no report do step, com o nome do agente
  });

  it('AC-06: validador != executor_agent → atribuição aceita', () => {
    // guarda contra o invariante virar "recusa tudo"
  });

  it('retentativa preserva o attempt anterior em vez de sobrescrever', () => {});
});
```
