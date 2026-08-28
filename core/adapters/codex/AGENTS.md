<!-- soma-v2:start id=block.codex.AGENTS.codebase-memory-mcp version=2.1.0-draft sha256=de76bf0664923630696399a582630b060a7f002158306b9761868d70b5d3cc5b -->
# Codebase Knowledge Graph (codebase-memory-mcp)

This project uses codebase-memory-mcp to maintain a knowledge graph of the codebase.
ALWAYS prefer MCP graph tools over grep/glob/file-search for code discovery.

## Priority Order
1. `search_graph` — find functions, classes, routes, variables by pattern
2. `trace_call_path` — trace who calls a function or what it calls
3. `get_code_snippet` — read specific function/class source code
4. `query_graph` — run Cypher queries for complex patterns
5. `get_architecture` — high-level project summary

## When to fall back to grep/glob
- Searching for string literals, error messages, config values
- Searching non-code files (Dockerfiles, shell scripts, configs)
- When MCP tools return insufficient results

## Examples
- Find a handler: `search_graph(name_pattern=".*OrderHandler.*")`
- Who calls it: `trace_call_path(function_name="OrderHandler", direction="inbound")`
- Read source: `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`
<!-- soma-v2:end id=block.codex.AGENTS.codebase-memory-mcp -->

<!-- soma-v2:start id=block.codex.AGENTS.hyd-v2 version=2.1.0-draft sha256=1e135e9f494de71fef5923a07fca6d5f2a8132bcfadaa1a7186cf0ddf7941bfc -->
# HYD v2 Cognitive Discipline

Use HYD v2 as the default anti-shallowness loop before planning or implementation on non-trivial work.

## HYD v2 Loop

1. Classify the task type and complexity.
2. Select only the quality dimensions that actually matter.
3. Turn those dimensions into a short, verifiable checklist when planning is useful.
4. State an initial thesis for the approach.
5. Pressure-test that thesis: define ambiguous terms, surface assumptions, look for falsifiers, and identify at least one counterexample, edge case, or failure mode.
6. Revise the approach after the challenge instead of trusting the first fluent answer.
7. Distinguish verified fact, inference, and hypothesis whenever uncertainty matters.

## Operating Rules

- Default to one serious challenge pass, not endless introspection.
- Add a second pass only for high-risk, high-uncertainty, or high-cost work.
- If evidence is cheap, verify instead of speculating.
- For tiny tasks, compress the loop to a lightweight reframe plus one quick challenge.
- Do not stop on a polished answer if the underlying reasoning is still weak.
<!-- soma-v2:end id=block.codex.AGENTS.hyd-v2 -->

<!-- soma-v2:start id=block.codex.AGENTS.soma-stsd version=2.1.0-draft sha256=3bfbc6f37d55726efe8a197fae1d592b72395f04a943d5abba9cedf9745f7842 -->
# SOMA / STSD Operating Lens

Use SOMA v2 as the default execution philosophy for non-trivial work. Treat it as an always-on lens, not mandatory ceremony for tiny commands. Scale the artifacts to the risk and size of the task, but keep the core discipline: spec first, tests tied to acceptance criteria, execution in safe waves, validation before claims, audit before done.

Canonical references, when deeper context is needed:
- `${CLAUDE_HOME}/plans/soma-v2-spec.md`
- `${CLAUDE_HOME}/plans/soma-v2-design.md`
- `${CLAUDE_HOME}/commands/soma-run.md`
- `${CLAUDE_HOME}/commands/specify.md`
- `${CLAUDE_HOME}/commands/plan-sdd.md`
- `${CLAUDE_HOME}/commands/sonar-audit.md`

## Always-On Habits

- **Envelope de orquestração:** cada task tem um executor, no máximo 2 tentativas (inicial + uma correção), um revisor integrado por padrão e no máximo 2 revisores. O prompt exato de um dispatch tem até 8.000 bytes e o retorno conversacional até 4.000 bytes. Execute `soma run dispatch-record begin` antes do spawn com o prompt exato; execute `soma run dispatch-record end` antes da transição com output e metadata. O retorno curto contém status, SHA/artefato, provas e blockers; detalhes ficam em arquivos referenciados. Sem ledger paralelo: use o dispatch-record existente.
- **Stop eficiente:** após uma correção, blocker residual transita para `PAUSED_DIAGNOSTIC` com handoff durável (candidato, provas, finding residual e próxima decisão), sem escalation e sem novo agente automático.
- **Precedência de Recovery:** o Recovery eficiente posterior prevalece sobre qualquer seção Recovery unmanaged anterior no mesmo arquivo.
- Rode checks determinísticos antes da auditoria integrada. Um segundo revisor só é permitido para risco independente declarado no plano; ambos leem o mesmo commit imutável.

