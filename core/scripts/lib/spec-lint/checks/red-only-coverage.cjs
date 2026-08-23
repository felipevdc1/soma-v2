'use strict';
/**
 * lib/spec-lint/checks/red-only-coverage.cjs — AC-02 (spec 019).
 *
 * "Given um tasks.md cuja coluna Description contém a etiqueta 'RED: ' /
 * When essa task é a ÚNICA linha cujo spec_ref referencia um dado AC / Then
 * a cobertura NÃO conta esse AC como coberto, e o lint nomeia o par
 * AC↔task."
 *
 * NOT validateRedPhase (spec-test-traceability.cjs:196-215) — there RED is
 * GOOD (`status: 'verified'`, operationalizes Article II HARD: a test file
 * committed before its implementation). Here RED is INSUFFICIENT as the
 * SOLE proof of coverage for a given AC. Different objects: that hook asks
 * "was this test committed RED-first?"; this check asks "does an AC have
 * any coverage evidence besides a task that never left its RED phase?".
 * Conflating the two would punish exactly the tasks that comply with
 * Article II.
 *
 * Régua: /\bRED:\s/, case-sensitive, applied to the Description cell —
 * given literally by the AC-02 text, not the hook's own RED-detection
 * regex. "Única" = the count of tasks whose spec_ref (after
 * context.cjs's AC-02 interval expansion, `[SPEC:AC-01..AC-12]` -> every
 * AC in the range) contains a given AC is exactly 1.
 *
 * Validated against the real corpus (§0 of the spec, reproduced by this
 * dispatch): the `RED:` label appears in exactly 4 tasks repo-wide (016
 * T-01, 017 T-01/T-02, 018 T-01), and none of the other 7 "RED"-shaped
 * strings that convive in the repo (`RED phase`, `RED commit`,
 * `validateRedPhase`, `SOMA_RED_PHASE_STRICT`, commit-prefix `red:`, `RED
 * genuíno`, `expected-RED`) match this régua — the fixture 02 in this
 * check's own corpus plants all 7 as a specificity guard.
 *
 * @spec [SPEC:AC-02]
 * @task T-AC02 (dispatch avulso, AC-02 da spec 019)
 */

const RED_LABEL_RE = /\bRED:\s/;

module.exports = {
  name: 'red-only-coverage',
  scope: { artifacts: ['tasks.md'], retroactive: false },
  run(ctx) {
    const tasks = ctx.tasks || [];

    // AC -> tasks (LINES, per the AC text) that reference it, in order of
    // appearance in tasks.md. "Única" (AC-02) means this list has length
    // 1. Dedupe per task before pushing — not observed in the real corpus,
    // but a cell mixing an individual ref with an overlapping interval
    // (`[SPEC:AC-01] [SPEC:AC-01..AC-03]`) would otherwise count one LINE
    // twice, which is not what "única" means.
    const referencingTasksByAc = new Map();
    for (const task of tasks) {
      const uniqueAcs = new Set(task.specRefs || []);
      for (const ac of uniqueAcs) {
        if (!referencingTasksByAc.has(ac)) referencingTasksByAc.set(ac, []);
        referencingTasksByAc.get(ac).push(task);
      }
    }

    const findings = [];
    for (const [ac, referencingTasks] of referencingTasksByAc) {
      if (referencingTasks.length !== 1) continue; // shared AC — some other line proves coverage

      const [task] = referencingTasks;
      if (!RED_LABEL_RE.test(task.description || '')) continue; // single referencer, but not RED-only

      findings.push({
        check: 'red-only-coverage',
        file: 'tasks.md',
        line: task.line,
        message: `${ac} é referenciado só por ${task.id}, que declara parada RED`,
      });
    }

    // Deterministic order: by line, then by AC label — a single interval
    // task (e.g. [SPEC:AC-01..AC-05]) produces several findings that all
    // share a line, so the AC label is the tiebreaker.
    findings.sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
    });

    return { status: 'ran', findings };
  },
};
