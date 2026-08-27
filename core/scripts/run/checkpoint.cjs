#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runGitRead, gitRoot, gitOutput } = require('../entry/git-readonly.cjs');
const { resolveSomaPaths } = require('./paths.cjs');
const { assertExactRunId, assertSafeRunId } = require('./run-id.cjs');
const { readExactRunState } = require('./state.cjs');
const { validateStateV3 } = require('./recovery-store.cjs');

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
      result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relativePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function contained(projectRoot, candidate) {
  const relative = path.relative(projectRoot, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

const TERMINAL_TASK_STATUSES = new Set(['pass', 'passed', 'done']);

function nonBlank(value) {
  return typeof value === 'string' && /\S/.test(value);
}

function readProof(projectRoot, rawPath, extra = {}) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw codedError('PROOF_PATH_INVALID', 'proof path must be a non-empty string');
  }
  const candidate = path.resolve(projectRoot, rawPath);
  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    throw codedError('PROOF_UNREADABLE', `proof is not readable: ${rawPath}`);
  }
  if (!contained(projectRoot, canonical)) {
    throw codedError('PROOF_PATH_OUTSIDE_PROJECT', `proof path resolves outside project: ${rawPath}`);
  }
  const stat = fs.statSync(canonical);
  if (!stat.isFile()) throw codedError('PROOF_PATH_INVALID', `proof is not a regular file: ${rawPath}`);
  const bytes = fs.readFileSync(canonical);
  return { ...extra, path: relativePath(projectRoot, canonical), sha256: sha256(bytes) };
}

function validateCheckpointInput(input, runId) {
  const keys = ['$schema', 'blocker', 'currentState', 'nextDecision', 'nextTask', 'runId', 'sequence', 'tasks'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join('\0') !== keys.sort().join('\0')) {
    throw codedError('CHECKPOINT_INPUT_INVALID', 'checkpoint input must use the exact soma-checkpoint-input/v1 shape');
  }
  if (input.$schema !== 'soma-checkpoint-input/v1' || input.runId !== runId ||
      !Number.isInteger(input.sequence) || input.sequence < 1 ||
      typeof input.currentState !== 'string' || input.currentState.length === 0 ||
      !(input.nextTask === null || (typeof input.nextTask === 'string' && input.nextTask.length > 0)) ||
      !(input.blocker === null || typeof input.blocker === 'string') ||
      !(input.nextDecision === null || typeof input.nextDecision === 'string') ||
      !Array.isArray(input.tasks)) {
    throw codedError('CHECKPOINT_INPUT_INVALID', 'checkpoint input fields are invalid or runId does not match --run');
  }
  const taskIds = new Set();
  for (const task of input.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) ||
        Object.keys(task).sort().join('\0') !== ['attempts', 'id', 'status'].join('\0') ||
        typeof task.id !== 'string' || task.id.length === 0 || taskIds.has(task.id) ||
        typeof task.status !== 'string' || task.status.length === 0 ||
        !Number.isInteger(task.attempts) || task.attempts < 0) {
      throw codedError('CHECKPOINT_INPUT_INVALID', 'checkpoint tasks must have exact, unique id/status/attempts fields');
    }
    taskIds.add(task.id);
  }
  if (input.nextTask !== null) {
    const next = input.tasks.find(task => task.id === input.nextTask);
    if (!next || TERMINAL_TASK_STATUSES.has(next.status)) {
      throw codedError('CHECKPOINT_INPUT_INVALID', 'nextTask must name an unfinished task');
    }
  }
  const unfinished = input.tasks.filter(task => !TERMINAL_TASK_STATUSES.has(task.status));
  if (input.nextTask === null && unfinished.length > 0 &&
      !(nonBlank(input.blocker) && nonBlank(input.nextDecision))) {
    throw codedError(
      'CHECKPOINT_INPUT_INVALID',
      'nextTask may be null with unfinished tasks only when blocker and nextDecision name the pause'
    );
  }
}

function parseAttempt(taskId, dirName) {
  if (dirName === taskId) return 1;
  const match = /^attempt-(\d+)$/.exec(dirName);
  return match ? Number(match[1]) : null;
}

