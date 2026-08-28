# Pre-remediation Triage Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate the approved pre-remediation triage rule to the Constitution, Claude adapter, and Codex adapter with one focused contract test, without adding a CLI gate or global token budget.

**Architecture:** Add one normative, read-only triage contract to the Constitution and version it in a 1.4.0 amendment. Repeat the same contract in the Claude orchestration reference and the anchored Codex block; the coordinator owns dispatch/checkpoint/handoff while the executor only parses allowlisted evidence and writes the triage report.

**Tech Stack:** Markdown, Node.js built-in `node:test`, SHA-256, existing anchored-block and manifest conventions.

---

## Files and boundaries

- Create `core/scripts/__tests__/pre-remediation-triage-gate.test.cjs`: focused textual contract test; no product execution.
- Modify `core/docs/constitution.md`: add Article XI and bump the three required version markers to 1.4.0.
- Create `core/docs/constitution-amendments/1.4.0-pre-remediation-triage.md`: approved amendment with explicit Article XI diff and no CLI/token-budget change.
- Modify `core/adapters/claude/references/soma-run-orchestration.md`: add the executor triage contract before `STEP_1A_SPECIFY`, preserving coordinator boundary and existing dispatch-record lifecycle.
- Modify anchored block `block.codex.AGENTS.soma-stsd` in `core/adapters/codex/AGENTS.md`: add the same normative contract; recompute only its anchor SHA.
- Modify `core/manifest.json`: refresh hashes for changed installable source files using the existing manifest tool; do not alter unrelated entries.

## Verbatim normative text

The executor must paste this exact block, without paraphrase, into Article XI in the Constitution, the 1.4.0 amendment, the Claude reference, and the Codex `block.codex.AGENTS.soma-stsd` block:

```text
## Article XI — Triagem pré-remediação

Antes de qualquer remediação, o coordinator dispara triagem quando `totalFailures >= 10` ou quando o predicado herdado/exceção é completo: a full suite não é zero, a comparação semântica registra `shared >= 1`, a integração seria bloqueada pelo gate e o operador considera integrar sem tornar a full suite verde. A triagem usa exatamente um agente, uma tentativa e somente evidências existentes na allowlist: arquivos sob `.soma/diagnostics/<source-run>/` e artefatos de dispatch, checkpoint ou handoff referenciados por esse run. O executor usa apenas parsers locais determinísticos, não executa remediação e só pode escrever o relatório `.soma/diagnostics/<runId>/pre-remediation-triage.json`.

São proibidos rede, mutação Git, package manager, test runner, build, lint, install, product CLI, execução do produto e qualquer arquivo escrito além do relatório. Dispatch, checkpoint e handoff são ações posteriores do coordinator; não há novo gate no CLI e o limite global de tokens e a full suite ficam fora do escopo desta regra.

Cada identidade falha é mapeada exatamente uma vez. A chave de cluster é `(componente proprietário, assinatura normalizada, causa candidata)`; causas só são independentes quando não compartilham essa chave nem uma dependência causal documentada. Cada cluster registra `count`, identidades, prova com `path` e `sha256`, confiança `VERIFIED`, `INFERENCE` ou `HYPOTHESIS`, causa e acoplamento `low`, `medium` ou `high`. Cada prova contém identidade normalizada e `expected`/`actual` ou assinatura de erro; a soma dos counts fecha `totalFailures` e `unmappedCount` é zero.

O relatório mínimo contém `runId`, `sourceRunId`, `inputs`, `totalFailures`, `clusters`, `unmappedCount`, `decision` e `blockers`; cada input registra `path` e `sha256`. Nove falhas não disparam o gatilho numérico; dez falhas disparam. `shared=0` não satisfaz o gatilho herdado; `shared=1` satisfaz quando os demais predicados também são verdadeiros. `GO` só é válido com no máximo três causas independentes, todas conhecidas, com acoplamento `low` ou `medium`, e `unmappedCount=0`. Acoplamento `high`, confiança `HYPOTHESIS` ou `unmappedCount>0` força `DEFER`; qualquer outra condição fora dos limites também força `DEFER`. `DEFER` exige checkpoint e handoff duráveis e proíbe correção automática pelo executor.

Tabela decisória de entrada/saída (linhas normativas completas):

| Entrada | Saída |
|---|---|
| `totalFailures=9` e predicado herdado completo ausente | triagem não obrigatória |
| `totalFailures=10` | `TRIAGE_REQUIRED` |
| `shared=0` | predicado herdado não satisfeito |
| `shared>=1`, full suite não zero, integração bloqueada e exceção considerada | `TRIAGE_REQUIRED` |
| até 3 causas independentes, todas `low`/`medium`, sem `HYPOTHESIS`, `unmappedCount=0` | `GO` |
| 4 ou mais causas, acoplamento `high`, qualquer `HYPOTHESIS` ou `unmappedCount>0` | `DEFER` |
```

