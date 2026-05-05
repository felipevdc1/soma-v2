'use strict';
// audit-contract-cli.test.cjs — T-02: contract tests for cli-soma-audit.md
// @spec AC-02, AC-04, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14
// @contract contracts/cli-soma-audit.md

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const AUDIT = path.join(__dirname, '..', 'audit.cjs');
const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'audit');
const MODULE_LIB = path.join(FIXTURE_DIR, 'module-lib.cjs');
const MODULE_CLI = path.join(FIXTURE_DIR, 'module-cli.cjs');

function runAudit(args, env = {}) {
  return spawnSync('node', [AUDIT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 35000,
  });
}

// ---- AC-11: stdout schema matches soma-audit/v1 ----

test('AC-11: audit success returns soma-audit/v1 schema', () => {
  const r = runAudit(['--module', MODULE_LIB, '--no-claude'], { SOMA_SAFE_PATHS_ONLY: '0' });
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, 'soma-audit/v1', 'schema field must be soma-audit/v1');
  // Required top-level fields
  for (const field of ['schema', 'module', 'capabilities', 'bugs', 'recent_changes', 'recommended_spec_scope', 'warnings', 'duration_ms']) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, field), `Required field missing: ${field}`);
  }
});

// ---- AC-04: module not found → exit 1 + structured stderr ----

test('AC-04: missing module path → exit 1 with MODULE_NOT_FOUND', () => {
  const r = runAudit(['--module', '/tmp/nonexistent-soma-audit-test.cjs'], { SOMA_SAFE_PATHS_ONLY: '0' });
  assert.equal(r.status, 1, `Expected exit 1, got ${r.status}`);
  const err = JSON.parse(r.stderr.trim().split('\n').pop());
  assert.equal(err.code, 'MODULE_NOT_FOUND', `Expected MODULE_NOT_FOUND, got: ${err.code}`);
  assert.ok(err.message, 'message must be present');
  assert.ok(err.hint, 'hint must be present');
});

// ---- AC-12: stderr on failure is machine-parseable JSON ----

test('AC-12: failure stderr is single-line machine-parseable JSON', () => {
  const r = runAudit(['--module', '/tmp/totally-missing.cjs'], { SOMA_SAFE_PATHS_ONLY: '0' });
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  // Last line must be parseable JSON with {code, message, hint}
  const last = lines[lines.length - 1];
  const err = JSON.parse(last);
  assert.ok(err.code, 'code field required');
  assert.ok(err.message, 'message field required');
  assert.ok(Object.prototype.hasOwnProperty.call(err, 'hint'), 'hint field required');
});

// ---- AC-02 / AC-14: sandbox violation ----

test('AC-02: SOMA_SAFE_PATHS_ONLY=1 + path outside sandbox → exit 1 SANDBOX_VIOLATION', () => {
  const r = runAudit(['--module', '/etc/hosts'], { SOMA_SAFE_PATHS_ONLY: '1' });
  assert.equal(r.status, 1, `Expected exit 1, got ${r.status}`);
  const lines = r.stderr.trim().split('\n');
  const err = JSON.parse(lines[lines.length - 1]);
  assert.equal(err.code, 'SANDBOX_VIOLATION', `Expected SANDBOX_VIOLATION, got ${err.code}`);
  assert.ok(err.hint, 'hint must be present');
});

test('AC-14: SOMA_SAFE_PATHS_ONLY=1 enforces even if file exists', () => {
  // /etc/hosts exists but is outside soma sandbox
  const r = runAudit(['--module', '/etc/hosts'], { SOMA_SAFE_PATHS_ONLY: '1' });
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  const err = JSON.parse(lines[lines.length - 1]);
  assert.equal(err.code, 'SANDBOX_VIOLATION');
});

test('AC-02: SOMA_SAFE_PATHS_ONLY=0 (default) does NOT block paths outside soma', () => {
  // With sandbox off, only MODULE_NOT_FOUND for nonexistent file (not SANDBOX_VIOLATION)
  const r = runAudit(['--module', '/tmp/nonexistent-soma-audit-test.cjs'], { SOMA_SAFE_PATHS_ONLY: '0' });
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split('\n');
  const err = JSON.parse(lines[lines.length - 1]);
  assert.equal(err.code, 'MODULE_NOT_FOUND');
});

