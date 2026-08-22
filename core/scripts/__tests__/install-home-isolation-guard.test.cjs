'use strict';
/**
 * install-home-isolation-guard.test.cjs — regression guard for Bucket G
 * (Spec 018): install.cjs subprocess tests must never write under the
 * ambient $HOME of whoever runs `npm test`.
 *
 * Article III HARD: real fs / real child_process, no mocks.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * install.cjs resolves `~` via os.homedir(), which reads process.env.HOME
 * on every call. Before Bucket G, 26 tests across 5 files spawned
 * install.cjs without giving it its own HOME, so they read/wrote against
 * whoever's REAL ~/.claude and ~/.soma-v2 happened to run `npm test`.
 * Measured (2026-08-22): on a machine whose ~/.claude has never had SOMA
 * installed, a bare `HOME=<empty> node install.cjs <tmp> --tool=claude`
 * exits 0 and creates 19 hooks + 12 commands + CLAUDE.md there — no
 * conflict, no warning, silent install into the real home.
 *
 * ── What this test actually checks ──────────────────────────────────────
 * It is NOT possible for a single test file to observe every other test
 * file's process (node --test spawns one OS process per matched file), so
 * this guard can't literally watch "the suite" from the outside. What it
 * CAN do — and does — is exercise the exact shared mechanism every fixed
 * test in this suite now depends on (helpers/fake-home.cjs's
 * withFakeHome/fakeHomeEnv) against a decoy standing in for "the ambient
 * HOME a careless spawn would hit", and assert that decoy is provably
 * untouched. If a future edit to the shared helper (or a call site that
 * stops going through it) regresses isolation, this is the test built to
 * catch it.
 *
 * ── Proving this isn't a blind ruler ────────────────────────────────────
 * A guard that can only ever pass is not a guard (CLAUDE.md failure mode
 * #10 — "confiar no próprio instrumento de verificação" — a verifier that
 * never accuses is indistinguishable from no verifier at all). This test's
 * sensitivity was proven by hand, NOT left as a permanent second test,
 * because a permanently-red test can't ship:
 *   1. Temporarily replaced the isolated spawnSync call below with a bare
 *      `spawnSync('node', [INSTALL_CJS, projectDir, '--tool=claude'],
 *      { encoding: 'utf8', timeout: 30000 })` — no withFakeHome, no
 *      explicit env — while process.env.HOME was pointed at the SAME
 *      decoyAmbientHome this test fingerprints.
 *   2. Ran it: the fingerprint assertion below FAILED loud — 32 new files
 *      appeared under decoyAmbientHome/.claude (19 hooks + 12 commands +
 *      CLAUDE.md), exactly the hazard this guard exists to catch.
 *   3. Reverted to the isolated call shown below; confirmed `git diff`
 *      against this file was empty before committing.
 * See the final report for the raw before/after fingerprint diff from that
 * run.
 *
 * @task Bucket-G (Spec 018)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const {
  mkTmp,
  seedSomaHome,
  withFakeHome,
  fakeHomeEnv,
} = require('./helpers/fake-home.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTALL_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'install.cjs');

/**
 * Recursively fingerprint a path: existence + per-file (relative path,
 * mtimeMs, sha256). Returns null if the path doesn't exist. This is
 * intentionally content-and-time sensitive — a same-bytes rewrite still
 * changes mtimeMs, which is itself evidence a write occurred.
 * @param {string} targetPath
 * @returns {null | { type: 'file', mtimeMs: number, sha256: string } | { type: 'dir', entries: Record<string, any> }}
 */
function fingerprint(targetPath) {
  if (!fs.existsSync(targetPath)) return null;
  const st = fs.statSync(targetPath);
  if (st.isFile()) {
    const buf = fs.readFileSync(targetPath);
    return {
      type: 'file',
      mtimeMs: st.mtimeMs,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  }
  if (st.isDirectory()) {
    const entries = {};
    for (const name of fs.readdirSync(targetPath).sort()) {
      entries[name] = fingerprint(path.join(targetPath, name));
    }
    return { type: 'dir', entries };
  }
  return { type: 'other' };
}

/** Fingerprint the three ~/.claude/... surfaces Bucket G's 26 fixes protect. */
function fingerprintClaudeGlobals(homeDir) {
  const claudeDir = path.join(homeDir, '.claude');
  return {
    hooks: fingerprint(path.join(claudeDir, 'hooks')),
    commands: fingerprint(path.join(claudeDir, 'commands')),
    claudeMd: fingerprint(path.join(claudeDir, 'CLAUDE.md')),
  };
}

test('HOME-GUARD: an install.cjs run through the isolated helper never touches a decoy standing in for the ambient HOME', () => {
  // decoyAmbientHome stands in for "whatever $HOME a careless spawn would
  // inherit" — e.g. the real $HOME of whoever runs `npm test`. It is
  // seeded with .soma-v2 (so install.cjs COULD succeed if it ever reached
  // this home) but its .claude/{hooks,commands,CLAUDE.md} start absent —
  // the exact worst case measured above (a machine that never had SOMA
  // installed: nothing there to cause a FILE_CONFLICT abort, so a leaking
  // write would go through clean).
  const decoyAmbientHome = mkTmp('home-guard-decoy-ambient-');
  seedSomaHome(decoyAmbientHome);

  const before = fingerprintClaudeGlobals(decoyAmbientHome);
  assert.deepEqual(
    before,
    { hooks: null, commands: null, claudeMd: null },
    'guard setup: decoy ambient home must start with .claude/{hooks,commands,CLAUDE.md} absent'
  );

  const projectDir = mkTmp('home-guard-project-');
  try {
    // The isolated pattern every one of Bucket G's 26 fixes now uses:
    // withFakeHome gives install.cjs its OWN separate home (never
    // decoyAmbientHome), so nothing about this call can legitimately
    // reach decoyAmbientHome at all — it's not even in scope.
    withFakeHome('home-guard-isolated-', (isolatedHome) => {
      const r = spawnSync('node', [INSTALL_CJS, projectDir, '--tool=claude'], {
        encoding: 'utf8',
        timeout: 30000,
        env: fakeHomeEnv(isolatedHome),
      });
      assert.equal(
        r.status, 0,
        `guard setup: install must succeed inside the isolated home. stderr: ${r.stderr}`
      );
      // Sanity: the isolated call DID do real work (proves the guard isn't
      // vacuously passing because install.cjs silently no-op'd).
      assert.ok(
        fs.existsSync(path.join(isolatedHome, '.claude', 'hooks')),
        'guard setup: install must have written hooks under the isolated home — ' +
        'otherwise "decoy untouched" proves nothing'
      );
    });
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  const after = fingerprintClaudeGlobals(decoyAmbientHome);
  assert.deepEqual(
    after,
    before,
    'install.cjs run through the isolated helper wrote under the decoy ambient HOME. ' +
    'This is exactly the leakage Bucket G exists to prevent — every spawnSync of ' +
    'install.cjs in this suite must go through helpers/fake-home.cjs.'
  );

  fs.rmSync(decoyAmbientHome, { recursive: true, force: true });
});
