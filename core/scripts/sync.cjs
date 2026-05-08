#!/usr/bin/env node
'use strict';
/**
 * sync.cjs — SOMA v2.1 sync CLI (Phase 4b: --apply write-mode)
 *
 * Modes:
 *   --dry-run  (Phase 2): preview only, no writes
 *   --apply    (Phase 4b): write anchored blocks + snapshot pre-write state
 *
 * Usage:
 *   node ~/.soma-v2/scripts/sync.cjs --dry-run [--json] [--verbose] [--soma-home=PATH] [--tool=ADAPTER]
 *   node ~/.soma-v2/scripts/sync.cjs --apply --tool=<codex|claude> [--json] [--soma-home=PATH] [--allow-local-edits]
 *
 * Note: --tool is REQUIRED when --apply is used. Optional for --dry-run (scans all adapters when omitted).
 *
 * Exit codes:
 *   0 — all entries action=skip (everything in sync) OR apply succeeded
 *   1 — ≥1 actionable finding (dry-run) OR apply error (snapshot/stale/parse/conflict)
 *   2 — hard error (invalid args, manifest invalid, etc.)
 *
 * @spec AC-01..AC-14, D4, BF-06
 * @contract CONTRACT-SYNC-APPLY-01
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { extractBlock, computeBlockSha256, parseAnchorAttrs, escapeRegex } = require('./lib/anchored-blocks.cjs');
const { loadManifest, loadInstallTargets, listAdapters } = require('./lib/manifest.cjs');
const { createSnapshot } = require('./lib/snapshot.cjs');

// ---- Tool-level injection defaults (BF-01/BF-02 per AC-03) ----
// Defines wrapper_section and position_before defaults for each tool.
// Per-entry fields in install-targets.json override these.
// @spec AC-01 AC-03 + BF-01 BF-02
const TOOL_DEFAULTS = {
  claude: {
    wrapperSection: '## SOMA Bootloader (managed by soma sync)',
    positionBefore: '## Failure Log'
  }
};

// ---- Valid tool enum (BF-07 / INVALID_ARGS) ----
const VALID_TOOLS = ['codex', 'claude'];

// ---- Arg parsing ----

function parseArgs(argv) {
  const flags = {
    apply: false,
    dryRun: false,
    json: false,
    verbose: false,
    somaHome: null,
    tool: null,
    allowLocalEdits: false  // BF-06: opt-in to warn-and-write; default OFF = abort on conflict
  };
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') flags.apply = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--verbose') flags.verbose = true;
    else if (arg.startsWith('--soma-home=')) flags.somaHome = arg.slice('--soma-home='.length);
    else if (arg === '--soma-home' && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags.somaHome = argv[++i];
    }
    else if (arg.startsWith('--tool=')) flags.tool = arg.slice('--tool='.length);
    else if (arg === '--tool' && i + 1 < argv.length) flags.tool = argv[++i];
    else if (arg === '--allow-local-edits') flags.allowLocalEdits = true;  // BF-06 opt-in
    else if (arg.startsWith('--')) errors.push(`Unknown flag: ${arg}`);
  }

  // AC-12: --apply and --dry-run are mutually exclusive
  if (flags.apply && flags.dryRun) {
    errors.push('--apply and --dry-run are mutually exclusive');
    return { flags, errors };
  }

  // BF-07 (AC-01): Default to dry-run when no mode flag provided.
  // Removed the hard error: "no mode" now silently defaults to --dry-run.
  // --dry-run flag is still accepted for explicit opt-in (backward compat).
  if (!flags.apply && !flags.dryRun) {
    flags.dryRun = true; // dry-run default per AC-01
  }

  // INVALID_ARGS: --tool is REQUIRED when --apply is used (Wave 5 / T-05 GREEN).
  // @spec CONTRACT-011-01-sync-apply: tool enum: codex|claude; required=true for --apply
  // --dry-run: --tool is optional (omitting scans all adapters).
  if (flags.apply && !flags.tool) {
    errors.push('--tool is required when --apply is used (codex|claude)');
  }
  // INVALID_ARGS: when --tool is provided, validate it is a known enum value.
  if (flags.tool && !VALID_TOOLS.includes(flags.tool)) {
    errors.push(`--tool must be one of: ${VALID_TOOLS.join('|')} (got: ${flags.tool})`);
  }

  if (flags.json && flags.verbose) {
    errors.push('--json and --verbose are mutually exclusive (--json always emits all findings)');
  }

  return { flags, errors };
}

// ---- Output helpers ----

function emitHardError(code, message, useJson) {
  if (useJson) {
    process.exitCode = 2;
    process.stdout.write(JSON.stringify({ error: code, message }, null, 2) + '\n');
  } else {
    process.stderr.write(`ERROR [${code}]: ${message}\n`);
    process.exit(2);
  }
}

function humanActionLabel(action) {
  if (action === 'insert') return '\x1b[33m[insert]\x1b[0m';
  if (action === 'replace') return '\x1b[31m[replace]\x1b[0m';
  if (action === 'drift') return '\x1b[31m[drift]\x1b[0m';
  if (action === 'skip') return '\x1b[32m[skip]\x1b[0m';
  return `[${action}]`;
}

// ---- Anchor parse error detection ----

/**
 * Detect anchor parse errors in a file: start marker without matching end.
 * Returns error message string if broken, null if clean.
 */
function detectAnchorParseError(filepath, blockId) {
  let content;
  try {
    content = fs.readFileSync(filepath, 'utf8');
  } catch (err) {
    return null;
  }
  const lines = content.split('\n');
  const escapedId = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (let i = 0; i < lines.length; i++) {
    const attrs = parseAnchorAttrs(lines[i]);
    if (attrs && attrs.id === blockId) {
      // Found start — look for end
      const endPattern = new RegExp(`<!--\\s*soma-v2:end\\s+id=${escapedId}\\s*-->`);
      for (let j = i + 1; j < lines.length; j++) {
        if (endPattern.test(lines[j])) return null; // found end — clean
      }
      // Start found but no end
      return `Anchor block ${blockId} has start marker but no matching end marker in ${filepath}`;
    }
  }
  return null;
}

