'use strict';

const path = require('node:path');

// Fixed Phase 2+3 fixture baseline from Specs 001 tasks T-01..T-08 and
// 002 tasks T-01..T-10. This ordered list is the sole cohort authority.
const PHASE2_AND_3_TEST_FILE_NAMES = Object.freeze([
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
]);

const EXPECTED_FILE_COUNT = PHASE2_AND_3_TEST_FILE_NAMES.length;
const EXACT_TOTALS = Object.freeze({ tests: 198, pass: 198, fail: 0, skipped: 0, cancelled: 0, todo: 0 });

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function historicalOracleFiles(testsDirectory = path.resolve(__dirname, '..', '__tests__')) {
  return PHASE2_AND_3_TEST_FILE_NAMES.map(file => path.join(testsDirectory, file));
}

function sameOrderedFiles(expectedFiles, canonicalFiles) {
  return expectedFiles.length === canonicalFiles.length && expectedFiles.every((file, index) => file === canonicalFiles[index]);
}

function validateHistoricalOracle({ expectedFiles, fileExists, result, testsDirectory }) {
  if (!Array.isArray(expectedFiles) || expectedFiles.length !== EXPECTED_FILE_COUNT || new Set(expectedFiles).size !== EXPECTED_FILE_COUNT) {
    throw validationError('HISTORICAL_ORACLE_FILESET_INVALID', `Historical oracle must declare exactly ${EXPECTED_FILE_COUNT} unique files`);
  }
  if (typeof fileExists !== 'function') {
    throw validationError('HISTORICAL_ORACLE_FILESET_INVALID', 'Historical oracle requires a file existence predicate');
  }

  const missingFiles = expectedFiles.filter(file => !fileExists(file));
  if (missingFiles.length > 0) {
    throw validationError('HISTORICAL_ORACLE_MISSING_FILES', `Historical oracle is missing: ${missingFiles.join(', ')}`);
  }
  if (!sameOrderedFiles(expectedFiles, historicalOracleFiles(testsDirectory))) {
    throw validationError('HISTORICAL_ORACLE_FILESET_INVALID', 'Historical oracle files must exactly match the canonical Phase 2+3 cohort');
  }
  if (result === undefined) return;

  if (result.exitCode !== 0 || result.signal !== null) {
    throw validationError('HISTORICAL_ORACLE_EXIT_INVALID', `Historical oracle child must exit 0 without signal; got exit=${result.exitCode}, signal=${result.signal}`);
  }
  for (const [field, expected] of Object.entries(EXACT_TOTALS)) {
    if (result[field] !== expected) {
      throw validationError('HISTORICAL_ORACLE_TOTALS_INVALID', `Historical oracle ${field} must equal ${expected}; got ${result[field]}`);
    }
  }
}

module.exports = {
  EXACT_TOTALS,
  EXPECTED_FILE_COUNT,
  PHASE2_AND_3_TEST_FILE_NAMES,
  historicalOracleFiles,
  validateHistoricalOracle,
};
