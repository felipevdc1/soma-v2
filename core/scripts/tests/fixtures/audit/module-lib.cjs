'use strict';
/**
 * module-lib.cjs — fixture for audit tests
 * A fake library module (no CLI invocation)
 */

function parseData(input) {
  return { parsed: input };
}

function transformData(data, opts) {
  return { transformed: data, opts };
}

function validateSchema(obj, schema) {
  return obj != null && schema != null;
}

module.exports = { parseData, transformData, validateSchema };
