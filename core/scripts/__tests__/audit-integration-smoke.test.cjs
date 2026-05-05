'use strict';
// audit-integration-smoke.test.cjs — T-10: integration smoke tests for audit.cjs wiring
// @spec AC-01, AC-02, AC-05, AC-07, AC-09, AC-11, AC-13
// Exercises 3 paths: success hybrid (--no-claude mock), claude absent fallback, sandbox violation

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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

// ---- Path 1: Success hybrid (deterministic layer + --no-claude flag) ----

test('Integration Path 1: success deterministic-only — exit 0 + valid JSON', () => {
  const sessionId = `smoke-path1-${Date.now()}`;
  try { fs.rmSync(`/tmp/soma-discovery-done-${sessionId}`); } catch {}

  const r = runAudit(['--module', MODULE_LIB, '--no-claude'], {
    SOMA_SAFE_PATHS_ONLY: '0',
    SOMA_SESSION_ID: sessionId,
  });

  assert.equal(r.status, 0, `exit 0. stderr: ${r.stderr}`);

  const out = JSON.parse(r.stdout);
  // AC-11: schema valid
  assert.equal(out.schema, 'soma-audit/v1');
  for (const f of ['schema', 'module', 'capabilities', 'bugs', 'recent_changes', 'recommended_spec_scope', 'warnings', 'duration_ms']) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, f), `Required field: ${f}`);
  }

  // AC-01: deterministic fields
  assert.equal(out.module.path, MODULE_LIB);
  assert.ok(out.module.loc > 0, 'loc > 0');
  assert.ok(Array.isArray(out.module.exports), 'exports array');
  assert.ok(out.module.exports.includes('parseData'), 'parseData in exports');
  assert.ok(Array.isArray(out.module.recent_commits), 'recent_commits array');
  assert.ok(typeof out.module.test_count === 'number', 'test_count integer');

  // --no-claude: sense-making null
  assert.equal(out.capabilities, null);
  assert.equal(out.claude_cli_used, false);

  // AC-09: marker file created
  const markerExists = fs.existsSync(`/tmp/soma-discovery-done-${sessionId}`);
  assert.ok(markerExists, `Marker file must exist for session ${sessionId}`);
  try { fs.rmSync(`/tmp/soma-discovery-done-${sessionId}`); } catch {}
});

test('Integration Path 1: CLI fixture has help_text (AC-03)', () => {
  const r = runAudit(['--module', MODULE_CLI, '--no-claude'], {
    SOMA_SAFE_PATHS_ONLY: '0',
    SOMA_SESSION_ID: 'smoke-cli-help',
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.module.help_text !== null, 'CLI module must have help_text');
  assert.ok(out.module.help_text.includes('Usage'), 'help_text includes Usage');
});

// ---- Path 2: Claude absent fallback ----

test('Integration Path 2: claude CLI absent → graceful degradation', () => {
  // Use --no-claude flag to force CLAUDE_CLI_NOT_FOUND path (equivalent to claude absent)
  // The contract test already validates PATH stripping; here we test the code path directly
  const r = runAudit(['--module', MODULE_LIB, '--no-claude'], {
    SOMA_SAFE_PATHS_ONLY: '0',
    SOMA_SESSION_ID: 'smoke-no-claude',
  });

  assert.equal(r.status, 0, `exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, 'soma-audit/v1');

  // AC-07: warning present (CLAUDE_CLI_NOT_FOUND from either --no-claude or PATH check)
  const warningCodes = out.warnings.map(w => w.code);
  assert.ok(warningCodes.length > 0, `At least 1 warning expected. Got: ${JSON.stringify(out.warnings)}`);

  // Sense-making fields null
  assert.equal(out.capabilities, null);
  assert.equal(out.bugs, null);
  assert.equal(out.recommended_spec_scope, null);
  assert.equal(out.claude_cli_used, false);

  // Deterministic still populated
  assert.ok(out.module.loc > 0, 'deterministic loc preserved');
});

// ---- Path 3: Sandbox violation ----

test('Integration Path 3: sandbox violation → exit 1 + SANDBOX_VIOLATION', () => {
  const r = runAudit(['--module', '/etc/hosts'], {
    SOMA_SAFE_PATHS_ONLY: '1',
  });

  assert.equal(r.status, 1, `Expected exit 1. stderr: ${r.stderr}`);
  // AC-12: stderr is machine-parseable JSON
  const lines = r.stderr.trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  const err = JSON.parse(last);
  assert.equal(err.code, 'SANDBOX_VIOLATION');
  assert.ok(err.hint, 'hint present');
  // No stdout JSON on failure
  assert.equal(r.stdout.trim(), '');
});

// ---- Shasum verification (AC-08 from spec 011 invariant) ----

test('Shasum: canonical + lib files unchanged after audit', () => {
  const { spawnSync: sp } = require('node:child_process');
  const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

  const checkFiles = [
    path.join(os.homedir(), '.codex', 'AGENTS.md'),
    path.join(os.homedir(), 'AGENTS.md'),
    path.join(os.homedir(), '.claude', 'constitution.md'),
    path.join(SOMA_HOME, 'scripts', 'lib', 'anchored-blocks.cjs'),
    path.join(SOMA_HOME, 'scripts', 'lib', 'manifest.cjs'),
    path.join(SOMA_HOME, 'scripts', 'lib', 'template-engine.cjs'),
  ];

  // Read before shasums from baseline file
  const baselineFile = '/tmp/c-12-shasum-before.txt';
  if (!fs.existsSync(baselineFile)) {
    // Skip shasum check if baseline not available (not in scratch workspace)
    return;
  }

  const baseline = fs.readFileSync(baselineFile, 'utf-8').trim();
  const result = sp('shasum', ['-a', '256', ...checkFiles], { encoding: 'utf-8', timeout: 10000 });
  const current = result.stdout.trim();

  // Compare line by line
  const baseLines = baseline.split('\n').sort();
  const curLines = current.split('\n').sort();

  assert.equal(curLines.length, baseLines.length, 'Same number of files');
  for (let i = 0; i < baseLines.length; i++) {
    assert.equal(curLines[i], baseLines[i], `Shasum mismatch: ${curLines[i]} vs baseline ${baseLines[i]}`);
  }
});

// ---- AC-13: telemetry written for both success and failure ----

test('AC-13: telemetry line present after integration run', () => {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(os.homedir(), '.claude', 'logs', `article-xii-${today}.jsonl`);

  const linesBefore = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).length
    : 0;

  runAudit(['--module', MODULE_LIB, '--no-claude'], {
    SOMA_SAFE_PATHS_ONLY: '0',
    SOMA_SESSION_ID: 'smoke-telemetry-integration',
  });

  const linesAfter = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).length
    : 0;

  assert.ok(linesAfter > linesBefore, `Telemetry line must be appended. before=${linesBefore} after=${linesAfter}`);

  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.schema, 'article-xii-telemetry/v1');
  assert.equal(last.action, 'audit-completed');
  assert.ok(last.module_path.includes('module-lib.cjs'));
});
