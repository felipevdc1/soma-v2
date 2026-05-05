'use strict';
/**
 * template-engine.cjs — SOMA v2.1 template placeholder engine
 *
 * Simple regex-based {{KEY}} substitution for project templates.
 * Zero external dependencies — Node stdlib only.
 *
 * @module template-engine
 */

/**
 * Render a template string by substituting {{KEY}} placeholders with values from vars.
 * Throws if any {{KEY}} placeholder remains after substitution.
 *
 * @param {string} templateContent - raw template string containing {{KEY}} markers
 * @param {Record<string, string>} vars - map of key → replacement value
 * @returns {string} rendered content with all placeholders replaced
 * @throws {Error} with code TEMPLATE_PARSE_ERROR if any placeholder remains unresolved
 */
function renderTemplate(templateContent, vars) {
  let result = templateContent;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    // Replace all occurrences of this placeholder
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }

  // Check for any remaining unresolved placeholders
  const remaining = result.match(/\{\{[^}]+\}\}/);
  if (remaining) {
    const err = new Error(`Template placeholder not resolved: ${remaining[0]}`);
    err.code = 'TEMPLATE_PARSE_ERROR';
    throw err;
  }

  return result;
}

/**
 * Return current timestamp as ISO 8601 UTC string.
 * Format: YYYY-MM-DDTHH:MM:SS.mmmZ
 *
 * @returns {string} ISO 8601 UTC timestamp
 */
function nowISO8601() {
  return new Date().toISOString();
}

module.exports = {
  renderTemplate,
  nowISO8601
};
