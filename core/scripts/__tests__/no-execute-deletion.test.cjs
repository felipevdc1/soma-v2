'use strict';
/**
 * no-execute-deletion.test.cjs — AC-13: .no-execute orphan eliminated
 *
 * Verifies that:
 * 1. No .no-execute references exist in core/scripts/ runtime code.
 * 2. The lab orphan file ~/.soma-v2/.no-execute has been deleted.
 *
 * Historical context: .no-execute was a guard file used in early soma-v2
 * development to prevent accidental execution. It was removed from source
 * but the lab file persisted at ~/.soma-v2/.no-execute. This test closes
 * AC-13 by asserting the orphan is gone and no runtime code references it.
 *
 * NOTE: The original test 2 scanned ~/.claude/hooks/ for .no-execute refs.
 * That scan was env-dependent (devs with legacy hooks would fail unrelated to
 * v2.2 code). Removed in v2.2.1 (Bucket B) — AC-13 spec wording only mandates
 * absence in core/ runtime code and removal of the lab file, not user hook dirs.
 *
 * @spec [SPEC:AC-13] [T-30] [015-soma-install]
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Run grep -rn for pattern in dir, excluding __tests__/ sub-directory.
 * Returns stdout string. Throws if grep errors (exit > 1).
 * Returns '' if exit 1 (no matches).
 */
function grepDir(pattern, dir, excludeDir) {
  const args = ['-rn', pattern];
  if (excludeDir) args.push(`--exclude-dir=${excludeDir}`);
  args.push(dir);
  const r = spawnSync('grep', args, { encoding: 'utf8' });
  if (r.status === 0) return r.stdout;
  if (r.status === 1) return ''; // no matches
  throw new Error(`grep failed (exit ${r.status}): ${r.stderr}`);
}

test('AC-13: no .no-execute references in core/scripts/ runtime code', () => {
  // Exclude __tests__/ — test files themselves reference .no-execute in comments + assertions.
  // The invariant is about RUNTIME code (lib/, *.cjs scripts outside __tests__/) not test assertions.
  const scriptsDir = path.join(REPO_ROOT, 'core/scripts');
  const result = grepDir('.no-execute', scriptsDir, '__tests__');
  assert.equal(result.trim(), '', `Found .no-execute references in core/scripts/ runtime code:\n${result}`);
});


test('AC-13: ~/.soma-v2/.no-execute lab file deleted', () => {
  const labFile = path.join(process.env.HOME, '.soma-v2', '.no-execute');
  assert.equal(fs.existsSync(labFile), false, `Lab orphan ${labFile} should NOT exist`);
});