function collectDispatches(projectRoot, runId, state) {
  if (Array.isArray(state.activeDispatchIds) && state.activeDispatchIds.length > 0) {
    throw codedError('DISPATCH_ACTIVE', `run state declares active dispatches: ${state.activeDispatchIds.join(', ')}`);
  }
  const { runDispatchesDir } = resolveSomaPaths(projectRoot, runId);
  if (!fs.existsSync(runDispatchesDir)) return [];
  const records = [];
  for (const taskEntry of fs.readdirSync(runDispatchesDir, { withFileTypes: true })) {
    if (!taskEntry.isDirectory()) throw codedError('DISPATCH_CONTRADICTORY', 'dispatch run directory contains a non-directory entry');
    const taskId = taskEntry.name;
    const taskDir = path.join(runDispatchesDir, taskId);
    const candidates = [{ dir: taskDir, attempt: 1 }];
    for (const entry of fs.readdirSync(taskDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const attempt = parseAttempt(taskId, entry.name);
        if (attempt === null || attempt < 2 || attempt > 2) throw codedError('DISPATCH_CONTRADICTORY', `invalid dispatch attempt directory: ${entry.name}`);
        candidates.push({ dir: path.join(taskDir, entry.name), attempt });
      }
    }
    for (const candidate of candidates) {
      const componentNames = ['prompt.md', 'output.md', 'metadata.json'];
      const present = componentNames.filter(name => fs.existsSync(path.join(candidate.dir, name)));
      if (candidate.attempt === 1 && present.length === 0) continue;
      if (present.length !== componentNames.length) {
        throw codedError('DISPATCH_ACTIVE', `dispatch ${taskId} attempt ${candidate.attempt} is not closed`);
      }
      const components = {};
      for (const name of componentNames) {
        const componentPath = path.join(candidate.dir, name);
        if (!fs.statSync(componentPath).isFile()) throw codedError('DISPATCH_CONTRADICTORY', `dispatch component is not a file: ${name}`);
        const bytes = fs.readFileSync(componentPath);
        components[name.split('.')[0]] = { path: relativePath(projectRoot, componentPath), sha256: sha256(bytes) };
      }
      let metadata;
      try { metadata = JSON.parse(fs.readFileSync(path.join(candidate.dir, 'metadata.json'), 'utf8')); }
      catch (_) { throw codedError('DISPATCH_CONTRADICTORY', `dispatch ${taskId} metadata is invalid JSON`); }
      if (!metadata || metadata.schema !== 'soma-dispatch-record/v1' || metadata.run_id !== runId ||
          metadata.task_id !== taskId || metadata.attempt !== candidate.attempt ||
          !['done', 'failed', 'rejected'].includes(metadata.result) ||
          typeof metadata.model !== 'string' || metadata.model.length === 0 ||
          typeof metadata.base_sha !== 'string' || metadata.base_sha.length === 0 ||
          typeof metadata.started_at !== 'string' || typeof metadata.finished_at !== 'string' ||
          !Array.isArray(metadata.ac_refs) || typeof metadata.executor_agent !== 'string' || metadata.executor_agent.length === 0) {
        throw codedError('DISPATCH_CONTRADICTORY', `dispatch ${taskId} metadata contradicts its durable path`);
      }
      records.push({
        taskId, attempt: candidate.attempt, result: metadata.result,
        executorAgent: metadata.executor_agent, baseSha: metadata.base_sha, components,
      });
    }
  }
  return records.sort((a, b) => Buffer.from(a.taskId).compare(Buffer.from(b.taskId)) || a.attempt - b.attempt);
}

function collectProofs(projectRoot, state) {
  const proofs = [];
  for (const report of Array.isArray(state.reports) ? state.reports : []) {
    proofs.push(readProof(projectRoot, report.path, { kind: 'report', status: report.status, step: report.step }));
  }
  const branches = state.diagnosticRecovery && Array.isArray(state.diagnosticRecovery.branches)
    ? state.diagnosticRecovery.branches : [];
  for (const branch of branches) {
    for (const proof of Array.isArray(branch.proofs) ? branch.proofs : []) {
      const derived = readProof(projectRoot, proof.path, { kind: proof.kind, branchId: branch.branchId });
      if (proof.sha256 && proof.sha256 !== derived.sha256) {
        throw codedError('PROOF_HASH_MISMATCH', `proof hash does not match durable bytes: ${proof.path}`);
      }
      proofs.push(derived);
    }
  }
  return proofs.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
}

function gitRelativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function ignoredContinuityPath(filePath, somaRelative, lockRelative) {
  if (filePath === lockRelative) return true;
  return ['checkpoints', 'handoffs', 'diagnostics'].some(directory => {
    const prefix = `${somaRelative}/${directory}`;
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  });
}

