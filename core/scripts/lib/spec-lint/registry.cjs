'use strict';
/**
 * lib/spec-lint/registry.cjs — the checks, in deterministic output order.
 *
 * Originally registered once, complete, in T-02 (spec 017: cli-surface,
 * parallel-collision — see those two entries' own header comments for why
 * this file avoided parallel edits during that spec's Wave 2).
 *
 * heading-near-miss (AC-01, spec 019) added by a later, separate dispatch —
 * "nobody else edits this file" only held for T-02's own Wave 2, not
 * forever; each addition here is still a single, sequential edit, never a
 * parallel one, which is what actually matters for the
 * `parallel-collision` defect class this comment originally warned about.
 *
 * @task T-02 / T-AC01
 */

const cliSurface = require('./checks/cli-surface.cjs');
const parallelCollision = require('./checks/parallel-collision.cjs');
const headingNearMiss = require('./checks/heading-near-miss.cjs');

module.exports = [cliSurface, parallelCollision, headingNearMiss];
