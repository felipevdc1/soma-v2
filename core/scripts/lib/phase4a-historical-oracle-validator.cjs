'use strict';

const EXPECTED_FILE_COUNT = 16;
const EXACT_TOTALS = Object.freeze({ tests: 198, pass: 198, fail: 0, skipped: 0, cancelled: 0, todo: 0 });

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateHistoricalOracle({ expectedFiles, fileExists, result }) {
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

module.exports = { EXACT_TOTALS, EXPECTED_FILE_COUNT, validateHistoricalOracle };
