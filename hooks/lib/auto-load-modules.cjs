/**
 * auto-load-modules.cjs — SOMA v2.1 Phase C-1
 *
 * Auto-load module docs primitive.
 * Reads per-project .soma/CONTEXT.md routing table, matches keywords from
 * agent task description (case-insensitive substring per D1), and injects
 * up to 2 relevant active module docs (D2) into agent system prompt.
 *
 * Single-responsibility: CONTEXT.md parsing + keyword matching + scoring +
 * status/layer filtering + token-budget enforcement + injection formatting.
 *
 * Zero external deps — Node.js stdlib only (fs, path).
 * Reuses:
 *   - ~/.soma-v2/scripts/lib/module-store.cjs::parseFrontMatter (Phase 4c, shasum-locked)
 *   - ~/.soma-v2/scripts/lib/foundation-check.cjs::resolveModuleLayer (Phase 4d, shasum-locked)
 *
 * @spec AC-01..AC-18, D1-D8
 * @contract CONTRACT-AUTO-LOAD-MODULE-01
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---- Constants ----

const DEFAULT_TOKEN_CAP = 5120; // ~5KB UTF-8 bytes (AD-06: byte-level proxy for tokens)
const MAX_MODULES = 2;          // D2: hardcoded 2 MVP

const LAYER_PRIORITY = { roots: 0, trunk: 1, leaves: 2 };

// ---- Lazy-load Phase 4c/4d libs (shasum-locked — NOT modified) ----

let _parseFrontMatter = null;
function getParseFrontMatter() {
  if (!_parseFrontMatter) {
    const modStorePath = path.join(os.homedir(), '.soma-v2', 'scripts', 'lib', 'module-store.cjs');
    _parseFrontMatter = require(modStorePath).parseFrontMatter;
  }
  return _parseFrontMatter;
}

// ---- resolveTokenCap (AC-17) ----

/**
 * Resolve the token cap from environment or default.
 * @param {object} env - environment object (default: process.env)
 * @returns {number}
 */
function resolveTokenCap(env) {
  const envObj = env || process.env;
  const raw = envObj.SOMA_AUTO_LOAD_TOKEN_CAP;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TOKEN_CAP;
}

// ---- parseContextMd (AC-02, AC-12) ----

/**
 * Parse .soma/CONTEXT.md — front-matter (soma-context/v1) + body table.
 *
 * Front-matter: reuses module-store.cjs parseFrontMatter regex parser (Phase 4c).
 * Body table: simple regex per row.
 *
 * @param {string} content - raw file content
 * @returns {{ frontMatter: object|null, routes: Array<{keyword: string, slug: string}>, valid: boolean, error: string|null }}
 */
function parseContextMd(content) {
  const parseFrontMatter = getParseFrontMatter();
  const { frontMatter, body, valid, error } = parseFrontMatter(content);

  if (!valid) {
    return { frontMatter: null, routes: [], valid: false, error };
  }

  // Parse table rows from body
  // Match: | keyword | slug | rows (skip separator/header rows)
  const routes = [];
  const lines = (body || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;

    // Split by | and extract cells
    const cells = trimmed
      .slice(1, -1)           // remove outer | |
      .split('|')
      .map(c => c.trim());

    if (cells.length < 2) continue;
    const [keyword, slug] = cells;

    // Skip header rows (contain "Keyword" or "Module Slug" labels, case-insensitive)
    if (/^keyword$/i.test(keyword) || /^module.slug$/i.test(keyword)) continue;
    // Skip separator rows (contain only dashes)
    if (/^-+$/.test(keyword)) continue;

    // Validate: non-empty, no spaces-only
    if (!keyword || !slug) continue;
    if (!keyword.replace(/-/g, '').trim()) continue;

    routes.push({ keyword, slug });
  }

  return { frontMatter, routes, valid: true, error: null };
}

// ---- matchKeywords (AC-03, D1) ----

/**
 * Match routes against task description via case-insensitive substring.
 * Returns candidates with score = count of occurrences in task description.
 *
 * @param {string} taskDescription
 * @param {Array<{keyword: string, slug: string}>} routes
 * @returns {Array<{slug: string, keyword: string, score: number}>}
 */
