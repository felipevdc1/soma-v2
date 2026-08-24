<!-- soma-stsd:start -->
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
- Rode checks determinísticos antes da auditoria integrada. Um segundo revisor só é permitido para risco independente declarado no plano; ambos leem o mesmo commit imutável.

- Treat the user's intent/spec as source of truth. Do not silently invent requirements.
- If ambiguity affects implementation, surface it early or mark the assumption explicitly.
- Preserve traceability: user intent -> acceptance criteria -> tasks -> tests -> proof.
- Prefer test-first or at least proof-first execution. For bug fixes, reproduce or identify the failing behavior before claiming a fix.
- Before parallel or broad edits, decompose into independent tasks and identify dependencies.
- Validate each work unit with concrete evidence: commands run, tests passed, files changed, screenshots or logs when relevant.
- Before final response, do a lightweight SONAR pass: architecture, modules, tests, config, and spec adherence.
- Never report "done" from vibe alone. Evidence precedes status.

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
<!-- soma-stsd:end -->
