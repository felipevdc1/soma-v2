'use strict';
/**
 * lib/spec-lint/checks/heading-near-miss.cjs — AC-01 (spec 019) stub.
 *
 * "WHEN um heading de artefato normativo se parecer com um critério de
 * aceite e não casar a forma canônica, THEN o sistema SHALL emitir um
 * achado nomeando o heading e o arquivo."
 *
 * This is a T-AC01 RED-phase stub — same convention `parallel-collision.cjs`
 * used before T-07 (see that file's own header comment): a check module
 * with the right shape (name, scope, run) that always returns
 * `{ status: 'ran', findings: [] }`. The real detection logic (trigger
 * regex, canonical-form regex, fenced-block exclusion, quickstart.md
 * scope exclusion) is Commit 3 (GREEN) of this same dispatch.
 *
 * Article II HARD: RED phase. Every "known-bad" assertion in
 * contract-check-heading-near-miss.test.cjs is RED by design until GREEN
 * lands; the "known-good" assertion already passes today because a stub
 * that finds nothing trivially agrees with "find nothing".
 *
 * @spec [SPEC:AC-01]
 * @task T-AC01 (dispatch avulso, AC-01 da spec 019)
 */
module.exports = {
  name: 'heading-near-miss',
  scope: { artifacts: ['spec.md', 'plan.md', 'tasks.md', 'contracts/'], retroactive: false },
  run(ctx) {
    return { status: 'ran', findings: [] };
  },
};
