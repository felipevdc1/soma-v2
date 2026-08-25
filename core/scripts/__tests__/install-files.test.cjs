'use strict';
/**
 * install-files.test.cjs — unit tests for `core/scripts/install/files.cjs`
 * (Spec 018, T-01)
 *
 * This is T-01's own RED bar per tasks.md: "as funções existem e rejeitam
 * entry malformada". The exhaustive CONTRACT-FILE-ENTRY-01 /
 * CONTRACT-FILES-LEDGER-02 stub cases live in their own contract test files
 * (T-02/T-03, Wave 1) — this file exercises the module directly, including
 * a few cases (repoRoot-escape defense, idempotency's needsWrite flag) that
 * are this task's own implementation choices, not literal stub lines.
 *
 * Article III: real filesystem, real temp dirs, zero mock of `fs`.
 * `os.tmpdir()` on this Mac is NOT `/tmp` (it's `/var/folders/...`) —
 * hardcoding `/tmp` would make this pass without testing anything.
 *
 * @task T-01
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const files = require(path.resolve(__dirname, '..', 'install', 'files.cjs'));

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

// ── hasDotDotSegment / expandHome ───────────────────────────────────────────

test('T-01-01: hasDotDotSegment flags ".." as a path segment, not as a substring', () => {
  assert.equal(files.hasDotDotSegment('a/../b'), true);
  assert.equal(files.hasDotDotSegment('..'), true);
  assert.equal(files.hasDotDotSegment('../x'), true);
  assert.equal(files.hasDotDotSegment('x/..'), true);
  // "..name" is not the segment ".." — must not false-positive.
  assert.equal(files.hasDotDotSegment('a/..b/c'), false);
  assert.equal(files.hasDotDotSegment('hooks/framework-guard.cjs'), false);
});

test('T-01-02: expandHome expands leading ~ and leaves other paths untouched', () => {
  assert.equal(files.expandHome('~'), os.homedir());
  assert.equal(files.expandHome('~/x/y'), path.join(os.homedir(), 'x', 'y'));
  assert.equal(files.expandHome('/already/absolute'), '/already/absolute');
});

// ── validateFileEntry — CONTRACT-FILE-ENTRY-01 ─────────────────────────────

test('T-01-03: entry without kind is treated as block and passed through untouched', () => {
  const entry = { block_id: 'x', source_doc: 'y.md', target_path: '~/.claude/CLAUDE.md', target_anchor_id: 'a' };
  const result = files.validateFileEntry(entry);
  assert.equal(result.kind, 'block');
  assert.equal(result.block_id, 'x');
  assert.equal(result.target_anchor_id, 'a');
});

test('T-01-04: kind:"file" entry with the 2 required fields validates (no repoRoot)', () => {
  const result = files.validateFileEntry({
    kind: 'file',
    source_path: 'hooks/framework-guard.cjs',
    target_path: '~/.claude/hooks/framework-guard.cjs',
  });
  assert.equal(result.kind, 'file');
  assert.equal(result.source_path, 'hooks/framework-guard.cjs');
});

test('T-01-05: kind:"file" entry with target_anchor_id is REJECTED, not ignored', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'file', source_path: 'a', target_path: '~/a', target_anchor_id: 'z',
  }), /target_anchor_id/);
});

test('T-01-06: kind:"file" entry with source_doc is REJECTED', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'file', source_path: 'a', target_path: '~/a', source_doc: 'z.md',
  }), /source_doc/);
});

test('T-01-07: kind:"file" entry with block_id is REJECTED', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'file', source_path: 'a', target_path: '~/a', block_id: 'z',
  }), /block_id/);
});

test('T-01-08: ".." in source_path is REJECTED before any path is constructed', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'file', source_path: '../../etc/passwd', target_path: '~/a',
  }), /\.\./);
});

test('T-01-09: ".." in target_path is REJECTED', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'file', source_path: 'a', target_path: '~/../../etc/passwd',
  }), /\.\./);
});

test('T-01-10: unknown kind is REJECTED, never a silent default', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'directory', source_path: 'a', target_path: '~/a',
  }), /kind/);
});

test('T-01-11: missing source_path or target_path is REJECTED', () => {
  assert.throws(() => files.validateFileEntry({ kind: 'file', target_path: '~/a' }), /source_path/);
  assert.throws(() => files.validateFileEntry({ kind: 'file', source_path: 'a' }), /target_path/);
});

test('T-01-12: target_path that is neither absolute nor ~-prefixed is REJECTED', () => {
  assert.throws(() => files.validateFileEntry({
    kind: 'file', source_path: 'a', target_path: 'relative/path',
  }), /absolute|~/);
});

test('T-01-13: with repoRoot, source_path pointing to a real repo file validates', () => {
  withTmp('soma-install-files-repo-', (repo) => {
    fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'hooks', 'guard.cjs'), 'module.exports = {};\n');
    const result = files.validateFileEntry(
      { kind: 'file', source_path: 'hooks/guard.cjs', target_path: '~/.claude/hooks/guard.cjs' },
      { repoRoot: repo }
    );
    assert.equal(result.source_path, 'hooks/guard.cjs');
  });
});

test('T-01-14: with repoRoot, source_path that does not exist in the repo is REJECTED', () => {
  withTmp('soma-install-files-repo-', (repo) => {
    assert.throws(() => files.validateFileEntry(
      { kind: 'file', source_path: 'hooks/nope.cjs', target_path: '~/.claude/hooks/nope.cjs' },
      { repoRoot: repo }
    ), /does not exist/);
  });
});

test('T-01-15: with repoRoot, source_path escaping the repo (absolute, outside) is REJECTED', () => {
  withTmp('soma-install-files-repo-', (repo) => {
    withTmp('soma-install-files-outside-', (outside) => {
      const outsideFile = path.join(outside, 'secret.txt');
      fs.writeFileSync(outsideFile, 'nope\n');
      assert.throws(() => files.validateFileEntry(
        { kind: 'file', source_path: outsideFile, target_path: '~/.claude/x' },
        { repoRoot: repo }
      ), /escapes repoRoot/);
    });
  });
});

// ── sha256 — D-018-04 ────────────────────────────────────────────────────

test('T-01-16: sha256OfContent matches the well-known published digest of the empty string', () => {
  // Independently-known constant (not derived from this module) — proves
  // the hash function itself, not just self-consistency.
  assert.equal(
    files.sha256OfContent(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('T-01-17: sha256OfFile matches an independently-computed digest of real file content', () => {
  withTmp('soma-install-files-hash-', (dir) => {
    const p = path.join(dir, 'x.txt');
    const content = 'hello soma\n';
    fs.writeFileSync(p, content);
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(files.sha256OfFile(p), expected);
  });
});

test('T-01-18: sha256OfFile throws on missing file', () => {
  withTmp('soma-install-files-hash-', (dir) => {
    assert.throws(() => files.sha256OfFile(path.join(dir, 'missing.txt')), /cannot read/);
  });
});

// ── classifyFileState — CONTRACT-FILES-LEDGER-02 decision table ───────────

test('T-01-19: absent target -> clean, regardless of ledger', () => {
  withTmp('soma-install-files-classify-', (dir) => {
    const target = path.join(dir, 'nope.txt');
    assert.equal(files.classifyFileState(target, undefined), 'clean');
    assert.equal(files.classifyFileState(target, { sha256: 'x'.repeat(64), installedAt: 'z' }), 'clean');
  });
});

test('T-01-20: present + sha256 matches ledger -> clean', () => {
  withTmp('soma-install-files-classify-', (dir) => {
    const target = path.join(dir, 'x.txt');
    fs.writeFileSync(target, 'content\n');
    const sha = files.sha256OfFile(target);
    assert.equal(files.classifyFileState(target, { sha256: sha, installedAt: 'z' }), 'clean');
  });
});

test('T-01-21: present + sha256 differs from ledger -> diverged', () => {
  withTmp('soma-install-files-classify-', (dir) => {
    const target = path.join(dir, 'x.txt');
    fs.writeFileSync(target, 'content\n');
    assert.equal(
      files.classifyFileState(target, { sha256: 'f'.repeat(64), installedAt: 'z' }),
      'diverged'
    );
  });
});

test('T-01-22: present + no ledger entry -> diverged (not SOMA\'s file)', () => {
  withTmp('soma-install-files-classify-', (dir) => {
    const target = path.join(dir, 'x.txt');
    fs.writeFileSync(target, 'content\n');
    assert.equal(files.classifyFileState(target, undefined), 'diverged');
  });
});

// ── planFileInstall — two-pass planning, abort-total ───────────────────────

function makeRepoWithFiles(repo, filesMap) {
  for (const [rel, content] of Object.entries(filesMap)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

test('T-01-23: all-clean plan -> ok:true, empty diverged, all entries in plan', () => {
  withTmp('soma-install-files-plan-', (repo) => {
    withTmp('soma-install-files-target-', (targetDir) => {
      makeRepoWithFiles(repo, { 'a.cjs': 'A\n', 'b.cjs': 'B\n' });
      const entries = [
        { kind: 'file', source_path: 'a.cjs', target_path: path.join(targetDir, 'a.cjs') },
        { kind: 'file', source_path: 'b.cjs', target_path: path.join(targetDir, 'b.cjs') },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger: {} });
      assert.equal(result.ok, true);
      assert.deepEqual(result.diverged, []);
      assert.equal(result.plan.length, 2);
      assert.equal(result.plan[0].state, 'clean');
      assert.equal(result.plan[0].needsWrite, true, 'never-installed target needs its first write');
    });
  });
});

test('T-01-24: two diverged entries -> ok:false, BOTH named, not just the first', () => {
  withTmp('soma-install-files-plan-', (repo) => {
    withTmp('soma-install-files-target-', (targetDir) => {
      makeRepoWithFiles(repo, { 'a.cjs': 'A\n', 'b.cjs': 'B\n', 'c.cjs': 'C\n' });
      const targetA = path.join(targetDir, 'a.cjs');
      const targetB = path.join(targetDir, 'b.cjs');
      const targetC = path.join(targetDir, 'c.cjs');
      // a: diverged (edited outside SOMA, no ledger entry)
      fs.writeFileSync(targetA, 'EDITED BY USER\n');
      // b: diverged (ledger entry present but stale)
      fs.writeFileSync(targetB, 'EDITED TOO\n');
      // c: clean (matches ledger)
      fs.writeFileSync(targetC, 'C\n');
      const ledger = {
        [targetB]: { sha256: 'f'.repeat(64), installedAt: 'z' },
        [targetC]: { sha256: files.sha256OfFile(targetC), installedAt: 'z' },
      };
      const entries = [
        { kind: 'file', source_path: 'a.cjs', target_path: targetA },
        { kind: 'file', source_path: 'b.cjs', target_path: targetB },
        { kind: 'file', source_path: 'c.cjs', target_path: targetC },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      assert.equal(result.ok, false);
      assert.deepEqual(result.diverged.sort(), [targetA, targetB].sort());
      assert.equal(result.diverged.length, 2, 'must name ALL diverged targets, not just the first');
    });
  });
});

test('T-01-25: block entries mixed into the array are skipped, not evaluated as files', () => {
  withTmp('soma-install-files-plan-', (repo) => {
    withTmp('soma-install-files-target-', (targetDir) => {
      makeRepoWithFiles(repo, { 'a.cjs': 'A\n' });
      const entries = [
        { block_id: 'existing', source_doc: 'y.md', target_path: '~/.claude/CLAUDE.md', target_anchor_id: 'x' },
        { kind: 'file', source_path: 'a.cjs', target_path: path.join(targetDir, 'a.cjs') },
      ];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger: {} });
      assert.equal(result.plan.length, 1, 'the block entry must not appear in the file plan');
      assert.equal(result.plan[0].source_path, 'a.cjs');
    });
  });
});

test('T-01-26: needsWrite is false when clean AND source content is unchanged since last install (idempotency)', () => {
  withTmp('soma-install-files-plan-', (repo) => {
    withTmp('soma-install-files-target-', (targetDir) => {
      makeRepoWithFiles(repo, { 'a.cjs': 'A\n' });
      const target = path.join(targetDir, 'a.cjs');
      fs.writeFileSync(target, 'A\n');
      const sourceSha = files.sha256OfFile(path.join(repo, 'a.cjs'));
      const ledger = { [target]: { sha256: sourceSha, installedAt: 'z' } };
      const entries = [{ kind: 'file', source_path: 'a.cjs', target_path: target }];
      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      assert.equal(result.plan[0].state, 'clean');
      assert.equal(result.plan[0].needsWrite, false, 'source unchanged -> a second run must write nothing');
    });
  });
});

test('T-01-27: planFileInstall throws (does not silently skip) on a malformed entry', () => {
  withTmp('soma-install-files-plan-', (repo) => {
    makeRepoWithFiles(repo, { 'a.cjs': 'A\n' });
    const entries = [{ kind: 'weird', source_path: 'a.cjs', target_path: '~/x' }];
    assert.throws(() => files.planFileInstall(entries, { repoRoot: repo, ledger: {} }), /kind/);
  });
});

test('T-01-37: needsWrite is true when the target was deleted from disk, even though the ledger sha still matches the source (recovery after deletion)', () => {
  // Bug found by team-lead review: classifyFileState correctly returns
  // 'clean' for BOTH "never written" and "present and matching" (that is
  // the contract's decision table, and it must stay that way). The old
  // needsWrite composition only compared the ledger to the source and
  // never looked at the disk, so a deleted-but-still-recorded file read as
  // "no write needed" — AC-01 broken in silence, exit 0.
  withTmp('soma-install-files-plan-', (repo) => {
    withTmp('soma-install-files-target-', (targetDir) => {
      makeRepoWithFiles(repo, { 'a.cjs': 'A\n' });
      const target = path.join(targetDir, 'a.cjs');
      const sourceSha = files.sha256OfFile(path.join(repo, 'a.cjs'));
      // Ledger says this was already installed and the source hasn't
      // changed since — but the target is NOT written to disk at all,
      // simulating the user (or anything else) deleting it after install.
      const ledger = { [target]: { sha256: sourceSha, installedAt: 'z' } };
      const entries = [{ kind: 'file', source_path: 'a.cjs', target_path: target }];

      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      assert.equal(result.plan[0].state, 'clean', 'absent target still classifies as clean per the contract table');
      assert.equal(
        result.plan[0].needsWrite,
        true,
        'a target missing from disk must always need (re)writing, regardless of what the ledger says'
      );
    });
  });
});

test('T-01-38: needsWrite distinguishes "never materialized" from "already materialized and unchanged", for the SAME ledger entry', () => {
  // The control side of T-01-37: proves the fix does not regress the
  // idempotency guarantee (CONTRACT-FILES-LEDGER-02 stub #9) while fixing
  // the deletion-recovery gap.
  withTmp('soma-install-files-plan-', (repo) => {
    withTmp('soma-install-files-target-', (targetDir) => {
      makeRepoWithFiles(repo, { 'a.cjs': 'A\n' });
      const targetMissing = path.join(targetDir, 'missing.cjs');
      const targetPresent = path.join(targetDir, 'present.cjs');
      fs.writeFileSync(targetPresent, 'A\n');

      const sourceSha = files.sha256OfFile(path.join(repo, 'a.cjs'));
      const ledgerEntry = { sha256: sourceSha, installedAt: 'z' };
      const ledger = { [targetMissing]: ledgerEntry, [targetPresent]: ledgerEntry };
      const entries = [
        { kind: 'file', source_path: 'a.cjs', target_path: targetMissing },
        { kind: 'file', source_path: 'a.cjs', target_path: targetPresent },
      ];

      const result = files.planFileInstall(entries, { repoRoot: repo, ledger });
      const byTarget = Object.fromEntries(result.plan.map((p) => [p.target_path, p]));

      assert.equal(byTarget[targetMissing].state, 'clean');
      assert.equal(byTarget[targetMissing].needsWrite, true, 'deleted-but-ledger-matches must be re-written');

      assert.equal(byTarget[targetPresent].state, 'clean');
      assert.equal(byTarget[targetPresent].needsWrite, false, 'present-and-matching must stay a no-op (idempotency)');
    });
  });
});

// ── readLedger / writeLedger — CONTRACT-FILES-LEDGER-02 ────────────────────

test('T-01-28: readLedger on a project with no install-state.json -> installed:false, installedFiles:{}', () => {
  withTmp('soma-install-files-ledger-', (project) => {
    const result = files.readLedger(project);
    assert.equal(result.installed, false);
    assert.deepEqual(result.installedFiles, {});
  });
});

test('T-01-29: writeLedger then readLedger round-trips installedFiles', () => {
  withTmp('soma-install-files-ledger-', (project) => {
    const entry = files.buildLedgerEntry('a'.repeat(64), '2026-08-21T05:00:00Z');
    files.writeLedger(project, { '~/.claude/hooks/x.cjs': entry });
    const result = files.readLedger(project);
    assert.equal(result.installed, true);
    assert.deepEqual(result.installedFiles, { '~/.claude/hooks/x.cjs': entry });
  });
});

test('T-01-30: writeLedger preserves other top-level fields already in install-state.json', () => {
  withTmp('soma-install-files-ledger-', (project) => {
    const somaDir = path.join(project, '.soma');
    fs.mkdirSync(somaDir, { recursive: true });
    fs.writeFileSync(
      path.join(somaDir, 'install-state.json'),
      JSON.stringify({ $schema: 'soma-install-state/v1', status: 'complete', blockIds: ['a'] }, null, 2) + '\n'
    );
    files.writeLedger(project, { '~/.claude/x': files.buildLedgerEntry('b'.repeat(64)) });
    const raw = JSON.parse(fs.readFileSync(path.join(somaDir, 'install-state.json'), 'utf8'));
    assert.equal(raw.status, 'complete');
    assert.deepEqual(raw.blockIds, ['a']);
    assert.ok(raw.installedFiles['~/.claude/x']);
  });
});

test('T-01-31: writeLedger leaves no leftover .tmp file after a successful write', () => {
  withTmp('soma-install-files-ledger-', (project) => {
    files.writeLedger(project, { '~/.claude/x': files.buildLedgerEntry('c'.repeat(64)) });
    const somaDir = path.join(project, '.soma');
    const leftovers = fs.readdirSync(somaDir).filter((f) => f.includes('.tmp.'));
    assert.deepEqual(leftovers, [], 'atomic write must not leave temp files behind');
  });
});

test('T-01-32: readLedger throws on corrupt install-state.json instead of silently returning {}', () => {
  withTmp('soma-install-files-ledger-', (project) => {
    const somaDir = path.join(project, '.soma');
    fs.mkdirSync(somaDir, { recursive: true });
    fs.writeFileSync(path.join(somaDir, 'install-state.json'), '{ not valid json');
    assert.throws(() => files.readLedger(project), /not valid JSON/);
  });
});

test('T-01-33: writeLedger rejects a non-object installedFiles', () => {
  withTmp('soma-install-files-ledger-', (project) => {
    assert.throws(() => files.writeLedger(project, ['not', 'a', 'map']), /plain object/);
    assert.throws(() => files.writeLedger(project, null), /plain object/);
  });
});

// ── buildLedgerEntry / nowIsoUtc ─────────────────────────────────────────

test('T-01-34: buildLedgerEntry rejects a malformed sha256', () => {
  assert.throws(() => files.buildLedgerEntry('not-a-hash'), /sha256/);
  assert.throws(() => files.buildLedgerEntry(''), /sha256/);
});

test('T-01-35: nowIsoUtc matches install.cjs\'s ISO_UTC_RE (no milliseconds)', () => {
  assert.match(files.nowIsoUtc(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

// ── isFileEntry ─────────────────────────────────────────────────────────

test('T-01-36: isFileEntry is true only for kind:"file", false for block/absent', () => {
  assert.equal(files.isFileEntry({ kind: 'file' }), true);
  assert.equal(files.isFileEntry({ kind: 'block' }), false);
  assert.equal(files.isFileEntry({}), false);
});

// ── Global ownership adoption (Spec 026 AC-03/AC-04/AC-05) ────────────────

function adoptionEntry(sourcePath, targetPath) {
  return { kind: 'file', source_path: sourcePath, target_path: targetPath };
}

test('026 AC-03: an old target identical to its old source is adopted under the verbatim target_path key', () => {
  withTmp('soma-adoption-candidate-', (candidateRoot) => {
    withTmp('soma-adoption-previous-', (previousRoot) => {
      withTmp('soma-adoption-target-', (targetRoot) => {
        const targetPath = path.join(targetRoot, 'hook.cjs');
        makeRepoWithFiles(candidateRoot, { 'hooks/hook.cjs': 'candidate bytes\n' });
        makeRepoWithFiles(previousRoot, { 'hooks/hook.cjs': 'old bytes\n' });
        fs.writeFileSync(targetPath, 'old bytes\n');

        const result = files.planFileAdoption(
          [adoptionEntry('hooks/hook.cjs', targetPath)],
          {
            candidateRoot,
            previousRoot,
            previousEntries: [adoptionEntry('hooks/hook.cjs', targetPath)],
          }
        );

        assert.equal(result.ok, true);
        assert.deepEqual(result.conflicts, []);
        assert.deepEqual(Object.keys(result.ledgerEntries), [targetPath]);
        assert.equal(result.ledgerEntries[targetPath].sha256, files.sha256OfContent('old bytes\n'));
        assert.equal(fs.readFileSync(targetPath, 'utf8'), 'old bytes\n');
      });
    });
  });
});

test('026 adoption matrix: absent old and absent new targets are skipped without ledger entries', () => {
  withTmp('soma-adoption-candidate-', (candidateRoot) => {
    withTmp('soma-adoption-previous-', (previousRoot) => {
      withTmp('soma-adoption-target-', (targetRoot) => {
        const oldTarget = path.join(targetRoot, 'old-absent.cjs');
        const newTarget = path.join(targetRoot, 'new-absent.cjs');
        makeRepoWithFiles(candidateRoot, {
          'hooks/old.cjs': 'new old\n',
          'hooks/new.cjs': 'new target\n',
        });
        makeRepoWithFiles(previousRoot, { 'hooks/old.cjs': 'old old\n' });

        const result = files.planFileAdoption(
          [adoptionEntry('hooks/old.cjs', oldTarget), adoptionEntry('hooks/new.cjs', newTarget)],
          {
            candidateRoot,
            previousRoot,
            previousEntries: [adoptionEntry('hooks/old.cjs', oldTarget)],
          }
        );

        assert.equal(result.ok, true);
        assert.deepEqual(result.conflicts, []);
        assert.deepEqual(result.ledgerEntries, {});
      });
    });
  });
});

test('026 AC-04: divergent, symlinked and unreadable old targets are all reported with zero adoption', () => {
  withTmp('soma-adoption-candidate-', (candidateRoot) => {
    withTmp('soma-adoption-previous-', (previousRoot) => {
      withTmp('soma-adoption-target-', (targetRoot) => {
        const divergent = path.join(targetRoot, 'divergent.cjs');
        const symlinked = path.join(targetRoot, 'symlinked.cjs');
        const unreadable = path.join(targetRoot, 'unreadable');
        const symlinkDestination = path.join(targetRoot, 'outside.cjs');
        makeRepoWithFiles(candidateRoot, {
          'hooks/a.cjs': 'candidate a\n',
          'hooks/b.cjs': 'candidate b\n',
          'hooks/c.cjs': 'candidate c\n',
        });
        makeRepoWithFiles(previousRoot, {
          'hooks/a.cjs': 'old a\n',
          'hooks/b.cjs': 'old b\n',
          'hooks/c.cjs': 'old c\n',
        });
        fs.writeFileSync(divergent, 'user edit\n');
        fs.writeFileSync(symlinkDestination, 'old b\n');
        fs.symlinkSync(symlinkDestination, symlinked);
        fs.mkdirSync(unreadable);

        const entries = [
          adoptionEntry('hooks/a.cjs', divergent),
          adoptionEntry('hooks/b.cjs', symlinked),
          adoptionEntry('hooks/c.cjs', unreadable),
        ];
        const result = files.planFileAdoption(entries, {
          candidateRoot,
          previousRoot,
          previousEntries: entries,
        });

        assert.equal(result.ok, false);
        assert.deepEqual(result.conflicts.sort(), [divergent, symlinked, unreadable].sort());
        assert.deepEqual(result.ledgerEntries, {});
      });
    });
  });
});

test('026 AC-05: a present new target conflicts by default and adopts its live hash only when authorized', () => {
  withTmp('soma-adoption-candidate-', (candidateRoot) => {
    withTmp('soma-adoption-previous-', (previousRoot) => {
      withTmp('soma-adoption-target-', (targetRoot) => {
        const targetPath = path.join(targetRoot, 'new-target.cjs');
        makeRepoWithFiles(candidateRoot, { 'hooks/new.cjs': 'candidate bytes\n' });
        fs.writeFileSync(targetPath, 'live bytes preserved by journal\n');
        const entries = [adoptionEntry('hooks/new.cjs', targetPath)];

        const denied = files.planFileAdoption(entries, {
          candidateRoot,
          previousRoot,
          previousEntries: [],
        });
        assert.equal(denied.ok, false);
        assert.deepEqual(denied.conflicts, [targetPath]);
        assert.deepEqual(denied.ledgerEntries, {});

        let authorizationContext;
        const allowed = files.planFileAdoption(entries, {
          candidateRoot,
          previousRoot,
          previousEntries: [],
          allowNewTargets: true,
          authorizeNewTarget(entry, context) {
            authorizationContext = { entry, context };
            return true;
          },
        });
        assert.equal(allowed.ok, true);
        assert.equal(
          allowed.ledgerEntries[targetPath].sha256,
          files.sha256OfContent('live bytes preserved by journal\n')
        );
        assert.equal(authorizationContext.entry.target_path, targetPath);
        assert.equal(authorizationContext.context.targetPathAbs, targetPath);
        assert.equal(authorizationContext.context.sha256, allowed.ledgerEntries[targetPath].sha256);
      });
    });
  });
});

test('026 adoption planner validates every candidate before returning any ledger mutation plan', () => {
  withTmp('soma-adoption-candidate-', (candidateRoot) => {
    withTmp('soma-adoption-previous-', (previousRoot) => {
      makeRepoWithFiles(candidateRoot, { 'hooks/good.cjs': 'good\n' });
      assert.throws(
        () => files.planFileAdoption([
          adoptionEntry('hooks/good.cjs', '/tmp/good.cjs'),
          { kind: 'file', source_path: '../escape.cjs', target_path: '/tmp/bad.cjs' },
        ], { candidateRoot, previousRoot, previousEntries: [] }),
        /\.\./
      );
    });
  });
});
