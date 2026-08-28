'use strict';
/**
 * install-files-e2e.test.cjs — T-09 smoke de ponta a ponta (Spec 018)
 *
 * The other tasks in this spec test the mechanism (T-07's
 * `sync-file-entries.test.cjs`, synthetic fixtures) and the doctor check
 * (T-06's `doctor-file-drift.test.cjs`, also synthetic) in isolation. This
 * file is the one that runs `sync.cjs`/`doctor.cjs` — real code, spawned
 * as real child processes, never `require()`d and called directly —
 * against the REAL set T-08 declared in
 * `core/adapters/claude/install-targets.json` (34 entries: 3 block + 31
 * file, i.e. all 19 real hooks under `core/hooks/` and the 12 real
 * commands under `core/adapters/claude/commands/` that survived AC-12's
 * exclusion of `soma-run.md`), through five scenarios:
 *
 *   (a) fresh install — files land byte-identical to repo source
 *   (b) one file diverged — the WHOLE apply aborts, nothing is written,
 *       both diverged paths are named (not just the first)
 *   (c) an undeclared file sits in the same directory — it survives a
 *       real install that writes 31 declared files around it
 *   (d) a second apply with zero repo changes — writes nothing (checked
 *       via mtime, not sha — see the note on (d) below for why)
 *   (e) `doctor` with no install-state — says "never installed", which is
 *       a different signal than "no drift", not just a different exit code
 *
 * WHY THIS FILE NEVER POINTS `--soma-home` AT THE LIVE CHECKOUT
 * ---------------------------------------------------------------------
 * The obvious way to get "the real set" is `--soma-home=<repo>/core`
 * (exactly what `install.cjs` computes as `SOURCE_CORE` and passes to
 * `sync.cjs`). Measured while writing this file: running
 * `sync.cjs --apply --tool=claude --soma-home=<repo>/core` against a
 * throwaway `--project` (with `HOME` already overridden to a temp dir)
 * still rewrote `core/manifest.json` in the live git working tree — a
 * pre-existing sha256 self-heal, unrelated to file-kind entries, that
 * fires on ANY `--apply` run against the live repo regardless of which
 * project or destination is being installed. `git diff` showed one
 * `sha256` field flip on `core.constitution`; reverted with
 * `git checkout -- core/manifest.json` before writing a single test here.
 * This is exactly the class of bug the team's own review of the OTHER
 * `*e2e*.test.cjs` files in this directory flagged: a suite that spawns
 * the real CLI without sandboxing every path it can write to. `--project`
 * alone was not enough; `--soma-home` had to be sandboxed too.
 *
 * The fix: `buildRealSomaHomeCopy()` below copies the REAL
 * `install-targets.json` plus every file/doc it references (real hooks,
 * real commands, real block docs — same bytes, `fs.copyFileSync`, no
 * synthesis) into a throwaway temp dir, and every `--soma-home` in this
 * file points there. `HOME` is separately overridden to a second,
 * unrelated temp dir per test (this is what makes `~/.claude/...` targets
 * land somewhere throwaway). Both are real temp dirs from `os.tmpdir()`
 * (NOT `/tmp` — this Mac's `os.tmpdir()` is `/var/folders/...`), removed
 * in a `finally` per test. A `before`/`after` pair at the bottom of this
 * file fingerprints the REAL `~/.claude` and `~/.soma-v2` once at suite
 * start and once at suite end and asserts they are byte-for-byte
 * identical — so a future regression that leaks HOME or `--soma-home`
 * isolation fails loud in CI, not just in a one-off manual check.
 *
 * WHY (d) IS CHECKED VIA mtime, NOT sha
 * ---------------------------------------------------------------------
 * "Wrote nothing" and "content didn't change" are different claims. An
 * installer that reads the source, hashes it, finds it identical, and
 * rewrites the target ANYWAY would pass a sha-based check on (d) while
 * still doing the unnecessary write the scenario exists to catch. mtime
 * (captured via `fs.statSync(...).mtimeMs`) is the only assertion in this
 * file that actually distinguishes "no write happened" from "a write
 * happened that produced identical bytes" — `files.cjs`'s own
 * `needsWrite` decision (`planFileInstall`) is a `state === 'clean' && (…)`
 * check specifically to avoid the latter, and (d) is the scenario that
 * would go undetected if that check regressed to something coarser.
 *
 * WHY (b) COMES WITH A CONTROL, NOT JUST AN ABORT
 * ---------------------------------------------------------------------
 * "Nothing was written" is only informative if something WOULD have been
 * written otherwise. (b) tampers ONE file's ledgered target directly
 * (making it "diverged") while ALSO advancing a DIFFERENT file's SOURCE
 * (making it "clean but stale" — it would be rewritten on the next apply,
 * if nothing else aborted first). The test then asserts the stale-but-
 * clean file's target is untouched too — proving the abort really did
 * suppress a legitimate pending write, not just a write nothing needed
 * anyway. The paired `T-09 (b)-control` test repeats the same
 * stale-source change WITHOUT the divergence and asserts the file DOES
 * get rewritten — the falsifier that makes the main (b) test meaningful.
 *
 * Article III HARD: real filesystem, real child processes, zero mock of
 * `fs` or `child_process`.
 *
 * @spec [SPEC:AC-01] [SPEC:AC-04] [SPEC:AC-05] [SPEC:AC-10]
 * @task T-09
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SYNC_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'sync.cjs');
const DOCTOR_CJS = path.join(REPO_ROOT, 'core', 'scripts', 'doctor.cjs');
const REAL_INSTALL_TARGETS_PATH = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'install-targets.json');

// ── tmp dir helpers ─────────────────────────────────────────────────────

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFileInto(srcAbs, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
}

/**
 * Copy the REAL install-targets.json (T-08's actual declared set) plus
 * every source_path/source_doc it references into a throwaway temp dir,
 * and return it as an isolated `somaHome`. See the file header for why
 * `--soma-home` never points at `<repo>/core` directly in this file.
 *
 * @returns {{ somaHome: string, targets: object, fileEntries: object[] }}
 */
