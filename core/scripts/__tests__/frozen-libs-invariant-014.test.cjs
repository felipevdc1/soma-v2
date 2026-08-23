'use strict';
/**
 * frozen-libs-invariant-014.test.cjs — AC-07 invariant: frozen libs sha256 matches baseline f3c2f0b
 *
 * Verifies that the 3 frozen libs in core/scripts/lib/ are byte-identical to their
 * baseline values at main f3c2f0b (Article XII HARD constraint).
 *
 * One test per lib (fail LOUDLY with before/after sha256 on drift).
 *
 * @spec [SPEC:AC-07] [T-10] [run-260508-0841-fb4dce]
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Baseline shas at f3c2f0b (main) — Article XII HARD constraint
const FROZEN_BASELINES = {
  'core/scripts/lib/anchored-blocks.cjs': '6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f',
  'core/scripts/lib/manifest.cjs':        '08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462',
  'core/scripts/lib/template-engine.cjs': 'f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b',
};

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

for (const [relPath, baseline] of Object.entries(FROZEN_BASELINES)) {
  test(`AC-07 [T-10] frozen lib ${path.basename(relPath)} sha256 matches baseline f3c2f0b`, () => {
    const fullPath = path.join(REPO_ROOT, relPath);
    const content = fs.readFileSync(fullPath);
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    assert.strictEqual(
      actual,
      baseline,
      `Frozen lib ${relPath} drifted.\n  Expected: ${baseline}\n  Actual:   ${actual}`
    );
  });
}
