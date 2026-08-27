'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installProject: defaultInstaller, validateInstallState } = require('../install.cjs');
const { parseAnchorAttrs, computeBlockSha256 } = require('../lib/anchored-blocks.cjs');
const { readGitFacts } = require('./git-readonly.cjs');

const ADOPTION_SCHEMA = 'soma-adoption/v1';
const PENDING_ADOPTION_FILE = '.soma-adoption.pending.json';

function canonicalDirectory(value) {
  return fs.realpathSync(value);
}

function detectTestCommands(scope) {
  const packagePath = path.join(scope, 'package.json');
  let scripts = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (pkg && pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) scripts = pkg.scripts;
  } catch (_) {}
  return Object.keys(scripts)
    .filter(name => name === 'test' || name.startsWith('test:'))
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
    .map(name => ({ name, argv: ['npm', 'run', name] }));
}

function anchorIsIntact(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return false;
  }
  if (!content.includes('<!-- soma-v2:start')) return false;
  const lines = content.split('\n');
  let anchoredMarkers = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('<!-- soma-v2:start')) continue;
    const attrs = parseAnchorAttrs(lines[index]);
    if (!attrs || !attrs.sha256) return false;
    anchoredMarkers += 1;
    const escaped = attrs.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const end = new RegExp(`<!--\\s*soma-v2:end\\s+id=${escaped}\\s*-->`);
    const body = [];
    let cursor = index + 1;
    while (cursor < lines.length && !end.test(lines[cursor])) {
      body.push(lines[cursor]);
      cursor += 1;
    }
    if (cursor >= lines.length || computeBlockSha256(body.join('\n')) !== attrs.sha256) return false;
    index = cursor;
  }
  return anchoredMarkers > 0;
}

function inspectInstall(projectRoot) {
  const somaDir = path.join(projectRoot, '.soma');
  if (!fs.existsSync(somaDir)) return { kind: 'adoptable', reason: 'soma-absent' };
  let somaStat;
  try {
    somaStat = fs.statSync(somaDir);
  } catch (_) {
    return { kind: 'blocked', diagnostic: 'Unable to inspect .soma' };
  }
  if (!somaStat.isDirectory()) return { kind: 'blocked', diagnostic: '.soma is not a directory' };
  const statePath = path.join(somaDir, 'install-state.json');
  if (!fs.existsSync(statePath)) return { kind: 'blocked', diagnostic: '.soma exists without install-state.json' };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    validateInstallState(state);
  } catch (error) {
    return { kind: 'blocked', diagnostic: `install-state.json is corrupt: ${error.message}` };
  }
  if (state.status !== 'complete') {
    return { kind: 'blocked', diagnostic: `SOMA install state is ${state.status}` };
  }
  const targets = [];
  if (state.harness === 'claude' || state.harness === 'both') targets.push(path.join(projectRoot, 'CLAUDE.md'));
  if (state.harness === 'codex' || state.harness === 'both') targets.push(path.join(projectRoot, 'AGENTS.md'));
  if (targets.length === 0 || !targets.every(anchorIsIntact)) {
    return { kind: 'blocked', diagnostic: 'Installed SOMA bootloader is missing or drifted' };
  }
  return { kind: 'installed', state };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function validateAdoptionRecord(value, expected) {
  if (!hasExactKeys(value, ['$schema', 'adoptedAt', 'projectRoot', 'scope', 'facts'])) {
    throw new Error('expected exactly $schema, adoptedAt, projectRoot, scope, and facts');
  }
  if (value.$schema !== ADOPTION_SCHEMA) throw new Error(`expected $schema ${ADOPTION_SCHEMA}`);
  if (typeof value.adoptedAt !== 'string'
    || Number.isNaN(Date.parse(value.adoptedAt))
    || new Date(value.adoptedAt).toISOString() !== value.adoptedAt) {
    throw new Error('adoptedAt must be an ISO-8601 timestamp');
  }
  if (value.projectRoot !== expected.projectRoot) throw new Error('projectRoot does not match this project');
  if (value.scope !== expected.scope) throw new Error('scope does not match the requested scope');
  if (!hasExactKeys(value.facts, ['head', 'branch', 'dirtyPaths', 'testCommands'])) {
    throw new Error('facts has an invalid structure');
  }
  if (!(value.facts.head === null || typeof value.facts.head === 'string')) {
    throw new Error('facts.head must be a string or null');
  }
  if (!(value.facts.branch === null || typeof value.facts.branch === 'string')) {
    throw new Error('facts.branch must be a string or null');
  }
  if (!Array.isArray(value.facts.dirtyPaths)
    || !value.facts.dirtyPaths.every(item => typeof item === 'string')) {
    throw new Error('facts.dirtyPaths must contain strings');
  }
  if (!Array.isArray(value.facts.testCommands)
    || !value.facts.testCommands.every(command => hasExactKeys(command, ['name', 'argv'])
      && typeof command.name === 'string'
      && Array.isArray(command.argv)
      && command.argv.length === 3
      && command.argv[0] === 'npm'
      && command.argv[1] === 'run'
      && command.argv[2] === command.name)) {
    throw new Error('facts.testCommands has an invalid structure');
  }
}

function pathEntryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function readAdoptionRecord(filePath, expected) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    validateAdoptionRecord(value, expected);
  } catch (error) {
    return { valid: false, diagnostic: `Adoption metadata is corrupt: ${error.message}` };
  }
  return { valid: true, value };
}

function inspectAdoption(resolution) {
  const projectRoot = canonicalDirectory(resolution.projectRoot);
  const scope = canonicalDirectory(resolution.scope || projectRoot);
  const expected = { projectRoot, scope };
  const pendingPath = path.join(projectRoot, PENDING_ADOPTION_FILE);
  if (pathEntryExists(pendingPath)) {
    return {
      kind: 'blocked', diagnostic: 'A pending adoption record marks an interrupted adoption',
      projectRoot, scope,
    };
  }
  const adoptionPath = path.join(projectRoot, '.soma', 'adoption.json');
  if (pathEntryExists(adoptionPath)) {
    const adoption = readAdoptionRecord(adoptionPath, expected);
    if (!adoption.valid) return { kind: 'blocked', diagnostic: adoption.diagnostic, projectRoot, scope };
  }
  const facts = { ...readGitFacts(projectRoot), testCommands: detectTestCommands(scope) };
  return { ...inspectInstall(projectRoot), projectRoot, scope, facts };
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePendingAdoption(projectRoot, value) {
  const destination = path.join(projectRoot, PENDING_ADOPTION_FILE);
  const temp = path.join(projectRoot, `.${PENDING_ADOPTION_FILE}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temp, destination);
    fs.rmSync(temp);
    syncDirectory(projectRoot);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temp, { force: true });
  }
  return destination;
}

function promotePendingAdoption(projectRoot, pendingPath) {
  const destination = path.join(projectRoot, '.soma', 'adoption.json');
  fs.renameSync(pendingPath, destination);
  syncDirectory(path.dirname(destination));
  syncDirectory(projectRoot);
  return destination;
}

function blocked(inspection, diagnostic = inspection.diagnostic) {
  return {
    status: 'ADOPTION_BLOCKED', diagnostic,
    projectRoot: inspection.projectRoot, scope: inspection.scope,
    retrySafe: false,
  };
}

function adoptProject(resolution, options = {}) {
  const installer = options.installer || defaultInstaller;
  const before = inspectAdoption(resolution);
  if (before.kind === 'blocked') return blocked(before);
  if (before.kind === 'installed') {
    return {
      status: 'READY', adopted: false, baselineRequired: false,
      projectRoot: before.projectRoot, scope: before.scope, facts: before.facts,
    };
  }

  const adoption = {
    $schema: ADOPTION_SCHEMA,
    adoptedAt: new Date().toISOString(),
    projectRoot: before.projectRoot,
    scope: before.scope,
    facts: before.facts,
  };
  let pendingPath;
  try {
    pendingPath = writePendingAdoption(before.projectRoot, adoption);
  } catch (error) {
    return blocked(before, `ADOPTION_RECORD_FAILED: ${error.message}`);
  }

  let exitCode;
  try {
    exitCode = installer(before.projectRoot, {
      tool: 'claude', mergeClaudioMd: true, replaceClaudioMd: false, silent: true,
    });
  } catch (error) {
    return blocked(before, `${error.code || 'INSTALL_FAILED'}: ${error.message}`);
  }
  if (exitCode !== 0) return blocked(before, `SOMA installer exited ${exitCode}`);

  const afterInstall = inspectInstall(before.projectRoot);
  if (afterInstall.kind !== 'installed') {
    return blocked(before, afterInstall.diagnostic || 'Installer did not produce a complete installation');
  }
  try {
    promotePendingAdoption(before.projectRoot, pendingPath);
  } catch (error) {
    return blocked(before, `ADOPTION_RECORD_FAILED: ${error.message}`);
  }
  return {
    status: 'READY', adopted: true, baselineRequired: true,
    projectRoot: before.projectRoot, scope: before.scope, facts: before.facts,
  };
}

module.exports = { detectTestCommands, inspectAdoption, adoptProject };
