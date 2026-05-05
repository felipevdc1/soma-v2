#!/usr/bin/env node
/**
 * discover-before-specify.cjs — Article XII Discover Before Specify Hook
 *
 * PreToolUse hook on Skill tool. Detects /specify invocations with trigger
 * words ("extends X", "Phase N+1", "operationalize", "add to existing",
 * "enhance Y") and blocks execution until pre-discovery marker exists.
 *
 * Per Article XII (Constitution v1.0+, ratified 2026-05-02), specs that
 * extend existing modules require pre-discovery: read full source, check
 * --help, list recent tests. Failure Mode #9 prevention.
 *
 * Modes:
 *   - soft-warn (default during 30-day telemetry window): stderr + exit 0
 *   - hard-block (ARTICLE_XII_HARD=1 OR post-window): JSON + exit 2
 *
 * Bypass: marker file /tmp/soma-discover-bypass-{sessionId} (logged)
 * Confirm: marker file /tmp/soma-discovery-done-{sessionId} (single-use)
 *
 * Telemetry: ~/.claude/logs/article-xii-{YYYY-MM-DD}.jsonl
 *
 * @article Article XII — Discover Before Specify
 * @failureMode #9 — spec without verifying existing module state
 * @related Article XI capture-defer-gate.cjs (sibling pattern)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Trigger word patterns ────────────────────────────────────────────

const TRIGGER_PATTERNS = [
  { re: /\bextends?\s+\w+/i, label: 'extends X' },
  { re: /\bextend\s+(?:module|command|skill|hook|impl|implementation)\b/i, label: 'extend module/command/...' },
  { re: /\bPhase\s+\d+\+1\b/i, label: 'Phase N+1' },
  { re: /\bPhase\s+\d+\s+of\s+\d+\b/i, label: 'Phase X of Y' },
  { re: /\boperationaliz[ae]/i, label: 'operationalize' },
  { re: /\badd\s+to\s+existing\b/i, label: 'add to existing' },
  { re: /\benhance\s+\w+\s+(?:module|command|feature|impl|skill|hook)\b/i, label: 'enhance X module/...' },
  { re: /\bestend(?:e|er)\s+(?:o|a|um|uma)?\s*\w+/i, label: 'estende X (pt-br)' },
  { re: /\bfase\s+\d+\+1\b/i, label: 'Fase N+1 (pt-br)' },
  { re: /\boperacionaliz(?:ar|e|ando)/i, label: 'operacionalizar (pt-br)' },
];

// ── stdin helper ─────────────────────────────────────────────────────

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// ── Telemetry ────────────────────────────────────────────────────────

function appendTelemetry(entry) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const logDir = path.join(os.homedir(), '.claude', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `article-xii-${date}.jsonl`);
    const line = JSON.stringify({
      schema: 'article-xii-telemetry/v1',
      timestamp: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(logPath, line + '\n');
  } catch {
    // telemetry failure must NOT block hook
  }
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const input = readStdinSync();
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // malformed input — pass through
    process.exit(0);
  }

  const toolName = payload.tool_name || payload.toolName || '';
  if (toolName !== 'Skill') {
    process.exit(0);
  }

  const toolInput = payload.tool_input || payload.toolInput || {};
  const skillName = toolInput.skill || '';
  if (skillName !== 'specify') {
    process.exit(0);
  }

  const args = toolInput.args || '';
  if (!args || typeof args !== 'string') {
    process.exit(0);
  }

  // Check trigger words
  const matched = TRIGGER_PATTERNS.find(p => p.re.test(args));
  if (!matched) {
    appendTelemetry({
      sessionId: payload.session_id || 'unknown',
      event: 'skip',
      reason: 'no_trigger_word',
      args_excerpt: args.slice(0, 200),
    });
    process.exit(0);
  }

  // Trigger detected — check markers
  const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
  const markerDone = `/tmp/soma-discovery-done-${sessionId}`;
  const markerBypass = `/tmp/soma-discover-bypass-${sessionId}`;

  if (fs.existsSync(markerBypass)) {
    appendTelemetry({
      sessionId,
      event: 'bypass',
      trigger: matched.label,
      args_excerpt: args.slice(0, 200),
    });
    process.stderr.write(`[discover-before-specify] BYPASS marker found — allowing /specify (logged for audit)\n`);
    process.exit(0);
  }

  if (fs.existsSync(markerDone)) {
    try { fs.unlinkSync(markerDone); } catch {} // single-use
    appendTelemetry({
      sessionId,
      event: 'allow_after_discovery',
      trigger: matched.label,
    });
    process.exit(0);
  }

  // Block — soft-warn vs hard-block per env
  const hardMode = process.env.ARTICLE_XII_HARD === '1';
  const blockMessage = `Article XII — Discover Before Specify (Failure Mode #9 fix)

Triggered by /specify ARGUMENTS containing pattern: "${matched.label}"

This /specify invocation appears to extend an existing module. Per Constitution Article XII, pre-discovery is REQUIRED before specifying:

  1. Read full source of target module: cat <module-path>
  2. If CLI: run <module> --help
  3. (Optional) Run: soma audit --module <name>   (Haiku-powered structured audit; Phase 5+ when shipped)
  4. THEN: touch /tmp/soma-discovery-done-${sessionId}   (single-use marker)
  5. Re-invoke /specify

Bypass (legitimate exception, e.g., greenfield feature misclassified):
  touch /tmp/soma-discover-bypass-${sessionId}   (persists session, logged for audit)

Why: Phase 5 SOMA (2026-05-02) wrote spec 011 without reading existing sync.cjs (Phase 4b shipped 2 days prior) → 30% scope redundant + 7 empirical bugs missed. Failure Mode #9 documented in ~/.claude/CLAUDE.md.`;

  appendTelemetry({
    sessionId,
    event: hardMode ? 'block' : 'warn',
    trigger: matched.label,
    args_excerpt: args.slice(0, 200),
    mode: hardMode ? 'hard' : 'soft',
  });

  if (hardMode) {
    const output = {
      decision: 'block',
      reason: blockMessage,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: blockMessage,
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(2);
  } else {
    process.stderr.write(`\n${blockMessage}\n\n[soft-warn mode — set ARTICLE_XII_HARD=1 to enforce blocking]\n\n`);
    process.exit(0);
  }
}

main();
