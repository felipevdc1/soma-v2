#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', 'spec-completeness-gate.cjs');
const SESSION = 'test-scg-' + process.pid;

function stateFile() { return path.join(os.tmpdir(), `soma-state-${SESSION}.json`); }
function bypassMarker() { return path.join(os.tmpdir(), `soma-spec-bypass-${SESSION}.marker`); }

function run(command, extraEnv = {}) {
  const input = JSON.stringify({ tool_input: { command } });
  return spawnSync(process.execPath, [HOOK], {
    input,
    env: { ...process.env, CK_SESSION_ID: SESSION, ...extraEnv },
    encoding: 'utf-8',
  });
}

function writeState(specPath, tasksPath) {
  fs.writeFileSync(stateFile(), JSON.stringify({ specPath, tasksPath }));
}

function cleanup() {
  for (const f of [stateFile(), bypassMarker()]) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLEAN_SPEC = `
AC-1: User can log in
AC-2: User can log out
`;

const SPEC_WITH_MARKERS = `
AC-1: User can log in [NEEDS CLARIFICATION: which provider?]
AC-2: User can log out [NEEDS CLARIFICATION: session timeout?]
`;

const TASKS_ALL_COVERED = `
- Implement login [SPEC:AC-1]
- Implement logout [SPEC:AC-2]
`;

const TASKS_PARTIAL = `
- Implement login [SPEC:AC-1]
`;

// ── Tests ────────────────────────────────────────────────────────────────────

test('1. no state file → pass', () => {
  cleanup();
  const r = run('git commit -m "feat: x"');
  assert.equal(r.status, 0, 'should exit 0');
});

test('2. state + spec with 2 markers → block exit 2', (t) => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  fs.writeFileSync(spec, SPEC_WITH_MARKERS);
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  fs.unlinkSync(spec);
  cleanup();
  assert.equal(r.status, 2, 'should block');
  assert.match(r.stderr, /SPEC INCOMPLETE: 2 markers? open/);
});

test('3. state + clean spec + all ACs covered → allow', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  const tasks = path.join(os.tmpdir(), `tasks-scg-${SESSION}.md`);
  fs.writeFileSync(spec, CLEAN_SPEC);
  fs.writeFileSync(tasks, TASKS_ALL_COVERED);
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  fs.unlinkSync(spec);
  fs.unlinkSync(tasks);
  cleanup();
  assert.equal(r.status, 0, 'should allow');
});

test('4. state + clean spec + 1 uncovered AC → block with AC ID', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  const tasks = path.join(os.tmpdir(), `tasks-scg-${SESSION}.md`);
  fs.writeFileSync(spec, CLEAN_SPEC);
  fs.writeFileSync(tasks, TASKS_PARTIAL);
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  fs.unlinkSync(spec);
  fs.unlinkSync(tasks);
  cleanup();
  assert.equal(r.status, 2, 'should block');
  assert.match(r.stderr, /AC-2/);
});

test('5. git commit --amend --no-edit → pass (exempt)', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  fs.writeFileSync(spec, SPEC_WITH_MARKERS);
  writeState(spec, null);
  const r = run('git commit --amend --no-edit');
  fs.unlinkSync(spec);
  cleanup();
  assert.equal(r.status, 0, 'should be exempt');
});

test('6. bypass marker exists → allow + marker consumed', () => {
  cleanup();
  const spec = path.join(os.tmpdir(), `spec-scg-${SESSION}.md`);
  fs.writeFileSync(spec, SPEC_WITH_MARKERS);
  writeState(spec, null);
  fs.writeFileSync(bypassMarker(), '');
  const r = run('git commit -m "feat: bypass"');
  fs.unlinkSync(spec);
  cleanup();
  assert.equal(r.status, 0, 'should allow via bypass');
  assert.equal(fs.existsSync(bypassMarker()), false, 'marker should be consumed');
});

test('7. malformed state JSON → fail-open with stderr warning', () => {
  cleanup();
  fs.writeFileSync(stateFile(), '{invalid json}');
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, 'should fail-open');
  assert.match(r.stderr, /WARN/);
});

// ─────────────────────────────────────────────────────────────────────────
// v3 Fase 1: AC-line extraction reconciliation + EARS grammar lint.
//
// TDD discipline: this block was committed RED (extraction still anchored
// on the old bare `/^AC-(\d+):/` regex; no EARS lint exists yet) per
// Article II HARD enforcement.
//
// Bug being fixed: the old regex never matched the official template's
// `- **AC-NN:** ...` bullet form, nor the v3 Fase 1 `### AC-NN: ...`
// heading form — so "AC without test blocks commit" (Article I) found
// zero ACs against every spec written from the template. Dead enforcement
// that never complained because it never found anything to complain about.
// ─────────────────────────────────────────────────────────────────────────

