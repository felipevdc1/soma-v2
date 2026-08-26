'use strict';

/** Durable, content-addressed publication for soma-state/v3 recovery branches. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256Hex } = require('./recovery-model.cjs');
const { resolveSomaPaths } = require('./paths.cjs');

const AUTOMATIC_STATES = new Set(['RED_PENDING', 'GREEN_PENDING', 'REVIEW_PENDING', 'CORRECTION_PENDING']);
const HUMAN_STATE = 'HUMAN_GATE';
const CLOSED_STATE = 'CLOSED';
const BRANCH_STATES = new Set([...AUTOMATIC_STATES, HUMAN_STATE, CLOSED_STATE]);
const CLASSIFICATIONS = new Set([
  'TECHNICAL_DETERMINISTIC', 'EVIDENCE_DEFICIENT', 'NORMATIVE_DECISION',
  'SCOPE_AUTHORITY', 'CONTRADICTORY_REQUIREMENTS', 'NO_PROGRESS',
]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = value => typeof value === 'string' && value.length > 0;
const isSha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isGitSha = value => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);

function invalid(violations) { return { valid: false, violations }; }

function validateStateV3(state) {
  const violations = [];
  if (!isObject(state)) return invalid(['state must be an object']);
  if (state.$schema !== 'soma-state/v3') violations.push('$schema must be soma-state/v3');
  for (const key of [
    'previousState', 'featureSlug', 'specPath', 'planPath', 'tasksPath', 'contractsDir',
    'teammateNamePrefix', 'constitutionVersion', 'constitutionSnapshotPath',
    'lastSuccessfulState', 'baselineSha', 'pausedDiagnostic',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) violations.push(`${key} must be present`);
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
    for (const key of ['branchId', 'state', 'classification', 'fingerprint', 'boundary', 'transitionKey']) {
      if (!isString(branch[key])) violations.push(`${prefix}.${key} must be a non-empty string`);
    }
    if (!BRANCH_STATES.has(branch.state)) violations.push(`${prefix}.state must be a documented branch state`);
    if (!CLASSIFICATIONS.has(branch.classification)) violations.push(`${prefix}.classification must be a documented classification`);
    if (!isSha256(branch.fingerprint)) violations.push(`${prefix}.fingerprint must be a sha256`);
    if (!Number.isInteger(branch.generation) || branch.generation < 1) violations.push(`${prefix}.generation must be a positive integer`);
    for (const key of ['candidate', 'reviewPlan', 'executorRotation', 'progressDelta']) {
      if (!isObject(branch[key])) violations.push(`${prefix}.${key} must be an object`);
    }
    for (const key of ['proofs', 'openFindings', 'fingerprintHistory', 'dependencyClosure']) {
      if (!Array.isArray(branch[key])) violations.push(`${prefix}.${key} must be an array`);
    }
    if (!Array.isArray(branch.closedFindings)) violations.push(`${prefix}.closedFindings must be an array`);
    if (!isObject(branch.reviewPlan) || !Array.isArray(branch.reviewPlan.declaredRisks) || !branch.reviewPlan.declaredRisks.every(isString)) {
      violations.push(`${prefix}.reviewPlan.declaredRisks must be an array`);
    }
    if (!isObject(branch.candidate) || !isGitSha(branch.candidate.sha) || typeof branch.candidate.preserved !== 'boolean') {
      violations.push(`${prefix}.candidate.sha must be a git sha and candidate.preserved must be boolean`);
    }
    for (const [proofIndex, proof] of (Array.isArray(branch.proofs) ? branch.proofs : []).entries()) {
      if (!isObject(proof) || !isString(proof.kind) || !isString(proof.path) || !isSha256(proof.sha256)) {
        violations.push(`${prefix}.proofs[${proofIndex}] must have kind, path, and sha256`);
      }
    }
    for (const [findingIndex, finding] of (Array.isArray(branch.openFindings) ? branch.openFindings : []).entries()) {
      if (!isObject(finding) || !isSha256(finding.fingerprint) || !isString(finding.requirementRef)) {
        violations.push(`${prefix}.openFindings[${findingIndex}] must have fingerprint and requirementRef`);
      }
    }
    for (const [findingIndex, finding] of (Array.isArray(branch.closedFindings) ? branch.closedFindings : []).entries()) {
      if (!isObject(finding) || !isSha256(finding.fingerprint) || !isString(finding.requirementRef)) {
        violations.push(`${prefix}.closedFindings[${findingIndex}] must have fingerprint and requirementRef`);
      }
    }
    if (!(Array.isArray(branch.fingerprintHistory) && branch.fingerprintHistory.every(isSha256))) {
      violations.push(`${prefix}.fingerprintHistory must contain sha256 values`);
    }
    if (!(Array.isArray(branch.dependencyClosure) && branch.dependencyClosure.every(isString))) {
      violations.push(`${prefix}.dependencyClosure must contain task ids`);
    }
    if (!isObject(branch.executorRotation) ||
      !Object.prototype.hasOwnProperty.call(branch.executorRotation, 'originalExecutor') ||
      !Object.prototype.hasOwnProperty.call(branch.executorRotation, 'rotatedExecutor') ||
      !Object.prototype.hasOwnProperty.call(branch.executorRotation, 'rotationsUsed') ||
      !Object.prototype.hasOwnProperty.call(branch.executorRotation, 'attemptsByExecutor') ||
      (branch.executorRotation.originalExecutor !== null && !isString(branch.executorRotation.originalExecutor)) ||
      (branch.executorRotation.rotatedExecutor !== null && !isString(branch.executorRotation.rotatedExecutor)) ||
      !Number.isInteger(branch.executorRotation.rotationsUsed) || branch.executorRotation.rotationsUsed < 0 ||
      !isObject(branch.executorRotation.attemptsByExecutor) ||
      !Object.values(branch.executorRotation.attemptsByExecutor).every(value => Number.isInteger(value) && value >= 0)) {
      violations.push(`${prefix}.executorRotation must be a valid rotation object`);
    }
    if (!isObject(branch.progressDelta) || !Number.isInteger(branch.progressDelta.closed) || branch.progressDelta.closed < 0 || !Number.isInteger(branch.progressDelta.opened) || branch.progressDelta.opened < 0 ||
      !Number.isInteger(branch.progressDelta.previousOpenCount) || !Number.isInteger(branch.progressDelta.currentOpenCount) ||
      typeof branch.progressDelta.setDecreased !== 'boolean' || typeof branch.progressDelta.strongerRed !== 'boolean') {
      violations.push(`${prefix}.progressDelta must be a valid progress object`);
    }
    if (branch.generationArtifact !== undefined &&
      (!isObject(branch.generationArtifact) || !isString(branch.generationArtifact.path) || !isSha256(branch.generationArtifact.sha256))) {
      violations.push(`${prefix}.generationArtifact must contain path and sha256`);
    }
    if (branch.state === HUMAN_STATE) {
      if (branch.nextTask !== null) violations.push(`${prefix}.nextTask must be null for HUMAN_GATE`);
      if (!isObject(branch.humanGate) || !isString(branch.humanGate.decisionNeeded) || !Array.isArray(branch.humanGate.proofs)) {
        violations.push(`${prefix}.humanGate must name a decision and proofs for HUMAN_GATE`);
      }
    } else if (branch.state === CLOSED_STATE) {
      if (branch.openFindings.length !== 0 || branch.nextTask !== null || branch.humanGate !== null) {
        violations.push(`${prefix} CLOSED requires empty openFindings and null nextTask/humanGate`);
      }
    } else if (AUTOMATIC_STATES.has(branch.state)) {
      if (!isObject(branch.nextTask) || !isString(branch.nextTask.taskId) || !isString(branch.nextTask.kind) || !isString(branch.nextTask.status)) {
        violations.push(`${prefix}.nextTask must have taskId, kind, and status for automatic branch`);
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

function readStateV3({ projectRoot, runId }) {
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);
  let state;
  try { state = JSON.parse(fs.readFileSync(runStateFile, 'utf8')); } catch (err) { throw new Error(`cannot read v3 state: ${err.message}`); }
  const result = validateStateV3(state);
  if (!result.valid) throw new Error(`invalid soma-state/v3: ${result.violations.join('; ')}`);
  return state;
}

function syncFile(file) { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function syncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomicWrite(file, bytes) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  syncFile(temp);
  fs.renameSync(temp, file);
  syncDir(dir);
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

function persistentGeneration(branch) {
  const { generationArtifact: _artifact, dispatchHistory: _history, ...persistent } = branch;
  return persistent;
}

function installImmutableNoClobber(target, bytes, beforeInstall) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  try {
    syncFile(temp);
    if (typeof beforeInstall === 'function') beforeInstall();
    fs.linkSync(temp, target); // link(2) installs only when target does not already exist
    syncDir(dir);
    fs.unlinkSync(temp);
    syncDir(dir);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch (_ignored) {}
    if (err && err.code === 'EEXIST') throw new Error(`immutable generation exists: ${target}`);
    throw err;
  }
}

function publishRecoveryGeneration({ projectRoot, runId, expectedStateSha256, generation, fault }) {
  const paths = resolveSomaPaths(projectRoot, runId);
  const stateBytes = fs.readFileSync(paths.runStateFile);
  const actualStateSha256 = sha256Hex(stateBytes);
  if (actualStateSha256 !== expectedStateSha256) throw new Error('state hash does not match expected prior state');
  const state = JSON.parse(stateBytes.toString('utf8'));
  const valid = validateStateV3(state);
  if (!valid.valid) throw new Error(`invalid soma-state/v3: ${valid.violations.join('; ')}`);
  if (!isObject(generation) || !Number.isInteger(generation.generation) || generation.generation < 1 || !isString(generation.branchId)) {
    throw new TypeError('generation requires branchId and positive integer generation');
  }
  const branch = state.diagnosticRecovery.branches.find(item => item.branchId === generation.branchId);
  if (!branch) throw new Error(`unknown recovery branch: ${generation.branchId}`);
  const candidateBranch = persistentGeneration(generation);
  const candidateState = {
    ...state,
    diagnosticRecovery: { ...state.diagnosticRecovery, branches: state.diagnosticRecovery.branches.map(item => item.branchId === generation.branchId ? candidateBranch : item) },
  };
  const candidateValidation = validateStateV3(candidateState);
  if (!candidateValidation.valid) throw new Error(`invalid supplied recovery generation: ${candidateValidation.violations.join('; ')}`);
  const semanticPayload = semanticGeneration(candidateBranch);
  const semanticSha256 = sha256Hex(canonicalJson(semanticPayload));
  const published = {
    $schema: 'soma-recovery-generation/v1',
    semanticSha256,
    generation: generation.generation,
    recovery: semanticPayload,
  };
  const generationBytes = canonicalJson(published);
  const generationSha256 = sha256Hex(generationBytes);
  const filename = `${String(generation.generation).padStart(4, '0')}.json`;
  const absoluteGenerationPath = path.join(paths.runRecoveryDir, filename);
  const generationPath = path.join('.soma', 'recovery', runId, filename);
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
  const nextBranch = { ...candidateBranch, generationArtifact: { path: generationPath, sha256: generationSha256 } };
  const nextState = {
    ...state,
    diagnosticRecovery: { ...state.diagnosticRecovery, branches: state.diagnosticRecovery.branches.map(item => item.branchId === branch.branchId ? nextBranch : item) },
  };
  atomicWrite(paths.runStateFile, JSON.stringify(nextState, null, 2) + '\n');
  return { generationPath, generationSha256, semanticSha256, adopted, state: nextState };
}

module.exports = { validateStateV3, migrateStateV2, readStateV3, publishRecoveryGeneration };
