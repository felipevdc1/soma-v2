'use strict';
// audit-session.cjs — SOMA audit session ID resolution + marker file (Spec 012 T-06)
// @spec AC-09, AC-10

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MARKER_SESSION_FILE = '/tmp/soma-session-id';

/**
 * Resolve session ID using 6-deep fallback hierarchy (Q3 lock):
 * 1. SOMA_SESSION_ID env (caller-provided override)
 * 2. CLAUDE_SESSION_ID env (future-proof)
 * 3. CK_SESSION_ID env (ClaudeKit-provided UUID)
 * 4. ITERM_SESSION_ID env (stable per terminal tab)
 * 5. Marker file /tmp/soma-session-id
 * 6. hostname-pid last resort
 *
 * @spec AC-09, AC-10
 */
function resolveSessionId() {
  // 1. SOMA_SESSION_ID
  if (process.env.SOMA_SESSION_ID) {
    return { sessionId: process.env.SOMA_SESSION_ID, source: 'SOMA_SESSION_ID', warning: null };
  }

  // 2. CLAUDE_SESSION_ID
  if (process.env.CLAUDE_SESSION_ID) {
    return { sessionId: process.env.CLAUDE_SESSION_ID, source: 'CLAUDE_SESSION_ID', warning: null };
  }

  // 3. CK_SESSION_ID
  if (process.env.CK_SESSION_ID) {
    return { sessionId: process.env.CK_SESSION_ID, source: 'CK_SESSION_ID', warning: null };
  }

  // 4. ITERM_SESSION_ID
  if (process.env.ITERM_SESSION_ID) {
    return { sessionId: process.env.ITERM_SESSION_ID, source: 'ITERM_SESSION_ID', warning: null };
  }

  // 5. Marker file
  try {
    if (fs.existsSync(MARKER_SESSION_FILE)) {
      const content = fs.readFileSync(MARKER_SESSION_FILE, 'utf-8').trim();
      if (content) {
        return { sessionId: content, source: 'marker-file', warning: null };
      }
    }
    // Create marker file for future use
    const hostname = os.hostname();
    const timestamp = Date.now();
    const sessionId = `${hostname}-${timestamp}-${process.pid}`;
    fs.writeFileSync(MARKER_SESSION_FILE, sessionId, 'utf-8');
    // Falls through to return with fallback warning
  } catch {
    // Ignore file errors, fall through to last resort
  }

  // 6. hostname-pid last resort (AC-10)
  const sessionId = `${os.hostname()}-${process.pid}`;
  const warning = {
    code: 'SESSION_ID_FALLBACK',
    message: `No session ID env var found; using fallback: ${sessionId}. Set SOMA_SESSION_ID for stable discovery markers.`,
  };
  return { sessionId, source: 'hostname-pid', warning };
}

/**
 * Create discovery marker file for the β hook (discover-before-specify.cjs).
 * Single-use semantics: hook deletes on consume.
 * Per spec: path = /tmp/soma-discovery-done-{sessionId}
 * Using literal /tmp/ (not os.tmpdir()) to match hook expectations on macOS.
 * @spec AC-09
 */
function writeMarkerFile(sessionId) {
  const markerPath = `/tmp/soma-discovery-done-${sessionId}`;
  try {
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
  } catch (err) {
    // Non-fatal — audit still succeeds
    process.stderr.write(JSON.stringify({
      code: 'MARKER_WRITE_FAILED',
      message: `Could not write marker file ${markerPath}: ${err.message}`,
      hint: 'Discovery hook may not unblock; re-run audit',
    }) + '\n');
  }
}

module.exports = { resolveSessionId, writeMarkerFile, MARKER_SESSION_FILE };