function matchKeywords(taskDescription, routes) {
  const taskLower = (taskDescription || '').toLowerCase();
  const candidates = [];

  for (const route of routes) {
    const keyLower = route.keyword.toLowerCase();
    if (!keyLower) continue;

    // Count occurrences (case-insensitive)
    let score = 0;
    let pos = 0;
    while ((pos = taskLower.indexOf(keyLower, pos)) !== -1) {
      score++;
      pos += keyLower.length;
    }

    if (score > 0) {
      candidates.push({ slug: route.slug, keyword: route.keyword, score });
    }
  }

  return candidates;
}

// ---- filterByStatus (AC-06) ----

/**
 * Filter candidates keeping only those with status: active.
 * hypothesis + deprecated skipped silently.
 *
 * @param {Array<{slug: string, score: number, status?: string, [key: string]: any}>} candidates
 * @returns filtered array
 */
function filterByStatus(candidates) {
  return candidates.filter(c => c.status === 'active');
}

// ---- sortByLayerThenAlpha (AC-07, D4) ----

/**
 * Sort candidates by layer priority (roots > trunk > leaves) then alphabetical slug.
 * Score is NOT used for sorting (D4: layer first, alpha second, score irrelevant).
 *
 * @param {Array<{slug: string, layer?: string, [key: string]: any}>} candidates
 * @returns sorted copy
 */
function sortByLayerThenAlpha(candidates) {
  return [...candidates].sort((a, b) => {
    const la = LAYER_PRIORITY[a.layer] ?? 2;
    const lb = LAYER_PRIORITY[b.layer] ?? 2;
    if (la !== lb) return la - lb;
    return (a.slug || '').localeCompare(b.slug || '');
  });
}

// ---- selectTopN (AC-04, D2) ----

/**
 * Select top N candidates by score (descending), then layer+alpha tie-break.
 * Hardcoded max 2 modules (D2).
 *
 * @param {Array<{slug: string, score: number, layer?: string}>} candidates - pre-filtered (active)
 * @param {number} n - max modules (default MAX_MODULES=2)
 * @returns top n candidates
 */
function selectTopN(candidates, n = MAX_MODULES) {
  // Sort by score DESC, then by layer+alpha within same score
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Same score: layer priority then alpha
    const la = LAYER_PRIORITY[a.layer] ?? 2;
    const lb = LAYER_PRIORITY[b.layer] ?? 2;
    if (la !== lb) return la - lb;
    return (a.slug || '').localeCompare(b.slug || '');
  });
  return sorted.slice(0, n);
}

// ---- enforceTokenBudget (AC-05, D3) ----

/**
 * Enforce token budget across selected modules.
 * If combined bytes > cap: truncate to 1 highest-score module + emit warning.
 *
 * @param {Array<{slug: string, score: number, content: string}>} modules
 * @param {number} tokenCap - byte cap
 * @returns {{ loaded: Array, warnings: Array<{code: string, message: string}> }}
 */
function enforceTokenBudget(modules, tokenCap) {
  if (!modules.length) return { loaded: [], warnings: [] };

  const totalBytes = modules.reduce((sum, m) => sum + Buffer.byteLength(m.content || '', 'utf8'), 0);

  if (totalBytes <= tokenCap) {
    return { loaded: modules, warnings: [] };
  }

  // Truncate to 1 highest-score module (modules already sorted by score desc from selectTopN)
  const best = modules[0];
  const warnings = [{
    code: 'TOKEN_BUDGET_EXCEEDED',
    message: `Combined module size ${totalBytes}B exceeds token cap ${tokenCap}B; truncated to 1 highest-score module: ${best.slug}`,
  }];

  return { loaded: [best], warnings };
}

// ---- formatInjection (AC-08, D5) ----

/**
 * Format selected modules as markdown-delimited injection text (D5).
 * Multiple modules separated by \n\n.
 *
 * @param {Array<{slug: string, layer: string, content: string}>} modules
 * @returns {string} injection text (empty string if no modules)
 */
function formatInjection(modules) {
  if (!modules.length) return '';
  return modules
    .map(m => [
      `--- soma-auto-loaded-module: ${m.slug} (layer: ${m.layer || 'leaves'}) ---`,
      m.content || '',
      `--- end module ---`,
    ].join('\n'))
    .join('\n\n');
}

// ---- resolveModuleData (internal) ----

/**
 * Read a module file and return { slug, layer, status, content } or null on error.
 * Reuses module-store.cjs parseFrontMatter for front-matter stripping.
 *
 * @param {string} projectPath
 * @param {string} slug
 * @returns {{ slug: string, layer: string, status: string, content: string } | null}
 */
