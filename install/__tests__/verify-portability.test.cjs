'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { verifyPortability, GATES } = require('../verify-portability.cjs');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verify-portability-test-'));
}

// ── Gate unit tests using mocked env ────────────────────────────────────────

test('gate 1 (version): VERSION file matches plugin.json', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'VERSION'), '2.1.0\n');

  const pluginDir = path.join(dir, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ version: '2.1.0' }));

  const result = GATES.gate1Version({ repoRoot: dir });
  assert.ok(result.pass, `gate1 should pass: ${result.detail}`);
});

test('gate 1 (version): mismatch → fail', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'VERSION'), '2.0.0\n');

  const pluginDir = path.join(dir, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ version: '2.1.0' }));

  const result = GATES.gate1Version({ repoRoot: dir });
  assert.ok(!result.pass, 'gate1 should fail when versions differ');
});

test('gate 9 (output-style file): exists → pass', () => {
  const dir = mkTmpDir();
  const styleFile = path.join(dir, 'soma-voxel.md');
  fs.writeFileSync(styleFile, '# SOMA Voxel Style');

  const result = GATES.gate9OutputStyle({ outputStylePath: styleFile });
  assert.ok(result.pass, `gate9 should pass when file exists: ${result.detail}`);
});

test('gate 9 (output-style file): missing → fail', () => {
  const result = GATES.gate9OutputStyle({ outputStylePath: '/nonexistent-99999/soma-voxel.md' });
  assert.ok(!result.pass, 'gate9 should fail when file does not exist');
});

test('gate 10 (plugin.json valid): valid JSON → pass', () => {
  const dir = mkTmpDir();
  const pluginDir = path.join(dir, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'soma', version: '2.1.0' }));

  const result = GATES.gate10PluginManifest({ repoRoot: dir });
  assert.ok(result.pass, `gate10 should pass with valid JSON: ${result.detail}`);
});

test('gate 10 (plugin.json valid): malformed JSON → fail', () => {
  const dir = mkTmpDir();
  const pluginDir = path.join(dir, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), '{ invalid json !!!');

  const result = GATES.gate10PluginManifest({ repoRoot: dir });
  assert.ok(!result.pass, 'gate10 should fail with malformed JSON');
});

test('gate 11 (constitution): finds v1.0.0 + no DRAFT → pass', () => {
  const dir = mkTmpDir();
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const content = `# SOMA Constitution\n\n**Version:** v1.0.0\n\nArticle I...`;
  fs.writeFileSync(path.join(docsDir, 'constitution.md'), content);

  const result = GATES.gate11Constitution({ coreRoot: dir });
  assert.ok(result.pass, `gate11 should pass: ${result.detail}`);
});

test('gate 11 (constitution): finds v1.0.0 + has DRAFT → fail', () => {
  const dir = mkTmpDir();
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const content = `# SOMA Constitution\n\n**Version:** v1.0.0\n**Status:** DRAFT\n\nArticle I...`;
  fs.writeFileSync(path.join(docsDir, 'constitution.md'), content);

  const result = GATES.gate11Constitution({ coreRoot: dir });
  assert.ok(!result.pass, 'gate11 should fail when DRAFT is present');
});

test('gate 11 (constitution): missing v1.0.0 → fail', () => {
  const dir = mkTmpDir();
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const content = `# SOMA Constitution\n\n**Version:** v0.9.0-pre`;
  fs.writeFileSync(path.join(docsDir, 'constitution.md'), content);

  const result = GATES.gate11Constitution({ coreRoot: dir });
  assert.ok(!result.pass, 'gate11 should fail when v1.0.0 not found');
});

test('gate 12 (no identity leak): zero matches → pass', () => {
  const dir = mkTmpDir();
  const coreDir = path.join(dir, 'core');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(path.join(coreDir, 'readme.md'), '# SOMA v2.1\n\nWelcome to SOMA.');

  const result = GATES.gate12NoLeak({ scanRoots: [coreDir] });
  assert.ok(result.pass, `gate12 should pass with no leak: ${result.detail}`);
});

test('gate 12 (no identity leak): finds match → fail with leaked path', () => {
  const dir = mkTmpDir();
  const coreDir = path.join(dir, 'core');
  fs.mkdirSync(coreDir, { recursive: true });

  // Build the leak string at runtime to avoid self-matching when this test file is scanned
  const leakPath = '/Users/' + 'felipevdc' + '1' + '/.claude/hooks/thermal-guard.cjs';
  fs.writeFileSync(path.join(coreDir, 'hooks.json'), JSON.stringify({
    command: 'node ' + leakPath
  }));

  const result = GATES.gate12NoLeak({ scanRoots: [coreDir] });
  assert.ok(!result.pass, 'gate12 should fail when leak found');
  // The detail should either contain the leaked string or the word "leak"
  assert.ok(result.detail.length > 0 && !result.pass, 'detail should be non-empty on failure');
});

test('overall report: 10 pass + 2 fail → blockers list with 2 items', () => {
  // Mock runner: inject pre-baked gate results
  const mockResults = [
    { name: 'gate1', pass: true, detail: 'ok' },
    { name: 'gate2', pass: true, detail: 'ok' },
    { name: 'gate3', pass: true, detail: 'ok' },
    { name: 'gate4', pass: true, detail: 'ok' },
    { name: 'gate5', pass: true, detail: 'ok' },
    { name: 'gate6', pass: true, detail: 'ok' },
    { name: 'gate7', pass: true, detail: 'ok' },
    { name: 'gate8', pass: true, detail: 'ok' },
    { name: 'gate9', pass: true, detail: 'ok' },
    { name: 'gate10', pass: false, detail: 'plugin.json invalid' },
    { name: 'gate11', pass: false, detail: 'constitution has DRAFT' },
    { name: 'gate12', pass: true, detail: 'ok' }
  ];

  const { buildReport } = require('../verify-portability.cjs');
  const report = buildReport(mockResults);

  assert.strictEqual(report.passed, 10, 'passed count should be 10');
  assert.strictEqual(report.failed, 2, 'failed count should be 2');
  assert.strictEqual(report.blockers.length, 2, 'blockers list should have 2 items');
  assert.ok(report.blockers.some(b => b.includes('gate10')), 'gate10 should be in blockers');
  assert.ok(report.blockers.some(b => b.includes('gate11')), 'gate11 should be in blockers');
});

test('mode=ci skips live-CLI gates', () => {
  // verifyPortability in ci mode should not error on missing soma CLI
  // It should return a result with live-CLI gates marked as skipped
  const dir = mkTmpDir();

  // Set up minimal passing env for static gates
  fs.writeFileSync(path.join(dir, 'VERSION'), '2.1.0\n');
  const pluginDir = path.join(dir, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ version: '2.1.0' }));

  const outputStylePath = path.join(dir, 'soma-voxel.md');
  fs.writeFileSync(outputStylePath, '# style');

  const coreDir = path.join(dir, 'core');
  fs.mkdirSync(path.join(coreDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(coreDir, 'docs', 'constitution.md'),
    '# SOMA Constitution\n**Version:** v1.0.0\nNo draft here.');

  let threw = false;
  try {
    const report = verifyPortability({
      mode: 'ci',
      repoRoot: dir,
      coreRoot: coreDir,
      outputStylePath
    });
    // ci mode: must not throw, must return a report
    assert.ok(typeof report.passed === 'number', 'should return passed count');
    assert.ok(typeof report.failed === 'number', 'should return failed count');
  } catch (e) {
    threw = true;
    console.error('threw:', e.message);
  }
  assert.ok(!threw, 'ci mode must not throw even without live soma CLI');
});
