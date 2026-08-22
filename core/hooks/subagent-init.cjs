#!/usr/bin/env node
/**
 * SubagentStart Hook - Injects context to subagents (Optimized)
 *
 * Fires: When a subagent (Task tool call) is started
 * Purpose: Inject minimal context using env vars from SessionStart
 * Target: ~200 tokens (down from ~350)
 *
 * Exit Codes:
 *   0 - Success (non-blocking, allows continuation)
 */

const fs = require('fs');
const crypto = require('crypto');
const {
  loadConfig,
  resolveNamingPattern,
  getGitBranch,
  resolvePlanPath,
  getReportsPath,
  normalizePath
} = require('./lib/ck-config-utils.cjs');

/**
 * Build codebase-memory-mcp context injection for subagents.
 * Reads the CWD-hash marker written by cbm-auto-sync.cjs to detect
 * if the project has an indexed knowledge graph.
 */
function buildCbmContext(cwd) {
  const hash = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
  const markerPath = `/tmp/cbm-state-${hash}.json`;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (!marker.mcp_configured || marker.error) return null;
    const project = marker.project || '';
    if (!project) return null;
    const nodes = marker.nodes || '?';
    return [
      `## Code Intelligence (MANDATORY)`,
      `This project has codebase-memory-mcp indexed (${nodes} nodes).`,
      `ALWAYS use MCP tools BEFORE Grep/Glob/Read for code discovery:`,
      `- search_graph({project: "${project}", name_pattern: "query"}) — find functions/classes/routes`,
      `- trace_call_path({project: "${project}", qualified_name: "Module.func"}) — call chains`,
      `- get_architecture({project: "${project}"}) — system overview`,
      `Only fall back to Grep/Glob/Read if MCP returns no results.`,
    ].join('\n');
  } catch (_) {
    return null;
  }
}

/**
 * Build mempalace context injection for subagents.
 * Checks if mempalace MCP server is configured in .claude.json.
 */
function buildMempalaceContext() {
  try {
    const localPath = require('path').join(require('os').homedir(), '.claude.json');
    if (!fs.readFileSync(localPath, 'utf8').includes('"mempalace"')) return null;
    return [
      `## MemPalace (memória persistente)`,
      `Antes de responder sobre pessoas/projetos/eventos passados:`,
      `- mempalace_search(query) — busca semântica em múltiplos drawers`,
      `- mempalace_kg_query(entity) — grafo de conhecimento temporal`,
      `Após ações significativas: mempalace_diary_write(agent_name="claude", entry, topic)`,
    ].join('\n');
  } catch (_) { return null; }
}

/**
 * Get agent-specific context from config
 */
function getAgentContext(agentType, config) {
  const agentConfig = config.subagent?.agents?.[agentType];
  if (!agentConfig?.contextPrefix) return null;
  return agentConfig.contextPrefix;
}

/**
 * Build trust verification section if enabled
 */
function buildTrustVerification(config) {
  if (!config.trust?.enabled || !config.trust?.passphrase) return [];
  return [
    ``,
    `## Trust Verification`,
    `Passphrase: "${config.trust.passphrase}"`
  ];
}

/**
 * Build plan requirements context for subagents.
 * Extracts unchecked items from the active plan to ensure
 * agents know what they'll be validated against (re-grounding).
 */
