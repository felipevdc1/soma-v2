'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveProject } = require('../entry/project.cjs');
const { readGitFacts } = require('../entry/git-readonly.cjs');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'SOMA test']);
  git(dir, ['config', 'user.email', 'soma@example.test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-qm', 'fixture']);
}

test('resolves an explicit Git project and a nested Git cwd without changing cwd', () => {
  const repo = temp('soma-entry-project-');
  const nested = path.join(repo, 'src', 'nested');
  fs.mkdirSync(nested, { recursive: true });
  initRepo(repo);
  const before = process.cwd();
  try {
    assert.deepEqual(resolveProject({ project: repo, cwd: os.tmpdir(), home: os.homedir() }), {
      projectRoot: fs.realpathSync(repo),
      scope: fs.realpathSync(repo),
      source: 'explicit',
    });
    assert.deepEqual(resolveProject({ cwd: nested, home: os.homedir() }), {
      projectRoot: fs.realpathSync(repo),
      scope: fs.realpathSync(repo),
      source: 'git-cwd',
    });
    assert.equal(process.cwd(), before);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('accepts an explicitly selected declared workspace and rejects ambiguous implicit monorepo scope', () => {
  const repo = temp('soma-entry-monorepo-');
  const app = path.join(repo, 'packages', 'app');
  const api = path.join(repo, 'packages', 'api');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(api, { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  initRepo(repo);
  try {
    assert.deepEqual(resolveProject({ project: app, cwd: repo, home: os.homedir() }), {
      projectRoot: fs.realpathSync(repo),
      scope: fs.realpathSync(app),
      source: 'explicit',
    });
    assert.throws(
      () => resolveProject({ cwd: repo, home: os.homedir() }),
      { code: 'PROJECT_AMBIGUOUS' }
    );
    fs.mkdirSync(path.join(repo, 'packages', 'app', 'nested'), { recursive: true });
    assert.throws(
      () => resolveProject({ project: path.join(app, 'nested'), cwd: repo, home: os.homedir() }),
      { code: 'PROJECT_SCOPE_INVALID' }
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('accepts an explicitly selected empty non-Git directory', () => {
  const dir = temp('soma-entry-empty-');
  try {
    assert.deepEqual(resolveProject({ project: dir, cwd: os.tmpdir(), home: os.homedir() }), {
      projectRoot: fs.realpathSync(dir),
      scope: fs.realpathSync(dir),
      source: 'explicit-empty',
    });
    assert.throws(
      () => resolveProject({ cwd: dir, home: os.homedir() }),
      { code: 'PROJECT_UNRESOLVED' }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects filesystem root, home, markerless non-Git content, and symlink escape', () => {
  const home = temp('soma-entry-home-');
  const repo = temp('soma-entry-symlink-repo-');
  const outside = temp('soma-entry-outside-');
  const markerless = temp('soma-entry-markerless-');
  initRepo(repo);
  fs.writeFileSync(path.join(markerless, 'notes.txt'), 'not a project marker\n');
  fs.symlinkSync(outside, path.join(repo, 'escape'));
  try {
    assert.throws(() => resolveProject({ project: path.parse(repo).root, cwd: repo, home }), { code: 'PROJECT_UNRESOLVED' });
    assert.throws(() => resolveProject({ project: home, cwd: repo, home }), { code: 'PROJECT_UNRESOLVED' });
    assert.throws(() => resolveProject({ project: markerless, cwd: repo, home }), { code: 'PROJECT_UNRESOLVED' });
    assert.throws(() => resolveProject({ project: 'escape', cwd: repo, home }), { code: 'PROJECT_SCOPE_INVALID' });
    assert.throws(() => resolveProject({ project: path.join(repo, 'escape'), cwd: repo, home }), { code: 'PROJECT_SCOPE_INVALID' });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(markerless, { recursive: true, force: true });
  }
});

test('read-only Git resolution leaves index bytes and mtime unchanged', () => {
  const repo = temp('soma-entry-git-readonly-');
  initRepo(repo);
  const index = path.join(repo, '.git', 'index');
  const beforeBytes = fs.readFileSync(index);
  const beforeStat = fs.statSync(index, { bigint: true });
  try {
    resolveProject({ project: repo, cwd: repo, home: os.homedir() });
    const afterStat = fs.statSync(index, { bigint: true });
    assert.deepEqual(fs.readFileSync(index), beforeBytes);
    assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('read-only Git facts preserve both paths of a rename', () => {
  const repo = temp('soma-entry-git-rename-');
  initRepo(repo);
  try {
    git(repo, ['mv', 'README.md', 'RENAMED.md']);
    assert.deepEqual(readGitFacts(repo).dirtyPaths, ['README.md', 'RENAMED.md']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
