#!/usr/bin/env node
/**
 * PreToolUse Hook — Orchestrator Gate
 *
 * Fires: Before every Edit/Write tool call
 * Purpose: Warn when editing implementation code in orchestrator mode
 *
 * Orchestrator mode is always active. Disable with direct-mode marker:
 *   /tmp/claude-direct-mode-{sessionId}.marker
 *
 * Exit Codes:
 *   0 - Always (warning only, never blocks in MVP)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function isMetaFile(filePath) {
  if (!filePath) return true;
  const basename = path.basename(filePath);
  const ext = path.extname(filePath);

  // .cjs/.js files under .claude/hooks/ are CODE, not meta
  if (filePath.includes('/.claude/hooks/') && (ext === '.cjs' || ext === '.js')) {
    return false;
  }

  return (
    filePath.endsWith('.md') ||
    filePath.includes('/.claude/plans/') ||
    filePath.includes('/.claude/commands/') ||
    filePath.includes('/.claude/projects/') ||
    filePath.includes('/docs/') ||
    basename === 'FAMILY_DOC.md' ||
    basename === 'CLAUDE.md' ||
    filePath.includes('/memory/') ||
    (filePath.endsWith('.json') && filePath.includes('/.claude/'))
  );
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const sessionId = getSessionId();
    const tmpDir = os.tmpdir();

    // Orchestrator mode is ALWAYS ON by default
    // To disable: create direct-mode marker (opt-out)
    const directMarker = path.join(tmpDir, `claude-direct-mode-${sessionId}.marker`);
    if (fs.existsSync(directMarker)) {
      process.exit(0); // Direct mode — no orchestrator enforcement
    }

    // Extract file path
    const filePath = (payload.tool_input || {}).file_path;
    if (!filePath) process.exit(0);

    // Check bypass marker (one-time escape hatch)
    const bypassMarker = path.join(tmpDir, `claude-orchestrator-bypass-${sessionId}.marker`);
    if (fs.existsSync(bypassMarker)) {
      try { fs.unlinkSync(bypassMarker); } catch (_) {}
      process.exit(0); // Bypass consumed — silent
    }

    // Meta-files are always allowed in orchestrator mode
    if (isMetaFile(filePath)) {
      process.exit(0);
    }

    // Non-meta file in orchestrator mode — warn
    console.log(
      `[orchestrator] ⚠ Modo orquestrador ativo. Considere despachar um agente Sonnet:\n` +
      `  Agent({model: 'sonnet', prompt: 'Editar ${filePath}: ...'})\n` +
      `Para desativar nesta sessão: crie direct-mode marker`
    );

    process.exit(0);
  } catch (_) {
    process.exit(0); // Fail-open
  }
}

main();
