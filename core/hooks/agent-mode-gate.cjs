#!/usr/bin/env node
/**
 * PreToolUse Hook — Agent Mode Selection Gate
 *
 * Fires: Before every Agent tool call
 * Purpose: Force deliberate choice between subagents and Agent Teams
 *
 * Logic:
 *   - Exempt types (explore, plan, etc.) → allow (exit 0), no marker created
 *   - Override marker present + valid → allow, create marker for counting history
 *   - anonCount >= MAX_ANON (novo Agent sem name) → BLOCK (exit 2)
 *   - namedCount >= MAX_NAMED (novo name distinto) → BLOCK (exit 2)
 *   - Otherwise → create marker with name → allow (exit 0)
 *
 * State: marker files in /tmp/claude-agent-gate-{sessionId}-{N}.marker
 * Override: /tmp/claude-agent-gate-{sessionId}.override
 *
 * Exit Codes:
 *   0 - Allow (non-blocking)
 *   2 - Block (forces reconsideration)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const EXEMPT_TYPES = new Set([
  'explore',
  'plan',
  'claude-code-guide',
  'code-reviewer',
  'statusline-setup',
]);

const MARKER_PREFIX = 'claude-agent-gate-';
const MARKER_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

const MAX_ANON = 3;    // Agent sem `name` — subagents anônimos descartáveis (fan-out descoordenado)
const MAX_NAMED = 8;   // Agent com `name` — teammates nomeados do time implícito (modelo novo)

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function getMarkerPattern(sessionId) {
  return `${MARKER_PREFIX}${sessionId}-`;
}

/**
 * Varr markers da sessão, faz age-out de stale markers,
 * e retorna contagem separada de teams e standalones.
 */
function computeCounts(sessionId) {
  const prefix = getMarkerPattern(sessionId);
  const tmpDir = os.tmpdir();
  const nameSet = new Set();
  let anonCount = 0;

  try {
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();

    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith('.marker')) continue;

      const filePath = path.join(tmpDir, file);
      let isStale = false;

      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs >= MARKER_MAX_AGE_MS) {
          isStale = true;
        }
      } catch (_) {
        // Can't stat — treat as active to be safe
      }

      if (isStale) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        continue;
      }

      // Parse marker content: modelo novo usa `name`; compat com markers antigos `team_name`.
      let name = null;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        name = parsed.name !== undefined ? parsed.name
             : (parsed.team_name !== undefined ? parsed.team_name : null);
      } catch (_) {
        // Backward compat: unparseable marker = treat as anonymous
        console.warn(`[agent-gate] warn: could not parse marker ${file}, treating as anonymous`);
      }

      if (name) {
        nameSet.add(name);
      } else {
        anonCount++;
      }
    }
  } catch (_) {
    // readdirSync failed — fail-open
  }

  return {
    namedCount: nameSet.size,
    anonCount,
    activeNames: Array.from(nameSet),
  };
}

/**
 * Verifica existência de override marker pra esta sessão.
 * Se existir e for válido (< 4h), retorna true.
 * Se existir mas expirado, apaga e retorna false.
 */
function checkOverride(sessionId) {
  const tmpDir = os.tmpdir();
  const overridePath = path.join(tmpDir, `${MARKER_PREFIX}${sessionId}.override`);

  try {
    const stat = fs.statSync(overridePath);
    const age = Date.now() - stat.mtimeMs;
    if (age < MARKER_MAX_AGE_MS) {
      return true;
    } else {
      // Expired — clean up
      try { fs.unlinkSync(overridePath); } catch (_) {}
      return false;
    }
  } catch (_) {
    // File doesn't exist or can't stat — no override
    return false;
  }
}

/**
 * Cria marker file com name (ou null para anônimo).
 */
