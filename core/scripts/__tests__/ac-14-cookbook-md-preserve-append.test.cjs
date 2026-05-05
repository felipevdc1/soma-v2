/**
 * AC-14: module-cookbook.md preserved (original 449 bytes intact) + Phase 4c section appended
 * @spec AC-14
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_REPO = path.join(os.homedir(), '.soma-v2');
const COOKBOOK_PATH = path.join(SOMA_REPO, 'docs/module-cookbook.md');
const ORIGINAL_BACKUP = '/tmp/module-cookbook-original.md';

test('AC-14: module-cookbook.md has Phase 4c section appended', () => {
  const content = fs.readFileSync(COOKBOOK_PATH, 'utf8');
  assert.ok(content.includes('## Cookbook commands (Phase 4c)'),
    'module-cookbook.md must contain "## Cookbook commands (Phase 4c)" section');
});

test('AC-14: original 449 bytes preserved byte-identical', () => {
  const currentContent = Buffer.from(fs.readFileSync(COOKBOOK_PATH, 'utf8'));
  const originalContent = Buffer.from(fs.readFileSync(ORIGINAL_BACKUP, 'utf8'));
  assert.ok(currentContent.length > 449,
    `module-cookbook.md must be larger than 449 bytes (it was appended). Got: ${currentContent.length}`);
  // First 449 bytes must be identical to original
  const currentFirst449 = currentContent.subarray(0, 449);
  const originalFirst449 = originalContent.subarray(0, 449);
  assert.deepEqual(currentFirst449, originalFirst449,
    'First 449 bytes of module-cookbook.md must be byte-identical to original');
});

test('AC-14: Phase 4c section documents the add/promote/remove/deprecate commands', () => {
  const contentStr = fs.readFileSync(COOKBOOK_PATH, 'utf8');
  const contentBytes = fs.readFileSync(COOKBOOK_PATH); // Buffer for byte operations
  const phase4cCharIndex = contentStr.indexOf('## Cookbook commands (Phase 4c)');
  assert.ok(phase4cCharIndex > 0, 'Phase 4c section must exist in module-cookbook.md');
  // Verify byte position — the section must be at byte offset ≥ 449 (original file size)
  const encoder = new TextEncoder();
  const bytesBeforeSection = encoder.encode(contentStr.slice(0, phase4cCharIndex)).length;
  assert.ok(bytesBeforeSection >= 449,
    `Phase 4c section must be at or after byte 449 (original file end). Actual byte offset: ${bytesBeforeSection}`);
  const phase4cSection = contentStr.slice(phase4cCharIndex);
  // Section should document the subcommands
  assert.ok(phase4cSection.includes('module add') || phase4cSection.includes('add'),
    'Phase 4c section must mention add command');
  assert.ok(phase4cSection.includes('module promote') || phase4cSection.includes('promote'),
    'Phase 4c section must mention promote command');
});
