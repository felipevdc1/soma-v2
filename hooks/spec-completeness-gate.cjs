#!/usr/bin/env node
/**
 * PreToolUse Hook — Spec Completeness Gate
 * Part of: SOMA v2 / Master Claude Protocol (P24)
 *
 * Fires: Before every Bash tool call
 * Purpose: Block git commits when SOMA spec has open [NEEDS CLARIFICATION]
 *          markers or uncovered acceptance criteria.
 *
 * Exit Codes:
 *   0 - Allow (not a commit, no SOMA session, all clear, bypass consumed)
 *   2 - Block (open markers or uncovered ACs)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function readJsonSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// v3 Fase 1: AC-line extraction — accepts the 3 line forms in use across
// spec history:
//   "### AC-01: ..."     (v3 Fase 1 heading form, EARS title)
//   "- **AC-01:** ..."   (legacy bullet-bold form — the official template
//                         used this from day one; the old bare-only regex
//                         never matched it, so AC coverage enforcement was
//                         silently dead against every templated spec)
//   "AC-01: ..."         (bare form)
const AC_LINE_RE = /^\s*#{0,6}\s*-?\s*\*{0,2}(AC-\d+)\*{0,2}:\*{0,2}\s*/;

function parseAcEntries(specContent) {
  const entries = [];
  for (const line of specContent.split('\n')) {
    const m = line.match(AC_LINE_RE);
    if (!m) continue;
    entries.push({ id: m[1], title: line.slice(m[0].length).trim() });
  }
  return entries;
}

function parseAcIds(specContent) {
  return parseAcEntries(specContent).map(e => e.id);
}

// v3 Fase 1: EARS acceptance-criteria grammar. 5 valid forms, SHALL
// required in all of them (Sec. "Acceptance Criteria" of the template).
const EARS_FORMS = [
  { name: 'Ubíqua — "The {sistema} SHALL {resposta}"', re: /^The\s+\S.*\bSHALL\b.+$/i },
  { name: 'Estado — "WHILE {estado}, the {sistema} SHALL {resposta}"', re: /^WHILE\s+\S.*,\s*the\s+\S.*\bSHALL\b.+$/i },
  { name: 'Evento — "WHEN {gatilho}, the {sistema} SHALL {resposta}"', re: /^WHEN\s+\S.*,\s*the\s+\S.*\bSHALL\b.+$/i },
  { name: 'Indesejado — "IF {condição}, THEN the {sistema} SHALL {resposta}"', re: /^IF\s+\S.*,\s*THEN\s+the\s+\S.*\bSHALL\b.+$/i },
  { name: 'Opcional — "WHERE {contexto}, the {sistema} SHALL {resposta}"', re: /^WHERE\s+\S.*,\s*the\s+\S.*\bSHALL\b.+$/i },
];

function isEarsValid(title) {
  const t = (title || '').trim();
  if (!t) return false;
  return EARS_FORMS.some(f => f.re.test(t));
}

// v3 Fase 1 cutoff: specs Created on/after this date must follow the EARS
// grammar. Specs Created before it — or with no Created field at all —
// predate the requirement and are grandfathered (title isn't linted).
// Blocking on absent metadata would be hostile, not protective, so
// "no Created field" is treated the same as "old spec".
const EARS_GATE_DATE = '2026-08-15';

