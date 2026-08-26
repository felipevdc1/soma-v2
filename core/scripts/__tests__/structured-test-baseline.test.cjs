'use strict';

/**
 * structured-test-baseline.test.cjs — deterministic identity for a JUnit failure set.
 *
 * The captured baseline must remain stable across TAP formatting and source-line drift.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.resolve(__dirname, '..', 'test', 'junit-failure-set.cjs');
const { parseFailureSet } = require(TOOL);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture(body) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>${body}</testsuites>\n`;
}

test('parseFailureSet normalizes duplicate short names, messages, paths, and transient stack lines', () => {
  const repoRoot = path.join(path.sep, 'repo');
  const xml = fixture(`
    <testsuite name="suite">
      <testcase name="does work" classname="spec.alpha" file="core\\scripts\\alpha.test.cjs">
        <failure type="AssertionError">first line&#13;&#10;  at TestContext.&lt;anonymous&gt; (C:\\repo\\core\\scripts\\alpha.test.cjs:10:4)&#13;&#10;details &amp; &lt;escaped&gt;</failure>
      </testcase>
      <testcase name="does work" classname="spec.beta" file="core/scripts/beta.test.cjs">
        <failure type="TypeError">other failure\n  at TestContext.&lt;anonymous&gt; (/repo/core/scripts/beta.test.cjs:99:9)</failure>
      </testcase>
    </testsuite>`);

  const result = parseFailureSet(xml, { repoRoot });

  assert.equal(result.$schema, 'soma-test-baseline/v1');
  assert.ok(!Object.hasOwn(result, 'schema'));
  assert.equal(result.failures.length, 2);
  assert.deepEqual(result.failures.map(({ fullName, file, errorName, message }) => ({ fullName, file, errorName, message })), [
    { fullName: 'spec.alpha does work', file: 'core/scripts/alpha.test.cjs', errorName: 'AssertionError', message: 'first line' },
    { fullName: 'spec.beta does work', file: 'core/scripts/beta.test.cjs', errorName: 'TypeError', message: 'other failure' },
  ]);
  assert.equal(result.failures[0].failureSha256, sha256('first line\ndetails & <escaped>'));
  assert.equal(result.failures[1].failureSha256, sha256('other failure'));
});

test('parseFailureSet finds stack source files, handles no stack location, and orders UTF-8 deterministically', () => {
  const repoRoot = path.join(path.sep, 'repo');
  const xml = fixture(`
    <testsuite name="suite">
      <testcase name="zeta" classname="spec.Z"><failure type="Error">same\n at /repo/core/zeta.test.cjs:2:1</failure></testcase>
      <testcase name="árvore" classname="spec.A"><failure type="Error">same\n at /repo/core/arvore.test.cjs:18:1</failure></testcase>
      <testcase name="missing" classname="spec.M"><failure type="Error">message without source</failure></testcase>
    </testsuite>`);

  const result = parseFailureSet(xml, { repoRoot });

  assert.deepEqual(result.failures.map(failure => failure.file), [
    '',
    'core/arvore.test.cjs',
    'core/zeta.test.cjs',
  ]);
  assert.equal(result.failures[0].fullName, 'spec.M missing');
  assert.equal(result.failures[0].message, 'message without source');
});

test('parseFailureSet makes a physically reported macOS worktree path repo-relative', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-junit-realpath-'));
  try {
    const physicalRoot = fs.realpathSync(repoRoot);
    const xml = fixture(`<testsuite><testcase name="path" classname="spec"><failure type="Error">bad\n at ${physicalRoot}/core/hooks/__tests__/operator-gate.test.cjs:46:10</failure></testcase></testsuite>`);
    const result = parseFailureSet(xml, { repoRoot });
    assert.equal(result.failures[0].file, 'core/hooks/__tests__/operator-gate.test.cjs');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('parseFailureSet ignores an external stack path and selects the first path contained by repoRoot', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-junit-source-'));
  try {
    const realRoot = fs.realpathSync(repoRoot);
    const xml = fixture(`<testsuite><testcase name="source" classname="spec"><failure type="Error">bad\n at /outside/first.test.cjs:1:2\n at ${realRoot}/core/scripts/__tests__/phase4a-regression.test.cjs:99:4</failure></testcase></testsuite>`);
    const result = parseFailureSet(xml, { repoRoot });
    assert.equal(result.failures[0].file, 'core/scripts/__tests__/phase4a-regression.test.cjs');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('parseFailureSet derives stable error identity from a concrete cause instead of JUnit runner boilerplate', () => {
  const xml = fixture(`<testsuite><testcase name="phase4a" classname="test"><failure type="testCodeFailure" message="test failed">[Error [ERR_TEST_FAILURE]: test failed] {\n  failureType: 'testCodeFailure',\n  cause: AssertionError [ERR_ASSERTION]: Phase 2+3 baseline must have 0 failures\n      at TestContext.&lt;anonymous&gt; (/repo/core/scripts/__tests__/phase4a-regression.test.cjs:77:3)\n}\n# Subtest: TAP runner footer\nnot ok 62 - TAP boilerplate\n  ---\n  duration_ms: 41.4\n  ...</failure></testcase></testsuite>`);
  const result = parseFailureSet(xml, { repoRoot: '/repo' });
  assert.deepEqual(result.failures[0], {
    fullName: 'test phase4a',
    file: 'core/scripts/__tests__/phase4a-regression.test.cjs',
    errorName: 'AssertionError [ERR_ASSERTION]',
    message: 'Phase 2+3 baseline must have 0 failures',
    failureSha256: result.failures[0].failureSha256,
  });
  assert.notEqual(result.failures[0].errorName, 'testCodeFailure');
  assert.ok(!/TAP boilerplate|duration_ms|test failed/.test(result.failures[0].message));
});

test('parseFailureSet rejects malformed XML and duplicate normalized identities', () => {
  assert.throws(
    () => parseFailureSet('<testsuites><testcase>', { repoRoot: '/repo' }),
    /malformed/i
  );

  const duplicate = fixture(`
    <testsuite><testcase name="same" classname="spec"><failure type="Error">oops\n at /repo/a.test.cjs:1:1</failure></testcase></testsuite>
    <testsuite><testcase name="same" classname="spec"><failure type="Error">oops\n at /repo/a.test.cjs:22:9</failure></testcase></testsuite>`);
  assert.throws(() => parseFailureSet(duplicate, { repoRoot: '/repo' }), /duplicate/i);
});

test('CLI writes a deterministic baseline with exact argv, candidate, exit code, and JUnit hash', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-junit-baseline-'));
  try {
    const junit = path.join(temp, 'result.xml');
    const out = path.join(temp, 'baseline.json');
    const xml = fixture('<testsuite><testcase name="inherits spec 024" classname="operator gate"><failure type="AssertionError">expected inherited failure\n at /repo/core/hooks/__tests__/operator-gate.test.cjs:77:3</failure></testcase></testsuite>');
    fs.writeFileSync(junit, xml, 'utf8');

    const result = spawnSync('node', [TOOL, '--junit', junit, '--out', out, '--repo', '/repo', '--candidate', 'a75abe794cf0028675defa377533c8a93933e6e7', '--exit', '1'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);

    const baseline = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(baseline, {
      $schema: 'soma-test-baseline/v1',
      candidateSha: 'a75abe794cf0028675defa377533c8a93933e6e7',
      command: ['node', '--test', '--test-reporter=junit', 'core/scripts/__tests__/*.test.cjs', 'core/hooks/__tests__/*.test.cjs'],
      exitCode: 1,
      failures: [{
        fullName: 'operator gate inherits spec 024',
        file: 'core/hooks/__tests__/operator-gate.test.cjs',
        errorName: 'AssertionError',
        message: 'expected inherited failure',
        failureSha256: sha256('expected inherited failure'),
      }],
      junitSha256: sha256(xml),
    });
    assert.ok(!Object.hasOwn(baseline, 'schema'));
    assert.equal(fs.readFileSync(out, 'utf8'), `${JSON.stringify(baseline, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
