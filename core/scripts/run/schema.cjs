'use strict';
/**
 * run/schema.cjs — hand-rolled schema validator, zero dependency.
 *
 * The repo has `dependencies: {}` and `devDependencies: {}` by design
 * (plan.md §Architecture Decisions) — a validator library (ajv) would be the
 * first dependency this project ever takes on, to validate 3 small, closed
 * schemas. This module is the alternative: small by construction.
 *
 * Schema descriptor shape:
 *
 *   {
 *     fields: {
 *       <fieldName>: {
 *         type: 'string' | 'number' | 'object' | 'array' | 'boolean',
 *         required: boolean,                 // optional, default false
 *         requiredIf: (obj) => boolean,       // optional, conditional requirement
 *         const: <any>,                       // optional, literal fixed value
 *         enum: [<any>, ...],                 // optional, closed set of allowed values
 *         minLength: number,                  // optional, string/array length floor
 *       },
 *       ...
 *     }
 *   }
 *
 * validate(schemaDef, obj) -> { valid: boolean, violations: [{ field, message }] }
 *
 * Design notes:
 *   - Returns the FULL list of violations, not a single boolean — the caller
 *     (soma run gate / soma run report) needs to name the cause, not just
 *     know something failed (AC-02, AC-10).
 *   - An absent field that is not required produces zero violations; type /
 *     const / enum checks only run against fields that are actually present.
 *   - requiredIf is evaluated against the raw input object, so a conditional
 *     rule can react to sibling fields (e.g. failure_reason required when
 *     status != "pass").
 *
 * This module implements the GENERIC validator only. The 3 concrete schemas
 * (soma-step-report/v1, soma-state/v2, soma-dispatch-record/v1) are owned by
 * the tasks that emit them (T-06, T-08, T-10) — not by T-01.
 */

/**
 * @param {*} value
 * @returns {'string'|'number'|'boolean'|'object'|'array'|'null'|'undefined'}
 */
function typeOf(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * @param {{fields?: Record<string, object>}} schemaDef
 * @param {*} obj
 * @returns {{valid: boolean, violations: Array<{field: string, message: string}>}}
 */
function validate(schemaDef, obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return {
      valid: false,
      violations: [{ field: '(root)', message: 'value must be a non-null, non-array object' }],
    };
  }

  const fields = (schemaDef && schemaDef.fields) || {};
  const violations = [];

  for (const [fieldName, rule] of Object.entries(fields)) {
    const present = Object.prototype.hasOwnProperty.call(obj, fieldName);
    const value = obj[fieldName];

    const conditionallyRequired = typeof rule.requiredIf === 'function' && rule.requiredIf(obj) === true;
    const isRequired = rule.required === true || conditionallyRequired;

    if (!present) {
      if (isRequired) {
        violations.push({ field: fieldName, message: `missing required field "${fieldName}"` });
      }
      continue; // nothing else to check on an absent field
    }

    if (rule.type) {
      const actualType = typeOf(value);
      if (actualType !== rule.type) {
        violations.push({
          field: fieldName,
          message: `field "${fieldName}" must be of type ${rule.type}, got ${actualType}`,
        });
        continue; // const/enum/minLength checks assume the right type
      }
    }

    if (Object.prototype.hasOwnProperty.call(rule, 'const') && value !== rule.const) {
      violations.push({
        field: fieldName,
        message: `field "${fieldName}" must equal literal ${JSON.stringify(rule.const)}, got ${JSON.stringify(value)}`,
      });
    }

    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      violations.push({
        field: fieldName,
        message: `field "${fieldName}" must be one of ${JSON.stringify(rule.enum)}, got ${JSON.stringify(value)}`,
      });
    }

    if (
      typeof rule.minLength === 'number' &&
      (typeof value === 'string' || Array.isArray(value)) &&
      value.length < rule.minLength
    ) {
      violations.push({
        field: fieldName,
        message: `field "${fieldName}" must have length >= ${rule.minLength}, got ${value.length}`,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

module.exports = { validate };
