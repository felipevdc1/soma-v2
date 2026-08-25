'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, 'core');
const INSTALL = path.join(ROOT, 'install.sh');
const { hashFile, hashTree } = require('../global-transaction.cjs');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runInstall(home, cwd, args = [], extraEnv = {}) {
  return spawnSync('bash', [INSTALL, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      NO_CODEX: '1',
      SOMA_INSTALL_TESTING: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 120000,
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function wholeFileEntries(root = CORE) {
  return readJson(path.join(root, 'adapters', 'claude', 'install-targets.json')).entries
    .filter((entry) => entry.kind === 'file');
}

function expandHome(home, declared) {
  assert.match(declared, /^~\//);
  return path.join(home, declared.slice(2));
}

function copyWholeFiles(sourceRoot, home, entries = wholeFileEntries(sourceRoot)) {
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry.source_path);
    const target = expandHome(home, entry.target_path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function seedLegacy(home, editManifest = (manifest) => manifest) {
  const previous = path.join(home, '.soma-v2');
  fs.cpSync(CORE, previous, { recursive: true });
  const manifestPath = path.join(previous, 'adapters', 'claude', 'install-targets.json');
  const manifest = editManifest(readJson(manifestPath));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  copyWholeFiles(previous, home, manifest.entries.filter((entry) => entry.kind === 'file'));
  return previous;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function snapshotPath(file) {
  if (!fs.existsSync(file)) return { exists: false };
  const stat = fs.lstatSync(file);
  assert.equal(stat.isSymbolicLink(), false, file);
  if (stat.isDirectory()) return { exists: true, kind: 'directory', mode: stat.mode & 0o7777, sha256: hashTree(file) };
  return { exists: true, kind: 'file', mode: stat.mode & 0o7777, sha256: hashFile(file) };
}

function liveTargets(home) {
  const targets = new Set([
    path.join(home, '.soma-v2'),
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'CLAUDE.md'),
  ]);
  for (const entry of wholeFileEntries()) targets.add(expandHome(home, entry.target_path));
  for (const rootName of ['templates', 'output-styles']) {
    const sourceRoot = path.join(ROOT, rootName);
    const visit = (directory, relative = '') => {
      for (const name of fs.readdirSync(directory)) {
        const absolute = path.join(directory, name);
        const childRelative = path.join(relative, name);
        if (fs.statSync(absolute).isDirectory()) visit(absolute, childRelative);
        else targets.add(path.join(home, '.claude', rootName, childRelative));
      }
    };
    visit(sourceRoot);
  }
  return [...targets].sort();
}

function snapshotLive(home) {
  return new Map(liveTargets(home).map((target) => [target, snapshotPath(target)]));
}

function assertLiveSnapshot(home, before) {
  const after = snapshotLive(home);
  assert.deepEqual([...after], [...before]);
}

function journals(home) {
  const backupRoot = path.join(home, '.soma-v2-backups');
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot)
    .map((name) => path.join(backupRoot, name, 'transaction.json'))
    .filter((file) => fs.existsSync(file));
}

test('026 AC-06/07/11: install.sh declares one transactional writer and a read-only preflight', () => {
  const source = fs.readFileSync(INSTALL, 'utf8');
  const preflight = source.slice(source.indexOf('Phase 0:'), source.indexOf('prepare --repo-root'));
  assert.doesNotMatch(preflight, /\b(?:mkdir|touch|rm|mv|cp|rsync|sed)\b/);
  assert.match(source, /global-transaction\.cjs" recover/);
  assert.match(source, /PREPARE_ARGS=\(prepare --repo-root/);
  assert.match(source, /global-transaction\.cjs" advance/);
  assert.match(source, /global-transaction\.cjs" rollback/);
  assert.match(source, /trap .*EXIT/);
  assert.match(source, /trap .*INT/);
  assert.match(source, /trap .*TERM/);
  assert.match(source, /--ledger-root="\$\{HOME\}\/\.soma-v2"/);
  assert.match(source, /--files-only/);
  assert.match(source, /SOMA_INSTALL_FAULT_AFTER/);
  assert.match(source, /SOMA_INSTALL_CRASH_AFTER/);
  assert.doesNotMatch(source, /rsync[^\n]*(?:core\/hooks|adapters\/claude\/commands)/);
  assert.doesNotMatch(source, /sync[^\n]*(?:\|\||2>\/dev\/null)/);
  assert.doesNotMatch(source, /doctor[^\n]*(?:\|\||2>\/dev\/null)/);
  assert.doesNotMatch(source, /\$\{PWD\}\/\.soma\/install-state\.json/);
});

test('026 AC-11: dry-run is byte-identical and reports a pending transaction without recovering it', (t) => {
  const sandbox = tmp('soma-global-dry-');
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  const project = path.join(sandbox, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(home, 'sentinel'), 'unchanged\n');
  const before = hashTree(home);
  const result = runInstall(home, project, ['--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(hashTree(home), before);
  assert.equal(fs.existsSync(path.join(home, '.soma-v2-backups')), false);
});

test('026 AC-01/10: two project directories converge through the global ledger without rewriting unchanged assets', (t) => {
  const sandbox = tmp('soma-global-two-cwd-');
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  const projectA = path.join(sandbox, 'worktree-a');
  const projectB = path.join(sandbox, 'worktree-b');
  fs.mkdirSync(home);
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);

  const first = runInstall(home, projectA);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const ledger = path.join(home, '.soma-v2', '.soma', 'install-state.json');
  assert.equal(fs.existsSync(ledger), true);
  assert.equal(fs.existsSync(path.join(projectA, '.soma', 'install-state.json')), false);
  const watched = [
    ledger,
    path.join(home, '.soma-v2', 'scripts', 'soma.cjs'),
    path.join(home, '.claude', 'commands', 'soma-run.md'),
  ];
  const firstState = watched.map((file) => ({ file, hash: hashFile(file), mtime: fs.statSync(file).mtimeMs }));

  const second = runInstall(home, projectB);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(fs.existsSync(path.join(projectB, '.soma', 'install-state.json')), false);
  assert.deepEqual(
    watched.map((file) => ({ file, hash: hashFile(file), mtime: fs.statSync(file).mtimeMs })),
    firstState
  );
  assert.equal(fs.existsSync(path.join(home, '.soma-v2-backups', '.active-transaction.json')), false);
});

test('026 AC-03/04: identical legacy targets are adopted, while one modified old target blocks every live mutation', async (t) => {
  await t.test('identical legacy', () => {
    const sandbox = tmp('soma-global-legacy-ok-');
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    const home = path.join(sandbox, 'home');
    const project = path.join(sandbox, 'project');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    seedLegacy(home);
    const result = runInstall(home, project);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const ledger = readJson(path.join(home, '.soma-v2', '.soma', 'install-state.json'));
    assert.equal(Object.keys(ledger.installedFiles).length, wholeFileEntries().length);
  });

  await t.test('modified old target', () => {
    const sandbox = tmp('soma-global-legacy-conflict-');
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    const home = path.join(sandbox, 'home');
    const project = path.join(sandbox, 'project');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    seedLegacy(home);
    fs.writeFileSync(path.join(home, '.claude', 'hooks', 'agent-mode-gate.cjs'), 'locally modified\n');
    const before = snapshotLive(home);
    const result = runInstall(home, project, ['--force-overwrite']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /GLOBAL_OWNERSHIP_CONFLICT/);
    assertLiveSnapshot(home, before);
    assert.equal(fs.existsSync(path.join(home, '.soma-v2', '.soma', 'install-state.json')), false);
  });
});

test('026 AC-05: a target new to the candidate needs force and preserves its exact pre-state in the transaction', (t) => {
  const create = (prefix) => {
    const sandbox = tmp(prefix);
    const home = path.join(sandbox, 'home');
    const project = path.join(sandbox, 'project');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    seedLegacy(home, (manifest) => ({
      ...manifest,
      entries: manifest.entries.filter((entry) => entry.target_path !== '~/.claude/commands/soma-run.md'),
    }));
    const target = path.join(home, '.claude', 'commands', 'soma-run.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'foreign new target\n');
    return { sandbox, home, project, target };
  };

  const blocked = create('soma-global-new-blocked-');
  t.after(() => fs.rmSync(blocked.sandbox, { recursive: true, force: true }));
  const before = fs.readFileSync(blocked.target);
  const noForce = runInstall(blocked.home, blocked.project);
  assert.notEqual(noForce.status, 0);
  assert.match(`${noForce.stdout}\n${noForce.stderr}`, /GLOBAL_OWNERSHIP_CONFLICT/);
  assert.deepEqual(fs.readFileSync(blocked.target), before);

  const allowed = create('soma-global-new-allowed-');
  t.after(() => fs.rmSync(allowed.sandbox, { recursive: true, force: true }));
  const forced = runInstall(allowed.home, allowed.project, ['--force-overwrite']);
  assert.equal(forced.status, 0, `${forced.stdout}\n${forced.stderr}`);
  assert.deepEqual(
    fs.readFileSync(allowed.target),
    fs.readFileSync(path.join(allowed.home, '.soma-v2', 'adapters', 'claude', 'commands', 'soma-run.md'))
  );
  const priorHash = sha256(Buffer.from('foreign new target\n'));
  const journal = journals(allowed.home).map(readJson).find((entry) =>
    entry.snapshots.some((snapshot) => snapshot.target_path === allowed.target && snapshot.sha256 === priorHash)
  );
  assert.ok(journal, 'PREPARED journal must retain the exact foreign pre-state hash');
});

test('026 AC-11: --no-claude-md still installs whole files and leaves CLAUDE.md byte-identical', (t) => {
  const sandbox = tmp('soma-global-no-claude-');
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  const project = path.join(sandbox, 'project');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(project);
  const claudeMd = path.join(home, '.claude', 'CLAUDE.md');
  fs.writeFileSync(claudeMd, '# user bytes\n');
  const result = runInstall(home, project, ['--no-claude-md']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(claudeMd, 'utf8'), '# user bytes\n');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'commands', 'soma-run.md')), true);
});

test('026 AC-08/09: every mutable state rolls back on exit, INT and TERM; SIGKILL recovers in another process', async (t) => {
  const states = ['ADOPTED', 'CORE_COPIED', 'FILES_SYNCED', 'SETTINGS_MERGED', 'ANCHORS_SYNCED', 'VERIFIED'];
  const modes = ['EXIT', 'INT', 'TERM'];
  for (const state of states) {
    for (const mode of modes) {
      await t.test(`${mode} after ${state}`, () => {
        const sandbox = tmp(`soma-global-fault-${mode.toLowerCase()}-`);
        const home = path.join(sandbox, 'home');
        const project = path.join(sandbox, 'project');
        fs.mkdirSync(home);
        fs.mkdirSync(project);
        seedLegacy(home);
        fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"user":true}\n');
        const before = snapshotLive(home);
        const env = mode === 'EXIT'
          ? { SOMA_INSTALL_FAULT_AFTER: state }
          : { SOMA_INSTALL_CRASH_AFTER: `${mode}:${state}` };
        const result = runInstall(home, project, [], env);
        assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assertLiveSnapshot(home, before);
        const journal = journals(home).map(readJson).at(-1);
        assert.equal(journal.state, 'ROLLED_BACK');
        assert.equal(fs.existsSync(path.join(journal.transaction_dir, 'quarantine')), true);
        assert.equal(fs.existsSync(path.join(home, '.soma-v2-backups', '.active-transaction.json')), false);
        fs.rmSync(sandbox, { recursive: true, force: true });
      });
    }
  }

  await t.test('SIGKILL leaves a durable pointer and another process recovers it', () => {
    const sandbox = tmp('soma-global-fault-kill-');
    const home = path.join(sandbox, 'home');
    const project = path.join(sandbox, 'project');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    seedLegacy(home);
    const before = snapshotLive(home);
    const killed = runInstall(home, project, [], { SOMA_INSTALL_CRASH_AFTER: 'FILES_SYNCED' });
    assert.notEqual(killed.status, 0);
    const pointer = path.join(home, '.soma-v2-backups', '.active-transaction.json');
    assert.equal(fs.existsSync(pointer), true);
    const killedJournalPath = readJson(pointer).transaction_path;
    const recovery = runInstall(home, project, [], { SOMA_INSTALL_FAULT_AFTER: 'ADOPTED' });
    assert.notEqual(recovery.status, 0);
    assertLiveSnapshot(home, before);
    assert.equal(readJson(killedJournalPath).state, 'ROLLED_BACK');
    assert.equal(fs.existsSync(pointer), false);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
});
