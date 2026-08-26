'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { snapshotTree, assertTreeUnchanged } = require('./helpers/run-identity-fixture.cjs');
const { appendReport } = require('../run/state.cjs');

const STATE_CLI = path.join(__dirname, '..', 'run', 'state.cjs');
const V2_FIXTURE = path.join(__dirname, 'fixtures', 'recovery', 'state', 'v2-valid.json');
const RUN_ID = 'run-v2-public-contract';
const LEGACY_V2_REASON =
  'soma-state/v2 is read-only; migrate explicitly to soma-state/v3 before mutation';

function writeBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId,
  }, null, 2)}\n`, 'utf8');
}

function setupExactV2() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-id-v2-contract-'));
  const state = JSON.parse(fs.readFileSync(V2_FIXTURE, 'utf8'));
  state.runId = RUN_ID;
  const stateBytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const stateFile = path.join(projectRoot, '.soma', `run-state-${RUN_ID}.json`);
  const markerFile = path.join(projectRoot, '.soma', 'run-identities', `${RUN_ID}.json`);

  writeBytes(stateFile, stateBytes);
  writeBytes(markerFile, canonicalMarkerBytes(RUN_ID));

  const reportFile = path.join(
    projectRoot,
    '.soma',
    'reports',
    RUN_ID,
    'STEP_1B_PLAN-report.json'
  );
  const claimFile = path.join(
    projectRoot,
    '.soma',
    'recovery',
    RUN_ID,
    '.state-cas',
    'prior-claim.json'
  );
  const nextStateFile = path.join(
    projectRoot,
    '.soma',
    'recovery',
    RUN_ID,
    '.state-cas',
    'prior-next-state.json'
  );
  const generationFile = path.join(projectRoot, '.soma', 'recovery', RUN_ID, '0001.json');

  writeBytes(reportFile, Buffer.from('sentinel report bytes\n'));
  writeBytes(claimFile, Buffer.from('sentinel claim bytes\n'));
  writeBytes(nextStateFile, Buffer.from('sentinel next-state bytes\n'));
  writeBytes(generationFile, Buffer.from('sentinel recovery generation bytes\n'));

  return {
    projectRoot,
    state,
    stateBytes,
    stateFile,
    markerFile,
    reportFile,
    claimFile,
    nextStateFile,
    generationFile,
  };
}

function assertExactV2AndNoWrites(setup, before, label) {
  assert.deepEqual(fs.readFileSync(setup.stateFile), setup.stateBytes, `${label}: state bytes changed`);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(setup.stateFile, 'utf8')),
    setup.state,
    `${label}: prior v2 state changed`
  );
  assert.deepEqual(
    fs.readFileSync(setup.markerFile),
    canonicalMarkerBytes(RUN_ID),
    `${label}: exact universal marker changed`
  );
  assertTreeUnchanged(
    setup.projectRoot,
    before,
    `${label}: report, ledger, CAS, recovery, or temporary bytes changed`
  );
}

test('exact v2 state --set preserves the public MIGRATION_REQUIRED contract without writes', () => {
  const setup = setupExactV2();
  try {
    const before = snapshotTree(setup.projectRoot);
    const result = spawnSync(
      process.execPath,
      [STATE_CLI, '--run', RUN_ID, '--set', 'REVIEWING'],
      { cwd: setup.projectRoot, encoding: 'utf8', timeout: 5_000 }
    );

    assert.equal(result.signal, null, 'state --set hung or was killed');
    assert.equal(result.status, 2, result.stderr);
    assert.doesNotMatch(result.stdout, /transitioned|success/i);
    assertExactV2AndNoWrites(setup, before, 'state --set on exact v2');

    const failure = JSON.parse(result.stderr.trim());
    assert.equal(failure.error, 'MIGRATION_REQUIRED');
    assert.equal(failure.message, LEGACY_V2_REASON);
  } finally {
    fs.rmSync(setup.projectRoot, { recursive: true, force: true });
  }
});

test('exact v2 appendReport preserves the public read-only reason without ledger or CAS writes', () => {
  const setup = setupExactV2();
  try {
    const before = snapshotTree(setup.projectRoot);
    const result = appendReport({
      projectRoot: setup.projectRoot,
      runId: RUN_ID,
      step: 'STEP_1B_PLAN',
      status: 'pass',
      finishedAt: '2026-08-26T12:34:56.000Z',
    });

    assert.equal(result.ok, false, `appendReport returned success: ${JSON.stringify(result)}`);
    assertExactV2AndNoWrites(setup, before, 'appendReport on exact v2');
    assert.equal(result.reason, LEGACY_V2_REASON);
  } finally {
    fs.rmSync(setup.projectRoot, { recursive: true, force: true });
  }
});
