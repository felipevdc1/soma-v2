/**
 * AC-15: backward compat — 315/315 SOMA + 47/47 hooks regression preserved + 6 shasums match
 * @spec AC-15
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOMA_REPO = path.join(os.homedir(), '.soma-v2');

// 6 canonical+lib files whose shasums must match baseline
const SHASUM_TARGETS = [
  path.join(os.homedir(), '.codex/AGENTS.md'),
  path.join(os.homedir(), 'AGENTS.md'),
  path.join(os.homedir(), '.claude/constitution.md'),
  path.join(SOMA_REPO, 'scripts/lib/anchored-blocks.cjs'),
  path.join(SOMA_REPO, 'scripts/lib/manifest.cjs'),
  path.join(SOMA_REPO, 'scripts/lib/template-engine.cjs'),
];

function sha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseShasumFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const map = {};
  for (const line of lines) {
    const [hash, file] = line.split('  ');
    map[file.trim()] = hash.trim();
  }
  return map;
}

test('AC-15: 6 canonical+lib file shasums match baseline', () => {
  const baselineFile = '/tmp/phase4c-shasum-before.txt';
  assert.ok(fs.existsSync(baselineFile), `Baseline shasum file must exist at ${baselineFile}`);
  const baseline = parseShasumFile(baselineFile);
  for (const filePath of SHASUM_TARGETS) {
    assert.ok(fs.existsSync(filePath), `Target file must exist: ${filePath}`);
    const currentHash = sha256(filePath);
    const baselineHash = baseline[filePath];
    assert.ok(baselineHash, `Baseline hash must exist for ${filePath}`);
    assert.equal(currentHash, baselineHash,
      `SHA256 mismatch for ${filePath}. Expected ${baselineHash}, got ${currentHash}`);
  }
});

test('AC-15: shasum-locked libs are UNMODIFIED (anchored-blocks, manifest, template-engine)', () => {
  const lockedLibs = [
    path.join(SOMA_REPO, 'scripts/lib/anchored-blocks.cjs'),
    path.join(SOMA_REPO, 'scripts/lib/manifest.cjs'),
    path.join(SOMA_REPO, 'scripts/lib/template-engine.cjs'),
  ];
  const baselineFile = '/tmp/phase4c-shasum-before.txt';
  const baseline = parseShasumFile(baselineFile);
  for (const libPath of lockedLibs) {
    const currentHash = sha256(libPath);
    const baselineHash = baseline[libPath];
    assert.equal(currentHash, baselineHash,
      `LOCKED LIB MODIFIED: ${libPath}. This is a spec violation.`);
  }
});