### Task 1: Contract test RED

**Files:** Create `core/scripts/__tests__/pre-remediation-triage-gate.test.cjs`.

- [ ] **Step 1: Write the failing focused test.** Insert exactly:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const files = {
  constitution: path.join(ROOT, 'docs', 'constitution.md'),
  amendment: path.join(ROOT, 'docs', 'constitution-amendments', '1.4.0-pre-remediation-triage.md'),
  claude: path.join(ROOT, 'adapters', 'claude', 'references', 'soma-run-orchestration.md'),
  codex: path.join(ROOT, 'adapters', 'codex', 'AGENTS.md'),
};
const read = file => fs.readFileSync(file, 'utf8');
const sources = () => Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));

test('triage contract has both triggers, bounded read-only execution, and no token/CLI gate', () => {
  const s = sources();
  for (const [name, text] of Object.entries(s)) {
    assert.match(text, /10 (?:ou mais|ou ≥|identidades).*falh|falh.*10 (?:ou mais|ou ≥)/i, name);
    assert.match(text, /full suite.*não é zero.*shared.*exceção|shared.*integração.*exceção/i, name);
    assert.match(text, /exatamente um agente.*uma tentativa|1 agente.*1 tentativa/i, name);
    assert.match(text, /allowlist.*evidên|parsers locais determinísticos/i, name);
    assert.match(text, /proib.*(?:rede|mutação Git|package manager|test runner|build|lint|install|product CLI)/i, name);
    assert.match(text, /sem (?:novo )?gate no CLI|não cria.*gate.*CLI/i, name);
    assert.match(text, /limite global de tokens.*fora do escopo|sem.*orçamento global de tokens/i, name);
  }
});

test('triage contract defines deterministic clusters, evidence closure, schema, and decisions', () => {
  const s = sources();
  for (const [name, text] of Object.entries(s)) {
    assert.match(text, /componente proprietário.*assinatura normalizada.*causa candidata/i, name);
    assert.match(text, /independentes.*chave.*dependência causal documentada/i, name);
    assert.match(text, /coupling.*low.*medium.*high|acoplamento baixo.*médio.*alto/i, name);
    assert.match(text, /unmappedCount.*zero|unmappedCount.*0/i, name);
    assert.match(text, /runId.*sourceRunId.*inputs.*totalFailures.*clusters.*decision.*blockers/i, name);
    assert.match(text, /path.*sha256/i, name);
    assert.match(text, /GO.*no máximo três causas.*baixo ou médio|GO.*máximo.*3.*causas/i, name);
    assert.match(text, /HYPOTHESIS.*bloqueia.*GO|causa.*desconhecida.*DEFER/i, name);
    assert.match(text, /DEFER.*checkpoint.*handoff.*correção automática/i, name);
  }
});

test('all three normative surfaces retain coordinator boundary and dispatch-record authority', () => {
  const s = sources();
  for (const [name, text] of Object.entries({ constitution: s.constitution, claude: s.claude, codex: s.codex })) {
    assert.match(text, /coordinator.*(?:dispatch|checkpoint|handoff)|coordinator.*control plane/i, name);
    assert.match(text, /executor.*(?:somente|apenas).*relatório de triagem|executor.*triagem.*read-only/i, name);
    assert.match(text, /dispatch-record/i, name);
    assert.doesNotMatch(text, /triage.*(?:novo comando|gate CLI|token budget global)/i, name);
  }
});

test('triage boundaries are explicit for threshold and inherited predicate cases', () => {
  const s = sources();
  for (const [name, text] of Object.entries(s)) {
    assert.match(text, /Tabela decisória de entrada\/saída \(linhas normativas completas\):/i, name);
  }
});

