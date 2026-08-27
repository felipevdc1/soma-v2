'use strict';

/**
 * Task 1 RED contract for the one universal-entry request envelope.
 *
 * Production modules are intentionally absent at this commit. The exact RED
 * command must fail at the require below until Task 1 GREEN implements the
 * dependency-free schema boundary.
 *
 * @spec AC-01
 * @spec AC-02
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCHEMA_MODULE = path.join(__dirname, '..', 'entry', 'request-schema.cjs');

const {
  ENTRY_REQUEST_SCHEMA,
  MAX_RAW_ARGUMENT_BYTES,
  validateSessionId,
  validateRequestId,
  validateCapability,
  validateEntryRequest,
} = require(SCHEMA_MODULE);

const SESSION_ID = 'claude-session.A_01';
const REQUEST_ID = '0123456789abcdef0123456789abcdef';
const CAPABILITY = '0123456789abcdef'.repeat(4);

function validEnvelope(overrides = {}) {
  return {
    $schema: 'soma-entry-request/v1',
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    capability: CAPABILITY,
    rawArguments: '--status --project "/tmp/example"',
    ...overrides,
  };
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return undefined;
}

function assertRejected(callback, code = 'INVALID_ENTRY_REQUEST') {
  const error = captureError(callback);
  assert.ok(error, `expected ${code}, but validation returned success`);
  assert.equal(error.code, code, `unexpected stable error: ${error.stack || error.message}`);
  return error;
}

test('schema exports the canonical version and a finite UTF-8 rawArguments limit', () => {
  assert.equal(ENTRY_REQUEST_SCHEMA, 'soma-entry-request/v1');
  assert.equal(Number.isSafeInteger(MAX_RAW_ARGUMENT_BYTES), true);
  assert.ok(MAX_RAW_ARGUMENT_BYTES > 0, 'rawArguments limit must be positive');
  assert.ok(MAX_RAW_ARGUMENT_BYTES <= 1024 * 1024, 'request envelope must stay bounded');
});

test('valid envelope preserves the exact four payload fields and hostile raw text as data', () => {
  const rawArguments = String.raw`"objective $(touch sentinel)" --project '/tmp/a b' ; echo nope | cat
second line with \`backticks\` and \\ escapes`;
  const envelope = validEnvelope({ rawArguments });
  const before = structuredClone(envelope);

  const validated = validateEntryRequest(envelope);

  assert.deepEqual(validated, before);
  assert.deepEqual(envelope, before, 'schema validation must not mutate caller data');
  assert.equal(validated.rawArguments, rawArguments);
  assert.deepEqual(Object.keys(validated).sort(), [
    '$schema',
    'capability',
    'rawArguments',
    'requestId',
    'sessionId',
  ]);
  assert.equal(Object.hasOwn(validated, 'mode'), false);
  assert.equal(Object.hasOwn(validated, 'contentSha256'), false);
  assert.equal(Object.hasOwn(validated, 'expiresAt'), false);
});

test('schema requires $schema and every payload field, with no schema alias', () => {
  for (const field of ['$schema', 'sessionId', 'requestId', 'capability', 'rawArguments']) {
    const envelope = validEnvelope();
    delete envelope[field];
    const error = assertRejected(() => validateEntryRequest(envelope));
    assert.match(error.message, new RegExp(field.replace('$', '\\$'), 'i'));
  }

  const alias = validEnvelope();
  delete alias.$schema;
  alias.schema = 'soma-entry-request/v1';
  assertRejected(() => validateEntryRequest(alias));
});

test('schema rejects surplus fields, including pre-parsed mode, expiry, path, and content hash', () => {
  for (const [field, value] of [
    ['mode', 'start'],
    ['requestPath', '/tmp/caller-selected'],
    ['ttlMs', 30_000],
    ['expiresAt', 123],
    ['contentSha256', 'a'.repeat(64)],
    ['objective', 'already parsed'],
  ]) {
    const error = assertRejected(() => validateEntryRequest(validEnvelope({ [field]: value })));
    assert.match(error.message, new RegExp(field, 'i'));
  }
});

test('schema rejects wrong container and field types without coercion', () => {
  for (const value of [null, undefined, [], 'request', 1, true]) {
    assertRejected(() => validateEntryRequest(value));
  }

  for (const field of ['sessionId', 'requestId', 'capability', 'rawArguments']) {
    for (const value of [null, undefined, 0, false, [], {}]) {
      assertRejected(() => validateEntryRequest(validEnvelope({ [field]: value })));
    }
  }
});

test('native session ID uses one bounded ASCII authority and preserves exact spelling', () => {
  for (const value of ['A', 'a.b-c_D9', 'x'.repeat(128)]) {
    assert.equal(validateSessionId(value), value);
  }

  for (const value of [
    '',
    'x'.repeat(129),
    '-leading',
    '.leading',
    '_leading',
    'contains/slash',
    'contains\\backslash',
    'contains space',
    'unicode-é',
    '$CLAUDE_SESSION_ID',
  ]) {
    assertRejected(() => validateSessionId(value), 'SESSION_UNAVAILABLE');
  }
});

test('request ID accepts exactly 32 lowercase hexadecimal characters', () => {
  for (const value of [REQUEST_ID, '0'.repeat(32), 'f'.repeat(32)]) {
    assert.equal(validateRequestId(value), value);
  }

  for (const value of [
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    'A'.repeat(32),
    'g'.repeat(32),
    '../' + 'a'.repeat(29),
    'a'.repeat(16) + '/' + 'b'.repeat(15),
  ]) {
    assertRejected(() => validateRequestId(value), 'INVALID_ENTRY_IDENTITY');
  }
});

test('capability accepts exactly 64 lowercase hexadecimal characters', () => {
  for (const value of [CAPABILITY, '0'.repeat(64), 'f'.repeat(64)]) {
    assert.equal(validateCapability(value), value);
  }

  for (const value of [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    'g'.repeat(64),
    '../' + 'a'.repeat(61),
    'a'.repeat(32) + '/' + 'b'.repeat(31),
  ]) {
    assertRejected(() => validateCapability(value), 'INVALID_ENTRY_IDENTITY');
  }
});

test('rawArguments limit is measured in UTF-8 bytes at the exact boundary', () => {
  const exact = 'a'.repeat(MAX_RAW_ARGUMENT_BYTES);
  assert.equal(validateEntryRequest(validEnvelope({ rawArguments: exact })).rawArguments, exact);

  assertRejected(() => validateEntryRequest(validEnvelope({
    rawArguments: 'a'.repeat(MAX_RAW_ARGUMENT_BYTES + 1),
  })));

  const multibyte = 'é'.repeat(Math.floor(MAX_RAW_ARGUMENT_BYTES / 2));
  assert.ok(Buffer.byteLength(multibyte, 'utf8') <= MAX_RAW_ARGUMENT_BYTES);
  assert.equal(validateEntryRequest(validEnvelope({ rawArguments: multibyte })).rawArguments, multibyte);
  assertRejected(() => validateEntryRequest(validEnvelope({ rawArguments: multibyte + 'é' })));
});

test('wrong schema version is rejected without normalizing or rewriting bytes', () => {
  const envelope = validEnvelope({ $schema: 'soma-entry-request/v2' });
  const before = JSON.stringify(envelope);
  assertRejected(() => validateEntryRequest(envelope));
  assert.equal(JSON.stringify(envelope), before);
});
