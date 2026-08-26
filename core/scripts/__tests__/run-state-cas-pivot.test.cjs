'use strict';

/**
 * RED oracle for the approved Pair B state-storage pivot.
 *
 * These cases use public module and CLI entry points with real temp
 * directories. The only scheduling hook is the store's documented fault
 * boundary, or a synchronous rename interleave at the legacy writer seam.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validateStateV3,
  publishRecoveryGeneration,
} = require('../run/recovery-store.cjs');
const { appendReport } = require('../run/state.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'recovery', 'state');
const STATE_CLI = path.join(__dirname, '..', 'run', 'state.cjs');
const readFixture = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = file => sha256(fs.readFileSync(file));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function setupState(runId) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-state-cas-pivot-'));
  const runStateFile = path.join(projectRoot, '.soma', `run-state-${runId}.json`);
  const state = readFixture('v3-red-pending.json');
  state.runId = runId;
  writeJson(runStateFile, state);
  return { projectRoot, runId, runStateFile, state };
}

function branchFrom(state, overrides = {}) {
  return { ...clone(state.diagnosticRecovery.branches[0]), ...overrides };
}

function publicationInput(setup, generation, overrides = {}) {
  return {
    projectRoot: setup.projectRoot,
    runId: setup.runId,
    expectedStateSha256: sha256File(setup.runStateFile),
    generation,
    ...overrides,
  };
}

function recoveryBytes(projectRoot) {
  const root = path.join(projectRoot, '.soma', 'recovery');
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result.push([path.relative(root, file), fs.readFileSync(file)]);
      else result.push([path.relative(root, file), Buffer.from(`non-file:${entry.name}`)]);
    }
  };
  visit(root);
  return result.sort(([left], [right]) => left.localeCompare(right));
}

function assertUnchanged(setup, stateBytes, beforeRecovery, message) {
  assert.deepEqual(fs.readFileSync(setup.runStateFile), stateBytes, `${message}: state bytes`);
  assert.deepEqual(recoveryBytes(setup.projectRoot), beforeRecovery, `${message}: claim/generation bytes`);
}

test('all-writer CAS has no lost report', () => {
  const setup = setupState('run-all-writer-cas');
  try {
    setup.state.reports = [{
      step: 'STEP_1A_SPECIFY', status: 'pass',
      path: `.soma/reports/${setup.runId}/STEP_1A_SPECIFY-report.json`,
      finished_at: '2026-08-26T12:02:00.000Z',
    }];
    writeJson(setup.runStateFile, setup.state);

    const originalReadFile = fs.readFileSync;
    let interleaved = false;
    let writer;
    fs.readFileSync = function patchedReadFile(file, ...args) {
      const bytes = originalReadFile.call(this, file, ...args);
      if (!interleaved && file === setup.runStateFile) {
        interleaved = true;
        writer = spawnSync('node', [STATE_CLI, '--run', setup.runId, '--set', 'STEP_3_FOUNDATION'], {
          cwd: setup.projectRoot,
          encoding: 'utf8',
        });
      }
      return bytes;
    };
    let append;
    try {
      append = appendReport({
        projectRoot: setup.projectRoot,
        runId: setup.runId,
        step: 'STEP_1B_PLAN',
        status: 'pass',
        finishedAt: '2026-08-26T12:03:00.000Z',
      });
    } finally {
      fs.readFileSync = originalReadFile;
    }

    assert.equal(interleaved, true, 'the append writer must read the shared prior state');
    assert.equal(writer.status, 0, writer.stderr);
    assert.equal(append.ok, true, append.reason);
    const finalState = JSON.parse(fs.readFileSync(setup.runStateFile, 'utf8'));
    assert.equal(finalState.currentState, 'STEP_3_FOUNDATION');
    assert.deepEqual(finalState.reports.map(entry => entry.step), ['STEP_1A_SPECIFY', 'STEP_1B_PLAN']);
  } finally {
    fs.rmSync(setup.projectRoot, { recursive: true, force: true });
  }
});

test('crash claim takeover completes without a lease', () => {
  const setup = setupState('run-crash-claim-takeover');
  try {
    const generation = branchFrom(setup.state, { generation: 1 });
    const expectedStateSha256 = sha256File(setup.runStateFile);
    const claimPath = path.join(
      setup.projectRoot, '.soma', 'recovery', setup.runId, '.state-cas', `${expectedStateSha256}.json`
    );
    const generationPath = path.join(setup.projectRoot, '.soma', 'recovery', setup.runId, '0001.json');
    const beforeState = fs.readFileSync(setup.runStateFile);

    assert.throws(
      () => publishRecoveryGeneration({
        projectRoot: setup.projectRoot,
        runId: setup.runId,
        expectedStateSha256,
        generation,
        fault: { 'after-state-claim-install': () => { throw new Error('INJECTED after-state-claim-install'); } },
      }),
      /INJECTED after-state-claim-install/
    );
    assert.deepEqual(fs.readFileSync(setup.runStateFile), beforeState, 'crash boundary must precede state replacement');
    const claimedBytes = fs.readFileSync(claimPath);
    const generationBytes = fs.readFileSync(generationPath);

    const retry = publishRecoveryGeneration({
      projectRoot: setup.projectRoot,
      runId: setup.runId,
      expectedStateSha256,
      generation,
    });
    assert.equal(retry.adopted, true);
    assert.equal(retry.state.diagnosticRecovery.branches[0].generation, 1);
    assert.deepEqual(fs.readFileSync(claimPath), claimedBytes, 'retry must keep the original claim bytes');
    assert.deepEqual(fs.readFileSync(generationPath), generationBytes, 'retry must keep immutable generation bytes');

    const afterState = fs.readFileSync(setup.runStateFile);
    const differentClaim = branchFrom(setup.state, {
      generation: 1,
      transitionKey: 'recovery:branch-red-pending:1:DIFFERENT',
    });
    assert.throws(
      () => publishRecoveryGeneration({
        projectRoot: setup.projectRoot,
        runId: setup.runId,
        expectedStateSha256,
        generation: differentClaim,
      }),
      /STATE_CAS_CONFLICT/
    );
    assert.deepEqual(fs.readFileSync(setup.runStateFile), afterState, 'conflicting retry must not replace state bytes');
    assert.deepEqual(fs.readFileSync(claimPath), claimedBytes, 'conflicting retry must not replace claim bytes');
    assert.deepEqual(fs.readFileSync(generationPath), generationBytes, 'conflicting retry must not replace generation bytes');
  } finally {
    fs.rmSync(setup.projectRoot, { recursive: true, force: true });
  }
});

test('exact runId equality is byte-for-byte', () => {
  const setup = setupState('run-\u00e9');
  try {
    const initialState = fs.readFileSync(setup.runStateFile);
    const initialRecovery = recoveryBytes(setup.projectRoot);
    const generation = branchFrom(setup.state, { generation: 1 });
    for (const unsafeRunId of ['..', 'part/child', 'part\\child', 'run\u0000id']) {
      assert.throws(
        () => publishRecoveryGeneration({
          projectRoot: setup.projectRoot,
          runId: unsafeRunId,
          expectedStateSha256: sha256File(setup.runStateFile),
          generation,
        }),
        /RECOVERY_STATE_RUN_ID_INVALID/,
        JSON.stringify(unsafeRunId)
      );
      assertUnchanged(setup, initialState, initialRecovery, JSON.stringify(unsafeRunId));
    }

    const nfdRunId = 'run-e\u0301';
    const nfdStatePath = path.join(setup.projectRoot, '.soma', `run-state-${nfdRunId}.json`);
    const nfcStat = fs.statSync(setup.runStateFile);
    const nfdStat = fs.statSync(nfdStatePath);
    assert.equal(nfdStat.dev, nfcStat.dev, 'the host must resolve NFC and NFD names to the same state file');
    assert.equal(nfdStat.ino, nfcStat.ino, 'the host must resolve NFC and NFD names to the same state file');

    const beforeState = fs.readFileSync(setup.runStateFile);
    const beforeRecovery = recoveryBytes(setup.projectRoot);
    assert.throws(
      () => publishRecoveryGeneration({
        projectRoot: setup.projectRoot,
        runId: nfdRunId,
        expectedStateSha256: sha256File(setup.runStateFile),
        generation,
      }),
      /RECOVERY_STATE_RUN_ID_MISMATCH/
    );
    assertUnchanged(setup, beforeState, beforeRecovery, 'NFC/NFD mismatch');
  } finally {
    fs.rmSync(setup.projectRoot, { recursive: true, force: true });
  }
});

test('open/closed fingerprint sets are disjoint', () => {
  const state = readFixture('v3-red-pending.json');
  const branch = state.diagnosticRecovery.branches[0];
  branch.closedFindings = [{
    fingerprint: branch.openFindings[0].fingerprint,
    proof: '.soma/dispatches/run-v3-red-pending/T-RED/red-proof.json',
  }];

  const result = validateStateV3(state);
  assert.equal(result.valid, false);
  assert.match(result.violations.join('\n'), /openFindings.*closedFindings.*disjoint/i);
});
