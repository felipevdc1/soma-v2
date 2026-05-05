#!/usr/bin/env node
'use strict';
/**
 * audit.cjs — SOMA v2 audit CLI (Spec 012)
 *
 * Usage:
 *   node ~/.soma-v2/scripts/audit.cjs --module <path> [--no-claude] [--timeout-ms <ms>]
 *
 * Exit codes:
 *   0 — audit completed (deterministic-only OR hybrid)
 *   1 — fatal error (SANDBOX_VIOLATION, MODULE_NOT_FOUND)
 *   2 — invalid args
 *
 * @spec AC-01..AC-15
 * @contract contracts/cli-soma-audit.md, contracts/cli-claude-invocation.md
 */

const path = require('node:path');
const os = require('node:os');

// Lazy-loaded lib helpers (set after T-01 skeleton → replaced in Wave 2)
let deterministic, sandbox, session, claudeInvoker, telemetry, schema;

function loadLibs() {
  deterministic = require('./lib/audit-deterministic.cjs');
  sandbox = require('./lib/audit-sandbox.cjs');
  session = require('./lib/audit-session.cjs');
  claudeInvoker = require('./lib/audit-claude.cjs');
  telemetry = require('./lib/audit-telemetry.cjs');
  schema = require('./lib/audit-schema.cjs');
}

// ---- Arg parsing ----

function parseArgs(argv) {
  const flags = {
    module: null,
    noClaude: false,
    timeoutMs: 60000,
  };
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--module' && i + 1 < argv.length) {
      flags.module = argv[++i];
    } else if (arg.startsWith('--module=')) {
      flags.module = arg.slice('--module='.length);
    } else if (arg === '--no-claude') {
      flags.noClaude = true;
    } else if (arg === '--timeout-ms' && i + 1 < argv.length) {
      const v = parseInt(argv[++i], 10);
      if (isNaN(v)) errors.push(`--timeout-ms must be a number`);
      else flags.timeoutMs = v;
    } else if (arg.startsWith('--timeout-ms=')) {
      const v = parseInt(arg.slice('--timeout-ms='.length), 10);
      if (isNaN(v)) errors.push(`--timeout-ms must be a number`);
      else flags.timeoutMs = v;
    } else if (arg.startsWith('--')) {
      // ignore unknown flags silently (e.g. --check-red-phase)
    }
  }

  if (!flags.module) errors.push('--module <path> is required');

  return { flags, errors };
}

// ---- Main entry ----

async function main(argv, { spawnFn } = {}) {
  const startMs = Date.now();
  const { flags, errors } = parseArgs(argv);
  const warnings = [];

  if (errors.length > 0) {
    process.stderr.write(JSON.stringify({ code: 'INVALID_ARGS', message: errors.join('; '), hint: 'Run with --module <path>' }) + '\n');
    process.exit(2);
  }

  loadLibs();

  // Resolve module path
  const modulePath = path.resolve(process.cwd(), flags.module);

  // Sandbox check
  const sbResult = sandbox.checkSandbox(modulePath);
  if (!sbResult.ok) {
    const dur = Date.now() - startMs;
    telemetry.writeTelemetry({ action: 'audit-failed', module_path: modulePath, exit_code: 1, duration_ms: dur, warnings_count: 0, claude_cli_used: false, session_id_source: 'none' });
    process.stderr.write(JSON.stringify(sbResult.error) + '\n');
    process.exit(1);
  }

  // Deterministic layer
  const detResult = deterministic.collectDeterministic(modulePath);
  if (!detResult.ok) {
    const dur = Date.now() - startMs;
    telemetry.writeTelemetry({ action: 'audit-failed', module_path: modulePath, exit_code: 1, duration_ms: dur, warnings_count: 0, claude_cli_used: false, session_id_source: 'none' });
    process.stderr.write(JSON.stringify(detResult.error) + '\n');
    process.exit(1);
  }

  const moduleData = detResult.module;
  if (detResult.warnings) warnings.push(...detResult.warnings);

  // Session ID
  const sessResult = session.resolveSessionId();
  const sessionId = sessResult.sessionId;
  const sessionIdSource = sessResult.source;
  if (sessResult.warning) {
    // AC-10: SESSION_ID_FALLBACK goes to stderr (not in JSON)
    process.stderr.write(JSON.stringify(sessResult.warning) + '\n');
  }

  // Sense-making layer (claude CLI)
  let claudeUsed = false;
  let capabilities = null;
  let bugs = null;
  let recentChanges = null;
  let recommendedSpecScope = null;

  if (!flags.noClaude) {
    const claudeResult = claudeInvoker.invokeClaude(moduleData, { timeoutMs: flags.timeoutMs, spawnFn });
    claudeUsed = claudeResult.used;
    if (claudeResult.warning) warnings.push(claudeResult.warning);
    if (claudeResult.ok) {
      capabilities = claudeResult.capabilities;
      bugs = claudeResult.bugs;
      recentChanges = claudeResult.recent_changes;
      recommendedSpecScope = claudeResult.recommended_spec_scope;
    }
  } else {
    warnings.push({ code: 'CLAUDE_CLI_NOT_FOUND', message: '--no-claude flag set; sense-making skipped' });
  }

  const durationMs = Date.now() - startMs;

  // Build output
  const output = {
    schema: 'soma-audit/v1',
    module: moduleData,
    capabilities,
    bugs,
    recent_changes: recentChanges,
    recommended_spec_scope: recommendedSpecScope,
    warnings,
    duration_ms: durationMs,
    session_id: sessionId,
    session_id_source: sessionIdSource,
    claude_cli_used: claudeUsed,
  };

  // Validate schema
  const validationErr = schema.validateOutput(output);
  if (validationErr) {
    process.stderr.write(JSON.stringify({ code: 'SCHEMA_ERROR', message: validationErr, hint: 'Internal bug in audit.cjs — report to maintainer' }) + '\n');
    process.exit(1);
  }

  // Side effects
  session.writeMarkerFile(sessionId);
  telemetry.writeTelemetry({
    action: 'audit-completed',
    module_path: modulePath,
    exit_code: 0,
    duration_ms: durationMs,
    warnings_count: warnings.length,
    claude_cli_used: claudeUsed,
    session_id_source: sessionIdSource,
  });

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => {
    process.stderr.write(JSON.stringify({ code: 'INTERNAL_ERROR', message: err.message, hint: 'Unhandled exception in audit.cjs' }) + '\n');
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
