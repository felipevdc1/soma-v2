'use strict';

const ENTRY_REQUEST_SCHEMA = 'soma-entry-request/v1';
const MAX_RAW_ARGUMENT_BYTES = 256 * 1024;

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/;
const ENTRY_REQUEST_KEYS = [
  '$schema',
  'capability',
  'rawArguments',
  'requestId',
  'sessionId',
];

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw validationError(
      'SESSION_UNAVAILABLE',
      'sessionId must be 1-128 characters from the native session alphabet'
    );
  }
  return value;
}

function validateRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw validationError(
      'INVALID_ENTRY_IDENTITY',
      'requestId must be exactly 32 lowercase hexadecimal characters'
    );
  }
  return value;
}

function validateCapability(value) {
  if (typeof value !== 'string' || !CAPABILITY_PATTERN.test(value)) {
    throw validationError(
      'INVALID_ENTRY_IDENTITY',
      'capability must be exactly 64 lowercase hexadecimal characters'
    );
  }
  return value;
}

function validateEntryRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('INVALID_ENTRY_REQUEST', 'entry request must be an object');
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== ENTRY_REQUEST_KEYS.length) {
    const unexpected = keys.filter(key => !ENTRY_REQUEST_KEYS.includes(key));
    const missing = ENTRY_REQUEST_KEYS.filter(key => !Object.hasOwn(value, key));
    const detail = unexpected.length > 0
      ? `unexpected field ${unexpected[0]}`
      : `missing field ${missing[0]}`;
    throw validationError('INVALID_ENTRY_REQUEST', detail);
  }
  for (let index = 0; index < ENTRY_REQUEST_KEYS.length; index += 1) {
    if (keys[index] !== ENTRY_REQUEST_KEYS[index]) {
      const unexpected = keys.find(key => !ENTRY_REQUEST_KEYS.includes(key));
      const missing = ENTRY_REQUEST_KEYS.find(key => !Object.hasOwn(value, key));
      throw validationError(
        'INVALID_ENTRY_REQUEST',
        unexpected ? `unexpected field ${unexpected}` : `missing field ${missing}`
      );
    }
  }

  if (value.$schema !== ENTRY_REQUEST_SCHEMA) {
    throw validationError('INVALID_ENTRY_REQUEST', 'invalid $schema');
  }
  validateSessionIdForEnvelope(value.sessionId);
  validateRequestIdForEnvelope(value.requestId);
  validateCapabilityForEnvelope(value.capability);
  if (typeof value.rawArguments !== 'string') {
    throw validationError('INVALID_ENTRY_REQUEST', 'rawArguments must be a string');
  }
  if (Buffer.byteLength(value.rawArguments, 'utf8') > MAX_RAW_ARGUMENT_BYTES) {
    throw validationError('INVALID_ENTRY_REQUEST', 'rawArguments exceeds the UTF-8 byte limit');
  }

  return {
    $schema: value.$schema,
    sessionId: value.sessionId,
    requestId: value.requestId,
    capability: value.capability,
    rawArguments: value.rawArguments,
  };
}

function validateSessionIdForEnvelope(value) {
  try {
    validateSessionId(value);
  } catch (_error) {
    throw validationError('INVALID_ENTRY_REQUEST', 'invalid sessionId');
  }
}

function validateRequestIdForEnvelope(value) {
  try {
    validateRequestId(value);
  } catch (_error) {
    throw validationError('INVALID_ENTRY_REQUEST', 'invalid requestId');
  }
}

function validateCapabilityForEnvelope(value) {
  try {
    validateCapability(value);
  } catch (_error) {
    throw validationError('INVALID_ENTRY_REQUEST', 'invalid capability');
  }
}

module.exports = {
  ENTRY_REQUEST_SCHEMA,
  MAX_RAW_ARGUMENT_BYTES,
  validateSessionId,
  validateRequestId,
  validateCapability,
  validateEntryRequest,
};
