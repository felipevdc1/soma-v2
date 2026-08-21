#!/usr/bin/env node
/**
 * Tests for thermal-guard.cjs
 *
 * Run with: node --test ~/.claude/hooks/thermal-guard.test.cjs
 *
 * Tests cover:
 *   1. 2 compile agents + 1 new compile  → ALLOW
 *   2. 3 compile agents + 1 new compile  → BLOCK (exit 2)
 *   3. 3 compile agents + 1 new read-only→ ALLOW (read-only bypasses)
 *   4. Override marker exists            → ALLOW, marker deleted after
 *   5. State has expired entry (>15min)  → cleaned before count → ALLOW
 *   6. Malformed state file              → recover gracefully (reset to empty)
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOOK = path.resolve(__dirname, '..', 'thermal-guard.cjs');
const SESSION_PREFIX = `test-thermal-${Date.now()}`;

function sessionId(suffix) {
  return `${SESSION_PREFIX}-${suffix}`;
}

function stateFile(sid) {
  return path.join(os.tmpdir(), `claude-thermal-state-${sid}.json`);
}

function bypassFile(sid) {
  return path.join(os.tmpdir(), `claude-thermal-bypass-${sid}.marker`);
}

function makePayload(toolName, prompt, extraInput = {}) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: {
      prompt,
      id: `agent-${Date.now()}`,
      ...extraInput,
    },
  });
}

function writeState(sid, active) {
  const sf = stateFile(sid);
  fs.writeFileSync(
    sf,
    JSON.stringify({ active, lastCleanup: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}

function readState(sid) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sid), 'utf-8'));
  } catch (_) {
    return null;
  }
}

function ago(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function compileEntry(id, startedAt) {
  return {
    id,
    type: 'compile-test',
    startedAt: startedAt || new Date().toISOString(),
    ttl: 15 * 60 * 1000,
  };
}

function runHook(sid, payload) {
  return spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: 'utf-8',
    env: { ...process.env, CK_SESSION_ID: sid },
  });
}

function cleanup(sid) {
  try { fs.unlinkSync(stateFile(sid)); } catch (_) {}
  try { fs.unlinkSync(bypassFile(sid)); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('thermal-guard', () => {

  test('1. 2 compile agents + 1 new compile → ALLOW (exit 0)', () => {
    const sid = sessionId('t1');
    cleanup(sid);

    writeState(sid, [
      compileEntry('agent-a'),
      compileEntry('agent-b'),
    ]);

    const result = runHook(sid, makePayload('Agent', 'run vitest on all suites'));
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    // Should have 3 compile entries now
    const state = readState(sid);
    assert.equal(state.active.filter(e => e.type === 'compile-test').length, 3);

    cleanup(sid);
  });

  test('2. 3 compile agents + 1 new compile → BLOCK (exit 2)', () => {
    const sid = sessionId('t2');
    cleanup(sid);

    writeState(sid, [
      compileEntry('agent-a'),
      compileEntry('agent-b'),
      compileEntry('agent-c'),
    ]);

    const result = runHook(sid, makePayload('Agent', 'npm run build && npm test'));
    assert.equal(result.status, 2, `Expected exit 2, got ${result.status}`);
    assert.match(result.stderr, /THERMAL GUARD/);
    assert.match(result.stderr, /3\/3/);

    cleanup(sid);
  });

  test('3. 3 compile agents + 1 new read-only → ALLOW (exit 0)', () => {
    const sid = sessionId('t3');
    cleanup(sid);

    writeState(sid, [
      compileEntry('agent-a'),
      compileEntry('agent-b'),
      compileEntry('agent-c'),
    ]);

    // Read-only prompt: no compile keywords
    const result = runHook(sid, makePayload('Agent', 'Read all typescript files and produce a summary'));
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    // State should be unchanged (read-only not registered)
    const state = readState(sid);
    assert.equal(state.active.length, 3, 'State should still have 3 entries');

    cleanup(sid);
  });

  test('4. Override marker exists → ALLOW (exit 0), marker deleted after', () => {
    const sid = sessionId('t4');
    cleanup(sid);

    // 3 compile agents — would normally block
    writeState(sid, [
      compileEntry('agent-a'),
      compileEntry('agent-b'),
      compileEntry('agent-c'),
    ]);

    // Create the bypass marker
    fs.writeFileSync(bypassFile(sid), '', 'utf-8');
    assert.ok(fs.existsSync(bypassFile(sid)), 'Marker should exist before hook run');

    const result = runHook(sid, makePayload('Agent', 'cargo build --release'));
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    // Marker should be consumed
    assert.ok(!fs.existsSync(bypassFile(sid)), 'Bypass marker should be deleted after use');

    cleanup(sid);
  });

  test('5. State file has expired entry (>15min old) → cleaned before count → ALLOW', () => {
    const sid = sessionId('t5');
    cleanup(sid);

    // 2 fresh + 1 expired (20 min ago)
    writeState(sid, [
      compileEntry('agent-a'),
      compileEntry('agent-b'),
      compileEntry('agent-expired', ago(20)), // TTL = 15min; this is expired
    ]);

    // With cleanup, only 2 active → 3rd dispatch should be allowed
    const result = runHook(sid, makePayload('Agent', 'vitest run --coverage'));
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    // After cleanup, state should have 3 entries (2 original fresh + 1 new)
    const state = readState(sid);
    const live = state.active.filter(e => e.type === 'compile-test');
    assert.equal(live.length, 3);
    assert.ok(!live.find(e => e.id === 'agent-expired'), 'Expired entry should be removed');

    cleanup(sid);
  });

  test('6. Malformed state file → recover gracefully (treat as empty)', () => {
    const sid = sessionId('t6');
    cleanup(sid);

    // Write corrupted JSON
    fs.writeFileSync(stateFile(sid), '<<<not valid json at all>>>', 'utf-8');

    // Hook should recover (treat as 0 active) and allow
    const result = runHook(sid, makePayload('Agent', 'jest --runInBand'));
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    // State should now be a valid file with 1 entry
    const state = readState(sid);
    assert.ok(state !== null, 'State file should be valid JSON after recovery');
    assert.equal(state.active.length, 1);

    cleanup(sid);
  });

});
