#!/usr/bin/env node
/**
 * capture-defer-gate.cjs — Article XI Capture-or-Defer Gate Hook
 *
 * Stop event hook that detects "defer-and-forget" anti-pattern (failure mode #8).
 * Scans assistant turn output for defer-phrases (en + pt-br), verifies capture
 * target references in current OR last turn, emits decision per mode:
 *   - soft-warn (default): stderr warning + exit 0
 *   - hard-block (ARTICLE_XI_HARD=1): stdout JSON + exit 2
 *
 * Logs every detection to ~/.claude/logs/article-xi-{YYYY-MM-DD}.jsonl (JSONL).
 * Set ARTICLE_XI_LOG_DIR to redirect telemetry to an isolated directory
 * (used by the test suite so it never pollutes the production log).
 *
 * @spec AC-01..AC-15
 * @contract CONTRACT-CAPTURE-DEFER-GATE-01
 * @article Article XI — Capture Imperative (DRAFT)
 * @failureMode #8 — defer-and-forget
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Defer-phrase patterns (AD-05: inline arrays — AD-01: self-contained) ─────

/**
 * English defer-phrase regexes (AC-01, D2).
 * Tuning notes: TODO/FIXME excluded when followed by spec/handoff/memory/ADR ref.
 */
const EN_DEFER_PATTERNS = [
  { re: /\bwe(?:'ll|'ll| will) (?:do|handle|tackle|implement|build|add|fix)[\w\s,-]+ later\b/i, phrase: 'we will/ll do X later' },
  { re: /\bpost-?(?:phase|sprint|wave|step)\s+\w+/i, phrase: 'post-Phase/Sprint/Wave/Step X' },
  { re: /\bdeferred?\s+to\s+(?:next|later|future)\s+(?:session|turn|sprint|phase)\b/i, phrase: 'deferred to next/future ...' },
  { re: /\bout\s+of\s+scope\s+(?:for\s+(?:now|v\d+|this\s+\w+))?\b/i, phrase: 'out of scope' },
  { re: /\bfuture\s+work\b/i, phrase: 'future work' },
  // TODO/FIXME without a capture-target-looking reference
  {
    re: /\bTODO\b(?!\s*:?\s*(?:~\/\.claude\/plans\/handoff-[\w-]+\.md|specs?\/[0-9]{3}-[\w-]+\/spec\.md|\.soma\/decisions\/ADR-[0-9]{4}|\.soma\/CONTEXT\.md|~\/\.claude\/projects\/[\w-]+\/memory\/[\w-]+\.md|handoff\s+bucket\s+[A-Z]|memory\s+entry\s+\w+))/,
    phrase: 'TODO without ticket reference'
  },
  {
    re: /\bFIXME\b(?!\s*:?\s*(?:~\/\.claude\/plans\/handoff-[\w-]+\.md|specs?\/[0-9]{3}-[\w-]+\/spec\.md|\.soma\/decisions\/ADR-[0-9]{4}|\.soma\/CONTEXT\.md|~\/\.claude\/projects\/[\w-]+\/memory\/[\w-]+\.md|handoff\s+bucket\s+[A-Z]|memory\s+entry\s+\w+))/,
    phrase: 'FIXME without ticket reference'
  },
  // "will defer X", "we defer this"
  { re: /\bwe\s+(?:will\s+)?defer\s+(?:this|it|that|[\w\s-]+)\b/i, phrase: 'we defer X' },
  // "left for later", "handle later", "do later"
  { re: /\b(?:left|handle|do|implement|tackle|add|fix|build|address)\s+(?:this\s+)?later\b/i, phrase: 'X later' },
  // "next sprint/phase/session we'll..."
  { re: /\bnext\s+(?:sprint|phase|session|wave)\s+(?:we|to)\b/i, phrase: 'next sprint/phase/session' },
];

/**
 * Portuguese (pt-br) defer-phrase regexes (AC-02, D2).
 */
