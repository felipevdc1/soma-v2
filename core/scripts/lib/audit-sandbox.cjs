'use strict';
// audit-sandbox.cjs — SOMA audit sandbox enforcement (Spec 012 T-05)
// @spec AC-02, AC-14

const path = require('node:path');
const os = require('node:os');

const SOMA_SCRIPTS_PATH = path.join(os.homedir(), '.soma-v2', 'scripts');

/**
 * Check if module path is within the allowed sandbox.
 * Only enforced when SOMA_SAFE_PATHS_ONLY=1.
 * Per Q4: check runs AFTER path.resolve (absolute path comparison).
 *
 * @spec AC-02, AC-14
 */
function checkSandbox(resolvedPath) {
  const sandboxEnabled = process.env.SOMA_SAFE_PATHS_ONLY === '1';
  if (!sandboxEnabled) {
    return { ok: true };
  }

  // Normalize to ensure trailing separator comparison is consistent
  const allowedPrefix = SOMA_SCRIPTS_PATH + path.sep;
  const isWithinSandbox = resolvedPath.startsWith(allowedPrefix) || resolvedPath === SOMA_SCRIPTS_PATH;

  if (!isWithinSandbox) {
    return {
      ok: false,
      error: {
        code: 'SANDBOX_VIOLATION',
        message: `--module path ${resolvedPath} outside sandbox (${SOMA_SCRIPTS_PATH})`,
        hint: `Set SOMA_SAFE_PATHS_ONLY=0 to disable, or pass path within ${SOMA_SCRIPTS_PATH}`,
      },
    };
  }

  return { ok: true };
}

module.exports = { checkSandbox, SOMA_SCRIPTS_PATH };
