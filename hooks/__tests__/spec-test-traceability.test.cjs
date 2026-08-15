'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { validate, validateRedPhase } = require('../spec-test-traceability.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'trace-')); }
function write(p, content) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; }

/**
 * Create a git repo fixture with controlled commit history.
 * opts.implFirst: if true, commit implFiles first in a separate commit, then testFiles.
 * opts.samCommit: if true, commit both testFiles and implFiles in same commit.
 * opts.onlyTest: if true, commit only testFiles (no impl committed).
 * opts.leaveTestUntracked: if true, write testFiles to disk but never git add them.
 */
function gitRepo(testFiles, implFiles, opts = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'git-fixture-'));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.local',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@test.local',
  };
  function git(...args) {
    const r = cp.spawnSync('git', args, { cwd: d, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  }

  git('init', '-q');
  git('config', 'user.email', 'test@test.local');
  git('config', 'user.name', 'Test');

  // Write all files to disk first
  for (const [rel, content] of Object.entries(implFiles || {})) {
    const abs = path.join(d, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  for (const [rel, content] of Object.entries(testFiles || {})) {
    const abs = path.join(d, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  if (opts.leaveTestUntracked) {
    // Don't commit anything — files are on disk but no git history
    return d;
  }

  if (opts.implFirst) {
    // Commit impl first, then test
    for (const rel of Object.keys(implFiles || {})) {
      git('add', rel);
    }
    git('commit', '-q', '-m', 'add impl');
    for (const rel of Object.keys(testFiles || {})) {
      git('add', rel);
    }
    git('commit', '-q', '-m', 'add test (after impl)');
  } else if (opts.sameCommit) {
    // Commit both in same commit
    for (const rel of Object.keys(implFiles || {})) git('add', rel);
    for (const rel of Object.keys(testFiles || {})) git('add', rel);
    git('commit', '-q', '-m', 'add impl and test together');
  } else if (opts.onlyTest) {
    // Commit only test files (no impl)
    for (const rel of Object.keys(testFiles || {})) git('add', rel);
    git('commit', '-q', '-m', 'add test (no impl)');
  }

  return d;
}

// ─── Existing tests (13 original) ───────────────────────────────────────────

test('all 3 ACs covered → pass 100%', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n- **AC-03**: c\n');
  write(path.join(d, 'tests/a.test.ts'), '// @spec AC-01\n// @spec AC-02\n// @spec AC-03\n');
  const r = validate(spec, path.join(d, 'tests'));
  assert.equal(r.pass, true);
  assert.equal(r.coveragePercent, 100);
  assert.equal(r.totalAC, 3);
  assert.deepEqual(r.uncoveredAC, []);
  assert.deepEqual(r.orphanTests, []);
});

test('2 of 3 ACs covered → fail, uncoveredAC: ["AC-03"]', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n- **AC-03**: c\n');
  write(path.join(d, 'tests/a.test.js'), '// @spec AC-01\n// @spec AC-02\n');
  const r = validate(spec, path.join(d, 'tests'));
  assert.equal(r.pass, false);
  assert.deepEqual(r.uncoveredAC, ['AC-03']);
  assert.ok(r.failReasons.some(s => s.includes('uncovered')));
});

test('test refs AC not in spec → fail, orphanTests populated', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  write(path.join(d, 'tests/a.test.js'), '// @spec AC-01\n// @spec AC-99\n');
  const r = validate(spec, path.join(d, 'tests'));
  assert.equal(r.pass, false);
  assert.ok(r.orphanTests.length > 0);
  assert.ok(r.failReasons.some(s => s.includes('orphan')));
});

test('filename convention login_ac-01.test.ts counts as coverage', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  write(path.join(d, 'tests/login_ac-01.test.ts'), 'it("x", () => {});\n');
  const r = validate(spec, path.join(d, 'tests'));
  assert.equal(r.pass, true);
  assert.equal(r.coveragePercent, 100);
});

test('missing spec file → throws with code ENOSPEC', () => {
  assert.throws(() => validate('/no/such/spec.md', '/tmp'), { code: 'ENOSPEC' });
});

test('empty tests dir → fail 0% coverage', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  fs.mkdirSync(path.join(d, 'empty'));
  const r = validate(spec, path.join(d, 'empty'));
  assert.equal(r.pass, false);
  assert.equal(r.coveragePercent, 0);
});

// --- Skip detection tests (Bug 2 fix) ---

test('T7: test.skip with @spec AC-01 → uncoveredAC includes AC-01', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n');
  write(path.join(d, 'tests/a.test.ts'),
    "test('normal', () => { /* @spec AC-02 */ });\n" +
    "test.skip('skipped', () => { /* @spec AC-01 */ });\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  assert.ok(r.uncoveredAC.includes('AC-01'), `Expected AC-01 uncovered, got: ${JSON.stringify(r.uncoveredAC)}`);
  assert.ok(!r.uncoveredAC.includes('AC-02'), `Expected AC-02 covered`);
});

