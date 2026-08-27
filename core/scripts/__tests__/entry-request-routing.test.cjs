'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { routeEntryRequest } = require('../entry/request.cjs');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'SOMA test']);
  git(dir, ['config', 'user.email', 'soma@example.test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'fixture']);
}

function snapshotFiles(dir) {
  const result = new Map();
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const child = relative ? path.join(relative, entry.name) : entry.name;
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (entry.isFile()) result.set(child, { bytes: fs.readFileSync(absolute).toString('base64'), mtimeNs: stat.mtimeNs.toString() });
      else if (entry.isDirectory()) visit(absolute, child);
    }
  }
  visit(dir);
  return result;
}

test('help returns before project resolution', () => {
  let resolutions = 0;
  const result = routeEntryRequest(
    { mode: 'help' },
    { resolveProject: () => { resolutions += 1; throw new Error('must not run'); } }
  );
  assert.equal(result.status, 'HELP_SHOWN');
  assert.equal(resolutions, 0);
});

test('status is read-only across project bytes, mtimes, and Git index mtime', () => {
  const project = temp('soma-entry-status-');
  initRepo(project);
  const before = snapshotFiles(project);
  const cwdBefore = process.cwd();
  try {
    const result = routeEntryRequest({ mode: 'status', project }, { cwd: os.tmpdir(), home: os.homedir() });
    assert.equal(result.status, 'STATUS_SHOWN');
    assert.equal(result.projectRoot, fs.realpathSync(project));
    assert.deepEqual(snapshotFiles(project), before);
    assert.equal(process.cwd(), cwdBefore);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('start returns PROJECT_UNRESOLVED for an invalid target without throwing', () => {
  const missing = path.join(os.tmpdir(), `soma-entry-missing-${process.pid}`);
  const result = routeEntryRequest({ mode: 'start', objective: 'ship it', project: missing }, { cwd: os.tmpdir(), home: os.homedir() });
  assert.equal(result.status, 'PROJECT_UNRESOLVED');
  assert.equal(result.retrySafe, true);
});

test('start routes resolved project into adoption and preserves the objective as data', () => {
  const project = temp('soma-entry-route-start-');
  initRepo(project);
  let received = null;
  try {
    const result = routeEntryRequest(
      { mode: 'start', objective: 'ship $(touch NEVER) ; | `bad`', project },
      {
        cwd: os.tmpdir(), home: os.homedir(),
        adoptProject: (resolution) => {
          received = resolution;
          return { status: 'READY', adopted: true, baselineRequired: true, ...resolution, facts: {} };
        },
      }
    );
    assert.equal(result.status, 'READY');
    assert.equal(result.objective, 'ship $(touch NEVER) ; | `bad`');
    assert.equal(received.projectRoot, fs.realpathSync(project));
    assert.equal(fs.existsSync(path.join(project, 'NEVER')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
