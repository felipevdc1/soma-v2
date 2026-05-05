'use strict';
/**
 * agents-md-injector.cjs — SOMA v2.1 AGENTS.md bootloader injector
 *
 * Handles injection of anchored bootloader block (id=project.AGENTS.bootloader)
 * into a project's AGENTS.md file, preserving all existing content outside the block.
 *
 * Algorithm (per AD-03, spec D6):
 *   - Given existingContent + blockBody: detect if block already present.
 *   - If block present → throw AGENTS_MD_PARSE_ERROR (anomalous state).
 *   - If no block → append blockBody wrapped in soma-v2 markers, separated by blank line.
 *   - Returns {newContent, action: "create"|"inject", blockSha256}.
 *
 * @module agents-md-injector
 */

const { parseAnchorAttrs, computeBlockSha256 } = require('./anchored-blocks.cjs');

const BLOCK_ID = 'project.AGENTS.bootloader';
const BLOCK_VERSION = '2.1.0-draft';

/**
 * Check if a string contains an anchored block with the given ID.
 * Scans lines for <!-- soma-v2:start id=BLOCK_ID ... --> marker.
 *
 * @param {string} content - file content to scan
 * @param {string} blockId - block ID to search for
 * @returns {boolean}
 */
function hasAnchorBlock(content, blockId) {
  const lines = content.split('\n');
  for (const line of lines) {
    const attrs = parseAnchorAttrs(line);
    if (attrs && attrs.id === blockId) return true;
  }
  return false;
}

/**
 * Inject a SOMA bootloader anchored block into AGENTS.md content.
 *
 * @param {object} opts
 * @param {string|null} opts.existingContent - existing AGENTS.md content, or null if file doesn't exist
 * @param {string} opts.blockBody - inner content of the bootloader block (between markers)
 * @param {string} [opts.blockId] - block ID (default: 'project.AGENTS.bootloader')
 * @param {string} [opts.version] - block version (default: '2.1.0-draft')
 * @returns {{newContent: string, action: "create"|"inject", blockSha256: string}}
 * @throws {Error} with code AGENTS_MD_PARSE_ERROR if existing content already has the block
 */
function injectBootloader({ existingContent, blockBody, blockId = BLOCK_ID, version = BLOCK_VERSION }) {
  // Check for existing block in pre-existing content
  if (existingContent !== null && hasAnchorBlock(existingContent, blockId)) {
    const err = new Error(
      `AGENTS.md already has bootloader block (id=${blockId}) but .soma/ doesn't exist; manual cleanup required`
    );
    err.code = 'AGENTS_MD_PARSE_ERROR';
    throw err;
  }

  // Compute sha256 of block body content
  const blockSha256 = computeBlockSha256(blockBody);

  // Build the anchored block markers
  const startMarker = `<!-- soma-v2:start id=${blockId} version=${version} sha256=${blockSha256} -->`;
  const endMarker = `<!-- soma-v2:end id=${blockId} -->`;
  const anchoredBlock = `${startMarker}\n${blockBody}\n${endMarker}`;

  let newContent;
  let action;

  if (existingContent === null) {
    // File doesn't exist — create from scratch with just the anchored block
    newContent = anchoredBlock + '\n';
    action = 'create';
  } else {
    // File exists — append block separated by a blank line
    // Ensure existing content ends with newline before appending
    const base = existingContent.endsWith('\n') ? existingContent : existingContent + '\n';
    newContent = base + '\n' + anchoredBlock + '\n';
    action = 'inject';
  }

  return { newContent, action, blockSha256 };
}

module.exports = {
  injectBootloader,
  hasAnchorBlock,
  BLOCK_ID,
  BLOCK_VERSION
};