test('decision table preserves every complete boundary input/output row', () => {
  const expectedRows = [
    '| `totalFailures=9` e predicado herdado completo ausente | triagem não obrigatória |',
    '| `totalFailures=10` | `TRIAGE_REQUIRED` |',
    '| `shared=0` | predicado herdado não satisfeito |',
    '| `shared>=1`, full suite não zero, integração bloqueada e exceção considerada | `TRIAGE_REQUIRED` |',
    '| até 3 causas independentes, todas `low`/`medium`, sem `HYPOTHESIS`, `unmappedCount=0` | `GO` |',
    '| 4 ou mais causas, acoplamento `high`, qualquer `HYPOTHESIS` ou `unmappedCount>0` | `DEFER` |',
  ];
  const s = sources();
  for (const [name, text] of Object.entries(s)) {
    for (const row of expectedRows) assert.match(text, new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm'), name);
  }
});
```

- [ ] **Step 2: Run the RED proof.** Run `node --test core/scripts/__tests__/pre-remediation-triage-gate.test.cjs` from `/Users/felipevdc1/Documents/Codex/2026-08-24/soma-efficient-orchestration-budget`. Expected: FAIL because the 1.4.0 amendment and Article XI contract are absent; do not run the full suite.

### Task 2: Minimal canonical propagation

**Files:** Modify the four canonical documents listed above and refresh `core/manifest.json`.

- [ ] **Step 1: Insert the verbatim normative block, including the complete decision table,** immediately before `## Articles cortados` in `core/docs/constitution.md`, retaining the Article XI heading and adding `(a) Statement`, `(b) Rationale`, `(c) Enforcement mechanism (HARD)`, and `(d) Violation handling)` around the same text. Change the final confirmation exactly from `Constitution v1.3.0 lida; executando sob Articles I-X e XII.` to `Constitution v1.4.0 lida; executando sob Articles I-XII.`
- [ ] **Step 2: Create `core/docs/constitution-amendments/1.4.0-pre-remediation-triage.md`** with header `# Amendment 1.4.0 — Triagem pré-remediação`, `**Status:** APROVADA — Design 2026-08-28`, `**Bump:** 1.3.0 → 1.4.0`, paste the same complete normative block and decision-table rows verbatim, then list propagation and rejected alternatives (new CLI gate, new diagnostic suite, multiple agents/retries, automatic correction, global token criterion).
- [ ] **Step 3: Insert the same complete normative block and decision-table rows verbatim** immediately before `## 1. STEP_1A_SPECIFY` in `core/adapters/claude/references/soma-run-orchestration.md`; keep the exact output path, require `soma run dispatch-record begin --run <runId>` before the Agent and `... dispatch-record end --run <runId>` before transition, and state that checkpoint/handoff remain later coordinator actions.
- [ ] **Step 4: Insert the same complete normative block and decision-table rows verbatim** immediately after the Always-On Habits list inside anchor `block.codex.AGENTS.soma-stsd` in `core/adapters/codex/AGENTS.md`; recompute only that anchor's `sha256` with `core/scripts/lib/anchored-blocks.cjs` conventions.
- [ ] **Step 5: Update the Constitution H1 and date/amendments marker from 1.3.0 to 1.4.0. Refresh only affected `core/manifest.json` hashes with `node core/scripts/manifest.cjs baseline --apply --filter core.constitution` followed by `node core/scripts/manifest.cjs baseline --apply --filter adapter.codex.AGENTS`; each command must report exactly its named entry updated.

### Task 3: GREEN and deterministic focused checks

**Files:** Read the files from Tasks 1–2; no additional source changes unless a focused assertion identifies a mismatch.

- [ ] **Step 1: Run the same contract test.** Run `node --test core/scripts/__tests__/pre-remediation-triage-gate.test.cjs`. Expected: PASS, 4 tests, 0 failures.
- [ ] **Step 2: Run the existing propagation/parity test only.** Run `node --test core/scripts/__tests__/efficient-orchestration-protocol.test.cjs`. Expected: PASS, including manifest and Codex-anchor hash checks; do not run `npm test`, build, lint, install, or any diagnostic/full suite.
- [ ] **Step 3: Self-review.** Check every numbered acceptance criterion in `docs/superpowers/specs/2026-08-28-pre-remediation-triage-gate-design.md` against Tasks 1–2; search the plan and changed docs for placeholder markers, vague imperatives, a new CLI gate, global token budget, executor-owned checkpoint/handoff, or any second agent/retry. Confirm all names are exactly `GO`, `DEFER`, `VERIFIED`, `INFERENCE`, `HYPOTHESIS`, `low|medium|high`, and `unmappedCount`.
- [ ] **Step 4: Commit the implementation after proof.** After the focused checks pass, run `git status --short`, preserve pre-existing untracked files `.soma/` and `docs/superpowers/plans/2026-08-28-soma-integration-diagnostic.md`, then `git add core/docs/constitution.md core/docs/constitution-amendments/1.4.0-pre-remediation-triage.md core/adapters/claude/references/soma-run-orchestration.md core/adapters/codex/AGENTS.md core/scripts/__tests__/pre-remediation-triage-gate.test.cjs core/manifest.json && git commit -m "feat: add pre-remediation triage contract"`. Expected: one implementation commit containing only the listed files; no push.

## Self-review result

Coverage maps AC1–AC3 to Task 1/2 trigger and safety assertions; AC4–AC6 to the cluster/evidence/schema assertions; AC7–AC8 to the six exact decision-table rows and the fourth contract test; AC9 to the four-surface parity test and amendment; AC10 to exact version text, out-of-scope text, and focused commands. No placeholders remain in this plan, and the coordinator/executor boundary plus existing dispatch-record authority are preserved.
