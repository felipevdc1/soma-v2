'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VALIDATOR = path.join(__dirname, '..', 'lib', 'phase4a-historical-oracle-validator.cjs');
const EXACT_TOTALS = { tests: 198, pass: 198, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
const expectedFiles = [
  'lib-anchored-blocks.test.cjs',
  'lib-manifest.test.cjs',
  'doctor.contract.test.cjs',
  'doctor.drift-detection.test.cjs',
  'doctor.read-only.test.cjs',
  'lib-template-engine.test.cjs',
  'lib-agents-md-injector.test.cjs',
  'init.contract.test.cjs',
  'init.greenfield.test.cjs',
  'init.redirect.test.cjs',
  'init.with-agents-md.test.cjs',
  'init.placeholders.test.cjs',
  'init.dry-run.test.cjs',
  'init.sample-pipeline.test.cjs',
  'init.exit-codes.test.cjs',
  'phase3-regression.test.cjs',
].map(file => path.join(__dirname, file));
const unrelatedExistingFiles = [
  'ac-01-dry-run-preserved.test.cjs',
  'ac-01-module-add-creates.test.cjs',
  'ac-01-project-schema-migration.test.cjs',
  'ac-02-module-add-exists.test.cjs',
  'ac-02-module-layer-field.test.cjs',
  'ac-02-snapshot-pre-write.test.cjs',
  'ac-03-foundation-check-output.test.cjs',
  'ac-03-manifest-schema.test.cjs',
  'ac-03-promote-hypothesis-to-active.test.cjs',
  'ac-04-criterion-1-padroes.test.cjs',
  'ac-04-promote-already-active.test.cjs',
  'ac-04-summary-preview.test.cjs',
  'ac-05-criterion-2-contracts.test.cjs',
  'ac-05-noop-already-synced.test.cjs',
  'ac-05-promote-not-found.test.cjs',
  'ac-06-criterion-3-leakage.test.cjs',
].map(file => path.join(__dirname, file));

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

test('historical oracle validator rejects 16 unrelated unique existing files', () => {
  const result = { exitCode: 0, signal: null, ...EXACT_TOTALS };

  assert.equal(new Set(unrelatedExistingFiles).size, 16);
  assert.equal(unrelatedExistingFiles.every(fs.existsSync), true);
  assert.throws(
    () => loadValidator()({ expectedFiles: unrelatedExistingFiles, fileExists: fs.existsSync, result }),
    error => error && error.code === 'HISTORICAL_ORACLE_FILESET_INVALID',
  );
});

test('historical oracle validator rejects a duplicate canonical file', () => {
  const duplicateFiles = [...expectedFiles.slice(0, -1), expectedFiles[0]];

  assert.throws(
    () => loadValidator()({ expectedFiles: duplicateFiles, fileExists: () => true }),
    error => error && error.code === 'HISTORICAL_ORACLE_FILESET_INVALID',
  );
});
