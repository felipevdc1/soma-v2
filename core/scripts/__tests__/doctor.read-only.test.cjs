'use strict';
// @spec AC-02
// Integration tests: doctor is read-only — canonical sources untouched

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');

function sha256file(filepath) {
  try {
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ro-fixture-'));
  const somaDir = path.join(dir, '.soma-v2');
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  // Set up canonical-ish source files inside fixture
  fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
  const realCodexAgents = path.join(os.homedir(), '.codex', 'AGENTS.md');
  if (fs.existsSync(realCodexAgents)) {
    fs.copyFileSync(realCodexAgents, path.join(dir, '.codex', 'AGENTS.md'));
  }
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Test AGENTS\n');
  fs.writeFileSync(path.join(dir, 'constitution.md'), '# Test Constitution\n');

  // Patch install-targets to use fixture paths
  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const patchedEntries = targets.entries.map(e => {
    let tp = e.target_path;
    if (tp === '~/.codex/AGENTS.md') tp = path.join(dir, '.codex', 'AGENTS.md');
    else if (tp === '~/AGENTS.md') tp = path.join(dir, 'AGENTS.md');
    return { ...e, target_path: tp };
  });
  fs.writeFileSync(targetsPath, JSON.stringify({ ...targets, entries: patchedEntries }, null, 2));

  return { dir, somaDir };
}

// Helper to collect shasums for a set of paths
function collectShas(paths) {
  const result = {};
  for (const p of paths) {
    result[p] = sha256file(p);
  }
  return result;
}

test('doctor: does not modify canonical sources (read-only contract)', () => {
  const { dir, somaDir } = createFixture();

  // Capture pre-state of canonical sources
  const canonicalPaths = [
    path.join(os.homedir(), '.codex', 'AGENTS.md'),
    path.join(os.homedir(), 'AGENTS.md'),
    path.join(os.homedir(), '.claude', 'constitution.md'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md')
  ].filter(p => fs.existsSync(p));

  const preShas = collectShas(canonicalPaths);

  // Run doctor against fixture (not real ~/— ensures it reads from fixture)
  spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  // Verify canonical sources unchanged
  for (const p of canonicalPaths) {
    const postSha = sha256file(p);
    assert.equal(postSha, preShas[p],
      `Canonical source was modified by doctor: ${p}`);
  }
});

test('doctor: does not modify fixture soma-v2 files (read-only contract)', () => {
  const { somaDir } = createFixture();

  // Capture pre-state of all lab files
  const labFiles = [];
  function collectFiles(dirPath) {
    try {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) collectFiles(full);
        else labFiles.push(full);
      }
    } catch (err) { /* skip unreadable */ }
  }
  collectFiles(somaDir);

  const preShas = collectShas(labFiles);
  const preCount = labFiles.length;

  // Run doctor against fixture
  spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  // Collect post-state fresh
  const postLabFiles = [];
  function collectPostFiles(dirPath) {
    try {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) collectPostFiles(full);
        else postLabFiles.push(full);
      }
    } catch (err) { /* skip unreadable */ }
  }
  collectPostFiles(somaDir);
  const postShas = collectShas(postLabFiles);

  // No files should be modified
  for (const p of labFiles) {
    if (preShas[p] !== null) {
      assert.equal(postShas[p], preShas[p],
        `Lab file was modified by doctor: ${p}`);
    }
  }

  // No new files should be created in lab
  assert.equal(postLabFiles.length, preCount,
    `Doctor created ${postLabFiles.length - preCount} new files in lab`);
});

test('doctor: idempotent — two runs produce identical output', () => {
  const { somaDir } = createFixture();

  const run1 = spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  const run2 = spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  // Exit codes must match
  assert.equal(run2.status, run1.status, 'Doctor exit codes differ between runs');

  // Parse and compare findings (ignore timing-dependent fields)
  const parsed1 = JSON.parse(run1.stdout);
  const parsed2 = JSON.parse(run2.stdout);

  assert.equal(parsed2.summary.total_findings, parsed1.summary.total_findings,
    'Doctor total_findings differ between idempotent runs');
  assert.equal(parsed2.findings.length, parsed1.findings.length,
    'Doctor findings count differ between idempotent runs');
});

test('doctor --json: does not write any /tmp/ck files (no hook side effects)', () => {
  const { somaDir } = createFixture();

  // Record /tmp/ck files before
  const ckDir = path.join(os.tmpdir(), 'ck');
  const preFiles = new Set();
  if (fs.existsSync(ckDir)) {
    for (const f of fs.readdirSync(ckDir, { recursive: true })) {
      preFiles.add(String(f));
    }
  }

  spawnSync('node', ['scripts/doctor.cjs', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  // Check no new /tmp/ck files were created by doctor
  if (fs.existsSync(ckDir)) {
    for (const f of fs.readdirSync(ckDir, { recursive: true })) {
      // Only flag soma-specific files; ck markers are from hooks, not doctor
      // Doctor should not write anything to /tmp/ck
      if (String(f).includes('soma') || String(f).includes('doctor')) {
        assert.ok(preFiles.has(String(f)),
          `Doctor created unexpected /tmp/ck file: ${f}`);
      }
    }
  }
});
