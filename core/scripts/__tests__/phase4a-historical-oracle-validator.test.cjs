'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const VALIDATOR = path.join(__dirname, '..', 'lib', 'phase4a-historical-oracle-validator.cjs');
const EXACT_TOTALS = { tests: 198, pass: 198, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
const expectedFiles = Array.from({ length: 16 }, (_, index) => `authoritative-${index + 1}.test.cjs`);

// This is the pre-attempt-2 behavior: it filters absent paths and only checks
// a non-empty cohort, fail=0, and tests=198. The two tests below record its
// false positives before exercising the replacement validator.
function oldValidatorAccepts({ presentFiles, result }) {
  return presentFiles.length > 0 && result.fail === 0 && result.tests === 198;
}

function loadValidator() {
  return require(VALIDATOR).validateHistoricalOracle;
}

test('historical oracle validator rejects a missing authoritative file that the old validator accepts', () => {
  const result = { exitCode: 0, signal: null, ...EXACT_TOTALS };

  assert.equal(oldValidatorAccepts({ presentFiles: expectedFiles.slice(0, -1), result }), true, 'old filtered-file check accepts this invalid cohort');
  assert.throws(
    () => loadValidator()({ expectedFiles, fileExists: file => file !== expectedFiles[15], result }),
    error => error && error.code === 'HISTORICAL_ORACLE_MISSING_FILES',
  );
});

test('historical oracle validator rejects 197 pass plus one skip that the old validator accepts', () => {
  const result = { exitCode: 0, signal: null, tests: 198, pass: 197, fail: 0, skipped: 1, cancelled: 0, todo: 0 };

  assert.equal(oldValidatorAccepts({ presentFiles: expectedFiles, result }), true, 'old loose-total check accepts a skipped test');
  assert.throws(
    () => loadValidator()({ expectedFiles, fileExists: () => true, result }),
    error => error && error.code === 'HISTORICAL_ORACLE_TOTALS_INVALID',
  );
});

test('historical oracle validator rejects nonzero and null child exit status', () => {
  for (const exitCode of [1, null]) {
    assert.throws(
      () => loadValidator()({ expectedFiles, fileExists: () => true, result: { exitCode, signal: null, ...EXACT_TOTALS } }),
      error => error && error.code === 'HISTORICAL_ORACLE_EXIT_INVALID',
    );
  }
});