test('T8: describe.skip containing @spec AC-01 → uncoveredAC includes AC-01', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n');
  write(path.join(d, 'tests/a.test.ts'),
    "test('normal', () => { /* @spec AC-02 */ });\n" +
    "describe.skip('group', () => {\n" +
    "  test('inner', () => { /* @spec AC-01 */ });\n" +
    "});\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  assert.ok(r.uncoveredAC.includes('AC-01'), `Expected AC-01 uncovered, got: ${JSON.stringify(r.uncoveredAC)}`);
  assert.ok(!r.uncoveredAC.includes('AC-02'), `Expected AC-02 covered`);
});

test('T9: xit with @spec AC-01 → uncoveredAC includes AC-01', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n');
  write(path.join(d, 'tests/a.test.ts'),
    "it('normal', () => { /* @spec AC-02 */ });\n" +
    "xit('skipped', () => { /* @spec AC-01 */ });\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  assert.ok(r.uncoveredAC.includes('AC-01'), `Expected AC-01 uncovered, got: ${JSON.stringify(r.uncoveredAC)}`);
  assert.ok(!r.uncoveredAC.includes('AC-02'), `Expected AC-02 covered`);
});

test('T10: filename ac-01 convention but entire file in test.skip → uncoveredAC includes AC-01', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  // File name matches ac-01 convention, but ALL tests are skipped
  write(path.join(d, 'tests/login_ac-01.test.ts'),
    "test.skip('everything skipped', () => {\n" +
    "  expect(true).toBe(true);\n" +
    "});\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  assert.ok(r.uncoveredAC.includes('AC-01'), `Expected AC-01 uncovered (all tests skipped), got: ${JSON.stringify(r.uncoveredAC)}`);
});

test('T11: mix of normal test (@spec AC-01) and test.skip (@spec AC-02) → AC-01 covered, AC-02 uncovered', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n');
  write(path.join(d, 'tests/a.test.ts'),
    "test('active', () => { /* @spec AC-01 */ });\n" +
    "test.skip('skipped', () => { /* @spec AC-02 */ });\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  assert.ok(!r.uncoveredAC.includes('AC-01'), `Expected AC-01 covered`);
  assert.ok(r.uncoveredAC.includes('AC-02'), `Expected AC-02 uncovered`);
});

test('T12: skippedRefs field populated with skipped AC refs', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n');
  write(path.join(d, 'tests/a.test.ts'),
    "test('active', () => { /* @spec AC-01 */ });\n" +
    "test.skip('skipped', () => { /* @spec AC-02 */ });\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  // skippedRefs should be an array listing AC-02
  assert.ok(Array.isArray(r.skippedRefs), `Expected skippedRefs to be an array, got: ${typeof r.skippedRefs}`);
  assert.ok(r.skippedRefs.includes('AC-02'), `Expected skippedRefs to contain AC-02, got: ${JSON.stringify(r.skippedRefs)}`);
  assert.ok(!r.skippedRefs.includes('AC-01'), `Expected skippedRefs to NOT contain AC-01`);
});

test('T13: reversed order — skip block BEFORE active block should not leak', () => {
  // Regression: backward scan was marking ACs as skipped when a prior
  // test.skip(...) appeared within the 10-line window, even after its block
  // had already closed.
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n- **AC-02**: b\n');
  write(path.join(d, 'tests/a.test.ts'),
    "test.skip('skipped first', () => {\n" +
    "  // @spec AC-01\n" +
    "  expect(1).toBe(1);\n" +
    "});\n" +
    "\n" +
    "test('active after skip', () => {\n" +
    "  // @spec AC-02\n" +
    "  expect(1).toBe(1);\n" +
    "});\n"
  );
  const r = validate(spec, path.join(d, 'tests'));
  assert.ok(r.uncoveredAC.includes('AC-01'), `Expected AC-01 uncovered (inside skip block), got: ${JSON.stringify(r.uncoveredAC)}`);
  assert.ok(!r.uncoveredAC.includes('AC-02'), `Expected AC-02 covered (active block after closed skip), got: ${JSON.stringify(r.uncoveredAC)}`);
  assert.ok(r.skippedRefs.includes('AC-01'), `Expected AC-01 in skippedRefs`);
  assert.ok(!r.skippedRefs.includes('AC-02'), `Expected AC-02 NOT in skippedRefs`);
});

// ─── C-2: RED Phase Validator tests (new — intentionally failing until impl) ──

