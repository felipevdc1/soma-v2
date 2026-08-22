'use strict';
/**
 * fake-home.cjs — shared HOME-isolation helper for install.cjs subprocess tests.
 * (Bucket G, Spec 018 T-Bucket-G)
 *
 * Several tests in this suite spawn `node install.cjs <tmp>` as a child
 * process. install.cjs — and the init.cjs / manifest.cjs / sync.cjs steps
 * it shells out to via runStep() — resolve `~` via `os.homedir()`, which on
 * this Node reads `process.env.HOME` on every call (same fact already
 * established in contract-files-ledger.test.cjs's own withFakeHome). Left
 * unset, every one of these tests reaches for the REAL, ambient $HOME of
 * whoever runs `npm test` — reading (and, worse, WRITING) under their real
 * ~/.claude and ~/.soma-v2. Measured empirically (2026-08-22): with an
 * empty ~/.claude, `HOME=<fake> node install.cjs <tmp> --tool=claude`
 * exits 0 and creates 32 files (19 hooks + 12 commands + CLAUDE.md) under
 * <fake>/.claude — i.e. on a machine that has never had SOMA installed,
 * running this suite un-isolated installs SOMA into the real home. On a
 * machine that DOES already have those files (e.g. this repo's own
 * author), install.cjs's FILE_CONFLICT abort (files present, no matching
 * ledger entry — the project-scoped ledger starts empty for every fresh
 * tmpdir project) is the ONLY thing standing in the way — an accident of
 * state, not a guarantee.
 *
 * withFakeHome() points process.env.HOME at a fresh, disposable directory
 * for the duration of a callback and restores it in `finally`. Because
 * child_process.spawnSync inherits process.env when no `env` option is
 * given, every spawnSync call inside the callback — even ones that don't
 * pass their own `env` — automatically targets the fake HOME. This mirrors
 * (and generalizes) contract-files-ledger.test.cjs's own withFakeHome,
 * which only needed to cover in-process files.cjs calls, not full
 * install.cjs subprocess runs.
 *
 * A bare empty fake HOME is NOT enough for a full install.cjs run:
 * install.cjs's own Step 1 (`runStep('init', [INIT_CJS, projectPathAbs])`)
 * calls init.cjs WITHOUT a `--soma-home` flag, so init.cjs falls back to
 * `<HOME>/.soma-v2` for its template directory — and dies with
 * TEMPLATE_MISSING if that doesn't exist. So withFakeHome seeds
 * `<fakeHome>/.soma-v2` with a copy of this repo's own core/ — the same
 * content install.sh's `rsync -a core/ ~/.soma-v2/` would produce — MINUS
 * core/.snapshots/. manifest.cjs's runBaseline (also reached without an
 * explicit --soma-home, via SOMA_HOME env-var-or-homedir fallback) only
 * ever WRITES new timestamped snapshot dirs there via createSnapshot()
 * before an atomic manifest.json write; nothing in that path reads
 * pre-existing snapshot content. Skipping it saves ~35MB of copy per test
 * (core/ is ~40MB total; .snapshots/ alone is ~35MB of that, from years of
 * this very suite writing into the real core/.snapshots/ — a separate,
 * pre-existing, out-of-scope leak: sync.cjs is invoked by install.cjs with
 * an EXPLICIT `--soma-home=${SOURCE_CORE}`, i.e. this repo's own core/,
 * completely independent of $HOME. That path is unchanged by this file.)
 *
 * IMPORTANT — do NOT set the SOMA_HOME env var here instead of copying:
 * manifest.cjs resolves `somaHome = process.env.SOMA_HOME || homedir+'/.soma-v2'`
 * and WRITES to `<somaHome>/manifest.json` + `<somaHome>/.snapshots/`. If
 * SOMA_HOME pointed at this repo's real core/ (as SOURCE_CORE does), every
 * test run would mutate core/manifest.json in the actual git working tree.
 * A throwaway copy is the only safe seed.
 *
 * This module is a TEST HELPER, not a test file — it must never be picked
 * up by `npm test`'s glob (`core/scripts/__tests__/*.test.cjs`, which is
 * NOT recursive). That's also why it's safe here one level deeper, in
 * helpers/, even if it were misnamed with a `.test.cjs` suffix.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CORE_DIR = path.join(REPO_ROOT, 'core');
const SNAPSHOTS_DIR = path.join(CORE_DIR, '.snapshots');

/**
 * Create a fresh throwaway temp dir.
 * @param {string} prefix
 * @returns {string} absolute path
 */
function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Seed `<fakeHomeDir>/.soma-v2` with a copy of this repo's core/, minus
 * .snapshots/ (pure write-target, never read as seed content — see module
 * doc above). Returns the seeded path.
 * @param {string} fakeHomeDir
 * @returns {string} `<fakeHomeDir>/.soma-v2`
 */
function seedSomaHome(fakeHomeDir) {
  const dest = path.join(fakeHomeDir, '.soma-v2');
  fs.cpSync(CORE_DIR, dest, {
    recursive: true,
    filter: (src) => src !== SNAPSHOTS_DIR && !src.startsWith(SNAPSHOTS_DIR + path.sep),
  });
  return dest;
}

/**
 * Points os.homedir() (via process.env.HOME) at a fresh, seeded, throwaway
 * directory for the duration of `fn(fakeHomeDir)`. Restores the ORIGINAL
 * process.env.HOME in `finally`, even if `fn` throws, and removes the
 * throwaway dir. Never touches the real $HOME's content — only ever reads
 * it (via os.tmpdir(), which is HOME-independent) to create the throwaway
 * copy elsewhere.
 * @param {string} prefix
 * @param {(fakeHomeDir: string) => any} fn
 * @returns {any} fn's return value
 */
function withFakeHome(prefix, fn) {
  const dir = mkTmp(prefix);
  seedSomaHome(dir);
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build a spawnSync `env` object with HOME overridden to fakeHomeDir, for
 * call sites that pass their own explicit `env` option (which would
 * otherwise shadow withFakeHome's process.env.HOME mutation).
 * @param {string} fakeHomeDir
 * @param {object} [extra] additional env overrides
 * @returns {object}
 */
function fakeHomeEnv(fakeHomeDir, extra = {}) {
  return Object.assign({}, process.env, { HOME: fakeHomeDir }, extra);
}

module.exports = { mkTmp, seedSomaHome, withFakeHome, fakeHomeEnv, REPO_ROOT, CORE_DIR };
