'use strict';

/** Durable, content-addressed publication for soma-state/v3 recovery branches. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256Hex } = require('./recovery-model.cjs');
const { resolveSomaPaths } = require('./paths.cjs');

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
const TRANSIENT_BRANCH_FIELDS = new Set([
  'generationArtifact', 'dispatchHistory', 'prompt', 'output', 'path', 'publishedAt',
]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = value => typeof value === 'string' && value.length > 0;
const isNonBlank = value => typeof value === 'string' && /\P{White_Space}/u.test(value);
const isSha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isGitSha = value => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);
const hasExactKeys = (value, keys) => isObject(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function invalid(violations) { return { valid: false, violations }; }
function codedError(code, detail) { return new Error(detail ? `${code}: ${detail}` : code); }

function projectPersistentBranch(branch) {
  if (!isObject(branch)) throw new TypeError('recovery branch must be an object');
  const persistent = {};
  for (const [key, value] of Object.entries(branch)) {
    if (PERSISTENT_BRANCH_FIELDS.has(key)) persistent[key] = value;
    else if (!TRANSIENT_BRANCH_FIELDS.has(key)) {
      throw codedError('RECOVERY_BRANCH_UNKNOWN_FIELD', key);
    }
  }
  return persistent;
}

function validateStateV3(state) {
  const violations = [];
  if (!isObject(state)) return invalid(['state must be an object']);
  if (state.$schema !== 'soma-state/v3') violations.push('$schema must be soma-state/v3');
  for (const key of [
    'previousState', 'featureSlug', 'specPath', 'planPath', 'tasksPath', 'contractsDir',
    'teammateNamePrefix', 'constitutionVersion', 'constitutionSnapshotPath',
    'lastSuccessfulState', 'baselineSha', 'pausedDiagnostic',
  ]) {
    if (!Object.hasOwn(state, key)) violations.push(`${key} must be present`);
  }
  for (const key of [
    'previousState', 'featureSlug', 'specPath', 'planPath', 'tasksPath', 'contractsDir',
    'teammateNamePrefix', 'constitutionVersion', 'constitutionSnapshotPath',
    'lastSuccessfulState', 'baselineSha',
  ]) {
    if (state[key] !== null && !isString(state[key])) violations.push(`${key} must be string or null`);
  }
  if (state.pausedDiagnostic !== null && !isObject(state.pausedDiagnostic)) violations.push('pausedDiagnostic must be object or null');
  for (const key of ['runId', 'sessionId', 'startedAt', 'currentState', 'lastTransitionAt']) {
    if (!isString(state[key])) violations.push(`${key} must be a non-empty string`);
  }
  for (const key of ['activeDispatchIds', 'snapshots', 'decisions', 'reports']) {
    if (!Array.isArray(state[key])) violations.push(`${key} must be an array`);
  }
  if (!isObject(state.failureCountsByStep)) violations.push('failureCountsByStep must be an object');
  if (!Number.isInteger(state.fixLoopIterations) || state.fixLoopIterations < 0) violations.push('fixLoopIterations must be a non-negative integer');
  if (!isObject(state.humanGatesApproved)) violations.push('humanGatesApproved must be an object');
  if (!isObject(state.diagnosticRecovery)) return invalid([...violations, 'diagnosticRecovery must be an object']);
  const recovery = state.diagnosticRecovery;
  if (!isObject(recovery.terminalCondition) || recovery.terminalCondition.kind !== 'finish' || recovery.terminalCondition.active !== true) {
    violations.push('diagnosticRecovery.terminalCondition must be active finish');
  }
  if (!Array.isArray(recovery.taskGraph)) violations.push('diagnosticRecovery.taskGraph must be an array');
  if (!Array.isArray(recovery.branches)) return invalid([...violations, 'diagnosticRecovery.branches must be an array']);
  if (state.currentState === 'PAUSED_DIAGNOSTIC' && !isObject(state.pausedDiagnostic)) {
    violations.push('PAUSED_DIAGNOSTIC requires a non-null pausedDiagnostic payload');
  }
  for (const [index, branch] of recovery.branches.entries()) {
    const prefix = `diagnosticRecovery.branches[${index}]`;
    if (!isObject(branch)) { violations.push(`${prefix} must be an object`); continue; }
    for (const key of Object.keys(branch)) {
      if (!PERSISTENT_BRANCH_FIELDS.has(key) && key !== 'generationArtifact') {
        violations.push(`${prefix}.${key} is not a persistent branch field`);
      }
    }
    for (const key of ['branchId', 'state', 'classification', 'fingerprint', 'boundary', 'transitionKey']) {
      if (!isNonBlank(branch[key])) violations.push(`${prefix}.${key} must be a non-blank string`);
    }
    if (!BRANCH_STATES.has(branch.state)) violations.push(`${prefix}.state must be an approved lifecycle state`);
    if (!CLASSIFICATIONS.has(branch.classification)) violations.push(`${prefix}.classification must be a documented classification`);
    if (!isSha256(branch.fingerprint)) violations.push(`${prefix}.fingerprint must be a sha256`);
    if (!Number.isInteger(branch.generation) || branch.generation < 1) violations.push(`${prefix}.generation must be a positive integer`);
    for (const key of ['candidate', 'reviewPlan', 'executorRotation', 'progressDelta']) {
      if (!isObject(branch[key])) violations.push(`${prefix}.${key} must be an object`);
    }
    for (const key of ['proofs', 'openFindings', 'closedFindings', 'fingerprintHistory', 'dependencyClosure']) {
      if (!Array.isArray(branch[key])) violations.push(`${prefix}.${key} must be an array`);
    }
    if (!isObject(branch.reviewPlan) || !Array.isArray(branch.reviewPlan.declaredRisks) || !branch.reviewPlan.declaredRisks.every(isString)) {
      violations.push(`${prefix}.reviewPlan.declaredRisks must be an array`);
    }
    if (!isObject(branch.candidate) || !isGitSha(branch.candidate.sha) || typeof branch.candidate.preserved !== 'boolean') {
      violations.push(`${prefix}.candidate.sha must be a git sha and candidate.preserved must be boolean`);
    }
    for (const [proofIndex, proof] of (Array.isArray(branch.proofs) ? branch.proofs : []).entries()) {
      if (!isObject(proof) || !isNonBlank(proof.kind) || !isNonBlank(proof.path) || !isSha256(proof.sha256)) {
        violations.push(`${prefix}.proofs[${proofIndex}] must have kind, path, and sha256`);
      }
    }
    const openFindings = Array.isArray(branch.openFindings) ? branch.openFindings : [];
    for (const [findingIndex, finding] of openFindings.entries()) {
      if (!hasExactKeys(finding, ['fingerprint', 'requirementRef']) ||
          !isSha256(finding.fingerprint) || !isNonBlank(finding.requirementRef)) {
        violations.push(`${prefix}.openFindings[${findingIndex}] must be exactly fingerprint and requirementRef`);
      }
    }
    const closedFindings = Array.isArray(branch.closedFindings) ? branch.closedFindings : [];
    for (const [findingIndex, finding] of closedFindings.entries()) {
      if (!hasExactKeys(finding, ['fingerprint', 'proof']) ||
          !isSha256(finding.fingerprint) || !isNonBlank(finding.proof)) {
        violations.push(`${prefix}.closedFindings[${findingIndex}] must be exactly fingerprint and proof`);
      }
    }
    const closedFingerprints = new Set(closedFindings.map(finding => finding && finding.fingerprint));
    if (openFindings.some(finding => finding && closedFingerprints.has(finding.fingerprint))) {
      violations.push(`${prefix}.openFindings and closedFindings fingerprint sets must be disjoint`);
    }
    if (!(Array.isArray(branch.fingerprintHistory) && branch.fingerprintHistory.every(isSha256))) {
      violations.push(`${prefix}.fingerprintHistory must contain sha256 values`);
    }
    if (!(Array.isArray(branch.dependencyClosure) && branch.dependencyClosure.every(isString))) {
      violations.push(`${prefix}.dependencyClosure must contain task ids`);
    }
    if (!isObject(branch.executorRotation) ||
      !Object.hasOwn(branch.executorRotation, 'originalExecutor') ||
      !Object.hasOwn(branch.executorRotation, 'rotatedExecutor') ||
      !Object.hasOwn(branch.executorRotation, 'rotationsUsed') ||
      !Object.hasOwn(branch.executorRotation, 'attemptsByExecutor') ||
      (branch.executorRotation.originalExecutor !== null && !isString(branch.executorRotation.originalExecutor)) ||
      (branch.executorRotation.rotatedExecutor !== null && !isString(branch.executorRotation.rotatedExecutor)) ||
      !Number.isInteger(branch.executorRotation.rotationsUsed) || branch.executorRotation.rotationsUsed < 0 ||
      !isObject(branch.executorRotation.attemptsByExecutor) ||
      !Object.values(branch.executorRotation.attemptsByExecutor).every(value => Number.isInteger(value) && value >= 0)) {
      violations.push(`${prefix}.executorRotation must be a valid rotation object`);
    }
    if (!isObject(branch.progressDelta) || !Number.isInteger(branch.progressDelta.closed) || branch.progressDelta.closed < 0 ||
      !Number.isInteger(branch.progressDelta.opened) || branch.progressDelta.opened < 0 ||
      !Number.isInteger(branch.progressDelta.previousOpenCount) || !Number.isInteger(branch.progressDelta.currentOpenCount) ||
      typeof branch.progressDelta.setDecreased !== 'boolean' || typeof branch.progressDelta.strongerRed !== 'boolean') {
      violations.push(`${prefix}.progressDelta must be a valid progress object`);
    }
    if (branch.generationArtifact !== undefined &&
      (!hasExactKeys(branch.generationArtifact, ['path', 'sha256']) ||
       !isNonBlank(branch.generationArtifact.path) || !isSha256(branch.generationArtifact.sha256))) {
      violations.push(`${prefix}.generationArtifact must contain exactly path and sha256`);
    }
    if (branch.state !== CLOSED_STATE && openFindings.length < 1) {
      violations.push(`${prefix}.openFindings must contain at least one open finding`);
    }
    if (branch.state === HUMAN_STATE) {
      if (!HUMAN_CLASSIFICATIONS.has(branch.classification)) violations.push(`${prefix}.classification must require a human gate`);
      if (branch.nextTask !== null) violations.push(`${prefix}.nextTask must be null for HUMAN_GATE`);
      if (!isObject(branch.humanGate) || !isNonBlank(branch.humanGate.decisionNeeded) ||
          !Array.isArray(branch.humanGate.proofs) || branch.humanGate.proofs.length < 1 ||
          !branch.humanGate.proofs.every(proof => isObject(proof) && Object.values(proof).some(isNonBlank))) {
        violations.push(`${prefix}.humanGate must name a proof-backed decision for HUMAN_GATE`);
      }
    } else if (branch.state === CLOSED_STATE) {
      if (openFindings.length !== 0 || branch.nextTask !== null || branch.humanGate !== null || closedFindings.length < 1) {
        violations.push(`${prefix} CLOSED requires closed proof evidence, empty openFindings, and null nextTask/humanGate`);
      }
    } else if (AUTOMATIC_STATES.has(branch.state)) {
      if (!AUTOMATIC_CLASSIFICATIONS.has(branch.classification)) violations.push(`${prefix}.classification must be technical or evidence-deficient`);
      if (!hasExactKeys(branch.nextTask, ['taskId', 'kind', 'status']) ||
          !isNonBlank(branch.nextTask.taskId) || !isNonBlank(branch.nextTask.kind) || !isNonBlank(branch.nextTask.status)) {
        violations.push(`${prefix}.nextTask must have exactly taskId, kind, and status for automatic branch`);
      }
      if (branch.humanGate !== null) violations.push(`${prefix}.humanGate must be null for automatic branch`);
    }
  }
  return { valid: violations.length === 0, violations };
}

function migrateStateV2(state, diagnosticRecovery) {
  if (!isObject(state) || state.$schema !== 'soma-state/v2') throw new TypeError('migrateStateV2 requires soma-state/v2');
  return { ...state, $schema: 'soma-state/v3', diagnosticRecovery };
}

function semanticGeneration(branch) {
  const semanticProofs = branch.proofs.map(({ kind, sha256 }) => ({ kind, sha256 }));
  const humanGate = branch.humanGate === null ? null : {
    decisionNeeded: branch.humanGate.decisionNeeded,
    proofs: branch.humanGate.proofs.map(proof => ({ ...proof, path: undefined })),
  };
  return {
    branchId: branch.branchId, generation: branch.generation, state: branch.state,
    classification: branch.classification, fingerprint: branch.fingerprint, boundary: branch.boundary,
    candidate: branch.candidate, proofs: semanticProofs, closedFindings: branch.closedFindings,
    openFindings: branch.openFindings, fingerprintHistory: branch.fingerprintHistory,
    dependencyClosure: branch.dependencyClosure, reviewPlan: branch.reviewPlan,
    transitionKey: branch.transitionKey, nextTask: branch.nextTask, humanGate,
    executorRotation: branch.executorRotation, progressDelta: branch.progressDelta,
  };
}

function safeRunId(runId) {
  return isNonBlank(runId) && runId !== '.' && runId !== '..' &&
    !runId.includes('/') && !runId.includes('\\') && !runId.includes('\0') &&
    path.basename(runId) === runId;
}

function readReferencedGeneration({ projectRoot, runId, branch }) {
  const reference = branch.generationArtifact;
  if (reference === undefined) return;
  const filename = `${String(branch.generation).padStart(4, '0')}.json`;
  const expectedRelative = path.join('.soma', 'recovery', runId, filename);
  if (!isObject(reference) || reference.path !== expectedRelative || path.isAbsolute(reference.path)) {
    throw codedError('RECOVERY_REFERENCE_PATH_INVALID', reference && reference.path);
  }

  const realProjectRoot = fs.realpathSync(projectRoot);
  const components = ['.soma', 'recovery', runId, filename];
  let cursor = realProjectRoot;
  for (const component of components) {
    cursor = path.join(cursor, component);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (err) {
      throw codedError('RECOVERY_REFERENCE_READ_FAILED', err.message);
    }
    if (stat.isSymbolicLink()) throw codedError('RECOVERY_REFERENCE_SYMLINK', cursor);
  }
  const recoveryRoot = fs.realpathSync(path.join(realProjectRoot, '.soma', 'recovery', runId));
  const realFile = fs.realpathSync(cursor);
  if (path.dirname(realFile) !== recoveryRoot) throw codedError('RECOVERY_REFERENCE_PATH_INVALID', reference.path);

  let fd;
  let bytes;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    fd = fs.openSync(cursor, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw codedError('RECOVERY_REFERENCE_NOT_REGULAR', reference.path);
    bytes = fs.readFileSync(fd);
  } catch (err) {
    if (err.message && err.message.startsWith('RECOVERY_REFERENCE_')) throw err;
    throw codedError(err.code === 'ELOOP' ? 'RECOVERY_REFERENCE_SYMLINK' : 'RECOVERY_REFERENCE_READ_FAILED', err.message);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (sha256Hex(bytes) !== reference.sha256) throw codedError('RECOVERY_REFERENCE_BYTES_SHA_MISMATCH');

  let envelope;
  try { envelope = JSON.parse(bytes.toString('utf8')); } catch (err) {
    throw codedError('RECOVERY_REFERENCE_ENVELOPE_INVALID', err.message);
  }
  if (!isObject(envelope) || envelope.$schema !== 'soma-recovery-generation/v1' ||
      !isSha256(envelope.semanticSha256) || !Number.isInteger(envelope.generation) ||
      envelope.generation < 1 || !isObject(envelope.recovery)) {
    throw codedError('RECOVERY_REFERENCE_ENVELOPE_INVALID');
  }
  if (envelope.generation !== branch.generation || envelope.recovery.generation !== branch.generation) {
    throw codedError('RECOVERY_REFERENCE_GENERATION_MISMATCH');
  }
  let projectedArtifact;
  try { projectedArtifact = projectPersistentBranch(envelope.recovery); } catch (err) {
    throw codedError('RECOVERY_REFERENCE_ENVELOPE_INVALID', err.message);
  }
  if (Object.keys(projectedArtifact).length !== Object.keys(envelope.recovery).length) {
    throw codedError('RECOVERY_REFERENCE_ENVELOPE_INVALID');
  }
  const semanticSha256 = sha256Hex(canonicalJson(semanticGeneration(envelope.recovery)));
  if (semanticSha256 !== envelope.semanticSha256) throw codedError('RECOVERY_REFERENCE_SEMANTIC_SHA_MISMATCH');
  const stateProjection = projectPersistentBranch(branch);
  if (canonicalJson(stateProjection) !== canonicalJson(envelope.recovery)) {
    throw codedError('RECOVERY_REFERENCE_STATE_MISMATCH');
  }
}

function readStateV3({ projectRoot, runId }) {
  if (!safeRunId(runId)) throw codedError('RECOVERY_REFERENCE_RUN_ID_INVALID');
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);
  let state;
  try { state = JSON.parse(fs.readFileSync(runStateFile, 'utf8')); } catch (err) { throw new Error(`cannot read v3 state: ${err.message}`); }
  if (state.runId !== runId) throw codedError('RECOVERY_STATE_RUN_ID_MISMATCH');
  const result = validateStateV3(state);
  if (!result.valid) throw new Error(`invalid soma-state/v3: ${result.violations.join('; ')}`);
  for (const branch of state.diagnosticRecovery.branches) {
    readReferencedGeneration({ projectRoot, runId, branch });
  }
  return state;
}

function syncFile(file) { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function syncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

function atomicReplace(file, bytes) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  try {
    syncFile(temp);
    fs.renameSync(temp, file);
    syncDir(dir);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch (_ignored) {}
    throw err;
  }
}

function installNoClobber(target, bytes, beforeInstall) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  try {
    syncFile(temp);
    if (typeof beforeInstall === 'function') beforeInstall();
    fs.linkSync(temp, target);
    syncDir(dir);
    fs.unlinkSync(temp);
    syncDir(dir);
    return true;
  } catch (err) {
    try { fs.unlinkSync(temp); } catch (_ignored) {}
    if (err && err.code === 'EEXIST') return false;
    throw err;
  }
}

function installImmutableNoClobber(target, bytes, beforeInstall) {
  if (!installNoClobber(target, bytes, beforeInstall)) throw new Error(`immutable generation exists: ${target}`);
}

function rejectExistingSymlinkComponents(projectRoot, components, code) {
  let cursor = fs.realpathSync(projectRoot);
  for (const component of components) {
    cursor = path.join(cursor, component);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw codedError(code, err.message);
    }
    if (stat.isSymbolicLink()) throw codedError(code, `symlink rejected: ${cursor}`);
  }
}

function readRegularNoFollow(projectRoot, file, relativeComponents, code) {
  rejectExistingSymlinkComponents(projectRoot, relativeComponents, code);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!fs.fstatSync(fd).isFile()) throw codedError(code, `not a regular file: ${file}`);
    return fs.readFileSync(fd);
  } catch (err) {
    if (err.message && err.message.startsWith(`${code}:`)) throw err;
    throw codedError(code, err.message);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parseAndValidateStateBytes(bytes, runId, code) {
  let state;
  try { state = JSON.parse(bytes.toString('utf8')); } catch (err) { throw codedError(code, err.message); }
  const valid = validateStateV3(state);
  if (!valid.valid) throw codedError(code, valid.violations.join('; '));
  if (state.runId !== runId) throw codedError('RECOVERY_STATE_RUN_ID_MISMATCH');
  return state;
}

function mutationContext(projectRoot, runId) {
  if (!safeRunId(runId)) throw codedError('RECOVERY_STATE_RUN_ID_INVALID');
  const realProjectRoot = fs.realpathSync(projectRoot);
  const paths = resolveSomaPaths(realProjectRoot, runId);
  const stateComponents = ['.soma', `run-state-${runId}.json`];
  const stateBytes = readRegularNoFollow(
    realProjectRoot, paths.runStateFile, stateComponents, 'RECOVERY_STATE_READ_FAILED'
  );
  const state = parseAndValidateStateBytes(stateBytes, runId, 'RECOVERY_STATE_INVALID');
  for (const branch of state.diagnosticRecovery.branches) {
    readReferencedGeneration({ projectRoot: realProjectRoot, runId, branch });
  }
  return { projectRoot: realProjectRoot, paths, stateBytes, state, stateSha256: sha256Hex(stateBytes) };
}

function exactGenerationReference(reference) {
  return reference === null ||
    (hasExactKeys(reference, ['path', 'sha256']) && isNonBlank(reference.path) && isSha256(reference.sha256));
}

function verifyGenerationReference(projectRoot, runId, reference) {
  if (!exactGenerationReference(reference)) throw codedError('STATE_CAS_GENERATION_REFERENCE_INVALID');
  if (reference === null) return;
  const expectedPrefix = path.join('.soma', 'recovery', runId) + path.sep;
  if (path.isAbsolute(reference.path) || path.normalize(reference.path) !== reference.path ||
      !reference.path.startsWith(expectedPrefix)) {
    throw codedError('STATE_CAS_GENERATION_REFERENCE_INVALID', reference.path);
  }
  const components = reference.path.split(path.sep);
  const file = path.join(fs.realpathSync(projectRoot), ...components);
  const bytes = readRegularNoFollow(projectRoot, file, components, 'STATE_CAS_GENERATION_REFERENCE_INVALID');
  if (sha256Hex(bytes) !== reference.sha256) throw codedError('STATE_CAS_GENERATION_REFERENCE_INVALID', 'sha256 mismatch');
}

function stateCasLayout(context, expectedStateSha256, nextStateSha256) {
  const relativeRoot = path.join('.soma', 'recovery', context.state.runId, '.state-cas');
  const nextStatePath = path.join(relativeRoot, 'states', `${nextStateSha256}.json`);
  return {
    claimPath: path.join(context.projectRoot, relativeRoot, `${expectedStateSha256}.json`),
    nextStatePath,
    absoluteNextStatePath: path.join(context.projectRoot, nextStatePath),
  };
}

function expectedClaim({ runId, expectedStateSha256, nextStateSha256, nextStatePath, generationReference }) {
  return {
    $schema: 'soma-state-cas/v1',
    runId,
    expectedStateSha256,
    nextStateSha256,
    nextStateReference: { path: nextStatePath, sha256: nextStateSha256 },
    generationReference,
  };
}

function validClaimShape(context, claim, expectedStateSha256) {
  if (!hasExactKeys(claim, [
    '$schema', 'runId', 'expectedStateSha256', 'nextStateSha256',
    'nextStateReference', 'generationReference',
  ]) || claim.$schema !== 'soma-state-cas/v1' || claim.runId !== context.state.runId ||
      claim.expectedStateSha256 !== expectedStateSha256 || !isSha256(claim.nextStateSha256) ||
      !hasExactKeys(claim.nextStateReference, ['path', 'sha256']) ||
      claim.nextStateReference.sha256 !== claim.nextStateSha256 ||
      !exactGenerationReference(claim.generationReference)) {
    return false;
  }
  return claim.nextStateReference.path ===
    stateCasLayout(context, expectedStateSha256, claim.nextStateSha256).nextStatePath;
}

function verifyInstalledClaim(context, claim, claimBytes, intendedClaimBytes, nextStateBytes) {
  if (!claimBytes.equals(intendedClaimBytes)) throw codedError('STATE_CAS_CONFLICT');
  if (!validClaimShape(context, claim, claim.expectedStateSha256)) {
    throw codedError('STATE_CAS_MISMATCH', 'invalid installed claim');
  }
  const components = claim.nextStateReference.path.split(path.sep);
  const installedBytes = readRegularNoFollow(
    context.projectRoot,
    path.join(context.projectRoot, claim.nextStateReference.path),
    components,
    'STATE_CAS_MISMATCH'
  );
  if (sha256Hex(installedBytes) !== claim.nextStateSha256 || !installedBytes.equals(nextStateBytes)) {
    throw codedError('STATE_CAS_MISMATCH', 'immutable next-state bytes differ');
  }
  verifyGenerationReference(context.projectRoot, context.state.runId, claim.generationReference);
}

function mutateRunStateCas({ projectRoot, runId, expectedStateSha256, nextStateBytes,
  generationReference = null, fault }) {
  if (!safeRunId(runId)) throw codedError('RECOVERY_STATE_RUN_ID_INVALID');
  if (!isSha256(expectedStateSha256)) throw new TypeError('expectedStateSha256 must be a sha256');
  if (!exactGenerationReference(generationReference)) throw codedError('STATE_CAS_GENERATION_REFERENCE_INVALID');
  if (!(Buffer.isBuffer(nextStateBytes) || nextStateBytes instanceof Uint8Array || typeof nextStateBytes === 'string')) {
    throw new TypeError('nextStateBytes must be exact bytes');
  }

  const exactNextStateBytes = Buffer.from(nextStateBytes);
  const nextState = parseAndValidateStateBytes(exactNextStateBytes, runId, 'RECOVERY_STATE_INVALID');
  const context = mutationContext(projectRoot, runId);
  const nextStateSha256 = sha256Hex(exactNextStateBytes);
  const layout = stateCasLayout(context, expectedStateSha256, nextStateSha256);
  const claim = expectedClaim({
    runId, expectedStateSha256, nextStateSha256,
    nextStatePath: layout.nextStatePath, generationReference,
  });
  const claimBytes = Buffer.from(canonicalJson(claim));

  verifyGenerationReference(context.projectRoot, runId, generationReference);
  rejectExistingSymlinkComponents(
    context.projectRoot,
    ['.soma', 'recovery', runId, '.state-cas'],
    'STATE_CAS_PATH_INVALID'
  );

  let existingClaimBytes = null;
  try {
    existingClaimBytes = readRegularNoFollow(
      context.projectRoot,
      layout.claimPath,
      path.relative(context.projectRoot, layout.claimPath).split(path.sep),
      'STATE_CAS_PATH_INVALID'
    );
  } catch (err) {
    if (!err || !/STATE_CAS_PATH_INVALID: ENOENT:/.test(err.message)) throw err;
  }
  if (existingClaimBytes !== null && !existingClaimBytes.equals(claimBytes)) {
    throw codedError('STATE_CAS_CONFLICT');
  }
  if (existingClaimBytes === null && context.stateSha256 !== expectedStateSha256) {
    throw codedError('STATE_CAS_MISMATCH');
  }

  let ownsClaim = false;
  if (existingClaimBytes === null) {
    const installedState = installNoClobber(layout.absoluteNextStatePath, exactNextStateBytes);
    if (!installedState) {
      const installedBytes = readRegularNoFollow(
        context.projectRoot,
        layout.absoluteNextStatePath,
        layout.nextStatePath.split(path.sep),
        'STATE_CAS_MISMATCH'
      );
      if (!installedBytes.equals(exactNextStateBytes)) throw codedError('STATE_CAS_CONFLICT');
    }
    if (fault && typeof fault['before-state-cas'] === 'function') fault['before-state-cas']();
    ownsClaim = installNoClobber(layout.claimPath, claimBytes);
    existingClaimBytes = ownsClaim ? claimBytes : fs.readFileSync(layout.claimPath);
  }

  let installedClaim;
  try { installedClaim = JSON.parse(existingClaimBytes.toString('utf8')); } catch (err) {
    throw codedError('STATE_CAS_CONFLICT', err.message);
  }
  verifyInstalledClaim(context, installedClaim, existingClaimBytes, claimBytes, exactNextStateBytes);

  if (ownsClaim && fault === 'after-state-claim-install') {
    throw new Error('INJECTED after-state-claim-install');
  }
  if (ownsClaim && fault && typeof fault['after-state-claim-install'] === 'function') {
    fault['after-state-claim-install']();
  }

  const canonicalBytes = readRegularNoFollow(
    context.projectRoot,
    context.paths.runStateFile,
    ['.soma', `run-state-${runId}.json`],
    'STATE_CAS_MISMATCH'
  );
  const canonicalSha256 = sha256Hex(canonicalBytes);
  let adopted = !ownsClaim;
  let recovered = !ownsClaim;
  if (canonicalSha256 === expectedStateSha256) {
    atomicReplace(context.paths.runStateFile, exactNextStateBytes);
  } else if (canonicalSha256 === nextStateSha256) {
    adopted = true;
  } else {
    throw codedError('STATE_CAS_MISMATCH');
  }

  return { state: nextState, stateSha256: nextStateSha256, adopted, recovered };
}

function installedClaimForExpected(context, expectedStateSha256) {
  const relativeRoot = path.join('.soma', 'recovery', context.state.runId, '.state-cas');
  const claimPath = path.join(context.projectRoot, relativeRoot, `${expectedStateSha256}.json`);
  let bytes;
  try {
    bytes = readRegularNoFollow(
      context.projectRoot,
      claimPath,
      path.relative(context.projectRoot, claimPath).split(path.sep),
      'STATE_CAS_PATH_INVALID'
    );
  } catch (err) {
    if (err && /STATE_CAS_PATH_INVALID: ENOENT:/.test(err.message)) return null;
    throw err;
  }
  let claim;
  try { claim = JSON.parse(bytes.toString('utf8')); } catch (err) { throw codedError('STATE_CAS_CONFLICT', err.message); }
  return { claim, bytes };
}

function publishRecoveryGeneration({ projectRoot, runId, expectedStateSha256, generation, fault }) {
  if (!safeRunId(runId)) throw codedError('RECOVERY_STATE_RUN_ID_INVALID');
  if (!isSha256(expectedStateSha256)) throw new TypeError('expectedStateSha256 must be a sha256');
  if (!isObject(generation) || !Number.isInteger(generation.generation) || generation.generation < 1 || !isString(generation.branchId)) {
    throw new TypeError('generation requires branchId and positive integer generation');
  }
  const candidateBranch = projectPersistentBranch(generation);
  const paths = resolveSomaPaths(projectRoot, runId);
  const filename = `${String(generation.generation).padStart(4, '0')}.json`;
  const absoluteGenerationPath = path.join(paths.runRecoveryDir, filename);
  const generationPath = path.join('.soma', 'recovery', runId, filename);
  const semanticSha256 = sha256Hex(canonicalJson(semanticGeneration(candidateBranch)));
  const published = {
    $schema: 'soma-recovery-generation/v1', semanticSha256,
    generation: generation.generation, recovery: candidateBranch,
  };
  const generationBytes = canonicalJson(published);
  const generationSha256 = sha256Hex(generationBytes);
  const generationReference = { path: generationPath, sha256: generationSha256 };
  const context = mutationContext(projectRoot, runId);
  const { state } = context;
  const existingClaim = installedClaimForExpected(context, expectedStateSha256);
  if (existingClaim &&
      (!validClaimShape(context, existingClaim.claim, expectedStateSha256) ||
       canonicalJson(existingClaim.claim.generationReference) !== canonicalJson(generationReference))) {
    throw codedError('STATE_CAS_CONFLICT');
  }

  if (context.stateSha256 !== expectedStateSha256) {
    if (!existingClaim || !isObject(existingClaim.claim.nextStateReference)) throw codedError('STATE_CAS_MISMATCH');
    const claimedPath = existingClaim.claim.nextStateReference.path;
    if (!isNonBlank(claimedPath) || path.isAbsolute(claimedPath)) throw codedError('STATE_CAS_MISMATCH');
    const claimedBytes = readRegularNoFollow(
      context.projectRoot,
      path.join(context.projectRoot, claimedPath),
      claimedPath.split(path.sep),
      'STATE_CAS_MISMATCH'
    );
    const claimedState = parseAndValidateStateBytes(claimedBytes, runId, 'STATE_CAS_MISMATCH');
    const claimedBranch = claimedState.diagnosticRecovery.branches.find(item => item.branchId === candidateBranch.branchId);
    if (!claimedBranch || canonicalJson(projectPersistentBranch(claimedBranch)) !== canonicalJson(candidateBranch) ||
        canonicalJson(claimedBranch.generationArtifact) !== canonicalJson(generationReference)) {
      throw codedError('STATE_CAS_CONFLICT');
    }
    const cas = mutateRunStateCas({
      projectRoot, runId, expectedStateSha256, nextStateBytes: claimedBytes, generationReference, fault,
    });
    return { generationPath, generationSha256, semanticSha256, ...cas, adopted: true };
  }

  const branch = state.diagnosticRecovery.branches.find(item => item.branchId === generation.branchId);
  if (!branch) throw new Error(`unknown recovery branch: ${generation.branchId}`);
  const candidateState = {
    ...state,
    diagnosticRecovery: {
      ...state.diagnosticRecovery,
      branches: state.diagnosticRecovery.branches.map(item => item.branchId === generation.branchId ? candidateBranch : item),
    },
  };
  const candidateValidation = validateStateV3(candidateState);
  if (!candidateValidation.valid) throw new Error(`invalid supplied recovery generation: ${candidateValidation.violations.join('; ')}`);

  let adopted = false;
  if (fs.existsSync(absoluteGenerationPath)) {
    if (fs.lstatSync(absoluteGenerationPath).isSymbolicLink()) throw new Error('existing generation symlink rejected');
    let existing;
    try { existing = JSON.parse(fs.readFileSync(absoluteGenerationPath, 'utf8')); } catch (_err) { throw new Error('existing immutable generation is unreadable'); }
    if (existing.semanticSha256 !== semanticSha256) throw new Error('existing generation semantic hash differs; immutable orphan rejected');
    if (sha256Hex(fs.readFileSync(absoluteGenerationPath)) !== generationSha256) throw new Error('existing generation bytes differ; immutable orphan rejected');
    adopted = true;
  } else {
    installImmutableNoClobber(absoluteGenerationPath, generationBytes, fault && fault['before-generation-install']);
  }
  if (fault === 'after-generation-rename') throw new Error('INJECTED after-generation-rename');

  const nextBranch = { ...candidateBranch, generationArtifact: generationReference };
  const nextState = {
    ...state,
    diagnosticRecovery: {
      ...state.diagnosticRecovery,
      branches: state.diagnosticRecovery.branches.map(item => item.branchId === branch.branchId ? nextBranch : item),
    },
  };
  const nextStateBytes = Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`);
  const cas = mutateRunStateCas({
    projectRoot, runId, expectedStateSha256, nextStateBytes, generationReference, fault,
  });
  return { generationPath, generationSha256, semanticSha256, ...cas, adopted: adopted || cas.adopted };
}

module.exports = {
  validateStateV3, migrateStateV2, readStateV3, publishRecoveryGeneration,
  mutateRunStateCas, projectPersistentBranch,
};
