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

function resolveRunModulesDirectory() {
  const sourceDirectory = path.join(__dirname, '..', 'scripts', 'run');
  if (fs.existsSync(path.join(sourceDirectory, 'run-id.cjs')) &&
      fs.existsSync(path.join(sourceDirectory, 'paths.cjs'))) {
    return sourceDirectory;
  }

  const somaHome = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
  return path.join(somaHome, 'scripts', 'run');
}

const runModulesDirectory = resolveRunModulesDirectory();
const {
  assertExactRunId,
  assertSafeRunId,
  reserveRunIdentity,
} = require(path.join(runModulesDirectory, 'run-id.cjs'));
const { resolveRunIdFromLock } = require(path.join(runModulesDirectory, 'paths.cjs'));

function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

function getProjectRoot() {
  const cwd = process.cwd();
  const tempDirectory = os.tmpdir();
  const expandedTempDirectory = path.join(path.sep, 'private', tempDirectory);
  if (process.platform === 'darwin' &&
      (cwd === expandedTempDirectory || cwd.startsWith(`${expandedTempDirectory}${path.sep}`))) {
    return path.join(tempDirectory, path.relative(expandedTempDirectory, cwd));
  }
  return cwd;
}

function readJsonSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// Spec 016 K2: the run-state moved from `os.tmpdir()/soma-state-{sessionId}.json`
// (soma-state/v1.0) to `{projectRoot}/.soma/run-state-{runId}.json`
// (soma-state/v2, contracts/persist-run-state.md). This hook is a consumer
// the contract explicitly calls out as "must not break" — so it looks in
// BOTH places, new location first, and only falls back to the old /tmp path
// when nothing is found at the new one. Legacy projects (no .soma/ at all)
// keep working exactly as before via that fallback.
//
function findNewRunStateCandidate(projectRoot) {
  const somaDir = path.join(projectRoot, '.soma');
  const lockPath = path.join(projectRoot, '.soma.lock');
  const lockPresent = fs.existsSync(lockPath);
  const lock = resolveRunIdFromLock(projectRoot);

  if (lock.status === 'ok') {
    const runId = assertSafeRunId(lock.runId);
    return {
      candidate: { runId, statePath: path.join(somaDir, `run-state-${runId}.json`) },
      allowLegacy: false,
    };
  }
  if (lockPresent && lock.status === 'invalid_run_id') {
    assertSafeRunId(undefined);
  }

  let entries;
  try {
    entries = fs.readdirSync(somaDir);
  } catch (_err) {
    return { candidate: null, allowLegacy: !lockPresent };
  }
  const candidates = entries
    .map((name) => ({ name, match: /^run-state-(.+)\.json$/.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => {
      const runId = assertSafeRunId(match[1]);
      return { runId, statePath: path.join(somaDir, name) };
    });
  if (candidates.length === 0) return { candidate: null, allowLegacy: !lockPresent };
  if (candidates.length > 1) {
    candidates.sort((a, b) => fs.lstatSync(b.statePath).mtimeMs - fs.lstatSync(a.statePath).mtimeMs);
  }
  return { candidate: candidates[0], allowLegacy: false };
}

function warnIdentityFailure(error) {
  const message = error && error.message ? error.message : String(error);
  const stable = message.match(/RUN_ID_[A-Z_]+/);
  process.stderr.write(
    `[spec-completeness-gate] WARN: ${stable ? message : `RUN_ID_IDENTITY_UNPROVABLE: ${message}`}\n`
  );
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

// v3 preflight hotfix: don't count every literal substring occurrence of
// [NEEDS CLARIFICATION — the official spec.md template repeats the string
// inside <!-- guidance: ... --> comments and inside the Completeness
// Checklist's own backtick-quoted reminder line, so a naive substring
// count made every templated spec unblockable (phantom markers a human
// can never resolve). Two filters, applied before counting:
//   1. Strip HTML comments (<!-- ... -->, including multi-line) — author
//      guidance, never a real marker.
//   2. Strip inline code spans (single backticks, same line) — a marker
//      quoted as literal text isn't an open marker.
//
// Round 2 (independent review caught this): an earlier version of this
// fix also required the marker to START its line ("open position"). That
// broke on the real-world case `/specify` actually produces —
// core/adapters/claude/commands/specify.md:100 inserts the marker INLINE
// in place of {user} inside a User Story sentence, and :105 puts no
// positional constraint on AC markers either. Position is NOT a valid
// signal for "is this a real marker"; only comments and inline-code
// quoting are.
function stripNonCountableRegions(specContent) {
  return specContent
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]*`/g, '');
}

// Round 3 (independent review caught this too): dropping the position
// rule in round 2 restored a plain "any surviving literal counts" scan,
// which reintroduced a false positive the ORIGINAL bug already had —
// core/specs/014-manifest-baseline/spec.md:63 is retrospective prose
// ("These decisions resolve the original [NEEDS CLARIFICATION] markers")
// that isn't backtick-quoted or commented out, yet isn't a real open
// question either: it's the bare TOKEN `[NEEDS CLARIFICATION]` used as a
// noun, with nothing between the words and the closing bracket.
//
// DO NOT "fix" this by requiring a colon (`\[NEEDS CLARIFICATION:`). A
// real marker's content isn't always colon-punctuated — `/specify` and
// hand-edited specs also produce `[NEEDS CLARIFICATION - question]` and
// even `[NEEDS CLARIFICATION question]` with no punctuation at all (see
// tests 30/31). A colon-required rule would silently miss those — an
// invisible false negative, worse than the visible false positive it
// would "fix". The correct signal is presence of ANY content before the
// closing bracket, not a specific punctuation mark.
const BARE_MARKER_TOKEN_RE = /\[NEEDS CLARIFICATION(?!\])/g;

function countOpenClarificationMarkers(specContent) {
  const stripped = stripNonCountableRegions(specContent);
  const matches = stripped.match(BARE_MARKER_TOKEN_RE);
  return matches ? matches.length : 0;
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
    const oldStatePath = path.join(tmpDir, `soma-state-${sessionId}.json`);
    const projectRoot = getProjectRoot();
    let selection;
    let state;
    try {
      selection = findNewRunStateCandidate(projectRoot);
      if (selection.candidate) {
        reserveRunIdentity({
          projectRoot,
          runId: selection.candidate.runId,
          allowNew: false,
        });
        state = readJsonSafe(selection.candidate.statePath);
        assertExactRunId(state && state.runId, selection.candidate.runId);
      }
    } catch (error) {
      warnIdentityFailure(error);
      process.exit(0);
    }

    if (!selection.candidate && !selection.allowLegacy) process.exit(0);
    const statePath = selection.candidate ? selection.candidate.statePath : oldStatePath;

    // No SOMA session → pass silently
    if (!fs.existsSync(statePath)) process.exit(0);

    // Check bypass marker (one-time escape hatch)
    const bypassMarker = path.join(tmpDir, `soma-spec-bypass-${sessionId}.marker`);
    if (fs.existsSync(bypassMarker)) {
      try { fs.unlinkSync(bypassMarker); } catch (_) {}
      process.exit(0);
    }

    // Read SOMA state — fail-open on bad JSON
    if (!state) {
      try {
        state = readJsonSafe(statePath);
      } catch (e) {
        process.stderr.write(`[spec-completeness-gate] WARN: could not parse soma-state: ${e.message}\n`);
        process.exit(0);
      }
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

    // 1. Count open [NEEDS CLARIFICATION markers (open-position only — see
    // countOpenClarificationMarkers above)
    const markerCount = countOpenClarificationMarkers(specContent);
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

// Only run as a hook process when invoked directly (PreToolUse spawns this
// file as `node spec-completeness-gate.cjs`). When `require()`d as a library
// — e.g. by the spec-lint linter consuming these parsing primitives (Spec
// 017 AC-13) — main() must NOT fire: it reads stdin and calls process.exit,
// which would hijack the importing process.
if (require.main === module) {
  main();
}

module.exports = {
  AC_LINE_RE,
  parseAcEntries,
  parseAcIds,
  isEarsValid,
  EARS_FORMS,
  EARS_GATE_DATE,
  extractCreatedDate,
  isEarsGrandfathered,
  parseCoveredAcs,
  BARE_MARKER_TOKEN_RE,
  stripNonCountableRegions,
  countOpenClarificationMarkers,
};