function gitBlobHash(root, filePath, staged) {
  if (staged) {
    const result = runGitRead(root, ['show', `:${filePath}`]);
    return result.status === 0 ? sha256(Buffer.from(result.stdout)) : null;
  }
  const absolute = path.join(root, ...filePath.split('/'));
  try {
    const stat = fs.statSync(absolute);
    return stat.isFile() ? sha256(fs.readFileSync(absolute)) : null;
  } catch (_) {
    return null;
  }
}

function readContinuityGitFacts(projectRoot) {
  let canonicalProjectRoot;
  try { canonicalProjectRoot = fs.realpathSync(projectRoot); } catch (_) { canonicalProjectRoot = projectRoot; }
  const root = gitRoot(canonicalProjectRoot);
  if (!root) {
    return { branch: null, dirtyDigest: sha256(Buffer.from('[]')), dirtyEntries: [], head: null };
  }
  const result = runGitRead(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.status !== 0) throw codedError('GIT_READ_FAILED', result.stderr.trim() || 'cannot inspect Git status');
  const raw = result.stdout.split('\0').filter(Boolean);
  const entries = [];
  const somaRelative = gitRelativePath(root, path.join(canonicalProjectRoot, '.soma'));
  const lockRelative = gitRelativePath(root, path.join(canonicalProjectRoot, '.soma.lock'));
  for (let index = 0; index < raw.length; index += 1) {
    const record = raw[index];
    const status = record.slice(0, 2);
    let filePath = record.slice(3);
    let sourcePath = null;
    if (/[RC]/.test(status) && index + 1 < raw.length) {
      sourcePath = raw[++index];
    }
    filePath = filePath.split(path.sep).join('/');
    if (ignoredContinuityPath(filePath, somaRelative, lockRelative)) continue;
    entries.push({
      indexSha256: status[0] !== ' ' && status[0] !== '?' ? gitBlobHash(root, filePath, true) : null,
      path: filePath,
      sourcePath: sourcePath ? sourcePath.split(path.sep).join('/') : null,
      status,
      worktreeSha256: status[1] !== ' ' || status === '??' ? gitBlobHash(root, filePath, false) : null,
    });
  }
  entries.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)) || a.status.localeCompare(b.status));
  return {
    branch: gitOutput(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    dirtyDigest: sha256(Buffer.from(canonicalJson(entries))),
    dirtyEntries: entries,
    head: gitOutput(root, ['rev-parse', '--verify', 'HEAD']),
  };
}

function readRunStateWithoutMutation(projectRoot, runId) {
  const { runStateFile } = resolveSomaPaths(projectRoot, runId);
  let stat;
  try { stat = fs.lstatSync(runStateFile); }
  catch (_) { throw codedError('RUN_STATE_UNREADABLE', `run state is not readable: ${runStateFile}`); }
  if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('RUN_STATE_INVALID', 'run state must be a regular file');
  const stateBytes = fs.readFileSync(runStateFile);
  let state;
  try { state = JSON.parse(stateBytes); }
  catch (_) { throw codedError('RUN_STATE_INVALID', 'run state is not valid JSON'); }
  const commonValid = state && typeof state === 'object' && !Array.isArray(state) &&
    typeof state.currentState === 'string' && Array.isArray(state.activeDispatchIds) && Array.isArray(state.reports);
  const valid = state.$schema === 'soma-state/v3'
    ? validateStateV3(state).valid
    : state.$schema === 'soma-state/v2' && commonValid;
  if (!valid) throw codedError('RUN_STATE_INVALID', 'run state schema is invalid');
  try { assertExactRunId(state.runId, runId); }
  catch (_) { throw codedError('RUN_STATE_INVALID', 'run state id does not match'); }
  return { state, stateBytes, runStateFile };
}

function readRunIdentity(projectRoot, runId) {
  const { runIdentityFile } = resolveSomaPaths(projectRoot, runId);
  let stat;
  try { stat = fs.lstatSync(runIdentityFile); }
  catch (_) { throw codedError('RUN_ID_IDENTITY_UNPROVABLE', 'run identity marker is missing'); }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw codedError('RUN_ID_MARKER_INVALID', 'run identity marker must be a regular file');
  }
  const bytes = fs.readFileSync(runIdentityFile);
  let marker;
  try { marker = JSON.parse(bytes); }
  catch (_) { throw codedError('RUN_ID_MARKER_INVALID', 'run identity marker is invalid JSON'); }
  if (!marker || marker.$schema !== 'soma-run-identity/v1' || marker.runId !== runId) {
    throw codedError('RUN_ID_MARKER_INVALID', 'run identity marker contradicts the run');
  }
  return { path: relativePath(projectRoot, runIdentityFile), sha256: sha256(bytes) };
}

