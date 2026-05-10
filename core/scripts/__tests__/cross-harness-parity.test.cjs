'use strict';
/**
 * cross-harness-parity.test.cjs — T-05 contract tests for skill-cross-harness.md
 *
 * Article II HARD: RED phase — contract tests written BEFORE T-27 (Claude skill) and
 * T-28 (Codex anchored block) create the source files.
 *
 * Contract covered: [CONTRACT:04] core/specs/015-soma-install/contracts/skill-cross-harness.md
 *
 * Test map:
 *   CP-01: Claude skill source exists (core/adapters/claude/commands/soma-install.md)
 *          → FAIL (RED — pending T-27)
 *   CP-02: Codex anchored block exists in AGENTS.md
 *          (id=block.codex.AGENTS.soma-install)
 *          → FAIL (RED — pending T-28)
 *   CP-03: Args schema parity — 7 args present in both Claude frontmatter and
 *          Codex Args table (project_path, tool, dry_run, merge_claude_md,
 *          replace_claude_md, force_resync, allow_local_edits)
 *          → FAIL (RED — pending T-27 + T-28)
 *   CP-04: Triggers list parity — set equality after normalization (8 phrasings)
 *          → FAIL (RED — pending T-27 + T-28)
 *   CP-05: Backbone CLI literal parity — both files contain
 *          `node ~/.soma-v2/scripts/soma.cjs install`
 *          → FAIL (RED — pending T-27 + T-28)
 *   CP-06: Codex anchored block format (soma-v2:start / soma-v2:end pattern)
 *          → FAIL (RED — pending T-28)
 *
 * @spec [CONTRACT:04] [SPEC:AC-10] [SPEC:AC-11] [SPEC:AC-15]
 * @task T-05
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// ── Paths ─────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLAUDE_SKILL_PATH = path.join(REPO_ROOT, 'core', 'adapters', 'claude', 'commands', 'soma-install.md');
const CODEX_AGENTS_PATH = path.join(REPO_ROOT, 'core', 'adapters', 'codex', 'AGENTS.md');

// ── Expected contract values (from skill-cross-harness.md) ───────────────────

/** 7 args required by CONTRACT:04 §Parity Contract (AC-15) */
const EXPECTED_ARGS = [
  'project_path',
  'tool',
  'dry_run',
  'merge_claude_md',
  'replace_claude_md',
  'force_resync',
  'allow_local_edits',
];

/** 8 trigger phrasings required by CONTRACT:04 §Parity Contract (AC-15) */
const EXPECTED_TRIGGERS = [
  'instalar o soma neste projeto',
  'instalar soma aqui',
  'configurar soma neste repo',
  'set up soma in this repo',
  'install soma here',
  'soma install',
  '/soma:install',
  'add soma to this project',
];

/** Backbone CLI literal required by CONTRACT:04 */
const BACKBONE_CLI_LITERAL = 'node ~/.soma-v2/scripts/soma.cjs install';

/** Anchored block id for Codex soma-install block */
const CODEX_BLOCK_ID = 'block.codex.AGENTS.soma-install';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Reads the block between opening '---' and closing '---'.
 * Returns the raw frontmatter string and a structured object.
 *
 * Strategy: manual line-by-line parse. No js-yaml dependency (zero new deps rule).
 * Handles only the subset of YAML used in Claude skill files:
 *   - string scalars (key: value)
 *   - list items (- "item" or - item)
 *   - nested objects (key:\n  subkey: value)
 *
 * @param {string} content - full markdown file content
 * @returns {{ raw: string, parsed: Record<string, unknown> } | null}
 */
