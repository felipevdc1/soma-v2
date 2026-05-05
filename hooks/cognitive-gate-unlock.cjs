#!/usr/bin/env node
/**
 * PreToolUse Hook — Cognitive Gate Unlock
 *
 * Fires: Before EnterPlanMode tool calls
 * Purpose: Create thinking marker when user enters plan mode
 *
 * This unlocks the cognitive-gate for the rest of the session,
 * since entering plan mode = thinking happened.
 *
 * Exit Codes:
 *   0 - Always allow (non-blocking)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getSessionId(payload) {
  return payload?.session_id || process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function createThinkingMarker(sessionId, reason) {
  const markerPath = path.join(os.tmpdir(), `claude-cognitive-${sessionId}.marker`);
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      created: new Date().toISOString(),
      reason,
      sessionId
    }));
  } catch (_) {
    // Fail silently
  }
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    const payload = stdin ? JSON.parse(stdin) : {};
    const sessionId = getSessionId(payload);
    createThinkingMarker(sessionId, 'plan-mode-entered');

    // Light confirmation
    console.log('[cognitive-gate] Thinking marker created. Code editing unlocked.');
    process.exit(0);
  } catch (error) {
    process.exit(0);
  }
}

main();
