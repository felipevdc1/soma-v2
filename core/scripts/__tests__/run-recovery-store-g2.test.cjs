'use strict';

/**
 * Generation-two adversarial oracle for the v3 recovery store. These cases use
 * real directories so they exercise the durable publication and reader contract.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateStateV3,
  readStateV3,
  publishRecoveryGeneration,
} = require('../run/recovery-store.cjs');
const { canonicalJson } = require('../run/recovery-model.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'state');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readFixture = name => readJson(path.join(FIXTURES, name));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = file => sha256(fs.readFileSync(file));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function setupState(runId = 'run-recovery-g2') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-recovery-g2-'));
  const runStateFile = path.join(projectRoot, '.soma', `run-state-${runId}.json`);
  const state = readFixture('v3-red-pending.json');
  state.runId = runId;
  writeJson(runStateFile, state);
  return { projectRoot, runId, runStateFile, state };
}

function branchFrom(state, overrides = {}) {
  return { ...clone(state.diagnosticRecovery.branches[0]), ...overrides };
}

function publicationInput(setup, generation, fault) {
  return {
    projectRoot: setup.projectRoot,
    runId: setup.runId,
    expectedStateSha256: sha256File(setup.runStateFile),
    generation,
    ...(fault === undefined ? {} : { fault }),
  };
}

function publishFirst(setup) {
  return publishRecoveryGeneration(publicationInput(setup, branchFrom(setup.state, { generation: 1 })));
}

function recoveryDir(setup) {
  return path.join(setup.projectRoot, '.soma', 'recovery', setup.runId);
}

function noTempFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.includes('.tmp')) : [];
}

function semanticRecovery(branch) {
  return {
    branchId: branch.branchId,
    generation: branch.generation,
    state: branch.state,
    classification: branch.classification,
    fingerprint: branch.fingerprint,
    boundary: branch.boundary,
    candidate: branch.candidate,
    proofs: branch.proofs.map(({ kind, sha256: proofSha256 }) => ({ kind, sha256: proofSha256 })),
    closedFindings: branch.closedFindings,
    openFindings: branch.openFindings,
    fingerprintHistory: branch.fingerprintHistory,
    dependencyClosure: branch.dependencyClosure,
    reviewPlan: branch.reviewPlan,
    transitionKey: branch.transitionKey,
    nextTask: branch.nextTask,
    humanGate: branch.humanGate === null ? null : {
      decisionNeeded: branch.humanGate.decisionNeeded,
      proofs: branch.humanGate.proofs.map(proof => ({ ...proof, path: undefined })),
    },
    executorRotation: branch.executorRotation,
    progressDelta: branch.progressDelta,
  };
}

function mutateReferencedEnvelope(setup, mutate) {
  publishFirst(setup);
  const state = readJson(setup.runStateFile);
  const branch = state.diagnosticRecovery.branches[0];
  const artifactFile = path.join(setup.projectRoot, branch.generationArtifact.path);
  const envelope = readJson(artifactFile);
  mutate(envelope, branch);
  const bytes = canonicalJson(envelope);
  fs.writeFileSync(artifactFile, bytes);
  branch.generationArtifact.sha256 = sha256(bytes);
  writeJson(setup.runStateFile, state);
}

test('R1 stale publisher loses the final state CAS and leaves its generation inert', () => {
  const setup = setupState('run-g2-stale-cas');
  publishFirst(setup);
  const current = readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  const expectedStateSha256 = sha256File(setup.runStateFile);
  const outer = branchFrom(current, { generation: 2, transitionKey: 'recovery:branch-red-pending:2:RED' });
  const winner = branchFrom(current, { generation: 3, transitionKey: 'recovery:branch-red-pending:3:RED' });
  let winnerResult;

  assert.throws(() => publishRecoveryGeneration({
    projectRoot: setup.projectRoot,
    runId: setup.runId,
    expectedStateSha256,
    generation: outer,
    fault: {
      'before-state-cas': () => {
        winnerResult = publishRecoveryGeneration({
          projectRoot: setup.projectRoot,
          runId: setup.runId,
          expectedStateSha256,
          generation: winner,
        });
      },
    },
  }), /STATE_CAS_(?:CONFLICT|MISMATCH)/);

  assert.equal(winnerResult.state.diagnosticRecovery.branches[0].generation, 3);
  const canonical = readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  assert.equal(canonical.diagnosticRecovery.branches[0].generation, 3);
  assert.equal(fs.existsSync(path.join(recoveryDir(setup), '0002.json')), true);
  assert.equal(canonical.diagnosticRecovery.branches[0].generationArtifact.path.endsWith('0003.json'), true);
});

test('R2 identical concurrent claim never clobbers and a retry adopts once without temp files', () => {
  const setup = setupState('run-g2-identical-cas');
  publishFirst(setup);
  const current = readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  const expectedStateSha256 = sha256File(setup.runStateFile);
  const generation = branchFrom(current, { generation: 2, transitionKey: 'recovery:branch-red-pending:2:RED' });
  const shared = { projectRoot: setup.projectRoot, runId: setup.runId, expectedStateSha256, generation };
  let competitor;

  const first = publishRecoveryGeneration({
    ...shared,
    fault: { 'before-state-cas': () => { competitor = publishRecoveryGeneration(shared); } },
  });
  assert.ok(competitor, 'before-state-cas must publish the competing identical claim');
  assert.equal(readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId }).diagnosticRecovery.branches[0].generation, 2);
  assert.equal(fs.readdirSync(recoveryDir(setup)).filter(name => name.endsWith('.json')).length, 2);
  assert.deepEqual(noTempFiles(recoveryDir(setup)), []);
  assert.equal(first.adopted || competitor.adopted, true);

  const retry = publishRecoveryGeneration(shared);
  assert.equal(retry.adopted, true);
  assert.deepEqual(noTempFiles(recoveryDir(setup)), []);
});

test('R3 readStateV3 rejects referenced generation bytes whose SHA no longer matches state', () => {
  const setup = setupState('run-g2-tampered-bytes');
  publishFirst(setup);
  const state = readJson(setup.runStateFile);
  const artifactFile = path.join(setup.projectRoot, state.diagnosticRecovery.branches[0].generationArtifact.path);
  fs.writeFileSync(artifactFile, '{"tampered":true}');

  assert.throws(
    () => readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId }),
    /RECOVERY_REFERENCE_BYTES_SHA_MISMATCH/
  );
});

test('R4 readStateV3 rejects absolute, dot-segment, outside, and symlinked recovery references', () => {
  for (const [label, setupReference, identity] of [
    ['absolute', (setup, state) => {
      const outside = path.join(setup.projectRoot, 'outside.json');
      fs.writeFileSync(outside, '{"outside":true}');
      state.diagnosticRecovery.branches[0].generationArtifact = { path: outside, sha256: sha256File(outside) };
    }, /RECOVERY_REFERENCE_PATH_INVALID/],
    ['dot-segment', (setup, state) => {
      const outside = path.join(setup.projectRoot, '.soma', 'recovery', 'outside.json');
      fs.mkdirSync(path.dirname(outside), { recursive: true });
      fs.writeFileSync(outside, '{"outside":true}');
      state.diagnosticRecovery.branches[0].generationArtifact = { path: `.soma/recovery/${setup.runId}/../outside.json`, sha256: sha256File(outside) };
    }, /RECOVERY_REFERENCE_PATH_INVALID/],
    ['outside', (setup, state) => {
      const outside = path.join(setup.projectRoot, '..', `${setup.runId}-outside.json`);
      fs.writeFileSync(outside, '{"outside":true}');
      state.diagnosticRecovery.branches[0].generationArtifact = { path: `.soma/recovery/${setup.runId}/../../../${path.basename(outside)}`, sha256: sha256File(outside) };
    }, /RECOVERY_REFERENCE_PATH_INVALID/],
    ['symlinked-component', (setup, state) => {
      publishFirst(setup);
      const original = recoveryDir(setup);
      const parked = path.join(setup.projectRoot, 'parked-recovery');
      fs.renameSync(original, parked);
      fs.symlinkSync(parked, original);
      state.diagnosticRecovery.branches[0] = readJson(setup.runStateFile).diagnosticRecovery.branches[0];
    }, /RECOVERY_REFERENCE_SYMLINK/],
  ]) {
    const setup = setupState(`run-g2-path-${label}`);
    const state = readJson(setup.runStateFile);
    setupReference(setup, state);
    writeJson(setup.runStateFile, state);
    assert.throws(() => readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId }), identity, label);
  }
});

test('R5 readStateV3 cryptographically joins reference bytes, envelope generation, semantics, and state projection', () => {
  const cases = [
    ['generation', (envelope) => { envelope.generation = 2; }, /RECOVERY_REFERENCE_GENERATION_MISMATCH/],
    ['semantic', (envelope) => { envelope.semanticSha256 = 'c'.repeat(64); }, /RECOVERY_REFERENCE_SEMANTIC_SHA_MISMATCH/],
    ['state', (envelope) => {
      envelope.recovery.candidate.sha = '1'.repeat(40);
      envelope.semanticSha256 = sha256(canonicalJson(semanticRecovery(envelope.recovery)));
    }, /RECOVERY_REFERENCE_STATE_MISMATCH/],
  ];
  for (const [label, mutate, identity] of cases) {
    const setup = setupState(`run-g2-reference-${label}`);
    mutateReferencedEnvelope(setup, mutate);
    assert.throws(() => readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId }), identity, label);
  }
});

test('R6 validateStateV3 accepts exactly the approved lifecycle states with their proper shapes', () => {
  const automatic = [
    'DIAGNOSTIC_REPLAN', 'RED_PENDING', 'RED_FROZEN', 'EXECUTOR_PENDING',
    'IMPLEMENTING', 'REVIEWING', 'CORRECTION',
  ];
  for (const branchState of automatic) {
    const state = readFixture('v3-red-pending.json');
    state.diagnosticRecovery.branches[0].state = branchState;
    assert.equal(validateStateV3(state).valid, true, branchState);
  }

  const human = readFixture('v3-red-pending.json');
  Object.assign(human.diagnosticRecovery.branches[0], {
    state: 'HUMAN_GATE',
    classification: 'NORMATIVE_DECISION',
    nextTask: null,
    humanGate: { decisionNeeded: 'Choose the policy.', proofs: [{ path: '.soma/proof.json' }] },
  });
  assert.equal(validateStateV3(human).valid, true, 'HUMAN_GATE');

  const closed = readFixture('v3-red-pending.json');
  Object.assign(closed.diagnosticRecovery.branches[0], {
    state: 'CLOSED', openFindings: [], nextTask: null, humanGate: null,
    closedFindings: [{ fingerprint: 'a'.repeat(64), proof: '.soma/proof.json' }],
  });
  assert.equal(validateStateV3(closed).valid, true, 'CLOSED');
});

test('R7 validateStateV3 rejects code-only lifecycle states', () => {
  for (const branchState of ['GREEN_PENDING', 'REVIEW_PENDING', 'CORRECTION_PENDING']) {
    const state = readFixture('v3-red-pending.json');
    state.diagnosticRecovery.branches[0].state = branchState;
    assert.equal(validateStateV3(state).valid, false, branchState);
  }
});

test('R8 validateStateV3 rejects empty openFindings for every non-CLOSED state', () => {
  for (const branchState of [
    'DIAGNOSTIC_REPLAN', 'RED_PENDING', 'RED_FROZEN', 'EXECUTOR_PENDING',
    'IMPLEMENTING', 'REVIEWING', 'CORRECTION', 'HUMAN_GATE',
  ]) {
    const state = readFixture('v3-red-pending.json');
    const branch = state.diagnosticRecovery.branches[0];
    branch.state = branchState;
    branch.openFindings = [];
    if (branchState === 'HUMAN_GATE') {
      branch.classification = 'NORMATIVE_DECISION';
      branch.nextTask = null;
      branch.humanGate = { decisionNeeded: 'Choose the policy.', proofs: [{ path: '.soma/proof.json' }] };
    }
    assert.equal(validateStateV3(state).valid, false, branchState);
  }
});

test('R9 CLOSED accepts only closed proof evidence and no open finding', () => {
  const closed = readFixture('v3-red-pending.json');
  Object.assign(closed.diagnosticRecovery.branches[0], {
    state: 'CLOSED', openFindings: [], nextTask: null, humanGate: null,
    closedFindings: [{ fingerprint: 'a'.repeat(64), proof: '.soma/proof.json' }],
  });
  assert.equal(validateStateV3(closed).valid, true);

  const missingProof = clone(closed);
  delete missingProof.diagnosticRecovery.branches[0].closedFindings[0].proof;
  assert.equal(validateStateV3(missingProof).valid, false);

  const reopened = clone(closed);
  reopened.diagnosticRecovery.branches[0].openFindings = [{ fingerprint: 'b'.repeat(64), requirementRef: 'AC-07' }];
  assert.equal(validateStateV3(reopened).valid, false);
});

test('R10 publication strips exact dispatch transport fields while preserving candidateDatePolicy semantics', () => {
  const setup = setupState('run-g2-projection');
  const generation = branchFrom(setup.state, {
    generation: 1,
    generationArtifact: { path: '/caller-supplied.json', sha256: 'a'.repeat(64) },
    dispatchHistory: { prompt: 'dispatch-only prompt', output: 'dispatch-only output' },
    prompt: 'top-level prompt',
    output: 'top-level output',
    path: '/caller-supplied-path',
    publishedAt: '2026-08-26T13:00:00.000Z',
    reviewPlan: { declaredRisks: ['candidateDatePolicy=preserve-exact'] },
  });
  const result = publishRecoveryGeneration(publicationInput(setup, generation));
  const artifact = readJson(path.join(setup.projectRoot, result.generationPath));
  const persisted = readStateV3({ projectRoot: setup.projectRoot, runId: setup.runId });
  const transient = ['generationArtifact', 'dispatchHistory', 'prompt', 'output', 'path', 'publishedAt'];

  for (const field of transient) {
    assert.equal(Object.hasOwn(artifact.recovery, field), false, `artifact ${field}`);
    if (field !== 'generationArtifact') assert.equal(Object.hasOwn(persisted.diagnosticRecovery.branches[0], field), false, `state ${field}`);
  }
  assert.deepEqual(artifact.recovery.reviewPlan.declaredRisks, ['candidateDatePolicy=preserve-exact']);
  assert.deepEqual(persisted.diagnosticRecovery.branches[0].reviewPlan.declaredRisks, ['candidateDatePolicy=preserve-exact']);
});

test('R11 unknown branch fields reject before generation install and preserve state and directory bytes', () => {
  const setup = setupState('run-g2-unknown-field');
  const sentinel = path.join(recoveryDir(setup), 'sentinel.json');
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, '{"sentinel":true}\n');
  const beforeState = fs.readFileSync(setup.runStateFile);
  const beforeSentinel = fs.readFileSync(sentinel);
  const generation = branchFrom(setup.state, { generation: 1, agentTranscript: 'never persist this' });

  assert.throws(
    () => publishRecoveryGeneration(publicationInput(setup, generation)),
    /RECOVERY_BRANCH_UNKNOWN_FIELD/
  );
  assert.deepEqual(fs.readFileSync(setup.runStateFile), beforeState);
  assert.deepEqual(fs.readFileSync(sentinel), beforeSentinel);
  assert.deepEqual(fs.readdirSync(recoveryDir(setup)).sort(), ['sentinel.json']);
});
