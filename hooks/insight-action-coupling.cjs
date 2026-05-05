#!/usr/bin/env node
/**
 * insight-action-coupling.cjs — Insight→Action Coupling Gate Hook
 *
 * Stop event hook that enforces the "Insight → Action Coupling" protocol.
 * When a 🧊 SOMA Insight block is rendered in the last assistant turn,
 * at least 1 coupling action must follow — otherwise it is decorative drift
 * (failure mode similar to #8 defer-and-forget).
 *
 * Coupling actions (any one of):
 *   1. 🧬 Memory Saved block presence
 *   2. 🎯 Mission Brief block WITH dispatch indicator
 *   3. Tool-use evidence (Edit/Write/MultiEdit/Task/NotebookEdit in turn)
 *   4. "Capture target:" nominal string
 *   5. "D-Cx" decision lock prefix
 *
 * Modes:
 *   - soft-warn (default): stderr warning + JSONL log + exit 0
 *   - hard-block (INSIGHT_COUPLING_HARD=1): stderr + JSONL + exit 1
 *
 * Logs to ~/.claude/logs/insight-coupling-{YYYY-MM-DD}.jsonl (JSONL).
 *
 * @spec ~/.soma-v2/docs/output-style.md §"Insight → Action Coupling (MANDATORY)"
 * @contract CONTRACT-INSIGHT-ACTION-COUPLING-01
 * @article Article XII — Insight→Action Coupling
 * @failureMode #8-adjacent — decorative drift (Insight without Action)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Detection patterns ────────────────────────────────────────────────────────

/** Detect 🧊 SOMA Insight block opening */
const INSIGHT_BLOCK_RE = /🧊\s*SOMA\s*Insight\s*[═─\-=]+/;

/** Coupling action 1: 🧬 Memory Saved block */
const MEMORY_SAVED_RE = /🧬\s*Memory\s*Saved\s*[═─\-=]+/;

/**
 * Coupling action 2: 🎯 Mission Brief WITH dispatch indicator.
 * Matches Mission Brief block that contains at least one dispatch verb/tool.
 */
const MISSION_BRIEF_RE = /🎯\s*Mission\s*Brief\s*[═─\-=]+/;
const DISPATCH_INDICATOR_RE = /\b(?:dispatch|Sonnet|Haiku|Agent|TaskCreate|Edit|Write|implement|ship)\b/i;

/**
 * Coupling action 3: Tool-use evidence — tool_use blocks with target names
 * in transcript. We scan the raw transcript JSON for these names.
 */
const TOOL_USE_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'Task', 'NotebookEdit']);

/** Coupling action 4: "Capture target:" nominal string */
const CAPTURE_TARGET_RE = /capture\s+target\s*:\s*\S+/i;

/** Coupling action 5: D-Cx decision lock prefix */
const DECISION_LOCK_RE = /\bD-C\d+\b/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract text content from a JSONL transcript line (assistant entry).
 * Returns null for non-assistant entries or entries without text content.
 */
function extractAssistantText(line) {
  try {
    const entry = JSON.parse(line.trim());
    if (entry.type !== 'assistant') return null;
    const msg = entry.message;
    if (!msg || !msg.content) return null;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join(' ');
    }
  } catch (_) {}
  return null;
}

/**
 * Extract tool_use entries from a single JSONL transcript line.
 * Returns array of tool names used in that line.
 */
function extractToolUseNames(line) {
  try {
    const entry = JSON.parse(line.trim());
    if (entry.type !== 'assistant') return [];
    const msg = entry.message;
    if (!msg || !Array.isArray(msg.content)) return [];
    return msg.content
      .filter(c => c.type === 'tool_use' && c.name)
      .map(c => c.name);
  } catch (_) {
    return [];
  }
}

/**
 * Read last assistant turn text and all tool_use names from that same turn.
 * Also returns the raw line for tool-use scanning in multi-line turns.
 *
 * @param {string} transcriptPath
 * @returns {{ text: string, toolNames: string[] } | null}
 */
function readLastAssistantTurn(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());

    // Walk backwards to find last assistant entry
    let lastText = null;
    let lastLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const text = extractAssistantText(lines[i]);
      if (text !== null) {
        lastText = text;
        lastLineIdx = i;
        break;
      }
    }

    if (lastText === null) return null;

    // Also collect tool_use names from the same line
    const toolNames = extractToolUseNames(lines[lastLineIdx]);
    return { text: lastText, toolNames };
  } catch (err) {
    process.stderr.write(`[insight-action-coupling] WARN: could not read transcript: ${err.message}\n`);
    return null;
  }
}

/**
 * Scan all lines of transcript for tool_use blocks with target names,
 * looking within the "current turn" heuristic (after last user message).
 *
 * @param {string} transcriptPath
 * @returns {string[]} — list of matching tool names found in current turn
 */
function scanTranscriptForToolUse(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());

    // Find last "user" line index to define "current turn" boundary
    let lastUserIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i].trim());
        if (e.type === 'user') { lastUserIdx = i; break; }
      } catch (_) {}
    }

    const found = [];
    const startIdx = lastUserIdx >= 0 ? lastUserIdx : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const names = extractToolUseNames(lines[i]);
      for (const name of names) {
        if (TOOL_USE_NAMES.has(name)) found.push(name);
      }
    }
    return found;
  } catch (_) {
    return [];
  }
}

