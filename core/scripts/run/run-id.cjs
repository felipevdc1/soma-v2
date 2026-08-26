'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MARKER_SCHEMA = 'soma-run-identity/v1';
const LEGACY_STATE_SCHEMAS = new Set(['soma-state/v2', 'soma-state/v3']);
const STABLE_ERROR_CODES = new Set([
  'RUN_ID_INVALID',
  'RUN_ID_MISMATCH',
  'RUN_ID_MARKER_INVALID',
  'RUN_ID_IDENTITY_UNPROVABLE',
  'RUN_ID_IDENTITY_INSTALL_FAILED',
]);
const AUTOMATIC_STATES = new Set([
  'DIAGNOSTIC_REPLAN', 'RED_PENDING', 'RED_FROZEN', 'EXECUTOR_PENDING',
  'IMPLEMENTING', 'REVIEWING', 'CORRECTION',
]);
const HUMAN_STATE = 'HUMAN_GATE';
const CLOSED_STATE = 'CLOSED';
const BRANCH_STATES = new Set([...AUTOMATIC_STATES, HUMAN_STATE, CLOSED_STATE]);
const AUTOMATIC_CLASSIFICATIONS = new Set(['TECHNICAL_DETERMINISTIC', 'EVIDENCE_DEFICIENT']);
const HUMAN_CLASSIFICATIONS = new Set([
  'NORMATIVE_DECISION', 'SCOPE_AUTHORITY', 'CONTRADICTORY_REQUIREMENTS', 'NO_PROGRESS',
]);
const CLASSIFICATIONS = new Set([...AUTOMATIC_CLASSIFICATIONS, ...HUMAN_CLASSIFICATIONS]);
const PERSISTENT_BRANCH_FIELDS = new Set([
  'branchId', 'generation', 'state', 'classification', 'fingerprint', 'boundary',
  'candidate', 'proofs', 'closedFindings', 'openFindings', 'fingerprintHistory',
  'dependencyClosure', 'reviewPlan', 'transitionKey', 'nextTask', 'humanGate',
  'executorRotation', 'progressDelta',
]);
const NULLABLE_STATE_FIELDS = [
  'previousState', 'featureSlug', 'specPath', 'planPath', 'tasksPath', 'contractsDir',
  'teammateNamePrefix', 'constitutionVersion', 'constitutionSnapshotPath',
  'lastSuccessfulState', 'baselineSha',
];

function codedError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

