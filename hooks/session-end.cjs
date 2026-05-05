#!/usr/bin/env node
/**
 * SessionEnd Hook - Cleanup on session end
 *
 * Fires: When session ends (clear, compact, user exit)
 * Purpose: Delete compact marker files to reset context baseline on /clear
 *
 * Exit Codes:
 *   0 - Success (non-blocking)
 */

const fs = require('fs');
const { deleteMarker } = require('./lib/context-tracker.cjs');

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    const data = stdin ? JSON.parse(stdin) : {};
    const reason = data.reason || 'unknown';
    const sessionId = data.session_id || null;

    // Delete marker on /clear to reset context baseline
    // SessionEnd fires with OLD session_id before new session starts
    // This ensures clean slate for the next session
    if (reason === 'clear' && sessionId) {
      deleteMarker(sessionId);
    }

    // Cleanup agent-mode-gate markers for this session
    if (sessionId) {
      const os = require('os');
      const path = require('path');
      const tmpDir = os.tmpdir();
      const prefix = `claude-agent-gate-${sessionId}-`;
      try {
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith('.marker')) {
            fs.unlinkSync(path.join(tmpDir, file));
          }
        }
      } catch (_) {
        // Fail silently
      }

      // Cleanup cognitive-gate markers for this session
      const cognitiveFiles = [
        `claude-cognitive-${sessionId}.marker`,
        `claude-cognitive-bypass-${sessionId}.marker`,
        `claude-cognitive-count-${sessionId}`
      ];
      for (const file of cognitiveFiles) {
        try {
          const filePath = path.join(tmpDir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (_) {
          // Fail silently
        }
      }

      // Cleanup orchestrator markers for this session
      const orchestratorFiles = [
        `claude-direct-mode-${sessionId}.marker`,
        `claude-orchestrator-bypass-${sessionId}.marker`
      ];
      for (const file of orchestratorFiles) {
        try {
          const filePath = path.join(tmpDir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (_) {
          // Fail silently
        }
      }

      // Cleanup depth-guard markers for this session
      try {
        const dgMarker = path.join(tmpDir, `depth-guard-last-${sessionId}.marker`);
        if (fs.existsSync(dgMarker)) {
          fs.unlinkSync(dgMarker);
        }
      } catch (_) {
        // Fail silently
      }
    }

    process.exit(0);
  } catch (error) {
    process.exit(0);
  }
}

main();
