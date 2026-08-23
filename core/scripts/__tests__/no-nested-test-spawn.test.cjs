'use strict';
/**
 * no-nested-test-spawn.test.cjs — orphan `node --test` process elimination
 *
 * Structural regression: no *.test.cjs file in this repo may generate a
 * temporary wrapper script that itself spawns a child process, then execute
 * that wrapper via spawnSync — i.e. a pai -> wrapper -> neto pattern.
 *
 * Why this matters (measured, not assumed):
 * hooks-regression.test.cjs, phase3-regression.test.cjs and
 * phase4a-regression.test.cjs each wrote a wrapper .cjs to os.tmpdir()
 * whose OWN body called spawnSync(NODE_BIN, ['--test', ...files], { timeout }).
 * The OUTER spawnSync's timeout only bounds the WRAPPER process. When it
 * fires, the wrapper dies but its own spawnSync child (`node --test`, the
 * "neto") is unaffected — Node's spawnSync timeout kills the direct child
 * only, not descendants of that child. The neto gets reparented to PID 1
 * and keeps running against the real ~/.soma-v2 install, unbounded, for as
 * long as the underlying suite takes. Isolated proof (in /tmp, not this
 * repo): a wrapper-pattern outer timeout of 300ms against a 6s grandchild
 * left the grandchild alive and running; the direct-spawn equivalent killed
 * the same 6s process cleanly at the same 300ms mark. Measured effect on
 * this repo's suite: wall time crept from ~5.5min to ~12min, and repeated
 * runs at the same commit produced different test counts (the ±1 flake).
 *
 * The fix (already applied to all 3 sites as of this test's introduction):
 * spawn `node --test` directly from the test file, with NODE_TEST_CONTEXT
 * stripped from the CHILD's env copy (not process.env itself) to avoid Node
 * v22+'s "recursive node:test" detection — no wrapper layer, so there is no
 * neto to orphan. Verified directly: spawning `node --test <file>` from
 * inside a running `node --test` process, with NODE_TEST_CONTEXT left in
 * the child's env, produces `stderr: "...being called recursively...
 * skipping running files"` and exit 0 with nothing run; stripping it from
 * the child's env alone lets the inner run execute for real (`# pass 1`).
 *
 * @spec none — standalone bugfix, see plans/reports/orphan-fix-*.md
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Extracts top-level backtick template literals from JS source, correctly
 * skipping `//` line comments, block comments (slash-star ... star-slash), and '...'/"..."
 * string literals — so a stray backtick used for markdown-style inline code
 * inside a comment never gets mistaken for the start of a real template
 * literal.
 *
 * This matters empirically, not just in theory: a naive
 * /`(?:[^`\\]|\\.)*`/gs regex run over this repo's own *.test.cjs files
 * produced 2 false positives — install-home-isolation-guard.test.cjs and
 * spec-lint-acceptance.test.cjs — both because a JSDoc comment documented
 * a spawnSync call using a single markdown-style backtick, and the regex
 * (blind to comments) let the match bleed across unrelated code. This
 * tokenizer treats comments and strings as fully opaque, which eliminates
 * both false positives while still catching the 3 real offenders (verified
 * below in the self-check tests).
 */
