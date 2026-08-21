#!/usr/bin/env node
/**
 * PreToolUse Hook — Framework Guard
 * Part of: SOMA v2 / Spec 016 (T-12, AC-07 + AC-13)
 *
 * Fires: Before every Bash tool call
 * Purpose: Block `git commit` when staged changes touch protected framework
 *          paths (hooks, core/scripts, constitution files/amendments at any
 *          depth, install — see PROTECTED_PATTERNS below for the exact
 *          globs), unless a one-time bypass marker is present for this
 *          session.
 *
 * Contract: core/specs/016-artifact-gated-trilho/contracts/framework-guard-hook.md
 * (CONTRACT-FRAMEWORK-GUARD-04)
 *
 * Exit Codes:
 *   0 - Allow (not a commit, no protected path staged, override applied
 *       via marker, or not inside a git repo — the one deliberate
 *       exception to "impossibility-to-check is REJECT": see the
 *       contract's note on why failing closed here would be worse)
 *   2 - Block (a staged path matches a protected pattern, no matching
 *       bypass marker for this session)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Same convention as the repo's other SOMA hooks (spec-completeness-
// gate.cjs, spec-test-traceability.cjs): sessionId comes from the env var
// the harness sets, NEVER from stdin. A real PreToolUse payload carries its
// own top-level `session_id` field — trusting that instead would let a
// stale/foreign session's bypass marker leak into this one (this exact trap
// produced false-green 2x on 2026-08-14/15, per the contract).
function getSessionId() {
  return process.env.CK_SESSION_ID || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
}

// Protected paths — contract's default list (fixed 2026-08-17: `constitution*`
// alone was a root-level-only glob, so it never matched the constitution's
// REAL location, `core/docs/constitution.md` — the guard advertised
// protection it didn't deliver, on the most normative artifact in the repo.
// Two patterns now cover it, because one doesn't: `**/constitution*` matches
// the file at any depth, but NOT the contents of `constitution-amendments/`
// (that directory's last path segment is the amendment's own `.md` name, not
// something starting with "constitution"); `**/constitution*/**` closes that
// half. `core/hooks/**`, `core/scripts/**`, and `install/**` are directory
// prefixes, unaffected by the fix).
//
// `core/hooks/**` (T-08a / D-018-07, 2026-08-21): was the literal `hooks/**`
// until the repo layout moved hooks/ under core/hooks/ (git mv). A literal
// prefix pattern has no leading `**/`, so it does NOT match paths under the
// new location on its own — this exact silent-failure risk is why the move
// and this pattern update are the same task: `core/hooks/x.cjs` would stop
// being protected without a single test going red.
const PROTECTED_PATTERNS = [
  'core/hooks/**',
  'core/scripts/**',
  '**/constitution*',
  '**/constitution*/**',
  'install/**',
];

// General double-star-aware glob -> RegExp. Handles `**` as a whole path
// segment (matching zero or more full segments) in ANY position — leading
// (`**/x`), trailing (`x/**`), or middle (`**/x/**`) — and `*` within a
// segment as a single-segment wildcard (never crosses a `/`). This single
// function replaces what used to be two separate cases (a `dir/**` prefix
// check and a slash-free root-glob check) because `**/constitution*/**`
// needs BOTH a leading and a trailing `**` in the same pattern — a "handles
// `**` only at one end" matcher can't express it.
function patternToRegex(pattern) {
  const segments = pattern.split('/');
  let re = '^';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '**') {
      const hasBefore = i > 0;
      const hasAfter = i < segments.length - 1;
      if (hasAfter) {
        re += '(?:.*/)?'; // leading or middle **: zero or more segments, then '/'
      } else if (hasBefore) {
        re += '(?:/.*)?'; // trailing **: '/' then zero or more segments
      } else {
        re += '.*'; // pattern is just '**' alone — not used today, kept sound
      }
    } else {
      const escaped = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      // Only add a literal '/' separator when the previous segment wasn't a
      // '**' — that case already folded its own separator into the group above.
      if (i > 0 && segments[i - 1] !== '**') re += '/';
      re += escaped;
    }
  }
  re += '$';
  return new RegExp(re);
}

function patternToMatcher(pattern) {
  const re = patternToRegex(pattern);
  return (relPath) => re.test(relPath);
}

const MATCHERS = PROTECTED_PATTERNS.map(patternToMatcher);

function isProtected(relPath) {
  return MATCHERS.some((matches) => matches(relPath));
}

// AC-13 override marker — same {os.tmpdir()}/claude-*-{sessionId}.marker
// shape as the repo's existing bypass markers. ⚠️ os.tmpdir() on this Mac
// is NOT `/tmp` — never hardcode the literal, here or in a caller creating
// the marker.
function markerPath(sessionId) {
  return path.join(os.tmpdir(), `claude-framework-guard-bypass-${sessionId}.marker`);
}

function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const command = (payload.tool_input || {}).command || '';

    // Only intercept git commit invocations — everything else passes
    // through silently (contract's "Trigger" section).
    if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

    // Staged files, real `git diff --cached` (Article III — no fs/child_process
    // mock). A failure here (not a repo, git unavailable) fails OPEN: the one
    // deliberate exception to AC-10 in this spec set — failing closed would
    // make committing impossible in every non-git directory, for zero real
    // protection (blast-radius reasoning documented in the contract).
    let staged;
    try {
      const out = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      staged = out.split('\n').map((line) => line.trim()).filter(Boolean);
    } catch (err) {
      process.stderr.write(
        `[framework-guard] WARN: could not read staged files (not a git repo, or git unavailable): ${err.message}\n`
      );
      process.exit(0);
    }

    const offenders = staged.filter(isProtected);
    if (offenders.length === 0) process.exit(0);

    const sessionId = getSessionId();
    const marker = markerPath(sessionId);

    if (fs.existsSync(marker)) {
      // AC-13: override is NEVER silent, and is single-use — same
      // one-time-escape-hatch convention as spec-completeness-gate.cjs's
      // bypass marker.
      try { fs.unlinkSync(marker); } catch (_) { /* best effort */ }
      const list = offenders.map((p) => `  - ${p}`).join('\n');
      process.stderr.write(
        `\n[framework-guard] OVERRIDE APPLIED — bypass marker consumed for session ${sessionId}.\n` +
        `Released protected paths:\n${list}\n`
      );
      process.exit(0);
    }

    const list = offenders.map((p) => `  - ${p}`).join('\n');
    process.stderr.write(
      `\nFRAMEWORK GUARD: commit blocked — staged changes touch protected framework paths:\n${list}\n\n` +
      `Protected: ${PROTECTED_PATTERNS.join(', ')}\n` +
      `To override once, create ${marker}\n`
    );
    process.exit(2);
  } catch (_err) {
    process.exit(0); // Fail-open on any unexpected error
  }
}

main();