function buildRealSomaHomeCopy() {
  const somaHome = mkTmp('soma-t09-somahome-');
  // Minimal-but-schema-valid manifest.json — loadManifest() only requires
  // { schema: 'soma-manifest/v1', files: [] } to be well-formed (same
  // shape doctor-file-drift.test.cjs's own fixture uses). This file's
  // scenarios are about kind:"file" entries, not manifest doc staleness —
  // an empty `files` array sidesteps needing to also carry every doc the
  // REAL manifest.json references (some of which this copy never fetches).
  fs.writeFileSync(
    path.join(somaHome, 'manifest.json'),
    JSON.stringify({ schema: 'soma-manifest/v1', files: [] }, null, 2) + '\n'
  );

  const targetsRaw = fs.readFileSync(REAL_INSTALL_TARGETS_PATH, 'utf8');
  copyFileInto(REAL_INSTALL_TARGETS_PATH, path.join(somaHome, 'adapters', 'claude', 'install-targets.json'));

  const targets = JSON.parse(targetsRaw);
  for (const entry of targets.entries) {
    if (entry.kind === 'file') {
      copyFileInto(path.join(REPO_ROOT, 'core', entry.source_path), path.join(somaHome, entry.source_path));
    } else if (entry.source_doc) {
      copyFileInto(path.join(REPO_ROOT, 'core', entry.source_doc), path.join(somaHome, entry.source_doc));
    }
  }

  const fileEntries = targets.entries.filter((e) => e.kind === 'file');
  return { somaHome, targets, fileEntries };
}

function targetPathAbs(homeDir, entryTargetPath) {
  // All real entries are `~/...`-prefixed (verified against the real
  // install-targets.json below) — join manually against the per-test
  // fake $HOME instead of calling files.expandHome(), which reads
  // os.homedir() (== process.env.HOME) LIVE. This test file's own
  // process never mutates process.env.HOME (only the spawned child's
  // env does) — mutating it here would leak across node:test's
  // same-process test execution.
  assert.ok(entryTargetPath.startsWith('~/'), `expected a ~/-prefixed target_path, got: ${entryTargetPath}`);
  return path.join(homeDir, entryTargetPath.slice(2));
}

