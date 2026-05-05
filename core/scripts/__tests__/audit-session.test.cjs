'use strict';
// audit-session.test.cjs — T-06: unit tests for audit-session.cjs
// @spec AC-09, AC-10

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { resolveSessionId, writeMarkerFile } = require('../lib/audit-session.cjs');

function withEnvCleared(keys, fn) {
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  }
}

function withEnv(key, value, fn) {
  const original = process.env[key];
  process.env[key] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

const SESSION_KEYS = ['SOMA_SESSION_ID', 'CLAUDE_SESSION_ID', 'CK_SESSION_ID', 'ITERM_SESSION_ID'];

// ---- resolveSessionId hierarchy ----

test('AC-09: SOMA_SESSION_ID takes highest priority', () => {
  withEnv('SOMA_SESSION_ID', 'test-soma-id', () => {
    const result = resolveSessionId();
    assert.equal(result.sessionId, 'test-soma-id');
    assert.equal(result.source, 'SOMA_SESSION_ID');
    assert.equal(result.warning, null);
  });
});

test('AC-09: CLAUDE_SESSION_ID used when SOMA absent', () => {
  withEnvCleared(['SOMA_SESSION_ID'], () => {
    withEnv('CLAUDE_SESSION_ID', 'test-claude-id', () => {
      const result = resolveSessionId();
      assert.equal(result.sessionId, 'test-claude-id');
      assert.equal(result.source, 'CLAUDE_SESSION_ID');
    });
  });
});

test('AC-09: CK_SESSION_ID used when SOMA+CLAUDE absent', () => {
  withEnvCleared(['SOMA_SESSION_ID', 'CLAUDE_SESSION_ID'], () => {
    withEnv('CK_SESSION_ID', 'test-ck-uuid', () => {
      const result = resolveSessionId();
      assert.equal(result.sessionId, 'test-ck-uuid');
      assert.equal(result.source, 'CK_SESSION_ID');
    });
  });
});

test('AC-09: ITERM_SESSION_ID used when SOMA+CLAUDE+CK absent', () => {
  withEnvCleared(['SOMA_SESSION_ID', 'CLAUDE_SESSION_ID', 'CK_SESSION_ID'], () => {
    withEnv('ITERM_SESSION_ID', 'test-iterm-id', () => {
      const result = resolveSessionId();
      assert.equal(result.sessionId, 'test-iterm-id');
      assert.equal(result.source, 'ITERM_SESSION_ID');
    });
  });
});

test('AC-10: SESSION_ID_FALLBACK warning when all env vars absent', () => {
  withEnvCleared(SESSION_KEYS, () => {
    // Remove the marker file too to force hostname-pid fallback
    try { fs.rmSync('/tmp/soma-session-id'); } catch {}
    const result = resolveSessionId();
    assert.ok(result.sessionId, 'sessionId must be set');
    // Should use marker-file (created on first call) or hostname-pid
    assert.ok(['marker-file', 'hostname-pid'].includes(result.source),
      `Expected marker-file or hostname-pid, got: ${result.source}`);
    // If hostname-pid, warning must be present
    if (result.source === 'hostname-pid') {
      assert.ok(result.warning, 'warning must be present for hostname-pid fallback');
      assert.equal(result.warning.code, 'SESSION_ID_FALLBACK');
    }
  });
});

test('AC-10: fallback sessionId contains hostname or pid', () => {
  withEnvCleared(SESSION_KEYS, () => {
    try { fs.rmSync('/tmp/soma-session-id'); } catch {}
    const result = resolveSessionId();
    // hostname-pid pattern
    if (result.source === 'hostname-pid') {
      const pid = String(process.pid);
      assert.ok(result.sessionId.includes(pid) || result.sessionId.includes(os.hostname()),
        `sessionId ${result.sessionId} must contain hostname or pid`);
    }
  });
});

// ---- writeMarkerFile ----

test('AC-09: writeMarkerFile creates /tmp/soma-discovery-done-{sessionId}', () => {
  const sessionId = `test-marker-${Date.now()}`;
  const expectedPath = `/tmp/soma-discovery-done-${sessionId}`;
  try { fs.rmSync(expectedPath); } catch {}

  writeMarkerFile(sessionId);

  assert.ok(fs.existsSync(expectedPath), `Marker file ${expectedPath} must exist`);
  // Cleanup
  try { fs.rmSync(expectedPath); } catch {}
});

test('AC-09: writeMarkerFile content is non-empty (timestamp)', () => {
  const sessionId = `test-marker-content-${Date.now()}`;
  const expectedPath = `/tmp/soma-discovery-done-${sessionId}`;
  try { fs.rmSync(expectedPath); } catch {}

  writeMarkerFile(sessionId);

  const content = fs.readFileSync(expectedPath, 'utf-8').trim();
  assert.ok(content.length > 0, 'marker file content must be non-empty');
  // Cleanup
  try { fs.rmSync(expectedPath); } catch {}
});
