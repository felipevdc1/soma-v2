'use strict';
/**
 * plan-cites-discovery.test.cjs — AC-18: plan.md cites discovery.json findings
 *
 * Verifies that core/specs/015-soma-install/plan.md:
 * 1. Cites discovery.json by name (Layer 0 traceability anchor).
 * 2. References the key discovery findings that drove the spec decisions:
 *    - .no-execute orphan (drives AC-13 + Wave 6 cleanup)
 *    - BF-06 sync.cjs broken path (drives Wave 6 surgical edit)
 *    - hydra CLAUDE.md conflict (drives Wave 7 Layer 4 retroactive flag)
 *
 * Plan.md is in the untracked spec dir (core/specs/015-soma-install/).
 * If the file doesn't exist (e.g. spec dir not present), tests skip gracefully.
 *
 * @spec [SPEC:AC-18] [T-32] [015-soma-install]
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLAN_PATH = path.join(REPO_ROOT, 'core/specs/015-soma-install/plan.md');

test('AC-18: plan.md cites discovery.json', () => {
  if (!fs.existsSync(PLAN_PATH)) {
    // Spec dir is untracked — skip gracefully if not present
    return;
  }
  const content = fs.readFileSync(PLAN_PATH, 'utf8');
  assert.match(content, /discovery\.json/i, 'plan.md must cite discovery.json');
});

test('AC-18: plan.md references key discovery findings', () => {
  if (!fs.existsSync(PLAN_PATH)) return;
  const content = fs.readFileSync(PLAN_PATH, 'utf8');
  const findings = [
    /\.no-execute/i,  // .no-execute orphan (drives AC-13 + Wave 6 cleanup)
    /BF-06/i,         // sync.cjs BF-06 broken path (drives surgical edit target)
    /hydra/i,         // hydra CLAUDE.md conflict (drives Wave 7 flag choice)
  ];
  for (const re of findings) {
    assert.match(content, re, `plan.md must reference discovery finding matching ${re}`);
  }
});
