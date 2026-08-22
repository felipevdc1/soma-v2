'use strict';
/**
 * commands-single-source.test.cjs — Spec 018, T-04
 *
 * Proves AC-11: after the migration, `core/adapters/claude/commands/`
 * holds every command the repo ships as a Claude slash command, the root
 * `commands/` directory carries none of them (it no longer exists at
 * all — the 6 orphans were `git mv`d out and the 5 stale duplicates were
 * `git rm`d), and — the invariant the AC actually asks for — no `.md`
 * name is ever present in BOTH locations at once.
 *
 * A test that only snapshots today's file list would be blind to a
 * regression where someone re-creates `commands/hyd.md` tomorrow by
 * accident (e.g. a merge, or a script that still writes to the old
 * path). So the core assertion here is expressed as a general-purpose
 * duplicate detector (`findDuplicateCommandNames`) run against the two
 * real directories, and that SAME detector is proven non-blind against
 * synthetic fixtures first: a known-BAD case (a manufactured name
 * collision) must be flagged, and a known-GOOD case (two disjoint sets)
 * must come back silent. Article III HARD: real filesystem, real temp
 * dirs, zero mock of `fs`. `os.tmpdir()` on this Mac is NOT `/tmp`.
 *
 * @spec [SPEC:AC-11]
 * @task T-04
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ROOT_COMMANDS_DIR = path.join(REPO_ROOT, 'commands');
const ADAPTER_COMMANDS_DIR = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'commands');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTmp(prefix, fn) {
  const dir = mkTmp(prefix);
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Lists the `.md` basenames directly inside `dir`, or `[]` if `dir`
 * doesn't exist at all (the root `commands/` dir, post-migration, is
 * exactly this case — it has zero remaining files, and `git mv`/`git rm`
 * of its last entries removes the directory itself).
 */
function listMdNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
}

/**
 * The invariant itself: names present in BOTH `dirA` and `dirB`. Order-
 * independent, and deliberately ignorant of what the names "should" be —
 * it only ever reports what it finds, so it stays meaningful even after
 * commands are added or removed from either side in the future.
 */
function findDuplicateCommandNames(dirA, dirB) {
  const namesA = new Set(listMdNames(dirA));
  const namesB = listMdNames(dirB);
  return namesB.filter((name) => namesA.has(name)).sort();
}

// ── Selftest: prove the detector isn't blind before trusting it ───────────
// [CLAUDE.md #10 — "confiar no próprio instrumento de verificação": a
// duplicate detector that always reports [] is indistinguishable from a
// correct one on a single real-world run. Run it against a manufactured
// bad case and a manufactured good case FIRST.]

test('T-04-00 selftest: findDuplicateCommandNames flags a manufactured collision (known-BAD case)', () => {
  withTmp('t04-selftest-bad-a-', (dirA) => {
    withTmp('t04-selftest-bad-b-', (dirB) => {
      fs.writeFileSync(path.join(dirA, 'hyd.md'), '# a\n');
      fs.writeFileSync(path.join(dirA, 'only-in-a.md'), '# a\n');
      fs.writeFileSync(path.join(dirB, 'hyd.md'), '# b\n');
      fs.writeFileSync(path.join(dirB, 'only-in-b.md'), '# b\n');

      const dupes = findDuplicateCommandNames(dirA, dirB);
      assert.deepEqual(dupes, ['hyd.md'], 'a name present in both dirs must be reported, and only that name');
    });
  });
});

test('T-04-00 selftest: findDuplicateCommandNames stays silent on a manufactured disjoint case (known-GOOD case)', () => {
  withTmp('t04-selftest-good-a-', (dirA) => {
    withTmp('t04-selftest-good-b-', (dirB) => {
      fs.writeFileSync(path.join(dirA, 'only-in-a.md'), '# a\n');
      fs.writeFileSync(path.join(dirB, 'only-in-b.md'), '# b\n');

      const dupes = findDuplicateCommandNames(dirA, dirB);
      assert.deepEqual(dupes, [], 'disjoint sets must never be reported as duplicates');
    });
  });
});

test('T-04-00 selftest: findDuplicateCommandNames treats a missing directory as empty, not as an error', () => {
  withTmp('t04-selftest-missing-', (dirA) => {
    const missing = path.join(dirA, 'does-not-exist');
    fs.writeFileSync(path.join(dirA, 'whatever.md'), '# a\n');
    assert.deepEqual(findDuplicateCommandNames(dirA, missing), []);
    assert.deepEqual(findDuplicateCommandNames(missing, dirA), []);
  });
});

// ── AC-11 against the real repo ────────────────────────────────────────

test('T-04-01 @spec AC-11: the root commands/ directory no longer exists (all 11 pre-migration files moved or removed)', () => {
  assert.equal(
    fs.existsSync(ROOT_COMMANDS_DIR),
    false,
    'commands/ at repo root must be gone entirely — 6 orphans git mv-ed to the adapter, 5 stale duplicates git rm-ed, nothing left behind'
  );
});

test('T-04-02 @spec AC-11: the 6 previously-orphaned commands now live under core/adapters/claude/commands/', () => {
  const migratedOrphans = ['depth-score.md', 'dispatch.md', 'encerrar.md', 'gap-finder.md', 'handoff.md', 'quality-check.md'];
  for (const name of migratedOrphans) {
    assert.equal(
      fs.existsSync(path.join(ADAPTER_COMMANDS_DIR, name)),
      true,
      `${name} must exist in core/adapters/claude/commands/ after the migration`
    );
  }
});

test('T-04-03 @spec AC-11: the 5 stale duplicates that used to live at the repo root are gone, not just superseded', () => {
  const removedDuplicates = ['hyd.md', 'plan-sdd.md', 'soma-run.md', 'sonar-audit.md', 'specify.md'];
  for (const name of removedDuplicates) {
    assert.equal(
      fs.existsSync(path.join(ROOT_COMMANDS_DIR, name)),
      false,
      `${name} must not exist anywhere under commands/ at repo root (dir itself is gone, but assert the specific path too)`
    );
  }
});

test('T-04-04 @spec AC-11: no .md command name exists in both commands/ and core/adapters/claude/commands/ at once (the invariant)', () => {
  const dupes = findDuplicateCommandNames(ROOT_COMMANDS_DIR, ADAPTER_COMMANDS_DIR);
  assert.deepEqual(dupes, [], `these names exist in both locations, violating AC-11: ${dupes.join(', ')}`);
});

test('T-04-05: core/adapters/claude/commands/ ends up with exactly the 13 expected entries (7 pre-existing + 6 migrated orphans)', () => {
  const expected = [
    'depth-score.md', 'dispatch.md', 'elicit.md', 'encerrar.md', 'gap-finder.md',
    'handoff.md', 'hyd.md', 'plan-sdd.md', 'quality-check.md', 'soma-install.md',
    'soma-run.md', 'sonar-audit.md', 'specify.md',
  ].sort();
  assert.deepEqual(listMdNames(ADAPTER_COMMANDS_DIR), expected);
});
