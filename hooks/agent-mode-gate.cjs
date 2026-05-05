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
 *   - standaloneCount >= MAX_STANDALONE (standalone new call) → BLOCK (exit 2)
 *   - teamCount >= MAX_TEAMS (new distinct team) → BLOCK (exit 2)
 *   - Otherwise → create marker with team_name → allow (exit 0)
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

const MAX_STANDALONE = 3;
const MAX_TEAMS = 3;

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
  const teamSet = new Set();
  let standaloneCount = 0;

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

      // Parse marker content to get team_name
      let teamName = null;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        teamName = parsed.team_name !== undefined ? parsed.team_name : null;
      } catch (_) {
        // Backward compat: unparseable marker = treat as standalone
        console.warn(`[agent-gate] warn: could not parse marker ${file}, treating as standalone`);
      }

      if (teamName) {
        teamSet.add(teamName);
      } else {
        standaloneCount++;
      }
    }
  } catch (_) {
    // readdirSync failed — fail-open
  }

  return {
    teamCount: teamSet.size,
    standaloneCount,
    activeTeams: Array.from(teamSet),
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
 * Cria marker file com team_name (ou null para standalone).
 */
function createMarker(sessionId, { team_name }) {
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
      team_name: team_name || null,
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
    const teamName = toolInput.team_name || null; // undefined → null

    // 1. Exempt types: allow with light reminder, NO marker created
    if (EXEMPT_TYPES.has(subagentType)) {
      console.log(
        `[agent-gate] Tipo isento: ${subagentType}. ` +
        `Lembrete: se forem 2+ tasks paralelas de implementação, use TeamCreate.`
      );
      process.exit(0);
    }

    const sessionId = getSessionId();
    const tmpDir = os.tmpdir();
    const overridePath = path.join(tmpDir, `${MARKER_PREFIX}${sessionId}.override`);

    // 2. Check override — if active, allow and still create marker for counting history
    if (checkOverride(sessionId)) {
      createMarker(sessionId, { team_name: teamName });
      const counts = computeCounts(sessionId);
      console.log(
        `[agent-gate] override ativo — bypass autorizado pelo the user. ` +
        `teams=${counts.teamCount}/${MAX_TEAMS}, standalone=${counts.standaloneCount}/${MAX_STANDALONE}`
      );
      process.exit(0);
    }

    // 3. Compute counts
    const counts = computeCounts(sessionId);
    const { teamCount, standaloneCount, activeTeams } = counts;

    // 4. Block standalone if limit reached
    if (!teamName && standaloneCount >= MAX_STANDALONE) {
      console.error(
        `\n\x1b[31mBLOQUEADO\x1b[0m: ${MAX_STANDALONE}º subagent standalone detectado.\n\n` +
        `  Você já tem ${standaloneCount} subagents standalone ativos nesta sessão.\n` +
        `  Isso sugere que o trabalho é paralelo — use TeamCreate em vez de subagents soltos.\n\n` +
        `  Se a autorização do the user liberar: peça "destrava o gate" e rode:\n` +
        `    touch ${overridePath}\n`
      );
      process.exit(2);
    }

    // 5. Block new team if team limit reached
    const isNewTeam = teamName && !activeTeams.includes(teamName);
    if (isNewTeam && teamCount >= MAX_TEAMS) {
      const teamsDisplay = activeTeams.length > 0 ? activeTeams.join(', ') : '(nenhum)';
      console.error(
        `\n\x1b[31mBLOQUEADO\x1b[0m: ${MAX_TEAMS}º team paralelo detectado.\n\n` +
        `  Teams ativos: ${teamsDisplay}\n` +
        `  Rodar mais que ${MAX_TEAMS - 1} teams em paralelo quase sempre é depth decay.\n\n` +
        `  Se a autorização do the user liberar: peça "destrava o gate" e rode:\n` +
        `    touch ${overridePath}\n`
      );
      process.exit(2);
    }

    // 6. Allow — create marker and report
    createMarker(sessionId, { team_name: teamName });
    // Re-compute after creating to get accurate post-create count
    const updatedCounts = computeCounts(sessionId);
    const context = teamName ? `team=${teamName}` : 'standalone';
    console.log(
      `[agent-gate] ${context}: teams=${updatedCounts.teamCount}/${MAX_TEAMS}, standalone=${updatedCounts.standaloneCount}/${MAX_STANDALONE}`
    );
    process.exit(0);

  } catch (error) {
    // Fail-open — don't block on hook errors
    process.exit(0);
  }
}

main();