function extractCreatedDate(specContent) {
  const line = specContent.split('\n').find(l => /Created/i.test(l));
  if (!line) return null;
  const stripped = line.replace(/\*/g, '');
  const m = stripped.match(/Created:?\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function isEarsGrandfathered(specContent) {
  const created = extractCreatedDate(specContent);
  if (!created) return true;
  return created < EARS_GATE_DATE;
}

function parseCoveredAcs(tasksContent) {
  const covered = new Set();
  for (const m of tasksContent.matchAll(/\[SPEC:(AC-\d+)\]/g)) {
    covered.add(m[1]);
  }
  return covered;
}

async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const command = (payload.tool_input || {}).command || '';

    // Only intercept git commit commands
    if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

    // Exempt: amend no-edit
    if (/git\s+commit\s+.*--amend.*--no-edit/.test(command)) process.exit(0);

    // Exempt: WIP commits
    if (/git\s+commit\s+-m\s+['"]WIP:/.test(command)) process.exit(0);

    const sessionId = getSessionId();
    const tmpDir = os.tmpdir();
    const statePath = path.join(tmpDir, `soma-state-${sessionId}.json`);

    // No SOMA session → pass silently
    if (!fs.existsSync(statePath)) process.exit(0);

    // Check bypass marker (one-time escape hatch)
    const bypassMarker = path.join(tmpDir, `soma-spec-bypass-${sessionId}.marker`);
    if (fs.existsSync(bypassMarker)) {
      try { fs.unlinkSync(bypassMarker); } catch (_) {}
      process.exit(0);
    }

    // Read SOMA state — fail-open on bad JSON
    let state;
    try {
      state = readJsonSafe(statePath);
    } catch (e) {
      process.stderr.write(`[spec-completeness-gate] WARN: could not parse soma-state: ${e.message}\n`);
      process.exit(0);
    }

    const { specPath, tasksPath } = state || {};

    // Spec file missing → fail-open
    if (!specPath || !fs.existsSync(specPath)) {
      process.stderr.write(`[spec-completeness-gate] WARN: specPath missing or not found (${specPath})\n`);
      process.exit(0);
    }

    let specContent;
    try {
      specContent = fs.readFileSync(specPath, 'utf-8');
    } catch (e) {
      process.stderr.write(`[spec-completeness-gate] WARN: could not read spec: ${e.message}\n`);
      process.exit(0);
    }

    // 1. Count open [NEEDS CLARIFICATION markers
    const markerCount = (specContent.match(/\[NEEDS CLARIFICATION/g) || []).length;
    if (markerCount > 0) {
      process.stderr.write(
        `\nSPEC INCOMPLETE: ${markerCount} marker${markerCount > 1 ? 's' : ''} open in ${specPath}\n` +
        `Resolve all [NEEDS CLARIFICATION] markers before committing.\n`
      );
      process.exit(2);
    }

    // 2. EARS grammar lint on AC titles (v3 Fase 1) — grandfathered specs skip.
    if (!isEarsGrandfathered(specContent)) {
      const entries = parseAcEntries(specContent);
      const invalid = entries.filter(e => !isEarsValid(e.title));
      if (invalid.length > 0) {
        const list = invalid.map(e => `  - ${e.id}: "${e.title}"`).join('\n');
        const forms = EARS_FORMS.map(f => `  * ${f.name}`).join('\n');
        process.stderr.write(
          `\nSPEC INCOMPLETE: ${invalid.length} AC${invalid.length > 1 ? 's' : ''} fora da gramática EARS em ${specPath}\n` +
          `${list}\n\n` +
          `Use uma das 5 formas EARS (SHALL obrigatório em todas):\n${forms}\n`
        );
        process.exit(2);
      }
    }

    // 3. Check AC coverage — skip if no tasksPath
    const acIds = parseAcIds(specContent);
    if (acIds.length === 0) process.exit(0);

    if (!tasksPath || !fs.existsSync(tasksPath)) {
      process.stderr.write(`[spec-completeness-gate] WARN: tasksPath missing or not found (${tasksPath})\n`);
      process.exit(0);
    }

    let tasksContent;
    try {
      tasksContent = fs.readFileSync(tasksPath, 'utf-8');
    } catch (e) {
      process.stderr.write(`[spec-completeness-gate] WARN: could not read tasks: ${e.message}\n`);
      process.exit(0);
    }

    const covered = parseCoveredAcs(tasksContent);
    const uncovered = acIds.filter(id => !covered.has(id));

    if (uncovered.length > 0) {
      process.stderr.write(
        `\nSPEC INCOMPLETE: ${uncovered.length} AC${uncovered.length > 1 ? 's' : ''} uncovered in ${specPath}\n` +
        `Uncovered: ${uncovered.join(', ')}\n` +
        `Add [SPEC:AC-XX] tags to tasks covering these criteria before committing.\n`
      );
      process.exit(2);
    }

    process.exit(0);
  } catch (_) {
    process.exit(0); // Fail-open
  }
}

main();