const PTBR_DEFER_PATTERNS = [
  // "vamos fazer X depois" — use .+ to handle Unicode chars like ã, ç, é
  { re: /\bvamos?\s+(?:fazer|implementar|adicionar|resolver|tratar|corrigir).+\s+depois\b/i, phrase: 'vamos fazer X depois' },
  { re: /\bfica\s+pra\s+(?:pr[oó]xima|outra)\s+sess[aã]o\b/i, phrase: 'fica pra próxima sessão' },
  { re: /\bdeferid[oa]\b/i, phrase: 'deferido/a' },
  { re: /\bfora\s+de\s+escopo\b/i, phrase: 'fora de escopo' },
  // "pra próxima sprint/phase/wave/fase"
  { re: /\bpra\s+(?:pr[oó]xima\s+)?(?:phase|fase|sprint|wave)\s+\S+/i, phrase: 'pra Phase/sprint/wave X' },
  // "deixa pra depois", "fica pra depois"
  { re: /\b(?:deixa|fica)\s+pra\s+depois\b/i, phrase: 'deixa/fica pra depois' },
  // "próxima sessão" alone
  { re: /\bpr[oó]xima\s+sess[aã]o\b/i, phrase: 'próxima sessão' },
  // "tratar depois", "resolver depois"
  { re: /\b(?:tratar|resolver|implementar|fazer|adicionar|corrigir)\s+depois\b/i, phrase: 'X depois' },
];

// ── Capture target patterns (AC-04, AD-06: regex only — no fs.existsSync) ────

const CAPTURE_TARGET_PATTERNS = [
  // Handoff files
  { re: /~\/.claude\/plans\/handoff-[\w-]+\.md/, type: 'handoff-file' },
  // Memory files in projects
  { re: /~\/.claude\/projects\/[\w-]+\/memory\/[\w-]+\.md/, type: 'memory-file' },
  // Specs path
  { re: /specs\/[0-9]{3}-[\w-]+\/spec\.md/, type: 'spec-file' },
  // ADR
  { re: /\.soma\/decisions\/ADR-[0-9]{4}[-_][\w-]+\.md/i, type: 'adr-file' },
  // CONTEXT.md
  { re: /\.soma\/CONTEXT\.md/, type: 'context-md' },
  // Handoff bucket reference (textual)
  { re: /handoff\s+bucket\s+[A-Z](?:\.[a-z])?/i, type: 'handoff-bucket' },
  // Memory entry reference (textual)
  { re: /memory\s+entry\s+[\w_]+/i, type: 'memory-entry' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract text content from a JSONL transcript line (assistant entry).
 * Returns null for non-assistant entries or entries without text content.
 */
function extractAssistantText(line) {
  try {
    const entry = JSON.parse(line.trim());
    if (entry.type !== 'assistant') return null;
    const msg = entry.message;
    if (!msg || !msg.content) return null;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join(' ');
    }
  } catch (_) {}
  return null;
}

/**
 * Read last N assistant turn texts from transcript JSONL (AD-02 — mirror auto-load-modules pattern).
 * Returns array of text strings, most-recent-last.
 * @param {string} transcriptPath
 * @param {number} n - number of turns to read (default 2: current + previous)
 * @returns {Array<{text: string, index: number}>}
 */
function readLastAssistantTurns(transcriptPath, n = 2) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const turns = [];
    for (const line of lines) {
      const text = extractAssistantText(line);
      if (text !== null) turns.push(text);
    }
    // Return last N turns
    return turns.slice(-n).map((text, i) => ({ text, index: i }));
  } catch (err) {
    process.stderr.write(`[capture-defer-gate] WARN: could not read transcript: ${err.message}\n`);
    return [];
  }
}

/**
 * Scan text for defer-phrase matches.
 * Returns first match found or null.
 */
function detectDeferPhrase(text) {
  for (const { re, phrase } of EN_DEFER_PATTERNS) {
    const m = text.match(re);
    if (m) return { phrase, matched: m[0], locale: 'en' };
  }
  for (const { re, phrase } of PTBR_DEFER_PATTERNS) {
    const m = text.match(re);
    if (m) return { phrase, matched: m[0], locale: 'pt-br' };
  }
  return null;
}

/**
 * Scan text for capture target reference.
 * Returns first target found or null.
 */
function detectCaptureTarget(text) {
  for (const { re, type } of CAPTURE_TARGET_PATTERNS) {
    const m = text.match(re);
    if (m) return { target: m[0], type };
  }
  return null;
}

/**
 * Resolve the telemetry logs directory. Production default is
 * ~/.claude/logs. Tests set ARTICLE_XI_LOG_DIR to an isolated tmp dir so
 * the test suite never pollutes the real telemetry log (production behavior
 * is unchanged when the var is unset).
 */
function getLogsDir(env) {
  const override = ((env && env.ARTICLE_XI_LOG_DIR) || '').trim();
  if (override) return override;
  return path.join(os.homedir(), '.claude', 'logs');
}

/**
 * Append telemetry entry to JSONL log (AD-03 — daily-rotation, AD-03 append-only).
 */
function appendTelemetry(entry, env) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logsDir = getLogsDir(env || process.env);
    const logPath = path.join(logsDir, `article-xi-${today}.jsonl`);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    process.stderr.write(`[capture-defer-gate] WARN: could not write telemetry: ${err.message}\n`);
  }
}

