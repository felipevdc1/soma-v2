'use strict';
/**
 * lib/spec-lint/checks/red-only-coverage.cjs — AC-02 (spec 019).
 *
 * "Given um tasks.md cuja coluna Description contém a etiqueta 'RED: ' /
 * When essa task é a ÚNICA linha cujo spec_ref referencia um dado AC / Then
 * a cobertura NÃO conta esse AC como coberto, e o lint nomeia o par
 * AC↔task."
 *
 * Article II HARD: RED phase. This is (this commit) a stub that always
 * returns `{ status: 'ran', findings: [] }` — same convention
 * `parallel-collision.cjs` used before T-07 and `heading-near-miss.cjs`
 * used before its own real logic landed. See
 * contract-check-red-only-coverage.test.cjs for the RED/GREEN pair this
 * stub is meant to fail against.
 *
 * @spec [SPEC:AC-02]
 * @task T-AC02 (dispatch avulso, AC-02 da spec 019)
 */

module.exports = {
  name: 'red-only-coverage',
  scope: { artifacts: ['tasks.md'], retroactive: false },
  run(ctx) {
    return { status: 'ran', findings: [] };
  },
};