function writeSpecFile(name, content) {
  const p = path.join(os.tmpdir(), `spec-scg-${name}-${SESSION}.md`);
  fs.writeFileSync(p, content);
  return p;
}

const OLD_CREATED = '**Created:** 2026-05-02';       // predates v3 Fase 1 EARS requirement
const BOUNDARY_CREATED = '**Created:** 2026-08-15';  // cutoff itself — must be validated, not grandfathered
const NEW_CREATED = '**Created:** 2026-08-20';        // clearly post-cutoff

// ── Parsing reconciliation: all 3 line forms must be recognized ──────────

test('8. AC in "### AC-01:" heading form is seen by the gate (uncovered → block)', () => {
  cleanup();
  const spec = writeSpecFile('heading', `${OLD_CREATED}\n\n### AC-01: WHEN x, the system does y\n`);
  // Use a tasksPath that exists but covers nothing, so the "AC found" claim is
  // unambiguous (exit 2 from real uncovered-AC detection, not a tasksPath-missing warn+exit0).
  const tasks = writeSpecFile('heading-tasks', '- nothing here\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (gate must see AC-01 as uncovered), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /AC-01/, `Expected AC-01 mentioned, got: ${r.stderr}`);
});

test('9. AC in "- **AC-01:**" bullet-bold form still seen (no regression)', () => {
  cleanup();
  const spec = writeSpecFile('bullet', `${OLD_CREATED}\n\n- **AC-01:** Given x, when y, then z\n`);
  const tasks = writeSpecFile('bullet-tasks', '- nothing here\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /AC-01/);
});

test('10. AC in bare "AC-01:" form still seen (no regression)', () => {
  cleanup();
  const spec = writeSpecFile('bare', `${OLD_CREATED}\n\nAC-01: forma nua\n`);
  const tasks = writeSpecFile('bare-tasks', '- nothing here\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /AC-01/);
});

// ── EARS grammar: the 5 valid forms, one at a time ────────────────────────

test('11. EARS Ubíqua form ("The {sistema} SHALL {resposta}") is valid', () => {
  cleanup();
  const spec = writeSpecFile('ears-ubiqua', `${NEW_CREATED}\n\n### AC-01: The system SHALL respond within 200ms\n`);
  const tasks = writeSpecFile('ears-ubiqua-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (valid EARS), got ${r.status}. stderr: ${r.stderr}`);
});

test('12. EARS Estado form ("WHILE {estado}, the {sistema} SHALL {resposta}") is valid', () => {
  cleanup();
  const spec = writeSpecFile('ears-estado', `${NEW_CREATED}\n\n### AC-01: WHILE the sync is running, the system SHALL block new writes\n`);
  const tasks = writeSpecFile('ears-estado-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (valid EARS), got ${r.status}. stderr: ${r.stderr}`);
});

test('13. EARS Evento form ("WHEN {gatilho}, the {sistema} SHALL {resposta}") is valid', () => {
  cleanup();
  const spec = writeSpecFile('ears-evento', `${NEW_CREATED}\n\n### AC-01: WHEN a request arrives, the system SHALL log it\n`);
  const tasks = writeSpecFile('ears-evento-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (valid EARS), got ${r.status}. stderr: ${r.stderr}`);
});

test('14. EARS Indesejado form ("IF {condição}, THEN the {sistema} SHALL {resposta}") is valid', () => {
  cleanup();
  const spec = writeSpecFile('ears-indesejado', `${NEW_CREATED}\n\n### AC-01: IF the disk is full, THEN the system SHALL abort with an error\n`);
  const tasks = writeSpecFile('ears-indesejado-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (valid EARS), got ${r.status}. stderr: ${r.stderr}`);
});

test('15. EARS Opcional form ("WHERE {contexto}, the {sistema} SHALL {resposta}") is valid', () => {
  cleanup();
  const spec = writeSpecFile('ears-opcional', `${NEW_CREATED}\n\n### AC-01: WHERE dark mode is enabled, the system SHALL use the dark palette\n`);
  const tasks = writeSpecFile('ears-opcional-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (valid EARS), got ${r.status}. stderr: ${r.stderr}`);
});

// ── EARS grammar: violations ──────────────────────────────────────────────

test('16. AC title outside the 5 EARS forms → block exit 2 citing the AC and the grammar', () => {
  cleanup();
  const spec = writeSpecFile('ears-invalid', `${NEW_CREATED}\n\n### AC-01: Given a user is logged in, when they click logout, then they are signed out\n`);
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2, got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /AC-01/, 'stderr should cite the offending AC');
  assert.match(r.stderr, /EARS/, 'stderr should reference the EARS grammar / valid forms');
});

test('17. WHEN-form AC missing SHALL → invalid (block exit 2)', () => {
  cleanup();
  const spec = writeSpecFile('ears-no-shall', `${NEW_CREATED}\n\n### AC-01: WHEN a request arrives, the system MUST respond\n`);
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (SHALL missing), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /AC-01/);
});

// ── Grandfathering via **Created:** ────────────────────────────────────────

test('18. Old spec (Created 2026-05-02) with non-EARS AC → passes (grandfathered)', () => {
  cleanup();
  const spec = writeSpecFile('grandfathered-old', `${OLD_CREATED}\n\n### AC-01: Given x, when y, then z\n`);
  const tasks = writeSpecFile('grandfathered-old-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (grandfathered), got ${r.status}. stderr: ${r.stderr}`);
});

test('19. Boundary spec (Created exactly 2026-08-15) with non-EARS AC → validated, blocks', () => {
  cleanup();
  const spec = writeSpecFile('grandfathered-boundary', `${BOUNDARY_CREATED}\n\n### AC-01: Given x, when y, then z\n`);
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (2026-08-15 is validated, not grandfathered), got ${r.status}. stderr: ${r.stderr}`);
});

test('20. Spec with NO Created field + non-EARS AC → passes (treated as pre-existing)', () => {
  cleanup();
  const spec = writeSpecFile('no-created', `### AC-01: Given x, when y, then z\n`);
  const tasks = writeSpecFile('no-created-tasks', '- impl [SPEC:AC-01]\n');
  writeState(spec, tasks);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (no Created field → not blocked), got ${r.status}. stderr: ${r.stderr}`);
});

// ─────────────────────────────────────────────────────────────────────────
// v3 preflight hotfix: phantom [NEEDS CLARIFICATION] markers.
//
// Bug: markerCount used a naive substring scan of the WHOLE spec file
// (`specContent.match(/\[NEEDS CLARIFICATION/g)`), so every occurrence
// counted — including the literal string repeated inside the official
// template's own <!-- guidance: ... --> comments and inside the
// Completeness Checklist's backtick-quoted reminder line. Every spec born
// from the template inherited markers that could never be resolved by a
// human, because they aren't real open questions.
//
// Fix: only count a marker in "open position" — a line that, after
// trimming leading whitespace and an optional bullet (-/*) and/or
// checkbox ([ ]/[x]), begins with the marker itself. HTML comments are
// stripped first (guidance text is never a real marker); inline code
// spans (single backticks) are stripped too (a marker quoted as literal
// text, e.g. the checklist line, isn't an open marker).
// ─────────────────────────────────────────────────────────────────────────

test('21. Open-position: 3 real markers in Open Questions + checklist backtick line → counts 3, blocks', () => {
  cleanup();
  const spec = writeSpecFile('open-position-3', [
    '## Open Questions',
    '',
    '- [NEEDS CLARIFICATION: question one]',
    '- [NEEDS CLARIFICATION: question two]',
    '- [NEEDS CLARIFICATION: question three]',
    '',
    '## Completeness Checklist',
    '',
    '- [ ] Zero `[NEEDS CLARIFICATION]` markers remaining',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (3 real markers), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 3 markers open/, `Expected count of 3, got: ${r.stderr}`);
});

test('22. Open-position: marker only inside <!-- guidance comment --> → counts 0, does not block', () => {
  cleanup();
  const spec = writeSpecFile('comment-only', [
    '<!-- guidance: Replace [NEEDS CLARIFICATION: ...] only when you have a real answer. -->',
    '',
    '## Open Questions',
    '',
    '(none — all resolved)',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (marker only in guidance comment), got ${r.status}. stderr: ${r.stderr}`);
});

test('23. Open-position: marker inside inline code (backticks) mid-paragraph → counts 0, does not block', () => {
  cleanup();
  const spec = writeSpecFile('backtick-mid',
    'Este texto menciona `[NEEDS CLARIFICATION: exemplo]` no meio do parágrafo, não como marker real.\n'
  );
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (marker inside inline code), got ${r.status}. stderr: ${r.stderr}`);
});

test('24. Open-position: full guidance-comment template present but 0 real markers → counts 0, commit not blocked', () => {
  cleanup();
  const spec = writeSpecFile('full-guidance-zero-real', [
    '<!-- guidance: Fill every {PLACEHOLDER}. Replace [NEEDS CLARIFICATION: ...] only when you have a real answer from the human. Never assume. -->',
    '',
    '## Open Questions',
    '',
    '<!-- guidance: NEVER assume. Mark every ambiguity. Loop ends when this section is empty. -->',
    '',
    '(none — all resolved)',
    '',
    '## Completeness Checklist',
    '',
    '<!-- guidance: All boxes must be checked (or replaced with [NEEDS CLARIFICATION]) before Gate 1. -->',
    '',
    '- [ ] Zero `[NEEDS CLARIFICATION]` markers remaining',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (only guidance/backtick occurrences, zero real markers), got ${r.status}. stderr: ${r.stderr}`);
});

test('25. Regression guard: a single real open-position marker still blocks (cure must not become permissive)', () => {
  cleanup();
  const spec = writeSpecFile('regression-single-real', [
    '## Open Questions',
    '',
    '- [NEEDS CLARIFICATION: still a real open question]',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (real marker must still block), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 1 marker open/);
});

test('26. Open-position: marker in open checklist item ("- [ ] [NEEDS CLARIFICATION: ...]") → counts 1, blocks', () => {
  cleanup();
  const spec = writeSpecFile('checklist-item-marker', [
    '## Open Questions',
    '',
    '- [ ] [NEEDS CLARIFICATION: unresolved item as checklist entry]',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (checklist-item marker counts), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 1 marker open/);
});

// ─────────────────────────────────────────────────────────────────────────
// v3 preflight hotfix — round 2: the "open position" rule (line must
// BEGIN with the marker) was itself a false negative. `/specify`
// (core/adapters/claude/commands/specify.md:100) explicitly instructs
// inserting the marker INLINE in place of {user} inside a User Story
// sentence ("Como [NEEDS CLARIFICATION: ...], quero..."), and :105 puts
// no positional constraint on AC markers either. A marker embedded
// mid-sentence — exactly what /specify produces — never starts the line,
// so the position rule silently let it through uncounted. The cure
// became a worse bug than the disease: unblockable specs, now with a
// green test on top.
// ─────────────────────────────────────────────────────────────────────────

test('27. Marker inline inside a User Story sentence (replacing {user}, as /specify instructs) → counts 1, blocks', () => {
  cleanup();
  const spec = writeSpecFile('inline-user-story', [
    '## User Stories',
    '',
    '- Como [NEEDS CLARIFICATION: qual tipo de usuário é o principal desta feature?], quero fazer X, pra Y.',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (inline User Story marker must count), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 1 marker open/);
});

test('28. Marker inline inside an AC SHALL clause → counts 1, blocks', () => {
  cleanup();
  const spec = writeSpecFile('inline-ac', [
    '## Acceptance Criteria',
    '',
    '### AC-01: WHEN a request arrives, the system SHALL respond within [NEEDS CLARIFICATION: qual o limite de tempo?]',
  ].join('\n'));
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (inline AC marker must count), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 1 marker open/);
});

// ─────────────────────────────────────────────────────────────────────────
// v3 preflight hotfix — round 3: dropping the position rule (round 2)
// restored a naive "any surviving literal counts" scan, which reintroduces
// a false positive the ORIGINAL bug already had: core/specs/014-manifest-
// baseline/spec.md:63 is retrospective prose — "These decisions resolve
// the original [NEEDS CLARIFICATION] markers" — not backtick-quoted, not
// in a comment, yet not a real open question either. It's the bare TOKEN
// used as a noun, not an instantiated marker.
//
// Rule: count every `[NEEDS CLARIFICATION` EXCEPT the bare token
// `[NEEDS CLARIFICATION]` (nothing between the words and the closing
// bracket). A real marker always carries content — ": pergunta",
// "- pergunta", or " pergunta" with no punctuation at all — so this still
// catches every authored form without requiring a colon specifically.
// (See the comment on countOpenClarificationMarkers for why a
// colon-required rule was rejected — it would silently miss dash- or
// space-punctuated markers.)
// ─────────────────────────────────────────────────────────────────────────

test('29. Bare token "[NEEDS CLARIFICATION]" used as a noun in retrospective prose → counts 0, does not block', () => {
  cleanup();
  const spec = writeSpecFile('bare-token-prose',
    'Estas decisões resolvem os antigos [NEEDS CLARIFICATION] markers (aprovados por Felipe).\n'
  );
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 0, `Expected exit 0 (bare token, not a real marker), got ${r.status}. stderr: ${r.stderr}`);
});

test('30. Marker punctuated with a dash instead of a colon ("[NEEDS CLARIFICATION - pergunta]") → counts 1, blocks', () => {
  cleanup();
  const spec = writeSpecFile('dash-marker',
    '- [NEEDS CLARIFICATION - qual limite?]\n'
  );
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (dash-punctuated marker must still count), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 1 marker open/);
});

test('31. Marker with no punctuation at all ("[NEEDS CLARIFICATION pergunta]") → counts 1, blocks', () => {
  cleanup();
  const spec = writeSpecFile('no-punct-marker',
    '- [NEEDS CLARIFICATION qual prazo?]\n'
  );
  writeState(spec, null);
  const r = run('git commit -m "feat: x"');
  cleanup();
  assert.equal(r.status, 2, `Expected exit 2 (unpunctuated marker must still count), got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stderr, /SPEC INCOMPLETE: 1 marker open/);
});
