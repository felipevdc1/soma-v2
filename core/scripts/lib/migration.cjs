'use strict';
/**
 * migration.cjs — SOMA v2.1 OLD-format marker detection
 *
 * Detects pre-soma-v2 anchor markers in target bootloader files.
 *
 * OLD format (detected):
 *   <!-- NAME:start -->
 *   ...content...
 *   <!-- NAME:end -->
 *   where NAME matches [a-z0-9][a-z0-9-]* and is NOT 'soma-v2'
 *
 * NEW format (NOT detected — current-gen anchors):
 *   <!-- soma-v2:start id=BLOCKID version=VER sha256=HEX -->
 *   ...content...
 *   <!-- soma-v2:end id=BLOCKID -->
 *
 * @spec AC-10 AC-11 AC-12
 * @contract CONTRACT-011-03-doctor-migration-check
 * @phase GREEN (T-08)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Default scan paths for migration check (real bootloader files).
 * Overridden by SOMA_MIGRATION_SCAN_PATHS env var (colon-separated).
 */
const DEFAULT_SCAN_PATHS = [
  path.join(os.homedir(), '.codex', 'AGENTS.md'),
  path.join(os.homedir(), 'AGENTS.md'),
  path.join(os.homedir(), '.claude', 'CLAUDE.md'),
];

/**
 * Safe path prefix for sandbox enforcement (SOMA_SAFE_PATHS_ONLY=1).
 */
const SAFE_PATH_PREFIXES = [
  '/tmp/',
  os.tmpdir(),
];

/**
 * Check whether a path is within a sandbox-safe location.
 * @param {string} filePath
 * @returns {boolean}
 */
function isSafePath(filePath) {
  const resolved = path.resolve(filePath);
  return SAFE_PATH_PREFIXES.some(prefix => resolved.startsWith(prefix));
}

/**
 * Detect OLD-format markers in file content.
 *
 * Matches <!-- NAME:start --> where NAME is [a-z0-9][a-z0-9-]* and NOT 'soma-v2'.
 * The strict pattern (no extra attrs between :start and -->) naturally excludes
 * soma-v2 new-format anchors (which always have id=... attrs). The name exclusion
 * is an explicit belt-and-suspenders check.
 *
 * @param {string} content - file text to scan
 * @returns {Array<{marker_name: string, byte_position_start: number, byte_position_end: number}>}
 */
function detectOldMarkersInContent(content) {
  const results = [];

  // Strict match: <!-- NAME:start --> with only whitespace, no extra attrs.
  // This naturally excludes <!-- soma-v2:start id=... --> (has attrs after :start).
  const startRe = /<!--\s+([a-z0-9][a-z0-9-]*):start\s+-->/g;

  let m;
  while ((m = startRe.exec(content)) !== null) {
    const markerName = m[1];

    // Belt-and-suspenders: exclude 'soma-v2' name explicitly
    if (markerName === 'soma-v2') continue;

    const posStart = m.index;
    const endTag = `<!-- ${markerName}:end -->`;
    const endSearchFrom = posStart + m[0].length;
    const endIdx = content.indexOf(endTag, endSearchFrom);

    const posEnd = endIdx !== -1
      ? endIdx + endTag.length
      : posStart + m[0].length;

    results.push({
      marker_name: markerName,
      byte_position_start: posStart,
      byte_position_end: posEnd,
    });
  }

  return results;
}

/**
 * Resolve the list of file paths to scan for OLD markers.
 *
 * Priority:
 * 1. SOMA_MIGRATION_SCAN_PATHS env var (colon-separated absolute paths) — used in tests/sandbox
 * 2. DEFAULT_SCAN_PATHS — real bootloader paths (~/.codex/AGENTS.md, ~/AGENTS.md, ~/.claude/CLAUDE.md)
 *
 * Sandbox enforcement: when SOMA_SAFE_PATHS_ONLY=1 and no SOMA_MIGRATION_SCAN_PATHS override,
 * returns [] to skip real-path scanning (read-only, but sandbox rule applied uniformly).
 *
 * @returns {string[]}
 */
function resolveScanPaths() {
  const envPaths = process.env.SOMA_MIGRATION_SCAN_PATHS;
  const safeOnly = process.env.SOMA_SAFE_PATHS_ONLY === '1';

  if (envPaths && envPaths.trim()) {
    return envPaths.split(':').filter(p => p.trim()).map(p => p.trim());
  }

  if (safeOnly) {
    // SOMA_SAFE_PATHS_ONLY=1 with no override → skip real paths (sandbox enforcement)
    return [];
  }

  return DEFAULT_SCAN_PATHS;
}

/**
 * Scan a list of file paths for OLD-format markers.
 *
 * @param {string[]} filePaths - absolute paths to scan (resolved by caller or resolveScanPaths())
 * @returns {{
 *   migration_needed: boolean,
 *   old_markers_detected: number,
 *   old_markers_by_file?: Record<string, Array<{marker_name: string, byte_position_start: number, byte_position_end: number}>>,
 *   scanned_files: string[],
 *   migration_command_hint?: string,
 * }}
 */
function scanFilesForOldMarkers(filePaths) {
  /** @type {Record<string, Array<{marker_name: string, byte_position_start: number, byte_position_end: number}>>} */
  const oldMarkersByFile = {};
  const scannedFiles = [];
  let totalDetected = 0;

  for (const filePath of filePaths) {
    scannedFiles.push(filePath);

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      // File unreadable / not found → skip silently
      continue;
    }

    const markers = detectOldMarkersInContent(content);
    if (markers.length > 0) {
      oldMarkersByFile[filePath] = markers;
      totalDetected += markers.length;
    }
  }

  const migrationNeeded = totalDetected > 0;

  /** @type {any} */
  const result = {
    migration_needed: migrationNeeded,
    old_markers_detected: totalDetected,
    scanned_files: scannedFiles,
  };

  if (migrationNeeded) {
    result.old_markers_by_file = oldMarkersByFile;
    result.migration_command_hint =
      'Run `soma sync --apply --tool=codex --migrate` to convert OLD markers to soma-v2 v2 anchors em-place (auto-snapshot preserves OLD content for rollback).';
  }

  return result;
}

/**
 * Run a full migration check: resolve paths, scan, return structured result.
 * Convenience wrapper used by doctor.cjs.
 *
 * @returns {ReturnType<typeof scanFilesForOldMarkers>}
 */
function runMigrationCheck() {
  const paths = resolveScanPaths();
  return scanFilesForOldMarkers(paths);
}

module.exports = {
  detectOldMarkersInContent,
  scanFilesForOldMarkers,
  resolveScanPaths,
  runMigrationCheck,
  DEFAULT_SCAN_PATHS,
};
