'use strict';
// audit-telemetry.cjs — SOMA audit telemetry JSONL appender (Spec 012 T-08)
// @spec AC-13

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getLogPath(date) {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const logsDir = path.join(os.homedir(), '.claude', 'logs');
  return path.join(logsDir, `article-xii-${dateStr}.jsonl`);
}

/**
 * Append a telemetry JSONL line.
 * Schema: article-xii-telemetry/v1
 * @spec AC-13
 */
function writeTelemetry({ action, module_path, exit_code, duration_ms, warnings_count, claude_cli_used, session_id_source, _logPath, _date } = {}) {
  const entry = {
    ts: new Date().toISOString(),
    schema: 'article-xii-telemetry/v1',
    action: action || 'audit-completed',
    module_path: module_path || '',
    exit_code: typeof exit_code === 'number' ? exit_code : 0,
    duration_ms: typeof duration_ms === 'number' ? duration_ms : 0,
    warnings_count: typeof warnings_count === 'number' ? warnings_count : 0,
    claude_cli_used: !!claude_cli_used,
    session_id_source: session_id_source || 'unknown',
  };

  const logPath = _logPath || getLogPath(_date);

  try {
    // Ensure logs directory exists
    const logsDir = path.dirname(logPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Non-fatal — telemetry failure must not break audit
    process.stderr.write(`[audit-telemetry] Failed to write telemetry: ${err.message}\n`);
  }
}

module.exports = { writeTelemetry, getLogPath };
