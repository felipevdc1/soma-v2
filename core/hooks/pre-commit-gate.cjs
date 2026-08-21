#!/usr/bin/env node
/**
 * PreToolUse Hook — Pre-Commit Gate
 * Part of: Master Claude Protocol
 *
 * Fires: Before every Bash tool call
 * Purpose: Block git commit when plan has unchecked items
 * Standalone: No external dependencies
 *
 * Exit Codes:
 *   0 - Allow (not a commit, or no plan, or all items checked)
 *   2 - Block (commit with unchecked items)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function findActivePlan(sessionId) {
  // Opt-in only: only act when a session state file explicitly tracks an active plan.
  // No fallback to most-recent plan in ~/.claude/plans/ — that caused false positives
  // in sub-agent contexts where any handoff file (with unchecked next-steps) would
  // be picked up and block git commit in unrelated /tmp repos.
  try {
    const statePath = path.join(os.tmpdir(), `ck-session-${sessionId}.json`);
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.activePlan && fs.existsSync(state.activePlan)) return state.activePlan;
    }
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

// D26: heading that marks a section owned by the human reviewer — items under
// it don't count toward the commit gate (Article II self-approval fix).
// Canonical: "Revisão do humano". Single accepted English variant: "Human
// Review" — kept to exactly one, no large synonym list (YAGNI).
const REVIEW_SECTION_HEADINGS = new Set(['revisao do humano', 'human review']);

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function isReviewSectionHeading(headingText) {
  const normalized = stripDiacritics(headingText).toLowerCase().trim().replace(/\s+/g, ' ');
  return REVIEW_SECTION_HEADINGS.has(normalized);
}

function countUnchecked(content) {
  const lines = content.split('\n');
  const unchecked = [];
  let inCodeBlock = false;
  let inReviewSection = false;
  let reviewSectionLevel = null;

  for (const line of lines) {
    if (/^(\s*)```/.test(line)) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;

    // D26: track heading level to open/close the human-review section.
    // A heading of equal-or-higher rank (same or fewer #'s) closes it;
    // nested subheadings (more #'s) stay inside it.
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (inReviewSection && level <= reviewSectionLevel) {
        inReviewSection = false;
        reviewSectionLevel = null;
      }
      if (isReviewSectionHeading(headingMatch[2])) {
        inReviewSection = true;
        reviewSectionLevel = level;
      }
      continue;
    }

    if (inReviewSection) continue;

    const stripped = line.replace(/`[^`]*`/g, '');
    if (/- \[ \]/.test(stripped)) {
      unchecked.push(stripped.replace(/^.*- \[ \]\s*/, '').trim());
    }
  }
  return unchecked;
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const command = (payload.tool_input || {}).command || '';

    // Only intercept git commit commands
    if (!/\bgit\s+commit\b/.test(command)) {
      process.exit(0);
    }

    const sessionId = process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
    const planPath = findActivePlan(sessionId);
    if (!planPath) process.exit(0);

    const planFile = findPlanFile(planPath);
    if (!planFile) process.exit(0);

    const content = fs.readFileSync(planFile, 'utf-8');
    const unchecked = countUnchecked(content);

    if (unchecked.length === 0) process.exit(0);

    // BLOCK commit
    const preview = unchecked.slice(0, 5).map(t => `  - [ ] ${t.slice(0, 70)}`).join('\n');
    const more = unchecked.length > 5 ? `\n  ... e mais ${unchecked.length - 5} items` : '';

    console.error(
      `\nBLOQUEADO: ${unchecked.length} items pendentes no plano.\n` +
      `Verifique cada um antes de commitar:\n\n${preview}${more}\n\n` +
      `Use /quality-check para validar ou marque os items como [x] no plano.\n`
    );
    process.exit(2);
  } catch (_) {
    process.exit(0); // Fail-open
  }
}

main();
