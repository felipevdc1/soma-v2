'use strict';
/**
 * BF-04 Reproducer Test — cbm deprecation + codex source restoration
 *
 * @phase RED → GREEN (Wave A foundation)
 * @spec AC-01 + AC-04 + AC-06
 * @issue #9
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLAUDE_INSTALL_TARGETS = path.join(REPO_ROOT, 'core/adapters/claude/install-targets.json');
const CODEX_INSTALL_TARGETS = path.join(REPO_ROOT, 'core/adapters/codex/install-targets.json');
const MCP_SOURCE_DOC = path.join(REPO_ROOT, 'core/docs/codebase-memory-mcp.md');

test('AC-01: claude install-targets has no cbm entry', () => {
  const targets = JSON.parse(fs.readFileSync(CLAUDE_INSTALL_TARGETS, 'utf8'));
  const cbmEntry = targets.entries.find(e => e.block_id === 'block.claude.CLAUDE_md.cbm');
  assert.equal(cbmEntry, undefined, 'cbm legacy entry should be dropped');
  assert.equal(targets.entries.length, 3, 'claude install-targets should have 3 entries (was 4)');
});

test('AC-06: codex codebase-memory-mcp source_doc is correct', () => {
  const targets = JSON.parse(fs.readFileSync(CODEX_INSTALL_TARGETS, 'utf8'));
  const cmmcEntries = targets.entries.filter(e => e.block_id === 'block.codex.AGENTS.codebase-memory-mcp');
  assert.equal(cmmcEntries.length, 2, 'codex should have 2 codebase-memory-mcp entries (×2 target_paths)');
  cmmcEntries.forEach(e => {
    assert.equal(e.source_doc, 'docs/codebase-memory-mcp.md',
      `source_doc must be docs/codebase-memory-mcp.md, NOT ${e.source_doc}`);
  });
});

test('AC-04: source docs/codebase-memory-mcp.md exists with valid content', () => {
  assert.ok(fs.existsSync(MCP_SOURCE_DOC), `${MCP_SOURCE_DOC} must exist`);
  const content = fs.readFileSync(MCP_SOURCE_DOC, 'utf8');
  assert.match(content, /# Codebase Knowledge Graph/, 'must have canonical header');
  assert.match(content, /codebase-memory-mcp/, 'must reference the MCP tool name');
  assert.match(content, /search_graph/, 'must document search_graph priority');
  assert.match(content, /trace_call_path/, 'must document trace_call_path');
});