function findTemplateLiterals(src) {
  const literals = [];
  let i = 0;
  const n = src.length;

  function skipLineComment() {
    while (i < n && src[i] !== '\n') i++;
  }

  function skipBlockComment() {
    i += 2; // consume /*
    while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
    i += 2; // consume */
  }

  function skipStringLiteral(quote) {
    i++; // consume opening quote
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') i++; // skip escaped char
      i++;
    }
    i++; // consume closing quote
  }

  // Skips a `${ ... }` interpolation body, honoring nested strings/comments/
  // braces so an embedded '}' can't prematurely close the interpolation.
  // Does not recurse into nested template literals inside the interpolation
  // — none occur in this codebase's wrapper-script generators, and this
  // stays a bounded scanner rather than a full parser.
  function skipInterpolation() {
    i += 2; // consume ${
    let depth = 1;
    while (i < n && depth > 0) {
      const c = src[i];
      if (c === '{') { depth++; i++; }
      else if (c === '}') { depth--; i++; }
      else if (c === '"' || c === "'") { skipStringLiteral(c); }
      else if (c === '/' && src[i + 1] === '/') { skipLineComment(); }
      else if (c === '/' && src[i + 1] === '*') { skipBlockComment(); }
      else { i++; }
    }
  }

  function readTemplateLiteral() {
    i++; // consume opening `
    let content = '';
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') {
        content += src[i] + (src[i + 1] || '');
        i += 2;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        const interpStart = i;
        skipInterpolation();
        content += src.slice(interpStart, i);
      } else {
        content += src[i];
        i++;
      }
    }
    i++; // consume closing `
    literals.push(content);
  }

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
    if (c === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
    if (c === '"' || c === "'") { skipStringLiteral(c); continue; }
    if (c === '`') { readTemplateLiteral(); continue; }
    i++;
  }

  return literals;
}

const SPAWN_CALL_RE = /\bspawnSync\s*\(|\bspawn\s*\(/;

function generatesAndSpawnsWrapperScript(src) {
  return findTemplateLiterals(src).some((content) => SPAWN_CALL_RE.test(content));
}

// ---- The gate ----

test('structural: no *.test.cjs generates a wrapper script that itself spawns a process', () => {
  const files = execSync('git ls-files "*.test.cjs"', { cwd: REPO_ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Sanity floor so a broken cwd/git invocation (0 files silently scanned)
  // can't read as "0 offenders" = success.
  assert.ok(files.length > 150, `sanity: expected 150+ test files under git, got ${files.length}`);

  const offenders = [];
  for (const relPath of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    if (generatesAndSpawnsWrapperScript(src)) offenders.push(relPath);
  }

  assert.deepEqual(
    offenders,
    [],
    `Found ${offenders.length} test file(s) generating a spawn-wrapper script ` +
      `(orphan \`node --test\` process risk):\n${offenders.map((f) => `  - ${f}`).join('\n')}`
  );
});

// ---- Self-check: the scanner is validated in both directions, not trusted blind ----

test('structural: scanner catches a synthetic wrapper-generator (known-bad control)', () => {
  const knownBad = `
    const wrapperCode = \`
      const { spawnSync } = require('node:child_process');
      spawnSync(NODE_BIN, ['--test', ...files], { timeout: 60000 });
    \`;
    fs.writeFileSync(wrapperPath, wrapperCode);
  `;
  assert.equal(
    generatesAndSpawnsWrapperScript(knownBad),
    true,
    'scanner must flag a template literal whose content spawns a process'
  );
});

test('structural: scanner ignores markdown-style backticks inside comments (known-good control, regression for the false positive found in install-home-isolation-guard.test.cjs)', () => {
  const knownGood = `
    /**
     * OWN hand-written spawnSync call was safe — see the isolated
     * \`spawnSync('node', [INSTALL_CJS, projectDir], { timeout: 30000 })\`
     * call below.
     */
    const { spawnSync } = require('node:child_process');
    const r = spawnSync('node', [INSTALL_CJS, projectDir, '--tool=claude'], { timeout: 30000 });
  `;
  assert.equal(
    generatesAndSpawnsWrapperScript(knownGood),
    false,
    'scanner must not flag a comment that merely mentions spawnSync as markdown-style inline code'
  );
});

test('structural: scanner ignores a direct `node --test` spawn with no generated wrapper file (known-good control, matches phase4d-regression.test.cjs)', () => {
  const knownGood = `
    const result = spawnSync('node', ['--test', 'scripts/__tests__/self.test.cjs'], { cwd: SCRATCH_REPO, encoding: 'utf8' });
  `;
  assert.equal(
    generatesAndSpawnsWrapperScript(knownGood),
    false,
    'scanner must not flag a direct spawnSync call that has no generated wrapper script'
  );
});
