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

/**
 * Remove a legacy `<!-- {markerName}:start -->...<!-- {markerName}:end -->` block from content.
 * Idempotent: returns content unchanged if marker not present.
 *
 * @param {string} content
 * @param {string} markerName — e.g., "codebase-memory-mcp"
 * @returns {string}
 */
exports.deleteLegacyBlock = function(content, markerName) {
  const escaped = markerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\n?<!--\\s*${escaped}:start\\s*-->[\\s\\S]*?<!--\\s*${escaped}:end\\s*-->\\n?`, 'g');
  return content.replace(pattern, '\n');
};

/**
 * Rename a soma-v2 anchor: change ID + sha256 in start marker, change ID in end marker.
 * Inner content untouched.
 *
 * @param {string} content
 * @param {string} oldId
 * @param {string} newId
 * @param {string} newSha
 * @returns {string}
 */
exports.renameAnchor = function(content, oldId, newId, newSha) {
  const escapedOld = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`(<!--\\s*soma-v2:start\\s+id=)${escapedOld}(\\s+version=[^\\s]+\\s+sha256=)[^\\s]+(\\s*-->)`, 'g');
  const endPattern = new RegExp(`(<!--\\s*soma-v2:end\\s+id=)${escapedOld}(\\s*-->)`, 'g');
  return content
    .replace(startPattern, `$1${newId}$2${newSha}$3`)
    .replace(endPattern, `$1${newId}$2`);
};

/**
 * Atomic write via tmp file + POSIX rename. Either succeeds entirely or leaves
 * target file unchanged.
 *
 * @param {string} filePath — absolute path
 * @param {string} content — string content to write
 * @throws {Error} on write or rename failure
 */
exports.atomicWrite = function(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Cleanup tmp on failure
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    throw err;
  }
};
