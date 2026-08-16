'use strict';
/**
 * run/paths.cjs — project + .soma/ path resolution for the `soma run` primitive.
 *
 * Owns:
 *   - resolving {projectRoot}/.soma/ and its runtime subpaths (reports/,
 *     dispatches/, run-state-{runId}.json)
 *   - detecting a legacy project (no .soma/ directory) — AC-08
 *
 * Does NOT own: the behavior of legacy mode itself (that's T-14, which
 * consumes isLegacyProject() without editing this file).
 *
 * ⚠️ Never hardcode a tmp-directory literal. On this machine os.tmpdir()
 * does not resolve to the conventional Unix tmp path — getting this wrong
 * has produced false-green twice already in this phase (2026-08-14/15).
 * This module never references a temp directory directly; it only resolves
 * paths relative to the projectRoot it is given.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} projectRoot absolute path to the project root
 * @returns {boolean} true when the project has no .soma/ directory yet
 */
function isLegacyProject(projectRoot) {
  const somaDir = path.join(projectRoot, '.soma');
  try {
    return !fs.statSync(somaDir).isDirectory();
  } catch (_err) {
    return true; // absent, unreadable, or not a directory → legacy
  }
}

/**
 * Resolve every .soma/ path this phase's artifacts live under.
 *
 * @param {string} projectRoot absolute path to the project root
 * @param {string} [runId] when given, also resolves the per-run subpaths
 * @returns {{
 *   projectRoot: string,
 *   somaDir: string,
 *   reportsDir: string,
 *   dispatchesDir: string,
 *   installStateFile: string,
 *   legacy: boolean,
 *   runReportsDir?: string,
 *   runDispatchesDir?: string,
 *   runStateFile?: string,
 * }}
 */
function resolveSomaPaths(projectRoot, runId) {
  const somaDir = path.join(projectRoot, '.soma');
  const reportsDir = path.join(somaDir, 'reports');
  const dispatchesDir = path.join(somaDir, 'dispatches');

  const resolved = {
    projectRoot,
    somaDir,
    reportsDir,
    dispatchesDir,
    installStateFile: path.join(somaDir, 'install-state.json'),
    legacy: isLegacyProject(projectRoot),
  };

  if (runId) {
    resolved.runReportsDir = path.join(reportsDir, runId);
    resolved.runDispatchesDir = path.join(dispatchesDir, runId);
    resolved.runStateFile = path.join(somaDir, `run-state-${runId}.json`);
  }

  return resolved;
}

module.exports = { isLegacyProject, resolveSomaPaths };
