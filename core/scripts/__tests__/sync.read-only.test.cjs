'use strict';
// @spec AC-04
// Integration tests: sync --dry-run is read-only — canonical sources untouched

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

function collectFiles(dirPath) {
  const files = [];
  function walk(d) {
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    } catch (err) { /* skip */ }
  }
  walk(dirPath);
  return files;
}

function collectShas(paths) {
  const result = {};
  for (const p of paths) {
    result[p] = sha256file(p);
  }
  return result;
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sync-ro-'));
  const somaDir = path.join(dir, '.soma-v2');
  spawnSync('cp', ['-R', SOMA_HOME + '/.', somaDir], { stdio: 'pipe' });

  fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
  const realCodexAgents = path.join(os.homedir(), '.codex', 'AGENTS.md');
  if (fs.existsSync(realCodexAgents)) {
    fs.copyFileSync(realCodexAgents, path.join(dir, '.codex', 'AGENTS.md'));
  }
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Test AGENTS\n');

  // Patch install-targets
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

// ---- Tests ----

test('sync --dry-run: does not modify canonical sources', () => {
  const { somaDir } = createFixture();

  const canonicalPaths = [
    path.join(os.homedir(), '.codex', 'AGENTS.md'),
    path.join(os.homedir(), 'AGENTS.md'),
    path.join(os.homedir(), '.claude', 'constitution.md'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md')
  ].filter(p => fs.existsSync(p));

  const preShas = collectShas(canonicalPaths);

  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  for (const p of canonicalPaths) {
    const postSha = sha256file(p);
    assert.equal(postSha, preShas[p],
      `Canonical source was modified by sync --dry-run: ${p}`);
  }
});

test('sync --dry-run: does not modify fixture soma-v2 files', () => {
  const { somaDir } = createFixture();

  const labFiles = collectFiles(somaDir);
  const preShas = collectShas(labFiles);
  const preCount = labFiles.length;

  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  const postLabFiles = collectFiles(somaDir);
  const postShas = collectShas(postLabFiles);

  for (const p of labFiles) {
    if (preShas[p] !== null) {
      assert.equal(postShas[p], preShas[p],
        `Lab file was modified by sync --dry-run: ${p}`);
    }
  }

  assert.equal(postLabFiles.length, preCount,
    `sync --dry-run created ${postLabFiles.length - preCount} new files in lab`);
});

test('sync --dry-run: does not modify target files (insert = preview only)', () => {
  const { dir, somaDir } = createFixture();

  // Capture pre-state of target files
  const targetPaths = [
    path.join(dir, '.codex', 'AGENTS.md'),
    path.join(dir, 'AGENTS.md')
  ].filter(p => fs.existsSync(p));

  const preShas = collectShas(targetPaths);

  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  // Target files must be unchanged (dry-run = preview only)
  for (const p of targetPaths) {
    const postSha = sha256file(p);
    assert.equal(postSha, preShas[p],
      `Target file was modified by sync --dry-run (should be read-only): ${p}`);
  }
});

test('sync --dry-run: idempotent — two runs produce identical output', () => {
  const { somaDir } = createFixture();

  const run1 = spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  const run2 = spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  assert.equal(run2.status, run1.status, 'sync exit codes differ between runs');

  const parsed1 = JSON.parse(run1.stdout);
  const parsed2 = JSON.parse(run2.stdout);

  assert.equal(parsed2.summary.total_entries, parsed1.summary.total_entries,
    'sync total_entries differ between idempotent runs');
  assert.equal(parsed2.findings.length, parsed1.findings.length,
    'sync findings count differ between idempotent runs');
  assert.deepEqual(parsed2.summary.by_action, parsed1.summary.by_action,
    'sync by_action differs between idempotent runs');
});

test('sync --dry-run: no target files created when action=insert (truly dry)', () => {
  const { dir, somaDir } = createFixture();

  // Use a target path that doesn't exist
  const ghostTarget = path.join(dir, 'ghost-file-should-not-exist.md');

  // Create a variant fixture with ghost target
  const targetsPath = path.join(somaDir, 'adapters', 'codex', 'install-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const ghostEntries = targets.entries.slice(0, 1).map(e => ({
    ...e,
    target_path: ghostTarget
  }));
  fs.writeFileSync(targetsPath, JSON.stringify({
    schema: 'soma-install-targets/v1',
    tool: 'codex',
    entries: ghostEntries
  }, null, 2));

  assert.ok(!fs.existsSync(ghostTarget), 'Ghost target should not exist before sync');

  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json', `--soma-home=${somaDir}`], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  assert.ok(!fs.existsSync(ghostTarget),
    'sync --dry-run created ghost target file (should be read-only!)');
});
