'use strict';

/**
 * install/detect-collisions.cjs — detect user hook files that conflict with SOMA
 *
 * A "collision" = a .cjs file in targetDir whose basename matches a SOMA-CORE hook
 * AND whose sha256 differs from the SOMA shipped version (user has local modifications).
 *
 * Public API:
 *   detectCollisions(targetDir, somaBasenames, somaShaSums)
 *     → Array<{ path: string, reason: string }>
 *
 * CLI:
 *   node detect-collisions.cjs --target=DIR --soma-list=PATH [--soma-sums=PATH]
 *   Prints collisions to stdout (one JSON per line), exits 0 always.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Compute sha256 of a file.
 * @param {string} filePath
 * @returns {string} hex digest
 */
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Detect collisions between user hooks and SOMA-CORE hooks.
 *
 * @param {string} targetDir       - Directory to scan (e.g. ~/.claude/hooks/)
 * @param {string[]} somaBasenames - Basenames of SOMA-CORE hooks (no ext, e.g. 'thermal-guard')
 * @param {Record<string,string>} somaShaSums  - Map of basename → sha256 of shipped SOMA version
 * @returns {Array<{ path: string, reason: string }>}
 */
function detectCollisions(targetDir, somaBasenames, somaShaSums) {
  // Will throw if directory doesn't exist — callers handle this
  const entries = fs.readdirSync(targetDir);

  const somaSet = new Set(somaBasenames);
  const collisions = [];

  for (const entry of entries) {
    if (!entry.endsWith('.cjs')) continue;

    const basename = entry.slice(0, -4); // strip .cjs
    if (!somaSet.has(basename)) continue; // not a SOMA hook → skip

    const filePath = path.join(targetDir, entry);

    // If we have no sha reference for this basename, flag as unknown collision
    if (!(basename in somaShaSums)) {
      collisions.push({
        path: filePath,
        reason: `Hook '${basename}' is in SOMA list but no shipped sha available for comparison — treat as potential collision`
      });
      continue;
    }

    const userSha = sha256File(filePath);
    const shippedSha = somaShaSums[basename];

    if (userSha !== shippedSha) {
      collisions.push({
        path: filePath,
        reason: `Hook '${basename}' has local modifications (user sha=${userSha.slice(0, 12)}... shipped sha=${shippedSha.slice(0, 12)}...)`
      });
    }
    // identical sha → not a collision, continue
  }

  return collisions;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(name) {
    const prefix = `--${name}=`;
    for (const a of args) {
      if (a.startsWith(prefix)) return a.slice(prefix.length);
    }
    return undefined;
  }

  const targetDir = getArg('target');
  const somaListPath = getArg('soma-list');
  const somaSumsPath = getArg('soma-sums');

  if (!targetDir || !somaListPath) {
    console.error('Usage: node detect-collisions.cjs --target=DIR --soma-list=PATH [--soma-sums=PATH]');
    process.exit(1);
  }

  try {
    // soma-list is expected to be a JSON array of basenames OR soma-hooks-map.json
    const listRaw = JSON.parse(fs.readFileSync(somaListPath, 'utf-8'));
    let basenames;
    if (Array.isArray(listRaw)) {
      basenames = listRaw;
    } else if (listRaw.hooks) {
      // soma-hooks-map.json — extract all unique hook basenames
      const set = new Set();
      for (const entries of Object.values(listRaw.hooks)) {
        for (const entry of entries) {
          for (const h of (entry.hooks || [])) {
            const m = h.command && h.command.match(/\/([^/]+)\.cjs/);
            if (m) set.add(m[1]);
          }
        }
      }
      basenames = [...set];
    } else {
      throw new Error('soma-list must be a JSON array or soma-hooks-map.json');
    }

    const shaSums = somaSumsPath ? JSON.parse(fs.readFileSync(somaSumsPath, 'utf-8')) : {};
    const collisions = detectCollisions(targetDir, basenames, shaSums);

    if (collisions.length === 0) {
      console.log('No collisions detected.');
    } else {
      for (const c of collisions) {
        console.log(c.path);
      }
    }
  } catch (err) {
    console.error('[SOMA] detect-collisions error:', err.message);
    process.exit(1);
  }
}

module.exports = { detectCollisions };
