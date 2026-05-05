/**
 * ac-14-validate-foundation-territory.test.cjs — T-21
 * @spec AC-14
 * Step 5 VALIDATE in foundation territory: emits critical findings.
 * DEFERRED to Phase 5+ — skip stub using xtest pattern.
 * Integration with /soma-run Step 5 not yet wired.
 */
'use strict';

const { test, skip } = require('node:test');
const assert = require('node:assert/strict');

// Phase 5+ integration: VALIDATE step in soma-run pipeline
// When a territory contains modules with layer: roots|trunk,
// foundation-check is auto-run and criterion failures become
// severity: critical findings (vs severity: warning in standalone mode).

skip('AC-14 DEFERRED Phase 5+: VALIDATE step emits critical findings for foundation territory', () => {
  // This test requires /soma-run Step 5 integration.
  // Expected behavior when implemented:
  //   - soma-run STEP_5 detects modules with layer: roots|trunk in territory
  //   - Invokes foundation-check internally
  //   - Any criterion fail → finding { severity: 'critical', ... }
  //   - Standalone --foundation-check still emits { severity: 'warning', ... }
  assert.fail('Not yet implemented — Phase 5+ integration required');
});

skip('AC-14 DEFERRED Phase 5+: standalone --foundation-check uses warning severity (not critical)', () => {
  // Contrast: standalone check uses 'warning' severity
  // VALIDATE step in soma-run uses 'critical' severity
  assert.fail('Not yet implemented — Phase 5+ integration required');
});

// Smoke test: verify foundation-check.cjs exists and is loadable (non-deferred)
test('AC-14 PRESENT: foundation-check.cjs is loadable (smoke test for Phase 5+ readiness)', () => {
  const path = require('node:path');
  const SCRATCH_REPO = path.resolve(__dirname, '../..');
  const libPath = path.join(SCRATCH_REPO, 'scripts/lib/foundation-check.cjs');
  let mod;
  try {
    mod = require(libPath);
  } catch (e) {
    assert.fail(`foundation-check.cjs must be loadable for Phase 5+ readiness. Error: ${e.message}`);
  }
  assert.ok(typeof mod === 'object', 'foundation-check.cjs must export an object');
  assert.ok(typeof mod.runFoundationCheck === 'function', 'runFoundationCheck must be exported');
});