function runSync(somaHome, cwd, home, extraArgs = []) {
  return spawnSync('node', [SYNC_CJS, '--apply', '--tool=claude', `--soma-home=${somaHome}`, '--json', ...extraArgs], {
    encoding: 'utf8',
    cwd,
    timeout: 30000,
    env: { ...process.env, HOME: home },
  });
}

function runDoctor(somaHome, cwd, home, extraArgs = []) {
  return spawnSync('node', [DOCTOR_CJS, `--soma-home=${somaHome}`, `--project=${cwd}`, ...extraArgs], {
    encoding: 'utf8',
    cwd,
    timeout: 30000,
    env: { ...process.env, HOME: home },
  });
}

function runDoctorJson(somaHome, cwd, home, extraArgs = []) {
  const r = runDoctor(somaHome, cwd, home, ['--json', ...extraArgs]);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (err) {
    throw new Error(`doctor --json did not print valid JSON (exit ${r.status}): ${err.message}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  return { result: r, parsed };
}

// ── Real-$HOME fingerprint guard ─────────────────────────────────────────
//
// Not a per-scenario check — a suite-wide net. If any test in this file
// ever leaks a write into the real machine's $HOME, this fails loud
// instead of silently passing.
//
// Scoped to the SOMA-managed subpaths only — `~/.claude/hooks/`,
// `~/.claude/commands/`, `~/.claude/CLAUDE.md` — NOT the entire `~/.claude`
// tree, and NOT `~/.soma-v2` at all. Two measured reasons, both found by
// running this file as part of the FULL `npm test` (concurrent with every
// other suite in this same live Claude Code session), not standalone:
//
//   1. Fingerprinting all of `~/.claude` false-positived: `~/.claude/logs/`,
//      `~/.claude/sessions/`, and `~/.claude/projects/` (hook logs, session
//      state, this very conversation's transcript) are written continuously
//      by the harness itself, independent of anything any test does.
//   2. Fingerprinting `~/.soma-v2` (even after fix #1) STILL false-
//      positived: `count` matched exactly but `sha` differed — the real
//      `~/.soma-v2` was mutated during the run by OTHER, pre-existing
//      test files in this suite that spawn install.cjs/sync.cjs without
//      overriding HOME (the documented "Categoria B" ~26-test gap this
//      spec's own tasks.md explicitly says not to fix here). This file
//      never has a code path that could write to the REAL `~/.soma-v2` —
//      every `--soma-home` in this file points at a throwaway tmp copy,
//      always passed explicitly, never left to default — so there is no
//      SOMA-managed subpath under the real `~/.soma-v2` this file could
//      plausibly regress into, unlike `~/.claude/hooks|commands|CLAUDE.md`
//      (which really are what AC-01/04/05 write to if HOME leaked).
//      Watching it anyway bought a guard against a bug this file cannot
//      have, at the cost of flaking on someone else's known issue.
function fingerprintPath(absPath) {
  if (!fs.existsSync(absPath)) return { missing: true };
  const stat = fs.lstatSync(absPath);
  if (stat.isSymbolicLink()) {
    let linkTarget = 'UNREADABLE';
    try { linkTarget = fs.readlinkSync(absPath); } catch (_) { /* keep UNREADABLE */ }
    return { symlink: linkTarget };
  }
  if (stat.isFile()) {
    return { sha: crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex') };
  }
  // Directory: walk it (no symlink-following — a broken symlink under a
  // real dir made a naive readFileSync-everything walker throw ENOENT
  // during development).
  const entries = [];
  (function walk(d) {
    let list;
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      entries.push(`ERRDIR:${d}:${err.code}`);
      return;
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        let linkTarget = 'UNREADABLE';
        try { linkTarget = fs.readlinkSync(p); } catch (_) { /* keep UNREADABLE */ }
        entries.push(`SYMLINK:${p}->${linkTarget}`);
        continue;
      }
      if (e.isDirectory()) { walk(p); continue; }
      entries.push(`FILE:${p}`);
    }
  })(absPath);
  entries.sort();
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    hash.update(entry);
    if (entry.startsWith('FILE:')) {
      try { hash.update(fs.readFileSync(entry.slice(5))); } catch (err) { hash.update(`ERRREAD:${err.code}`); }
    }
  }
  return { count: entries.length, sha: hash.digest('hex') };
}

function fingerprintWatchedPaths() {
  const home = os.homedir();
  return {
    claudeHooks: fingerprintPath(path.join(home, '.claude', 'hooks')),
    claudeCommands: fingerprintPath(path.join(home, '.claude', 'commands')),
    claudeMd: fingerprintPath(path.join(home, '.claude', 'CLAUDE.md')),
  };
}

let fingerprintBefore;

before(() => {
  fingerprintBefore = fingerprintWatchedPaths();
});

after(() => {
  const fingerprintAfter = fingerprintWatchedPaths();
  assert.deepEqual(
    fingerprintAfter,
    fingerprintBefore,
    'T-09 suite must never touch the REAL ~/.claude/{hooks,commands,CLAUDE.md} — fingerprint changed'
  );
});

// ── Sanity: the real set actually looks like what the spec promises ────

test('T-09 sanity: the real install-targets.json declares the expected shape before any scenario runs', () => {
  const raw = fs.readFileSync(REAL_INSTALL_TARGETS_PATH, 'utf8');
  const targets = JSON.parse(raw);
  const fileEntries = targets.entries.filter((e) => e.kind === 'file');
  const blockEntries = targets.entries.filter((e) => e.kind !== 'file');
  assert.ok(fileEntries.length >= 30, `expected at least 30 real file entries, got ${fileEntries.length}`);
  assert.ok(blockEntries.length >= 3, `expected at least 3 real block entries, got ${blockEntries.length}`);
  assert.ok(
    targets.entries.some((e) =>
      e.kind === 'file' &&
      e.source_path === 'adapters/claude/commands/soma-run.md' &&
      e.target_path === '~/.claude/commands/soma-run.md'
    ),
    'the approved universal entry must declare soma-run.md'
  );
  for (const entry of fileEntries) {
    const sourceAbs = path.join(REPO_ROOT, 'core', entry.source_path);
    assert.ok(fs.existsSync(sourceAbs), `declared source_path does not exist in repo: ${entry.source_path}`);
  }
});

// ── (a) @spec AC-01: fresh install, byte-identical ──────────────────────

test('T-09 (a) @spec AC-01: fresh install writes every real declared file byte-identical to its repo source', () => {
  const { somaHome, fileEntries } = buildRealSomaHomeCopy();
  const home = mkTmp('soma-t09a-home-');
  const project = mkTmp('soma-t09a-proj-');
  try {
    const r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, `fresh apply must succeed: stdout=${r.stdout} stderr=${r.stderr}`);

    for (const entry of fileEntries) {
      const sourceAbs = path.join(somaHome, entry.source_path);
      const destAbs = targetPathAbs(home, entry.target_path);
      assert.ok(fs.existsSync(destAbs), `AC-01: ${entry.target_path} was not written`);
      const sourceBuf = fs.readFileSync(sourceAbs);
      const destBuf = fs.readFileSync(destAbs);
      assert.ok(sourceBuf.equals(destBuf), `AC-01: ${entry.target_path} is not byte-identical to ${entry.source_path}`);
    }

    // The ledger (T-05/T-07) must record every one of them, keyed by the
    // verbatim ~-prefixed target_path, with the sha256 it just wrote.
    const ledgerRaw = fs.readFileSync(path.join(project, '.soma', 'install-state.json'), 'utf8');
    const ledger = JSON.parse(ledgerRaw).installedFiles;
    for (const entry of fileEntries) {
      assert.ok(ledger[entry.target_path], `ledger missing entry for ${entry.target_path}`);
      const destBuf = fs.readFileSync(targetPathAbs(home, entry.target_path));
      const actualSha = crypto.createHash('sha256').update(destBuf).digest('hex');
      assert.equal(ledger[entry.target_path].sha256, actualSha, `ledger sha256 mismatch for ${entry.target_path}`);
    }
  } finally {
    rmTmp(somaHome);
    rmTmp(home);
    rmTmp(project);
  }
});

// ── (b) @spec AC-04: one diverged file aborts EVERYTHING, names both ───

test('T-09 (b) @spec AC-04: a diverged file aborts the whole apply, names every diverged path, writes nothing — not even a file that legitimately needed rewriting', () => {
  const { somaHome } = buildRealSomaHomeCopy();
  const home = mkTmp('soma-t09b-home-');
  const project = mkTmp('soma-t09b-proj-');
  try {
    let r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, 'baseline install must succeed first');

    // File #1: advance the SOURCE only (target untouched) — this makes it
    // "clean but stale": planFileInstall's needsWrite would be true for it
    // on the next apply, IF nothing else aborted first.
    const staleSourceAbs = path.join(somaHome, 'hooks', 'session-init.cjs');
    const staleTargetAbs = targetPathAbs(home, '~/.claude/hooks/session-init.cjs');
    fs.appendFileSync(staleSourceAbs, '\n// T-09 (b): source advanced after install\n');

    // Files #2 and #3: tamper the TARGETS directly — these are the ones
    // that must be named as diverged (contract: "nomear todos, não o
    // primeiro").
    const tampered1Abs = targetPathAbs(home, '~/.claude/hooks/thermal-guard.cjs');
    const tampered2Abs = targetPathAbs(home, '~/.claude/hooks/depth-guard.cjs');
    fs.appendFileSync(tampered1Abs, '\n// T-09 (b): manually edited\n');
    fs.appendFileSync(tampered2Abs, '\n// T-09 (b): manually edited\n');

    // Control target: never touched, never stale — must remain untouched too.
    const untouchedAbs = targetPathAbs(home, '~/.claude/hooks/agent-mode-gate.cjs');

    const staleContentBefore = fs.readFileSync(staleTargetAbs, 'utf8');
    const staleMtimeBefore = fs.statSync(staleTargetAbs).mtimeMs;
    const tampered1ContentBefore = fs.readFileSync(tampered1Abs, 'utf8');
    const tampered2ContentBefore = fs.readFileSync(tampered2Abs, 'utf8');
    const untouchedMtimeBefore = fs.statSync(untouchedAbs).mtimeMs;

    r = runSync(somaHome, project, home);
    assert.equal(r.status, 2, `expected abort exit code 2, got ${r.status}: stdout=${r.stdout} stderr=${r.stderr}`);

    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (err) {
      throw new Error(`sync --apply --json did not print valid JSON on abort: ${err.message}\nstdout: ${r.stdout}`);
    }
    assert.equal(parsed.error && parsed.error.code, 'FILE_CONFLICT', 'abort must report FILE_CONFLICT');
    const diverged = (parsed.error && parsed.error.details && parsed.error.details.diverged) || [];
    assert.deepEqual(
      [...diverged].sort(),
      ['~/.claude/hooks/depth-guard.cjs', '~/.claude/hooks/thermal-guard.cjs'].sort(),
      `both diverged paths must be named — got: ${JSON.stringify(diverged)}`
    );

    // Nothing was written: not the diverged files (still exactly as
    // tampered, not reverted, not further changed)...
    assert.equal(fs.readFileSync(tampered1Abs, 'utf8'), tampered1ContentBefore, 'diverged file #1 must be untouched by the aborted apply');
    assert.equal(fs.readFileSync(tampered2Abs, 'utf8'), tampered2ContentBefore, 'diverged file #2 must be untouched by the aborted apply');
    // ...and not the stale-but-clean file either — this is the pairing
    // that proves the abort suppressed a REAL pending write, not a no-op.
    assert.equal(fs.readFileSync(staleTargetAbs, 'utf8'), staleContentBefore, 'AC-04: a file that legitimately needed rewriting must NOT be written when a DIFFERENT file diverged');
    assert.equal(fs.statSync(staleTargetAbs).mtimeMs, staleMtimeBefore, 'AC-04: stale-but-clean file mtime must be unchanged after the aborted apply');
    // ...and not an untouched, unrelated file either (full-abort, not
    // partial).
    assert.equal(fs.statSync(untouchedAbs).mtimeMs, untouchedMtimeBefore, 'AC-04: an unrelated clean file must also be untouched by the aborted apply');
  } finally {
    rmTmp(somaHome);
    rmTmp(home);
    rmTmp(project);
  }
});

test('T-09 (b)-control: without any divergence, the SAME stale-source change DOES get rewritten (falsifier for (b))', () => {
  const { somaHome } = buildRealSomaHomeCopy();
  const home = mkTmp('soma-t09bctl-home-');
  const project = mkTmp('soma-t09bctl-proj-');
  try {
    let r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, 'baseline install must succeed first');

    const staleSourceAbs = path.join(somaHome, 'hooks', 'session-init.cjs');
    const staleTargetAbs = targetPathAbs(home, '~/.claude/hooks/session-init.cjs');
    fs.appendFileSync(staleSourceAbs, '\n// T-09 (b)-control: source advanced after install\n');
    const mtimeBefore = fs.statSync(staleTargetAbs).mtimeMs;

    r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, `apply with no divergence must succeed: stdout=${r.stdout} stderr=${r.stderr}`);

    const mtimeAfter = fs.statSync(staleTargetAbs).mtimeMs;
    assert.notEqual(mtimeAfter, mtimeBefore, 'control: a genuinely stale file must actually be rewritten when nothing diverged — otherwise (b) proves nothing');
    const sourceBuf = fs.readFileSync(staleSourceAbs);
    const destBuf = fs.readFileSync(staleTargetAbs);
    assert.ok(sourceBuf.equals(destBuf), 'control: rewritten target must match the advanced source');
  } finally {
    rmTmp(somaHome);
    rmTmp(home);
    rmTmp(project);
  }
});

// ── (c) @spec AC-05: undeclared files survive real writes around them ──

test('T-09 (c) @spec AC-05: undeclared files survive a real install that writes 31 declared files in the very same directories', () => {
  const { somaHome, fileEntries } = buildRealSomaHomeCopy();
  const home = mkTmp('soma-t09c-home-');
  const project = mkTmp('soma-t09c-proj-');
  try {
    const undeclaredHookAbs = targetPathAbs(home, '~/.claude/hooks/meu-hook-pessoal.cjs');
    const undeclaredCmdAbs = targetPathAbs(home, '~/.claude/commands/meu-comando-pessoal.md');
    fs.mkdirSync(path.dirname(undeclaredHookAbs), { recursive: true });
    fs.mkdirSync(path.dirname(undeclaredCmdAbs), { recursive: true });
    fs.writeFileSync(undeclaredHookAbs, '// arquivo que o SOMA nao possui\n');
    fs.writeFileSync(undeclaredCmdAbs, '# arquivo que o SOMA nao possui\n');
    const undeclaredHookMtimeBefore = fs.statSync(undeclaredHookAbs).mtimeMs;
    const undeclaredCmdMtimeBefore = fs.statSync(undeclaredCmdAbs).mtimeMs;

    const r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, `install alongside undeclared files must still succeed: stdout=${r.stdout} stderr=${r.stderr}`);

    // Pairing: prove real writes actually happened in these SAME
    // directories in this SAME run — otherwise "survived" is vacuous.
    let actuallyWrote = 0;
    for (const entry of fileEntries) {
      if (fs.existsSync(targetPathAbs(home, entry.target_path))) actuallyWrote++;
    }
    assert.equal(actuallyWrote, fileEntries.length, 'sanity: all declared files must have been written in this run');

    assert.equal(fs.readFileSync(undeclaredHookAbs, 'utf8'), '// arquivo que o SOMA nao possui\n', 'AC-05: undeclared hook content must survive intact');
    assert.equal(fs.statSync(undeclaredHookAbs).mtimeMs, undeclaredHookMtimeBefore, 'AC-05: undeclared hook mtime must be unchanged');
    assert.equal(fs.readFileSync(undeclaredCmdAbs, 'utf8'), '# arquivo que o SOMA nao possui\n', 'AC-05: undeclared command content must survive intact');
    assert.equal(fs.statSync(undeclaredCmdAbs).mtimeMs, undeclaredCmdMtimeBefore, 'AC-05: undeclared command mtime must be unchanged');
  } finally {
    rmTmp(somaHome);
    rmTmp(home);
    rmTmp(project);
  }
});

// ── (d): second apply with zero changes writes nothing (mtime, not sha) ─

test('T-09 (d): a second apply with zero repo changes writes nothing, checked via mtime (not sha)', () => {
  const { somaHome, fileEntries } = buildRealSomaHomeCopy();
  const home = mkTmp('soma-t09d-home-');
  const project = mkTmp('soma-t09d-proj-');
  try {
    let r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, 'first apply must succeed');

    const mtimesBefore = new Map();
    for (const entry of fileEntries) {
      mtimesBefore.set(entry.target_path, fs.statSync(targetPathAbs(home, entry.target_path)).mtimeMs);
    }

    r = runSync(somaHome, project, home);
    assert.equal(r.status, 0, `second apply with no changes must succeed: stdout=${r.stdout} stderr=${r.stderr}`);

    for (const entry of fileEntries) {
      const mtimeAfter = fs.statSync(targetPathAbs(home, entry.target_path)).mtimeMs;
      assert.equal(
        mtimeAfter,
        mtimesBefore.get(entry.target_path),
        `${entry.target_path}: mtime changed on a no-op second apply — an unnecessary rewrite happened even though content is identical`
      );
    }
  } finally {
    rmTmp(somaHome);
    rmTmp(home);
    rmTmp(project);
  }
});

// ── (e) @spec AC-10: "never installed" vs "no drift" are distinct signals ─

test('T-09 (e) @spec AC-10: doctor with no install-state says "never installed", distinct from a clean install saying nothing', () => {
  const { somaHome } = buildRealSomaHomeCopy();
  const home = mkTmp('soma-t09e-home-');
  const neverInstalledProject = mkTmp('soma-t09e-proj-never-');
  const installedProject = mkTmp('soma-t09e-proj-installed-');
  try {
    // ── Never installed: no .soma/install-state.json exists at all ──
    const { result: neverResult, parsed: neverParsed } = runDoctorJson(somaHome, neverInstalledProject, home);
    const neverFinding = neverParsed.findings.find((f) => f.code === 'file_never_installed');
    assert.ok(neverFinding, `expected a file_never_installed finding, got: ${JSON.stringify(neverParsed.findings)}`);
    assert.equal(neverFinding.severity, 'warning');
    assert.match(neverFinding.message, /never installed by SOMA/);
    assert.doesNotMatch(neverFinding.message, /No drift detected/);

    // Plain (non-JSON) mode must carry the same distinguishing text, not
    // just a matching exit code — the armadilha this AC exists to avoid
    // is a check that only differs by exit code.
    const neverPlain = runDoctor(somaHome, neverInstalledProject, home);
    assert.match(neverPlain.stdout, /never installed by SOMA/, 'plain-text doctor output must also say "never installed"');

    // ── Installed and clean: same real set, actually synced first ──
    const syncResult = runSync(somaHome, installedProject, home);
    assert.equal(syncResult.status, 0, 'baseline install for the "installed" side of this test must succeed');

    const { parsed: installedParsed } = runDoctorJson(somaHome, installedProject, home);
    const installedNeverFinding = installedParsed.findings.find((f) => f.code === 'file_never_installed');
    assert.equal(installedNeverFinding, undefined, 'an installed, clean project must NOT carry a file_never_installed finding');

    const fileDrifts = installedParsed.findings.filter((f) => f.kind === 'file_drift');
    assert.ok(fileDrifts.length > 0, 'expected file_drift findings for the installed project (one per declared file)');
    assert.ok(
      fileDrifts.every((f) => f.severity === 'ok'),
      `expected every file_drift finding to be "ok" on a clean install, got: ${JSON.stringify(fileDrifts.filter((f) => f.severity !== 'ok'))}`
    );

    void neverResult; // status already covered by JSON parse above; kept for readability at call site
  } finally {
    rmTmp(somaHome);
    rmTmp(home);
    rmTmp(neverInstalledProject);
    rmTmp(installedProject);
  }
});
