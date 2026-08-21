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
 *   computeShaSumsFromDir(dir, basenames)
 *     → Record<string,string>  — sha256 of each basename's shipped file
 *
 * CLI:
 *   node detect-collisions.cjs --target=DIR --soma-list=PATH (--soma-sums=PATH | --soma-dir=DIR)
 *   Prints collisions to stdout (one path per line), exits 0 on success.
 *   T-08c: --soma-sums and --soma-dir are NOT both optional — at least one
 *   sha reference is required, or the CLI exits 1 with a stderr message.
 *   Before this, an absent --soma-sums silently became {}, and every
 *   SOMA-listed hook in --target was reported as a collision.
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

/**
 * Compute a basename → sha256 map from real shipped files under `dir`,
 * for exactly the basenames named in `basenames`. Reuses sha256File() —
 * this is the alternative to a caller pre-generating a --soma-sums JSON
 * (T-08c): the caller (install.sh) just points at the real shipped
 * directory (core/hooks/) and this computes the reference itself.
 *
 * A basename with no corresponding file under `dir` is left OUT of the
 * returned map on purpose — detectCollisions()'s existing "no shipped sha
 * available" branch already handles that (a hook the map lists but that
 * doesn't exist on disk is itself worth flagging, not silently skipped).
 *
 * @param {string} dir
 * @param {string[]} basenames
 * @returns {Record<string,string>}
 */
function computeShaSumsFromDir(dir, basenames) {
  const sums = {};
  for (const basename of basenames) {
    const filePath = path.join(dir, `${basename}.cjs`);
    if (fs.existsSync(filePath)) {
      sums[basename] = sha256File(filePath);
    }
  }
  return sums;
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
  const somaDirPath = getArg('soma-dir');

  if (!targetDir || !somaListPath) {
    console.error('Usage: node detect-collisions.cjs --target=DIR --soma-list=PATH (--soma-sums=PATH | --soma-dir=DIR)');
    process.exit(1);
  }

  // T-08c: a missing sha reference must never silently become "compare
  // against nothing" — that is exactly what turned every SOMA-shipped
  // hook present in the user's real ~/.claude/hooks/ into a reported
  // collision (measured: 18 false positives vs 2 real ones, install.sh's
  // own call site never passed --soma-sums). Refuse to guess instead.
  if (!somaSumsPath && !somaDirPath) {
    console.error('Usage: node detect-collisions.cjs --target=DIR --soma-list=PATH (--soma-sums=PATH | --soma-dir=DIR)');
    console.error('[SOMA] detect-collisions: no sha reference given (neither --soma-sums nor --soma-dir) — refusing to run. Without one, every SOMA-listed hook present in --target would be reported as a collision with no way to distinguish a real local edit from noise.');
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

    const shaSums = somaSumsPath
      ? JSON.parse(fs.readFileSync(somaSumsPath, 'utf-8'))
      : computeShaSumsFromDir(somaDirPath, basenames);
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

module.exports = { detectCollisions, computeShaSumsFromDir };
