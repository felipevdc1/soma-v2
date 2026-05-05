'use strict';
// @spec AC-03 AC-04
// Integration tests for init.cjs --with-agents-md flag.
// AC-03: no pre-existing AGENTS.md → creates new file with anchored block.
// AC-04: pre-existing AGENTS.md → preserves all content + appends block.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');
const BLOCK_ID = 'project.AGENTS.bootloader';
const BLOCK_VERSION = '2.1.0-draft';

function mkFixture(prefix = 'soma-init-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runInit(args = []) {
  return spawnSync('node', [INIT, ...args], {
    encoding: 'utf8',
    timeout: 15000
  });
}

// ---- AC-03: --with-agents-md, no pre-existing AGENTS.md ----

test('with-agents-md: creates AGENTS.md when none pre-exists', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  assert.ok(!fs.existsSync(path.join(target, 'AGENTS.md')), 'Pre-condition: no AGENTS.md');

  runInit([target, '--with-agents-md']);

  assert.ok(fs.existsSync(path.join(target, 'AGENTS.md')), 'AGENTS.md must be created');
});

test('with-agents-md: JSON agents_md_managed=true, agents_md_action="create"', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--with-agents-md', '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.summary.agents_md_managed, true);
  assert.equal(parsed.summary.agents_md_action, 'create');
  // 5 .soma/ files (4 template + manifest.json) + AGENTS.md = 6 total
  assert.equal(parsed.files_created.length, 6, 'Must create 6 files total with --with-agents-md');
});

test('with-agents-md: AGENTS.md contains soma-v2:start marker with correct id', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(
    content.includes(`id=${BLOCK_ID}`),
    `AGENTS.md must contain id=${BLOCK_ID} in start marker`
  );
});

test('with-agents-md: AGENTS.md contains soma-v2:end marker', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(
    content.includes(`<!-- soma-v2:end id=${BLOCK_ID} -->`),
    `AGENTS.md must contain soma-v2:end marker`
  );
});

test('with-agents-md: AGENTS.md sha256 attribute is real hex (not FILL_AT_INSTALL)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.ok(!content.includes('FILL_AT_INSTALL'), 'sha256 must not be FILL_AT_INSTALL literal');

  // Check that sha256=<64 hex chars> appears in start marker
  const sha256Match = content.match(/sha256=([a-f0-9]{64})/);
  assert.ok(sha256Match, 'sha256 attribute must be 64-char hex in start marker');
});

test('with-agents-md: sha256 attribute matches actual block content sha256', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');

  // Extract sha256 from start marker
  const sha256Match = content.match(/soma-v2:start[^>]+sha256=([a-f0-9]{64})/);
  assert.ok(sha256Match, 'Must find sha256 in start marker');
  const attrSha = sha256Match[1];

  // Extract block body (content between start and end markers)
  const startMarkerRegex = new RegExp(`<!--\\s*soma-v2:start[^>]+id=${BLOCK_ID.replace(/\./g, '\\.')}[^>]*-->`);
  const endMarkerStr = `<!-- soma-v2:end id=${BLOCK_ID} -->`;

  const startMatch = content.match(startMarkerRegex);
  assert.ok(startMatch, 'start marker must be found');

  const startIdx = content.indexOf(startMatch[0]) + startMatch[0].length;
  const endIdx = content.indexOf(endMarkerStr);

  // Block body is content between markers (strip leading newline)
  let blockBody = content.slice(startIdx, endIdx);
  if (blockBody.startsWith('\n')) blockBody = blockBody.slice(1);
  if (blockBody.endsWith('\n')) blockBody = blockBody.slice(0, -1);

  const computedSha = crypto.createHash('sha256').update(blockBody).digest('hex');
  assert.equal(attrSha, computedSha, `sha256 attribute must match actual block content sha256`);
});

test('with-agents-md: installed-state.json.agents_md_managed is true', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--with-agents-md']);

  const state = JSON.parse(fs.readFileSync(path.join(target, '.soma', 'installed-state.json'), 'utf8'));
  assert.equal(state.agents_md_managed, true);
});