function createMarker(sessionId, { name }) {
  const tmpDir = os.tmpdir();
  // Count existing markers to determine N
  const prefix = getMarkerPattern(sessionId);
  let n = 1;
  try {
    const files = fs.readdirSync(tmpDir);
    const existing = files.filter(f => f.startsWith(prefix) && f.endsWith('.marker'));
    n = existing.length + 1;
  } catch (_) {}

  const markerPath = path.join(tmpDir, `${prefix}${n}.marker`);
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      created: new Date().toISOString(),
      sessionId,
      name: name || null,
    }));
  } catch (_) {
    // Fail silently — don't break the hook
  }
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const toolInput = payload.tool_input || {};
    const subagentType = (toolInput.subagent_type || 'general-purpose').toLowerCase();
    const agentName = toolInput.name || null; // modelo novo: `name` = teammate nomeado do time implícito

    // 1. Exempt types: allow with light reminder, NO marker created
    if (EXEMPT_TYPES.has(subagentType)) {
      console.log(
        `[agent-gate] Tipo isento: ${subagentType}. ` +
        `Lembrete: se forem 2+ tasks paralelas de implementação, dê name: aos teammates (Agent name:).`
      );
      process.exit(0);
    }

    const sessionId = getSessionId();
    const tmpDir = os.tmpdir();
    const overridePath = path.join(tmpDir, `${MARKER_PREFIX}${sessionId}.override`);

    // 2. Check override — if active, allow and still create marker for counting history
    if (checkOverride(sessionId)) {
      createMarker(sessionId, { name: agentName });
      const counts = computeCounts(sessionId);
      console.log(
        `[agent-gate] override ativo — bypass autorizado pelo the user. ` +
        `named=${counts.namedCount}/${MAX_NAMED}, anon=${counts.anonCount}/${MAX_ANON}`
      );
      process.exit(0);
    }

    // R6: teammates de /soma-run autônomo (prefixo `soma-`) são isentos do budget do gate.
    // Um run aprovado no bootstrap não deve travar no meio por causa do cap de names.
    if (agentName && agentName.startsWith('soma-')) {
      createMarker(sessionId, { name: agentName });
      console.log(`[agent-gate] isento (soma-run teammate): ${agentName}`);
      process.exit(0);
    }

    // 3. Compute counts
    const counts = computeCounts(sessionId);
    const { namedCount, anonCount, activeNames } = counts;

    // 4. Block anonymous subagents if the anon budget is reached (janela de 4h)
    if (!agentName && anonCount >= MAX_ANON) {
      console.error(
        `\n\x1b[31mBLOQUEADO\x1b[0m: ${MAX_ANON}º subagent anônimo nesta janela.\n\n` +
        `  Você já disparou ${anonCount} subagents anônimos (sem name) nas últimas 4h.\n` +
        `  Fan-out paralelo? Dê name: aos teammates (Agent name:) — são endereçáveis e contam\n` +
        `  noutro eixo (até ${MAX_NAMED}). Ou continue um agente existente via SendMessage.\n\n` +
        `  Se a autorização do the user liberar: peça "destrava o gate" e rode:\n` +
        `    touch ${overridePath}\n`
      );
      process.exit(2);
    }

    // 5. Block new named teammate if the named budget is reached
    const isNewName = agentName && !activeNames.includes(agentName);
    if (isNewName && namedCount >= MAX_NAMED) {
      const namesDisplay = activeNames.length > 0 ? activeNames.join(', ') : '(nenhum)';
      console.error(
        `\n\x1b[31mBLOQUEADO\x1b[0m: ${MAX_NAMED}º teammate nomeado distinto nesta janela.\n\n` +
        `  Nomes ativos: ${namesDisplay}\n` +
        `  Mais que ${MAX_NAMED} teammates distintos em 4h quase sempre é depth decay —\n` +
        `  reuse um teammate existente via SendMessage em vez de spawnar outro nome.\n\n` +
        `  Se a autorização do the user liberar: peça "destrava o gate" e rode:\n` +
        `    touch ${overridePath}\n`
      );
      process.exit(2);
    }

    // 6. Allow — create marker and report
    createMarker(sessionId, { name: agentName });
    // Re-compute after creating to get accurate post-create count
    const updatedCounts = computeCounts(sessionId);
    const context = agentName ? `named=${agentName}` : 'anon';
    console.log(
      `[agent-gate] ${context}: named=${updatedCounts.namedCount}/${MAX_NAMED}, anon=${updatedCounts.anonCount}/${MAX_ANON}`
    );
    process.exit(0);

  } catch (error) {
    // Fail-open — don't block on hook errors
    process.exit(0);
  }
}

main();
