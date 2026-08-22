#!/usr/bin/env node
/**
 * PreToolUse Hook — Thermal Guard
 *
 * Fires: Before every Agent tool call
 * Purpose: Limit concurrent compile/test agents to max 3 (Article V, SOMA v2)
 *
 * State file: /tmp/claude-thermal-state-{sessionId}.json
 *   Schema: { active: [{id, type, startedAt, ttl}], lastCleanup }
 *
 * Override marker: /tmp/claude-thermal-bypass-{sessionId}.marker
 *   Creates a one-time bypass; consumed (deleted) on use.
 *
 * Exit codes:
 *   0 — allow
 *   2 — block (compile/test limit exceeded)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const COMPILE_LIMIT = 3;
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

const COMPILE_KEYWORDS = [
  'compile', 'test', 'build',
  'npm run', 'npm test', 'npm start',
  'cargo', 'go build', 'go test',
  'tsc', 'vitest', 'jest', 'pytest',
  'node --test', 'mocha',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSessionId() {
  return (
    process.env.CK_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    `pid-${process.ppid}`
  );
}

function stateFilePath(sessionId) {
  return path.join(os.tmpdir(), `claude-thermal-state-${sessionId}.json`);
}

function bypassMarkerPath(sessionId) {
  return path.join(os.tmpdir(), `claude-thermal-bypass-${sessionId}.marker`);
}

/**
 * Classify a dispatch prompt as "compile-test" or "read-only".
 */
function classifyPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'read-only';
  const lower = prompt.toLowerCase();
  for (const kw of COMPILE_KEYWORDS) {
    if (lower.includes(kw)) return 'compile-test';
  }
  return 'read-only';
}

/**
 * Load state from disk. Returns empty state on any error (fail-open for state).
 */
function loadState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Validate minimal structure
    if (!Array.isArray(parsed.active)) {
      return { active: [], lastCleanup: new Date().toISOString() };
    }
    return parsed;
  } catch (_) {
    return { active: [], lastCleanup: new Date().toISOString() };
  }
}

/**
 * Save state atomically (write to tmp then rename).
 */
function saveState(filePath, state) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * Remove entries whose TTL has expired.
 */
function cleanupExpired(state, nowMs) {
  state.active = state.active.filter((entry) => {
    const age = nowMs - new Date(entry.startedAt).getTime();
    return age < (entry.ttl || DEFAULT_TTL_MS);
  });
  state.lastCleanup = new Date(nowMs).toISOString();
  return state;
}

/**
 * Format a list of active agents for the diagnostic message.
 */
function formatActiveList(activeEntries) {
  if (!activeEntries.length) return '(none)';
  return activeEntries
    .map((e) => {
      const age = Math.round((Date.now() - new Date(e.startedAt).getTime()) / 1000);
      return `  • ${e.id} (${e.type}, ${age}s ago)`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sessionId = getSessionId();
  const stateFile = stateFilePath(sessionId);
  const bypassFile = bypassMarkerPath(sessionId);

  let payload;
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);
    payload = JSON.parse(stdin);
  } catch (_) {
    process.exit(0); // Fail-open on parse error
  }

  try {
    // Only intercept Agent tool calls (TeamCreate foi removido do Claude Code)
    const toolName = payload.tool_name || payload.tool || '';
    if (!/^Agent$/i.test(toolName)) {
      process.exit(0);
    }

    // Extract the agent prompt from tool input
    const toolInput = payload.tool_input || {};
    const prompt =
      toolInput.prompt ||
      toolInput.description ||
      toolInput.task ||
      '';

    // Classify the dispatch
    const agentType = classifyPrompt(prompt);

    // Read-only agents always pass through
    if (agentType === 'read-only') {
      process.exit(0);
    }

    // --- compile-test agent: enforce limit ---

    // Check one-time bypass marker
    if (fs.existsSync(bypassFile)) {
      try { fs.unlinkSync(bypassFile); } catch (_) {}
      process.stderr.write(
        '[thermal-guard] WARNING: one-time bypass marker consumed. Dispatch allowed.\n'
      );
      process.exit(0);
    }

    // Load + cleanup + count
    const nowMs = Date.now();
    let state = loadState(stateFile);
    state = cleanupExpired(state, nowMs);

    const activeCompile = state.active.filter((e) => e.type === 'compile-test');
    const count = activeCompile.length;

    if (count >= COMPILE_LIMIT) {
      // BLOCK
      const agentId = toolInput.id || toolInput.name || `agent-${Date.now()}`;
      process.stderr.write(
        `THERMAL GUARD: ${count}/${COMPILE_LIMIT} compile agents active. ` +
        `Blocked: compile-test (${agentId}).\n` +
        `Active:\n${formatActiveList(activeCompile)}\n` +
        `Wait for an active agent to finish, or create the override marker:\n` +
        `  touch ${bypassFile}\n`
      );
      process.exit(2);
    }

    // ALLOW — register the new agent in state
    const agentId =
      toolInput.id || toolInput.name || `agent-${Date.now()}`;
    state.active.push({
      id: agentId,
      type: 'compile-test',
      startedAt: new Date(nowMs).toISOString(),
      ttl: DEFAULT_TTL_MS,
    });
    saveState(stateFile, state);

    process.exit(0);
  } catch (_) {
    process.exit(0); // Fail-open on any unexpected error
  }
}

main();
