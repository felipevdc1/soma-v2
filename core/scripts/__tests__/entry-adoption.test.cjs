'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { inspectAdoption, adoptProject } = require('../entry/adoption.cjs');
const { withFakeHome } = require('./helpers/fake-home.cjs');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepo(dir, pkg = null) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'SOMA test']);
  git(dir, ['config', 'user.email', 'soma@example.test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'fixture']);
}

function projectSnapshot(dir) {
  const rows = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const child = relative ? path.join(relative, entry.name) : entry.name;
      const stat = fs.lstatSync(absolute, { bigint: true });
      rows.push([child, stat.mode.toString(), stat.mtimeNs.toString(), entry.isFile() ? fs.readFileSync(absolute).toString('base64') : null]);
      if (entry.isDirectory()) visit(absolute, child);
    }
  }
  visit(dir);
  return rows;
}

test('adopts a dirty legacy Git project once, records pre-adoption facts, and never runs package scripts', () => {
  withFakeHome('entry-adoption-home-', () => {
    const project = temp('soma-entry-adopt-');
    const sentinel = path.join(project, 'SCRIPT_RAN');
    initRepo(project, {
      scripts: {
        test: `node -e "require('fs').writeFileSync('${sentinel}','ran')"`,
        'test:unit': `node -e "require('fs').writeFileSync('${sentinel}','unit')"`,
        dev: `node -e "require('fs').writeFileSync('${sentinel}','dev')"`,
      },
    });
    fs.writeFileSync(path.join(project, 'dirty.txt'), 'dirty\n');
    let calls = 0;
    try {
      const inspection = inspectAdoption({ projectRoot: project, scope: project });
      assert.equal(inspection.kind, 'adoptable');
      assert.equal(inspection.facts.branch.length > 0, true);
      assert.deepEqual(inspection.facts.dirtyPaths, ['dirty.txt']);
      assert.deepEqual(inspection.facts.testCommands.map(item => item.name), ['test', 'test:unit']);

      const ready = adoptProject(
        { projectRoot: project, scope: project },
        { installer: (target, options) => {
          calls += 1;
          return require('../install.cjs').installProject(target, options);
        } }
      );
      assert.equal(calls, 1);
      assert.equal(ready.status, 'READY');
      assert.equal(ready.adopted, true);
      assert.equal(ready.baselineRequired, true);
      assert.equal(fs.existsSync(sentinel), false);
      assert.equal(fs.existsSync(path.join(project, '.soma', 'runs')), false);
      const adoption = JSON.parse(fs.readFileSync(path.join(project, '.soma', 'adoption.json')));
      assert.equal(adoption.$schema, 'soma-adoption/v1');
      assert.deepEqual(adoption.facts.dirtyPaths, ['dirty.txt']);
      assert.deepEqual(adoption.facts.testCommands.map(item => item.name), ['test', 'test:unit']);
      assert.equal(fs.existsSync(path.join(project, '.soma-adoption.pending.json')), false);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

test('a legacy complete installation without adoption metadata stays READY without a baseline', () => {
  withFakeHome('entry-legacy-complete-home-', () => {
    const project = temp('soma-entry-legacy-complete-');
    initRepo(project);
    try {
      assert.equal(adoptProject({ projectRoot: project, scope: project }).status, 'READY');
      fs.rmSync(path.join(project, '.soma', 'adoption.json'));

      const result = adoptProject({ projectRoot: project, scope: project });
      assert.equal(result.status, 'READY');
      assert.equal(result.adopted, false);
      assert.equal(result.baselineRequired, false);
      assert.equal(fs.existsSync(path.join(project, '.soma', 'adoption.json')), false);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

test('corrupt or inconsistent adoption metadata blocks without rewriting it', () => {
  for (const fixture of [
    { name: 'corrupt', value: '{bad json\n' },
    { name: 'extra-field', value: JSON.stringify({ extra: true }) },
    { name: 'invalid-date', mutate: record => ({ ...record, adoptedAt: '1' }) },
    { name: 'wrong-project', mutate: record => ({ ...record, projectRoot: `${record.projectRoot}-other` }) },
    { name: 'wrong-scope', mutate: record => ({ ...record, scope: `${record.scope}-other` }) },
  ]) {
    withFakeHome(`entry-adoption-${fixture.name}-home-`, () => {
      const project = temp(`soma-entry-adoption-${fixture.name}-`);
      initRepo(project);
      try {
        assert.equal(adoptProject({ projectRoot: project, scope: project }).status, 'READY');
        const adoptionPath = path.join(project, '.soma', 'adoption.json');
        const original = JSON.parse(fs.readFileSync(adoptionPath, 'utf8'));
        fs.writeFileSync(adoptionPath, fixture.value || `${JSON.stringify(fixture.mutate(original), null, 2)}\n`);
        const before = projectSnapshot(path.join(project, '.soma'));

        const inspection = inspectAdoption({ projectRoot: project, scope: project });
        assert.equal(inspection.kind, 'blocked', fixture.name);
        assert.match(inspection.diagnostic, /adoption/i, fixture.name);
        assert.deepEqual(projectSnapshot(path.join(project, '.soma')), before, fixture.name);
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    });
  }
});

test('an interrupted adoption leaves a pending record that blocks every later attempt', () => {
  for (const fixture of [
    { name: 'return', installer: () => 2 },
    { name: 'throw', installer: () => { throw Object.assign(new Error('interrupted'), { code: 'INTERRUPTED' }); } },
    { name: 'throw-after-install', installer: (target, options) => {
      assert.equal(require('../install.cjs').installProject(target, options), 0);
      throw Object.assign(new Error('interrupted after install'), { code: 'INTERRUPTED' });
    } },
  ]) {
    withFakeHome(`entry-adoption-interrupted-${fixture.name}-home-`, () => {
      const project = temp(`soma-entry-adoption-interrupted-${fixture.name}-`);
      initRepo(project);
      const pendingPath = path.join(project, '.soma-adoption.pending.json');
      let calls = 0;
      try {
        const result = adoptProject(
          { projectRoot: project, scope: project },
          { installer: (...args) => {
            calls += 1;
            assert.equal(fs.existsSync(pendingPath), true);
            const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
            assert.equal(pending.$schema, 'soma-adoption/v1');
            assert.equal(pending.projectRoot, fs.realpathSync(project));
            assert.deepEqual(pending.facts.dirtyPaths, []);
            return fixture.installer(...args);
          } }
        );
        assert.equal(result.status, 'ADOPTION_BLOCKED', fixture.name);
        assert.equal(calls, 1, fixture.name);
        const pendingBefore = fs.readFileSync(pendingPath);
        const pendingMtime = fs.statSync(pendingPath, { bigint: true }).mtimeNs;

        const inspection = inspectAdoption({ projectRoot: project, scope: project });
        assert.equal(inspection.kind, 'blocked', fixture.name);
        assert.match(inspection.diagnostic, /pending|interrupted/i, fixture.name);
        const retry = adoptProject(
          { projectRoot: project, scope: project },
          { installer: () => { calls += 1; return 0; } }
        );
        assert.equal(retry.status, 'ADOPTION_BLOCKED', fixture.name);
        assert.equal(calls, 1, fixture.name);
        assert.deepEqual(fs.readFileSync(pendingPath), pendingBefore, fixture.name);
        assert.equal(fs.statSync(pendingPath, { bigint: true }).mtimeNs, pendingMtime, fixture.name);
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    });
  }
});

test('a complete installation is READY without adoption or baseline and adoption metadata stays byte-stable', () => {
  withFakeHome('entry-complete-home-', () => {
    const project = temp('soma-entry-complete-');
    initRepo(project);
    try {
      const first = adoptProject({ projectRoot: project, scope: project });
      assert.equal(first.status, 'READY');
      const adoptionPath = path.join(project, '.soma', 'adoption.json');
      const bytes = fs.readFileSync(adoptionPath);
      const mtime = fs.statSync(adoptionPath, { bigint: true }).mtimeNs;

      const second = adoptProject({ projectRoot: project, scope: project });
      assert.deepEqual(second, {
        status: 'READY', adopted: false, baselineRequired: false,
        projectRoot: fs.realpathSync(project), scope: fs.realpathSync(project),
        facts: second.facts,
      });
      assert.deepEqual(fs.readFileSync(adoptionPath), bytes);
      assert.equal(fs.statSync(adoptionPath, { bigint: true }).mtimeNs, mtime);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

test('partial, corrupt, and drifted SOMA state blocks adoption without rewriting bytes or mtimes', () => {
  for (const fixture of [
    { name: 'partial', write: dir => fs.writeFileSync(path.join(dir, 'manifest.json'), '{}\n') },
    { name: 'corrupt', write: dir => fs.writeFileSync(path.join(dir, 'install-state.json'), '{bad json\n') },
    { name: 'drifted', write: dir => {
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      fs.writeFileSync(path.join(dir, 'install-state.json'), JSON.stringify({
        $schema: 'soma-install-state/v1', status: 'drift-detected', timestamp: now,
        snapshotId: now, harness: 'claude', installedVersion: '2.3.0', lastError: 'fixture drift',
      }));
    } },
  ]) {
    const project = temp(`soma-entry-${fixture.name}-`);
    initRepo(project);
    const somaDir = path.join(project, '.soma');
    fs.mkdirSync(somaDir);
    fixture.write(somaDir);
    const before = projectSnapshot(somaDir);
    let calls = 0;
    try {
      const result = adoptProject(
        { projectRoot: project, scope: project },
        { installer: () => { calls += 1; return 0; } }
      );
      assert.equal(result.status, 'ADOPTION_BLOCKED', fixture.name);
      assert.equal(typeof result.diagnostic, 'string');
      assert.equal(calls, 0);
      assert.deepEqual(projectSnapshot(somaDir), before);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }
});

test('a drifted bootloader blocks adoption without invoking the installer or rewriting the project', () => {
  withFakeHome('entry-anchor-drift-home-', () => {
    const project = temp('soma-entry-anchor-drift-');
    initRepo(project);
    try {
      assert.equal(adoptProject({ projectRoot: project, scope: project }).status, 'READY');
      const claudePath = path.join(project, 'CLAUDE.md');
      fs.writeFileSync(claudePath, fs.readFileSync(claudePath, 'utf8').replace(/(<!-- soma-v2:start[^\n]*\n)/, '$1DRIFT\n'));
      const before = projectSnapshot(project);
      let calls = 0;
      const result = adoptProject(
        { projectRoot: project, scope: project },
        { installer: () => { calls += 1; return 0; } }
      );
      assert.equal(result.status, 'ADOPTION_BLOCKED');
      assert.match(result.diagnostic, /drift/i);
      assert.equal(calls, 0);
      assert.deepEqual(projectSnapshot(project), before);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

test('an installed anchor without sha256 is blocked and inspection preserves project bytes and mtimes', () => {
  withFakeHome('entry-anchor-no-sha-home-', () => {
    const project = temp('soma-entry-anchor-no-sha-');
    initRepo(project);
    try {
      assert.equal(adoptProject({ projectRoot: project, scope: project }).status, 'READY');
      const claudePath = path.join(project, 'CLAUDE.md');
      const installed = fs.readFileSync(claudePath, 'utf8');
      const withoutSha = installed.replace(/\s+sha256=[a-f0-9]+(?=\s*-->)/, '');
      assert.notEqual(withoutSha, installed);
      fs.writeFileSync(claudePath, withoutSha);
      const before = projectSnapshot(project);

      const inspection = inspectAdoption({ projectRoot: project, scope: project });
      assert.equal(inspection.kind, 'blocked');
      assert.match(inspection.diagnostic, /corrupt|drift|sha/i);
      assert.deepEqual(projectSnapshot(project), before);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

test('monorepo adoption records the declared workspace scope and its test command names', () => {
  withFakeHome('entry-monorepo-home-', () => {
    const project = temp('soma-entry-adopt-monorepo-');
    const workspace = path.join(project, 'packages', 'app');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'exit 99', dev: 'exit 98' } }));
    initRepo(project, { workspaces: ['packages/*'] });
    try {
      const result = adoptProject({ projectRoot: project, scope: workspace });
      assert.equal(result.status, 'READY');
      assert.equal(result.scope, fs.realpathSync(workspace));
      assert.deepEqual(result.facts.testCommands.map(item => item.name), ['test']);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