// ---- BF-03: Legacy block nesting check ----

/**
 * Check whether a legacy block (matched via short-name) for anchorId is NESTED
 * inside another soma-v2 block in existingContent.
 *
 * When true, writeBlock should NOT enter the replace branch (which would silently no-op
 * because parseAnchorAttrs never matches `<!-- shortName:start -->` markers).
 * Instead, fall through to INSERT to create a proper soma-v2 block.
 *
 * Root cause of BF-03: hyd-v2.md content (used as cbm block body) contains
 * `<!-- hyd-v2:start -->` / `<!-- hyd-v2:end -->` legacy markers. After cbm block is
 * written, extractBlock(target, 'block.claude.CLAUDE_md.hyd-v2') finds those legacy
 * markers INSIDE the cbm soma-v2 block → returns found=true, version=null, sha256=null.
 * writeBlock then enters replace branch, loops with parseAnchorAttrs which never matches
 * the legacy start line → silent no-op write. hyd-v2 soma-v2 block is never created.
 *
 * @param {string} existingContent - current file content
 * @param {string} anchorId - soma-v2 block ID to check
 * @returns {boolean} true if the legacy marker is nested inside another soma-v2 block
 */
function isLegacyBlockNested(existingContent, anchorId) {
  const shortName = anchorId.includes('.') ? anchorId.split('.').pop() : anchorId;
  const legacyStartPattern = new RegExp(`<!--\\s*${escapeRegex(shortName)}:start\\s*-->`);
  const lines = existingContent.split('\n');
  let nestingDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const attrs = parseAnchorAttrs(lines[i]);
    if (attrs) nestingDepth++;
    if (/<!--\s*soma-v2:end\s+id=/.test(lines[i])) nestingDepth = Math.max(0, nestingDepth - 1);
    if (legacyStartPattern.test(lines[i])) {
      return nestingDepth > 0;
    }
  }
  return false;
}

/**
 * Detect legacy parse errors in a file: legacy start marker without matching end.
 * Defense-in-depth pre-flight check — wired into writeLegacyUpgrade before any write.
 * Returns error message string if broken (orphan start), null if clean.
 *
 * @param {string} filepath - absolute path to target file
 * @param {string} shortName - legacy shortname (e.g. 'hyd-v2' for anchorId 'block.codex.AGENTS.hyd-v2')
 * @returns {string|null}
 */
function detectLegacyParseError(filepath, shortName, existingContent = null) {
  let content;
  if (existingContent !== null) {
    content = existingContent;
  } else {
    try {
      content = fs.readFileSync(filepath, 'utf8');
    } catch (err) {
      return null;
    }
  }
  const lines = content.split('\n');
  const legacyStartPattern = new RegExp(`<!--\\s*${escapeRegex(shortName)}:start\\s*-->`);
  const legacyEndPattern = new RegExp(`<!--\\s*${escapeRegex(shortName)}:end\\s*-->`);
  for (let i = 0; i < lines.length; i++) {
    if (legacyStartPattern.test(lines[i])) {
      // Found start — look for matching end
      for (let j = i + 1; j < lines.length; j++) {
        if (legacyEndPattern.test(lines[j])) return null; // found end — clean
      }
      // Start found but no end: orphan condition
      return `LEGACY_UPGRADE_MALFORMED: legacy start marker for "${shortName}" found at line ${i + 1} but no matching <!-- ${shortName}:end --> in ${filepath}`;
    }
  }
  return null;
}

/**
 * Upgrade a top-level legacy marker block (<!-- shortname:start --> / <!-- shortname:end -->)
 * to the anchored soma-v2 format in-place.
 *
 * Called by runApplyMode when action='drift' and message contains 'lacks id/version/sha256 attributes'
 * (legacy-upgrade drift). Reuses the 'replace' semantic — finds the legacy start/end markers and
 * rewrites the entire region with the anchored form using source_block_content from the finding.
 *
 * @param {string} targetPath - absolute path to target file
 * @param {string} anchorId - soma-v2 block ID (may be dotted, e.g. 'block.codex.AGENTS.hyd-v2')
 * @param {string} blockContent - inner content from source (from finding.source_block_content)
 * @returns {{ action: 'replace', sha256: string }}
 * @spec Issue #11 / D-013-10
 */
