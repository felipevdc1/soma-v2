'use strict';
/**
 * capture-defer-gate.test.cjs — Tests for Article XI Capture-or-Defer Gate Hook
 *
 * @spec AC-01..AC-15
 * @contract CONTRACT-CAPTURE-DEFER-GATE-01
 *
 * TDD discipline: This file was committed RED (hook not yet implemented) per Article II HARD enforcement.
 * Tests invoke the hook via spawnSync with synthetic stdin JSON + synthetic JSONL transcripts.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Absolute path to hook under test
const HOOK_PATH = path.join(__dirname, '..', 'capture-defer-gate.cjs');

// Isolated telemetry log dir for this test run — the hook honors
// ARTICLE_XI_LOG_DIR so the suite never writes into the real
// ~/.claude/logs/article-xi-*.jsonl production log.
const TEST_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'article-xi-test-logs-'));

// ── Helper: create a synthetic transcript JSONL in /tmp and return path ──────

function makeTranscript(entries, slug) {
  const dir = `/tmp/article-xi-fixture-${slug}`;
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'transcript.jsonl');
  const lines = entries.map(e => JSON.stringify(e));
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function assistantEntry(text) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] }
  };
}

function userEntry(text) {
  return { type: 'user', message: text };
}

// ── Helper: invoke hook with stdin JSON ───────────────────────────────────────

function invokeHook(transcriptPath, sessionId, extraEnv = {}) {
  const stdin = JSON.stringify({
    session_id: sessionId || 'test-session',
    transcript_path: transcriptPath || '',
    stop_hook_active: true,
    hookSpecificInput: { stop_reason: 'end_turn' }
  });
  const env = { ...process.env, ARTICLE_XI_LOG_DIR: TEST_LOG_DIR, ...extraEnv };
  return spawnSync('node', [HOOK_PATH], {
    input: stdin,
    encoding: 'utf8',
    env
  });
}

// ── Helper: get today's telemetry log path (isolated test dir — see TEST_LOG_DIR) ──

function getTelemetryPath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(TEST_LOG_DIR, `article-xi-${today}.jsonl`);
}

function countTelemetryLines() {
  const p = getTelemetryPath();
  if (!fs.existsSync(p)) return 0;
  const content = fs.readFileSync(p, 'utf8').trim();
  if (!content) return 0;
  return content.split('\n').length;
}

// ── AC-01: English defer-phrase detection ─────────────────────────────────────

describe('AC-01: English defer-phrase detection', () => {
  test('detects "we will do X later"', () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("We will do the cache invalidation later.")], 'ac01-a');
    const r = invokeHook(t, 'ac01-a');
    // soft-warn mode: exit 0, but stderr contains warning
    assert.equal(r.status, 0, `Expected exit 0 in soft-warn mode, got ${r.status}`);
    assert.match(r.stderr, /Article XI/, `Expected 'Article XI' in stderr, got: ${r.stderr}`);
  });

  test("detects \"we'll do X later\"", () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("We'll do the auth refactor later.")], 'ac01-b');
    const r = invokeHook(t, 'ac01-b');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "out of scope for now"', () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("That's out of scope for now.")], 'ac01-c');
    const r = invokeHook(t, 'ac01-c');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "future work"', () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("This is future work to be tackled.")], 'ac01-d');
    const r = invokeHook(t, 'ac01-d');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "deferred to next session"', () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("This is deferred to next session.")], 'ac01-e');
    const r = invokeHook(t, 'ac01-e');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "post-Phase 5"', () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("We'll tackle this post-Phase 5.")], 'ac01-f');
    const r = invokeHook(t, 'ac01-f');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects bare TODO without ticket reference', () => {
    // @spec AC-01
    const t = makeTranscript([assistantEntry("TODO: handle this edge case.")], 'ac01-g');
    const r = invokeHook(t, 'ac01-g');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });
});

// ── AC-02: Portuguese defer-phrase detection ──────────────────────────────────

describe('AC-02: Portuguese (pt-br) defer-phrase detection', () => {
  test('detects "vamos fazer depois"', () => {
    // @spec AC-02
    const t = makeTranscript([assistantEntry("Vamos fazer a integração do cache depois.")], 'ac02-a');
    const r = invokeHook(t, 'ac02-a');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "fica pra próxima sessão"', () => {
    // @spec AC-02
    const t = makeTranscript([assistantEntry("Isso fica pra próxima sessão.")], 'ac02-b');
    const r = invokeHook(t, 'ac02-b');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "deferido"', () => {
    // @spec AC-02
    const t = makeTranscript([assistantEntry("Item deferido para próxima sprint.")], 'ac02-c');
    const r = invokeHook(t, 'ac02-c');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "fora de escopo"', () => {
    // @spec AC-02
    const t = makeTranscript([assistantEntry("Isso está fora de escopo por enquanto.")], 'ac02-d');
    const r = invokeHook(t, 'ac02-d');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });

  test('detects "pra próxima sprint"', () => {
    // @spec AC-02
    const t = makeTranscript([assistantEntry("Deixa pra próxima sprint resolver.")], 'ac02-e');
    const r = invokeHook(t, 'ac02-e');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/);
  });
});

// ── AC-03: Clean output passthrough ──────────────────────────────────────────

describe('AC-03: Clean output → exit 0, no warnings, no telemetry', () => {
  test('clean turn produces no warning and no telemetry entry', () => {
    // @spec AC-03
    // Use unique session ID to check session-level telemetry, not global line count
    // (global count check is flaky when parallel tests write to same log file)
    const sessionId = `ac03-clean-${Date.now()}`;
    const t = makeTranscript([assistantEntry("Implemented and tested. All ACs pass.")], 'ac03-a');
    const r = invokeHook(t, sessionId);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '', `Expected empty stderr for clean output, got: ${r.stderr}`);
    // Verify this session did NOT produce any telemetry entry
    const logPath = getTelemetryPath();
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
      const found = lines.find(l => { try { return JSON.parse(l).session_id === sessionId; } catch (_) { return false; } });
      assert.equal(found, undefined, `No telemetry expected for session ${sessionId} on clean turn`);
    }
  });
});

// ── AC-04: Capture target verification ───────────────────────────────────────

describe('AC-04: Capture target patterns recognized → status:captured', () => {
  test('handoff file reference → captured', () => {
    // @spec AC-04
    const text = "We'll do the migration later. Captured in ~/.claude/plans/handoff-soma-v21.md bucket A.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-handoff');
    const r = invokeHook(t, 'ac04-handoff');
    assert.equal(r.status, 0);
    // No warning when captured
    assert.equal(r.stderr, '', `Expected no warning when captured, got: ${r.stderr}`);
  });

  test('specs path reference → captured', () => {
    // @spec AC-04
    const text = "This is out of scope for now. Captured in specs/008-soma-bootstrap/spec.md Out of Scope section.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-specs');
    const r = invokeHook(t, 'ac04-specs');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('ADR path reference → captured', () => {
    // @spec AC-04
    const text = "We'll do X later. See .soma/decisions/ADR-0001-auth-strategy.md for capture.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-adr');
    const r = invokeHook(t, 'ac04-adr');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('.soma/CONTEXT.md reference → captured', () => {
    // @spec AC-04
    const text = "Future work. See .soma/CONTEXT.md routing notes for this item.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-context');
    const r = invokeHook(t, 'ac04-context');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('memory path reference → captured', () => {
    // @spec AC-04
    const text = "Deferred. Captured in ~/.claude/projects/myproject/memory/project_soma.md entry.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-memory');
    const r = invokeHook(t, 'ac04-memory');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('handoff bucket reference → captured', () => {
    // @spec AC-04
    const text = "We'll do this later. Captured in handoff bucket A.bis for next session.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-bucket');
    const r = invokeHook(t, 'ac04-bucket');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('memory entry reference → captured', () => {
    // @spec AC-04
    const text = "Future work. memory entry project_soma captures this decision.";
    const t = makeTranscript([assistantEntry(text)], 'ac04-mementry');
    const r = invokeHook(t, 'ac04-mementry');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });
});

// ── AC-05: Soft-warn mode (default) ──────────────────────────────────────────

describe('AC-05: Uncaptured defer + soft-warn → stderr only, exit 0', () => {
  test('uncaptured defer in soft-warn mode: exit 0 + stderr warning', () => {
    // @spec AC-05
    const t = makeTranscript([assistantEntry("That's out of scope for now.")], 'ac05-a');
    const r = invokeHook(t, 'ac05-a');
    assert.equal(r.status, 0, 'soft-warn should not block (exit 0)');
    assert.match(r.stderr, /Article XI/);
  });

  test('stdout is empty in soft-warn mode (no JSON block output)', () => {
    // @spec AC-05
    const t = makeTranscript([assistantEntry("We will do X later.")], 'ac05-b');
    const r = invokeHook(t, 'ac05-b');
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', `Expected empty stdout, got: ${r.stdout}`);
  });
});

// ── AC-06: Hard-block mode ────────────────────────────────────────────────────

describe('AC-06: Uncaptured defer + hard-block → exit 2 + JSON decision', () => {
  test('uncaptured defer in hard-block mode: exit 2', () => {
    // @spec AC-06
    const t = makeTranscript([assistantEntry("We'll do the auth refactor later.")], 'ac06-a');
    const r = invokeHook(t, 'ac06-a', { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 2, `Expected exit 2 in hard-block mode, got ${r.status}`);
  });

  test('hard-block outputs JSON with decision:block', () => {
    // @spec AC-06
    const t = makeTranscript([assistantEntry("This is future work.")], 'ac06-b');
    const r = invokeHook(t, 'ac06-b', { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 2);
    let decision;
    assert.doesNotThrow(() => { decision = JSON.parse(r.stdout); }, `stdout must be valid JSON, got: ${r.stdout}`);
    assert.equal(decision.decision, 'block');
    assert.ok(decision.reason, 'Expected reason field in block JSON');
  });

  test('hard-block reason mentions Article XI', () => {
    // @spec AC-06
    const t = makeTranscript([assistantEntry("Deferred to next session.")], 'ac06-c');
    const r = invokeHook(t, 'ac06-c', { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 2);
    const decision = JSON.parse(r.stdout);
    assert.match(decision.reason, /Article XI/);
  });

  test('captured defer in hard-block mode: exit 0 (no block)', () => {
    // @spec AC-06 — captured defer should not block even in hard mode
    const text = "We'll do this later. Captured in ~/.claude/plans/handoff-soma-v21.md bucket.";
    const t = makeTranscript([assistantEntry(text)], 'ac06-captured');
    const r = invokeHook(t, 'ac06-captured', { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 0, 'Captured defer should not block in hard mode');
  });
});

// ── AC-07: Marker file bypass ─────────────────────────────────────────────────

describe('AC-07: Marker file bypass → skip entirely', () => {
  test('marker file bypass: exit 0, no scan, no telemetry for session', () => {
    // @spec AC-07
    const sessionId = `bypass-test-${Date.now()}`;
    const markerPath = `/tmp/article-xi-bypass-${sessionId}`;
    fs.writeFileSync(markerPath, '');
    try {
      const t = makeTranscript([assistantEntry("We'll do X later.")], 'ac07-a');
      const r = invokeHook(t, sessionId);
      assert.equal(r.status, 0);
      assert.equal(r.stderr, '');
      // Session-level check: this session should not appear in telemetry
      const logPath = getTelemetryPath();
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
        const found = lines.find(l => { try { return JSON.parse(l).session_id === sessionId; } catch (_) { return false; } });
        assert.equal(found, undefined, `Marker bypass should not write telemetry for session ${sessionId}`);
      }
    } finally {
      try { fs.unlinkSync(markerPath); } catch (_) {}
    }
  });

  test('marker file bypass: no Article XI warning in stderr', () => {
    // @spec AC-07
    const sessionId = `bypass-test2-${Date.now()}`;
    const markerPath = `/tmp/article-xi-bypass-${sessionId}`;
    fs.writeFileSync(markerPath, '');
    try {
      const t = makeTranscript([assistantEntry("Future work remains.")], 'ac07-b');
      const r = invokeHook(t, sessionId);
      assert.doesNotMatch(r.stderr, /Article XI/, 'No Article XI warning expected with bypass active');
    } finally {
      try { fs.unlinkSync(markerPath); } catch (_) {}
    }
  });
});

// ── AC-08: Env var disabled bypass ───────────────────────────────────────────

describe('AC-08: ARTICLE_XI_DISABLED=1 bypass', () => {
  test('env disabled bypass: exit 0, no telemetry for session', () => {
    // @spec AC-08
    const sessionId = `ac08-disabled-${Date.now()}`;
    const t = makeTranscript([assistantEntry("We'll do X later.")], 'ac08-a');
    const r = invokeHook(t, sessionId, { ARTICLE_XI_DISABLED: '1' });
    assert.equal(r.status, 0);
    // Session-level check
    const logPath = getTelemetryPath();
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
      const found = lines.find(l => { try { return JSON.parse(l).session_id === sessionId; } catch (_) { return false; } });
      assert.equal(found, undefined, `Disabled env should not write telemetry for session ${sessionId}`);
    }
  });

  test('env disabled bypass: no stderr output', () => {
    // @spec AC-08
    const t = makeTranscript([assistantEntry("Deferred to next session.")], 'ac08-b');
    const r = invokeHook(t, 'ac08-session-b', { ARTICLE_XI_DISABLED: '1' });
    assert.equal(r.stderr, '');
  });
});

// ── AC-09: Telemetry JSONL schema ─────────────────────────────────────────────

// Helper: find telemetry entry for a specific session ID
function findTelemetryEntry(sessionId) {
  const logPath = getTelemetryPath();
  if (!fs.existsSync(logPath)) return null;
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.session_id === sessionId) return entry;
    } catch (_) {}
  }
  return null;
}

describe('AC-09: Telemetry JSONL schema validation', () => {
  test('telemetry entry has required schema fields', () => {
    // @spec AC-09
    const sessionId = `telemetry-schema-${Date.now()}`;
    const t = makeTranscript([assistantEntry("We'll do X later.")], 'ac09-a');
    const r = invokeHook(t, sessionId);
    assert.equal(r.status, 0);

    const entry = findTelemetryEntry(sessionId);
    assert.ok(entry, `Telemetry entry not found for session ${sessionId}`);
    assert.equal(entry.schema, 'article-xi-telemetry/v1');
    assert.ok(entry.timestamp, 'Missing timestamp');
    assert.ok(entry.session_id, 'Missing session_id');
    assert.ok(entry.phrase_matched, 'Missing phrase_matched');
    assert.ok(entry.phrase_locale, 'Missing phrase_locale');
    assert.ok(entry.status, 'Missing status');
    assert.ok(typeof entry.hard_mode === 'boolean', 'hard_mode must be boolean');
    assert.ok(typeof entry.blocked === 'boolean', 'blocked must be boolean');
  });

  test('telemetry status is "uncaptured" when no capture target referenced', () => {
    // @spec AC-09
    const sessionId = `telemetry-uncaptured-${Date.now()}`;
    const t = makeTranscript([assistantEntry("Out of scope for now.")], 'ac09-b');
    const r = invokeHook(t, sessionId);
    assert.equal(r.status, 0);

    const entry = findTelemetryEntry(sessionId);
    assert.ok(entry, `Telemetry entry not found for session ${sessionId}`);
    assert.equal(entry.status, 'uncaptured');
    assert.equal(entry.capture_target, null);
  });

  test('telemetry status is "captured" when capture target is referenced', () => {
    // @spec AC-09
    const sessionId = `telemetry-captured-${Date.now()}`;
    const text = "Future work. Captured in specs/008-soma-bootstrap/spec.md Out of Scope.";
    const t = makeTranscript([assistantEntry(text)], 'ac09-c');
    const r = invokeHook(t, sessionId);
    assert.equal(r.status, 0);

    const entry = findTelemetryEntry(sessionId);
    assert.ok(entry, `Telemetry entry not found for session ${sessionId}`);
    assert.equal(entry.status, 'captured');
    assert.ok(entry.capture_target, 'capture_target should not be null when captured');
  });
});

// ── AC-10: JSONL parseable per-line ──────────────────────────────────────────

describe('AC-10: Telemetry JSONL is parseable line by line', () => {
  test('every line in telemetry log is valid JSON', () => {
    // @spec AC-10 — First create some entries, then verify all parseable
    const sessionId = `jsonl-test-${Date.now()}`;
    const t = makeTranscript([assistantEntry("We'll do X later.")], 'ac10-a');
    invokeHook(t, sessionId);

    const logPath = getTelemetryPath();
    if (!fs.existsSync(logPath)) return; // No log file yet is acceptable

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      let parsed;
      assert.doesNotThrow(
        () => { parsed = JSON.parse(line); },
        `Line is not valid JSON: ${line.slice(0, 80)}`
      );
      assert.ok(parsed.schema, `Missing schema field in line: ${line.slice(0, 80)}`);
    }
  });
});

// ── AC-11: Multi-turn search ──────────────────────────────────────────────────

describe('AC-11: Multi-turn search — capture target in previous turn', () => {
  test('capture in previous turn + defer in current turn → captured', () => {
    // @spec AC-11
    const sessionId = `multiturn-${Date.now()}`;
    const entries = [
      assistantEntry("Captured this in specs/010-capture-defer-gate/spec.md Out of Scope section."),
      userEntry("ok"),
      assistantEntry("OK, we'll do that later.")
    ];
    const t = makeTranscript(entries, 'ac11-a');
    const r = invokeHook(t, sessionId);
    assert.equal(r.status, 0);
    // No warning because capture was in previous turn
    assert.equal(r.stderr, '', `Previous-turn capture should suppress warning, got: ${r.stderr}`);
  });

  test('no capture in either current or previous turn → uncaptured', () => {
    // @spec AC-11
    const sessionId = `multiturn-uncaptured-${Date.now()}`;
    const entries = [
      assistantEntry("Here is some unrelated content about the architecture."),
      userEntry("what about X?"),
      assistantEntry("We'll do X later.")
    ];
    const t = makeTranscript(entries, 'ac11-b');
    const r = invokeHook(t, sessionId);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Article XI/, 'Should warn when no capture in 2-turn window');
  });
});

// ── AC-12: Soft-warn default mode ────────────────────────────────────────────

describe('AC-12: Soft-warn is the default mode', () => {
  test('without ARTICLE_XI_HARD env: exit 0 on uncaptured defer', () => {
    // @spec AC-12
    const t = makeTranscript([assistantEntry("We will defer X.")], 'ac12-a');
    const r = invokeHook(t, 'ac12-a', { ARTICLE_XI_HARD: undefined });
    assert.equal(r.status, 0);
  });

  test('with ARTICLE_XI_HARD=0: exit 0 on uncaptured defer (explicit soft-warn)', () => {
    // @spec AC-12
    const t = makeTranscript([assistantEntry("Future work.")], 'ac12-b');
    const r = invokeHook(t, 'ac12-b', { ARTICLE_XI_HARD: '0' });
    assert.equal(r.status, 0);
  });
});

// ── AC-13: Hard-block via env var ─────────────────────────────────────────────

describe('AC-13: ARTICLE_XI_HARD=1 enables hard-block', () => {
  test('ARTICLE_XI_HARD=1 blocks uncaptured defer with exit 2', () => {
    // @spec AC-13
    const t = makeTranscript([assistantEntry("We'll handle this out of scope item later.")], 'ac13-a');
    const r = invokeHook(t, 'ac13-a', { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 2);
  });

  test('ARTICLE_XI_HARD=1 with captured defer: exit 0 (no block)', () => {
    // @spec AC-13
    const text = "Out of scope for now. See ~/.claude/plans/handoff-vidin-os.md for capture.";
    const t = makeTranscript([assistantEntry(text)], 'ac13-captured');
    const r = invokeHook(t, 'ac13-captured', { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 0);
  });
});

// ── Additional edge case tests ────────────────────────────────────────────────

describe('Edge cases and contract completeness', () => {
  test('malformed stdin JSON: exits 0 (fail open)', () => {
    // @contract CONTRACT-CAPTURE-DEFER-GATE-01 error-handling
    const r = spawnSync('node', [HOOK_PATH], {
      input: 'not-valid-json',
      encoding: 'utf8',
      env: { ...process.env, ARTICLE_XI_LOG_DIR: TEST_LOG_DIR }
    });
    assert.equal(r.status, 0, 'Malformed stdin should fail open (exit 0)');
  });

  test('missing transcript_path: exits 0 gracefully (scans empty content)', () => {
    // @contract CONTRACT-CAPTURE-DEFER-GATE-01 error-handling
    const stdin = JSON.stringify({
      session_id: 'no-transcript',
      transcript_path: '/tmp/nonexistent-transcript-xyz.jsonl',
      hookSpecificInput: { stop_reason: 'end_turn' }
    });
    const r = spawnSync('node', [HOOK_PATH], {
      input: stdin,
      encoding: 'utf8',
      env: { ...process.env, ARTICLE_XI_LOG_DIR: TEST_LOG_DIR }
    });
    assert.equal(r.status, 0, 'Missing transcript should not crash hook');
  });

  test('TODO with ticket reference is NOT flagged', () => {
    // @spec AC-01 — TODO with file reference should not trigger
    const t = makeTranscript([assistantEntry("TODO: see specs/010-capture-defer-gate/spec.md for details.")], 'edge-todo-with-ref');
    const r = invokeHook(t, 'edge-todo-with-ref');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '', 'TODO with spec reference should not warn');
  });

  test('hard-block telemetry entry has blocked:true', () => {
    // @spec AC-09 — hard-block should set blocked:true in telemetry
    const sessionId = `hard-telemetry-${Date.now()}`;
    const t = makeTranscript([assistantEntry("We'll do X later.")], 'edge-hard-tel');
    const r = invokeHook(t, sessionId, { ARTICLE_XI_HARD: '1' });
    assert.equal(r.status, 2);

    const entry = findTelemetryEntry(sessionId);
    assert.ok(entry, `Telemetry entry not found for session ${sessionId}`);
    assert.equal(entry.hard_mode, true);
    assert.equal(entry.blocked, true);
  });

  test('phrase_locale is en for English phrases', () => {
    // @spec AC-09
    const sessionId = `locale-en-${Date.now()}`;
    const t = makeTranscript([assistantEntry("We will handle this future work later.")], `edge-locale-en-${sessionId}`);
    invokeHook(t, sessionId);

    const entry = findTelemetryEntry(sessionId);
    assert.ok(entry, `Telemetry entry not found for session ${sessionId}`);
    assert.equal(entry.phrase_locale, 'en');
  });

  test('phrase_locale is pt-br for Portuguese phrases', () => {
    // @spec AC-09
    const sessionId = `locale-ptbr-${Date.now()}`;
    const t = makeTranscript([assistantEntry("Isso fica pra próxima sessão.")], `edge-locale-ptbr-${sessionId}`);
    invokeHook(t, sessionId);

    const entry = findTelemetryEntry(sessionId);
    assert.ok(entry, `Telemetry entry not found for session ${sessionId}`);
    assert.equal(entry.phrase_locale, 'pt-br');
  });
});
