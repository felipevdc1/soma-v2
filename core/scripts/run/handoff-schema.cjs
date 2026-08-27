'use strict';

const HANDOFF_KEYS = [
  '$schema', 'blocker', 'checkpoint', 'commitProofs', 'currentState', 'dispatches',
  'generation', 'git', 'lastCompletedTask', 'nextDecision', 'nextTask', 'proofs',
  'resumeCommand', 'runId', 'runIdentity', 'runState', 'tasks',
];

function validSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validateHandoff(value) {
  const violations = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, violations: ['handoff must be an object'] };
  if (Object.keys(value).sort().join('\0') !== [...HANDOFF_KEYS].sort().join('\0')) violations.push('handoff fields are not exact');
  if (value.$schema !== 'soma-handoff/v1') violations.push('$schema must be soma-handoff/v1');
  if (typeof value.runId !== 'string' || value.runId.length === 0) violations.push('runId is invalid');
  if (!Number.isInteger(value.generation) || value.generation < 1) violations.push('generation is invalid');
  if (!value.checkpoint || !validSha(value.checkpoint.sha256) || !Number.isInteger(value.checkpoint.sequence) || typeof value.checkpoint.path !== 'string') violations.push('checkpoint is invalid');
  if (!value.runState || !validSha(value.runState.sha256) || typeof value.runState.path !== 'string') violations.push('runState is invalid');
  if (!value.runIdentity || !validSha(value.runIdentity.sha256) || typeof value.runIdentity.path !== 'string') violations.push('runIdentity is invalid');
  if (!value.git || !validSha(value.git.dirtyDigest)) violations.push('git facts are invalid');
  if (!Array.isArray(value.dispatches) || !Array.isArray(value.proofs) || !Array.isArray(value.tasks) || !Array.isArray(value.commitProofs)) violations.push('handoff arrays are invalid');
  if (value.resumeCommand !== `/soma-run --resume ${value.runId}`) violations.push('resumeCommand is invalid');
  if (!(value.nextTask === null || typeof value.nextTask === 'string')) violations.push('nextTask is invalid');
  if (!(value.lastCompletedTask === null || typeof value.lastCompletedTask === 'string')) violations.push('lastCompletedTask is invalid');
  return { valid: violations.length === 0, violations };
}

function renderHandoffMarkdown(handoff) {
  return [
    `# SOMA handoff: ${handoff.runId}`,
    '',
    `Checkpoint: ${handoff.checkpoint.sequence}`,
    `State: ${handoff.currentState}`,
    `Next task: ${handoff.nextTask === null ? 'none' : handoff.nextTask}`,
    `Last completed task: ${handoff.lastCompletedTask === null ? 'none' : handoff.lastCompletedTask}`,
    `Git HEAD: ${handoff.git.head === null ? 'none' : handoff.git.head}`,
    '',
    'Resume exactly with:',
    '',
    `\`${handoff.resumeCommand}\``,
    '',
  ].join('\n');
}

module.exports = { HANDOFF_KEYS, renderHandoffMarkdown, validateHandoff };
