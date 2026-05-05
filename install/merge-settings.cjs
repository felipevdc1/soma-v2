'use strict';

/**
 * install/merge-settings.cjs — idempotent SOMA hooks merge into Claude settings.json
 *
 * Public API:
 *   mergeSettings(targetPath, somaHooksMap, opts?)  → { added, skipped, backupPath }
 *   uninstallSomaEntries(targetPath)                → { removed }
 *
 * CLI:
 *   node merge-settings.cjs --target=PATH [--map=PATH] [--uninstall] [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');

const SOMA_TAG = '_soma_managed';

/**
 * Deep-clone an object via JSON round-trip.
 * @param {any} obj
 * @returns {any}
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge SOMA hook entries into an existing settings.json.
 *
 * @param {string} targetPath     - Absolute path to settings.json
 * @param {object} somaHooksMap   - Parsed soma-hooks-map.json
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ added: number, skipped: number, backupPath: string|null }}
 */
function mergeSettings(targetPath, somaHooksMap, opts) {
  const dryRun = opts && opts.dryRun === true;

  // Read + parse existing settings (throws SyntaxError on malformed — intentional)
  let existing;
  if (fs.existsSync(targetPath)) {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    existing = JSON.parse(raw); // throws SyntaxError on bad JSON — file not touched
  } else {
    existing = {};
  }

  // Backup (only when not dry-run, only when file exists)
  let backupPath = null;
  if (!dryRun && fs.existsSync(targetPath)) {
    backupPath = `${targetPath}.pre-soma-${Date.now()}.bak`;
    fs.copyFileSync(targetPath, backupPath);
  }

  // Ensure hooks container
  existing.hooks = existing.hooks || {};

  let added = 0;
  let skipped = 0;

  for (const [event, somaEntries] of Object.entries(somaHooksMap.hooks)) {
    existing.hooks[event] = existing.hooks[event] || [];

    for (const somaEntry of somaEntries) {
      // Deep-clone to avoid mutating the input map
      const tagged = deepClone(somaEntry);
      tagged[SOMA_TAG] = true;

      // Idempotency check: skip if an existing SOMA-managed entry shares ANY command path
      const isDup = existing.hooks[event].some(e => {
        if (e[SOMA_TAG] !== true) return false;
        return e.hooks && tagged.hooks && e.hooks.some(h =>
          tagged.hooks.some(sh => sh.command === h.command)
        );
      });

      if (!isDup) {
        existing.hooks[event].push(tagged);
        added++;
      } else {
        skipped++;
      }
    }
  }

  // Validate JSON round-trip before writing
  const out = JSON.stringify(existing, null, 2);
  JSON.parse(out); // throws if somehow corrupted

  if (!dryRun) {
    fs.writeFileSync(targetPath, out);
  }

  return { added, skipped, backupPath };
}

/**
 * Remove all SOMA-managed entries from settings.json.
 * User's custom entries (no _soma_managed tag) are preserved byte-exact.
 *
 * @param {string} targetPath
 * @returns {{ removed: number }}
 */
function uninstallSomaEntries(targetPath) {
  const raw = fs.readFileSync(targetPath, 'utf-8');
  const existing = JSON.parse(raw);

  let removed = 0;

  if (existing.hooks) {
    for (const event of Object.keys(existing.hooks)) {
      const before = existing.hooks[event].length;
      existing.hooks[event] = existing.hooks[event].filter(e => e[SOMA_TAG] !== true);
      removed += before - existing.hooks[event].length;

      // Clean empty arrays
      if (existing.hooks[event].length === 0) {
        delete existing.hooks[event];
      }
    }

    // Clean empty hooks container
    if (Object.keys(existing.hooks).length === 0) {
      delete existing.hooks;
    }
  }

  const out = JSON.stringify(existing, null, 2);
  JSON.parse(out); // safety validate
  fs.writeFileSync(targetPath, out);

  return { removed };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(name) {
    const prefix = `--${name}=`;
    const flag = `--${name}`;
    for (const a of args) {
      if (a.startsWith(prefix)) return a.slice(prefix.length);
      if (a === flag) return true;
    }
    return undefined;
  }

  const targetPath = getArg('target');
  const mapPath = getArg('map');
  const uninstall = getArg('uninstall') === true;
  const dryRun = getArg('dry-run') === true;

  if (!targetPath) {
    console.error('Usage: node merge-settings.cjs --target=PATH [--map=PATH] [--uninstall] [--dry-run]');
    process.exit(1);
  }

  try {
    if (uninstall) {
      const result = uninstallSomaEntries(targetPath);
      console.log(`[SOMA] Uninstalled ${result.removed} SOMA-managed hook entries`);
    } else {
      const somaMapPath = mapPath || path.join(__dirname, 'soma-hooks-map.json');
      const somaHooksMap = JSON.parse(fs.readFileSync(somaMapPath, 'utf-8'));
      const result = mergeSettings(targetPath, somaHooksMap, { dryRun });
      if (dryRun) {
        console.log(`[SOMA dry-run] Would add ${result.added} entries, skip ${result.skipped} duplicates`);
      } else {
        console.log(`[SOMA] Merged: added=${result.added} skipped=${result.skipped} backup=${result.backupPath}`);
      }
    }
  } catch (err) {
    console.error('[SOMA] merge-settings error:', err.message);
    process.exit(1);
  }
}

module.exports = { mergeSettings, uninstallSomaEntries };
