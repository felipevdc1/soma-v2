'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installProject: defaultInstaller, validateInstallState } = require('../install.cjs');
const { parseAnchorAttrs, computeBlockSha256 } = require('../lib/anchored-blocks.cjs');
const { readGitFacts } = require('./git-readonly.cjs');

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
  for (let index = 0; index < lines.length; index += 1) {
    const attrs = parseAnchorAttrs(lines[index]);
    if (!attrs || !attrs.sha256) continue;
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
  return true;
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

function inspectAdoption(resolution) {
  const projectRoot = canonicalDirectory(resolution.projectRoot);
  const scope = canonicalDirectory(resolution.scope || projectRoot);
  const facts = { ...readGitFacts(projectRoot), testCommands: detectTestCommands(scope) };
  return { ...inspectInstall(projectRoot), projectRoot, scope, facts };
}

function writeAdoption(projectRoot, value) {
  const somaDir = path.join(projectRoot, '.soma');
  const destination = path.join(somaDir, 'adoption.json');
  const temp = path.join(somaDir, `.adoption.json.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, destination);
  } finally {
    fs.rmSync(temp, { force: true });
  }
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

  let exitCode;
  try {
    exitCode = installer(before.projectRoot, {
      tool: 'claude', mergeClaudioMd: true, replaceClaudioMd: false, silent: true,
    });
  } catch (error) {
    return blocked(before, `${error.code || 'INSTALL_FAILED'}: ${error.message}`);
  }
  if (exitCode !== 0) return blocked(before, `SOMA installer exited ${exitCode}`);

  const after = inspectAdoption({ projectRoot: before.projectRoot, scope: before.scope });
  if (after.kind !== 'installed') return blocked(after, after.diagnostic || 'Installer did not produce a complete installation');
  writeAdoption(before.projectRoot, {
    $schema: 'soma-adoption/v1',
    adoptedAt: new Date().toISOString(),
    projectRoot: before.projectRoot,
    scope: before.scope,
    facts: before.facts,
  });
  return {
    status: 'READY', adopted: true, baselineRequired: true,
    projectRoot: before.projectRoot, scope: before.scope, facts: before.facts,
  };
}

module.exports = { detectTestCommands, inspectAdoption, adoptProject };
