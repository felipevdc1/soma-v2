'use strict';
// audit-sandbox.test.cjs — T-05: unit tests for audit-sandbox.cjs
// @spec AC-02, AC-14

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const { checkSandbox, SOMA_SCRIPTS_PATH } = require('../lib/audit-sandbox.cjs');

function withEnv(key, value, fn) {
  const original = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

// ---- AC-02: SOMA_SAFE_PATHS_ONLY=1 enforces sandbox ----

test('AC-02: path outside sandbox → SANDBOX_VIOLATION when SOMA_SAFE_PATHS_ONLY=1', () => {
  withEnv('SOMA_SAFE_PATHS_ONLY', '1', () => {
    const result = checkSandbox('/etc/hosts');
    assert.equal(result.ok, false, 'must not be ok');
    assert.equal(result.error.code, 'SANDBOX_VIOLATION');
    assert.ok(result.error.message.includes('/etc/hosts'), 'message includes path');
    assert.ok(result.error.hint, 'hint present');
  });
});

test('AC-14: exists-but-outside-sandbox path → SANDBOX_VIOLATION when SOMA_SAFE_PATHS_ONLY=1', () => {
  withEnv('SOMA_SAFE_PATHS_ONLY', '1', () => {
    const result = checkSandbox('/tmp/some-file.cjs');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'SANDBOX_VIOLATION');
  });
});

test('AC-02: path inside sandbox → ok=true when SOMA_SAFE_PATHS_ONLY=1', () => {
  withEnv('SOMA_SAFE_PATHS_ONLY', '1', () => {
    const insidePath = path.join(SOMA_SCRIPTS_PATH, 'sync.cjs');
    const result = checkSandbox(insidePath);
    assert.equal(result.ok, true, `Expected ok=true for inside path: ${insidePath}`);
  });
});

test('AC-02: sandbox disabled by default (SOMA_SAFE_PATHS_ONLY=0)', () => {
  withEnv('SOMA_SAFE_PATHS_ONLY', '0', () => {
    const result = checkSandbox('/etc/hosts');
    assert.equal(result.ok, true, 'sandbox off → always ok');
  });
});

test('AC-02: sandbox disabled when SOMA_SAFE_PATHS_ONLY unset', () => {
  withEnv('SOMA_SAFE_PATHS_ONLY', undefined, () => {
    const result = checkSandbox('/etc/hosts');
    assert.equal(result.ok, true, 'sandbox unset → always ok');
  });
});

test('AC-14: SOMA_SCRIPTS_PATH constant is correct', () => {
  const expected = path.join(os.homedir(), '.soma-v2', 'scripts');
  assert.equal(SOMA_SCRIPTS_PATH, expected);
});
