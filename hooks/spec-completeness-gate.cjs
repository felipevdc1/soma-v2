#!/usr/bin/env node
/**
 * PreToolUse Hook — Spec Completeness Gate
 * Part of: SOMA v2 / Master Claude Protocol (P24)
 *
 * Fires: Before every Bash tool call
 * Purpose: Block git commits when SOMA spec has open [NEEDS CLARIFICATION]
 *          markers or uncovered acceptance criteria.
 *
 * Exit Codes:
 *   0 - Allow (not a commit, no SOMA session, all clear, bypass consumed)
 *   2 - Block (open markers or uncovered ACs)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function readJsonSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function parseAcIds(specContent) {
  const ids = [];
  for (const line of specContent.split('\n')) {
    const m = line.match(/^AC-(\d+):/);
    if (m) ids.push(`AC-${m[1]}`);
  }
  return ids;
}

function parseCoveredAcs(tasksContent) {
  const covered = new Set();
  for (const m of tasksContent.matchAll(/\[SPEC:(AC-\d+)\]/g)) {
    covered.add(m[1]);
  }
  return covered;
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const command = (payload.tool_input || {}).command || '';

    // Only intercept git commit commands
    if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

    // Exempt: amend no-edit
    if (/git\s+commit\s+.*--amend.*--no-edit/.test(command)) process.exit(0);

    // Exempt: WIP commits
    if (/git\s+commit\s+-m\s+['"]WIP:/.test(command)) process.exit(0);

    const sessionId = getSessionId();
    const tmpDir = os.tmpdir();
    const statePath = path.join(tmpDir, `soma-state-${sessionId}.json`);

    // No SOMA session → pass silently
    if (!fs.existsSync(statePath)) process.exit(0);

    // Check bypass marker (one-time escape hatch)
    const bypassMarker = path.join(tmpDir, `soma-spec-bypass-${sessionId}.marker`);
    if (fs.existsSync(bypassMarker)) {
      try { fs.unlinkSync(bypassMarker); } catch (_) {}
      process.exit(0);
    }

    // Read SOMA state — fail-open on bad JSON
    let state;
    try {
      state = readJsonSafe(statePath);
    } catch (e) {
      process.stderr.write(`[spec-completeness-gate] WARN: could not parse soma-state: ${e.message}\n`);
      process.exit(0);
    }

    const { specPath, tasksPath } = state || {};

    // Spec file missing → fail-open
    if (!specPath || !fs.existsSync(specPath)) {
      process.stderr.write(`[spec-completeness-gate] WARN: specPath missing or not found (${specPath})\n`);
      process.exit(0);
    }

    let specContent;
    try {
      specContent = fs.readFileSync(specPath, 'utf-8');
    } catch (e) {
      process.stderr.write(`[spec-completeness-gate] WARN: could not read spec: ${e.message}\n`);
      process.exit(0);
    }

    // 1. Count open [NEEDS CLARIFICATION markers
    const markerCount = (specContent.match(/\[NEEDS CLARIFICATION/g) || []).length;
    if (markerCount > 0) {
      process.stderr.write(
        `\nSPEC INCOMPLETE: ${markerCount} marker${markerCount > 1 ? 's' : ''} open in ${specPath}\n` +
        `Resolve all [NEEDS CLARIFICATION] markers before committing.\n`
      );
      process.exit(2);
    }

    // 2. Check AC coverage — skip if no tasksPath
    const acIds = parseAcIds(specContent);
    if (acIds.length === 0) process.exit(0);

    if (!tasksPath || !fs.existsSync(tasksPath)) {
      process.stderr.write(`[spec-completeness-gate] WARN: tasksPath missing or not found (${tasksPath})\n`);
      process.exit(0);
    }

    let tasksContent;
    try {
      tasksContent = fs.readFileSync(tasksPath, 'utf-8');
    } catch (e) {
      process.stderr.write(`[spec-completeness-gate] WARN: could not read tasks: ${e.message}\n`);
      process.exit(0);
    }

    const covered = parseCoveredAcs(tasksContent);
    const uncovered = acIds.filter(id => !covered.has(id));

    if (uncovered.length > 0) {
      process.stderr.write(
        `\nSPEC INCOMPLETE: ${uncovered.length} AC${uncovered.length > 1 ? 's' : ''} uncovered in ${specPath}\n` +
        `Uncovered: ${uncovered.join(', ')}\n` +
        `Add [SPEC:AC-XX] tags to tasks covering these criteria before committing.\n`
      );
      process.exit(2);
    }

    process.exit(0);
  } catch (_) {
    process.exit(0); // Fail-open
  }
}

main();
