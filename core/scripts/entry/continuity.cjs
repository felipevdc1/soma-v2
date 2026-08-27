'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256 } = require('../run/checkpoint.cjs');
const { handoffGenerations, verifyCheckpointInputs } = require('../run/handoff.cjs');
const { renderHandoffMarkdown, validateHandoff } = require('../run/handoff-schema.cjs');
const { resolveSomaPaths } = require('../run/paths.cjs');
const { safeRunId } = require('../run/run-id.cjs');

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function regularDirectories(parent) {
  try { return fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch (_) { return []; }
}

function resolveRun(projectRoot, requestedRunId) {
  const { handoffsDir } = resolveSomaPaths(projectRoot);
  if (requestedRunId !== null && requestedRunId !== undefined) {
    if (!safeRunId(requestedRunId) || !fs.existsSync(path.join(handoffsDir, requestedRunId))) {
      throw codedError('RESUME_NOT_FOUND', `no durable handoff exists for ${requestedRunId}`);
    }
    return requestedRunId;
  }
  const runs = regularDirectories(handoffsDir).filter(safeRunId).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  if (runs.length === 0) throw codedError('RESUME_NOT_FOUND', 'no durable handoff exists in this project');
  if (runs.length !== 1) throw codedError('RESUME_AMBIGUOUS', 'multiple durable runs exist; pass an explicit run ID');
  return runs[0];
}

function readLatestHandoff(projectRoot, runId) {
  const { runHandoffsDir } = resolveSomaPaths(projectRoot, runId);
  const generations = handoffGenerations(runHandoffsDir);
  if (generations.length === 0) throw codedError('RESUME_NOT_FOUND', `no durable handoff exists for ${runId}`);
  const generation = generations[generations.length - 1];
  const dir = path.join(runHandoffsDir, String(generation));
  const jsonPath = path.join(dir, 'handoff.json');
  const markdownPath = path.join(dir, 'handoff.md');
  let jsonBytes;
  let markdownBytes;
  try { jsonBytes = fs.readFileSync(jsonPath); markdownBytes = fs.readFileSync(markdownPath); }
  catch (_) { throw codedError('HANDOFF_INVALID', 'handoff generation pair is incomplete'); }
  let handoff;
  try { handoff = JSON.parse(jsonBytes); }
  catch (_) { throw codedError('HANDOFF_INVALID', 'handoff JSON is invalid'); }
  const validation = validateHandoff(handoff);
  if (!validation.valid || handoff.runId !== runId || handoff.generation !== generation ||
      jsonBytes.toString('utf8') !== canonicalJson(handoff) ||
      markdownBytes.toString('utf8') !== renderHandoffMarkdown(handoff)) {
    throw codedError('HANDOFF_INVALID', 'handoff generation is non-canonical or contradictory');
  }
  return { generation, handoff, jsonBytes, jsonPath, markdownBytes, markdownPath };
}

function verifyResume(projectRoot, record) {
  const checkpointPath = path.resolve(projectRoot, record.handoff.checkpoint.path);
  const expectedCheckpointRoot = resolveSomaPaths(projectRoot, record.handoff.runId).runCheckpointsDir;
  const relative = path.relative(expectedCheckpointRoot, checkpointPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw codedError('CHECKPOINT_INVALID', 'handoff checkpoint path escapes its run');
  const checkpointBytes = fs.readFileSync(checkpointPath);
  if (sha256(checkpointBytes) !== record.handoff.checkpoint.sha256) throw codedError('CHECKPOINT_DRIFT', 'checkpoint hash changed');
  let checkpoint;
  try { checkpoint = JSON.parse(checkpointBytes); } catch (_) { throw codedError('CHECKPOINT_INVALID', 'checkpoint is invalid JSON'); }
  if (checkpointBytes.toString('utf8') !== canonicalJson(checkpoint) ||
      checkpoint.runId !== record.handoff.runId || checkpoint.sequence !== record.handoff.checkpoint.sequence) {
    throw codedError('CHECKPOINT_INVALID', 'checkpoint is non-canonical or contradictory');
  }
  verifyCheckpointInputs(projectRoot, { checkpoint, checkpointPath, bytes: checkpointBytes, sequence: checkpoint.sequence, sha256: sha256(checkpointBytes) });
  const expectedHandoff = {
    ...record.handoff,
    blocker: checkpoint.blocker, commitProofs: checkpoint.commitProofs,
    currentState: checkpoint.currentState, dispatches: checkpoint.dispatches,
    git: checkpoint.git,
    lastCompletedTask: checkpoint.lastCompletedTask,
    nextDecision: checkpoint.nextDecision, nextTask: checkpoint.nextTask,
    proofs: checkpoint.proofs, runIdentity: checkpoint.runIdentity,
    runState: checkpoint.runState, tasks: checkpoint.tasks,
  };
  if (canonicalJson(expectedHandoff) !== canonicalJson(record.handoff)) throw codedError('HANDOFF_DRIFT', 'handoff facts contradict checkpoint');
  return checkpoint;
}

function writeAtomic(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, filePath);
}

function persistDrift(projectRoot, runId, error) {
  const { runResumeDiagnosticFile } = resolveSomaPaths(projectRoot, runId);
  const diagnostic = {
    $schema: 'soma-resume-drift/v1', code: error.code || 'RESUME_DRIFT',
    message: error.message, observedAt: new Date().toISOString(), runId,
  };
  writeAtomic(runResumeDiagnosticFile, Buffer.from(canonicalJson(diagnostic)));
  return diagnostic;
}

const LOCK_KEYS = [
  '$schema', 'executionScope', 'handoffGeneration', 'ownerPid', 'runId', 'sessionId', 'startedAt',
];
const LEGACY_LOCK_KEYS = ['runId', 'sessionId', 'startedAt'];
const PRIOR_LOCK_KEYS = [
  '$schema', 'executionScope', 'handoffGeneration', 'runId', 'sessionId', 'startedAt',
];
const CLAIM_KEYS = [
  '$schema', 'handoffGeneration', 'ownerPid', 'runId', 'sessionId', 'startedAt',
];

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function parseLock(bytes) {
  let value;
  try { value = JSON.parse(bytes); } catch (_) { return null; }
  if (exactKeys(value, LEGACY_LOCK_KEYS) && safeRunId(value.runId) &&
      typeof value.sessionId === 'string' && value.sessionId.length > 0 &&
      typeof value.startedAt === 'string') {
    return { kind: 'legacy', value };
  }
  if (exactKeys(value, PRIOR_LOCK_KEYS) && value.$schema === 'soma-run-lock/v1' &&
      safeRunId(value.runId) && typeof value.sessionId === 'string' && value.sessionId.length > 0 &&
      typeof value.startedAt === 'string' && typeof value.executionScope === 'string' &&
      value.executionScope.length > 0 && Number.isInteger(value.handoffGeneration) &&
      value.handoffGeneration >= 0) {
    return { kind: 'legacy-current', value };
  }
  if (exactKeys(value, LOCK_KEYS) && value.$schema === 'soma-run-lock/v1' &&
      safeRunId(value.runId) && typeof value.sessionId === 'string' && value.sessionId.length > 0 &&
      typeof value.startedAt === 'string' && typeof value.executionScope === 'string' &&
      value.executionScope.length > 0 && Number.isInteger(value.handoffGeneration) &&
      value.handoffGeneration >= 0 && Number.isSafeInteger(value.ownerPid) && value.ownerPid > 0) {
    return { kind: 'current', value };
  }
  return null;
}

function parseClaim(bytes) {
  let value;
  try { value = JSON.parse(bytes); } catch (_) { return null; }
  if (!exactKeys(value, CLAIM_KEYS) || value.$schema !== 'soma-run-lock-claim/v1' ||
      !safeRunId(value.runId) || typeof value.sessionId !== 'string' || value.sessionId.length === 0 ||
      typeof value.startedAt !== 'string' || !Number.isInteger(value.handoffGeneration) ||
      value.handoffGeneration < 0 || !Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 0) {
    return null;
  }
  return value;
}

function processAlive(pid, killProcess = process.kill) {
  try {
    killProcess(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'EPERM') return true;
    if (error && error.code === 'ESRCH') return false;
    throw error;
  }
}

function readExistingLock(lockPath) {
  let stat;
  try { stat = fs.lstatSync(lockPath); } catch (_) { return null; }
  if (stat.isSymbolicLink() || !stat.isFile()) return { bytes: null, parsed: null };
  const bytes = fs.readFileSync(lockPath);
  return { bytes, parsed: parseLock(bytes) };
}

function busyLock(runId, message) {
  return { status: 'busy', result: { status: 'RESUME_BUSY', retrySafe: true, runId, diagnostic: message } };
}

function readClaim(claimPath) {
  let stat;
  try { stat = fs.lstatSync(claimPath); } catch (_) { return null; }
  if (stat.isSymbolicLink() || !stat.isFile()) return { bytes: null, parsed: null };
  const bytes = fs.readFileSync(claimPath);
  return { bytes, parsed: parseClaim(bytes) };
}

function acquireReplacementClaim({ claimPath, claimTemporary, claimBytes, ownerPid, runId }) {
  try {
    fs.linkSync(claimTemporary, claimPath);
    return { status: 'acquired' };
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  }
  const existing = readClaim(claimPath);
  if (!existing || !existing.bytes || !existing.parsed) {
    return busyLock(runId, 'RUN_LOCK_BUSY: replacement claim is malformed');
  }
  if (existing.parsed.ownerPid !== ownerPid && processAlive(existing.parsed.ownerPid)) {
    return busyLock(runId, 'RUN_LOCK_BUSY: stale-lock replacement is owned by a live process');
  }
  const confirmed = readClaim(claimPath);
  if (!confirmed || !confirmed.bytes || !confirmed.bytes.equals(existing.bytes)) {
    return busyLock(runId, 'RUN_LOCK_BUSY: replacement claim changed during recovery');
  }
  try {
    fs.unlinkSync(claimPath);
    fs.linkSync(claimTemporary, claimPath);
    return { status: 'acquired' };
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EEXIST')) {
      return busyLock(runId, 'RUN_LOCK_BUSY: replacement claim changed during recovery');
    }
    throw error;
  }
}