function writeLegacyUpgrade(targetPath, anchorId, blockContent) {
  const sha256 = computeBlockSha256(blockContent);
  const shortName = anchorId.includes('.') ? anchorId.split('.').pop() : anchorId;
  const legacyStartPattern = new RegExp(`<!--\\s*${escapeRegex(shortName)}:start\\s*-->`);
  const legacyEndPattern = new RegExp(`<!--\\s*${escapeRegex(shortName)}:end\\s*-->`);

  const startMarker = `<!-- soma-v2:start id=${anchorId} version=1.0 sha256=${sha256} -->`;
  const endMarker = `<!-- soma-v2:end id=${anchorId} -->`;

  const existingContent = fs.readFileSync(targetPath, 'utf8');

  // --- B1: Pre-write guard — detect orphan legacy start marker (no matching end) ---
  // Must run BEFORE any fs.writeFileSync to prevent file corruption.
  // Pass existingContent to avoid a second fs.readFileSync on the same file.
  const legacyParseError = detectLegacyParseError(targetPath, shortName, existingContent);
  if (legacyParseError) {
    throw new Error(legacyParseError);
  }

  // --- C1: Pre-write uniqueness guard — detect shortname collision (multiple legacy blocks) ---
  // By design (matches FROZEN extractBlock heuristic), upgrade derives shortname via .split('.').pop().
  // If a target file contains multiple legacy blocks with colliding shortnames, behavior is undefined.
  const allLines = existingContent.split('\n');
  const startMatchCount = allLines.filter(l => legacyStartPattern.test(l)).length;
  if (startMatchCount > 1) {
    throw new Error(
      `LEGACY_UPGRADE_AMBIGUOUS: shortname "${shortName}" matches ${startMatchCount} legacy blocks in ${targetPath}; cannot disambiguate`
    );
  }

  const lines = existingContent.split('\n');
  const newLines = [];
  let i = 0;
  while (i < lines.length) {
    if (legacyStartPattern.test(lines[i])) {
      // Replace legacy block region with anchored format
      newLines.push(startMarker);
      i++;
      // Skip all lines until (and including) the legacy end marker
      while (i < lines.length) {
        if (legacyEndPattern.test(lines[i])) {
          for (const cl of blockContent.split('\n')) newLines.push(cl);
          newLines.push(endMarker);
          i++;
          break;
        }
        i++;
      }
    } else {
      newLines.push(lines[i]);
      i++;
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, newLines.join('\n'));
  return { action: 'replace', sha256 };
}

// ---- BF-01/BF-02: Positional insert with wrapper section support ----

/**
 * Insert newBlock into existingContent with optional wrapper section + position_before support.
 *
 * Handles 4 cases:
 * 1. wrapperSection exists in file → insert block inside it (before next top-level ## heading)
 * 2. wrapperSection NOT in file + positionBefore specified → create section + block before marker
 * 3. positionBefore only (no wrapperSection) → insert block before marker line
 * 4. Neither → append at end-of-file (legacy behavior)
 *
 * NOTE: "top-level ## heading" detection ignores ## headings nested inside soma-v2 blocks
 * (e.g., `## HYD v2 Loop` inside a cbm block content is NOT treated as section boundary).
 *
 * @param {string} existingContent - current file content (may be empty string for new file)
 * @param {string} newBlock - fully formed anchor block (startMarker + content + endMarker)
 * @param {{wrapperSection: string|null, positionBefore: string|null}} injectionOptions
 * @returns {string} new file content
 */
function insertWithPosition(existingContent, newBlock, injectionOptions) {
  const { wrapperSection, positionBefore } = injectionOptions;
  const lines = existingContent.split('\n');

  if (wrapperSection) {
    // Look for existing wrapper section
    const sectionIdx = lines.findIndex(l => l.trim() === wrapperSection.trim());

    if (sectionIdx !== -1) {
      // Section already exists — find end of section (next top-level ## heading or EOF).
      // Track soma-v2 nesting depth so ## headings inside blocks aren't mistaken for boundaries.
      let endOfSection = sectionIdx + 1;
      let somaDepth = 0;
      while (endOfSection < lines.length) {
        const l = lines[endOfSection];
        const attrs = parseAnchorAttrs(l);
        if (attrs) somaDepth++;
        if (/<!--\s*soma-v2:end\s+id=/.test(l)) somaDepth = Math.max(0, somaDepth - 1);
        // Only treat as section boundary when at top level (not inside a soma-v2 block)
        if (somaDepth === 0 && l.startsWith('## ') && l.trim() !== wrapperSection.trim()) break;
        endOfSection++;
      }
      // Insert block before end of section (after any existing blocks in section)
      const insertLines = [...newBlock.split('\n'), ''];
      lines.splice(endOfSection, 0, ...insertLines);
      return lines.join('\n');
    } else {
      // Section doesn't exist — create it at positionBefore (or end of file)
      let insertAt = lines.length;
      if (positionBefore) {
        const pbIdx = lines.findIndex(l => l.trim() === positionBefore.trim());
        if (pbIdx !== -1) insertAt = pbIdx;
      }
      // Create section: blank line + heading + blank line + block + blank line
      const sectionLines = [
        '',
        wrapperSection,
        '',
        ...newBlock.split('\n'),
        ''
      ];
      lines.splice(insertAt, 0, ...sectionLines);
      return lines.join('\n');
    }
  } else if (positionBefore) {
    // No wrapper section, insert block before positionBefore marker
    let insertAt = lines.findIndex(l => l.trim() === positionBefore.trim());
    if (insertAt === -1) insertAt = lines.length;
    const insertLines = ['', ...newBlock.split('\n'), ''];
    lines.splice(insertAt, 0, ...insertLines);
    return lines.join('\n');
  }

  // Fallback: append at end-of-file (legacy behavior preserved)
  const base = existingContent.endsWith('\n') ? existingContent : existingContent + '\n';
  return base + '\n' + newBlock + '\n';
}

// ---- Core sync logic ----

/**
 * Detect cbm anchors or legacy <!-- codebase-memory-mcp:start --> markers
 * in lab files. Returns { hasCbm: bool, hasLegacy: bool }.
 *
 * @param {{ claudeMd: string, codexAgents: string, homeAgents: string }} target
 * @returns {{ hasCbm: boolean, hasLegacy: boolean }}
 */
function detectLegacyMarkers(target) {
  const result = { hasCbm: false, hasLegacy: false };
  for (const file of Object.values(target).filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/id=block\.[^\.]+\..*\.cbm/.test(content)) result.hasCbm = true;
    if (/<!--\s*codebase-memory-mcp:start\s*-->/.test(content)) result.hasLegacy = true;
  }
  return result;
}

/**
 * Determine the sync action for a single install-targets entry.
 */