// ---- AC-09: marker file created on success ----

test('AC-09: marker file created on successful audit', () => {
  // Clean up any existing markers with test prefix
  const tmpFiles = fs.readdirSync('/tmp').filter(f => f.startsWith('soma-discovery-done-test-'));
  tmpFiles.forEach(f => fs.rmSync(path.join('/tmp', f)));

  const r = runAudit(['--module', MODULE_LIB, '--no-claude'], {
    SOMA_SAFE_PATHS_ONLY: '0',
    SOMA_SESSION_ID: 'test-contract-marker',
  });
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const markerExists = fs.existsSync('/tmp/soma-discovery-done-test-contract-marker');
  assert.ok(markerExists, 'marker file /tmp/soma-discovery-done-test-contract-marker must exist after successful audit');
});

// ---- AC-10: SESSION_ID_FALLBACK logged to stderr when env vars absent ----

test('AC-10: session ID fallback warning in stderr when env vars absent', () => {
  // Unset all session env vars AND remove marker file to force hostname-pid fallback
  const env = { ...process.env };
  delete env.SOMA_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  delete env.CK_SESSION_ID;
  delete env.ITERM_SESSION_ID;

  // Remove soma-session-id marker file so hierarchy falls through to hostname-pid
  try { require('node:fs').rmSync('/tmp/soma-session-id'); } catch {}

  const r = spawnSync('node', [AUDIT, '--module', MODULE_LIB, '--no-claude'], {
    env,
    encoding: 'utf8',
    timeout: 35000,
  });
  // exit 0 (success)
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  // stderr must contain SESSION_ID_FALLBACK warning
  assert.ok(r.stderr.includes('SESSION_ID_FALLBACK'), `Expected SESSION_ID_FALLBACK in stderr. Got: ${r.stderr}`);
  // stdout JSON must NOT contain SESSION_ID_FALLBACK (it's stderr only)
  const out = JSON.parse(r.stdout);
  const warningCodes = out.warnings.map(w => w.code);
  assert.ok(!warningCodes.includes('SESSION_ID_FALLBACK'), 'SESSION_ID_FALLBACK must NOT be in stdout warnings array');
});

// ---- AC-13: telemetry JSONL written ----

test('AC-13: telemetry JSONL line appended after audit', () => {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(os.homedir(), '.claude', 'logs', `article-xii-${today}.jsonl`);

  const linesBefore = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).length
    : 0;

  const r = runAudit(['--module', MODULE_LIB, '--no-claude'], {
    SOMA_SAFE_PATHS_ONLY: '0',
    SOMA_SESSION_ID: 'test-telemetry',
  });
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);

  assert.ok(fs.existsSync(logPath), `Telemetry log ${logPath} must exist after audit`);
  const linesAfter = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).length;
  assert.ok(linesAfter > linesBefore, `Telemetry must append at least 1 line. before=${linesBefore} after=${linesAfter}`);

  // Verify the last line has required fields
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.schema, 'article-xii-telemetry/v1', 'telemetry schema');
  assert.ok(['audit-completed', 'audit-failed'].includes(last.action), 'action field');
  assert.ok(last.module_path, 'module_path field');
  assert.ok(Object.prototype.hasOwnProperty.call(last, 'exit_code'), 'exit_code field');
  assert.ok(Object.prototype.hasOwnProperty.call(last, 'duration_ms'), 'duration_ms field');
  assert.ok(Object.prototype.hasOwnProperty.call(last, 'warnings_count'), 'warnings_count field');
  assert.ok(Object.prototype.hasOwnProperty.call(last, 'claude_cli_used'), 'claude_cli_used field');
});

// ---- AC-01: module data populated ----

test('AC-01: deterministic module data present in output', () => {
  const r = runAudit(['--module', MODULE_LIB, '--no-claude'], { SOMA_SAFE_PATHS_ONLY: '0' });
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.module.path, 'module.path must be present');
  assert.ok(typeof out.module.loc === 'number' && out.module.loc > 0, 'module.loc must be positive integer');
  assert.ok(Array.isArray(out.module.exports), 'module.exports must be array');
  assert.ok(Array.isArray(out.module.recent_commits), 'module.recent_commits must be array');
  assert.ok(typeof out.module.test_count === 'number', 'module.test_count must be integer');
});
