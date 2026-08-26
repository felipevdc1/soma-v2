'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MARKER_SCHEMA = 'soma-run-identity/v1';
const LEGACY_STATE_SCHEMAS = new Set(['soma-state/v2', 'soma-state/v3']);

function codedError(code, detail) {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function safeRunId(runId) {
  return typeof runId === 'string' &&
    runId.trim().length > 0 &&
    runId !== '.' &&
    runId !== '..' &&
    !runId.includes('/') &&
    !runId.includes('\\') &&
    !runId.includes('\0') &&
    path.basename(runId) === runId;
}

function assertSafeRunId(runId) {
  if (!safeRunId(runId)) throw codedError('RUN_ID_INVALID');
  return runId;
}

function assertExactRunId(actualRunId, expectedRunId) {
  assertSafeRunId(expectedRunId);
  if (!safeRunId(actualRunId) || actualRunId !== expectedRunId) {
    throw codedError('RUN_ID_MISMATCH');
  }
  return actualRunId;
}

function canonicalMarkerBytes(runId) {
  return Buffer.from(`${JSON.stringify({
    $schema: MARKER_SCHEMA,
    runId,
  }, null, 2)}\n`, 'utf8');
}

function readRegularFile(filePath, invalidCode) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw codedError(invalidCode, 'cannot inspect identity evidence');
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw codedError(invalidCode, 'identity evidence is not a regular file');
  }

  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    if (!fs.fstatSync(descriptor).isFile()) {
      throw codedError(invalidCode, 'identity evidence changed type');
    }
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.includes(invalidCode)) {
      throw error;
    }
    throw codedError(invalidCode, 'cannot read identity evidence safely');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function validateMarker(markerPath, runId) {
  const bytes = readRegularFile(markerPath, 'RUN_ID_MARKER_INVALID');
  if (bytes === null) return false;

  let marker;
  try {
    marker = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    throw codedError('RUN_ID_MARKER_INVALID', 'marker is not canonical JSON');
  }

  const keys = marker && typeof marker === 'object' && !Array.isArray(marker)
    ? Object.keys(marker)
    : [];
  if (keys.length !== 2 || keys[0] !== '$schema' || keys[1] !== 'runId' ||
      marker.$schema !== MARKER_SCHEMA || !safeRunId(marker.runId) ||
      !bytes.equals(canonicalMarkerBytes(marker.runId))) {
    throw codedError('RUN_ID_MARKER_INVALID', 'marker bytes are not canonical');
  }

  assertExactRunId(marker.runId, runId);
  return true;
}

function validateLegacyState(statePath, runId) {
  const bytes = readRegularFile(statePath, 'RUN_ID_IDENTITY_UNPROVABLE');
  if (bytes === null) return false;

  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    throw codedError('RUN_ID_IDENTITY_UNPROVABLE', 'state is not valid JSON');
  }

  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !LEGACY_STATE_SCHEMAS.has(state.$schema)) {
    throw codedError('RUN_ID_IDENTITY_UNPROVABLE', 'state schema is not an exact supported version');
  }
  assertExactRunId(state.runId, runId);
  return true;
}

function exactPathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw codedError('RUN_ID_IDENTITY_UNPROVABLE', 'cannot inspect legacy artifacts');
  }
}

function ensurePlainDirectory(directoryPath) {
  try {
    fs.mkdirSync(directoryPath, { mode: 0o700 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  }

  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw codedError('RUN_ID_IDENTITY_INSTALL_FAILED', 'identity directory is not a regular directory');
  }
}

function fsyncDirectory(directoryPath) {
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const directoryOnly = typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0;
  const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY | noFollow | directoryOnly);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function installMarker({ somaDir, identitiesDir, markerPath, runId, status }) {
  const bytes = canonicalMarkerBytes(runId);
  let tempPath;
  let descriptor;
  let linking = false;

  try {
    ensurePlainDirectory(somaDir);
    ensurePlainDirectory(identitiesDir);
    tempPath = path.join(
      identitiesDir,
      `.${runId}.${process.pid}.${crypto.randomBytes(16).toString('hex')}.tmp`
    );
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    linking = true;
    fs.linkSync(tempPath, markerPath);
    linking = false;
    fsyncDirectory(identitiesDir);
    return { status, markerPath };
  } catch (error) {
    if (linking && error && error.code === 'EEXIST') {
      validateMarker(markerPath, runId);
      return { status: 'matched', markerPath };
    }
    if (error && typeof error.message === 'string' &&
        /RUN_ID_(?:INVALID|MISMATCH|MARKER_INVALID|IDENTITY_UNPROVABLE|IDENTITY_INSTALL_FAILED)/.test(error.message)) {
      throw error;
    }
    throw codedError(
      'RUN_ID_IDENTITY_INSTALL_FAILED',
      error && error.message ? error.message : String(error)
    );
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_error) { /* best-effort close */ }
    }
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          // The final hard link, when present, remains the complete durable marker.
        }
      }
    }
  }
}

function reserveRunIdentity({ projectRoot, runId, allowNew }) {
  const exactRunId = assertSafeRunId(runId);
  const somaDir = path.join(projectRoot, '.soma');
  const identitiesDir = path.join(somaDir, 'run-identities');
  const markerPath = path.join(identitiesDir, `${exactRunId}.json`);
  const statePath = path.join(somaDir, `run-state-${exactRunId}.json`);

  if (validateMarker(markerPath, exactRunId)) {
    return { status: 'matched', markerPath };
  }

  if (validateLegacyState(statePath, exactRunId)) {
    return installMarker({
      somaDir,
      identitiesDir,
      markerPath,
      runId: exactRunId,
      status: 'adopted',
    });
  }

  const legacyArtifactPaths = [
    path.join(somaDir, 'reports', exactRunId),
    path.join(somaDir, 'dispatches', exactRunId),
    path.join(somaDir, 'recovery', exactRunId),
  ];
  if (legacyArtifactPaths.some(exactPathExists) || allowNew !== true) {
    throw codedError('RUN_ID_IDENTITY_UNPROVABLE');
  }

  return installMarker({
    somaDir,
    identitiesDir,
    markerPath,
    runId: exactRunId,
    status: 'created',
  });
}

module.exports = {
  safeRunId,
  assertSafeRunId,
  assertExactRunId,
  reserveRunIdentity,
};