/**
 * Check if marker file bypass is active for this session (AC-07, AD-04).
 */
function isMarkerBypassActive(sessionId) {
  try {
    return fs.existsSync(`/tmp/article-xi-bypass-${sessionId}`);
  } catch (_) {
    return false;
  }
}

/**
 * Determine if hard-block mode is active (AC-06/AC-13, AD-04).
 * env ARTICLE_XI_HARD=1 → hard; =0 or unset → soft.
 */
function isHardMode(env) {
  return (env.ARTICLE_XI_HARD || '').trim() === '1';
}

// ── Main hook logic ───────────────────────────────────────────────────────────

async function main() {
  // AD-07: read stdin sync (simpler error handling)
  let stdinData;
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (_) {
    // Can't read stdin — fail open
    process.exit(0);
  }

  // Parse stdin JSON (fail open on malformed)
  let input;
  try {
    input = JSON.parse(stdinData);
  } catch (err) {
    process.stderr.write(`[capture-defer-gate] WARN: malformed stdin JSON: ${err.message}\n`);
    process.exit(0);
  }

  const sessionId = input.session_id || 'unknown';
  const transcriptPath = input.transcript_path || '';
  const env = process.env;

  // Check overrides (AD-04) — early exits take priority
  // Override 1: env var ARTICLE_XI_DISABLED=1 (AC-08)
  if ((env.ARTICLE_XI_DISABLED || '').trim() === '1') {
    process.exit(0);
  }

  // Override 2: marker file (AC-07)
  if (isMarkerBypassActive(sessionId)) {
    process.exit(0);
  }

  // Read transcript (AD-02 — last 2 assistant turns: current + previous)
  const turns = readLastAssistantTurns(transcriptPath, 2);

  // Current turn = last entry; previous turn = second-to-last
  const currentText = turns.length > 0 ? turns[turns.length - 1].text : '';
  const previousText = turns.length > 1 ? turns[turns.length - 2].text : '';

  // Step 1: Scan current turn for defer-phrase
  const deferMatch = detectDeferPhrase(currentText);

  // No defer detected → exit 0 cleanly (AC-03)
  if (!deferMatch) {
    process.exit(0);
  }

  // Step 2: Check for capture target — current turn first, then previous turn (AC-11, D1)
  let captureMatch = detectCaptureTarget(currentText);
  let searchScope = 'current';

  if (!captureMatch && previousText) {
    captureMatch = detectCaptureTarget(previousText);
    if (captureMatch) searchScope = 'previous-turn';
  }

  const hardMode = isHardMode(env);
  const captured = captureMatch !== null;
  const blocked = hardMode && !captured;

  // Step 3: Append telemetry (AC-09, AC-10)
  appendTelemetry({
    schema: 'article-xi-telemetry/v1',
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    phrase_matched: deferMatch.matched,
    phrase_locale: deferMatch.locale,
    status: captured ? 'captured' : 'uncaptured',
    capture_target: captureMatch ? captureMatch.target : null,
    search_scope: captureMatch ? searchScope : 'current',
    hard_mode: hardMode,
    blocked
  }, env);

  // Step 4: Emit decision
  if (captured) {
    // Defer + captured → allow silently (exit 0, no output) (AC-04)
    process.exit(0);
  }

  if (hardMode) {
    // Hard-block: stdout JSON + exit 2 (AC-06, AC-13)
    const blockMsg = `Article XI: defer-phrase '${deferMatch.matched}' detected without capture target. Add capture to ~/.claude/plans/handoff-*, specs/{NNN}/spec.md, .soma/decisions/ADR-*, or .soma/CONTEXT.md. Override: touch /tmp/article-xi-bypass-${sessionId}`;
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: blockMsg
    }) + '\n');
    process.exit(2);
  } else {
    // Soft-warn: stderr warning + exit 0 (AC-05, AC-12)
    process.stderr.write(
      `[Article XI WARN] defer-phrase detected without capture target: '${deferMatch.matched}'\n` +
      `  Locale: ${deferMatch.locale}\n` +
      `  Fix: reference ~/.claude/plans/handoff-*, specs/{NNN}/spec.md, .soma/decisions/ADR-*, or .soma/CONTEXT.md in same or previous turn.\n` +
      `  Override: touch /tmp/article-xi-bypass-${sessionId}\n`
    );
    process.exit(0);
  }
}

main().catch(err => {
  process.stderr.write(`[capture-defer-gate] ERROR: unexpected: ${err.message}\n`);
  process.exit(0); // Fail open — never block legitimate turn due to hook crash
});
