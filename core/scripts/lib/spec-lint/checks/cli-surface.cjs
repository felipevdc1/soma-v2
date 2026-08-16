'use strict';
/**
 * lib/spec-lint/checks/cli-surface.cjs — STUB (T-02 foundation).
 *
 * Real logic (parse the `soma-cli-surface` fence in plan.md, diff cited
 * invocations against the declared surface) is T-06. This stub exists so
 * `registry.cjs` can resolve immediately and the Wave 2 [P] tasks each own
 * exactly one file instead of all writing to registry.cjs.
 *
 * @spec [SPEC:AC-05] [SPEC:AC-06] [SPEC:AC-07]
 * @contract CONTRACT-CHECK-CLI-SURFACE-01
 * @task T-02 (stub) / T-06 (implementation)
 */

module.exports = {
  name: 'cli-surface',
  run(ctx) {
    return { status: 'ran', findings: [] };
  },
};
