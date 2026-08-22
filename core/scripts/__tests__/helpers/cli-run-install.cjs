'use strict';
/**
 * cli-run-install.cjs — the real runInstall() used by
 * install-cli.contract.test.cjs, extracted so install-home-isolation-guard.test.cjs
 * can exercise the SAME production function directly instead of a
 * hand-rolled stand-in.
 *
 * Why this file exists (2026-08-22, review round 2): the guard's first
 * version only ever proved that ITS OWN internal spawnSync call was safe
 * — it never touched install-cli.contract.test.cjs's actual runInstall(),
 * which at the time had a real bug (11 call sites spawned install.cjs
 * with no HOME isolation at all, and — because they don't FAIL, just
 * write successfully — the guard's "does the fixed test pass" framing
 * never caught it). A guard that only tests an idealized example of
 * itself is not a guard on the thing it's meant to protect.
 *
 * This module can't simply be require()'d from
 * install-cli.contract.test.cjs's own file by the guard, either: that
 * file is a node:test test file — requiring it would re-execute and
 * re-register every test() call in it inside the guard's own run.
 * Extracting the pure function here — no test() calls, nothing node:test
 * ever discovers — is what makes "guard imports the REAL runInstall"
 * possible without double-running install-cli.contract.test.cjs's suite.
 *
 * Behavior is copied verbatim from install-cli.contract.test.cjs's
 * runInstall(): every call gets its own fresh, disposable, seeded HOME
 * by default (via helpers/fake-home.cjs); a caller that already passes
 * its own `opts.env` is respected untouched, never double-wrapped.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withFakeHome, fakeHomeEnv } = require('./fake-home.cjs');

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..');
const INSTALL_CJS = path.join(SCRIPTS_DIR, 'install.cjs');

/**
 * Run install.cjs as a subprocess with given argv array.
 * @param {string[]} args
 * @param {object} [opts] spawnSync options override
 * @returns spawnSync result (encoding utf8)
 */
function runInstall(args = [], opts = {}) {
  if (opts.env) {
    return spawnSync('node', [INSTALL_CJS, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      ...opts,
    });
  }
  return withFakeHome('cli-contract-auto-', (fakeHome) => spawnSync(
    'node', [INSTALL_CJS, ...args],
    { encoding: 'utf8', timeout: 10000, ...opts, env: fakeHomeEnv(fakeHome) }
  ));
}

module.exports = { runInstall, INSTALL_CJS };
