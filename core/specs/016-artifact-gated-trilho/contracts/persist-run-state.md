# Contract: Artifact — Durable Run State

**Contract ID:** CONTRACT-RUN-STATE-02
**spec_ref:** [SPEC:AC-03] [SPEC:AC-04] [SPEC:AC-08] [SPEC:AC-11]
**Created:** 2026-08-15

---

## Artifact Path

```
{projeto}/.soma/run-state-{runId}.json
```

**Migração, não greenfield.** Hoje o state vive em `/tmp/soma-state-{sessionId}.json` (`soma-run.md` §0.2, linhas 37-57). Duas mudanças: o local passa a ser o projeto, e a chave passa a ser `runId` em vez de `sessionId` — é o que torna o `--resume` possível de outra sessão (AC-04).

---

## Payload

`soma-state/v2` é **superset estrito de `soma-state/v1.0`**: todos os 22 campos do v1.0 permanecem, com o mesmo nome e a mesma semântica. Acrescenta dois.

```json
{
  "$schema": "soma-state/v2",

  "runId": "run-260815-2340-a1b2c3",
  "sessionId": "<sid da sessão que criou — informativo, NÃO é chave>",
  "startedAt": "2026-08-15T23:40:00.000Z",
  "currentState": "STEP_3_FOUNDATION",
  "previousState": "STEP_2_TASKS",
  "lastTransitionAt": "2026-08-15T23:44:12.000Z",
  "featureSlug": "016-artifact-gated-trilho",
  "specPath": "core/specs/016-artifact-gated-trilho/spec.md",
  "planPath": "core/specs/016-artifact-gated-trilho/plan.md",
  "tasksPath": "core/specs/016-artifact-gated-trilho/tasks.md",
  "contractsDir": "core/specs/016-artifact-gated-trilho/contracts",
  "teammateNamePrefix": "soma-016-artifact-gated-trilho",
  "activeDispatchIds": [],
  "failureCountsByStep": {},
  "fixLoopIterations": 0,
  "snapshots": [],
  "humanGatesApproved": { "gate1_spec": { "approved": true }, "gate2_deploy": { "approved": false } },
  "constitutionVersion": "1.2.1",
  "constitutionSnapshotPath": "/tmp/soma-constitution-run-260815-2340-a1b2c3.md",
  "lastSuccessfulState": "STEP_2_TASKS",
  "baselineSha": "2929f50",
  "pausedDiagnostic": null,

  "decisions": [
    {
      "ts": "2026-08-15T23:41:00.000Z",
      "actor": "felipe",
      "decision": "gate1_approved",
      "rationale": "spec 016 aprovada sem cortes"
    }
  ],
  "reports": [
    {
      "step": "STEP_2_TASKS",
      "status": "pass",
      "path": ".soma/reports/run-260815-2340-a1b2c3/STEP_2_TASKS-report.json",
      "finished_at": "2026-08-15T23:44:12.000Z"
    }
  ]
}
```

**Campos novos no v2:**

| Campo | Tipo | Obrigatório | Restrições |
|---|---|---|---|
| `decisions` | array de object | sim (pode ser vazio) | Cada item: `ts` (ISO), `actor` (string não-vazia), `decision` (string não-vazia), `rationale` (string). **Append-only** — nunca reescrever entrada existente |
| `reports` | array de object | sim (pode ser vazio) | Cada item: `step`, `status`, `path`, `finished_at`. Append-only. É o histórico de tentativas; o arquivo de report em disco guarda só a última |

**Campos v1.0:** inalterados. Um leitor de v1.0 que ignore campos desconhecidos continua funcionando.

---

## Emitter

- **Produtor:** `soma run state` (escrita atômica `write tmp → mv`, comportamento que o v1.0 já especifica e que **deve ser preservado**)
- **Quando:** na criação do run e a cada transição de estado

---

## Consumers

| Consumidor | O que faz |
|---|---|
| `soma run resume --run {runId}` | Reconstitui o run a partir de `reports[]` + `lastSuccessfulState` |
| `soma run gate` | Lê `currentState` e o report correspondente |
| `hooks/spec-completeness-gate.cjs` | **Já lê `specPath`/`tasksPath` do state hoje** — a migração de local não pode quebrar isso |
| Humano / auditoria | `decisions[]` responde "quem decidiu o quê e por quê" sem depender do scrollback |

⚠️ **Consumidor existente que a migração não pode quebrar:** o `spec-completeness-gate.cjs` resolve `specPath` lendo o state. Se o local mudar e o hook continuar procurando em `/tmp`, ele passa a emitir `WARN: specPath missing` e **deixa de bloquear** — degradação silenciosa, exatamente a classe de defeito desta fase. Coberto por task própria.

---

## Retenção (AC-12)

7 dias após o run atingir `DONE` — a mesma janela que o `soma-run.md` §16 já pratica para o state file. Uma regra só, aplicada a state, reports e dispatches.

---

## Modo legado (AC-08)

Projeto sem `.soma/` roda pelo caminho anterior, com warning nomeando o que está degradado. Ausência de `.soma/` **nunca** é erro fatal.

---

## Versionamento (AC-11)

Ignore **seletivo** no `.gitignore`, na seção "SOMA runtime artifacts" que já existe:

```gitignore
.soma/reports/
.soma/dispatches/
.soma/run-state-*.json
.soma.lock
```

`.soma/install-state.json` **permanece rastreado** — é artefato de bootstrap do qual o fluxo de install distribuído depende.

---

## Contract Test Stub

```javascript
// @spec AC-03
// @spec AC-04
// @spec AC-08
// @spec AC-11
// @contract CONTRACT-RUN-STATE-02

describe('CONTRACT-RUN-STATE-02', () => {
  it('v2 é superset de v1.0: os 22 campos originais sobrevivem com mesma semântica', () => {
    // carregar um state v1.0 real → migrar → todo campo presente e igual
  });

  it('escrita é atômica: interrupção no meio não deixa state truncado', () => {
    // verificar que a escrita passa por tmp + rename
  });

  it('CONTEÚDO: resume retoma do último step com report pass, de sessão DIFERENTE', () => {
    // reports[] com 1A..5 pass, currentState STEP_6
    // resume com sessionId diferente → reentra em STEP_6, não re-executa 1A..5
  });

  it('decisions[] e reports[] são append-only', () => {
    // segunda escrita não sobrescreve entrada anterior
  });

  it('projeto sem .soma/ → modo legado com warning, sem erro fatal', () => {});

  it('spec-completeness-gate continua achando specPath após a migração', () => {
    // regressão do consumidor existente — a migração não pode silenciar o hook
  });

  it('.gitignore cobre runtime mas NÃO install-state.json', () => {
    // git check-ignore nos 4 padrões + confirmar install-state rastreado
  });
});
```
