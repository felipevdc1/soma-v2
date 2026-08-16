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