function buildCheckpoint({ projectRoot, runId, input, readOnly = false }) {
  assertSafeRunId(runId);
  validateCheckpointInput(input, runId);
  const { state, stateBytes } = readOnly
    ? readRunStateWithoutMutation(projectRoot, runId)
    : readExactRunState({ projectRoot, runId, allowV2: true });
  if (state.currentState !== input.currentState) {
    throw codedError('CHECKPOINT_STATE_CONTRADICTORY', 'input currentState does not match durable run state');
  }
  const dispatches = collectDispatches(projectRoot, runId, state);
  const proofs = collectProofs(projectRoot, state);
  const git = readContinuityGitFacts(projectRoot);
  const runIdentity = readRunIdentity(projectRoot, runId);
  const tasks = input.tasks.map(task => ({ ...task }));
  const completed = tasks.filter(task => TERMINAL_TASK_STATUSES.has(task.status));
  const lastCompletedTask = completed.length === 0 ? null : completed[completed.length - 1].id;
  const commitProofs = dispatches.map(({ baseSha, taskId, attempt }) => ({ baseSha, taskId, attempt }));
  return {
    $schema: 'soma-checkpoint/v1', blocker: input.blocker, commitProofs,
    currentState: input.currentState, dispatches, git, lastCompletedTask,
    nextDecision: input.nextDecision,
    nextTask: input.nextTask, proofs, runId, runIdentity,
    runState: { path: relativePath(projectRoot, resolveSomaPaths(projectRoot, runId).runStateFile), sha256: sha256(stateBytes) },
    sequence: input.sequence, tasks,
  };
}

function publishCheckpoint({ projectRoot, runId, input }) {
  const checkpoint = buildCheckpoint({ projectRoot, runId, input });
  const { runCheckpointsDir } = resolveSomaPaths(projectRoot, runId);
  fs.mkdirSync(runCheckpointsDir, { recursive: true });
  const existingSequences = fs.readdirSync(runCheckpointsDir)
    .map(name => /^(\d+)\.json$/.exec(name)).filter(Boolean).map(match => Number(match[1]));
  if (existingSequences.some(sequence => sequence > input.sequence)) {
    throw codedError('CHECKPOINT_SEQUENCE_DECREASED', 'checkpoint sequence cannot decrease');
  }
  const destination = path.join(runCheckpointsDir, `${input.sequence}.json`);
  const temporary = path.join(runCheckpointsDir, `.${input.sequence}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, canonicalJson(checkpoint), { flag: 'wx' });
  try {
    try {
      fs.linkSync(temporary, destination);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw codedError('CHECKPOINT_IMMUTABLE', `checkpoint already exists: ${input.sequence}`);
      }
      throw error;
    }
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
  return { checkpoint, path: destination, sha256: sha256(fs.readFileSync(destination)) };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run') args.run = argv[++index];
    else if (argv[index] === '--input-file') args.inputFile = argv[++index];
    else throw codedError('UNKNOWN_ARGS', `unknown argument: ${argv[index]}`);
  }
  if (!args.run || !args.inputFile) throw codedError('MISSING_ARG', '--run and --input-file are required');
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    let input;
    try { input = JSON.parse(fs.readFileSync(args.inputFile, 'utf8')); }
    catch (error) { throw codedError('CHECKPOINT_INPUT_INVALID', `cannot read checkpoint input: ${error.message}`); }
    const result = publishCheckpoint({ projectRoot: process.cwd(), runId: args.run, input });
    process.stdout.write(`${JSON.stringify({ ok: true, path: result.path, runId: args.run, sequence: input.sequence, sha256: result.sha256 })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.code || 'CHECKPOINT_FAILED', message: error.message })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  buildCheckpoint, canonicalJson, canonicalValue, collectDispatches, collectProofs,
  publishCheckpoint, readContinuityGitFacts, readRunStateWithoutMutation,
  readRunIdentity, sha256, validateCheckpointInput,
};
