'use strict';

/**
 * Frozen adversarial oracle for the pure hybrid-recovery model.
 *
 * The inputs deliberately include task/session prose and execution metadata.
 * Those fields are evidence records, not part of finding identity.
 *
 * @spec AC-02, AC-03, AC-05, AC-06, AC-10
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  sha256Hex,
  fingerprintFinding,
  classifyFinding,
  computeProgress,
  evaluateNoProgress,
  EMPTY_FIXTURE_SHA256,
} = require('../run/recovery-model.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'model');
const EMPTY_FIXTURE_BYTES = '{}\n';

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

const sameFindingA = readFixture('same-finding-a.json');
const sameFindingTransientFields = readFixture('same-finding-transient-fields.json');
const newCounterexample = readFixture('new-counterexample.json');

function minimalReproduction() {
  return {
    command: ['node', '--test', 'core/scripts/__tests__/run-recovery-model.test.cjs'],
    fixtureSha256: EMPTY_FIXTURE_SHA256,
  };
}

function observedResult() {
  return {
    errorIdentity: 'ERR_ASSERTION',
    resultSha256: 'f'.repeat(64),
  };
}

test('canonicalJson sorts keys recursively, preserves array order, normalizes CRLF, and writes one trailing LF', () => {
  const value = {
    z: [{ b: 2, a: 1 }, 'last'],
    a: { b: 1, a: 'first\r\nsecond' },
  };

  assert.equal(
    canonicalJson(value),
    '{"a":{"a":"first\\nsecond","b":1},"z":[{"a":1,"b":2},"last"]}\n'
  );
  assert.equal(canonicalJson({ text: 'already\nnormalized\n' }).endsWith('\n\n'), false);
});

test('canonical empty fixture hash is stable for exactly {} plus LF', () => {
  assert.equal(canonicalJson({}), EMPTY_FIXTURE_BYTES);
  assert.equal(sha256Hex(EMPTY_FIXTURE_BYTES), 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356');
  assert.equal(EMPTY_FIXTURE_SHA256, 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356');
});

test('canonical fingerprint ignores task, executor, candidate, time, duration and TAP ordinal', () => {
  const a = fingerprintFinding(sameFindingA);
  const b = fingerprintFinding(sameFindingTransientFields);

  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(a.canonicalJson, b.canonicalJson);
  assert.deepEqual(JSON.parse(a.canonicalJson), {
    $schema: 'soma-finding-fingerprint/v1',
    boundary: sameFindingA.boundary,
    minimalReproduction: sameFindingA.minimalReproduction,
    observedResult: sameFindingA.observedResult,
    requirementRef: sameFindingA.requirementRef,
  });
});

test('new minimal counterexample gets a new fingerprint', () => {
  assert.notEqual(
    fingerprintFinding(sameFindingA).fingerprint,
    fingerprintFinding(newCounterexample).fingerprint
  );
});

test('classifyFinding recognizes automatic classes and every human gate class', () => {
  for (const classification of [
    'TECHNICAL_DETERMINISTIC',
    'EVIDENCE_DEFICIENT',
    'NORMATIVE_DECISION',
    'SCOPE_AUTHORITY',
    'CONTRADICTORY_REQUIREMENTS',
    'NO_PROGRESS',
  ]) {
    assert.deepEqual(
      classifyFinding({ requirementRef: 'AC-02', classification }),
      { classification, requirementRef: 'AC-02' }
    );
  }
});

test('classifyFinding rejects an unmapped reviewer requirement without complete NEW_EVIDENCE', () => {
  assert.throws(
    () => classifyFinding({ classification: 'TECHNICAL_DETERMINISTIC', boundary: 'run/recovery-model' }),
    /requirementRef|NEW_EVIDENCE/i
  );
  assert.throws(
    () => classifyFinding({ kind: 'NEW_EVIDENCE', boundary: 'run/recovery-model', minimalReproduction: minimalReproduction() }),
    /observedResult|NEW_EVIDENCE/i
  );
  assert.doesNotThrow(() =>
    classifyFinding({
      kind: 'NEW_EVIDENCE',
      boundary: 'run/recovery-model',
      minimalReproduction: minimalReproduction(),
      observedResult: observedResult(),
    })
  );
});

test('computeProgress detects a strict shrink of sorted unique open sets only', () => {
  const decreased = computeProgress({
    previousOpen: ['b', 'a', 'a'],
    currentOpen: ['b', 'b'],
    strongerRed: false,
    closed: ['a'],
  });
  const replaced = computeProgress({
    previousOpen: ['a'],
    currentOpen: ['b'],
    strongerRed: false,
    closed: [],
  });

  assert.deepEqual(decreased.previousOpen, ['a', 'b']);
  assert.deepEqual(decreased.currentOpen, ['b']);
  assert.equal(decreased.setDecreased, true);
  assert.equal(replaced.setDecreased, false);
});

test('evaluateNoProgress stops when the same fingerprint survives a rotated executor correction', () => {
  const result = evaluateNoProgress({
    fingerprint: 'same-finding',
    generations: [{ previousOpen: ['same-finding'], currentOpen: ['same-finding'] }],
    executors: {
      originalExecutor: 'executor-a',
      rotatedExecutor: 'executor-b',
      rotationsUsed: 1,
      attemptsByExecutor: { 'executor-a': 2, 'executor-b': 2 },
    },
  });

  assert.equal(result.stop, true);
  assert.match(result.reason, /same.*fingerprint|rotated.*executor/i);
});

test('evaluateNoProgress continues when the rotated executor closes the same fingerprint', () => {
  const result = evaluateNoProgress({
    fingerprint: 'same-finding',
    generations: [
      { previousOpen: ['same-finding'], currentOpen: ['same-finding'] },
      { previousOpen: ['same-finding'], currentOpen: [] },
    ],
    executors: {
      originalExecutor: 'executor-a',
      rotatedExecutor: 'executor-b',
      rotationsUsed: 1,
      attemptsByExecutor: { 'executor-a': 2, 'executor-b': 2 },
    },
  });

  assert.equal(result.stop, false);
});

test('evaluateNoProgress stops after two consecutive non-decreasing generations even when fingerprints change', () => {
  const result = evaluateNoProgress({
    fingerprint: 'newest-finding',
    generations: [
      { previousOpen: ['a'], currentOpen: ['b'] },
      { previousOpen: ['b'], currentOpen: ['c'] },
    ],
    executors: {
      originalExecutor: 'executor-a',
      rotatedExecutor: null,
      rotationsUsed: 0,
      attemptsByExecutor: { 'executor-a': 1 },
    },
  });

  assert.equal(result.stop, true);
  assert.match(result.reason, /two.*generation|non-decreasing|open.*set/i);
});

test('evaluateNoProgress does not let task or session names reset a progress history', () => {
  const result = evaluateNoProgress({
    fingerprint: 'same-finding',
    taskId: 'T-RECOVERY-A-G9-RENAMED',
    sessionId: 'new-host-session',
    generations: [
      { taskId: 'T-RECOVERY-A-G7', sessionId: 'old-host-session', previousOpen: ['a'], currentOpen: ['b'] },
      { taskId: 'T-RECOVERY-A-G8', sessionId: 'old-host-session', previousOpen: ['b'], currentOpen: ['c'] },
    ],
    executors: {
      originalExecutor: 'executor-a',
      rotatedExecutor: null,
      rotationsUsed: 0,
      attemptsByExecutor: { 'executor-a': 1 },
    },
  });

  assert.equal(result.stop, true);
});

test('fingerprintFinding excludes transient nested reproduction and result metadata', () => {
  const cleanFinding = {
    $schema: 'soma-finding-fingerprint/v1',
    requirementRef: 'AC-06',
    minimalReproduction: {
      command: ['node', '--test', 'core/scripts/__tests__/run-recovery-model.test.cjs'],
      fixtureSha256: 'a'.repeat(64),
    },
    boundary: 'core/scripts/run/recovery-model.cjs#fingerprintFinding',
    observedResult: {
      errorIdentity: 'ERR_ASSERTION',
      resultSha256: 'b'.repeat(64),
    },
  };
  const decoratedFinding = {
    ...cleanFinding,
    minimalReproduction: { ...cleanFinding.minimalReproduction, tapOrdinal: 42, durationMs: 11 },
    observedResult: {
      ...cleanFinding.observedResult,
      title: 'prose must not identify a finding',
      candidateSha: 'c'.repeat(40),
    },
  };

  const clean = fingerprintFinding(cleanFinding);
  const decorated = fingerprintFinding(decoratedFinding);

  assert.deepEqual(decorated, clean);
  assert.deepEqual(JSON.parse(decorated.canonicalJson), cleanFinding);
});

test('classifyFinding accepts only structurally valid NEW_EVIDENCE', () => {
  const validEvidence = {
    kind: 'NEW_EVIDENCE',
    boundary: 'core/scripts/run/recovery-model.cjs#classifyFinding',
    minimalReproduction: {
      command: ['node', '--test', 'core/scripts/__tests__/run-recovery-model.test.cjs'],
      fixtureSha256: 'd'.repeat(64),
    },
    observedResult: {
      errorIdentity: 'ERR_ASSERTION',
      resultSha256: 'e'.repeat(64),
    },
  };

  assert.doesNotThrow(() => classifyFinding(validEvidence));
  assert.throws(
    () =>
      classifyFinding({
        ...validEvidence,
        minimalReproduction: { command: [null], fixtureSha256: 'not-a-sha' },
        observedResult: { errorIdentity: 'ERR_ASSERTION', resultSha256: 'also-not-a-sha' },
      }),
    /NEW_EVIDENCE|command|fixtureSha256|resultSha256/i
  );
});
