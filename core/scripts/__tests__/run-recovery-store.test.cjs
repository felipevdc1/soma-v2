'use strict';

/**
 * Adversarial filesystem oracle for soma-state/v3 recovery publication.
 * These tests deliberately use real files: ordering and crash behavior are
 * the contract, so mocks would hide the thing under test.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateStateV3,
  migrateStateV2,
  readStateV3,
  publishRecoveryGeneration,
} = require('../run/recovery-store.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'state');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readFixture = name => readJson(path.join(FIXTURES, name));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = file => sha256(fs.readFileSync(file));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function setupState(runId = 'run-store') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-recovery-store-'));
  const runStateFile = path.join(projectRoot, '.soma', `run-state-${runId}.json`);
  const state = readFixture('v3-red-pending.json');
  state.runId = runId;
  writeJson(runStateFile, state);
  return { projectRoot, runId, runStateFile, state };
}

function generationFrom(state, overrides = {}) {
  return {
    ...clone(state.diagnosticRecovery.branches[0]),
    generation: 1,
    ...overrides,
  };
}

function publicationInput(setup, generationOverrides = {}) {
  return {
    projectRoot: setup.projectRoot,
    runId: setup.runId,
    expectedStateSha256: sha256File(setup.runStateFile),
    generation: generationFrom(setup.state, generationOverrides),
  };
}

test('migrateStateV2 changes only $schema and adds the supplied diagnostic recovery', () => {
  const v2 = readFixture('v2-valid.json');
  const recovery = clone(readFixture('v3-red-pending.json').diagnosticRecovery);
  const v3 = migrateStateV2(v2, recovery);

  assert.equal(v3.$schema, 'soma-state/v3');
  assert.deepEqual(v3.diagnosticRecovery, recovery);
  assert.deepEqual(Object.keys(v3).sort(), [...Object.keys(v2), 'diagnosticRecovery'].sort());
  for (const [key, value] of Object.entries(v2)) {
    if (key !== '$schema') assert.deepEqual(v3[key], value, `${key} must survive byte-for-value`);
  }
});

test('validateStateV3 enforces the strict open-branch minimum and permits RED_PENDING without an original executor', () => {
  const valid = readFixture('v3-red-pending.json');
  assert.equal(validateStateV3(valid).valid, true);

  for (const field of [
    'branchId', 'generation', 'state', 'classification', 'fingerprint', 'boundary', 'candidate',
    'proofs', 'openFindings', 'fingerprintHistory', 'dependencyClosure', 'reviewPlan', 'transitionKey',
  ]) {
    const malformed = clone(valid);
    delete malformed.diagnosticRecovery.branches[0][field];
    assert.equal(validateStateV3(malformed).valid, false, `missing ${field} must fail closed`);
  }

  const missingRisks = clone(valid);
  delete missingRisks.diagnosticRecovery.branches[0].reviewPlan.declaredRisks;
  assert.equal(validateStateV3(missingRisks).valid, false);
});

test('validateStateV3 enforces automatic and human-gate branch nullability plus paused diagnostic payload', () => {
  const valid = readFixture('v3-red-pending.json');
  const automaticWithoutTask = clone(valid);
  automaticWithoutTask.diagnosticRecovery.branches[0].nextTask = null;
  assert.equal(validateStateV3(automaticWithoutTask).valid, false);

  const automaticWithGate = clone(valid);
  automaticWithGate.diagnosticRecovery.branches[0].humanGate = { decisionNeeded: 'never automatic' };
  assert.equal(validateStateV3(automaticWithGate).valid, false);

  const humanGate = clone(valid);
  humanGate.diagnosticRecovery.branches[0].state = 'HUMAN_GATE';
  humanGate.diagnosticRecovery.branches[0].nextTask = null;
  humanGate.diagnosticRecovery.branches[0].humanGate = {
    decisionNeeded: 'Choose the governing policy.',
    proofs: [{ path: '.soma/dispatches/run-v3-red-pending/T-RED/red-proof.json' }],
  };
  assert.equal(validateStateV3(humanGate).valid, true);

  humanGate.diagnosticRecovery.branches[0].nextTask = { taskId: 'forbidden' };
  assert.equal(validateStateV3(humanGate).valid, false);

  const paused = migrateStateV2(readFixture('v2-paused-null.json'), clone(valid.diagnosticRecovery));
  assert.equal(validateStateV3(paused).valid, false);
});

test('validateStateV3 rejects missing v2 fields and malformed semantic branch values with named violations', () => {
  const valid = readFixture('v3-red-pending.json');
  const malformedCases = [
    ['fixLoopIterations', state => { delete state.fixLoopIterations; }],
    ['classification', state => { state.diagnosticRecovery.branches[0].classification = 'NOT_A_CLASSIFICATION'; }],
    ['fingerprint', state => { state.diagnosticRecovery.branches[0].fingerprint = 'not-a-sha'; }],
    ['candidate.sha', state => { state.diagnosticRecovery.branches[0].candidate.sha = 'not-a-sha'; }],
    ['executorRotation', state => { state.diagnosticRecovery.branches[0].executorRotation = []; }],
    ['progressDelta', state => { state.diagnosticRecovery.branches[0].progressDelta = []; }],
    ['nextTask', state => { state.diagnosticRecovery.branches[0].nextTask = { taskId: '', kind: 7, status: null }; }],
    ['proofs', state => { state.diagnosticRecovery.branches[0].proofs = [{ kind: 'RED', path: 7, sha256: 'not-a-sha' }]; }],
    ['openFindings', state => { state.diagnosticRecovery.branches[0].openFindings = [{ fingerprint: 'not-a-sha', requirementRef: '' }]; }],
  ];

  for (const [name, mutate] of malformedCases) {
    const malformed = clone(valid);
    mutate(malformed);
    const result = validateStateV3(malformed);
    assert.equal(result.valid, false, `${name} must fail closed`);
    assert.ok(result.violations.some(violation => violation.includes(name.split('.')[0])), `${name} must have a named violation`);
  }

  const closed = clone(valid);
  closed.diagnosticRecovery.branches[0].state = 'CLOSED';
  closed.diagnosticRecovery.branches[0].openFindings = [];
  closed.diagnosticRecovery.branches[0].nextTask = null;
  closed.diagnosticRecovery.branches[0].humanGate = null;
  assert.equal(validateStateV3(closed).valid, true);
});

test('readStateV3 follows only the state reference and ignores a directory-only generation artifact', () => {
  const setup = setupState('run-reader');
  const orphanPath = path.join(setup.projectRoot, '.soma', 'recovery', setup.runId, '0001.json');
  writeJson(orphanPath, { $schema: 'soma-recovery-generation/v1', forged: true });

  assert.deepEqual(readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId }), setup.state);
});

test('publication writes the padded immutable generation before atomically replacing state with its exact reference', () => {
  const setup = setupState('run-publish');
  const before = fs.readFileSync(setup.runStateFile);
  const result = publishRecoveryGeneration(publicationInput(setup));
  const expectedPath = path.join('.soma', 'recovery', setup.runId, '0001.json');
  const absoluteGenerationPath = path.join(setup.projectRoot, expectedPath);
  const after = fs.readFileSync(setup.runStateFile);

  assert.equal(result.generationPath, expectedPath);
  assert.match(result.generationSha256, /^[0-9a-f]{64}$/);
  assert.match(result.semanticSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.adopted, false);
  assert.notDeepEqual(after, before);
  assert.equal(fs.existsSync(absoluteGenerationPath), true);
  assert.equal(sha256File(absoluteGenerationPath), result.generationSha256);
  assert.deepEqual(result.state, readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId }));
  assert.deepEqual(
    result.state.diagnosticRecovery.branches[0].generationArtifact,
    { path: expectedPath, sha256: result.generationSha256 }
  );
});

test('after-generation-rename leaves state unchanged and a matching orphan is adopted exactly once', () => {
  const setup = setupState('run-orphan-adoption');
  const input = publicationInput(setup);
  const before = fs.readFileSync(setup.runStateFile);

  assert.throws(
    () => publishRecoveryGeneration({ ...input, fault: 'after-generation-rename' }),
    /INJECTED/
  );
  assert.deepEqual(fs.readFileSync(setup.runStateFile), before);

  const retry = publishRecoveryGeneration(input);
  const recoveryDir = path.join(setup.projectRoot, '.soma', 'recovery', setup.runId);
  assert.equal(retry.adopted, true);
  assert.deepEqual(fs.readdirSync(recoveryDir).filter(name => name.endsWith('.json')), ['0001.json']);
  assert.throws(() => publishRecoveryGeneration(input), /state|expected|hash|generation/i);
  assert.deepEqual(fs.readdirSync(recoveryDir).filter(name => name.endsWith('.json')), ['0001.json']);
});

test('generation two persists its own semantic branch truth and candidate changes alter the semantic hash', () => {
  const setup = setupState('run-generation-two');
  publishRecoveryGeneration(publicationInput(setup));
  const current = readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  setup.state = current;
  const nextTask = { taskId: 'T-RECOVERY-G2-IMPLEMENT', kind: 'IMPLEMENTER', status: 'pending' };
  const generation = generationFrom(current, {
    generation: 2,
    classification: 'EVIDENCE_DEFICIENT',
    candidate: { sha: '1111111111111111111111111111111111111111', preserved: true },
    nextTask,
  });
  const result = publishRecoveryGeneration({
    projectRoot: setup.projectRoot,
    runId: setup.runId,
    expectedStateSha256: sha256File(setup.runStateFile),
    generation,
  });
  const artifact = readJson(path.join(setup.projectRoot, result.generationPath));
  const persisted = readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  const persistedBranch = persisted.diagnosticRecovery.branches[0];

  assert.equal(artifact.recovery.generation, 2);
  assert.equal(artifact.recovery.classification, generation.classification);
  assert.deepEqual(artifact.recovery.candidate, generation.candidate);
  assert.deepEqual(artifact.recovery.nextTask, nextTask);
  assert.equal(result.state.diagnosticRecovery.branches[0].generation, 2);
  assert.equal(persistedBranch.classification, generation.classification);
  assert.deepEqual(persistedBranch.candidate, generation.candidate);
  assert.deepEqual(persistedBranch.nextTask, nextTask);
  assert.deepEqual(persistedBranch.generationArtifact, { path: result.generationPath, sha256: result.generationSha256 });

  const first = setupState('run-semantic-candidate');
  const second = setupState('run-semantic-candidate');
  const one = publishRecoveryGeneration(publicationInput(first, {
    candidate: { sha: '2222222222222222222222222222222222222222', preserved: true },
  }));
  const two = publishRecoveryGeneration(publicationInput(second, {
    candidate: { sha: '3333333333333333333333333333333333333333', preserved: true },
  }));
  assert.notEqual(one.semanticSha256, two.semanticSha256);
});

test('a wrong-semantic-hash orphan is rejected while preserving state and orphan bytes', () => {
  const setup = setupState('run-wrong-orphan');
  const input = publicationInput(setup);
  assert.throws(
    () => publishRecoveryGeneration({ ...input, fault: 'after-generation-rename' }),
    /INJECTED/
  );

  const orphanPath = path.join(setup.projectRoot, '.soma', 'recovery', setup.runId, '0001.json');
  fs.writeFileSync(orphanPath, '{"$schema":"soma-recovery-generation/v1","semanticSha256":"wrong"}\n');
  const beforeState = fs.readFileSync(setup.runStateFile);
  const beforeOrphan = fs.readFileSync(orphanPath);
  assert.throws(() => publishRecoveryGeneration(input), /semantic|orphan|hash/i);
  assert.deepEqual(fs.readFileSync(setup.runStateFile), beforeState);
  assert.deepEqual(fs.readFileSync(orphanPath), beforeOrphan);
});

test('an existing generation is immutable and semantic bytes omit path, publication time, prompts and outputs', () => {
  const first = setupState('run-immutable');
  const second = setupState('run-immutable');
  const one = publishRecoveryGeneration(publicationInput(first, {
    generationArtifact: { path: '/private/a.json', publishedAt: '2026-08-26T13:00:00.000Z' },
    dispatchHistory: { prompt: 'secret prompt A', output: 'secret output A' },
  }));
  const two = publishRecoveryGeneration(publicationInput(second, {
    generationArtifact: { path: '/private/b.json', publishedAt: '2026-08-26T14:00:00.000Z' },
    dispatchHistory: { prompt: 'secret prompt B', output: 'secret output B' },
  }));
  assert.equal(one.semanticSha256, two.semanticSha256);
  const generationBytes = fs.readFileSync(path.join(first.projectRoot, one.generationPath), 'utf8');
  assert.doesNotMatch(generationBytes, /secret prompt|secret output|publishedAt|\/private\//);

  const locked = setupState('run-existing-generation');
  const lockedPath = path.join(locked.projectRoot, '.soma', 'recovery', locked.runId, '0001.json');
  const originalBytes = '{"existing":"immutable"}\n';
  fs.mkdirSync(path.dirname(lockedPath), { recursive: true });
  fs.writeFileSync(lockedPath, originalBytes);
  const originalState = fs.readFileSync(locked.runStateFile);
  assert.throws(() => publishRecoveryGeneration(publicationInput(locked)), /exists|immutable|generation/i);
  assert.equal(fs.readFileSync(lockedPath, 'utf8'), originalBytes);
  assert.deepEqual(fs.readFileSync(locked.runStateFile), originalState);
});

test('a competitor installed immediately before generation installation is never clobbered', () => {
  const setup = setupState('run-no-clobber-race');
  const target = path.join(setup.projectRoot, '.soma', 'recovery', setup.runId, '0001.json');
  const competitorBytes = '{"publisher":"competitor"}\n';
  let injected = false;

  assert.throws(
    () => publishRecoveryGeneration({
      ...publicationInput(setup),
      fault: {
        'before-generation-install': () => {
          injected = true;
          fs.writeFileSync(target, competitorBytes, { flag: 'wx' });
        },
      },
    }),
    /exists|immutable|generation/i
  );
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(target, 'utf8'), competitorBytes);
});
