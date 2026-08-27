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
const GUARD_KEYS = [
  '$schema', 'guardPid', 'handoffGeneration', 'ownerPid', 'runId', 'sessionId',
];
const PRIVATE_NAME = /^(?:guard|lock)\.[1-9][0-9]*\.[a-f0-9]{12}\.tmp$/;
const TOMBSTONE_NAME = /^guard\.([1-9][0-9]*)\.[a-f0-9]{12}\.tombstone$/;
const TOMBSTONE_CLEANUP_LIMIT = 16;

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

function parseGuard(bytes) {
  let value;
  try { value = JSON.parse(bytes); } catch (_) { return null; }
  if (!exactKeys(value, GUARD_KEYS) || value.$schema !== 'soma-run-lock-guard/v1' ||
      !safeRunId(value.runId) || typeof value.sessionId !== 'string' || value.sessionId.length === 0 ||
      !Number.isInteger(value.handoffGeneration) || value.handoffGeneration < 0 ||
      !Number.isSafeInteger(value.guardPid) || value.guardPid <= 0 ||
      !Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 0) {
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
  try { stat = fs.lstatSync(lockPath); } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { bytes: null, parsed: null };
  const bytes = fs.readFileSync(lockPath);
  return { bytes, parsed: parseLock(bytes) };
}

function busyLock(runId, message) {
  return { status: 'busy', result: { status: 'RESUME_BUSY', retrySafe: true, runId, diagnostic: message } };
}

function readGuard(guardPath) {
  let stat;
  try { stat = fs.lstatSync(guardPath); } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { bytes: null, parsed: null };
  const bytes = fs.readFileSync(guardPath);
  return { bytes, parsed: parseGuard(bytes) };
}

function uniquePrivatePath(runtimeDir, kind, suffix) {
  const name = `${kind}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.${suffix}`;
  if ((suffix === 'tmp' && !PRIVATE_NAME.test(name)) ||
      (suffix === 'tombstone' && !TOMBSTONE_NAME.test(name))) {
    throw codedError('RUN_LOCK_PRIVATE_NAME_INVALID');
  }
  return path.join(runtimeDir, name);
}

function cleanupTombstones(runtimeDir) {
  let names;
  try {
    names = fs.readdirSync(runtimeDir).filter(name => {
      const match = TOMBSTONE_NAME.exec(name);
      return match && !processAlive(Number(match[1]));
    }).sort();
  }
  catch (_) { return; }
  for (const name of names.slice(0, TOMBSTONE_CLEANUP_LIMIT)) {
    fs.rmSync(path.join(runtimeDir, name), { force: true });
  }
}

function acquireGuard({ runtimeDir, runId, sessionId, ownerPid, handoffGeneration }) {
  const guard = {
    $schema: 'soma-run-lock-guard/v1', guardPid: process.pid,
    handoffGeneration, ownerPid, runId, sessionId,
  };
  const guardBytes = Buffer.from(canonicalJson(guard));
  const guardPath = path.join(runtimeDir, 'guard.json');
  const temporary = uniquePrivatePath(runtimeDir, 'guard', 'tmp');
  fs.writeFileSync(temporary, guardBytes, { flag: 'wx', mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.linkSync(temporary, guardPath);
        cleanupTombstones(runtimeDir);
        return { status: 'acquired', guardPath, guardBytes };
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
      }

      const existing = readGuard(guardPath);
      if (!existing || !existing.bytes || !existing.parsed) {
        return busyLock(runId, 'RUN_LOCK_BUSY: acquisition guard is malformed');
      }
      if (processAlive(existing.parsed.guardPid)) {
        return busyLock(runId, 'RUN_LOCK_BUSY: acquisition guard is owned by a live process');
      }
      if (attempt === 1) {
        return busyLock(runId, 'RUN_LOCK_BUSY: dead acquisition guard changed during recovery');
      }

      const confirmed = readGuard(guardPath);
      if (!confirmed || !confirmed.bytes || !confirmed.bytes.equals(existing.bytes)) continue;
      if (!confirmed.parsed || processAlive(confirmed.parsed.guardPid)) {
        return busyLock(runId, 'RUN_LOCK_BUSY: acquisition guard changed during recovery');
      }
      const tombstone = uniquePrivatePath(runtimeDir, 'guard', 'tombstone');
      try {
        fs.renameSync(guardPath, tombstone);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
    return busyLock(runId, 'RUN_LOCK_BUSY: acquisition guard could not be installed');
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function releaseGuard(guardPath, guardBytes) {
  const current = readGuard(guardPath);
  if (current && current.bytes && current.bytes.equals(guardBytes)) {
    fs.rmSync(guardPath, { force: true });
  }
}

function lockIsIdempotent(current, candidate) {
  return current.runId === candidate.runId && current.sessionId === candidate.sessionId &&
    current.ownerPid === candidate.ownerPid && current.executionScope === candidate.executionScope &&
    current.handoffGeneration === candidate.handoffGeneration;
}

function latestGenerationMatches(projectRoot, runId, handoffGeneration) {
  return readLatestHandoff(projectRoot, runId).generation === handoffGeneration;
}

function acquireLock({ projectRoot, runId, sessionId, handoffGeneration, executionScope, ownerPid }) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    return busyLock(runId, 'RUN_LOCK_CONFLICT: ownerPid must be a positive safe integer');
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return busyLock(runId, 'RUN_LOCK_CONFLICT: sessionId must be durable');
  }
  const lock = {
    $schema: 'soma-run-lock/v1', executionScope, handoffGeneration, runId,
    ownerPid, sessionId, startedAt: new Date().toISOString(),
  };
  const lockPath = path.join(projectRoot, '.soma.lock');
  const { diagnosticsDir } = resolveSomaPaths(projectRoot);
  const runtimeDir = path.join(diagnosticsDir, '.run-lock');
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const runtimeStat = fs.lstatSync(runtimeDir);
  if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) {
    return busyLock(runId, 'RUN_LOCK_CONFLICT: lock runtime is not a private directory');
  }
  fs.chmodSync(runtimeDir, 0o700);
  let guard;
  try {
    guard = acquireGuard({ runtimeDir, runId, sessionId, ownerPid, handoffGeneration });
    if (guard.status === 'busy') return guard;

    if (!latestGenerationMatches(projectRoot, runId, handoffGeneration)) {
      return busyLock(runId, 'RUN_LOCK_BUSY: durable handoff advanced during acquisition');
    }
    const existing = readExistingLock(lockPath);
    if (existing) {
      if (!existing.parsed || existing.parsed.value.runId !== runId) {
        return busyLock(runId, 'RUN_LOCK_CONFLICT: existing lock is malformed or belongs to another run');
      }
      if (existing.parsed.kind !== 'current') {
        return busyLock(runId, 'RUN_LOCK_CONFLICT: existing lock has no provable process owner');
      }
      const current = existing.parsed.value;
      if (lockIsIdempotent(current, lock)) return { status: 'idempotent' };
      const replacementAllowed =
        (current.ownerPid === ownerPid || !processAlive(current.ownerPid)) &&
        current.handoffGeneration <= handoffGeneration;
      if (!replacementAllowed) {
        return busyLock(runId, current.handoffGeneration > handoffGeneration
          ? 'RUN_LOCK_BUSY: existing lock has a newer handoff generation'
          : 'RUN_LOCK_BUSY: another live process owns the run lock');
      }
    }

    const temporary = uniquePrivatePath(runtimeDir, 'lock', 'tmp');
    const lockBytes = Buffer.from(canonicalJson(lock));
    fs.writeFileSync(temporary, lockBytes, { flag: 'wx', mode: 0o600 });
    try {
      if (!latestGenerationMatches(projectRoot, runId, handoffGeneration)) {
        return busyLock(runId, 'RUN_LOCK_BUSY: durable handoff advanced before publication');
      }
      if (!existing) {
        try {
          fs.linkSync(temporary, lockPath);
          return { status: 'acquired' };
        } catch (error) {
          if (error && error.code === 'EEXIST') {
            return busyLock(runId, 'RUN_LOCK_BUSY: lock appeared during initial publication');
          }
          throw error;
        }
      }
      const confirmed = readExistingLock(lockPath);
      if (!confirmed || !confirmed.bytes || !confirmed.bytes.equals(existing.bytes)) {
        return busyLock(runId, 'RUN_LOCK_BUSY: lock changed during stale-lock replacement');
      }
      fs.renameSync(temporary, lockPath);
      return { status: 'replaced' };
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  } catch (error) {
    return busyLock(runId, `RUN_LOCK_BUSY: ${error.message}`);
  } finally {
    if (guard && guard.status === 'acquired') releaseGuard(guard.guardPath, guard.guardBytes);
  }
}

function resumeContinuity({ projectRoot, requestedRunId, sessionId, executionScope = projectRoot, ownerPid }) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    return {
      status: 'RESUME_IDENTITY_REQUIRED', retrySafe: true,
      diagnostic: 'RESUME_IDENTITY_REQUIRED: ownerPid must be a positive safe integer',
    };
  }
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
  acquireLock, parseGuard, parseLock, processAlive, readLatestHandoff, resolveRun, resumeContinuity, verifyResume,
};