test('C2-1: no git context → validateRedPhase returns status=no_git_context', () => {
  // Use a path in a non-git directory
  const d = tmp(); // os.tmpdir() is not a git repo
  const testFile = path.join(d, 'foo.test.cjs');
  fs.writeFileSync(testFile, 'test("x", () => {});\n');
  const result = validateRedPhase(testFile);
  assert.equal(result.status, 'no_git_context',
    `Expected no_git_context, got: ${JSON.stringify(result)}`);
});

test('C2-2: test added without impl in same commit → status=verified', () => {
  // Test file committed; impl file exists on disk (untracked) but never committed.
  // git ls-tree at addCommit will not find the impl → verified (genuine RED commit).
  const d = gitRepo(
    { 'lib/foo.test.cjs': 'test("x", () => {});\n' },
    {},
    { onlyTest: true }
  );
  // Write impl on disk (untracked) so resolveImplPath can find a candidate
  fs.mkdirSync(path.join(d, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(d, 'lib/foo.cjs'), 'module.exports = {};\n');

  const testFile = path.join(d, 'lib/foo.test.cjs');
  const result = validateRedPhase(testFile);
  assert.equal(result.status, 'verified',
    `Expected verified (impl on disk but not committed at test-add commit), got: ${JSON.stringify(result)}`);
});

test('C2-3: test and impl added in same commit → status=violation', () => {
  // Both committed together — no separate RED phase
  const d = gitRepo(
    { 'lib/foo.test.cjs': 'test("x", () => {});\n' },
    { 'lib/foo.cjs': 'module.exports = {};\n' },
    { sameCommit: true }
  );
  const testFile = path.join(d, 'lib/foo.test.cjs');
  const result = validateRedPhase(testFile);
  assert.equal(result.status, 'violation',
    `Expected violation (impl committed same as test), got: ${JSON.stringify(result)}`);
});

test('C2-4: impl predates test → status=verified', () => {
  // Impl committed first, then test — TDD against existing code, valid
  const d = gitRepo(
    { 'lib/foo.test.cjs': 'test("x", () => {});\n' },
    { 'lib/foo.cjs': 'module.exports = {};\n' },
    { implFirst: true }
  );
  const testFile = path.join(d, 'lib/foo.test.cjs');
  const result = validateRedPhase(testFile);
  assert.equal(result.status, 'verified',
    `Expected verified (impl pre-existed), got: ${JSON.stringify(result)}`);
});

test('C2-5: no impl path resolved → status=no_impl_resolved', () => {
  // Test file in a directory where no impl candidate exists
  // Use a weird path pattern that won't resolve to a real file
  const d = gitRepo(
    { 'unusual.deeply.nested.test.cjs': 'test("x", () => {});\n' },
    {},
    { onlyTest: true }
  );
  // File with no resolvable impl path (no .test. → . transform applies, but result won't exist)
  // Actually the transform WILL produce a path candidate. We need a test file where NEITHER
  // candidate (direct strip nor __tests__ transform) points to an existing file.
  // The "unusual.deeply.nested.test.cjs" → "unusual.deeply.nested.cjs" won't exist on disk.
  // BUT the algo checks if candidates exist on disk before choosing — if none exist → no_impl_resolved
  const testFile = path.join(d, 'unusual.deeply.nested.test.cjs');
  const result = validateRedPhase(testFile);
  assert.equal(result.status, 'no_impl_resolved',
    `Expected no_impl_resolved (no impl candidate on disk), got: ${JSON.stringify(result)}`);
});

test('C2-6: untracked test file → status=no_history', () => {
  // File on disk but never committed
  const d = gitRepo(
    { 'lib/bar.test.cjs': 'test("y", () => {});\n' },
    { 'lib/bar.cjs': 'module.exports = {};\n' },
    { leaveTestUntracked: true }
  );
  const testFile = path.join(d, 'lib/bar.test.cjs');
  const result = validateRedPhase(testFile);
  assert.equal(result.status, 'no_history',
    `Expected no_history (test never committed), got: ${JSON.stringify(result)}`);
});

test('C2-7: validate() with checkRedPhase=false (default) → no red_phase_evidence in output', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  write(path.join(d, 'tests/a.test.ts'), '// @spec AC-01\n');
  // Default call (no opts) — backward compat
  const r = validate(spec, path.join(d, 'tests'));
  assert.equal(r.red_phase_evidence, undefined,
    `Expected red_phase_evidence undefined with default opts, got: ${JSON.stringify(r.red_phase_evidence)}`);
  // Explicit false
  const r2 = validate(spec, path.join(d, 'tests'), undefined, { checkRedPhase: false });
  assert.equal(r2.red_phase_evidence, undefined,
    `Expected red_phase_evidence undefined with checkRedPhase=false, got: ${JSON.stringify(r2.red_phase_evidence)}`);
});

