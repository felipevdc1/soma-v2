'use strict';
// audit-schema.test.cjs — T-09: unit tests for audit-schema.cjs
// @spec AC-11, AC-12

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateOutput, formatError, REQUIRED_TOP_LEVEL } = require('../lib/audit-schema.cjs');

function makeValidOutput(overrides = {}) {
  return {
    schema: 'soma-audit/v1',
    module: {
      path: '/tmp/test.cjs',
      loc: 100,
      exports: ['foo'],
      recent_commits: [],
      test_count: 2,
      help_text: null,
      header_comment: '// test',
      export_signatures: [],
    },
    capabilities: null,
    bugs: null,
    recent_changes: null,
    recommended_spec_scope: null,
    warnings: [],
    duration_ms: 500,
    session_id: 'test-session',
    session_id_source: 'SOMA_SESSION_ID',
    claude_cli_used: false,
    ...overrides,
  };
}

// ---- AC-11: valid output ----

test('AC-11: validateOutput returns null for valid soma-audit/v1 output', () => {
  const result = validateOutput(makeValidOutput());
  assert.equal(result, null, `Expected null (valid), got: ${result}`);
});

test('AC-11: validateOutput returns error for wrong schema', () => {
  const result = validateOutput(makeValidOutput({ schema: 'wrong/v1' }));
  assert.ok(result, 'Expected error string');
  assert.ok(result.includes('schema'), 'error mentions schema');
});

test('AC-11: validateOutput returns error for missing required field', () => {
  for (const field of REQUIRED_TOP_LEVEL) {
    const output = makeValidOutput();
    delete output[field];
    const result = validateOutput(output);
    assert.ok(result, `Expected error for missing field: ${field}`);
  }
});

test('AC-11: validateOutput accepts null capabilities/bugs (graceful degradation)', () => {
  const result = validateOutput(makeValidOutput({
    capabilities: null,
    bugs: null,
    recent_changes: null,
    recommended_spec_scope: null,
  }));
  assert.equal(result, null, 'null sense-making fields are valid (degraded mode)');
});

test('AC-11: validateOutput returns error for non-array warnings', () => {
  const result = validateOutput(makeValidOutput({ warnings: 'not-array' }));
  assert.ok(result, 'Expected error');
  assert.ok(result.includes('warnings'), 'error mentions warnings');
});

test('AC-11: validateOutput returns error for non-number duration_ms', () => {
  const result = validateOutput(makeValidOutput({ duration_ms: 'fast' }));
  assert.ok(result);
});

test('AC-11: validateOutput returns error for non-array module.exports', () => {
  const output = makeValidOutput();
  output.module.exports = 'not-array';
  const result = validateOutput(output);
  assert.ok(result);
});

// ---- AC-12: formatError ----

test('AC-12: formatError returns {code, message, hint}', () => {
  const err = formatError('SANDBOX_VIOLATION', 'path outside sandbox', 'Set SOMA_SAFE_PATHS_ONLY=0');
  assert.equal(err.code, 'SANDBOX_VIOLATION');
  assert.equal(err.message, 'path outside sandbox');
  assert.equal(err.hint, 'Set SOMA_SAFE_PATHS_ONLY=0');
});

test('AC-12: formatError works with empty hint', () => {
  const err = formatError('MODULE_NOT_FOUND', 'file missing');
  assert.equal(err.code, 'MODULE_NOT_FOUND');
  assert.ok(Object.prototype.hasOwnProperty.call(err, 'hint'), 'hint field always present');
});