function buildPlanRequirements(planPath) {
  if (!planPath) return null;
  try {
    let planFile = planPath;
    const stat = fs.statSync(planPath);
    if (stat.isDirectory()) {
      for (const name of ['plan.md', 'PLAN.md']) {
        const candidate = path.join(planPath, name);
        if (fs.existsSync(candidate)) { planFile = candidate; break; }
      }
      if (planFile === planPath) {
        const firstMd = fs.readdirSync(planPath).find(e => e.endsWith('.md'));
        if (firstMd) planFile = path.join(planPath, firstMd);
        else return null;
      }
    }

    const content = fs.readFileSync(planFile, 'utf-8');
    const unchecked = [];
    let inCodeBlock = false;
    for (const line of content.split('\n')) {
      if (/^(\s*)```/.test(line)) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;
      const stripped = line.replace(/`[^`]*`/g, '');
      if (/- \[ \]/.test(stripped)) {
        unchecked.push(stripped.replace(/^.*- \[ \]\s*/, '').trim());
      }
    }

    if (unchecked.length === 0) return null;

    const preview = unchecked.slice(0, 5).map(t => `- ${t.slice(0, 80)}`);
    const more = unchecked.length > 5 ? `\n- ... and ${unchecked.length - 5} more items` : '';

    return [
      `## Plan Requirements (you will be validated against these)`,
      `Active plan has ${unchecked.length} pending items:`,
      ...preview,
      more,
      `Ensure your work addresses items relevant to your task.`
    ].filter(Boolean).join('\n');
  } catch (_) {
    return null;
  }
}

/**
 * Build FAMILY_DOC context for all agents.
 * Two levels:
 *   1. Project FAMILY_DOC ({cwd}/FAMILY_DOC.md) — persistent, all agents read it
 *   2. Team FAMILY_DOC (~/.claude/teams/{team}/FAMILY_DOC.md) — ephemeral, team agents read+write
 */
function buildFamilyDocContext(agentId, cwd) {
  const homedir = require('os').homedir();
  const path = require('path');
  const lines = [];

  // --- Level 1: Project FAMILY_DOC (all agents) ---
  if (cwd) {
    const projectDocPath = path.join(cwd, 'FAMILY_DOC.md');
    const projectDocExists = (() => { try { fs.statSync(projectDocPath); return true; } catch (_) { return false; } })();
    if (projectDocExists) {
      lines.push(`## FAMILY_DOC (Project)`);
      lines.push(`Read \`${projectDocPath}\` BEFORE starting — it has accumulated patterns, pitfalls and decisions from previous sessions.`);
    } else if (agentId && agentId.includes('@')) {
      // Team agent in a project without FAMILY_DOC — instruct team-lead to create on consolidation
      lines.push(`## FAMILY_DOC (Project — not yet created)`);
      lines.push(`This project has no FAMILY_DOC.md yet. At consolidation, the team-lead should create \`${projectDocPath}\` with sections: Patterns, Pitfalls, Decisions, Sessions.`);
    }
  }

  // --- Level 2: Team FAMILY_DOC (team agents only) ---
  if (agentId && agentId.includes('@')) {
    const teamName = agentId.split('@').pop();
    if (teamName) {
      const teamDir = path.join(homedir, '.claude', 'teams', teamName);
      const teamDocPath = path.join(teamDir, 'FAMILY_DOC.md');
      const teamExists = (() => { try { fs.statSync(teamDir); return true; } catch (_) { return false; } })();

      if (teamExists) {
        const teamDocExists = (() => { try { fs.statSync(teamDocPath); return true; } catch (_) { return false; } })();
        if (lines.length > 0) lines.push(``);
        lines.push(`## FAMILY_DOC (Team: ${teamName})`);
        lines.push(teamDocExists
          ? `Read \`${teamDocPath}\` — it has learnings from teammates in this session.`
          : `No team FAMILY_DOC exists yet. You will create it.`);
        lines.push(`At the END of your task (before shutdown), update \`${teamDocPath}\`:`);
        lines.push(`- Add your learnings under "## Agent Logs" with your name, date, and task`);
        lines.push(`- Add any code patterns to "## Patterns"`);
        lines.push(`- Add any pitfalls/errors you solved to "## Pitfalls"`);
        lines.push(`- Add architecture/API decisions to "## Decisions"`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build vault context injection for subagents.
 * Reads catalog.json to detect if vault is set up and how many assets are indexed.
 */
function buildVaultContext() {
  const os = require('os');
  const catalogPath = require('path').join(os.homedir(), '.claude', 'vault', 'catalog.json');
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const total = catalog.assets?.length || 0;
    if (total === 0) return null;
    return [
      `## Skill Vault (${total} assets)`,
      `Antes de tasks especializadas:`,
      `- vault_resolve({ task: "descrição" }) → skills relevantes`,
      `- Match? Read o path e siga. Sem match? Execute e vault_suggest({ task, approach }).`,
    ].join('\n');
  } catch (_) { return null; }
}

// ===== SOMA context extensions (token-budgeted) =====
const SOMA_BUDGET_CHARS = 3200; // ≈800 tokens (4 chars/token)

function parseTaskIds(prompt) {
  const ms = (prompt || '').match(/\bT-\d+\b|\btask[-\s]?\d+\b/gi) || [];
  return [...new Set(ms.map(m => { const n = m.match(/\d+/)?.[0]; return n ? `T-${n}` : null; }).filter(Boolean))];
}

function buildConstitutionContent(budgetChars) {
  const os = require('os'), path = require('path');
  const cPath = process.env._TEST_CONSTITUTION_PATH !== undefined
    ? process.env._TEST_CONSTITUTION_PATH
    : path.join(os.homedir(), '.claude', 'constitution.md');
  try {
    const raw = fs.readFileSync(cPath, 'utf8').trimEnd();
    if (!raw) return null;
    const max = Math.min(budgetChars, 2000);
    return `## Constitution (SOMA)\n${raw.length > max ? raw.slice(0, max) + '\n… [truncated]' : raw}`;
  } catch (_) { return null; }
}

function buildFamilyDocContent(cwd, budgetChars) {
  const path = require('path');
  let root = cwd;
  try {
    const r = require('child_process').execSync('git rev-parse --show-toplevel', {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 2000
    }).toString().trim();
    if (r) root = r;
  } catch (_) {}
  try {
    const raw = fs.readFileSync(path.join(root, 'FAMILY_DOC.md'), 'utf8').trimEnd();
    if (!raw) return null;
    const max = Math.min(budgetChars, 2000);
    return `## FAMILY_DOC (content)\n${raw.length > max ? raw.slice(0, max) + '\n… [truncated]' : raw}`;
  } catch (_) { return null; }
}

function buildSpecAcContent(prompt, budgetChars) {
  try {
    const sessionId = process.env.CLAUDE_SESSION_ID || process.env.CK_SESSION_ID || '';
    if (!sessionId) return null;
    let state;
    try { state = JSON.parse(fs.readFileSync(`/tmp/soma-state-${sessionId}.json`, 'utf8')); }
    catch (_) { return null; }
    if (!state?.specPath) return null;
    let spec;
    try { spec = fs.readFileSync(state.specPath, 'utf8'); } catch (_) { return null; }
    const ids = parseTaskIds(prompt);
    if (!ids.length) return null;
    const collected = [];
    let inSection = false;
    for (const line of spec.split('\n')) {
      const isHeading = /^#+\s/.test(line);
      const matchesTask = isHeading && ids.some(id =>
        new RegExp(`\\b${id.replace('-', '[-\\s]?')}\\b`, 'i').test(line)
      );
      if (matchesTask) { inSection = true; collected.push(line); continue; }
      if (isHeading && inSection) inSection = false;
      if (inSection && /AC-\d+/i.test(line)) collected.push(line.trim());
    }
    if (!collected.length) return null;
    const body = collected.join('\n');
    const snippet = body.length > budgetChars ? body.slice(0, budgetChars) + '\n… [truncated]' : body;
    return `## Spec ACs (${ids.join(', ')})\n${snippet}`;
  } catch (_) { return null; }
}

function assembleSomaContext(cwd, prompt, _budgetOverride) {
  let budget = _budgetOverride || SOMA_BUDGET_CHARS;
  const parts = [];

  const constitution = buildConstitutionContent(budget);
  if (constitution) { budget -= constitution.length; parts.push(constitution); }

  if (budget < 200) {
    parts.push('<!-- FAMILY_DOC: skipped — budget exhausted -->');
  } else {
    const familyDoc = buildFamilyDocContent(cwd, budget);
    if (familyDoc) { budget -= familyDoc.length; parts.push(familyDoc); }
  }

  if (budget > 100) {
    const specAc = buildSpecAcContent(prompt, budget);
    if (specAc) parts.push(specAc);
  }

  return parts.join('\n\n');
}

/**
 * Main hook execution
 */
async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const agentType = payload.agent_type || 'unknown';
    const agentId = payload.agent_id || 'unknown';

    // Load config for trust verification, naming, and agent-specific context
    const config = loadConfig({ includeProject: false, includeAssertions: false });

    // Compute naming pattern directly (don't rely on env vars which may not propagate)
    const gitBranch = getGitBranch();
    const namePattern = resolveNamingPattern(config.plan, gitBranch);

    // Resolve plan and reports path
    const resolved = resolvePlanPath(null, config);
    const reportsPath = getReportsPath(resolved.path, resolved.resolvedBy, config.plan, config.paths);
    const activePlan = resolved.resolvedBy === 'session' ? resolved.path : '';
    const suggestedPlan = resolved.resolvedBy === 'branch' ? resolved.path : '';
    const plansPath = normalizePath(config.paths?.plans) || 'plans';
    const docsPath = normalizePath(config.paths?.docs) || 'docs';
    const thinkingLanguage = config.locale?.thinkingLanguage || '';
    const responseLanguage = config.locale?.responseLanguage || '';
    // Auto-default thinkingLanguage to 'en' when only responseLanguage is set
    const effectiveThinking = thinkingLanguage || (responseLanguage ? 'en' : '');

    // Build compact context (~200 tokens)
    const lines = [];

    // Subagent identification
    lines.push(`## Subagent: ${agentType}`);
    lines.push(`ID: ${agentId} | CWD: ${payload.cwd || process.cwd()}`);
    lines.push(``);

    // Plan context (from env vars)
    lines.push(`## Context`);
    if (activePlan) {
      lines.push(`- Plan: ${activePlan}`);
    } else if (suggestedPlan) {
      lines.push(`- Plan: none | Suggested: ${suggestedPlan}`);
    } else {
      lines.push(`- Plan: none`);
    }
    lines.push(`- Reports: ${reportsPath}`);
    lines.push(`- Paths: ${plansPath}/ | ${docsPath}/`);
    lines.push(``);

    // Language (thinking + response, if configured)
    const hasThinking = effectiveThinking && effectiveThinking !== responseLanguage;
    if (hasThinking || responseLanguage) {
      lines.push(`## Language`);
      if (hasThinking) {
        lines.push(`- Thinking: Use ${effectiveThinking} for reasoning (logic, precision).`);
      }
      if (responseLanguage) {
        lines.push(`- Response: Respond in ${responseLanguage} (natural, fluent).`);
      }
      lines.push(``);
    }

    // Core rules (minimal)
    lines.push(`## Rules`);
    lines.push(`- Reports → ${reportsPath}`);
    lines.push(`- YAGNI / KISS / DRY`);
    lines.push(`- Concise, list unresolved Qs at end`);

    // Naming templates (computed directly for reliable injection)
    lines.push(``);
    lines.push(`## Naming`);
    lines.push(`- Report: ${reportsPath}${agentType}-${namePattern}.md`);
    lines.push(`- Plan dir: ${plansPath}/${namePattern}/`);

    // Trust verification (if enabled)
    lines.push(...buildTrustVerification(config));

    // Agent-specific context (if configured)
    const agentContext = getAgentContext(agentType, config);
    if (agentContext) {
      lines.push(``);
      lines.push(`## Agent Instructions`);
      lines.push(agentContext);
    }

    // FAMILY_DOC injection — if agent belongs to an Agent Teams team
    const familyDocContext = buildFamilyDocContext(agentId, payload.cwd || process.cwd());
    if (familyDocContext) {
      lines.push(``);
      lines.push(familyDocContext);
    }

    // MCP code intelligence injection — if project has codebase-memory-mcp indexed
    const cbmContext = buildCbmContext(payload.cwd || process.cwd());
    if (cbmContext) {
      lines.push(``);
      lines.push(cbmContext);
    }

    // MemPalace context injection — if mempalace MCP is configured
    const mempalaceCtx = buildMempalaceContext();
    if (mempalaceCtx) { lines.push(''); lines.push(mempalaceCtx); }

    // Vault context injection — if vault catalog exists
  const vaultCtx = buildVaultContext();
  if (vaultCtx) { lines.push(''); lines.push(vaultCtx); }

    // Plan requirements injection — re-grounding for depth decay prevention
    // resolved.path may be null if resolvePlanPath was called with null sessionId
    // Try again with env-based sessionId for session-aware resolution
    let planPath = resolved.path;
    if (!planPath) {
      const planSessionId = process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
      if (planSessionId) {
        const sessionResolved = resolvePlanPath(planSessionId, config);
        planPath = sessionResolved.path;
      }
    }
    const planRequirements = buildPlanRequirements(planPath);
    if (planRequirements) { lines.push(''); lines.push(planRequirements); }

    // SOMA extensions — Constitution + FAMILY_DOC content + Spec AC (token-budgeted)
    const somaCtx = assembleSomaContext(
      payload.cwd || process.cwd(),
      payload.input || payload.prompt || ''
    );
    if (somaCtx) {
      lines.push('');
      lines.push('---');
      lines.push(somaCtx);
    }

    // Auto-load module docs — C-1 Option A
    // Resolves per-project .soma/CONTEXT.md keyword routing + injects relevant module docs
    // Defensive: errors silently degrade (never blocks dispatch — AC-18/D8)
    const taskPrompt = payload.input || payload.prompt || '';
    const projectRoot = process.env.SOMA_PROJECT || payload.cwd || process.cwd();
    const { buildAutoLoadContext } = require(require('path').join(__dirname, 'lib', 'auto-load-modules.cjs'));
    const autoLoadText = buildAutoLoadContext(projectRoot, taskPrompt);
    if (autoLoadText) {
      lines.push('');
      lines.push(autoLoadText);
    }

    // CRITICAL: SubagentStart requires hookSpecificOutput.additionalContext format
    const output = {
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: lines.join('\n')
      }
    };

    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (error) {
    console.error(`SubagentStart hook error: ${error.message}`);
    process.exit(0); // Fail-open
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    parseTaskIds,
    buildConstitutionContent,
    buildFamilyDocContent,
    buildSpecAcContent,
    assembleSomaContext,
  };
}
