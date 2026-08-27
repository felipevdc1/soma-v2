#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildCheckpoint, canonicalJson, readContinuityGitFacts, sha256,
} = require('./checkpoint.cjs');
const { renderHandoffMarkdown, validateHandoff } = require('./handoff-schema.cjs');
const { resolveSomaPaths } = require('./paths.cjs');
const { assertSafeRunId } = require('./run-id.cjs');

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readLatestCheckpoint(projectRoot, runId) {
  const { runCheckpointsDir } = resolveSomaPaths(projectRoot, runId);
  let entries;
  try { entries = fs.readdirSync(runCheckpointsDir); }
  catch (_) { throw codedError('CHECKPOINT_NOT_FOUND', `no checkpoint exists for ${runId}`); }
  const sequences = entries.map(name => /^(\d+)\.json$/.exec(name)).filter(Boolean)
    .map(match => Number(match[1])).sort((a, b) => a - b);
  if (sequences.length === 0) throw codedError('CHECKPOINT_NOT_FOUND', `no checkpoint exists for ${runId}`);
  const sequence = sequences[sequences.length - 1];
  const checkpointPath = path.join(runCheckpointsDir, `${sequence}.json`);
  const bytes = fs.readFileSync(checkpointPath);
  let checkpoint;
  try { checkpoint = JSON.parse(bytes); }
  catch (_) { throw codedError('CHECKPOINT_INVALID', 'checkpoint is not valid JSON'); }
  if (checkpoint.$schema !== 'soma-checkpoint/v1' || checkpoint.runId !== runId || checkpoint.sequence !== sequence ||
      bytes.toString('utf8') !== canonicalJson(checkpoint)) {
    throw codedError('CHECKPOINT_INVALID', 'checkpoint is not canonical or contradicts its path');
  }
  return { bytes, checkpoint, checkpointPath, sequence, sha256: sha256(bytes) };
}

function checkpointInput(checkpoint) {
  return {
    $schema: 'soma-checkpoint-input/v1', blocker: checkpoint.blocker,
    currentState: checkpoint.currentState, nextDecision: checkpoint.nextDecision,
    nextTask: checkpoint.nextTask, runId: checkpoint.runId, sequence: checkpoint.sequence,
    tasks: checkpoint.tasks,
  };
}

function verifyCheckpointInputs(projectRoot, record) {
  const current = buildCheckpoint({
    projectRoot,
    runId: record.checkpoint.runId,
    input: checkpointInput(record.checkpoint),
    readOnly: true,
  });
  if (canonicalJson(current) !== canonicalJson(record.checkpoint)) {
    throw codedError('CONTINUITY_DRIFT', 'durable state, dispatch, proof or Git facts differ from checkpoint');
  }
  return current;
}

function handoffGenerations(runHandoffsDir) {
  let entries = [];
  try { entries = fs.readdirSync(runHandoffsDir, { withFileTypes: true }); } catch (_) {}
  const generations = [];
  let privateResidues = 0;
  for (const entry of entries) {
    const match = /^(\d+)$/.exec(entry.name);
    const ownResidue = entry.isDirectory() && /^\.\d+\.\d+\.[a-f0-9]{12}\.tmp$/.test(entry.name);
    if (ownResidue) {
      privateResidues += 1;
      if (privateResidues > 32) throw codedError('HANDOFF_STORAGE_INVALID', 'too many private handoff residues');
      continue;
    }
    if (!entry.isDirectory() || !match) throw codedError('HANDOFF_STORAGE_INVALID', `unexpected handoff entry: ${entry.name}`);
    generations.push(Number(match[1]));
  }
  return generations.sort((a, b) => a - b);
}

function nextGeneration(runHandoffsDir) {
  const generations = handoffGenerations(runHandoffsDir);
  return generations.length === 0 ? 1 : generations[generations.length - 1] + 1;
}

function buildHandoff(projectRoot, runId, generation, checkpointRecord) {
  const checkpoint = checkpointRecord.checkpoint;
  const handoff = {
    $schema: 'soma-handoff/v1', blocker: checkpoint.blocker,
    checkpoint: {
      path: path.relative(projectRoot, checkpointRecord.checkpointPath).split(path.sep).join('/'),
      sequence: checkpoint.sequence, sha256: checkpointRecord.sha256,
    },
    commitProofs: checkpoint.commitProofs, currentState: checkpoint.currentState,
    dispatches: checkpoint.dispatches, generation, git: readContinuityGitFacts(projectRoot),
    lastCompletedTask: checkpoint.lastCompletedTask,
    nextDecision: checkpoint.nextDecision, nextTask: checkpoint.nextTask,
    proofs: checkpoint.proofs, resumeCommand: `/soma-run --resume ${runId}`,
    runId, runIdentity: checkpoint.runIdentity, runState: checkpoint.runState,
    tasks: checkpoint.tasks,
  };
  const validation = validateHandoff(handoff);
  if (!validation.valid) throw codedError('HANDOFF_INVALID', validation.violations.join('; '));
  return handoff;
}

function publishHandoff({ projectRoot, runId }) {
  assertSafeRunId(runId);
  const checkpointRecord = readLatestCheckpoint(projectRoot, runId);
  verifyCheckpointInputs(projectRoot, checkpointRecord);
  const { runHandoffsDir } = resolveSomaPaths(projectRoot, runId);
  fs.mkdirSync(runHandoffsDir, { recursive: true });
  const generation = nextGeneration(runHandoffsDir);
  const destination = path.join(runHandoffsDir, String(generation));
  const temporary = path.join(runHandoffsDir, `.${generation}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const handoff = buildHandoff(projectRoot, runId, generation, checkpointRecord);
  fs.mkdirSync(temporary);
  const jsonPath = path.join(temporary, 'handoff.json');
  const markdownPath = path.join(temporary, 'handoff.md');
  try {
    fs.writeFileSync(jsonPath, canonicalJson(handoff), { flag: 'wx' });
    fs.writeFileSync(markdownPath, renderHandoffMarkdown(handoff), { flag: 'wx' });
    try {
      fs.renameSync(temporary, destination);
    } catch (error) {
      if (error && ['EEXIST', 'ENOTEMPTY'].includes(error.code)) {
        throw codedError('HANDOFF_IMMUTABLE', `handoff generation already exists: ${generation}`);
      }
      throw error;
    }
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    generation, handoff,
    jsonPath: path.join(destination, 'handoff.json'),
    markdownPath: path.join(destination, 'handoff.md'),
  };
}

function main() {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== '--run' || !argv[1]) throw codedError('MISSING_ARG', 'usage: soma run handoff --run <runId>');
    const result = publishHandoff({ projectRoot: process.cwd(), runId: argv[1] });
    process.stdout.write(`${JSON.stringify({ ok: true, runId: argv[1], generation: result.generation, jsonPath: result.jsonPath, markdownPath: result.markdownPath })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.code || 'HANDOFF_FAILED', message: error.message })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  buildHandoff, checkpointInput, handoffGenerations, nextGeneration, publishHandoff,
  readLatestCheckpoint, verifyCheckpointInputs,
};
