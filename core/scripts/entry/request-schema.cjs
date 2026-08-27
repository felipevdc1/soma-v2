'use strict';

const MAX_REQUEST_BYTES = 64 * 1024;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/;
const REQUEST_KEYS = ['$schema', 'sessionId', 'requestId', 'rawArguments'];

function error(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function isRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

function validateRequestEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > MAX_REQUEST_BYTES) {
    throw error('INVALID_REQUEST_ENVELOPE', 'Request envelope exceeds 64 KiB');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (_) {
    throw error('INVALID_REQUEST_ENVELOPE', 'Request envelope must be JSON');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw error('INVALID_REQUEST_ENVELOPE', 'Request envelope must be an object');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== REQUEST_KEYS.length || !REQUEST_KEYS.every(key => keys.includes(key))) {
    throw error('INVALID_REQUEST_ENVELOPE', 'Request envelope fields are invalid');
  }
  if (value.$schema !== 'soma-entry-request/v1' || !isSessionId(value.sessionId) || !isRequestId(value.requestId) || typeof value.rawArguments !== 'string') {
    throw error('INVALID_REQUEST_ENVELOPE', 'Request envelope values are invalid');
  }
  return value;
}

module.exports = { MAX_REQUEST_BYTES, SESSION_ID_PATTERN, REQUEST_ID_PATTERN, error, isSessionId, isRequestId, validateRequestEnvelope };
