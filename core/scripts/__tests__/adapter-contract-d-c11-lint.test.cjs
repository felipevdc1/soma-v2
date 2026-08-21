'use strict';
/**
 * D-C11 lint: adapter-contract.md anchor declarations must match install-targets.json
 *
 * Catches drift between docs and config files when adapters are updated.
 *
 * @spec core/specs/013-cbm-deprecation/spec.md
 * @refs #9
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isFileEntry } = require('../install/files.cjs');

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Parse the D-C11 decision line from adapter-contract.md.
 * Returns the full line for manual inspection.
 */
function getDC11Line(contract) {
  const lines = contract.split('\n');
  return lines.find(l => /Decision \(D-C11/.test(l)) || null;
}

test('D-C11 lint: claude triplet in adapter-contract.md matches install-targets.json', () => {
  const contract = fs.readFileSync(path.join(REPO_ROOT, 'core/docs/adapter-contract.md'), 'utf8');
  const targets = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'core/adapters/claude/install-targets.json'), 'utf8'));

  // Extract unique anchor section suffixes declared in install-targets.json.
  // Filter to block entries first (Spec 018 added kind:"file" entries to
  // this same array — those have no block_id and must not reach .map()).
  const blockEntries = targets.entries.filter((e) => !isFileEntry(e));
  assert.ok(blockEntries.length > 0, 'precondição: precisa haver ao menos 1 entry de bloco pra este teste fazer sentido');
  const declaredAnchors = [...new Set(
    blockEntries.map(e => e.block_id.replace(/^block\.claude\.CLAUDE_md\./, ''))
  )];

  const dc11Line = getDC11Line(contract);
  assert.ok(dc11Line, 'D-C11 decision must exist in adapter-contract.md');

  // The D-C11 line declares claude anchors in the form {hyd-v2,soma-stsd,soma-voxel}
  declaredAnchors.forEach(anchor => {
    assert.ok(
      dc11Line.includes(anchor),
      `D-C11 must mention '${anchor}' (declared in claude/install-targets.json). D-C11 line: ${dc11Line}`
    );
  });
});

test('D-C11 lint: codex triplet in adapter-contract.md matches install-targets.json', () => {
  const contract = fs.readFileSync(path.join(REPO_ROOT, 'core/docs/adapter-contract.md'), 'utf8');
  const targets = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'core/adapters/codex/install-targets.json'), 'utf8'));

  // Extract unique anchor section suffixes declared in install-targets.json.
  // Filter to block entries first — same reasoning as the claude test above;
  // codex has no kind:"file" entries today, but this must not silently rely
  // on that staying true.
  const blockEntries = targets.entries.filter((e) => !isFileEntry(e));
  assert.ok(blockEntries.length > 0, 'precondição: precisa haver ao menos 1 entry de bloco pra este teste fazer sentido');
  const declaredAnchors = [...new Set(
    blockEntries.map(e => e.block_id.replace(/^block\.codex\.AGENTS\./, ''))
  )];

  const dc11Line = getDC11Line(contract);
  assert.ok(dc11Line, 'D-C11 decision must exist in adapter-contract.md');

  declaredAnchors.forEach(anchor => {
    assert.ok(
      dc11Line.includes(anchor),
      `D-C11 must mention '${anchor}' (declared in codex/install-targets.json). D-C11 line: ${dc11Line}`
    );
  });
});