function resolveModuleData(projectPath, slug) {
  const modulePath = path.join(projectPath, '.soma', 'modules', `${slug}.md`);
  if (!fs.existsSync(modulePath)) return null;

  let raw;
  try { raw = fs.readFileSync(modulePath, 'utf8'); } catch (_) { return null; }

  const parseFrontMatter = getParseFrontMatter();
  const parsed = parseFrontMatter(raw);

  const fm = parsed.frontMatter || {};
  const status = fm.status || 'hypothesis';
  const layer = fm.layer || 'leaves';
  const body = parsed.valid ? parsed.body : raw;

  return { slug, layer, status, content: body.trim() };
}

// ---- buildAutoLoadContext (AC-01, AC-09, AC-10, AC-11, AC-15, AC-18) ----

/**
 * Main entry point: given project root + task description, returns injection text.
 *
 * Defensive: any error returns '' and logs to stderr (D8/AC-18 — never blocks dispatch).
 *
 * @param {string} projectRoot - absolute path to project containing .soma/
 * @param {string} taskDescription - agent task prompt text
 * @param {object} opts - { tokenCap?: number, maxModules?: number, env?: object }
 * @returns {string} injection text (empty on no-match or error)
 */
function buildAutoLoadContext(projectRoot, taskDescription, opts = {}) {
  try {
    const tokenCap = opts.tokenCap ?? resolveTokenCap(opts.env || process.env);
    const maxModules = opts.maxModules ?? MAX_MODULES;

    // AC-09: no CONTEXT.md → silent skip with INFO log
    const contextMdPath = path.join(projectRoot, '.soma', 'CONTEXT.md');
    if (!fs.existsSync(contextMdPath)) {
      process.stderr.write(`[auto-load] INFO: no .soma/CONTEXT.md found; auto-load skipped\n`);
      return '';
    }

    // Read + parse CONTEXT.md
    let rawContext;
    try { rawContext = fs.readFileSync(contextMdPath, 'utf8'); }
    catch (e) {
      process.stderr.write(`[auto-load] ERROR: could not read .soma/CONTEXT.md: ${e.message}\n`);
      return '';
    }

    const { routes, valid, error } = parseContextMd(rawContext);
    if (!valid) {
      process.stderr.write(`[auto-load] ERROR: .soma/CONTEXT.md parse error: ${error}; auto-load skipped\n`);
      return '';
    }

    // AC-10: zero keyword matches → silent skip
    const rawCandidates = matchKeywords(taskDescription, routes);
    if (!rawCandidates.length) {
      return '';
    }

    // Resolve each candidate's module data (status + layer)
    const withModuleData = rawCandidates
      .map(c => {
        const moduleData = resolveModuleData(projectRoot, c.slug);
        if (!moduleData) return null;
        return { ...c, ...moduleData }; // merge score + slug + layer + status + content
      })
      .filter(Boolean);

    // AC-06: filter by status (active only)
    const activeModules = filterByStatus(withModuleData);

    // AC-11: all filtered → warning loud
    if (rawCandidates.length > 0 && activeModules.length === 0) {
      process.stderr.write(
        `[auto-load] WARNING: ${rawCandidates.length} keyword(s) matched but all candidate modules are non-active; auto-load skipped\n`
      );
      return '';
    }

    // AC-04/D2: select top N (score desc, then layer+alpha tie-break)
    const topN = selectTopN(activeModules, maxModules);

    // AC-07/D4: sort final selection by layer+alpha for injection order
    const sortedForInjection = sortByLayerThenAlpha(topN);

    // AC-05/D3: enforce token budget
    const { loaded, warnings } = enforceTokenBudget(sortedForInjection, tokenCap);
    for (const w of warnings) {
      process.stderr.write(`[auto-load] WARNING: ${w.message}\n`);
    }

    if (!loaded.length) return '';

    // AC-08/D5: format injection text
    return formatInjection(loaded);

  } catch (err) {
    // AC-18/D8: defensive — any unhandled error → log stderr + return empty (never blocks dispatch)
    process.stderr.write(`[auto-load] ERROR: unexpected error during auto-load: ${err.message}; dispatch proceeds without auto-load\n`);
    return '';
  }
}

// ---- Exports ----

module.exports = {
  parseContextMd,
  matchKeywords,
  filterByStatus,
  sortByLayerThenAlpha,
  selectTopN,
  enforceTokenBudget,
  formatInjection,
  resolveTokenCap,
  buildAutoLoadContext,
  // Internals exported for testing
  resolveModuleData,
};
