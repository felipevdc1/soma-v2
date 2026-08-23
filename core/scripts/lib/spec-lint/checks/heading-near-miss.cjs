'use strict';
/**
 * lib/spec-lint/checks/heading-near-miss.cjs — AC-01 (spec 019).
 *
 * "WHEN um heading de artefato normativo se parecer com um critério de
 * aceite e não casar a forma canônica, THEN o sistema SHALL emitir um
 * achado nomeando o heading e o arquivo."
 *
 * Trigger and canonical regexes are the literal ones the AC text gives —
 * not the hook's own form (spec-test-traceability.cjs:51, which also
 * accepts 0 `#` and a leading `-`/`*`, used for AC *coverage* counting)
 * and not renamed or widened. §0 of the spec measures the two canonical
 * forms as diverging; this check lints against the soma-run.md:51 form
 * only — unifying them is spec 021's job (Out of Scope).
 *
 * Scope: spec.md, plan.md, tasks.md, contracts/*.md. quickstart.md is
 * EXCLUDED on purpose — it carries a real, legitimate walkthrough
 * convention (`## AC-01 — H2 detects...`, `## AC-02 + AC-03: ...`) that
 * would otherwise fire on every one of its section headings. The exclusion
 * is by FILE NAME, never by a hardcoded finding count (the spec's own §0
 * measurement of that count is informational, not a constant to encode).
 *
 * A line inside a fenced ``` block is never swept (fenced-lines.cjs) —
 * this is a design decision made for this dispatch, not literal spec text:
 * a future spec (021) will document the near-miss form inside a fenced
 * example, and without this exclusion the gate would accuse the document
 * that explains the very divergence it lints against. Inline code-span
 * mentions (`` `### AC-01b: ...` `` inside a sentence) need no special
 * case: the per-line `^` anchor already excludes them, since the LINE they
 * sit on starts with prose or table syntax, never `#`.
 *
 * @spec [SPEC:AC-01]
 * @task T-AC01 (dispatch avulso, AC-01 da spec 019)
 */

const { fencedLineNumbers } = require('../fenced-lines.cjs');

// Given literally by the AC-01 text: a line that LOOKS like it declares an
// AC — 1 to 6 `#`, optional leading `-`, optional bold markers, then the
// literal `AC-`.
const NEAR_MISS_TRIGGER_RE = /^\s*#{1,6}\s*-?\s*\*{0,2}AC-/;

// The soma-run.md:51 canonical form — governs how a spec must be written.
// NOT the hook's form (spec-test-traceability.cjs:51); the two diverge
// (§0 of the spec) and this check does not unify them.
const CANONICAL_RE = /^### AC-\d+:/;

function isInScope(file) {
  return file === 'spec.md' || file === 'plan.md' || file === 'tasks.md' || file.startsWith('contracts/');
}

module.exports = {
  name: 'heading-near-miss',
  scope: { artifacts: ['spec.md', 'plan.md', 'tasks.md', 'contracts/'], retroactive: false },
  run(ctx) {
    const findings = [];

    for (const artifact of ctx.artifacts) {
      if (!isInScope(artifact.file)) continue;

      const fenced = fencedLineNumbers(artifact.text);
      const lines = artifact.text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        if (fenced.has(lineNo)) continue;

        const line = lines[i];
        if (NEAR_MISS_TRIGGER_RE.test(line) && !CANONICAL_RE.test(line)) {
          findings.push({
            check: 'heading-near-miss',
            file: artifact.file,
            line: lineNo,
            message: `heading '${line.trim()}' parece um critério de aceite mas não casa a forma canônica ^### AC-\\d+:`,
          });
        }
      }
    }

    return { status: 'ran', findings };
  },
};
