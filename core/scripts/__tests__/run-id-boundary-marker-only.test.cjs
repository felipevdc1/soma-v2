'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
} = require('./helpers/run-identity-fixture.cjs');

const RUN_CLI = path.join(__dirname, '..', 'run.cjs');
const RUN_ID = 'run-marker-only-boundary';
const STEP = 'STEP_1B_PLAN';
const TASK = 'T-MARKER-ONLY';
const EXPECTED_CODE = 'RUN_ID_IDENTITY_UNPROVABLE';

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId,
  }, null, 2)}\n`, 'utf8');
}

function markerPath(projectRoot) {
  return path.join(projectRoot, '.soma', 'run-identities', `${RUN_ID}.json`);
}

function statePath(projectRoot) {
  return path.join(projectRoot, '.soma', `run-state-${RUN_ID}.json`);
}

function makeMarkerOnlyProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-id-marker-only-'));
  const marker = markerPath(projectRoot);
  const bytes = canonicalMarkerBytes(RUN_ID);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, bytes);
  assert.deepEqual(fs.readFileSync(marker), bytes, 'fixture marker is not canonical and exact');
  assert.equal(fs.existsSync(statePath(projectRoot)), false, 'fixture unexpectedly contains state');
  return { projectRoot, marker, bytes };
}

function runRun(projectRoot, args) {
  return spawnSync(process.execPath, [RUN_CLI, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function assertAll(checks) {
  const errors = [];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, errors.map(error => error.message).join(' | '));
  }
}

function parseFailure(result, label) {
  assert.equal(result.signal, null, `${label}: process hung or was killed`);
  assert.notEqual(result.status, 0, `${label}: marker-only request returned success`);
  assert.notEqual(result.stderr.trim(), '', `${label}: missing machine-readable failure`);
  return JSON.parse(result.stderr.trim());
}

function assertMarkerOnlyRejection({ setup, before, result, label }) {
  assertAll([
    () => {
      const failure = parseFailure(result, label);
      assert.ok(
        failure.error === EXPECTED_CODE || failure.code === EXPECTED_CODE,
        `${label}: expected machine-checkable ${EXPECTED_CODE}, got ${JSON.stringify(failure)}`
      );
      assert.match(
        failure.message || '',
        new RegExp(`^${EXPECTED_CODE}(?::|$)`),
        `${label}: message does not preserve the stable error prefix`
      );
      assert.match(failure.message || '', /state|identity evidence/i, `${label}: missing state/evidence context`);
      assert.match(
        failure.message || '',
        /no state file|no such file|missing|absent|unprovable/i,
        `${label}: missing a legible absence reason`
      );
    },
    () => assert.doesNotMatch(
      result.stdout,
      /"ok"\s*:\s*true|reenters at|report written|transition allowed/i,
      `${label}: emitted a success payload`
    ),
    () => assertTreeUnchanged(setup.projectRoot, before, `${label}: durable tree changed`),
    () => assert.deepEqual(fs.readFileSync(setup.marker), setup.bytes, `${label}: marker bytes changed`),
    () => assert.equal(fs.existsSync(statePath(setup.projectRoot)), false, `${label}: created state`),
    () => assert.equal(
      snapshotTree(setup.projectRoot).some(entry =>
        /(?:^|\/)(?:reports|recovery)(?:\/|$)|\.tmp$|\.state-cas(?:\/|$)/.test(entry.path)
      ),
      false,
      `${label}: created report, CAS, recovery, or temporary artifacts`
    ),
  ]);
}

function withMarkerOnlyProject(run) {
  const setup = makeMarkerOnlyProject();
  try {
    const before = snapshotTree(setup.projectRoot);
    run(setup, before);
  } finally {
    fs.rmSync(setup.projectRoot, { recursive: true, force: true });
  }
}

test('marker-only report classifies absent state as identity unprovable before any write', () => {
  withMarkerOnlyProject((setup, before) => {
    const result = runRun(setup.projectRoot, [
      'report', '--run', RUN_ID, '--step', STEP, '--status', 'pass',
    ]);
    assertMarkerOnlyRejection({ setup, before, result, label: 'marker-only report' });
  });
});

test('marker-only first-step gate classifies absent state before the no-previous-step success path', () => {
  withMarkerOnlyProject((setup, before) => {
    const result = runRun(setup.projectRoot, [
      'gate', '--run', RUN_ID, '--step', 'STEP_1A_SPECIFY',
    ]);
    assertMarkerOnlyRejection({ setup, before, result, label: 'marker-only first-step gate' });
  });
});

test('marker-only later-step gate classifies absent state before report lookup or status', () => {
  withMarkerOnlyProject((setup, before) => {
    const result = runRun(setup.projectRoot, [
      'gate', '--run', RUN_ID, '--step', STEP,
    ]);
    assertMarkerOnlyRejection({ setup, before, result, label: 'marker-only later-step gate' });
  });
});

test('marker-only validator gate classifies absent state before metadata or executor checks', () => {
  withMarkerOnlyProject((setup, before) => {
    const result = runRun(setup.projectRoot, [
      'gate', '--run', RUN_ID, '--validate', TASK, '--validator', 'validator-agent',
    ]);
    assertMarkerOnlyRejection({ setup, before, result, label: 'marker-only validator gate' });
  });
});

test('marker-only explicit resume classifies absent state without ok or reentry output', () => {
  withMarkerOnlyProject((setup, before) => {
    const result = runRun(setup.projectRoot, ['resume', '--run', RUN_ID]);
    assertMarkerOnlyRejection({ setup, before, result, label: 'marker-only resume' });
  });
});