test('with-agents-md: exit code 0', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--with-agents-md']);
  assert.equal(result.status, 0);
});

// ---- AC-04: --with-agents-md, pre-existing AGENTS.md ----

test('with-agents-md: inject action when AGENTS.md pre-exists', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.writeFileSync(path.join(target, 'AGENTS.md'), '# My Project Notes\n\nLine that must persist.\n');

  const result = runInit([target, '--with-agents-md', '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.summary.agents_md_action, 'inject');
});

test('with-agents-md: existing content preserved byte-for-byte (all lines present)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const originalContent = '# My Project Notes\n\nLine that MUST persist.\nAnother line that MUST persist.\n';
  fs.writeFileSync(path.join(target, 'AGENTS.md'), originalContent);

  runInit([target, '--with-agents-md']);

  const finalContent = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');

  assert.ok(finalContent.includes('My Project Notes'), 'Title must be preserved');
  assert.ok(finalContent.includes('Line that MUST persist.'), 'First content line must be preserved');
  assert.ok(finalContent.includes('Another line that MUST persist.'), 'Second content line must be preserved');
});

test('with-agents-md: existing file starts with original content', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const originalContent = '# My Project Notes\n\nLine that MUST persist.\n';
  fs.writeFileSync(path.join(target, 'AGENTS.md'), originalContent);

  runInit([target, '--with-agents-md']);

  const finalContent = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  // Original content should appear at the beginning (preserved)
  assert.ok(
    finalContent.startsWith(originalContent.trimEnd()),
    `Final AGENTS.md must start with original content. Got: ${finalContent.slice(0, 100)}`
  );
});

test('with-agents-md: injected block appears once only (not duplicated)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.writeFileSync(path.join(target, 'AGENTS.md'), '# My Project\n\nContent.\n');

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');

  // Count occurrences of start marker
  const startCount = (content.match(/soma-v2:start id=project\.AGENTS\.bootloader/g) || []).length;
  const endCount = (content.match(/soma-v2:end id=project\.AGENTS\.bootloader/g) || []).length;

  assert.equal(startCount, 1, 'start marker must appear exactly once');
  assert.equal(endCount, 1, 'end marker must appear exactly once');
});

test('with-agents-md: blank line separates existing content from injected block', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const originalContent = '# My Project\n\nContent.\n';
  fs.writeFileSync(path.join(target, 'AGENTS.md'), originalContent);

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  const blockStartIdx = content.indexOf(`<!-- soma-v2:start id=${BLOCK_ID}`);
  assert.ok(blockStartIdx > 0, 'start marker must be found after existing content');

  // The character(s) before the block start marker must include a blank line
  const beforeBlock = content.slice(0, blockStartIdx);
  assert.ok(
    beforeBlock.endsWith('\n\n'),
    `Expected blank line before block. Got ending: ${JSON.stringify(beforeBlock.slice(-20))}`
  );
});

test('with-agents-md: inject sha256 matches actual block content', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.writeFileSync(path.join(target, 'AGENTS.md'), '# My Project\n\nExisting content.\n');

  runInit([target, '--with-agents-md']);

  const content = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');

  // Extract sha256 from marker
  const sha256Match = content.match(/soma-v2:start[^>]+sha256=([a-f0-9]{64})/);
  assert.ok(sha256Match, 'sha256 must be in start marker');
  const attrSha = sha256Match[1];

  // Extract block body
  const startMarkerRegex = /<!--\s*soma-v2:start[^>]*-->/;
  const endMarkerStr = `<!-- soma-v2:end id=${BLOCK_ID} -->`;

  const startMatch = content.match(startMarkerRegex);
  const startIdx = content.indexOf(startMatch[0]) + startMatch[0].length;
  const endIdx = content.indexOf(endMarkerStr);

  let blockBody = content.slice(startIdx, endIdx);
  if (blockBody.startsWith('\n')) blockBody = blockBody.slice(1);
  if (blockBody.endsWith('\n')) blockBody = blockBody.slice(0, -1);

  const computedSha = crypto.createHash('sha256').update(blockBody).digest('hex');
  assert.equal(attrSha, computedSha, 'sha256 attribute must match real block content sha256');
});
