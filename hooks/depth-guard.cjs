#!/usr/bin/env node
/**
 * PreToolUse Hook — Depth Guard (Spec Checklist Gate)
 * Part of: Master Claude Protocol
 *
 * Fires: Before every Edit/Write tool call
 * Purpose: Remind about unchecked plan items to prevent premature completion
 * Standalone: No external dependencies (works without ClaudeKit)
 *
 * Exit Codes:
 *   0 - Always (non-blocking reminder only)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RATE_LIMIT_SECONDS = 120;

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function getMarkerPath(sessionId) {
  return path.join(os.tmpdir(), `depth-guard-last-${sessionId}.marker`);
}

function isRateLimited(sessionId) {
  try {
    const markerPath = getMarkerPath(sessionId);
    if (!fs.existsSync(markerPath)) return false;
    const stat = fs.statSync(markerPath);
    return (Date.now() - stat.mtimeMs) / 1000 < RATE_LIMIT_SECONDS;
  } catch (_) {
    return false;
  }
}

function updateMarker(sessionId) {
  try { fs.writeFileSync(getMarkerPath(sessionId), String(Date.now())); } catch (_) {}
}

/**
 * Find active plan file — standalone resolution (no ClaudeKit dependency)
 * Checks: session state file → ~/.claude/plans/ directory
 */
function findActivePlan(sessionId) {
  // Method 1: Session state file (written by ClaudeKit session-init if present)
  try {
    const statePath = path.join(os.tmpdir(), `ck-session-${sessionId}.json`);
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.activePlan && fs.existsSync(state.activePlan)) return state.activePlan;
    }
  } catch (_) {}

  // Method 2: Most recently modified .md in ~/.claude/plans/
  try {
    const plansDir = path.join(os.homedir(), '.claude', 'plans');
    if (!fs.existsSync(plansDir)) return null;
    const files = fs.readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(plansDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) return path.join(plansDir, files[0].name);
  } catch (_) {}

  return null;
}

function findPlanFile(planPath) {
  try {
    const stat = fs.statSync(planPath);
    if (stat.isFile()) return planPath;
    for (const name of ['plan.md', 'PLAN.md']) {
      const candidate = path.join(planPath, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const firstMd = fs.readdirSync(planPath).find(e => e.endsWith('.md'));
    return firstMd ? path.join(planPath, firstMd) : null;
  } catch (_) {
    return null;
  }
}

function parseCheckboxes(content) {
  const lines = content.split('\n');
  const unchecked = [];
  let checkedCount = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^(\s*)```/.test(line)) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    const stripped = line.replace(/`[^`]*`/g, '');
    if (/- \[ \]/.test(stripped)) {
      unchecked.push(stripped.replace(/^.*- \[ \]\s*/, '').trim());
    } else if (/- \[[xX]\]/.test(stripped)) {
      checkedCount++;
    }
  }

  return { unchecked, checkedCount };
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);
    JSON.parse(stdin);

    const sessionId = getSessionId();
    const planPath = findActivePlan(sessionId);
    if (!planPath) process.exit(0);

    const planFile = findPlanFile(planPath);
    if (!planFile) process.exit(0);

    const content = fs.readFileSync(planFile, 'utf-8');
    const { unchecked, checkedCount } = parseCheckboxes(content);
    if (unchecked.length === 0) process.exit(0);
    if (isRateLimited(sessionId)) process.exit(0);

    const total = checkedCount + unchecked.length;
    const preview = unchecked.slice(0, 3).map(t => t.slice(0, 60));

    console.log(`[depth-guard] Plan: ${checkedCount}/${total} items done. ${unchecked.length} remaining.`);
    for (const item of preview) {
      console.log(`  - [ ] ${item}`);
    }

    updateMarker(sessionId);
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}

main();
