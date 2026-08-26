'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  snapshotTree,
  assertTreeUnchanged,
} = require('./helpers/run-identity-fixture.cjs');

const RUN_ID_MODULE = path.join(__dirname, '..', 'run', 'run-id.cjs');
const V2_FIXTURE = path.join(__dirname, 'fixtures', 'recovery', 'state', 'v2-valid.json');
const RUN_ID = 'run-close-error';

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-run-id-close-'));
}

function markerPath(projectRoot) {
  return path.join(projectRoot, '.soma', 'run-identities', `${RUN_ID}.json`);
}

function statePath(projectRoot) {
  return path.join(projectRoot, '.soma', `run-state-${RUN_ID}.json`);
}

function canonicalMarkerBytes() {
  return Buffer.from(`${JSON.stringify({
    $schema: 'soma-run-identity/v1',
    runId: RUN_ID,
  }, null, 2)}\n`, 'utf8');
}

function seedMarker(projectRoot) {
  const file = markerPath(projectRoot);
  const bytes = canonicalMarkerBytes();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

function seedV2State(projectRoot) {
  const state = JSON.parse(fs.readFileSync(V2_FIXTURE, 'utf8'));
  state.runId = RUN_ID;
  const file = statePath(projectRoot);
  const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

function injectedIoError(message) {
  const error = new Error(message);
  error.code = 'EIO';
  return error;
}

function reserveWithReadFaults(projectRoot, targetPath, { failRead = false } = {}) {
  const originalOpenSync = fs.openSync;
  const originalReadFileSync = fs.readFileSync;
  const originalCloseSync = fs.closeSync;
  let targetDescriptor;
  let readAttempts = 0;
  let closeAttempts = 0;
  let thrown;

  try {
    fs.openSync = function captureTargetDescriptor(openPath, ...args) {
      const descriptor = originalOpenSync.call(this, openPath, ...args);
      if (openPath === targetPath) targetDescriptor = descriptor;
      return descriptor;
    };
    fs.readFileSync = function injectPrimaryReadError(file, ...args) {
      if (file === targetDescriptor && failRead) {
        readAttempts += 1;
        throw injectedIoError('injected primary read EIO');
      }
      return originalReadFileSync.call(this, file, ...args);
    };
    fs.closeSync = function injectCloseError(descriptor) {
      if (descriptor === targetDescriptor) {
        closeAttempts += 1;
        throw injectedIoError('injected close EIO');
      }
      return originalCloseSync.call(this, descriptor);
    };

    try {
      const { reserveRunIdentity } = require(RUN_ID_MODULE);
      reserveRunIdentity({ projectRoot, runId: RUN_ID, allowNew: true });
    } catch (error) {
      thrown = error;
    }
  } finally {
    fs.openSync = originalOpenSync;
    fs.readFileSync = originalReadFileSync;
    fs.closeSync = originalCloseSync;
  }

  return { thrown, targetDescriptor, readAttempts, closeAttempts };
}

function assertStableBoundary(error, expectedCode) {
  assert.ok(error, `${expectedCode} boundary did not throw`);
  assert.equal(error.code, expectedCode, `${expectedCode} must remain the error code, never raw EIO`);
  assert.match(error.message, new RegExp(`^${expectedCode}(?::|$)`));
}

test('marker close EIO keeps RUN_ID_MARKER_INVALID and preserves the tree', () => {
  const projectRoot = makeProject();
  try {
    const marker = seedMarker(projectRoot);
    const before = snapshotTree(projectRoot);
    const observed = reserveWithReadFaults(projectRoot, marker.file);

    assert.notEqual(observed.targetDescriptor, undefined, 'marker read descriptor was not captured');
    assert.equal(observed.closeAttempts, 1, 'marker descriptor close must be attempted exactly once');
    assertTreeUnchanged(projectRoot, before, 'marker close failure must preserve the project tree');
    assert.deepEqual(fs.readFileSync(marker.file), marker.bytes, 'marker bytes changed after close failure');
    assertStableBoundary(observed.thrown, 'RUN_ID_MARKER_INVALID');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('v2 state close EIO keeps RUN_ID_IDENTITY_UNPROVABLE without marker or temp artifacts', () => {
  const projectRoot = makeProject();
  try {
    const state = seedV2State(projectRoot);
    const before = snapshotTree(projectRoot);
    const observed = reserveWithReadFaults(projectRoot, state.file);

    assert.notEqual(observed.targetDescriptor, undefined, 'state read descriptor was not captured');
    assert.equal(observed.closeAttempts, 1, 'state descriptor close must be attempted exactly once');
    assertTreeUnchanged(projectRoot, before, 'state close failure must preserve the project tree');
    assert.deepEqual(fs.readFileSync(state.file), state.bytes, 'state bytes changed after close failure');
    assert.equal(fs.existsSync(markerPath(projectRoot)), false, 'state close failure created a marker');
    const identityDirectory = path.dirname(markerPath(projectRoot));
    assert.equal(
      fs.existsSync(identityDirectory) ? fs.readdirSync(identityDirectory).some(name => name.endsWith('.tmp')) : false,
      false,
      'state close failure left a temp artifact'
    );
    assertStableBoundary(observed.thrown, 'RUN_ID_IDENTITY_UNPROVABLE');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('primary marker read EIO is not replaced by close EIO', () => {
  const projectRoot = makeProject();
  try {
    const marker = seedMarker(projectRoot);
    const before = snapshotTree(projectRoot);
    const observed = reserveWithReadFaults(projectRoot, marker.file, { failRead: true });

    assert.notEqual(observed.targetDescriptor, undefined, 'marker read descriptor was not captured');
    assert.equal(observed.readAttempts, 1, 'primary marker read fault must fire exactly once');
    assert.equal(observed.closeAttempts, 1, 'marker descriptor close must be attempted exactly once');
    assertTreeUnchanged(projectRoot, before, 'combined read and close failure must preserve the tree');
    assert.deepEqual(fs.readFileSync(marker.file), marker.bytes, 'combined failure changed marker bytes');
    assertStableBoundary(observed.thrown, 'RUN_ID_MARKER_INVALID');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
