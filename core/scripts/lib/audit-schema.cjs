'use strict';
// audit-schema.cjs — SOMA audit schema validator + error formatter (Spec 012 T-09)
// @spec AC-11, AC-12

const REQUIRED_TOP_LEVEL = [
  'schema',
  'module',
  'capabilities',
  'bugs',
  'recent_changes',
  'recommended_spec_scope',
  'warnings',
  'duration_ms',
];

const REQUIRED_MODULE_FIELDS = [
  'path',
  'loc',
  'exports',
  'recent_commits',
  'test_count',
];

/**
 * Validate audit output against soma-audit/v1 schema.
 * Returns null if valid, error string if invalid.
 * @spec AC-11
 */
function validateOutput(output) {
  if (!output || typeof output !== 'object') {
    return 'Output must be an object';
  }

  if (output.schema !== 'soma-audit/v1') {
    return `schema must be "soma-audit/v1", got "${output.schema}"`;
  }

  for (const field of REQUIRED_TOP_LEVEL) {
    if (!Object.prototype.hasOwnProperty.call(output, field)) {
      return `Missing required top-level field: ${field}`;
    }
  }

  if (!output.module || typeof output.module !== 'object') {
    return 'module must be an object';
  }

  for (const field of REQUIRED_MODULE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(output.module, field)) {
      return `Missing required module field: ${field}`;
    }
  }

  if (typeof output.module.loc !== 'number') {
    return 'module.loc must be a number';
  }

  if (!Array.isArray(output.module.exports)) {
    return 'module.exports must be an array';
  }

  if (!Array.isArray(output.module.recent_commits)) {
    return 'module.recent_commits must be an array';
  }

  if (typeof output.module.test_count !== 'number') {
    return 'module.test_count must be a number';
  }

  if (!Array.isArray(output.warnings)) {
    return 'warnings must be an array';
  }

  if (typeof output.duration_ms !== 'number') {
    return 'duration_ms must be a number';
  }

  return null; // valid
}

/**
 * Format a structured error for stderr (AC-12).
 * Returns { code, message, hint } — machine-parseable.
 */
function formatError(code, message, hint = '') {
  return { code, message, hint };
}

module.exports = { validateOutput, formatError, REQUIRED_TOP_LEVEL, REQUIRED_MODULE_FIELDS };
