'use strict';
/**
 * lib/spec-lint/registry.cjs — the two checks, in deterministic output order.
 *
 * Registered once, complete, in T-02. The Wave 2 tasks (T-06, T-07) are `[P]`
 * and each owns exactly one checks/*.cjs file — if they also had to register
 * themselves here, both would write to this file and collide, which is
 * literally the defect class `parallel-collision` exists to catch.
 *
 * After T-02, nobody else edits this file (nor spec-lint.cjs).
 *
 * @task T-02
 */

const cliSurface = require('./checks/cli-surface.cjs');
const parallelCollision = require('./checks/parallel-collision.cjs');

module.exports = [cliSurface, parallelCollision];
