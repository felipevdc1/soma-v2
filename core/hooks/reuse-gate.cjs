#!/usr/bin/env node
/**
 * PreToolUse Hook — Reuse Gate
 *
 * Fires: Before Write tool calls for new artifact files
 * Purpose: Force Claude to enumerate reuse checks (vault, skills, memory,
 *          existing files) BEFORE creating a new command/skill/hook/memory.
 *
 * Matches paths:
 *   - .claude/commands/**
 *   - .claude/skills/**
 *   - ~/.claude/skills/**
 *   - .claude/hooks/**.cjs
 *   - memory/feedback_*.md
 *   - memory/project_*.md
 *
 * Bypass (one-shot, consumed on use):
 *   /tmp/claude-reuse-bypass-{sessionId}.marker
 *
 * Exit Codes:
 *   0 - Always (warning only, fail-open)
 *
 * Why this hook exists:
 *   Failure Log 2026-04-15 — Claude created /4d-review without loading
 *   vault matches (quality-gate-checklist et al.) or invoking skill-creator.
 *   Root cause: ambient dismissal of passive hooks + lexical trigger binding.
 *   Fix: active reminder at the moment of artifact creation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function isArtifactPath(filePath) {
  if (!filePath) return false;
  const p = filePath.replace(/\\/g, '/');
  const basename = path.basename(p);

  if (p.includes('/.claude/commands/') && p.endsWith('.md')) return true;
  if (p.includes('/.claude/skills/')) return true;
  if (p.includes('/.claude/hooks/') && (p.endsWith('.cjs') || p.endsWith('.js'))) return true;

  if (p.includes('/memory/') && (basename.startsWith('feedback_') || basename.startsWith('project_'))) {
    return true;
  }

  return false;
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);

    const toolName = payload.tool_name || '';
    if (toolName !== 'Write') process.exit(0);

    const filePath = (payload.tool_input || {}).file_path;
    if (!filePath) process.exit(0);
    if (!isArtifactPath(filePath)) process.exit(0);

    if (fs.existsSync(filePath)) process.exit(0);

    const sessionId = getSessionId();
    const tmpDir = os.tmpdir();

    const bypassMarker = path.join(tmpDir, `claude-reuse-bypass-${sessionId}.marker`);
    if (fs.existsSync(bypassMarker)) {
      try { fs.unlinkSync(bypassMarker); } catch (_) {}
      process.exit(0);
    }

    const rel = filePath.replace(os.homedir(), '~');

    const message = [
      '',
      '════════════════════════════════════════════════════════════════',
      '[reuse-gate] REUSE GATE — novo artefato detectado',
      '════════════════════════════════════════════════════════════════',
      '',
      `  Alvo: ${rel}`,
      '',
      '  Antes de escrever, responda em texto visível ao user:',
      '',
      '  1. VAULT       — rodei vault_resolve / vault_search? Quais matches?',
      '                   Carreguei OU justifiquei dismissal com nome próprio?',
      '  2. SKILLS      — qual skill disponível é a mais próxima? Invoquei?',
      '                   Se não, por quê (nome próprio, não "não precisa")?',
      '  3. MEMÓRIA     — consultei memory/ e mempalace_search pra ver se',
      '                   já existe feedback/project relacionado?',
      '  4. EXTENSÃO    — existe arquivo vivo que eu deveria estender em vez',
      '                   de criar um novo? (Glob na pasta-alvo)',
      '',
      '  Se qualquer resposta for "não verifiquei" ou "achei que não era',
      '  necessário", PARE. Verifique. Depois prossiga.',
      '',
      `  Bypass (uso único): touch /tmp/claude-reuse-bypass-${sessionId}.marker`,
      '  Ver CLAUDE.md seção "Reuse Gate" pra contexto completo.',
      '════════════════════════════════════════════════════════════════',
      ''
    ].join('\n');

    console.log(message);

    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}

main();
