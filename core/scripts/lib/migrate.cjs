'use strict';
/**
 * Migration library for cbm deprecation (Spec 013).
 *
 * @spec core/specs/013-cbm-deprecation/spec.md
 * @issue #9
 */

const fs = require('node:fs');

/**
 * Extract content between <!-- codebase-memory-mcp:start --> and <!-- codebase-memory-mcp:end -->
 * markers from a target file. Returns null if file missing or markers not found.
 *
 * @param {string} labAgentsPath — absolute path to lab AGENTS.md
 * @returns {string|null}
 */
exports.extractMcpContentFromLab = function(labAgentsPath) {
  if (!fs.existsSync(labAgentsPath)) return null;
  const content = fs.readFileSync(labAgentsPath, 'utf8');
  const startPattern = /<!--\s*codebase-memory-mcp:start\s*-->/;
  const endPattern = /<!--\s*codebase-memory-mcp:end\s*-->/;
  const startMatch = content.match(startPattern);
  const endMatch = content.match(endPattern);
  if (!startMatch || !endMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = endMatch.index;
  return content.slice(startIdx, endIdx).replace(/^\n/, '').replace(/\n$/, '');
};
