# Contract: Artifact — Step Report

**Contract ID:** CONTRACT-STEP-REPORT-01
**spec_ref:** [SPEC:AC-01] [SPEC:AC-02] [SPEC:AC-10]
**Created:** 2026-08-15

---

## Artifact Path

```
{projeto}/.soma/reports/{runId}/{step}-report.json
```

`{step}` é o nome do estado, verbatim, como aparece nos blocos `## N. STEP_X` do `soma-run.md` (ex: `STEP_3_FOUNDATION`). Um arquivo por step por run. Reentrada no mesmo step **sobrescreve** o report anterior — o histórico de tentativas vive em `reports[]` do run-state, não em arquivos versionados.

---

## Payload

```json
{
  "schema": "soma-step-report/v1",
  "run_id": "run-260815-2340-a1b2c3",
  "step": "STEP_3_FOUNDATION",
  "status": "pass",
  "started_at": "2026-08-15T23:40:00.000Z",
  "finished_at": "2026-08-15T23:44:12.000Z",
  "artifacts": ["core/specs/016-artifact-gated-trilho/spec.md"],
  "metrics": {},
  "notes": ""
}
```

**Field constraints:**

| Campo | Tipo | Obrigatório | Restrições |
|---|---|---|---|
| `schema` | string | sim | Literal `"soma-step-report/v1"`. Valor diferente → report inválido |
| `run_id` | string | sim | Não-vazio. Deve casar o `runId` do run-state corrente |
| `step` | string | sim | Deve ser um dos nomes de estado conhecidos do `soma-run` |
| `status` | string | sim | Exatamente um de `"pass"`, `"fail"`, `"blocked"`. Qualquer outro valor → inválido |
| `started_at` | string | sim | ISO 8601 |
| `finished_at` | string | sim | ISO 8601, `>= started_at` |
| `artifacts` | array de string | sim | Pode ser vazio. Paths relativos à raiz do projeto |
| `metrics` | object | sim | Pode ser vazio. Livre por step |
| `notes` | string | sim | Pode ser vazio |
| `failure_reason` | string | **sim quando `status != "pass"`** | Não-vazio. Ausência com status `fail`/`blocked` → report inválido |

---

## Emitter

- **Produtor:** `soma run report --step {STEP} --status {pass\|fail\|blocked} [--reason ...]`
- **Quando emitido:** ao concluir um step, **antes** de qualquer transição de estado

---

## Consumers

| Consumidor | O que faz com o artefato |
|---|---|
| `soma run gate --step {próximo}` | Lê o report do step anterior e decide transição (exit 0 / exit 2) |
| `soma run resume --run {runId}` | Determina o último step com `status: "pass"` para retomar |
| Humano / auditoria | Diff do que cada step declarou ter produzido |

---

## Gate semantics (AC-02, AC-10)

`soma run gate --step {X}` avalia o report do step **anterior** e sai com:

| Situação | Exit | Estado resultante |
|---|---|---|
| Report existe, válido, `status: "pass"` | `0` | transição liberada |
| Report ausente | `2` | `PAUSED_DIAGNOSTIC`, mensagem nomeia o report faltante |
| Report presente com `status` `fail` ou `blocked` | `2` | `PAUSED_DIAGNOSTIC`, mensagem cita `failure_reason` |
| Report presente mas **inválido** contra o schema | `2` | `PAUSED_DIAGNOSTIC` — **inválido nunca é tratado como pass** |
| Report ilegível (permissão, JSON corrompido) | `2` | `PAUSED_DIAGNOSTIC` com causa `"report não legível: {motivo}"` |

**Invariante AC-10:** nenhuma condição de erro, ausência ou impossibilidade de leitura produz exit `0`. O único caminho para `0` é um report presente, válido e `pass`.

---

## Side Effects

- Grava o arquivo de report atomicamente (`write tmp → mv`) — **T-06, entregue em `b6d9d34`**
- Faz append da entrada correspondente em `reports[]` do run-state (CONTRACT-RUN-STATE-02) — **PENDENTE, dono designado em 2026-08-16**
- ~~Faz append de evento no log JSONL do run~~ — **OUT OF SCOPE desde 2026-08-17**, ver `spec.md` §Out of Scope

> **Estado dos três side effects, fechado em 2026-08-16 durante a Wave 2.** A T-06 entregou o primeiro e **parou nos outros dois em vez de improvisar** — decisão certa, e foi ela que expôs o que segue.
>
> **(b) append em `reports[]`.** É responsabilidade do verbo `report`, não do `state`: o `plan.md:16` diz que o CLI "grava em `.soma/reports/{runId}/` **e atualiza `reports[]` no run-state**", e a linha 15 **deste** contrato depende disso — reentrada no mesmo step sobrescreve o arquivo, então sem o append o histórico de tentativas se perde **em silêncio**. O problema é que o `tasks.md` declara T-06 `depends_on: T-02`, não T-08, e as duas são `[P]` na mesma wave: o `report.cjs` precisa do `state.cjs` e nada no grafo diz isso. O `spec-lint` não pega — ele checa colisão de arquivo, não dependência semântica. **Resolução**: a T-08 expõe uma API de append chamável por `require`, respeitando o append-only e devolvendo resultado inspecionável em vez de lançar; uma task corretiva liga o `report.cjs` a ela **depois** que a T-08 mergear, mantendo `report.cjs` com um dono só. A falha da ligação **nunca** pode sair `0` silencioso.
>
> **(c) log JSONL do run — RESOLVIDO em 2026-08-17: Out of Scope declarado.** Era referenciado aqui e em `spec.md` §Non-Functional/*Monitoring* e **definido em lugar nenhum** — sem schema, sem caminho, sem contrato. Nenhum dos 13 ACs o exige: AC-02 e AC-10 se satisfazem com exit code e conteúdo do report, que é onde o motivo estruturado já vive. **A evidência que fechou foi empírica**: o smoke da T-19 passou os 4 critérios do §F mais o caminho `SONAR_CLEAN` sem o log existir. A entrada completa, com o caminho de reversão, está em `spec.md` §Out of Scope. **A executora da T-06 acertou em parar nele** em vez de inventar um formato — se tivesse improvisado, teríamos hoje um log com schema inventado que alguém trataria como contrato.

---

## Contract Test Stub

```javascript
// @spec AC-01
// @spec AC-02
// @spec AC-10
// @contract CONTRACT-STEP-REPORT-01

// ⚠️ Estes testes NÃO podem se limitar a conformidade estrutural.
// Um report que valida contra o schema e descreve a coisa errada é falso-verde —
// ver plan.md §"A restrição de design que veio da execução".

describe('CONTRACT-STEP-REPORT-01', () => {
  it('emite report válido e só então permite a transição', () => {
    // emitir com status pass → arquivo existe, valida, gate exit 0
  });

  it('CONTEÚDO: step que falhou produz status fail + failure_reason, e o gate bloqueia POR ISSO', () => {
    // emitir com status fail → gate exit 2, stderr cita o failure_reason específico
    // (não basta bloquear: tem que bloquear pela razão certa)
  });

  it('report ausente → gate exit 2 (prosa "done" do agente não conta)', () => {
    // nenhum arquivo emitido → exit 2
  });

  it('report com status inválido ("done", "ok", "success") → exit 2, não pass', () => {
    // status fora do enum é inválido, e inválido nunca vira pass
  });

  it('status fail sem failure_reason → report inválido → exit 2', () => {
    // campo condicional obrigatório
  });

  it('report com JSON corrompido → exit 2 com causa de não-legibilidade', () => {
    // AC-10: impossibilidade de ler é REJECT, nunca pass
  });
});
```