function removeOwnedClaim(claimPath, claimBytes) {
  const current = readClaim(claimPath);
  if (current && current.bytes && current.bytes.equals(claimBytes)) fs.rmSync(claimPath, { force: true });
}

function acquireLock({ projectRoot, runId, sessionId, handoffGeneration, executionScope, ownerPid = process.ppid }) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    return busyLock(runId, 'RUN_LOCK_CONFLICT: ownerPid must be a positive safe integer');
  }
  const effectiveSessionId = sessionId || `pid-${process.ppid}`;
  const lock = {
    $schema: 'soma-run-lock/v1', executionScope, handoffGeneration, runId,
    ownerPid, sessionId: effectiveSessionId, startedAt: new Date().toISOString(),
  };
  const lockPath = path.join(projectRoot, '.soma.lock');
  const { diagnosticsDir, somaDir } = resolveSomaPaths(projectRoot);
  fs.mkdirSync(somaDir, { recursive: true });
  const temporary = path.join(somaDir, `.run-lock.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, canonicalJson(lock), { flag: 'wx' });
  let claimPath;
  let claimBytes;
  try {
    try {
      fs.linkSync(temporary, lockPath);
      return { status: 'acquired' };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }

    const existing = readExistingLock(lockPath);
    if (!existing || !existing.parsed || existing.parsed.value.runId !== runId) {
      return busyLock(runId, 'RUN_LOCK_CONFLICT: existing lock is malformed or belongs to another run');
    }
    if (existing.parsed.kind !== 'current') {
      return busyLock(runId, 'RUN_LOCK_CONFLICT: existing lock has no provable process owner');
    }
    const current = existing.parsed.value;
    if (current.handoffGeneration === handoffGeneration && current.sessionId === effectiveSessionId &&
        current.executionScope === executionScope && current.ownerPid === ownerPid) {
      return { status: 'idempotent' };
    }
    if (current.ownerPid !== ownerPid && processAlive(current.ownerPid)) {
      return busyLock(runId, 'RUN_LOCK_BUSY: another live process owns the run lock');
    }

    fs.mkdirSync(diagnosticsDir, { recursive: true });
    claimPath = path.join(diagnosticsDir, '.run-lock-replace.claim');
    const claim = {
      $schema: 'soma-run-lock-claim/v1', handoffGeneration, ownerPid, runId,
      sessionId: effectiveSessionId, startedAt: new Date().toISOString(),
    };
    claimBytes = Buffer.from(canonicalJson(claim));
    const claimTemporary = path.join(diagnosticsDir, `.run-lock-claim.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(claimTemporary, claimBytes, { flag: 'wx', mode: 0o600 });
    try {
      const claimResult = acquireReplacementClaim({ claimPath, claimTemporary, claimBytes, ownerPid, runId });
      if (claimResult.status === 'busy') return claimResult;
      const confirmed = readExistingLock(lockPath);
      if (!confirmed || !confirmed.bytes || !confirmed.bytes.equals(existing.bytes)) {
        return busyLock(runId, 'RUN_LOCK_BUSY: lock changed during stale-lock replacement');
      }
      fs.renameSync(temporary, lockPath);
      return { status: 'replaced' };
    } finally {
      fs.rmSync(claimTemporary, { force: true });
    }
  } catch (error) {
    return busyLock(runId, `RUN_LOCK_BUSY: ${error.message}`);
  } finally {
    if (claimPath && claimBytes) removeOwnedClaim(claimPath, claimBytes);
    fs.rmSync(temporary, { force: true });
  }
}

function resumeContinuity({ projectRoot, requestedRunId, sessionId, executionScope = projectRoot, ownerPid = process.ppid }) {
  let runId;
  try {
    runId = resolveRun(projectRoot, requestedRunId);
  } catch (error) {
    return { status: error.code, retrySafe: true, diagnostic: error.message };
  }
  try {
    const record = readLatestHandoff(projectRoot, runId);
    const checkpoint = verifyResume(projectRoot, record);
    const lock = acquireLock({
      projectRoot, runId, sessionId, executionScope, ownerPid,
      handoffGeneration: record.generation,
    });
    if (lock.status === 'busy') return lock.result;
    return {
      status: 'RESUME_READY', runId, reentryState: checkpoint.currentState,
      nextTask: checkpoint.nextTask, handoffGeneration: record.generation,
      executionScope,
    };
  } catch (error) {
    const diagnostic = persistDrift(projectRoot, runId, error);
    return { status: 'RESUME_DRIFT', retrySafe: true, runId, diagnostic: `${diagnostic.code}: ${diagnostic.message}` };
  }
}

module.exports = {
  acquireLock, parseClaim, parseLock, processAlive, readLatestHandoff, resolveRun, resumeContinuity, verifyResume,
};