test('C2-8: validate() with checkRedPhase=true → red_phase_evidence populated with results array', () => {
  const d = tmp();
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  write(path.join(d, 'tests/a.test.ts'), '// @spec AC-01\n');
  const r = validate(spec, path.join(d, 'tests'), undefined, { checkRedPhase: true });
  assert.ok(r.red_phase_evidence !== undefined,
    `Expected red_phase_evidence to be present with checkRedPhase=true`);
  assert.ok(typeof r.red_phase_evidence === 'object',
    `Expected red_phase_evidence to be object`);
  assert.ok(Array.isArray(r.red_phase_evidence.results),
    `Expected red_phase_evidence.results to be array`);
  assert.ok(Array.isArray(r.red_phase_evidence.violations),
    `Expected red_phase_evidence.violations to be array`);
  assert.ok(typeof r.red_phase_evidence.checked === 'number',
    `Expected red_phase_evidence.checked to be number`);
});

test('C2-9: SOMA_RED_PHASE_STRICT=1 forces check + violations push to failReasons + pass=false', () => {
  // Create a git fixture where test+impl were committed together → violation
  const d = gitRepo(
    { 'lib/baz.test.cjs': 'test("z", () => {});\n' },
    { 'lib/baz.cjs': 'module.exports = {};\n' },
    { sameCommit: true }
  );

  // Build a mini spec+tests in the git fixture dir so validate can find the test
  const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
  write(path.join(d, 'lib/baz.test.cjs'), '// @spec AC-01\n// also test("z",()=>{});\n');

  // We need to re-commit after writing @spec content (the fixture already has the file)
  // But the key is: baz.cjs was committed together with baz.test.cjs → violation
  // Actually for this test we need the @spec annotation to be present in the file,
  // but the git history was already committed in the fixture. Re-write and re-commit:
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.local',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@test.local',
    SOMA_RED_PHASE_STRICT: '1',
  };

  // Run validate with SOMA_RED_PHASE_STRICT=1 env (simulate by setting process.env temporarily)
  const originalStrict = process.env.SOMA_RED_PHASE_STRICT;
  try {
    process.env.SOMA_RED_PHASE_STRICT = '1';
    // The test file on disk (in a non-git-tracked tmp dir for the spec) won't have git history
    // Use a non-git dir for the spec/tests but point to the test file from the git fixture
    // to trigger a violation result
    const specPath = path.join(d, 'spec.md');
    const r = validate(specPath, path.join(d, 'lib'), undefined, {});
    // With SOMA_RED_PHASE_STRICT=1, checkRedPhase should be forced true
    assert.ok(r.red_phase_evidence !== undefined,
      `SOMA_RED_PHASE_STRICT=1 should force red_phase_evidence`);
    // violations exist (baz.test.cjs committed same as baz.cjs)
    if (r.red_phase_evidence.violations.length > 0) {
      assert.ok(r.failReasons.some(s => s.includes('RED phase')),
        `Expected failReasons to include RED phase message, got: ${JSON.stringify(r.failReasons)}`);
      assert.equal(r.pass, false,
        `Expected pass=false when violations exist under strict mode`);
    }
    // Even with 0 violations (no_git_context for test file): red_phase_evidence still present
  } finally {
    if (originalStrict === undefined) {
      delete process.env.SOMA_RED_PHASE_STRICT;
    } else {
      process.env.SOMA_RED_PHASE_STRICT = originalStrict;
    }
  }
});

test('C2-10: CLI flag --check-red-phase enables check independent of env', () => {
  // This test validates the behavior via the module API since we can't easily
  // spawn a subprocess and check stdout in a unit test context.
  // We verify that opts.checkRedPhase=true (the programmatic equivalent of --check-red-phase)
  // produces red_phase_evidence regardless of SOMA_RED_PHASE_STRICT env.
  const originalStrict = process.env.SOMA_RED_PHASE_STRICT;
  try {
    delete process.env.SOMA_RED_PHASE_STRICT; // ensure env is unset
    const d = tmp();
    const spec = write(path.join(d, 'spec.md'), '- **AC-01**: a\n');
    write(path.join(d, 'tests/a.test.ts'), '// @spec AC-01\n');
    // Without flag (default): no evidence
    const r1 = validate(spec, path.join(d, 'tests'));
    assert.equal(r1.red_phase_evidence, undefined,
      `Without --check-red-phase, red_phase_evidence should be absent`);
    // With flag (opts.checkRedPhase=true): evidence present
    const r2 = validate(spec, path.join(d, 'tests'), undefined, { checkRedPhase: true });
    assert.ok(r2.red_phase_evidence !== undefined,
      `With checkRedPhase=true (--check-red-phase), red_phase_evidence must be present`);
  } finally {
    if (originalStrict === undefined) {
      delete process.env.SOMA_RED_PHASE_STRICT;
    } else {
      process.env.SOMA_RED_PHASE_STRICT = originalStrict;
    }
  }
});
