'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const TEST_EXTS = [
  '.test.ts', '.test.js', '.test.tsx', '.test.jsx', '.test.cjs', '.test.mjs',
  '.spec.ts', '.spec.js', '.spec.tsx', '.spec.jsx', '.spec.cjs', '.spec.mjs',
];

function walkDir(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, exts));
    } else if (exts.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

function findTestFiles(pattern) {
  if (!pattern) {
    return ['tests', 'test', '__tests__'].flatMap(d => walkDir(d, TEST_EXTS));
  }
  if (fs.existsSync(pattern)) {
    return fs.statSync(pattern).isDirectory() ? walkDir(pattern, TEST_EXTS) : [pattern];
  }
  const braceMatch = pattern.match(/^\{([^}]+)\}/);
  if (braceMatch) {
    return braceMatch[1].split(',').flatMap(d => walkDir(d.trim(), TEST_EXTS));
  }
  if (pattern.includes('/**')) {
    const base = pattern.split('/**')[0];
    if (fs.existsSync(base)) return walkDir(base, TEST_EXTS);
  }
  return [];
}

function extractACs(specPath) {
  const ids = [];
  // v3 Fase 1: also accept the "### AC-NN: ..." heading form used by the
  // new EARS-grammar template, alongside the pre-existing bare/bullet-bold
  // forms. Without this, a new-format spec yields zero AC ids here, which
  // makes coveredSet/acSet empty and turns every @spec-annotated test into
  // a false orphan (validate() would then fail specs that are fully covered).
  for (const line of fs.readFileSync(specPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*#{0,6}\s*-?\s*\*{0,2}(AC-\d+)\*{0,2}:/);
    if (m) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

/**
 * Patterns that mark a test as skipped (in the lines BEFORE a @spec annotation,
 * or as prefix of the function call on the same line).
 * Covers: test.skip(, describe.skip(, it.skip(, xdescribe(, xtest(, xit(
 */
const SKIP_PATTERN = /(?:(?:test|describe|it)\.skip\s*\(|(?:xdescribe|xtest|xit)\s*\()/;

/**
 * Approximate brace balance on a single line. Positive = opens block,
 * zero = self-contained, negative = closes a block opened above.
 * Ignores string/comment edge cases — good enough for the common test
 * syntax we care about.
 */
function lineBraceBalance(line) {
  let balance = 0;
  for (const ch of line) {
    if (ch === '{') balance++;
    else if (ch === '}') balance--;
  }
  return balance;
}

/**
 * Detect whether a specific line index (0-based) in `lines` falls inside a
 * skipped context. Handles two conventions:
 *   (1) Same-line annotation: `test.skip('x', () => { /* @spec AC-01 *\/ });`
 *   (2) Multi-line body:      annotation inside an unclosed test.skip block
 * A prior test.skip that already closed (e.g. `test.skip(...);` above, then
 * a new active `test(...)` containing the annotation) must NOT leak — we
 * track net brace balance going backward and only flag the FIRST line that
 * opens an enclosing block (netBalance becomes positive).
 */
function isSkippedContext(lines, lineIdx) {
  // Inline skip marker
  if (lineIdx > 0 && /\/\/\s*@skip\b/.test(lines[lineIdx - 1])) return true;

  // Annotation line itself contains a skip call (same-line convention)
  if (SKIP_PATTERN.test(lines[lineIdx])) return true;

  // Walk backward, tracking running balance. The first line that leaves us
  // at netBalance > 0 is the opener of our immediately enclosing block.
  const start = Math.max(0, lineIdx - 20);
  let netBalance = 0;
  for (let i = lineIdx - 1; i >= start; i--) {
    netBalance += lineBraceBalance(lines[i]);
    if (netBalance > 0) {
      // This line opens our enclosing block — its skip status is authoritative.
      return SKIP_PATTERN.test(lines[i]);
    }
    // netBalance < 0: entered a block that had already closed — not our container; keep walking.
    // netBalance == 0: balanced (self-contained) block between us and this line — keep walking.
  }
  return false;
}

/**
 * Check whether a file is entirely skipped (all executable content wrapped in
 * skip/x-variant blocks at the top level). Used for filename-convention refs.
 * Heuristic: the file has at least one skip-pattern occurrence AND no
 * non-skip test/describe/it call at the top-level (not nested inside skip).
 */
function isEntireFileSkipped(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // If no skip pattern at all, definitely not fully skipped
    if (!SKIP_PATTERN.test(content)) return false;

    // Look for non-skip top-level test/describe/it calls
    // (i.e. "test(", "it(", "describe(" without .skip prefix and without x-prefix)
    const NON_SKIP_TEST = /(?:^|[^.a-zA-Z])(?:test|describe|it)\s*\(/m;
    const hasNonSkip = NON_SKIP_TEST.test(content);
    return !hasNonSkip;
  } catch (_) {
    return false;
  }
}

function extractACRefs(filePath) {
  const refs = [];
  const skippedRefs = [];

  const fnMatch = path.basename(filePath).match(/_ac-(\d+)\./i);
  if (fnMatch) {
    const acId = `AC-${fnMatch[1]}`;
    if (isEntireFileSkipped(filePath)) {
      skippedRefs.push({ acId, file: filePath, line: 0 });
    } else {
      refs.push({ acId, file: filePath, line: 0 });
    }
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/@spec\s+(AC-\d+)/g)) {
      const ref = { acId: m[1], file: filePath, line: i + 1 };
      if (isSkippedContext(lines, i)) {
        skippedRefs.push(ref);
      } else {
        refs.push(ref);
      }
    }
  }
  return { refs, skippedRefs };
}

/**
 * Run a git command in a given directory. Returns stdout on success, null on failure.
 * Uses spawnSync to avoid shell injection.
 */
function gitRun(args, cwd) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

/**
 * Resolve the most likely impl file path from a test file path.
 * Tries two candidate transforms (first existing on disk wins):
 *   a) testPath.replace(/\.test\.([^.]+)$/, '.$1')
 *      e.g. lib/foo.test.cjs → lib/foo.cjs
 *   b) testPath.replace(/\/__tests__\//, '/').replace(/\.test\.([^.]+)$/, '.$1')
 *      e.g. src/__tests__/foo.test.cjs → src/foo.cjs
 * Returns the resolved absolute path, or null if neither candidate exists.
 */
function resolveImplPath(testPath) {
  const candidates = [
    testPath.replace(/\.test\.([^.]+)$/, '.$1'),
    testPath.replace(/\/__tests__\//, '/').replace(/\.test\.([^.]+)$/, '.$1'),
  ];
  // Deduplicate (both transforms may produce the same result)
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    // Only valid if different from testPath (otherwise it's not a real transform)
    if (c !== testPath && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * validateRedPhase(testPath, opts = {}) → RedPhaseResult
 *
 * Heuristic A: check git-log-verifiable RED phase evidence for a test file.
 * Determines whether the test file was committed separately from its implementation,
 * operationalizing Constitution Article II HARD enforcement.
 *
 * Returns:
 *   { status: 'verified' }         — test was committed without impl (genuine RED)
 *   { status: 'violation', ... }   — test and impl added in same commit (no RED phase)
 *   { status: 'no_git_context' }   — testPath not in any git repository
 *   { status: 'no_impl_resolved' } — no impl file candidate found on disk
 *   { status: 'no_history' }       — test file exists on disk but no git history found
 */
function validateRedPhase(testPath, opts = {}) {
  // Step 1: find git dir for testPath's directory
  const testDir = path.dirname(testPath);
  const gitDir = gitRun(['rev-parse', '--git-dir'], testDir);
  if (!gitDir) {
    return { status: 'no_git_context' };
  }

  // Step 2: resolve impl path — first candidate that exists on disk
  const implPath = resolveImplPath(testPath);
  if (!implPath) {
    return { status: 'no_impl_resolved' };
  }

  // Step 3: find the commit that first added testPath
  const addCommit = gitRun(
    ['log', '--all', '--diff-filter=A', '--pretty=format:%H', '--', testPath],
    testDir
  );
  if (!addCommit) {
    return { status: 'no_history', implPath };
  }
  // git log may return multiple SHAs (rare with --diff-filter=A, but handle it)
  const addCommitSha = addCommit.split('\n')[0].trim();
  if (!addCommitSha) {
    return { status: 'no_history', implPath };
  }

  // Step 4a: check if impl existed at addCommit
  const implAtAdd = gitRun(
    ['ls-tree', '--name-only', addCommitSha, '--', implPath],
    testDir
  );

  if (!implAtAdd) {
    // impl didn't exist at that revision → genuine RED commit
    return { status: 'verified', addCommit: addCommitSha, implPath };
  }

  // Step 4b: impl was present — check if impl was ALSO added in same commit
  const implAddCommit = gitRun(
    ['log', '--all', '--diff-filter=A', '--pretty=format:%H', '--', implPath],
    testDir
  );
  if (!implAddCommit) {
    // impl existed but we can't trace its add commit — treat as verified (impl pre-existed)
    return { status: 'verified', addCommit: addCommitSha, implPath };
  }
  const implAddCommitSha = implAddCommit.split('\n')[0].trim();

  if (implAddCommitSha === addCommitSha) {
    return {
      status: 'violation',
      addCommit: addCommitSha,
      implPath,
      reason: `test and impl both added in commit ${addCommitSha}`,
    };
  }

  // impl was added in a different (earlier) commit → valid TDD against existing code
  return { status: 'verified', addCommit: addCommitSha, implPath };
}

/**
 * validate(specPath, testsGlob, tasksPath, opts)
 *
 * opts.checkRedPhase {boolean} — default false (backward compat)
 *   When true, runs validateRedPhase on each test file found and attaches
 *   red_phase_evidence to the result.
 *
 * SOMA_RED_PHASE_STRICT=1 env forces opts.checkRedPhase=true and treats
 * violations as failures (pushes to failReasons + sets pass=false).
 */
function validate(specPath, testsGlob, tasksPath, opts = {}) {
  // Respect SOMA_RED_PHASE_STRICT env
  const strictMode = process.env.SOMA_RED_PHASE_STRICT === '1';
  const checkRedPhase = strictMode || (opts && opts.checkRedPhase === true);

  if (!fs.existsSync(specPath)) {
    const err = new Error(`Spec file not found: ${specPath}`);
    err.code = 'ENOSPEC';
    throw err;
  }

  const acIds = extractACs(specPath);
  const testFiles = findTestFiles(testsGlob);

  // extractACRefs now returns { refs, skippedRefs }
  const extracted = testFiles.map(f => extractACRefs(f));
  const allRefs = extracted.flatMap(e => e.refs);
  const allSkippedRefs = extracted.flatMap(e => e.skippedRefs);

  const coveredSet = new Set(allRefs.map(r => r.acId));
  const acSet = new Set(acIds);

  const uncoveredAC = acIds.filter(ac => !coveredSet.has(ac));
  const orphanTests = allRefs
    .filter(r => !acSet.has(r.acId))
    .map(({ file, line }) => ({ file, line }));
  const coveredAC = acIds.length - uncoveredAC.length;
  const coveragePercent = acIds.length > 0 ? Math.round((coveredAC / acIds.length) * 100) : 0;

  const failReasons = [];
  if (uncoveredAC.length > 0) failReasons.push(`${uncoveredAC.length} AC uncovered`);
  if (orphanTests.length > 0) failReasons.push(`${orphanTests.length} orphan test${orphanTests.length > 1 ? 's' : ''}`);

  if (tasksPath && fs.existsSync(tasksPath)) {
    const taskRefs = [...fs.readFileSync(tasksPath, 'utf8').matchAll(/\[SPEC:(AC-\d+)\]/g)].map(m => m[1]);
    const taskMissing = taskRefs.filter(ac => !coveredSet.has(ac));
    if (taskMissing.length > 0) failReasons.push(`${taskMissing.length} task-referenced AC(s) lack tests`);
  }

  const result = {
    specPath,
    totalAC: acIds.length,
    coveredAC,
    uncoveredAC,
    orphanTests,
    coveragePercent,
    pass: failReasons.length === 0,
    failReasons,
    // Optional: AC refs that were excluded because they are inside skipped tests.
    // Populated when skip detection fires. Useful for debugging false coverage.
    skippedRefs: allSkippedRefs.map(r => r.acId),
  };

  // RED phase evidence (opt-in or forced by strict mode)
  if (checkRedPhase) {
    const redResults = testFiles.map(f => {
      const r = validateRedPhase(f);
      return { testFile: f, ...r };
    });
    const violations = redResults
      .filter(r => r.status === 'violation')
      .map(r => r.testFile);

    result.red_phase_evidence = {
      checked: testFiles.length,
      results: redResults,
      violations,
    };

    if (strictMode && violations.length > 0) {
      failReasons.push(`${violations.length} test(s) without RED phase evidence`);
      result.pass = false;
    }
    // Ensure failReasons is up to date in result (it's already by reference above,
    // but result.pass may need to be flipped)
    result.failReasons = failReasons;
  }

  return result;
}

module.exports = { validate, validateRedPhase };

/**
 * Translates validate()'s internal (camelCase) result into the payload
 * shape documented in spec.md AC-09 / tasks.md T-15 / quickstart.md §7 /
 * soma-run.md STEP_5_VALIDATE: `coverage`, `orphan_tests`, `uncovered_ac`,
 * `red_phase_evidence`. Renaming happens ONLY here, at the CLI output
 * boundary — validate()'s own return shape (coveragePercent / orphanTests
 * / uncoveredAC) is untouched, because 442 lines of existing tests in
 * hooks/__tests__/spec-test-traceability.test.cjs call validate() directly
 * and depend on that exact shape. `red_phase_evidence` is already
 * snake_case internally, so it's copied over as-is when present (i.e.
 * when checkRedPhase produced it).
 */
function toCliPayload(result) {
  const payload = {
    specPath: result.specPath,
    totalAC: result.totalAC,
    coverage: result.coveragePercent,
    coveredAC: result.coveredAC,
    uncovered_ac: result.uncoveredAC,
    orphan_tests: result.orphanTests,
    pass: result.pass,
    failReasons: result.failReasons,
    skippedRefs: result.skippedRefs,
  };
  if ('red_phase_evidence' in result) payload.red_phase_evidence = result.red_phase_evidence;
  return payload;
}

if (require.main === module) {
  // ── PreToolUse/Bash entry point — MUST stay the first branch, before any
  // further require/fs/parse work runs. install/soma-hooks-map.json (T-15)
  // registers this file under PreToolUse matcher "Bash", which means
  // Claude Code invokes it — zero argv, a JSON tool-call payload on stdin —
  // before EVERY bash command in EVERY session, not just SOMA runs. This
  // is NOT a gate: it never blocks anything. The registration exists only
  // as proof-of-wiring (quickstart.md's `grep -c "spec-test-traceability"
  // install/soma-hooks-map.json` check, and plan.md's general hook-wiring
  // pattern) — real AC-10 enforcement lives entirely in the exit code and
  // payload of the explicit `validate` invocation below, which
  // STEP_5_VALIDATE reads. Blocking here would swallow the very payload
  // AC-09 requires the orchestrator to read. Since the outcome (always
  // allow) never depends on whether this happens to be our own
  // invocation, there's nothing worth a stdin read for — argv.length is
  // the entire check, and it's the cheapest one available.
  if (process.argv.length <= 2) {
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const verb = args[0];
  if (verb !== 'validate') {
    console.error('Usage: node spec-test-traceability.cjs validate <specPath> [testsGlob] [tasksPath] [--check-red-phase]');
    process.exit(2);
  }

  // --check-red-phase is accepted (filtered out of positionals below) but
  // redundant under this verb: the `validate` verb's own contract (AC-09)
  // always includes red_phase_evidence in the payload — see the true
  // default passed to validate() below. validate()'s OWN default (false)
  // is untouched for direct callers.
  const rest = args.slice(1);
  const positional = rest.filter(a => !a.startsWith('--'));
  const [specArg, globArg, tasksArg] = positional;

  if (!specArg) {
    console.error('Usage: node spec-test-traceability.cjs validate <specPath> [testsGlob] [tasksPath] [--check-red-phase]');
    process.exit(2);
  }
  let result;
  try {
    result = validate(specArg, globArg, tasksArg, { checkRedPhase: true });
  } catch (err) {
    if (err.code === 'ENOSPEC') { console.error(err.message); process.exit(2); }
    throw err;
  }
  console.log(JSON.stringify(toCliPayload(result), null, 2));
  process.exit(result.pass ? 0 : 1);
}
