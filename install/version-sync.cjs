'use strict';

/**
 * install/version-sync.cjs — propagate VERSION file to all manifests
 *
 * Version is single-sourced in `VERSION` (root). This helper reads it
 * and propagates to: .claude-plugin/plugin.json, package.json, core/manifest.json
 *
 * Public API:
 *   syncVersions(opts?)  → { version, updated: string[], skipped: string[] }
 *   checkDrift(opts?)    → { ok, version, drifted: [{file, found, expected}], message }
 *
 * CLI:
 *   node version-sync.cjs          — sync (propagate VERSION to all 3 manifests)
 *   node version-sync.cjs --check  — check drift, exit 1 if detected
 *   node version-sync.cjs --help   — print usage and exit 0 (pure read, no mutations)
 *   node version-sync.cjs -h       — alias for --help
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Read and trim VERSION file.
 * @param {string} repoRoot
 * @returns {string}
 */
function readVersion(repoRoot) {
  const versionFile = path.join(repoRoot, 'VERSION');
  if (!fs.existsSync(versionFile)) {
    throw new Error(`VERSION file not found at ${versionFile}`);
  }
  return fs.readFileSync(versionFile, 'utf-8').trim();
}

/**
 * Update version field in a JSON manifest file.
 * Preserves all other fields. Returns true if file was written, false if already up to date.
 *
 * @param {string} filePath
 * @param {string} version
 * @returns {boolean} true if written, false if already current
 */
function updateManifestVersion(filePath, version) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const manifest = JSON.parse(raw);

  if (manifest.version === version) {
    return false; // already up to date — idempotent
  }

  manifest.version = version;
  const out = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(filePath, out);
  return true;
}

/**
 * Propagate VERSION to all 3 manifests.
 *
 * @param {{ repoRoot?: string }} [opts]
 * @returns {{ version: string, updated: string[], skipped: string[] }}
 */
function syncVersions(opts) {
  opts = opts || {};
  const repoRoot = opts.repoRoot || process.cwd();

  const version = readVersion(repoRoot);

  const manifests = [
    path.join(repoRoot, '.claude-plugin', 'plugin.json'),
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'core', 'manifest.json')
  ];

  const updated = [];
  const skipped = [];

  for (const manifestPath of manifests) {
    const wasUpdated = updateManifestVersion(manifestPath, version);
    if (wasUpdated) {
      updated.push(manifestPath);
    } else {
      skipped.push(manifestPath);
    }
  }

  return { version, updated, skipped };
}

/**
 * Check for version drift across all manifests.
 *
 * @param {{ repoRoot?: string }} [opts]
 * @returns {{ ok: boolean, version: string, drifted: Array<{file, found, expected}>, message: string }}
 */
function checkDrift(opts) {
  opts = opts || {};
  const repoRoot = opts.repoRoot || process.cwd();

  const version = readVersion(repoRoot);

  const manifests = [
    path.join(repoRoot, '.claude-plugin', 'plugin.json'),
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'core', 'manifest.json')
  ];

  const drifted = [];

  for (const manifestPath of manifests) {
    if (!fs.existsSync(manifestPath)) {
      drifted.push({ file: manifestPath, found: null, expected: version });
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.version !== version) {
        drifted.push({ file: manifestPath, found: manifest.version, expected: version });
      }
    } catch (e) {
      drifted.push({ file: manifestPath, found: null, expected: version });
    }
  }

  const ok = drifted.length === 0;
  const message = ok
    ? `All manifests at version ${version}`
    : `Version drift detected (expected ${version}): ${drifted.map(d => `${path.basename(d.file)}=${d.found}`).join(', ')}`;

  return { ok, version, drifted, message };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const isHelp = args.includes('--help') || args.includes('-h');
  const isCheck = args.includes('--check');

  if (isHelp) {
    process.stdout.write([
      'Usage:',
      '  node version-sync.cjs          — sync (propagate VERSION to all 3 manifests)',
      '  node version-sync.cjs --check  — check drift, exit 1 if detected',
      '  node version-sync.cjs --help   — print this usage and exit 0',
      '  node version-sync.cjs -h       — alias for --help',
      '',
    ].join('\n'));
    process.exit(0);
  }

  try {
    if (isCheck) {
      const result = checkDrift();
      if (result.ok) {
        process.stdout.write(`[SOMA] ${result.message}\n`);
        process.exit(0);
      } else {
        process.stderr.write(`[SOMA] ERROR: ${result.message}\n`);
        for (const d of result.drifted) {
          process.stderr.write(`  - ${d.file}: found=${d.found} expected=${d.expected}\n`);
        }
        process.exit(1);
      }
    } else {
      const result = syncVersions();
      process.stdout.write(`[SOMA] Version sync: ${result.version}\n`);
      if (result.updated.length > 0) {
        process.stdout.write(`  Updated: ${result.updated.map(p => path.basename(path.dirname(p)) + '/' + path.basename(p)).join(', ')}\n`);
      }
      if (result.skipped.length > 0) {
        process.stdout.write(`  Already current: ${result.skipped.map(p => path.basename(p)).join(', ')}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`[SOMA] version-sync error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { syncVersions, checkDrift };
