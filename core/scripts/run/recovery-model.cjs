'use strict';

const { createHash } = require('node:crypto');

const CLASSIFICATIONS = new Set([
  'TECHNICAL_DETERMINISTIC',
  'EVIDENCE_DEFICIENT',
  'NORMATIVE_DECISION',
  'SCOPE_AUTHORITY',
  'CONTRADICTORY_REQUIREMENTS',
  'NO_PROGRESS',
]);

function normalizeString(value) {
  return value.replace(/\r\n/g, '\n');
}

function canonicalValue(value) {
  if (typeof value === 'string') {
    return normalizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }

  if (value && typeof value === 'object') {
    const result = {};
    const entries = Object.keys(value)
      .map(key => [normalizeString(key), value[key]])
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    for (const [key, entryValue] of entries) {
      const normalized = canonicalValue(entryValue);
      if (normalized !== undefined && typeof normalized !== 'function' && typeof normalized !== 'symbol') {
        result[key] = normalized;
      }
    }

    return result;
  }

  return value;
}

function canonicalJson(value) {
  const serialized = JSON.stringify(canonicalValue(value));
  if (serialized === undefined) {
    throw new TypeError('canonicalJson requires a JSON-serializable value');
  }
  return `${serialized}\n`;
}

function sha256Hex(bytesOrString) {
  return createHash('sha256').update(bytesOrString).digest('hex');
}

const EMPTY_FIXTURE_SHA256 = sha256Hex('{}\n');

function fingerprintFinding(input) {
  const payload = {
    $schema: 'soma-finding-fingerprint/v1',
    requirementRef: input.requirementRef,
    minimalReproduction: {
      command: input.minimalReproduction && input.minimalReproduction.command,
      fixtureSha256: input.minimalReproduction && input.minimalReproduction.fixtureSha256,
    },
    boundary: input.boundary,
    observedResult: {
      errorIdentity: input.observedResult && input.observedResult.errorIdentity,
      resultSha256: input.observedResult && input.observedResult.resultSha256,
    },
  };
  const json = canonicalJson(payload);

  return {
    fingerprint: sha256Hex(json),
    canonicalJson: json,
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isNonBlankString(value) {
  return isNonEmptyString(value) && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function hasCompleteNewEvidence(input) {
  const reproduction = input.minimalReproduction;
  const observed = input.observedResult;
  const command = reproduction && reproduction.command;

  return Boolean(
    isNonBlankString(input.boundary) &&
      reproduction &&
      Array.isArray(command) &&
      command.length > 0 &&
      command.every(isNonEmptyString) &&
      isSha256(reproduction.fixtureSha256) &&
      observed &&
      isNonBlankString(observed.errorIdentity) &&
      isSha256(observed.resultSha256)
  );
}

function classifyFinding(input) {
  if (isNonBlankString(input.requirementRef)) {
    if (!CLASSIFICATIONS.has(input.classification)) {
      throw new TypeError(`Unknown finding classification: ${input.classification}`);
    }
    return {
      classification: input.classification,
      requirementRef: input.requirementRef,
    };
  }

  if (input.kind !== 'NEW_EVIDENCE') {
    throw new TypeError('A finding requires requirementRef or complete NEW_EVIDENCE');
  }
  if (!hasCompleteNewEvidence(input)) {
    throw new TypeError('NEW_EVIDENCE requires boundary, minimalReproduction, and observedResult');
  }

  return {
    classification: 'NORMATIVE_DECISION',
    requirementRef: `NEW_EVIDENCE:${input.boundary}`,
  };
}

function sortedUnique(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

function isStrictSubset(candidate, reference) {
  return candidate.length < reference.length && candidate.every(value => reference.includes(value));
}

function computeProgress({ previousOpen, currentOpen, strongerRed, closed }) {
  const previous = sortedUnique(previousOpen);
  const current = sortedUnique(currentOpen);
  const closedFindings = sortedUnique(closed);
  const opened = current.filter(value => !previous.includes(value));

  return {
    previousOpen: previous,
    currentOpen: current,
    closed: closedFindings.length,
    opened: opened.length,
    previousOpenCount: previous.length,
    currentOpenCount: current.length,
    setDecreased: isStrictSubset(current, previous),
    strongerRed: Boolean(strongerRed),
  };
}

function generationKeepsFingerprint(generation, fingerprint) {
  const progress = computeProgress(generation);
  return progress.previousOpen.includes(fingerprint) && progress.currentOpen.includes(fingerprint);
}

function evaluateNoProgress({ generations, fingerprint, executors }) {
  const history = Array.isArray(generations) ? generations : [];
  const executorState = executors || {};
  const rotatedExecutor = executorState.rotatedExecutor;
  const rotatedAttempts = rotatedExecutor
    ? Number(executorState.attemptsByExecutor && executorState.attemptsByExecutor[rotatedExecutor]) || 0
    : 0;

  if (
    executorState.rotationsUsed >= 1 &&
    rotatedExecutor &&
    rotatedAttempts >= 2 &&
    generationKeepsFingerprint(history.at(-1) || {}, fingerprint)
  ) {
    return {
      stop: true,
      reason: 'The same fingerprint survived the rotated executor correction.',
    };
  }

  let consecutiveNonDecreasing = 0;
  for (const generation of history) {
    if (computeProgress(generation).setDecreased) {
      consecutiveNonDecreasing = 0;
    } else {
      consecutiveNonDecreasing += 1;
      if (consecutiveNonDecreasing >= 2) {
        return {
          stop: true,
          reason: 'Two consecutive generations had non-decreasing open sets.',
        };
      }
    }
  }

  return { stop: false, reason: null };
}

module.exports = {
  canonicalJson,
  sha256Hex,
  EMPTY_FIXTURE_SHA256,
  fingerprintFinding,
  classifyFinding,
  computeProgress,
  evaluateNoProgress,
};
