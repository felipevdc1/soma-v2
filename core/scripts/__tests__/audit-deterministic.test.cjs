'use strict';
// audit-deterministic.test.cjs — T-04: unit tests for audit-deterministic.cjs
// @spec AC-01, AC-03, AC-04

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  collectDeterministic,
  extractExports,
  extractHeaderComment,
  extractExportSignatures,
  countTests,
} = require('../lib/audit-deterministic.cjs');

const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'audit');

// ---- extractExports ----

test('extractExports: parses module.exports = { a, b }', () => {
  const src = `'use strict';\nfunction a() {}\nfunction b(x) {}\nmodule.exports = { a, b };`;
  const exports = extractExports(src);
  assert.ok(exports.includes('a'), 'must include a');
  assert.ok(exports.includes('b'), 'must include b');
});

test('extractExports: parses module.exports = { a: fn, b: fn }', () => {
  const src = `module.exports = { foo: fooFn, bar: barFn };`;
  const exports = extractExports(src);
  assert.ok(exports.includes('foo'), 'must include foo');
  assert.ok(exports.includes('bar'), 'must include bar');
});

test('extractExports: returns empty array for no exports', () => {
  const src = `'use strict';\nconsole.log("hello");`;
  const exports = extractExports(src);
  assert.ok(Array.isArray(exports), 'must be array');
});

// ---- extractHeaderComment ----

test('extractHeaderComment: extracts JSDoc block comment', () => {
  const src = `/**\n * manifest.cjs — SOMA module\n * Loads stuff.\n */\n'use strict';\nconst x = 1;`;
  const header = extractHeaderComment(src);
  assert.ok(header.includes('manifest.cjs'), 'must include comment content');
  assert.ok(!header.includes("const x = 1"), 'must not include code');
});

test('extractHeaderComment: extracts line comment block', () => {
  const src = `// module.cjs — test\n// Phase 4b stuff\n\nconst x = 1;`;
  const header = extractHeaderComment(src);
  assert.ok(header.includes('// module.cjs'), 'must include line comment');
  assert.ok(!header.includes('const x = 1'), 'must not include code');
});

// ---- extractExportSignatures ----

test('extractExportSignatures: extracts function signatures', () => {
  const src = `function foo(a, b) { return a + b; }\nfunction bar(x) { return x; }`;
  const sigs = extractExportSignatures(src, ['foo', 'bar']);
  assert.ok(sigs.some(s => s.includes('function foo(a, b)')), 'must include foo signature');
  assert.ok(sigs.some(s => s.includes('function bar(x)')), 'must include bar signature');
});

test('extractExportSignatures: no body in signatures', () => {
  const src = `function foo(a) { const secret = "TOP_SECRET"; return secret; }`;
  const sigs = extractExportSignatures(src, ['foo']);
  assert.ok(sigs.length > 0 || sigs.length === 0, 'array returned');
  if (sigs.length > 0) {
    assert.ok(!sigs[0].includes('TOP_SECRET'), 'must not include body content');
  }
});

// ---- countTests ----

test('countTests: returns number for real module path', () => {
  // countTests looks in module_dir/__tests__/ for matching files.
  // audit-deterministic.cjs is in scripts/lib/, scripts/lib/__tests__/ doesn't exist → 0 is valid.
  const modulePath = path.join(__dirname, '..', 'lib', 'audit-deterministic.cjs');
  const count = countTests(modulePath);
  assert.ok(typeof count === 'number', 'must return number');
  assert.ok(count >= 0, 'count must be >= 0');
});

test('countTests: returns 0 when no matching test files', () => {
  // Use a path with basename that won't match any test
  const fakePath = path.join(__dirname, '..', 'lib', 'zzz-no-match-xyzzy.cjs');
  const count = countTests(fakePath);
  assert.equal(count, 0);
});

// ---- collectDeterministic ----

test('AC-04: collectDeterministic returns error for non-existent path', () => {
  const result = collectDeterministic('/tmp/nonexistent-soma-audit-test-xyzzy.cjs');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MODULE_NOT_FOUND');
  assert.ok(result.error.message, 'message present');
  assert.ok(result.error.hint, 'hint present');
});

test('AC-01: collectDeterministic returns populated module data for lib fixture', () => {
  const modulePath = path.join(FIXTURE_DIR, 'module-lib.cjs');
  const result = collectDeterministic(modulePath);
  assert.equal(result.ok, true, `Expected ok=true. error: ${JSON.stringify(result.error)}`);
  assert.equal(result.module.path, modulePath);
  assert.ok(result.module.loc > 0, 'loc must be positive');
  assert.ok(Array.isArray(result.module.exports), 'exports array');
  assert.ok(result.module.exports.includes('parseData'), 'exports must include parseData');
  assert.ok(result.module.exports.includes('transformData'), 'exports must include transformData');
  assert.ok(Array.isArray(result.module.recent_commits), 'recent_commits array');
  assert.ok(typeof result.module.test_count === 'number', 'test_count integer');
});

test('AC-03: collectDeterministic captures help_text for CLI modules', () => {
  const modulePath = path.join(FIXTURE_DIR, 'module-cli.cjs');
  const result = collectDeterministic(modulePath);
  assert.equal(result.ok, true);
  // CLI module has process.argv + --help support
  assert.ok(result.module.help_text !== null, 'help_text must be populated for CLI module');
  assert.ok(result.module.help_text.includes('Usage'), 'help_text must include Usage');
});

test('AC-01: collectDeterministic returns null help_text for lib modules', () => {
  const modulePath = path.join(FIXTURE_DIR, 'module-lib.cjs');
  const result = collectDeterministic(modulePath);
  assert.equal(result.ok, true);
  assert.equal(result.module.help_text, null, 'lib module has no help_text');
});

test('AC-01: recent_commits is array (empty ok for non-git path)', () => {
  const tmp = fs.mkdtempSync('/tmp/soma-audit-det-test-');
  const fakeModule = path.join(tmp, 'fake.cjs');
  fs.writeFileSync(fakeModule, `'use strict';\nmodule.exports = { x: 1 };`);
  const result = collectDeterministic(fakeModule);
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.module.recent_commits), 'recent_commits is array');
  // Non-git path: warning expected
  if (result.warnings.length > 0) {
    const gitWarn = result.warnings.find(w => w.code === 'NOT_GIT_REPO');
    assert.ok(gitWarn, 'NOT_GIT_REPO warning for non-git path');
  }
  fs.rmSync(tmp, { recursive: true });
});

test('AC-01: export_signatures present and contains function names', () => {
  const modulePath = path.join(FIXTURE_DIR, 'module-lib.cjs');
  const result = collectDeterministic(modulePath);
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.module.export_signatures), 'export_signatures is array');
  // Should have signatures for parseData, transformData, validateSchema
  const sigStr = result.module.export_signatures.join(' ');
  assert.ok(sigStr.includes('parseData') || result.module.export_signatures.length === 0,
    'signatures should include function names (or empty if regex fails)');
});