function computeEntryAction(entry, somaHome) {
  const targetPath = entry.target_path;
  const anchorId = entry.target_anchor_id;
  const sourceDocRelative = entry.source_doc;
  const sourceDocAbs = path.join(somaHome, sourceDocRelative);

  let expectedSha256 = null;
  let sourceBlockContent = null;
  try {
    const sourceDocContent = fs.readFileSync(sourceDocAbs, 'utf8');
    const blockInSource = extractBlock(sourceDocAbs, anchorId);
    if (blockInSource.found) {
      expectedSha256 = computeBlockSha256(blockInSource.content);
      sourceBlockContent = blockInSource.content;
    } else {
      expectedSha256 = crypto.createHash('sha256').update(sourceDocContent).digest('hex');
      sourceBlockContent = sourceDocContent;
    }
  } catch (err) {
    return {
      action: 'drift',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: null,
      actual_sha256: null,
      source_block_content: null,
      message: `Source doc unreadable: ${sourceDocRelative} — ${err.message}`
    };
  }

  if (!fs.existsSync(targetPath)) {
    return {
      action: 'insert',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: expectedSha256,
      actual_sha256: null,
      source_block_content: sourceBlockContent,
      message: `Would insert block (target file does not exist: ${path.basename(targetPath)})`
    };
  }

  // Check for anchor parse error: start without end
  const anchorError = detectAnchorParseError(targetPath, anchorId);
  if (anchorError) {
    return {
      action: 'anchor_error',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: expectedSha256,
      actual_sha256: null,
      source_block_content: sourceBlockContent,
      message: anchorError
    };
  }

  const blockInTarget = extractBlock(targetPath, anchorId);

  if (!blockInTarget.found) {
    return {
      action: 'insert',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: expectedSha256,
      actual_sha256: null,
      source_block_content: sourceBlockContent,
      message: 'Would insert block at end of file (no existing anchors)'
    };
  }

  const attrs = blockInTarget.attrs;
  const hasNewFormat = attrs.version !== null || attrs.sha256 !== null;

  if (!hasNewFormat) {
    const actualSha256 = computeBlockSha256(blockInTarget.content);
    return {
      action: 'drift',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: expectedSha256,
      actual_sha256: '(no anchor attributes)',
      source_block_content: sourceBlockContent,
      message: 'Block exists with legacy markers but lacks id/version/sha256 attributes (Phase 3+ will upgrade)'
    };
  }

  const actualSha256 = computeBlockSha256(blockInTarget.content);

  if (attrs.sha256 && attrs.sha256 !== actualSha256) {
    return {
      action: 'drift',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: expectedSha256,
      actual_sha256: actualSha256,
      source_block_content: sourceBlockContent,
      message: 'Block sha256 attribute differs from actual content sha256 (manual edit detected)'
    };
  }

  if (actualSha256 !== expectedSha256) {
    return {
      action: 'replace',
      target_path: targetPath,
      target_anchor_id: anchorId,
      source_doc: sourceDocRelative,
      expected_sha256: expectedSha256,
      actual_sha256: actualSha256,
      source_block_content: sourceBlockContent,
      message: 'Block content differs from source; would replace'
    };
  }

  return {
    action: 'skip',
    target_path: targetPath,
    target_anchor_id: anchorId,
    source_doc: sourceDocRelative,
    expected_sha256: expectedSha256,
    actual_sha256: actualSha256,
    source_block_content: sourceBlockContent,
    message: 'Already in sync'
  };
}

/**
 * Write a block (insert or replace) into a target file.
 *
 * Extended in Phase 5 (T-05) to support:
 * - BF-03: nested legacy block detection via isLegacyBlockNested()
 * - BF-01/BF-02: positional insert via insertWithPosition() + injectionOptions
 *
 * @param {string} targetPath - absolute path to target file
 * @param {string} anchorId - soma-v2 block ID
 * @param {string} blockContent - inner content for the block
 * @param {string} version - version string for start marker
 * @param {{wrapperSection: string|null, positionBefore: string|null}|null} [injectionOptions]
 * @returns {{ action: 'insert'|'replace', sha256: string }}
 * @spec AC-01 AC-03 + BF-01 BF-02 BF-03 BF-07
 */