function isStableCodedError(error, expectedCode) {
  return Boolean(error && error.code === expectedCode && STABLE_ERROR_CODES.has(error.code));
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isNonBlank(value) {
  return typeof value === 'string' && /\P{White_Space}/u.test(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}

function hasCommonStateShape(state) {
  return isObject(state) &&
    ['runId', 'sessionId', 'startedAt', 'currentState', 'lastTransitionAt'].every(
      key => isString(state[key])
    ) &&
    ['activeDispatchIds', 'snapshots', 'decisions', 'reports'].every(
      key => Array.isArray(state[key])
    ) &&
    isObject(state.failureCountsByStep) &&
    isObject(state.humanGatesApproved);
}

function validStateV2(state) {
  return hasCommonStateShape(state) && state.$schema === 'soma-state/v2' &&
    typeof state.fixLoopIterations === 'number';
}

function validRecoveryBranch(branch) {
  if (!isObject(branch)) return false;
  if (Object.keys(branch).some(key =>
    !PERSISTENT_BRANCH_FIELDS.has(key) && key !== 'generationArtifact')) return false;
  if (!['branchId', 'state', 'classification', 'fingerprint', 'boundary', 'transitionKey']
    .every(key => isNonBlank(branch[key]))) return false;
  if (!BRANCH_STATES.has(branch.state) || !CLASSIFICATIONS.has(branch.classification) ||
      !isSha256(branch.fingerprint) || !Number.isInteger(branch.generation) ||
      branch.generation < 1) return false;
  if (!['candidate', 'reviewPlan', 'executorRotation', 'progressDelta']
    .every(key => isObject(branch[key]))) return false;
  if (!['proofs', 'openFindings', 'closedFindings', 'fingerprintHistory', 'dependencyClosure']
    .every(key => Array.isArray(branch[key]))) return false;
  if (!Array.isArray(branch.reviewPlan.declaredRisks) ||
      !branch.reviewPlan.declaredRisks.every(isString)) return false;
  if (!isGitSha(branch.candidate.sha) || typeof branch.candidate.preserved !== 'boolean') return false;
  if (!branch.proofs.every(proof => isObject(proof) && isNonBlank(proof.kind) &&
      isNonBlank(proof.path) && isSha256(proof.sha256))) return false;
  if (!branch.openFindings.every(finding =>
    hasExactKeys(finding, ['fingerprint', 'requirementRef']) &&
    isSha256(finding.fingerprint) && isNonBlank(finding.requirementRef))) return false;
  if (!branch.closedFindings.every(finding =>
    hasExactKeys(finding, ['fingerprint', 'proof']) &&
    isSha256(finding.fingerprint) && isNonBlank(finding.proof))) return false;
  const closedFingerprints = new Set(branch.closedFindings.map(finding => finding.fingerprint));
  if (branch.openFindings.some(finding => closedFingerprints.has(finding.fingerprint))) return false;
  if (!branch.fingerprintHistory.every(isSha256) || !branch.dependencyClosure.every(isString)) return false;

  const rotation = branch.executorRotation;
  if (!Object.hasOwn(rotation, 'originalExecutor') || !Object.hasOwn(rotation, 'rotatedExecutor') ||
      !Object.hasOwn(rotation, 'rotationsUsed') || !Object.hasOwn(rotation, 'attemptsByExecutor') ||
      (rotation.originalExecutor !== null && !isString(rotation.originalExecutor)) ||
      (rotation.rotatedExecutor !== null && !isString(rotation.rotatedExecutor)) ||
      !Number.isInteger(rotation.rotationsUsed) || rotation.rotationsUsed < 0 ||
      !isObject(rotation.attemptsByExecutor) ||
      !Object.values(rotation.attemptsByExecutor).every(value =>
        Number.isInteger(value) && value >= 0)) return false;

  const progress = branch.progressDelta;
  if (!Number.isInteger(progress.closed) || progress.closed < 0 ||
      !Number.isInteger(progress.opened) || progress.opened < 0 ||
      !Number.isInteger(progress.previousOpenCount) ||
      !Number.isInteger(progress.currentOpenCount) ||
      typeof progress.setDecreased !== 'boolean' ||
      typeof progress.strongerRed !== 'boolean') return false;
  if (branch.generationArtifact !== undefined &&
      (!hasExactKeys(branch.generationArtifact, ['path', 'sha256']) ||
       !isNonBlank(branch.generationArtifact.path) ||
       !isSha256(branch.generationArtifact.sha256))) return false;
  if (branch.state !== CLOSED_STATE && branch.openFindings.length < 1) return false;

  if (branch.state === HUMAN_STATE) {
    return HUMAN_CLASSIFICATIONS.has(branch.classification) && branch.nextTask === null &&
      isObject(branch.humanGate) && isNonBlank(branch.humanGate.decisionNeeded) &&
      Array.isArray(branch.humanGate.proofs) && branch.humanGate.proofs.length > 0 &&
      branch.humanGate.proofs.every(proof =>
        isObject(proof) && Object.values(proof).some(isNonBlank));
  }
  if (branch.state === CLOSED_STATE) {
    return branch.openFindings.length === 0 && branch.nextTask === null &&
      branch.humanGate === null && branch.closedFindings.length > 0;
  }
  return AUTOMATIC_STATES.has(branch.state) &&
    AUTOMATIC_CLASSIFICATIONS.has(branch.classification) &&
    hasExactKeys(branch.nextTask, ['taskId', 'kind', 'status']) &&
    isNonBlank(branch.nextTask.taskId) && isNonBlank(branch.nextTask.kind) &&
    isNonBlank(branch.nextTask.status) && branch.humanGate === null;
}

function validStateV3(state) {
  if (!hasCommonStateShape(state) || state.$schema !== 'soma-state/v3' ||
      !Number.isInteger(state.fixLoopIterations) || state.fixLoopIterations < 0) return false;
  if (!Object.hasOwn(state, 'pausedDiagnostic') ||
      !NULLABLE_STATE_FIELDS.every(key => Object.hasOwn(state, key))) return false;
  if (!NULLABLE_STATE_FIELDS.every(key => state[key] === null || isString(state[key]))) return false;
  if (state.pausedDiagnostic !== null && !isObject(state.pausedDiagnostic)) return false;
  if (state.currentState === 'PAUSED_DIAGNOSTIC' && !isObject(state.pausedDiagnostic)) return false;

  const recovery = state.diagnosticRecovery;
  return isObject(recovery) && isObject(recovery.terminalCondition) &&
    recovery.terminalCondition.kind === 'finish' && recovery.terminalCondition.active === true &&
    Array.isArray(recovery.taskGraph) && Array.isArray(recovery.branches) &&
    recovery.branches.every(validRecoveryBranch);
}

function structurallyValidState(state) {
  return validStateV2(state) || validStateV3(state);
}

function validateExistingDirectory(directoryPath, invalidCode) {
  let stat;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw codedError(invalidCode, 'cannot inspect identity parent');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw codedError(invalidCode, 'identity parent is not a regular directory');
  }
  return true;
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
    if (isStableCodedError(error, invalidCode)) throw error;
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

  if (!isObject(state) || !LEGACY_STATE_SCHEMAS.has(state.$schema) ||
      !structurallyValidState(state)) {
    throw codedError('RUN_ID_IDENTITY_UNPROVABLE', 'state is not structurally valid');
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
  let tempCreated = false;
  let outcome;
  let operationError;

  try {
    ensurePlainDirectory(somaDir);
    ensurePlainDirectory(identitiesDir);
    tempPath = path.join(
      identitiesDir,
      `.${runId}.${process.pid}.${crypto.randomBytes(16).toString('hex')}.tmp`
    );
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    tempCreated = true;
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);

    try {
      fs.linkSync(tempPath, markerPath);
      outcome = { status, markerPath };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      validateMarker(markerPath, runId);
      outcome = { status: 'matched', markerPath };
    }
  } catch (error) {
    operationError = error && STABLE_ERROR_CODES.has(error.code)
      ? error
      : codedError(
        'RUN_ID_IDENTITY_INSTALL_FAILED',
        error && error.message ? error.message : String(error)
      );
  }

  let finalizationError;
  if (descriptor !== undefined) {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      finalizationError = codedError(
        'RUN_ID_IDENTITY_INSTALL_FAILED',
        error && error.message ? error.message : 'cannot close identity temp'
      );
    }
  }
  if (tempCreated) {
    let removed = false;
    try {
      fs.unlinkSync(tempPath);
      removed = true;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        removed = true;
      } else {
        finalizationError = codedError(
          'RUN_ID_IDENTITY_INSTALL_FAILED',
          error && error.message ? error.message : 'cannot remove identity temp'
        );
      }
    }
    if (removed) {
      try {
        fsyncDirectory(identitiesDir);
      } catch (error) {
        finalizationError = codedError(
          'RUN_ID_IDENTITY_INSTALL_FAILED',
          error && error.message ? error.message : 'cannot fsync identity directory'
        );
      }
    }
  }

  if (finalizationError) throw finalizationError;
  if (operationError) throw operationError;
  return outcome;
}

function reserveRunIdentity({ projectRoot, runId, allowNew }) {
  const exactRunId = assertSafeRunId(runId);
  const somaDir = path.join(projectRoot, '.soma');
  const identitiesDir = path.join(somaDir, 'run-identities');
  const markerPath = path.join(identitiesDir, `${exactRunId}.json`);
  const statePath = path.join(somaDir, `run-state-${exactRunId}.json`);

  const somaExists = validateExistingDirectory(somaDir, 'RUN_ID_MARKER_INVALID');
  if (somaExists) {
    validateExistingDirectory(identitiesDir, 'RUN_ID_MARKER_INVALID');
  }

  const markerExists = validateMarker(markerPath, exactRunId);
  const stateExists = validateLegacyState(statePath, exactRunId);
  if (markerExists) {
    return { status: 'matched', markerPath };
  }

  if (stateExists) {
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
