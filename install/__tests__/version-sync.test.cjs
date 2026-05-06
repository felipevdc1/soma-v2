'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { syncVersions, checkDrift } = require('../version-sync.cjs');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'version-sync-test-'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createRepoFixture(dir, versionStr, opts) {
  opts = opts || {};
  fs.writeFileSync(path.join(dir, 'VERSION'), versionStr + '\n');

  const pluginDir = path.join(dir, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  const pluginVersion = opts.pluginVersion !== undefined ? opts.pluginVersion : versionStr;
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ name: 'soma', version: pluginVersion, schema_version: 1 }, null, 2));

  const packageVersion = opts.packageVersion !== undefined ? opts.packageVersion : versionStr;
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: 'soma-v2', version: packageVersion, main: 'index.js' }, null, 2));

  const coreDir = path.join(dir, 'core');
  fs.mkdirSync(coreDir, { recursive: true });
  const coreVersion = opts.coreVersion !== undefined ? opts.coreVersion : versionStr;
  fs.writeFileSync(path.join(coreDir, 'manifest.json'),
    JSON.stringify({ name: 'soma-core', version: coreVersion }, null, 2));

  return { dir, pluginDir, coreDir };
}

test('sync: VERSION=2.1.0 → propagates to all 3 manifests', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0', {
    pluginVersion: '0.0.0', // old, should be updated
    packageVersion: '1.0.0',
    coreVersion: '0.5.0'
  });

  const result = syncVersions({ repoRoot: dir });

  assert.strictEqual(result.version, '2.1.0', 'result should report the synced version');
  assert.strictEqual(result.updated.length, 3, 'should update all 3 manifests');

  // Verify each file has the new version
  const plugin = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf-8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  const core = JSON.parse(fs.readFileSync(path.join(dir, 'core', 'manifest.json'), 'utf-8'));

  assert.strictEqual(plugin.version, '2.1.0', 'plugin.json version should be 2.1.0');
  assert.strictEqual(pkg.version, '2.1.0', 'package.json version should be 2.1.0');
  assert.strictEqual(core.version, '2.1.0', 'core/manifest.json version should be 2.1.0');
});

test('sync: idempotent (re-run = no diff)', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0'); // all already at 2.1.0

  const sha1_plugin = sha256(path.join(dir, '.claude-plugin', 'plugin.json'));
  const sha1_pkg = sha256(path.join(dir, 'package.json'));
  const sha1_core = sha256(path.join(dir, 'core', 'manifest.json'));

  syncVersions({ repoRoot: dir }); // re-run

  const sha2_plugin = sha256(path.join(dir, '.claude-plugin', 'plugin.json'));
  const sha2_pkg = sha256(path.join(dir, 'package.json'));
  const sha2_core = sha256(path.join(dir, 'core', 'manifest.json'));

  assert.strictEqual(sha1_plugin, sha2_plugin, 'plugin.json should be byte-identical after idempotent sync');
  assert.strictEqual(sha1_pkg, sha2_pkg, 'package.json should be byte-identical');
  assert.strictEqual(sha1_core, sha2_core, 'core/manifest.json should be byte-identical');
});

test('check: all match → no drift detected', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0'); // all in sync

  const result = checkDrift({ repoRoot: dir });

  assert.ok(result.ok, 'checkDrift should return ok=true when all match');
  assert.strictEqual(result.drifted.length, 0, 'no drifted files');
});

test('check: plugin.json drift → drift detected with clear error message', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0', { pluginVersion: '1.9.9' });

  const result = checkDrift({ repoRoot: dir });

  assert.ok(!result.ok, 'checkDrift should return ok=false when drift detected');
  assert.ok(result.drifted.length > 0, 'should report drifted files');
  assert.ok(result.drifted.some(d => d.file.includes('plugin.json')),
    'plugin.json should be in drifted list');
  assert.ok(result.message, 'should provide a message');
});

test('check: package.json drift → drift detected', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0', { packageVersion: '2.0.0' });

  const result = checkDrift({ repoRoot: dir });

  assert.ok(!result.ok, 'checkDrift should return ok=false');
  assert.ok(result.drifted.some(d => d.file.includes('package.json')),
    'package.json should be in drifted list');
});

test('check: core/manifest.json drift → drift detected', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0', { coreVersion: '0.1.0' });

  const result = checkDrift({ repoRoot: dir });

  assert.ok(!result.ok, 'checkDrift should return ok=false');
  assert.ok(result.drifted.some(d => d.file.includes('manifest.json')),
    'core/manifest.json should be in drifted list');
});

test('CLI --help: exits 0 with usage output and zero file mutations (purity check)', () => {
  // This test will FAIL before the --help early-exit patch because running --help
  // currently invokes syncVersions() which mutates manifest files.
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0', {
    pluginVersion: '1.0.0', // intentional drift — so sync would actually mutate
    packageVersion: '1.0.0',
    coreVersion: '1.0.0'
  });

  const pluginFile = path.join(dir, '.claude-plugin', 'plugin.json');
  const pkgFile = path.join(dir, 'package.json');
  const coreFile = path.join(dir, 'core', 'manifest.json');
  const versionFile = path.join(dir, 'VERSION');

  // Capture pre-run shasums
  const pre = {
    plugin: sha256(pluginFile),
    pkg: sha256(pkgFile),
    core: sha256(coreFile),
    version: sha256(versionFile),
  };

  // Run with --help using the actual CLI entry point
  const syncScript = path.join(__dirname, '..', 'version-sync.cjs');
  const result = spawnSync(process.execPath, [syncScript, '--help'], {
    cwd: dir,
    env: Object.assign({}, process.env),
    timeout: 5000,
  });

  // Must exit 0
  assert.strictEqual(result.status, 0, `--help must exit 0, got ${result.status}. stderr: ${result.stderr}`);

  // Must print usage block
  const stdout = result.stdout.toString();
  assert.ok(stdout.includes('--help'), `--help output should include "--help", got: ${stdout}`);
  assert.ok(stdout.includes('--check'), `--help output should include "--check", got: ${stdout}`);

  // Capture post-run shasums — must be byte-identical
  const post = {
    plugin: sha256(pluginFile),
    pkg: sha256(pkgFile),
    core: sha256(coreFile),
    version: sha256(versionFile),
  };

  assert.strictEqual(pre.plugin, post.plugin, 'plugin.json must be byte-identical after --help');
  assert.strictEqual(pre.pkg, post.pkg, 'package.json must be byte-identical after --help');
  assert.strictEqual(pre.core, post.core, 'core/manifest.json must be byte-identical after --help');
  assert.strictEqual(pre.version, post.version, 'VERSION must be byte-identical after --help');
});

test('CLI -h: exits 0 with usage output (alias check)', () => {
  const dir = mkTmpDir();
  createRepoFixture(dir, '2.1.0', {
    pluginVersion: '1.0.0',
    packageVersion: '1.0.0',
    coreVersion: '1.0.0'
  });

  const syncScript = path.join(__dirname, '..', 'version-sync.cjs');
  const result = spawnSync(process.execPath, [syncScript, '-h'], {
    cwd: dir,
    env: Object.assign({}, process.env),
    timeout: 5000,
  });

  assert.strictEqual(result.status, 0, `-h must exit 0, got ${result.status}. stderr: ${result.stderr}`);

  const stdout = result.stdout.toString();
  assert.ok(stdout.includes('--help'), `-h output should include "--help", got: ${stdout}`);
});
