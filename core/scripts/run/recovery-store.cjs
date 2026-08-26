'use strict';

/** Durable, content-addressed publication for soma-state/v3 recovery branches. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256Hex } = require('./recovery-model.cjs');
const { resolveSomaPaths } = require('./paths.cjs');

const AUTOMATIC_STATES = new Set(['RED_PENDING', 'GREEN_PENDING', 'REVIEW_PENDING', 'CORRECTION_PENDING']);
const HUMAN_STATE = 'HUMAN_GATE';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = value => typeof value === 'string' && value.length > 0;

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
  for (const key of ['runId', 'sessionId', 'startedAt', 'currentState', 'lastTransitionAt']) {
    if (!isString(state[key])) violations.push(`${key} must be a non-empty string`);
  }
  for (const key of ['activeDispatchIds', 'snapshots', 'decisions', 'reports']) {
    if (!Array.isArray(state[key])) violations.push(`${key} must be an array`);
  }
  if (!isObject(state.failureCountsByStep)) violations.push('failureCountsByStep must be an object');
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
    if (!Number.isInteger(branch.generation) || branch.generation < 1) violations.push(`${prefix}.generation must be a positive integer`);
    for (const key of ['candidate', 'reviewPlan', 'executorRotation', 'progressDelta']) {
      if (!isObject(branch[key])) violations.push(`${prefix}.${key} must be an object`);
    }
    for (const key of ['proofs', 'openFindings', 'fingerprintHistory', 'dependencyClosure']) {
      if (!Array.isArray(branch[key])) violations.push(`${prefix}.${key} must be an array`);
    }
    if (!Array.isArray(branch.closedFindings)) violations.push(`${prefix}.closedFindings must be an array`);
    if (!isObject(branch.reviewPlan) || !Array.isArray(branch.reviewPlan.declaredRisks)) {
      violations.push(`${prefix}.reviewPlan.declaredRisks must be an array`);
    }
    if (branch.state === HUMAN_STATE) {
      if (branch.nextTask !== null) violations.push(`${prefix}.nextTask must be null for HUMAN_GATE`);
      if (!isObject(branch.humanGate) || !isString(branch.humanGate.decisionNeeded) || !Array.isArray(branch.humanGate.proofs)) {
        violations.push(`${prefix}.humanGate must name a decision and proofs for HUMAN_GATE`);
      }
    } else if (AUTOMATIC_STATES.has(branch.state) || branch.state !== HUMAN_STATE) {
      if (!isObject(branch.nextTask)) violations.push(`${prefix}.nextTask must be an object for automatic branch`);
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

function stripTransient(value) {
  if (Array.isArray(value)) return value.map(stripTransient);
  if (!isObject(value)) return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(generationArtifact|dispatchHistory|path)$/i.test(key) || /prompt|output|time|date/i.test(key)) continue;
    clean[key] = stripTransient(item);
  }
  return clean;
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
  const semanticPayload = stripTransient(generation);
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
    atomicWrite(absoluteGenerationPath, generationBytes);
  }
  if (fault === 'after-generation-rename') throw new Error('INJECTED after-generation-rename');
  const nextBranch = { ...branch, generationArtifact: { path: generationPath, sha256: generationSha256 } };
  const nextState = {
    ...state,
    diagnosticRecovery: { ...state.diagnosticRecovery, branches: state.diagnosticRecovery.branches.map(item => item.branchId === branch.branchId ? nextBranch : item) },
  };
  atomicWrite(paths.runStateFile, JSON.stringify(nextState, null, 2) + '\n');
  return { generationPath, generationSha256, semanticSha256, adopted, state: nextState };
}

module.exports = { validateStateV3, migrateStateV2, readStateV3, publishRecoveryGeneration };
