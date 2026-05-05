'use strict';
/**
 * manifest.cjs — SOMA v2.1 manifest + install-targets loaders
 *
 * Loads and validates schema v1 manifest.json and install-targets.json.
 * Throws typed errors on validation failure.
 *
 * @module manifest
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Expand ~ to home directory in a path string.
 * @param {string} p
 * @returns {string}
 */
function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Validate manifest schema v1.
 * @param {any} data
 * @throws {Error} with code MANIFEST_INVALID if validation fails
 */
function validateManifestSchema(data) {
  if (!data || typeof data !== 'object') {
    const err = new Error('manifest.json is not an object');
    err.code = 'MANIFEST_INVALID';
    throw err;
  }
  if (data.schema !== 'soma-manifest/v1') {
    const err = new Error(`manifest.json has unexpected schema: ${data.schema} (expected soma-manifest/v1)`);
    err.code = 'MANIFEST_INVALID';
    throw err;
  }
  if (!Array.isArray(data.files)) {
    const err = new Error('manifest.json missing required "files" array');
    err.code = 'MANIFEST_INVALID';
    throw err;
  }
}

/**
 * Validate install-targets schema v1.
 * @param {any} data
 * @throws {Error} with code INSTALL_TARGETS_INVALID if validation fails
 */
function validateInstallTargetsSchema(data) {
  if (!data || typeof data !== 'object') {
    const err = new Error('install-targets.json is not an object');
    err.code = 'INSTALL_TARGETS_INVALID';
    throw err;
  }
  if (data.schema !== 'soma-install-targets/v1') {
    const err = new Error(`install-targets.json has unexpected schema: ${data.schema} (expected soma-install-targets/v1)`);
    err.code = 'INSTALL_TARGETS_INVALID';
    throw err;
  }
  if (!Array.isArray(data.entries)) {
    const err = new Error('install-targets.json missing required "entries" array');
    err.code = 'INSTALL_TARGETS_INVALID';
    throw err;
  }
  // Validate each entry has required fields
  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i];
    const missing = ['block_id', 'source_doc', 'target_path', 'target_anchor_id'].filter(f => !entry[f]);
    if (missing.length > 0) {
      const err = new Error(`install-targets.json entry[${i}] missing fields: ${missing.join(', ')}`);
      err.code = 'INSTALL_TARGETS_INVALID';
      throw err;
    }
  }
}

/**
 * Load and validate manifest.json from SOMA_HOME.
 * @param {string} somaHome - path to SOMA home directory
 * @returns {object} parsed + validated manifest data
 * @throws {Error} with code MANIFEST_MISSING or MANIFEST_INVALID
 */
function loadManifest(somaHome) {
  const manifestPath = path.join(somaHome, 'manifest.json');
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const e = new Error(`manifest.json not found at ${manifestPath}`);
      e.code = 'MANIFEST_MISSING';
      throw e;
    }
    const e = new Error(`Failed to read manifest.json: ${err.message}`);
    e.code = 'MANIFEST_INVALID';
    throw e;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`manifest.json is not valid JSON: ${err.message}`);
    e.code = 'MANIFEST_INVALID';
    throw e;
  }

  validateManifestSchema(data);
  return data;
}

/**
 * Load and validate install-targets.json for a given adapter tool.
 * @param {string} somaHome - path to SOMA home directory
 * @param {string} tool - adapter name (e.g., 'codex', 'claude')
 * @returns {object} parsed + validated install-targets data with expanded paths
 * @throws {Error} with code INSTALL_TARGETS_INVALID
 */
function loadInstallTargets(somaHome, tool) {
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

  // Handle JSON with comments (/* ... */) - strip them before parsing
  const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  let data;
  try {
    data = JSON.parse(stripped);
  } catch (err) {
    const e = new Error(`install-targets.json for "${tool}" is not valid JSON: ${err.message}`);
    e.code = 'INSTALL_TARGETS_INVALID';
    throw e;
  }

  validateInstallTargetsSchema(data);

  // Expand ~ in target_path for all entries
  const expandedData = {
    ...data,
    entries: data.entries.map(entry => ({
      ...entry,
      target_path: expandHome(entry.target_path)
    }))
  };

  return expandedData;
}

/**
 * List available adapter directories in SOMA_HOME.
 * @param {string} somaHome
 * @returns {string[]} adapter names (directory names under adapters/)
 */
function listAdapters(somaHome) {
  const adaptersDir = path.join(somaHome, 'adapters');
  try {
    return fs.readdirSync(adaptersDir)
      .filter(name => {
        if (name.startsWith('_')) return false;
        const stat = fs.statSync(path.join(adaptersDir, name));
        return stat.isDirectory();
      });
  } catch (err) {
    return [];
  }
}

module.exports = {
  loadManifest,
  loadInstallTargets,
  listAdapters,
  expandHome,
  validateManifestSchema,
  validateInstallTargetsSchema
};
