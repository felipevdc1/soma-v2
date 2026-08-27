'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256 } = require('../run/checkpoint.cjs');
const { verifyCheckpointInputs } = require('../run/handoff.cjs');
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
  const generations = regularDirectories(runHandoffsDir).map(name => /^(\d+)$/.exec(name)).filter(Boolean)
    .map(match => Number(match[1])).sort((a, b) => a - b);
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
    nextDecision: checkpoint.nextDecision, nextTask: checkpoint.nextTask,
    proofs: checkpoint.proofs, runState: checkpoint.runState, tasks: checkpoint.tasks,
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

function acquireLock(projectRoot, runId, sessionId) {
  const lock = {
    runId, sessionId: sessionId || `pid-${process.ppid}`, startedAt: new Date().toISOString(),
  };
  writeAtomic(path.join(projectRoot, '.soma.lock'), Buffer.from(canonicalJson(lock)));
}

function resumeContinuity({ projectRoot, requestedRunId, sessionId }) {
  let runId;
  try {
    runId = resolveRun(projectRoot, requestedRunId);
  } catch (error) {
    return { status: error.code, retrySafe: true, diagnostic: error.message };
  }
  try {
    const record = readLatestHandoff(projectRoot, runId);
    const checkpoint = verifyResume(projectRoot, record);
    acquireLock(projectRoot, runId, sessionId);
    return {
      status: 'RESUME_READY', runId, reentryState: checkpoint.currentState,
      nextTask: checkpoint.nextTask, handoffGeneration: record.generation,
    };
  } catch (error) {
    const diagnostic = persistDrift(projectRoot, runId, error);
    return { status: 'RESUME_DRIFT', retrySafe: true, runId, diagnostic: `${diagnostic.code}: ${diagnostic.message}` };
  }
}

module.exports = { readLatestHandoff, resolveRun, resumeContinuity, verifyResume };
