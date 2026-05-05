'use strict';
// audit-telemetry.test.cjs — T-08: unit tests for audit-telemetry.cjs
// @spec AC-13

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { writeTelemetry, getLogPath } = require('../lib/audit-telemetry.cjs');

// ---- getLogPath ----

test('getLogPath: returns correct path for today', () => {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = getLogPath();
  assert.ok(logPath.includes(`article-xii-${today}.jsonl`), `logPath must include today. got: ${logPath}`);
  assert.ok(logPath.includes('.claude'), 'logPath must include .claude dir');
});

test('getLogPath: accepts explicit date', () => {
  const logPath = getLogPath('2026-05-03');
  assert.ok(logPath.endsWith('article-xii-2026-05-03.jsonl'));
});

// ---- writeTelemetry ----

test('AC-13: writeTelemetry appends JSONL with required fields', () => {
  const tmpDir = fs.mkdtempSync('/tmp/soma-telemetry-test-');
  const logPath = path.join(tmpDir, 'article-xii-test.jsonl');

  writeTelemetry({
    action: 'audit-completed',
    module_path: '/tmp/test.cjs',
    exit_code: 0,
    duration_ms: 1234,
    warnings_count: 2,
    claude_cli_used: true,
    session_id_source: 'CK_SESSION_ID',
    _logPath: logPath,
  });

  assert.ok(fs.existsSync(logPath), 'log file must exist');
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'must have 1 line');

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.schema, 'article-xii-telemetry/v1');
  assert.equal(entry.action, 'audit-completed');
  assert.equal(entry.module_path, '/tmp/test.cjs');
  assert.equal(entry.exit_code, 0);
  assert.equal(entry.duration_ms, 1234);
  assert.equal(entry.warnings_count, 2);
  assert.equal(entry.claude_cli_used, true);
  assert.equal(entry.session_id_source, 'CK_SESSION_ID');
  assert.ok(entry.ts, 'ts field must be present');

  fs.rmSync(tmpDir, { recursive: true });
});

test('AC-13: writeTelemetry appends multiple lines (not overwrite)', () => {
  const tmpDir = fs.mkdtempSync('/tmp/soma-telemetry-test-');
  const logPath = path.join(tmpDir, 'article-xii-test.jsonl');

  writeTelemetry({ action: 'audit-completed', module_path: '/tmp/a.cjs', exit_code: 0, duration_ms: 100, warnings_count: 0, claude_cli_used: false, session_id_source: 'test', _logPath: logPath });
  writeTelemetry({ action: 'audit-failed', module_path: '/tmp/b.cjs', exit_code: 1, duration_ms: 50, warnings_count: 1, claude_cli_used: false, session_id_source: 'test', _logPath: logPath });

  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'must have 2 lines after 2 writes');

  fs.rmSync(tmpDir, { recursive: true });
});

test('AC-13: writeTelemetry creates directory if missing', () => {
  const tmpDir = fs.mkdtempSync('/tmp/soma-telemetry-test-');
  const nestedDir = path.join(tmpDir, 'nested', 'logs');
  const logPath = path.join(nestedDir, 'article-xii-test.jsonl');

  writeTelemetry({ action: 'audit-completed', module_path: '/tmp/x.cjs', exit_code: 0, duration_ms: 10, warnings_count: 0, claude_cli_used: false, session_id_source: 'test', _logPath: logPath });

  assert.ok(fs.existsSync(logPath), 'log must be created with parent dirs');

  fs.rmSync(tmpDir, { recursive: true });
});

test('AC-13: writeTelemetry survives non-fatal errors (bad path)', () => {
  // Should not throw even if writing to a read-only directory
  assert.doesNotThrow(() => {
    writeTelemetry({
      action: 'audit-failed',
      module_path: '/tmp/x.cjs',
      exit_code: 1,
      duration_ms: 0,
      warnings_count: 0,
      claude_cli_used: false,
      session_id_source: 'test',
      _logPath: '/dev/null/impossible/path.jsonl', // will fail silently
    });
  }, 'writeTelemetry must not throw on write error');
});