function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return null;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  const fmLines = lines.slice(1, end);
  const raw = fmLines.join('\n');

  /** Parse a list of '- "item"' or '- item' lines. */
  function parseList(startIdx, fmLinesLocal) {
    const items = [];
    for (let i = startIdx; i < fmLinesLocal.length; i++) {
      const line = fmLinesLocal[i];
      const listMatch = line.match(/^  - (.+)$/);
      if (!listMatch) break;
      // Strip surrounding quotes
      const val = listMatch[1].replace(/^["']|["']$/g, '').trim();
      items.push(val);
    }
    return items;
  }

  /** Parse nested object key-value pairs at 2-space indent. */
  function parseObject(startIdx, fmLinesLocal) {
    const obj = {};
    for (let i = startIdx; i < fmLinesLocal.length; i++) {
      const line = fmLinesLocal[i];
      // Nested key (4-space indent or 2-space for top-level object keys)
      const nestedMatch = line.match(/^  (\w+): *(.*)$/);
      if (!nestedMatch) break;
      const key = nestedMatch[1];
      const val = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
      obj[key] = val;
    }
    return obj;
  }

  const result = {};
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    // Skip blank lines
    if (!line.trim()) continue;
    // Top-level key: value
    const kvMatch = line.match(/^(\w[\w-]*): *(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rest = kvMatch[2].trim();

    if (rest === '' || rest === '|' || rest === '>') {
      // Could be a list or nested object — peek ahead
      if (i + 1 < fmLines.length) {
        const nextLine = fmLines[i + 1];
        if (nextLine.match(/^  - /)) {
          result[key] = parseList(i + 1, fmLines);
        } else if (nextLine.match(/^  \w/)) {
          result[key] = parseObject(i + 1, fmLines);
        } else {
          result[key] = rest;
        }
      } else {
        result[key] = rest;
      }
    } else {
      // Strip surrounding quotes
      result[key] = rest.replace(/^["']|["']$/g, '');
    }
  }

  return { raw, parsed: result };
}

/**
 * Extract a named anchored block from file content.
 * Pattern: <!-- soma-v2:start id={blockId} ... -->...<! -- soma-v2:end id={blockId} -->
 *
 * @param {string} content - full file content
 * @param {string} blockId - e.g. 'block.codex.AGENTS.soma-install'
 * @returns {string | null} block inner content (between start and end tags), or null
 */
function extractAnchoredBlock(content, blockId) {
  const startRe = new RegExp(
    `<!--\\s*soma-v2:start\\s+id=${escapeRegex(blockId)}[^>]*-->`,
    's'
  );
  const endRe = new RegExp(
    `<!--\\s*soma-v2:end\\s+id=${escapeRegex(blockId)}\\s*-->`,
    's'
  );

  const startMatch = content.match(startRe);
  if (!startMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const remaining = content.slice(startIdx);

  const endMatch = remaining.match(endRe);
  if (!endMatch) return null;

  return remaining.slice(0, endMatch.index);
}

/**
 * Escape special regex characters in a string.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse args from a Codex-style markdown table.
 * Extracts the first column (Flag) from the table and normalizes to snake_case arg names.
 *
 * Flag column format examples:
 *   `<project-path>` → project_path
 *   `--tool`         → tool
 *   `--dry-run`      → dry_run
 *   `--merge-claude-md` → merge_claude_md
 *
 * @param {string} content - markdown text containing an args table
 * @returns {string[]} normalized arg names
 */
function parseCodexArgsTable(content) {
  const args = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match table rows (| cell | cell | ...)
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('|---') || trimmed.startsWith('| Flag')) continue;

    // Extract first cell
    const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    const raw = cells[0];
    // Strip backticks
    const stripped = raw.replace(/`/g, '').trim();

    let normalized;
    if (stripped.startsWith('<') && stripped.endsWith('>')) {
      // <project-path> → project_path
      normalized = stripped.slice(1, -1).replace(/-/g, '_');
    } else if (stripped.startsWith('--')) {
      // --dry-run → dry_run
      normalized = stripped.slice(2).replace(/-/g, '_');
    } else {
      normalized = stripped.replace(/-/g, '_');
    }

    if (normalized) args.push(normalized);
  }

  return args;
}

/**
 * Parse trigger phrasings from a Codex-style markdown list section.
 * Finds the "## Triggers" section and reads list items.
 *
 * @param {string} content - markdown text (anchored block content)
 * @returns {string[]} normalized (lowercased, trimmed) trigger phrasings
 */
function parseCodexTriggers(content) {
  const lines = content.split('\n');
  const triggers = [];

  let inTriggersSection = false;
  for (const line of lines) {
    if (line.trim().match(/^##\s+Triggers/i)) {
      inTriggersSection = true;
      continue;
    }
    if (inTriggersSection) {
      // Stop at next heading
      if (line.trim().startsWith('#')) break;
      const listMatch = line.trim().match(/^-\s+"?(.+?)"?\s*$/);
      if (listMatch) {
        triggers.push(listMatch[1].trim().toLowerCase());
      }
    }
  }

  return triggers;
}

/**
 * Parse triggers from Claude frontmatter `triggers:` array.
 * Returns lowercased, trimmed values.
 *
 * @param {string[]} raw - raw trigger strings from parsed frontmatter
 * @returns {string[]}
 */
function normalizeClaudeTriggers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(t => String(t).trim().toLowerCase());
}

// ── CP-01: Claude skill source file exists ────────────────────────────────────
// RED — FAILS until T-27 creates core/adapters/claude/commands/soma-install.md

test('CP-01 [T-05]: Claude skill source core/adapters/claude/commands/soma-install.md exists', () => {
  assert.ok(
    fs.existsSync(CLAUDE_SKILL_PATH),
    `[RED — T-27] Claude skill source not found at: ${CLAUDE_SKILL_PATH}\n` +
    `This file will be created in T-27. Test expected to FAIL until T-27 completes.`
  );
});

// ── CP-02: Codex anchored block exists in AGENTS.md ───────────────────────────
// RED — FAILS until T-28 adds block to core/adapters/codex/AGENTS.md

test(`CP-02 [T-05]: Codex AGENTS.md contains anchored block id=${CODEX_BLOCK_ID}`, () => {
  assert.ok(
    fs.existsSync(CODEX_AGENTS_PATH),
    `Codex AGENTS.md not found at: ${CODEX_AGENTS_PATH}\n` +
    `This file should already exist — unexpected state.`
  );

  const content = fs.readFileSync(CODEX_AGENTS_PATH, 'utf8');
  const block = extractAnchoredBlock(content, CODEX_BLOCK_ID);

  assert.notEqual(
    block,
    null,
    `[RED — T-28] Codex AGENTS.md does not contain anchored block id=${CODEX_BLOCK_ID}.\n` +
    `Expected: <!-- soma-v2:start id=${CODEX_BLOCK_ID} version=... sha256=... -->\n` +
    `This block will be added in T-28. Test expected to FAIL until T-28 completes.`
  );
});

// ── CP-03: Args schema parity (7 args present in both) ────────────────────────
// RED — FAILS until T-27 + T-28 both complete

test('CP-03 [T-05]: Args schema parity — 7 args present in both Claude frontmatter and Codex Args table', () => {
  // ── Step 1: Read + parse Claude skill frontmatter ────────────────────────────
  assert.ok(
    fs.existsSync(CLAUDE_SKILL_PATH),
    `[RED — T-27] Claude skill not found at ${CLAUDE_SKILL_PATH}. Cannot verify args parity.`
  );

  const claudeContent = fs.readFileSync(CLAUDE_SKILL_PATH, 'utf8');
  const fm = parseFrontmatter(claudeContent);
  assert.notEqual(fm, null,
    `[RED — T-27] Could not parse frontmatter from ${CLAUDE_SKILL_PATH}. File may be missing YAML block.`
  );

  const argsSchema = fm.parsed['args_schema'];
  assert.ok(
    argsSchema && typeof argsSchema === 'object',
    `[RED — T-27] frontmatter must contain args_schema object. Got: ${JSON.stringify(argsSchema)}`
  );

  const claudeArgs = Object.keys(argsSchema);

  // ── Step 2: Read + extract Codex anchored block + parse args table ────────────
  assert.ok(
    fs.existsSync(CODEX_AGENTS_PATH),
    `Codex AGENTS.md not found at ${CODEX_AGENTS_PATH}`
  );

  const codexContent = fs.readFileSync(CODEX_AGENTS_PATH, 'utf8');
  const blockContent = extractAnchoredBlock(codexContent, CODEX_BLOCK_ID);
  assert.notEqual(
    blockContent,
    null,
    `[RED — T-28] Codex anchored block ${CODEX_BLOCK_ID} not found in AGENTS.md. Cannot verify args parity.`
  );

  const codexArgs = parseCodexArgsTable(blockContent);

  // ── Step 3: Assert 7 args present in BOTH ────────────────────────────────────
  for (const expectedArg of EXPECTED_ARGS) {
    assert.ok(
      claudeArgs.includes(expectedArg),
      `[RED — T-27] Expected arg "${expectedArg}" missing from Claude skill args_schema.\n` +
      `Claude args found: ${claudeArgs.join(', ')}`
    );

    assert.ok(
      codexArgs.includes(expectedArg),
      `[RED — T-28] Expected arg "${expectedArg}" missing from Codex Args table.\n` +
      `Codex args found: ${codexArgs.join(', ')}`
    );
  }

  // ── Step 4: No unexpected args in Claude (schema must have exactly 7) ─────────
  assert.equal(
    claudeArgs.length,
    EXPECTED_ARGS.length,
    `[RED — T-27] Claude args_schema must have exactly ${EXPECTED_ARGS.length} args.\n` +
    `Found ${claudeArgs.length}: ${claudeArgs.join(', ')}`
  );
});

// ── CP-04: Triggers list parity ───────────────────────────────────────────────
// RED — FAILS until T-27 + T-28 both complete

test('CP-04 [T-05]: Triggers list parity — set equality between Claude triggers: and Codex ## Triggers list', () => {
  // ── Read Claude skill frontmatter ─────────────────────────────────────────────
  assert.ok(
    fs.existsSync(CLAUDE_SKILL_PATH),
    `[RED — T-27] Claude skill not found at ${CLAUDE_SKILL_PATH}`
  );

  const claudeContent = fs.readFileSync(CLAUDE_SKILL_PATH, 'utf8');
  const fm = parseFrontmatter(claudeContent);
  assert.notEqual(fm, null,
    `[RED — T-27] Could not parse frontmatter from ${CLAUDE_SKILL_PATH}`
  );

  const claudeTriggersRaw = fm.parsed['triggers'];
  assert.ok(
    Array.isArray(claudeTriggersRaw),
    `[RED — T-27] Claude frontmatter must have triggers: list. Got: ${JSON.stringify(claudeTriggersRaw)}`
  );

  const claudeTriggers = new Set(normalizeClaudeTriggers(claudeTriggersRaw));

  // ── Read Codex anchored block ─────────────────────────────────────────────────
  assert.ok(
    fs.existsSync(CODEX_AGENTS_PATH),
    `Codex AGENTS.md not found at ${CODEX_AGENTS_PATH}`
  );

  const codexContent = fs.readFileSync(CODEX_AGENTS_PATH, 'utf8');
  const blockContent = extractAnchoredBlock(codexContent, CODEX_BLOCK_ID);
  assert.notEqual(
    blockContent,
    null,
    `[RED — T-28] Codex anchored block ${CODEX_BLOCK_ID} not found. Cannot verify triggers parity.`
  );

  const codexTriggers = new Set(parseCodexTriggers(blockContent));

  // ── Set equality check ────────────────────────────────────────────────────────
  const expectedSet = new Set(EXPECTED_TRIGGERS);

  // Claude must contain all expected triggers
  for (const t of expectedSet) {
    assert.ok(
      claudeTriggers.has(t),
      `[RED — T-27] Expected trigger "${t}" missing from Claude skill triggers: list.\n` +
      `Claude triggers: ${[...claudeTriggers].join(', ')}`
    );
  }

  // Codex must contain all expected triggers (note: /soma:install may be Claude-only — contract allows it)
  // CONTRACT:04 states Codex list does NOT include /soma:install (Claude slash-command syntax)
  const expectedCodexTriggers = new Set(EXPECTED_TRIGGERS.filter(t => t !== '/soma:install'));
  for (const t of expectedCodexTriggers) {
    assert.ok(
      codexTriggers.has(t),
      `[RED — T-28] Expected trigger "${t}" missing from Codex ## Triggers list.\n` +
      `Codex triggers: ${[...codexTriggers].join(', ')}`
    );
  }

  // Claude and Codex must agree on all shared triggers
  const claudeWithoutSlash = new Set([...claudeTriggers].filter(t => t !== '/soma:install'));
  for (const t of claudeWithoutSlash) {
    assert.ok(
      codexTriggers.has(t),
      `[RED — T-27/T-28] Trigger "${t}" present in Claude but missing from Codex.\n` +
      `Codex triggers: ${[...codexTriggers].join(', ')}`
    );
  }
});

// ── CP-05: Backbone CLI literal parity ───────────────────────────────────────
// RED — FAILS until T-27 + T-28 both complete

test(`CP-05 [T-05]: Both files contain backbone CLI literal "${BACKBONE_CLI_LITERAL}"`, () => {
  // ── Check Claude skill ────────────────────────────────────────────────────────
  assert.ok(
    fs.existsSync(CLAUDE_SKILL_PATH),
    `[RED — T-27] Claude skill not found at ${CLAUDE_SKILL_PATH}`
  );

  const claudeContent = fs.readFileSync(CLAUDE_SKILL_PATH, 'utf8');
  assert.ok(
    claudeContent.includes(BACKBONE_CLI_LITERAL),
    `[RED — T-27] Claude skill must contain literal:\n  "${BACKBONE_CLI_LITERAL}"\n` +
    `CONTRACT:04 §Backbone CLI: "Both MUST emit literal ${BACKBONE_CLI_LITERAL} as the entry call"\n` +
    `No alternative invocation paths permitted.`
  );

  // ── Check Codex anchored block ────────────────────────────────────────────────
  assert.ok(
    fs.existsSync(CODEX_AGENTS_PATH),
    `Codex AGENTS.md not found at ${CODEX_AGENTS_PATH}`
  );

  const codexContent = fs.readFileSync(CODEX_AGENTS_PATH, 'utf8');
  const blockContent = extractAnchoredBlock(codexContent, CODEX_BLOCK_ID);
  assert.notEqual(
    blockContent,
    null,
    `[RED — T-28] Codex anchored block ${CODEX_BLOCK_ID} not found. Cannot verify CLI literal parity.`
  );

  assert.ok(
    blockContent.includes(BACKBONE_CLI_LITERAL),
    `[RED — T-28] Codex anchored block must contain literal:\n  "${BACKBONE_CLI_LITERAL}"\n` +
    `CONTRACT:04 §Backbone CLI: zero divergence from backbone CLI entry call is required.\n` +
    `Block content (first 400 chars): ${blockContent.slice(0, 400)}`
  );
});

// ── CP-06: Anchored block format validation ───────────────────────────────────
// GREEN — AGENTS.md exists and already uses the anchored block format.
// This test validates the FORMAT of the existing blocks and will validate
// the soma-install block once T-28 adds it.

test(`CP-06 [T-05]: Codex anchored block for soma-install follows soma-v2:start/end format`, () => {
  assert.ok(
    fs.existsSync(CODEX_AGENTS_PATH),
    `Codex AGENTS.md not found at ${CODEX_AGENTS_PATH}`
  );

  const content = fs.readFileSync(CODEX_AGENTS_PATH, 'utf8');

  // Validate the format of the soma-install block specifically.
  // Pattern: <!-- soma-v2:start id=block.codex.AGENTS.soma-install version=... sha256=... -->
  const startTagRe = new RegExp(
    `<!--\\s*soma-v2:start\\s+id=${escapeRegex(CODEX_BLOCK_ID)}\\s+version=[\\d.]+-?[\\w.]*\\s+sha256=[a-f0-9]{64}\\s*-->`
  );
  const endTagRe = new RegExp(
    `<!--\\s*soma-v2:end\\s+id=${escapeRegex(CODEX_BLOCK_ID)}\\s*-->`
  );

  assert.ok(
    startTagRe.test(content),
    `[RED — T-28] Codex AGENTS.md must contain soma-v2:start tag for ${CODEX_BLOCK_ID}.\n` +
    `Expected pattern: <!-- soma-v2:start id=${CODEX_BLOCK_ID} version=N.N.N sha256=<64-hex-chars> -->\n` +
    `This block will be added in T-28. Test expected to FAIL until T-28 completes.`
  );

  assert.ok(
    endTagRe.test(content),
    `[RED — T-28] Codex AGENTS.md must contain soma-v2:end tag for ${CODEX_BLOCK_ID}.\n` +
    `Expected pattern: <!-- soma-v2:end id=${CODEX_BLOCK_ID} -->\n` +
    `This block will be added in T-28. Test expected to FAIL until T-28 completes.`
  );

  // If both tags exist, validate that start comes before end (ordering invariant)
  if (startTagRe.test(content) && endTagRe.test(content)) {
    const startMatch = content.match(startTagRe);
    const endMatch = content.match(endTagRe);
    assert.ok(
      startMatch.index < endMatch.index,
      `[RED — T-28] soma-v2:start for ${CODEX_BLOCK_ID} must appear BEFORE soma-v2:end in AGENTS.md`
    );
  }
});
