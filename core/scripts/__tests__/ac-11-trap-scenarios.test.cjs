'use strict';
// @spec AC-11
// @contract CONTRACT-SYNC-APPLY-01
// T-13: AC-11 — 4 trap scenarios in /tmp synthetic, all exit 1, source untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function runSync(args, env = {}) {
  return spawnSync('node', [SYNC, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8', timeout: 15000
  });
}

function sha256(filepath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

// Trap 1: accidental --apply with empty install-targets (no entries)
test('AC-11 trap1: --apply with empty install-targets → exit 0 noop (no targets to write)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trap1-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex', entries: []
  }));
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${dir}`, '--json']);
  // Empty targets = no drift = noop = exit 0
  assert.equal(r.status, 0, `Trap1: Expected exit 0 (noop), got ${r.status}. stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snapshot, null, 'Trap1: snapshot must be null (no targets)');
  assert.equal(fs.existsSync(path.join(dir, '.snapshots')), false, 'Trap1: no .snapshots dir');
});

// Trap 2: missing snapshot dir (parent dir unwritable)
test('AC-11 trap2: missing snapshot dir (chmod 0000) → SNAPSHOT_CREATE_FAILED, source untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trap2-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=trap2-block version=1.0 -->\n# Trap2\n<!-- soma-v2:end id=trap2-block -->');
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'trap2-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'trap2-block' }]
  }));
  const snapDir = path.join(dir, '.snapshots');
  fs.mkdirSync(snapDir);
  fs.chmodSync(snapDir, 0o000);
  const shaBefore = sha256(targetFile);
  try {
    const r = runSync(['--apply', '--tool=codex', `--soma-home=${dir}`, '--json']);
    assert.equal(r.status, 1, `Trap2: Expected exit 1, got ${r.status}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, 'SNAPSHOT_CREATE_FAILED');
    assert.equal(sha256(targetFile), shaBefore, 'Trap2: source must be untouched');
  } finally {
    fs.chmodSync(snapDir, 0o755);
  }
});

// Trap 3: stale source (mutation between preview and write)
test('AC-11 trap3: stale source via SOMA_TEST_INJECT_STALE → SOURCE_STALE, source untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trap3-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=trap3-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=trap3-block -->');
  const targetFile = path.join(dir, 'target.md');
  fs.writeFileSync(targetFile, '# Target\nNo block.\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'trap3-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'trap3-block' }]
  }));
  const shaBefore = sha256(targetFile);
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${dir}`, '--json'], { SOMA_TEST_INJECT_STALE: targetFile });
  assert.equal(r.status, 1, `Trap3: Expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SOURCE_STALE', `Trap3: Expected SOURCE_STALE, got: ${out.error?.code}`);
  assert.equal(sha256(targetFile), shaBefore, 'Trap3: source must be untouched');
});

// Trap 4: parse error in fake AGENTS.md (broken anchor, start without end)
test('AC-11 trap4: parse error in fake AGENTS.md → ANCHOR_PARSE_ERROR, source untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trap4-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 'soma-manifest/v1', version: '2.1.0', files: [] }));
  const adapterDir = path.join(dir, 'adapters', 'codex');
  fs.mkdirSync(adapterDir, { recursive: true });
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'source.md'),
    '<!-- soma-v2:start id=trap4-block version=1.0 -->\n# Content\n<!-- soma-v2:end id=trap4-block -->');
  const targetFile = path.join(dir, 'AGENTS.md'); // fake AGENTS.md
  // Broken: start marker exists but no matching end
  fs.writeFileSync(targetFile,
    '# AGENTS\n<!-- soma-v2:start id=trap4-block version=0.9 -->\n# Old\n<!-- THIS IS NOT AN END MARKER -->\n');
  fs.writeFileSync(path.join(adapterDir, 'install-targets.json'), JSON.stringify({
    schema: 'soma-install-targets/v1', tool: 'codex',
    entries: [{ block_id: 'trap4-block', source_doc: 'docs/source.md', target_path: targetFile, target_anchor_id: 'trap4-block' }]
  }));
  const shaBefore = sha256(targetFile);
  const r = runSync(['--apply', '--tool=codex', `--soma-home=${dir}`, '--json']);
  assert.equal(r.status, 1, `Trap4: Expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'ANCHOR_PARSE_ERROR', `Trap4: Expected ANCHOR_PARSE_ERROR, got: ${out.error?.code}`);
  assert.equal(sha256(targetFile), shaBefore, 'Trap4: source must be untouched');
});