/**
 * Detect coupling actions from text and tool names.
 * Returns array of coupling action identifiers found.
 */
function detectCouplingActions(text, toolNames, transcriptPath) {
  const detected = [];

  // 1. Memory Saved block
  if (MEMORY_SAVED_RE.test(text)) detected.push('memory_saved');

  // 2. Mission Brief WITH dispatch indicator
  if (MISSION_BRIEF_RE.test(text) && DISPATCH_INDICATOR_RE.test(text)) {
    detected.push('mission_brief_dispatch');
  }

  // 3. Tool-use evidence — from same line + full current-turn scan
  const allToolNames = [...new Set([...toolNames, ...scanTranscriptForToolUse(transcriptPath)])];
  const matchedTools = allToolNames.filter(n => TOOL_USE_NAMES.has(n));
  if (matchedTools.length > 0) {
    detected.push('tool_use');
  }

  // 4. Capture target nominal
  if (CAPTURE_TARGET_RE.test(text)) detected.push('capture_target');

  // 5. Decision lock D-Cx
  if (DECISION_LOCK_RE.test(text)) detected.push('decision_lock');

  return detected;
}

/**
 * Append telemetry entry to JSONL log.
 */
function appendTelemetry(entry) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(os.homedir(), '.claude', 'logs', `insight-coupling-${today}.jsonl`);
    const logsDir = path.dirname(logPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    process.stderr.write(`[insight-action-coupling] WARN: could not write telemetry: ${err.message}\n`);
  }
}

// ── Main hook logic ───────────────────────────────────────────────────────────

async function main() {
  // Read stdin sync (mirror capture-defer-gate pattern)
  let stdinData;
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (_) {
    // Can't read stdin — fail open
    process.exit(0);
  }

  // Parse stdin JSON (fail open on malformed)
  let input;
  try {
    input = JSON.parse(stdinData);
  } catch (err) {
    process.stderr.write(`[insight-action-coupling] WARN: malformed stdin JSON: ${err.message}\n`);
    process.exit(0);
  }

  const sessionId = input.session_id || 'unknown';
  const transcriptPath = input.transcript_path || '';
  const env = process.env;

  // Disabled override
  if ((env.INSIGHT_COUPLING_DISABLED || '').trim() === '1') {
    process.exit(0);
  }

  // Read last assistant turn
  const turn = readLastAssistantTurn(transcriptPath);
  const currentText = turn ? turn.text : '';
  const currentToolNames = turn ? turn.toolNames : [];

  // Step 1: Detect 🧊 SOMA Insight block — no-op if absent
  const hasInsight = INSIGHT_BLOCK_RE.test(currentText);
  if (!hasInsight) {
    process.exit(0);
  }

  // Step 2: Count coupling actions
  const couplingActions = detectCouplingActions(currentText, currentToolNames, transcriptPath);
  const coupled = couplingActions.length > 0;

  const hardMode = (env.INSIGHT_COUPLING_HARD || '').trim() === '1';
  const couplingStatus = coupled ? 'valid' : 'violated';

  // Step 3: Telemetry
  const today = new Date().toISOString().slice(0, 10);
  const telemetryEntry = {
    schema: 'insight-coupling/v1',
    ts: new Date().toISOString(),
    session_id: sessionId,
    insight_blocks_count: 1,
    coupling_actions_detected: couplingActions,
    coupling_status: couplingStatus,
    hard_mode: hardMode,
    violation_excerpt: coupled ? null : currentText.slice(0, 200)
  };

  appendTelemetry(telemetryEntry);

  // Step 4: Debug log when SOMA_DEBUG=1
  if ((env.SOMA_DEBUG || '').trim() === '1') {
    process.stderr.write(
      `[insight-action-coupling] DEBUG: status=${couplingStatus} actions=[${couplingActions.join(',')}] hard=${hardMode}\n`
    );
  }

  // Step 5: Emit decision
  if (coupled) {
    // Valid coupling — exit 0 silent
    process.exit(0);
  }

  // Violation: emit warning
  const logPath = `~/.claude/logs/insight-coupling-${today}.jsonl`;
  const warnMessage =
    `⚠️  Insight→Action coupling violation\n` +
    `🧊 SOMA Insight rendered no último turn sem follow-up Action.\n` +
    `Expected at least 1: 🧬 Memory Saved | 🎯 Mission Brief com dispatch | Edit/Write/Task tool use | "Capture target:" nominal | D-Cx lock.\n` +
    `Spec: ~/.soma-v2/docs/output-style.md §"Insight → Action Coupling (MANDATORY)"\n` +
    `Telemetry: ${logPath}\n`;

  process.stderr.write(warnMessage);

  if (hardMode) {
    // Hard-block: exit 1
    process.exit(1);
  } else {
    // Soft-warn: exit 0
    process.exit(0);
  }
}

main().catch(err => {
  process.stderr.write(`[insight-action-coupling] ERROR: unexpected: ${err.message}\n`);
  process.exit(0); // Fail open — never block legitimate turn due to hook crash
});
