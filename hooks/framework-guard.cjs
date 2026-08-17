#!/usr/bin/env node
/**
 * PreToolUse Hook — Framework Guard
 * Part of: SOMA v2 / Spec 016 (T-12, AC-07 + AC-13)
 *
 * Fires: Before every Bash tool call
 * Purpose: Block `git commit` when staged changes touch protected framework
 *          paths (hooks/**, core/scripts/**, constitution*, install/**),
 *          unless a one-time bypass marker is present for this session.
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

// Protected paths — contract's default list. `hooks/**`, `core/scripts/**`,
// and `install/**` are directory prefixes; `constitution*` is a root-level
// glob (no `**`), so it matches `constitution.md` but NOT a nested
// `docs/constitution.md` — a bare `*` only spans one path segment.
const PROTECTED_PATTERNS = ['hooks/**', 'core/scripts/**', 'constitution*', 'install/**'];

function patternToMatcher(pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return (relPath) => relPath === prefix || relPath.startsWith(prefix + '/');
  }
  if (!pattern.includes('/')) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    const re = new RegExp(`^${escaped}$`);
    return (relPath) => re.test(relPath);
  }
  // Not exercised by the current pattern list (every entry above is either
  // a `dir/**` prefix or a slash-free root glob) — exact match as a safe
  // fallback if PROTECTED_PATTERNS ever grows a literal path.
  return (relPath) => relPath === pattern;
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