function writeBlock(targetPath, anchorId, blockContent, version, injectionOptions) {
  const sha256 = computeBlockSha256(blockContent);
  const escapedId = anchorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startMarker = `<!-- soma-v2:start id=${anchorId} version=${version} sha256=${sha256} -->`;
  const endMarker = `<!-- soma-v2:end id=${anchorId} -->`;
  const newBlock = `${startMarker}\n${blockContent}\n${endMarker}`;

  let existingContent = null;
  if (fs.existsSync(targetPath)) {
    existingContent = fs.readFileSync(targetPath, 'utf8');
  }

  let newContent;
  let action;

  if (existingContent === null) {
    // New file: create with block (using positional options if provided)
    if (injectionOptions && (injectionOptions.wrapperSection || injectionOptions.positionBefore)) {
      newContent = insertWithPosition('', newBlock, injectionOptions);
    } else {
      newContent = newBlock + '\n';
    }
    action = 'insert';
  } else {
    const blockInTarget = extractBlock(targetPath, anchorId);

    // BF-03: A legacy block found via short-name matching may be NESTED inside another
    // soma-v2 block (e.g., hyd-v2:start inside cbm block content). In that case, the
    // replace loop using parseAnchorAttrs never matches the legacy start line → silent
    // no-op. Fix: detect nested legacy → treat as "not found" → fall through to INSERT.
    let shouldReplace = blockInTarget.found;
    if (blockInTarget.found) {
      const hasNewFormat = blockInTarget.attrs.version !== null || blockInTarget.attrs.sha256 !== null;
      if (!hasNewFormat && isLegacyBlockNested(existingContent, anchorId)) {
        shouldReplace = false; // Nested legacy: treat as not-found, insert new soma-v2 block
      }
    }

    if (shouldReplace) {
      // Replace existing soma-v2 block (new format block — replace via parseAnchorAttrs loop)
      const lines = existingContent.split('\n');
      const newLines = [];
      let i = 0;
      while (i < lines.length) {
        const attrs = parseAnchorAttrs(lines[i]);
        if (attrs && attrs.id === anchorId) {
          // Replace from start to end marker
          newLines.push(startMarker);
          i++;
          const endPattern = new RegExp(`<!--\\s*soma-v2:end\\s+id=${escapedId}\\s*-->`);
          while (i < lines.length) {
            if (endPattern.test(lines[i])) {
              for (const cl of blockContent.split('\n')) newLines.push(cl);
              newLines.push(endMarker);
              i++;
              break;
            }
            i++;
          }
        } else {
          newLines.push(lines[i]);
          i++;
        }
      }
      newContent = newLines.join('\n');
      action = 'replace';
    } else {
      // Insert: use injectionOptions for positional placement (BF-01/BF-02)
      if (injectionOptions && (injectionOptions.wrapperSection || injectionOptions.positionBefore)) {
        newContent = insertWithPosition(existingContent, newBlock, injectionOptions);
      } else {
        // Fallback: append at end-of-file (legacy behavior)
        const base = existingContent.endsWith('\n') ? existingContent : existingContent + '\n';
        newContent = base + '\n' + newBlock + '\n';
      }
      action = 'insert';
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, newContent);
  return { action, sha256 };
}

/**
 * Detect local edits: target file's block sha256 attr doesn't match actual block content.
 */
function detectLocalEdits(targetPath, anchorId) {
  if (!fs.existsSync(targetPath)) return false;
  const blockInTarget = extractBlock(targetPath, anchorId);
  if (!blockInTarget.found) return false;
  const attrs = blockInTarget.attrs;
  if (!attrs || !attrs.sha256) return false;
  const actualSha256 = computeBlockSha256(blockInTarget.content);
  return attrs.sha256 !== actualSha256;
}

/**
 * BF-06: Detect sha256 conflict in an existing anchored block.
 * Returns conflict details if anchor-stored sha256 !== actual content sha256.
 * Returns null if no conflict (block not found, no sha attr, or sha matches).
 * @spec AC-13 AC-14
 */
function detectConflictInfo(targetPath, anchorId) {
  if (!fs.existsSync(targetPath)) return null;
  const blockInTarget = extractBlock(targetPath, anchorId);
  if (!blockInTarget.found) return null;
  const attrs = blockInTarget.attrs;
  if (!attrs || !attrs.sha256) return null;
  const actualSha256 = computeBlockSha256(blockInTarget.content);
  if (attrs.sha256 === actualSha256) return null;
  return {
    file: targetPath,
    block_id: anchorId,
    expected_sha256: attrs.sha256,
    actual_sha256: actualSha256,
    resolution_guidance:
      'Inspect block, decide: (1) rollback to pre-edit state via `soma rollback --snapshot-id <prev-id>`, OR (2) re-extract content into source doc and re-sync.'
  };
}

/**
 * Build summary from findings array.
 */
function buildSummary(findings, totalEntries) {
  const byAction = { insert: 0, replace: 0, skip: 0, drift: 0 };
  for (const f of findings) {
    if (f.action in byAction) byAction[f.action]++;
  }
  return { total_entries: totalEntries, by_action: byAction };
}

// ---- Apply mode ----

// SANDBOX_VIOLATION safe-path prefix (Article III enforcement — SOMA_SAFE_PATHS_ONLY=1)
const SANDBOX_SAFE_PREFIX = '/tmp/soma-v2-test';

function runApplyMode(flags, somaHome, allFindings, totalEntries, adapters, useJson) {
  // AC-17: SANDBOX_VIOLATION — abort if SOMA_SAFE_PATHS_ONLY=1 and any target is outside sandbox.
  // GREEN phase: T-11 (sync.cjs sandbox enforcement check).
  // @spec AC-17
  if (process.env.SOMA_SAFE_PATHS_ONLY === '1') {
    const violatingTargets = allFindings
      .filter(f => f.action === 'insert' || f.action === 'replace' || f.action === 'drift')
      .map(f => f.target_path)
      .filter(tp => tp && !tp.startsWith(SANDBOX_SAFE_PREFIX));
    if (violatingTargets.length > 0) {
      const msg = `SANDBOX_VIOLATION: SOMA_SAFE_PATHS_ONLY=1 but target path(s) are outside ${SANDBOX_SAFE_PREFIX}: ${violatingTargets.slice(0, 3).join(', ')}`;
      if (useJson) {
        process.exitCode = 1;
        process.stdout.write(JSON.stringify({
          schema: 'soma-sync-apply/v1', mode: 'apply', snapshot: null, summary: null,
          error: { code: 'SANDBOX_VIOLATION', message: msg, details: { violating_targets: violatingTargets } }
        }, null, 2) + '\n');
      } else {
        process.stderr.write(`ERROR [SANDBOX_VIOLATION]: ${msg}\n`);
        process.exit(1);
      }
      return;
    }
  }

  // Filter actionable: insert, replace, and two drift sub-cases:
  //   (a) D4: manual edit detected (sha attr mismatch) — treated as "replace with LOCAL_EDITS_DETECTED warning"
  //   (b) Issue #11 / D-013-10: legacy marker upgrade — block exists with legacy markers but lacks
  //       id/version/sha256 attributes (Phase 3+ upgrade). Reuses 'replace' semantic via writeLegacyUpgrade.
  const actionableFindings = allFindings.filter(f =>
    f.action === 'insert' || f.action === 'replace' ||
    (f.action === 'drift' && f.message && f.message.includes('manual edit detected')) ||
    (f.action === 'drift' && f.message && f.message.includes('lacks id/version/sha256 attributes'))
  );

  // D2: validate ALL targets pre-write (anchor_error → ANCHOR_PARSE_ERROR)
  // Must check BEFORE noop check (anchor_error is not in actionableFindings)
  const anchorErrors = allFindings.filter(f => f.action === 'anchor_error');
  if (anchorErrors.length > 0) {
    const msg = anchorErrors[0].message;
    if (useJson) {
      process.exitCode = 1;
      process.stdout.write(JSON.stringify({
        schema: 'soma-sync-apply/v1', mode: 'apply', snapshot: null, summary: null,
        error: { code: 'ANCHOR_PARSE_ERROR', message: msg, details: null }
      }, null, 2) + '\n');
    } else {
      process.stderr.write(`ERROR [ANCHOR_PARSE_ERROR]: ${msg}\n`);
      process.exit(1);
    }
    return;
  }

  // AC-05: if no actionable findings (and no anchor errors), noop
  if (actionableFindings.length === 0) {
    const skipCount = allFindings.filter(f => f.action === 'skip').length;
    const summary = {
      by_action: { insert: 0, replace: 0, skip: skipCount },
      files_touched: [],
      warnings: []
    };
    if (useJson) {
      process.exitCode = 0;
      process.stdout.write(JSON.stringify({
        schema: 'soma-sync-apply/v1',
        mode: 'apply',
        snapshot: null,
        summary,
        error: null
      }, null, 2) + '\n');
    } else {
      process.exitCode = 0;
      process.stdout.write('Already in sync. Nothing to apply.\n');
    }
    return;
  }

  // BF-06: Pre-write conflict scan — abort on sha256 mismatch when --allow-local-edits not set.
  // Scans ALL actionable findings for anchor sha256 mismatch (manual edit inside block).
  // If any conflict found and --allow-local-edits is OFF: emit BLOCK_CONFLICT, exit 1, ZERO writes.
  // If --allow-local-edits is ON: skip this gate (warn-and-write behavior preserved below).
  // @spec AC-13 AC-14
  if (!flags.allowLocalEdits) {
    for (const f of actionableFindings) {
      const conflict = detectConflictInfo(f.target_path, f.target_anchor_id);
      if (conflict) {
        const errorMsg =
          `User manually edited content inside ${conflict.block_id} in ${conflict.file} between syncs. Aborting before write.`;
        if (useJson) {
          process.exitCode = 1;
          process.stdout.write(JSON.stringify({
            schema: 'soma-sync-apply/v1',
            mode: 'apply',
            snapshot: null,
            summary: { by_action: { insert: 0, replace: 0, skip: 0 }, files_touched: [], warnings: [] },
            error: {
              code: 'BLOCK_CONFLICT',
              message: errorMsg,
              details: conflict
            }
          }, null, 2) + '\n');
        } else {
          process.stderr.write(`ERROR [BLOCK_CONFLICT]: ${errorMsg}\n`);
          process.stderr.write(`  block_id:        ${conflict.block_id}\n`);
          process.stderr.write(`  file:            ${conflict.file}\n`);
          process.stderr.write(`  expected_sha256: ${conflict.expected_sha256}\n`);
          process.stderr.write(`  actual_sha256:   ${conflict.actual_sha256}\n`);
          process.stderr.write(`  resolution:      ${conflict.resolution_guidance}\n`);
          process.exit(1);
        }
        return;
      }
    }
  }

  // AC-07: SOURCE_STALE detection via env injection (testability hook)
  const injectStalePath = process.env.SOMA_TEST_INJECT_STALE;
  if (injectStalePath) {
    const staleTarget = actionableFindings.find(f => f.target_path === injectStalePath);
    if (staleTarget) {
      const msg = `Source file ${injectStalePath} changed between dry-run and apply phase (stale detection)`;
      if (useJson) {
        process.exitCode = 1;
        process.stdout.write(JSON.stringify({
          schema: 'soma-sync-apply/v1', mode: 'apply', snapshot: null, summary: null,
          error: { code: 'SOURCE_STALE', message: msg, details: null }
        }, null, 2) + '\n');
      } else {
        process.stderr.write(`ERROR [SOURCE_STALE]: ${msg}\n`);
        process.exit(1);
      }
      return;
    }
  }

  // AC-04: summary preview BEFORE write
  if (!useJson) {
    process.stdout.write('## Sync preview\n');
    for (const f of actionableFindings) {
      const adp = f.adapter || 'unknown';
      const relPath = path.basename(f.target_path);
      process.stdout.write(`- ${adp}/${relPath}: ${f.action}\n`);
    }
    process.stdout.write('\n');
  }

  // AC-02: create snapshot BEFORE any write.
  // Snapshot pre-existing files only (insert targets may not exist yet).
  // For pure-insert runs (no existing files), create an empty snapshot record
  // so callers always receive snapshot metadata in the JSON output.
  // GREEN phase: T-05 — snapshot always emitted (not null) for apply runs.
  const snapshotsBase = path.join(somaHome, '.snapshots');
  const snapshotFiles = actionableFindings
    .filter(f => fs.existsSync(f.target_path))
    .map(f => ({
      adapter: f.adapter || 'codex',
      targetPath: f.target_path,
      relativePath: path.basename(f.target_path)
    }));

  // AC-06: abort on snapshot failure (BEFORE any write).
  // Always call createSnapshot (even with empty files array) so apply output always
  // includes snapshot metadata per contract.
  let snapshotResult = null;
  try {
    snapshotResult = createSnapshot({ snapshotsBase, files: snapshotFiles });
  } catch (err) {
    if (err.code === 'SNAPSHOT_CREATE_FAILED') {
      if (useJson) {
        process.exitCode = 1;
        process.stdout.write(JSON.stringify({
          schema: 'soma-sync-apply/v1', mode: 'apply', snapshot: null, summary: null,
          error: { code: 'SNAPSHOT_CREATE_FAILED', message: err.message, details: null }
        }, null, 2) + '\n');
        return;
      } else {
        process.stderr.write(`ERROR [SNAPSHOT_CREATE_FAILED]: ${err.message}\n`);
        process.exit(1);
      }
    }
    throw err;
  }

  // --- WRITE PHASE ---
  const filesTouched = [];
  const warnings = [];
  const byAction = { insert: 0, replace: 0, skip: 0 };

  for (const f of actionableFindings) {
    // D4: detect local edits before writing (drift = manual edit detected)
    const isDrift = f.action === 'drift' && f.message && f.message.includes('manual edit detected');
    // Issue #11 / D-013-10: legacy marker upgrade drift
    const isLegacyUpgrade = f.action === 'drift' && f.message && f.message.includes('lacks id/version/sha256 attributes');

    if (isDrift) {
      // D4: drift with manual edit = local edits detected; warn loud + write anyway
      const snapFilePath = snapshotResult
        ? path.join(snapshotResult.snapDir, f.adapter || 'codex', path.basename(f.target_path))
        : '(snapshot unavailable)';
      warnings.push({
        code: 'LOCAL_EDITS_DETECTED',
        adapter: f.adapter,
        path: path.basename(f.target_path),
        message: `File has been modified outside SOMA since last snapshot. Pre-state preserved at ${snapFilePath}`
      });
      if (!useJson) {
        process.stdout.write(`WARNING [LOCAL_EDITS_DETECTED]: Local edits detected in ${f.target_path}. Pre-state preserved in snapshot.\n`);
      }
    } else if (f.action === 'replace') {
      // Also check for local edits on replace (sha attr mismatch via detectLocalEdits)
      const hasLocalEdits = detectLocalEdits(f.target_path, f.target_anchor_id);
      if (hasLocalEdits) {
        const snapFilePath = snapshotResult
          ? path.join(snapshotResult.snapDir, f.adapter || 'codex', path.basename(f.target_path))
          : '(snapshot unavailable)';
        warnings.push({
          code: 'LOCAL_EDITS_DETECTED',
          adapter: f.adapter,
          path: path.basename(f.target_path),
          message: `File has been modified outside SOMA since last snapshot. Pre-state preserved at ${snapFilePath}`
        });
        if (!useJson) {
          process.stdout.write(`WARNING [LOCAL_EDITS_DETECTED]: Local edits detected in ${f.target_path}. Pre-state preserved in snapshot.\n`);
        }
      }
    }

    const sourceDocAbs = path.join(somaHome, f.source_doc);
    const sourceBlock = extractBlock(sourceDocAbs, f.target_anchor_id);
    const blockContent = sourceBlock.found ? sourceBlock.content : fs.readFileSync(sourceDocAbs, 'utf8');
    const version = (sourceBlock.found && sourceBlock.attrs && sourceBlock.attrs.version) ? sourceBlock.attrs.version : '1.0';

    if (isLegacyUpgrade) {
      // Issue #11 / D-013-10: legacy marker upgrade path.
      // Uses writeLegacyUpgrade (regex-based replacement of <!-- shortname:start/end --> markers)
      // rather than writeBlock (which uses parseAnchorAttrs and cannot match legacy format).
      // source_block_content is already computed on the finding; use it directly for consistency.
      // source_block_content is always populated for legacy-upgrade drift findings
      // (computeEntryAction:413-416 sets it from the source doc).
      if (!f.source_block_content) {
        throw new Error('LEGACY_UPGRADE_INVARIANT: source_block_content missing on legacy drift finding');
      }
      const upgradeContent = f.source_block_content;
      writeLegacyUpgrade(f.target_path, f.target_anchor_id, upgradeContent);
    } else {
      // BF-01/BF-02: determine injection options (per-entry fields override tool defaults)
      // @spec AC-03 + BF-01 BF-02
      const toolDefaults = TOOL_DEFAULTS[f.adapter] || {};
      const injectionOptions = {
        wrapperSection: f.wrapper_section || toolDefaults.wrapperSection || null,
        positionBefore: f.position_before || toolDefaults.positionBefore || null
      };
      writeBlock(f.target_path, f.target_anchor_id, blockContent, version, injectionOptions);
    }

    // Normalize drift action to 'replace' in summary (it's a write operation)
    const actionLabel = (isDrift || isLegacyUpgrade) ? 'replace' : f.action;
    byAction[actionLabel] = (byAction[actionLabel] || 0) + 1;
    filesTouched.push({ adapter: f.adapter, path: path.basename(f.target_path), action: actionLabel });

    if (!useJson) {
      process.stdout.write(`  Writing ${f.adapter}/${path.basename(f.target_path)} [${f.action}]\n`);
    }
  }

  const snapshotOut = snapshotResult ? {
    timestamp: snapshotResult.timestamp,
    path: snapshotResult.snapDir,
    manifest_path: snapshotResult.manifestPath,
    files_count: snapshotResult.files_count,
    total_bytes: snapshotResult.total_bytes
  } : null;

  const summaryOut = { by_action: byAction, files_touched: filesTouched, warnings };

  // ---- Article IV evidence emission (AC-21) ----
  // Emits a structured JSON line BEFORE the main apply result JSON.
  // Only active when SOMA_EMIT_EVIDENCE=1 env is set (additive, does NOT affect
  // existing callers that parse stdout as JSON — those callers do not set this env).
  //
  // Evidence line schema:
  //   { event: "soma_apply_evidence", snapshot_path, manifest_sha256,
  //     post_write_sha256: { <absoluteFilePath>: <sha256> }, timestamp }
  //
  // @spec AC-21
  // @article Article-IV
  if (process.env.SOMA_EMIT_EVIDENCE === '1') {
    try {
      // Compute manifest_sha256: sha256 of manifest.json content
      let manifestSha256 = null;
      if (snapshotResult && snapshotResult.manifestPath && fs.existsSync(snapshotResult.manifestPath)) {
        const manifestContent = fs.readFileSync(snapshotResult.manifestPath);
        manifestSha256 = crypto.createHash('sha256').update(manifestContent).digest('hex');
      }

      // Compute post_write_sha256: sha256 of each written file (after write)
      const postWriteSha256 = {};
      for (const f of actionableFindings) {
        if (fs.existsSync(f.target_path)) {
          const fileContent = fs.readFileSync(f.target_path);
          postWriteSha256[f.target_path] = crypto.createHash('sha256').update(fileContent).digest('hex');
        }
      }

      const evidenceLine = {
        event:            'soma_apply_evidence',
        snapshot_path:    snapshotResult ? snapshotResult.snapDir : null,
        manifest_sha256:  manifestSha256,
        post_write_sha256: postWriteSha256,
        timestamp:        new Date().toISOString(),
      };
      process.stdout.write(JSON.stringify(evidenceLine) + '\n');
    } catch (_) {
      // Non-fatal: evidence emission failure must not abort the apply operation
    }
  }

  process.exitCode = 0;
  if (useJson) {
    process.stdout.write(JSON.stringify({
      schema: 'soma-sync-apply/v1',
      mode: 'apply',
      snapshot: snapshotOut,
      summary: summaryOut,
      error: null
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`\nApply complete. ${filesTouched.length} file(s) updated.\n`);
    if (warnings.length > 0) {
      for (const w of warnings) {
        process.stdout.write(`  WARNING [${w.code}]: ${w.message}\n`);
      }
    }
  }
}

// ---- Main ----

function main() {
  const { flags, errors } = parseArgs(process.argv.slice(2));
  const useJson = flags.json;

  if (errors.length > 0) {
    if (useJson) {
      process.exitCode = 2;
      process.stdout.write(JSON.stringify({
        schema: 'soma-sync-apply/v1',
        mode: flags.apply ? 'apply' : 'dry-run',
        snapshot: null,
        summary: null,
        error: { code: 'INVALID_ARGS', message: errors.join('; '), details: null }
      }, null, 2) + '\n');
    } else {
      process.stderr.write(`ERROR [INVALID_ARGS]: ${errors.join('; ')}\n`);
      process.exit(2);
    }
    return;
  }

  const somaHome = flags.somaHome || process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');

  try {
    loadManifest(somaHome);
  } catch (err) {
    emitHardError(err.code || 'MANIFEST_INVALID', err.message, useJson);
    return;
  }

  let adapters;
  if (flags.tool) {
    adapters = [flags.tool];
  } else {
    adapters = listAdapters(somaHome);
  }

  const allFindings = [];
  let totalEntries = 0;

  for (const adapter of adapters) {
    let targetsData;
    try {
      targetsData = loadInstallTargets(somaHome, adapter);
    } catch (err) {
      continue;
    }

    totalEntries += targetsData.entries.length;

    for (const entry of targetsData.entries) {
      const finding = computeEntryAction(entry, somaHome);
      finding.adapter = adapter;
      // BF-01/BF-02: propagate per-entry injection options (optional fields in install-targets entries)
      finding.wrapper_section = entry.wrapper_section || null;
      finding.position_before = entry.position_before || null;
      allFindings.push(finding);
    }
  }

  // ---- Auto-detect cbm/legacy markers and invoke migration if found (Spec 013, AC-12) ----
  if (flags.apply) {
    const migrate = require('./lib/migrate.cjs');
    const target = {
      claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
      codexAgents: path.join(os.homedir(), '.codex', 'AGENTS.md'),
      homeAgents: path.join(os.homedir(), 'AGENTS.md'),
    };
    const markers = detectLegacyMarkers(target);
    if (markers.hasCbm || markers.hasLegacy) {
      console.log('SOMA: cbm/legacy markers detected, running migration first...');
      const migrateResult = migrate.migrateCbmDeprecation({ somaHome, target, dryRun: false });
      if (migrateResult.action !== 'completed' && migrateResult.action !== 'noop') {
        console.error(`Migration failed: ${migrateResult.error || 'unknown'}`);
        process.exit(1);
      }
    }
  }

  // ---- APPLY mode ----
  if (flags.apply) {
    runApplyMode(flags, somaHome, allFindings, totalEntries, adapters, useJson);
    return;
  }

  // ---- DRY-RUN mode (Phase 2 preserved — AC-01) ----
  const summary = buildSummary(allFindings, totalEntries);
  const actionableFindings = allFindings.filter(f => f.action !== 'skip');
  const hasActions = actionableFindings.length > 0;

  process.exitCode = hasActions ? 1 : 0;
  if (useJson) {
    const output = {
      tool: 'sync',
      mode: 'dry-run',
      soma_home: somaHome,
      adapters_scanned: adapters,
      summary,
      findings: allFindings
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    process.stdout.write(`SOMA sync --dry-run — previewing edits per anchored block\n\n`);

    const displayFindings = flags.verbose ? allFindings : actionableFindings;

    if (!hasActions) {
      process.stdout.write('OK: All entries in sync. No actions needed.\n');
    } else {
      const skipCount = allFindings.length - actionableFindings.length;
      process.stdout.write(`ACTIONS: ${actionableFindings.length} finding(s)`);
      if (!flags.verbose && skipCount > 0) {
        process.stdout.write(` (${skipCount} skip suppressed; --verbose to show all)`);
      }
      process.stdout.write('\n');

      for (const f of displayFindings) {
        const label = humanActionLabel(f.action);
        const shortTarget = f.target_path.replace(os.homedir(), '~');
        process.stdout.write(`  ${label}    ${shortTarget} ← ${f.target_anchor_id} (source: ${f.source_doc})\n`);
      }
      process.stdout.write('\nRun with --apply to write changes.\n');
    }
  }
}

main();

// Export internal functions for testing (test harness only — not part of public API)
if (process.env.SOMA_TEST_EXPORTS === '1') {
  module.exports = { detectLegacyParseError, writeLegacyUpgrade };
}
