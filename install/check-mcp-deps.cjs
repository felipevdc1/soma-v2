'use strict';

/**
 * install/check-mcp-deps.cjs — check MCP server dependencies are present
 *
 * Always exits 0 (warn-and-continue). Prints warnings to stderr.
 *
 * Public API:
 *   checkMcpDeps(opts?)  → { missing: string[], present: string[], warnings: string[] }
 *     opts.settings  — pre-parsed settings object (for tests)
 *     opts.settingsPath — path to settings.json (default: ~/.claude/settings.json)
 *
 * CLI:
 *   node check-mcp-deps.cjs
 *   Always exits 0; prints [WARN] lines to stderr.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const os = require('node:os');

/**
 * Attempt to resolve a command name on PATH.
 * @param {string} cmd
 * @returns {boolean}
 */
function commandOnPath(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${which} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve whether a single MCP server entry is "present" (its required binary/script exists).
 *
 * Entry shape (typical):
 *   { command: "node", args: ["/path/to/server.js"] }
 * OR:
 *   { command: "/path/to/binary" }
 *
 * Detection strategy:
 *   1. If args[0] is an absolute path → check fs.existsSync(args[0])
 *   2. Else if command is an absolute path → check fs.existsSync(command)
 *   3. Else → command-name lookup via which/where
 *
 * @param {object} entry — mcpServers entry value
 * @returns {boolean}
 */
function isEntryPresent(entry) {
  if (!entry || typeof entry !== 'object') return false;

  const { command, args } = entry;

  // Check script path from args first (most common case: node + script)
  if (Array.isArray(args) && args.length > 0) {
    const firstArg = args[0];
    if (typeof firstArg === 'string' && path.isAbsolute(firstArg)) {
      return fs.existsSync(firstArg);
    }
  }

  // Command is an absolute path
  if (typeof command === 'string' && path.isAbsolute(command)) {
    return fs.existsSync(command);
  }

  // Command is a name — look up on PATH
  if (typeof command === 'string' && command.length > 0) {
    return commandOnPath(command);
  }

  return false;
}

/**
 * Check MCP server dependencies.
 *
 * @param {{ settings?: object|null, settingsPath?: string }} [opts]
 * @returns {{ missing: string[], present: string[], warnings: string[] }}
 */
function checkMcpDeps(opts) {
  opts = opts || {};

  let settings = opts.settings;

  // Load from file if settings not injected
  if (settings === undefined) {
    const settingsPath = opts.settingsPath || path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = null;
      }
    } else {
      settings = null;
    }
  }

  const result = { missing: [], present: [], warnings: [] };

  if (!settings || !settings.mcpServers || typeof settings.mcpServers !== 'object') {
    return result;
  }

  for (const [name, entry] of Object.entries(settings.mcpServers)) {
    if (isEntryPresent(entry)) {
      result.present.push(name);
    } else {
      result.missing.push(name);
      const warning = `[SOMA] MCP server '${name}' may be unavailable: command/script not found`;
      result.warnings.push(warning);
    }
  }

  return result;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const result = checkMcpDeps();

  if (result.warnings.length === 0 && result.missing.length === 0) {
    if (result.present.length > 0) {
      process.stderr.write(`[SOMA] MCP servers OK: ${result.present.join(', ')}\n`);
    }
    // No mcpServers key — silent
  } else {
    for (const w of result.warnings) {
      process.stderr.write(w + '\n');
    }
  }

  // Always exit 0 (warn-and-continue)
  process.exit(0);
}

module.exports = { checkMcpDeps };
