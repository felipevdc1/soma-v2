#!/usr/bin/env node
/**
 * HYD Gate Hook
 *
 * Fires: UserPromptSubmit (injects /hyd reminder)
 *        PreToolUse — Edit|Write (warns/blocks if /hyd not run)
 *
 * Purpose: Structurally force /hyd before implementation starts.
 *   - UserPromptSubmit: detects action verbs, injects <system-reminder> asking for /hyd.
 *   - PreToolUse: warns (ENFORCE=false) or blocks (ENFORCE=true) Edit/Write when /hyd marker absent.
 *
 * Exit Codes:
 *   0 - Allow (always in warn mode; allow when conditions met in enforce mode)
 *   2 - Block (only when ENFORCE=true and /hyd marker is absent)
 *
 * Markers (all in /tmp/, die on reboot):
 *   /tmp/claude-hyd-{sessionId}.marker          — created by /hyd skill after reframe
 *   /tmp/claude-hyd-bypass-{sessionId}.marker   — one-shot bypass (consumed after use)
 *   /tmp/claude-direct-mode-{sessionId}.marker  — global opt-out (all gates disabled)
 *
 * To create bypass:  touch /tmp/claude-hyd-bypass-$(echo $CK_SESSION_ID).marker
 * To run /hyd:       /hyd <description of task>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Constants ────────────────────────────────────────────────────────────────

// Phase 1: warn + log only. Flip to true for Phase 2 (blocking).
const ENFORCE = false;

// Verbs that signal implementation intent
const ACTION_VERBS = /\b(implementa|implementar|arruma|arrumar|corrige|corrigir|conserta|consertar|refatora|refatorar|cria\s+(?:uma?\s+)?(?:feature|componente|página|pagina|endpoint|api|hook|skill|command)|faz\s+(?:um|uma)|build|monta|monte|plano|dispatch|despacha|despachar)\b/i;

// Only these tools are gated
const BLOCKED_TOOLS = new Set(['Edit', 'Write']);

// Paths that are always allowed (meta-files: plans, commands, docs, memory)
const META_PATH_PATTERNS = [
  '/.claude/plans/',
  '/.claude/commands/',
  '/.claude/projects/',
  '/.claude/skills/',
  '/memory/',
  '/docs/',
];

const LOG_PATH = path.join(os.homedir(), '.claude', 'logs', 'hyd-gate.log');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function ensureLogDir() {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (_) {}
}

function logEvent(mode, tool, decision, detail) {
  try {
    ensureLogDir();
    const sessionId = getSessionId();
    const sessionShort = sessionId.slice(0, 8);
    const iso = new Date().toISOString();
    const line = `${iso} | ${mode} | ${sessionShort} | ${tool} | ${decision} | ${detail}\n`;
    fs.appendFileSync(LOG_PATH, line, 'utf-8');
  } catch (_) {}
}

function isMetaFile(filePath) {
  if (!filePath) return true;
  if (filePath.endsWith('.md')) return true;
  for (const pattern of META_PATH_PATTERNS) {
    if (filePath.includes(pattern)) return true;
  }
  return false;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function handleUserPromptSubmit(payload) {
  // Find the prompt field — Claude Code payload format may vary
  const prompt =
    payload.user_prompt ||
    payload.prompt ||
    payload.message ||
    (Array.isArray(payload.content)
      ? payload.content.map(c => (typeof c === 'string' ? c : c.text || '')).join(' ')
      : payload.content) ||
    null;

  if (!prompt) {
    logEvent('UserPromptSubmit', '-', 'no_prompt_field', 'payload had no recognized prompt key');
    process.exit(0);
  }

  const match = prompt.match(ACTION_VERBS);
  if (!match) {
    // No action verb — no reminder needed
    process.exit(0);
  }

  const sessionId = getSessionId();
  const hydMarker = path.join(os.tmpdir(), `claude-hyd-${sessionId}.marker`);

  if (fs.existsSync(hydMarker)) {
    logEvent('UserPromptSubmit', '-', 'has_marker', match[0]);
    process.exit(0);
  }

  // No marker: inject reminder via stdout (additionalContext / system-reminder)
  const matchedVerb = match[0].replace(/\s+/g, ' ').trim();
  process.stdout.write(
    `<system-reminder>\n` +
    `HYD Gate detectou verbo de ação ("${matchedVerb}") neste prompt e /hyd ainda não rodou nesta sessão.\n` +
    `Rode /hyd <descrição da tarefa> ANTES de planejar ou implementar.\n` +
    `Isso garante que todas as dimensões de qualidade sejam consideradas antes de começar.\n` +
    `</system-reminder>\n`
  );

  logEvent('UserPromptSubmit', '-', 'injected', matchedVerb);
  process.exit(0);
}

function handlePreToolUse(payload) {
  const toolName = payload.tool_name || '';
  const toolInput = payload.tool_input || {};
  const filePath = toolInput.file_path || '';

  // Only gate Edit and Write
  if (!BLOCKED_TOOLS.has(toolName)) {
    process.exit(0);
  }

  // No file path — can't determine, allow through
  if (!filePath) {
    process.exit(0);
  }

  // Meta-files always allowed
  if (isMetaFile(filePath)) {
    logEvent('PreToolUse', toolName, 'meta_file', filePath);
    process.exit(0);
  }

  const sessionId = getSessionId();
  const tmpDir = os.tmpdir();

  // Respect global direct-mode opt-out (same as cognitive-gate)
  const directMarker = path.join(tmpDir, `claude-direct-mode-${sessionId}.marker`);
  if (fs.existsSync(directMarker)) {
    logEvent('PreToolUse', toolName, 'direct_mode', filePath);
    process.exit(0);
  }

  // One-shot bypass marker (consumed after use)
  const bypassMarker = path.join(tmpDir, `claude-hyd-bypass-${sessionId}.marker`);
  if (fs.existsSync(bypassMarker)) {
    try { fs.unlinkSync(bypassMarker); } catch (_) {}
    logEvent('PreToolUse', toolName, 'bypass_consumed', filePath);
    process.exit(0);
  }

  // Check if /hyd was run this session
  const hydMarker = path.join(tmpDir, `claude-hyd-${sessionId}.marker`);
  if (fs.existsSync(hydMarker)) {
    logEvent('PreToolUse', toolName, 'has_marker', filePath);
    process.exit(0);
  }

  // /hyd was NOT run, not a meta-file, no bypass
  if (!ENFORCE) {
    // Phase 1: warn only
    logEvent('PreToolUse', toolName, 'WOULD_BLOCK', filePath);
    process.stdout.write(
      `[hyd-gate] AVISO: /hyd não rodou nesta sessão.\n` +
      `  Arquivo alvo: ${filePath}\n` +
      `  Este edit passará (ENFORCE=false), mas idealmente rode /hyd primeiro.\n` +
      `\n` +
      `  Para desblocar com bypass one-shot:\n` +
      `    touch /tmp/claude-hyd-bypass-${sessionId}.marker\n` +
      `  Para desblocar permanentemente nesta sessão:\n` +
      `    /hyd <descrição da tarefa>\n`
    );
    process.exit(0);
  } else {
    // Phase 2: enforce — block the edit
    logEvent('PreToolUse', toolName, 'BLOCKED', filePath);
    process.stderr.write(
      `[hyd-gate] BLOQUEADO: /hyd não rodou nesta sessão.\n` +
      `  Arquivo alvo: ${filePath}\n` +
      `\n` +
      `  Opção 1 (recomendada): rode /hyd antes de editar\n` +
      `    /hyd <descrição da tarefa>\n` +
      `\n` +
      `  Opção 2 (bypass one-shot, usa apenas uma vez):\n` +
      `    touch /tmp/claude-hyd-bypass-${sessionId}.marker\n`
    );
    process.exit(2);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const event = payload.hook_event_name || '';

    if (event === 'UserPromptSubmit') {
      handleUserPromptSubmit(payload);
    } else if (event === 'PreToolUse') {
      handlePreToolUse(payload);
    } else {
      // Unknown event — fail-open
      process.exit(0);
    }
  } catch (_) {
    process.exit(0); // Fail-open — gate never crashes the session
  }
}

main();
