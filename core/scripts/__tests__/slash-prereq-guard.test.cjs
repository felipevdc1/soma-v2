'use strict';
/**
 * slash-prereq-guard.test.cjs — T-26 RED phase
 *
 * Article II HARD: RED phase — written FIRST, must FAIL before Prereq stanzas
 * are added to the three slash command source files.
 *
 * Asserts each of the 3 modified slash command source files contains the
 * literal string "soma install" in its body post-edit, closing AC-12.
 *
 * @spec [SPEC:AC-12]
 * @task T-26
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..', '..');

const SLASH_COMMANDS = [
  'core/adapters/claude/commands/soma-run.md',
  'core/adapters/claude/commands/specify.md',
  'core/adapters/claude/commands/plan-sdd.md',
];

for (const relPath of SLASH_COMMANDS) {
  const absPath = path.join(REPO_ROOT, relPath);
  const fileName = path.basename(relPath);

  test(`AC-12 ${fileName} contains "soma install" remediation`, () => {
    const content = fs.readFileSync(absPath, 'utf8');
    assert.match(
      content,
      /soma install/,
      `${fileName} must reference "soma install" in body (prereq remediation)`
    );
  });
}
