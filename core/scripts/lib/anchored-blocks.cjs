'use strict';
/**
 * anchored-blocks.cjs — SOMA v2.1 anchor block parsing utilities
 *
 * Handles two marker formats:
 *   New: <!-- soma-v2:start id=BLOCKID version=VER sha256=HEX -->
 *        <!-- soma-v2:end id=BLOCKID -->
 *   Legacy: <!-- NAME:start --> ... <!-- NAME:end -->
 *           Also matches short-name of full block IDs:
 *           "block.codex.AGENTS.hyd-v2" → tries "hyd-v2" as legacy name
 *
 * @module anchored-blocks
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

/**
 * Escape special regex characters in a string.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse anchor attributes from a soma-v2:start marker line.
 * Returns {id, version, sha256} or null if not a soma-v2:start marker.
 * @param {string} markerLine
 * @returns {{id: string, version: string|null, sha256: string|null}|null}
 */
function parseAnchorAttrs(markerLine) {
  // Match: <!-- soma-v2:start id=... version=... sha256=... -->
  // Attributes can be in any order, values are unquoted token sequences up to next attr= or -->
  const startMatch = markerLine.match(/<!--\s*soma-v2:start\s+(.*?)\s*-->/);
  if (!startMatch) return null;
  const attrStr = startMatch[1];

  function extractAttr(name) {
    const re = new RegExp(`(?:^|\\s)${name}=([^\\s]+)`);
    const m = attrStr.match(re);
    return m ? m[1] : undefined;
  }

  const id = extractAttr('id');
  const version = extractAttr('version');
  const sha256 = extractAttr('sha256');

  // Must have at least id to be a valid soma-v2 marker
  if (!id) return null;

  return { id, version: version || null, sha256: sha256 || null };
}

/**
 * Compute sha256 of block content (the inner text between markers).
 * @param {string} content - inner content between start/end markers
 * @returns {string} hex sha256
 */
function computeBlockSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Extract a named anchored block from a file.
 *
 * Search priority:
 * 1. New format: <!-- soma-v2:start id=BLOCKID ... --> ... <!-- soma-v2:end id=BLOCKID -->
 * 2. Legacy format: <!-- BLOCKID:start --> ... <!-- BLOCKID:end -->
 * 3. Legacy with short name: for "block.codex.AGENTS.hyd-v2" also tries "hyd-v2"
 *
 * @param {string} filepath - absolute path to file
 * @param {string} blockId - block ID to search for
 * @returns {{found: boolean, content?: string, attrs?: {id: string, version: string|null, sha256: string|null}}}
 */
function extractBlock(filepath, blockId) {
  let fileContent;
  try {
    fileContent = fs.readFileSync(filepath, 'utf8');
  } catch (err) {
    return { found: false };
  }

  const lines = fileContent.split('\n');

  // --- Try new soma-v2 format first ---
  for (let i = 0; i < lines.length; i++) {
    const attrs = parseAnchorAttrs(lines[i]);
    if (attrs && attrs.id === blockId) {
      // Found start marker — collect until soma-v2:end id=BLOCKID
      const endPattern = new RegExp(`<!--\\s*soma-v2:end\\s+id=${escapeRegex(blockId)}\\s*-->`);
      const contentLines = [];
      let j = i + 1;
      while (j < lines.length) {
        if (endPattern.test(lines[j])) {
          return {
            found: true,
            content: contentLines.join('\n'),
            attrs
          };
        }
        contentLines.push(lines[j]);
        j++;
      }
      // Start found but no matching end
      return { found: false };
    }
  }

  // --- Try legacy format ---
  // Also try "short name" (last dot-segment) for full block IDs
  // e.g. "block.codex.AGENTS.hyd-v2" → also try "hyd-v2"
  const shortName = blockId.includes('.') ? blockId.split('.').pop() : null;
  const legacyCandidates = [blockId];
  if (shortName && shortName !== blockId) legacyCandidates.push(shortName);

  for (const legacyId of legacyCandidates) {
    const legacyStartPattern = new RegExp(`<!--\\s*${escapeRegex(legacyId)}:start\\s*-->`);
    const legacyEndPattern = new RegExp(`<!--\\s*${escapeRegex(legacyId)}:end\\s*-->`);

    for (let i = 0; i < lines.length; i++) {
      if (legacyStartPattern.test(lines[i])) {
        const contentLines = [];
        let j = i + 1;
        while (j < lines.length) {
          if (legacyEndPattern.test(lines[j])) {
            return {
              found: true,
              content: contentLines.join('\n'),
              attrs: { id: blockId, version: null, sha256: null }
            };
          }
          contentLines.push(lines[j]);
          j++;
        }
        // Start found but no matching end
        return { found: false };
      }
    }
  }

  return { found: false };
}

module.exports = {
  parseAnchorAttrs,
  computeBlockSha256,
  extractBlock,
  escapeRegex
};