- Treat the user's intent/spec as source of truth. Do not silently invent requirements.
- If ambiguity affects implementation, surface it early or mark the assumption explicitly.
- Preserve traceability: user intent -> acceptance criteria -> tasks -> tests -> proof.
- Prefer test-first or at least proof-first execution. For bug fixes, reproduce or identify the failing behavior before claiming a fix.
- Before parallel or broad edits, decompose into independent tasks and identify dependencies.
- Validate each work unit with concrete evidence: commands run, tests passed, files changed, screenshots or logs when relevant.
- Before final response, do a lightweight SONAR pass: architecture, modules, tests, config, and spec adherence.
- Never report "done" from vibe alone. Evidence precedes status.

<!-- TRIAGE_CONTRACT_BEGIN -->
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
<!-- TRIAGE_CONTRACT_END -->

## Ceremony Scaling

- Tiny task: answer or execute directly, but still check assumptions and verify if a command/test is cheap.
- Small code change: use a compressed loop: specify intent, implement, test, audit, summarize.
- Medium feature or multi-file change: explicitly map ACs/tasks, run focused tests, do integration sanity, then final audit.
- Large feature, risky refactor, or 3+ independent components: follow the full SOMA flow or propose it before implementation.

## 10-Step Checklist

1. SPECIFY: define what/why, user stories, acceptance criteria, and open questions.
2. PLAN-SDD: derive technical plan, contracts, constraints, and integration strategy.
3. TASKS: break work into dependency-aware tasks with AC references and parallel flags.
4. TEAM: decide execution topology; use agents/parallel work only when useful and safe.
5. FOUNDATION: establish scaffold, shared contracts, configs, and baseline tests.
6. WAVES: execute independent tasks in dependency-safe waves.
7. VALIDATE: verify each unit with tests, diffs, traceability, and no unsafe deletion.
8. CONSOLIDATE: merge approved work, update project memory/docs when useful, run full sanity.
9. INTEGRATE: wire components together and run integration/smoke checks.
10. SONAR / FIX / COMMIT: audit, fix blocking findings, then finalize with proof.

## Stop Conditions

Pause and re-plan when:
- acceptance criteria are unclear or contradicted;
- tests cannot be tied back to the requested behavior;
- validation fails twice for the same area;
- a fix requires deleting or weakening existing behavior without explicit approval;
- implementation drifts from the spec.
<!-- soma-v2:end id=block.codex.AGENTS.soma-stsd -->

<!-- soma-v2:start id=block.codex.AGENTS.soma-install version=2.2.0 sha256=f9a2a72d76720906ee55ace065fdc82c0f380236dbf8e95d7350610178123586 -->
# Soma Install Skill (Codex)

When user requests "instalar SOMA" / "install soma" (PT or EN, see triggers list below), invoke:
```bash
node ~/.soma-v2/scripts/soma.cjs install <project-path> [flags]
```

## Triggers (NL phrasings — parity with Claude /soma:install)

- "instalar o SOMA neste projeto"
- "instalar SOMA aqui"
- "configurar SOMA neste repo"
- "set up SOMA in this repo"
- "install soma here"
- "soma install"
- "add SOMA to this project"

## Prereqs

- SOMA v2 installed at `~/.soma-v2/` (verify with `ls ~/.soma-v2/scripts/soma.cjs`)
- Node.js ≥ 22 on PATH

## Args (parity with Claude skill)

| Flag | Type | Default | Description |
|---|---|---|---|
| `<project-path>` | string | required | Target project path |
| `--tool` | enum {claude, codex, both} | claude | Which harness adapter |
| `--dry-run` | boolean | false | Preview without writing |
| `--merge-claude-md` | boolean | null | Preserve+append on free-text CLAUDE.md |
| `--replace-claude-md` | boolean | false | Snapshot+replace on free-text CLAUDE.md |
| `--allow-local-edits` | boolean | false | Pass-through to sync escape hatch (intentional drift override) |

## Post-invocation

Emit summary: status (pass/fail/partial), paths created, snapshot ID, recovery hint if exit != 0.
<!-- soma-v2:end id=block.codex.AGENTS.soma-install -->
