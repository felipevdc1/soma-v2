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
 *   recoveryDir: string,
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
  const recoveryDir = path.join(somaDir, 'recovery');

  const resolved = {
    projectRoot,
    somaDir,
    reportsDir,
    dispatchesDir,
    recoveryDir,
    installStateFile: path.join(somaDir, 'install-state.json'),
    legacy: isLegacyProject(projectRoot),
  };

  if (runId) {
    resolved.runReportsDir = path.join(reportsDir, runId);
    resolved.runDispatchesDir = path.join(dispatchesDir, runId);
    resolved.runRecoveryDir = path.join(recoveryDir, runId);
    resolved.runStateFile = path.join(somaDir, `run-state-${runId}.json`);
  }

  return resolved;
}

// ── .soma.lock resolution (Spec 016 K3 fixup) ──────────────────────────────
//
// `report.cjs`, `gate.cjs`, and `state.cjs` each grew their own runId-from-
// `.soma.lock` check in Wave 2, independently, with three different rules:
//   - report.cjs: distinct error per failure mode (unreadable / bad JSON /
//     invalid shape), citing soma-run.md §0.3 — the strictest ERROR
//     REPORTING, but a plain `typeof lock.runId !== 'string'` shape check.
//   - gate.cjs: `lock.runId || null` — the LOOSEST shape check (a falsy-
//     but-present runId, or any non-string truthy value, slips through
//     un-typechecked).
//   - state.cjs: `typeof lock.runId === 'string' && lock.runId.length > 0`
//     — the strictest SHAPE check of the three.
//
// This function is the single source of truth for the shape check —
// state.cjs's rule, chosen because it is the only one of the three that
// rejects every malformed runId value (non-string, empty string) rather
// than silently accepting some of them. `.soma.lock` itself is a PRE-
// EXISTING mechanism (soma-run.md §0.3, `{sessionId, runId, startedAt}`),
// not invented here.
//
// It returns a discriminated result instead of exiting or returning a bare
// null, so each of the three call sites can keep producing ITS OWN
// CLI-facing message (report.cjs's three distinct reasons; gate.cjs's and
// state.cjs's single generic "unresolved" message) without re-implementing
// the file-read / JSON-parse / shape-check chain three times.
/**
 * @param {string} projectRoot
 * @returns {
 *   {status: 'ok', runId: string} |
 *   {status: 'unreadable', lockPath: string} |
 *   {status: 'invalid_json', lockPath: string} |
 *   {status: 'invalid_run_id', lockPath: string}
 * }
 */
function resolveRunIdFromLock(projectRoot) {
  const lockPath = path.join(projectRoot, '.soma.lock');

  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (_err) {
    return { status: 'unreadable', lockPath };
  }

  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (_err) {
    return { status: 'invalid_json', lockPath };
  }

  if (!lock || typeof lock.runId !== 'string' || lock.runId.length === 0) {
    return { status: 'invalid_run_id', lockPath };
  }

  return { status: 'ok', runId: lock.runId };
}

module.exports = { isLegacyProject, resolveSomaPaths, resolveRunIdFromLock };
