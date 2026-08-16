'use strict';
/**
 * lib/spec-lint/checks/parallel-collision.cjs — STUB (T-02 foundation).
 *
 * Real logic (consume ctx.tasks, flag [P] tasks at the same dependency
 * level that share a `files` entry) is T-07. This stub exists so
 * `registry.cjs` can resolve immediately and the Wave 2 [P] tasks each own
 * exactly one file instead of all writing to registry.cjs.
 *
 * @spec [SPEC:AC-08] [SPEC:AC-09]
 * @contract CONTRACT-CHECK-PARALLEL-01
 * @task T-02 (stub) / T-07 (implementation)
 */

module.exports = {
  name: 'parallel-collision',
  run(ctx) {
    return { status: 'ran', findings: [] };
  },
};
