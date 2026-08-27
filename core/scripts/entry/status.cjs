'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256 } = require('../run/checkpoint.cjs');
const { renderHandoffMarkdown, validateHandoff } = require('../run/handoff-schema.cjs');
const { validateStateV3 } = require('../run/recovery-store.cjs');
const { safeRunId } = require('../run/run-id.cjs');

function diagnostic(state, message) {
  return { state, diagnostic: message };
}

function readRegular(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${filePath} is not a regular file`);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`${filePath} changed type`);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function validStateV2(state) {
  return state && state.$schema === 'soma-state/v2' && safeRunId(state.runId) &&
    typeof state.sessionId === 'string' && typeof state.startedAt === 'string' &&
    typeof state.currentState === 'string' && typeof state.lastTransitionAt === 'string' &&
    Array.isArray(state.activeDispatchIds) && state.failureCountsByStep &&
    Number.isFinite(state.fixLoopIterations) && Array.isArray(state.snapshots) &&
    state.humanGatesApproved && Array.isArray(state.decisions) && Array.isArray(state.reports);
}

function parseJsonRegular(filePath, label) {
  let value;
  try { value = JSON.parse(readRegular(filePath)); }
  catch (error) { throw new Error(`${label} is invalid: ${error.message}`); }
  return value;
}

function numericDirectories(parent) {
  let entries;
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[1-9][0-9]*$/.test(entry.name)) {
      throw new Error(`unexpected durable generation entry: ${entry.name}`);
    }
    result.push(Number(entry.name));
  }
  return result.sort((a, b) => a - b);
}

function exactRelative(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

function readIdentityFacts(projectRoot, runId) {
  const file = path.join(projectRoot, '.soma', 'run-identities', `${runId}.json`);
  const bytes = readRegular(file);
  let identity;
  try { identity = JSON.parse(bytes); }
  catch (error) { throw new Error(`run identity is invalid: ${error.message}`); }
  const canonical = `${JSON.stringify({ $schema: 'soma-run-identity/v1', runId }, null, 2)}\n`;
  if (identity.$schema !== 'soma-run-identity/v1' || identity.runId !== runId ||
      bytes.toString('utf8') !== canonical) {
    throw new Error('run identity is invalid');
  }
  return { bytes, path: exactRelative(projectRoot, file), sha256: sha256(bytes) };
}

function readHandoffFacts(projectRoot, runId, observedState, observedIdentity) {
  const parent = path.join(projectRoot, '.soma', 'handoffs', runId);
  const generations = numericDirectories(parent);
  if (generations.length === 0) return { checkpointSequence: null, handoffGeneration: null };
  const generation = generations.at(-1);
  const directory = path.join(parent, String(generation));
  const handoffPath = path.join(directory, 'handoff.json');
  const handoffBytes = readRegular(handoffPath);
  let handoff;
  try { handoff = JSON.parse(handoffBytes); }
  catch (error) { throw new Error(`handoff JSON is invalid: ${error.message}`); }
  const markdown = readRegular(path.join(directory, 'handoff.md')).toString('utf8');
  const validation = validateHandoff(handoff);
  if (!validation.valid || handoff.runId !== runId || handoff.generation !== generation ||
      handoffBytes.toString('utf8') !== canonicalJson(handoff) ||
      markdown !== renderHandoffMarkdown(handoff)) {
    throw new Error(`handoff is invalid: ${validation.violations.join('; ')}`);
  }
  const checkpointPath = path.resolve(projectRoot, handoff.checkpoint.path);
  const checkpointRoot = path.join(projectRoot, '.soma', 'checkpoints', runId);
  const relative = path.relative(checkpointRoot, checkpointPath);
  if (path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || relative === '..') {
    throw new Error('checkpoint path escapes its durable run');
  }
  const checkpointBytes = readRegular(checkpointPath);
  let checkpoint;
  try { checkpoint = JSON.parse(checkpointBytes); }
  catch (error) { throw new Error(`checkpoint is invalid: ${error.message}`); }
  if (checkpoint.$schema !== 'soma-checkpoint/v1' || checkpoint.runId !== runId ||
      checkpoint.sequence !== handoff.checkpoint.sequence ||
      sha256(checkpointBytes) !== handoff.checkpoint.sha256 ||
      checkpoint.currentState !== handoff.currentState || checkpoint.blocker !== handoff.blocker ||
      checkpoint.nextDecision !== handoff.nextDecision || checkpoint.nextTask !== handoff.nextTask ||
      checkpointBytes.toString('utf8') !== canonicalJson(checkpoint)) {
    throw new Error('checkpoint is invalid or contradicts the handoff');
  }
  const expectedStatePath = path.join(projectRoot, '.soma', `run-state-${runId}.json`);
  if (handoff.runState.path !== exactRelative(projectRoot, expectedStatePath) ||
      handoff.runState.sha256 !== sha256(observedState.bytes) ||
      handoff.currentState !== observedState.value.currentState) {
    throw new Error('run state hash, path or currentState contradicts the handoff');
  }
  if (handoff.runIdentity.path !== observedIdentity.path ||
      handoff.runIdentity.sha256 !== observedIdentity.sha256 ||
      sha256(observedIdentity.bytes) !== observedIdentity.sha256) {
    throw new Error('run identity hash or bytes contradict the handoff');
  }
  return {
    checkpointSequence: handoff.checkpoint.sequence, handoffGeneration: generation,
    blocker: handoff.blocker, nextDecision: handoff.nextDecision, nextTask: handoff.nextTask,
  };
}

function durableStatus(projectRoot) {
  const somaDir = path.join(projectRoot, '.soma');
  let entries;
  try { entries = fs.readdirSync(somaDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return { state: 'NO_DURABLE_RUN' };
    return diagnostic('DURABLE_STATUS_INVALID', `durable status is invalid: ${error.message}`);
  }
  const candidates = [];
  for (const entry of entries) {
    const match = /^run-state-(.+)\.json$/.exec(entry.name);
    if (!match) continue;
    if (!entry.isFile() || !safeRunId(match[1])) {
      return diagnostic('DURABLE_STATUS_INVALID', `durable run state is invalid: ${entry.name}`);
    }
    candidates.push({ file: path.join(somaDir, entry.name), runId: match[1] });
  }
  if (candidates.length === 0) return { state: 'NO_DURABLE_RUN' };
  if (candidates.length !== 1) {
    return diagnostic('DURABLE_STATUS_AMBIGUOUS', 'multiple durable run states exist; status will not guess');
  }
  try {
    const candidate = candidates[0];
    const stateBytes = readRegular(candidate.file);
    let state;
    try { state = JSON.parse(stateBytes); }
    catch (error) { throw new Error(`run state is invalid: ${error.message}`); }
    if (state.runId !== candidate.runId || !(validStateV2(state) || validateStateV3(state).valid)) {
      throw new Error('run state schema or identity is invalid');
    }
    const identity = readIdentityFacts(projectRoot, candidate.runId);
    const handoff = readHandoffFacts(projectRoot, candidate.runId, { bytes: stateBytes, value: state }, identity);
    return {
      runId: candidate.runId, currentState: state.currentState,
      checkpointSequence: handoff.checkpointSequence, handoffGeneration: handoff.handoffGeneration,
      blocker: handoff.blocker ?? state.pausedDiagnostic?.residualFinding ?? null,
      nextDecision: handoff.nextDecision ?? state.pausedDiagnostic?.nextDecision ?? null,
      nextTask: handoff.nextTask ?? null,
    };
  } catch (error) {
    return diagnostic('DURABLE_STATUS_INVALID', `durable status is invalid: ${error.message}`);
  }
}

module.exports = { durableStatus, readRegular };
