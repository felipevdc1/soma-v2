'use strict';
/**
 * install/targets.cjs — install-targets.json loader that understands BOTH
 * entry kinds (Spec 018, T-07 / D-018-06).
 *
 * `core/scripts/lib/manifest.cjs`'s loadInstallTargets()/
 * validateInstallTargetsSchema() are block-shaped: they require
 * block_id/source_doc/target_anchor_id on every entry and unconditionally
 * expandHome() every target_path. Both are wrong for a kind:"file" entry —
 * CONTRACT-FILE-ENTRY-01 FORBIDS those three fields on a file entry, and
 * CONTRACT-FILES-LEDGER-02 requires target_path to survive VERBATIM (the
 * ledger key). D-018-05 tried fixing manifest.cjs in place; the actual
 * blast radius (8 frozen-lib guards, one of them the functional G6 gate in
 * migrate.cjs, none of which "go green on merge") made that too expensive.
 * D-018-06 replaced it with this module: `core/scripts/lib/manifest.cjs`
 * stays BYTE-IDENTICAL to its frozen baseline.
 *
 * This is composition, not duplication: block entries are validated by
 * calling manifest.cjs's OWN exported `validateInstallTargetsSchema` (the
 * literal same function — if it changes, this call changes with it,
 * because there is no second copy of the logic to fall out of sync). File
 * entries are validated by install/files.cjs's `validateFileEntry` (T-01).
 * Neither validator is reimplemented here.
 *
 * @contract core/specs/018-install-whole-files/contracts/install-file-entry.md (CONTRACT-FILE-ENTRY-01)
 * @contract core/specs/018-install-whole-files/contracts/installed-files-ledger.md (CONTRACT-FILES-LEDGER-02)
 * @plan core/specs/018-install-whole-files/plan.md §D-018-06 (supersedes D-018-05)
 * @task T-07
 */

const fs = require('node:fs');
const path = require('node:path');

const { validateInstallTargetsSchema, expandHome } = require('../lib/manifest.cjs');
const { isFileEntry, validateFileEntry } = require('./files.cjs');

/**
 * Read + parse install-targets.json for a tool from
 * `<somaHome>/adapters/<tool>/install-targets.json`. This is the one
 * accepted duplication (D-018-06 §1): read file, strip `//` and `/* *\/`
 * comments, `JSON.parse`. It is NOT validation logic — manifest.cjs's
 * loadInstallTargets() does the identical ~4 lines, and there is no
 * schema/business decision here to diverge on.
 *
 * @param {string} somaHome
 * @param {string} tool
 * @returns {object} raw parsed JSON ({schema, tool?, entries})
 * @throws {Error} code INSTALL_TARGETS_INVALID on read/parse failure
 */
function readRawInstallTargets(somaHome, tool) {
  const targetsPath = path.join(somaHome, 'adapters', tool, 'install-targets.json');
  let raw;
  try {
    raw = fs.readFileSync(targetsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const e = new Error(`install-targets.json not found for tool "${tool}" at ${targetsPath}`);
      e.code = 'INSTALL_TARGETS_INVALID';
      throw e;
    }
    const e = new Error(`Failed to read install-targets.json for "${tool}": ${err.message}`);
    e.code = 'INSTALL_TARGETS_INVALID';
    throw e;
  }

  const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  try {
    return JSON.parse(stripped);
  } catch (err) {
    const e = new Error(`install-targets.json for "${tool}" is not valid JSON: ${err.message}`);
    e.code = 'INSTALL_TARGETS_INVALID';
    throw e;
  }
}

/**
 * Load + validate install-targets.json for a tool, understanding both
 * entry kinds (CONTRACT-FILE-ENTRY-01 §"Coexistência").
 *
 * Block entries (kind absent or "block"):
 *   - validated by manifest.cjs's own `validateInstallTargetsSchema`,
 *     called on `{schema, entries: <block-only slice>}` — same function,
 *     same error shape/behavior as loadInstallTargets() already has;
 *   - target_path expandHome()'d, exactly like loadInstallTargets() does.
 *
 * File entries (kind:"file"):
 *   - validated by install/files.cjs's `validateFileEntry`;
 *   - target_path returned VERBATIM — never expanded here. Expansion for
 *     touching the filesystem is install/files.cjs's own job
 *     (planFileInstall already does it), and the ledger key must be the
 *     un-expanded string (CONTRACT-FILES-LEDGER-02).
 *
 * Entry order is NOT preserved (block entries first, then file entries) —
 * no consumer of this module's output depends on install-targets.json's
 * original array order, and preserving it would require re-merging by
 * original index for no behavioral payoff.
 *
 * @param {string} somaHome
 * @param {string} tool
 * @param {{ repoRoot?: string }} [opts]  repoRoot for file-entry existence/
 *   escape checks (passed straight through to validateFileEntry). Defaults
 *   to somaHome — the same root block entries already resolve source_doc
 *   against (computeEntryAction in sync.cjs: `path.join(somaHome, source_doc)`).
 * @returns {{ schema: string, entries: object[] }}
 * @throws {Error} code INSTALL_TARGETS_INVALID (read/parse/block-shape), or
 *   a plain Error from validateFileEntry (file-shape — see files.cjs; it
 *   does not attach a `.code`, matching its existing contract tests).
 */
function loadInstallTargetsWithKinds(somaHome, tool, opts = {}) {
  const data = readRawInstallTargets(somaHome, tool);
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    const e = new Error(`install-targets.json for "${tool}" missing required "entries" array`);
    e.code = 'INSTALL_TARGETS_INVALID';
    throw e;
  }

  const blockEntriesRaw = data.entries.filter((e) => !isFileEntry(e));
  const fileEntriesRaw = data.entries.filter((e) => isFileEntry(e));

  // Composition (D-018-06): the literal function manifest.cjs exports,
  // not a reimplementation of its rules.
  validateInstallTargetsSchema({ schema: data.schema, entries: blockEntriesRaw });

  const repoRoot = opts.repoRoot || somaHome;
  const validatedFileEntries = fileEntriesRaw.map((entry) => validateFileEntry(entry, { repoRoot }));

  const expandedBlockEntries = blockEntriesRaw.map((entry) => ({
    ...entry,
    target_path: expandHome(entry.target_path),
  }));

  return {
    schema: data.schema,
    entries: [...expandedBlockEntries, ...validatedFileEntries],
  };
}

module.exports = {
  readRawInstallTargets,
  loadInstallTargetsWithKinds,
};
