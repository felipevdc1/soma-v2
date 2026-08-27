'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitRoot } = require('./git-readonly.cjs');

const PROJECT_MARKERS = new Set([
  '.git', '.soma', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
  'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
]);

function projectError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalDirectory(input) {
  try {
    const canonical = fs.realpathSync(input);
    if (!fs.statSync(canonical).isDirectory()) return null;
    return canonical;
  } catch (_) {
    return null;
  }
}

function packageWorkspaces(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  let patterns = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (Array.isArray(pkg.workspaces)) patterns = pkg.workspaces;
    else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) patterns = pkg.workspaces.packages;
  } catch (_) {
    return [];
  }

  const roots = [];
  for (const patternValue of patterns) {
    if (typeof patternValue !== 'string' || patternValue.length === 0 || path.isAbsolute(patternValue)) continue;
    const pattern = patternValue.replace(/\/$/, '');
    if (!pattern.includes('*')) {
      const candidate = canonicalDirectory(path.join(repoRoot, pattern));
      if (candidate && contained(repoRoot, candidate)) roots.push(candidate);
      continue;
    }
    if (!pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) continue;
    const parent = canonicalDirectory(path.join(repoRoot, pattern.slice(0, -2)));
    if (!parent || !contained(repoRoot, parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = canonicalDirectory(path.join(parent, entry.name));
      if (candidate && contained(repoRoot, candidate)) roots.push(candidate);
    }
  }
  return [...new Set(roots)].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function classifyNonGit(candidate, explicit) {
  const entries = fs.readdirSync(candidate);
  if (entries.length === 0) {
    if (!explicit) throw projectError('PROJECT_UNRESOLVED', 'Empty non-Git directory requires an explicit --project path');
    return 'explicit-empty';
  }
  if (entries.some(entry => PROJECT_MARKERS.has(entry))) return explicit ? 'explicit' : 'cwd-marker';
  throw projectError('PROJECT_UNRESOLVED', 'Non-Git directory is non-empty and has no recognized project marker');
}

function resolveProject(options = {}) {
  const cwd = canonicalDirectory(options.cwd || process.cwd());
  if (!cwd) throw projectError('PROJECT_UNRESOLVED', 'Current directory is unavailable');
  const home = canonicalDirectory(options.home || os.homedir());
  const explicit = typeof options.project === 'string' && options.project.length > 0;
  const rawCandidate = explicit
    ? (path.isAbsolute(options.project) ? options.project : path.resolve(cwd, options.project))
    : cwd;
  const candidate = canonicalDirectory(rawCandidate);
  if (!candidate) throw projectError('PROJECT_UNRESOLVED', 'Project path does not exist or is not a directory');
  if (candidate === path.parse(candidate).root || (home && candidate === home)) {
    throw projectError('PROJECT_UNRESOLVED', 'Filesystem root and user home cannot be projects');
  }

  const cwdRepo = gitRoot(cwd);
  const lexicalParent = canonicalDirectory(path.dirname(path.resolve(rawCandidate)));
  const lexicalRepo = lexicalParent ? gitRoot(lexicalParent) : null;
  if (explicit && (cwdRepo || lexicalRepo)) {
    const enclosingRepo = canonicalDirectory(lexicalRepo || cwdRepo);
    const lexicalAbsolute = lexicalParent
      ? path.join(lexicalParent, path.basename(path.resolve(rawCandidate)))
      : path.resolve(rawCandidate);
    if (enclosingRepo && contained(enclosingRepo, lexicalAbsolute) && !contained(enclosingRepo, candidate)) {
      throw projectError('PROJECT_SCOPE_INVALID', 'Project path escapes its repository through a symlink');
    }
    if (!path.isAbsolute(options.project) && cwdRepo && (!enclosingRepo || !contained(canonicalDirectory(cwdRepo), candidate))) {
      throw projectError('PROJECT_SCOPE_INVALID', 'Relative project path escapes the current repository');
    }
  }

  const detectedRoot = gitRoot(candidate);
  if (!detectedRoot) {
    const source = classifyNonGit(candidate, explicit);
    return { projectRoot: candidate, scope: candidate, source };
  }

  const projectRoot = canonicalDirectory(detectedRoot);
  if (!projectRoot || !contained(projectRoot, candidate)) {
    throw projectError('PROJECT_SCOPE_INVALID', 'Resolved project scope escapes its Git repository');
  }
  const workspaces = packageWorkspaces(projectRoot);
  let scope = projectRoot;
  if (workspaces.length > 0) {
    if (candidate === projectRoot) {
      if (!explicit && workspaces.length > 1) {
        throw projectError('PROJECT_AMBIGUOUS', 'Monorepo has multiple declared workspaces; select one with --project');
      }
    } else {
      const workspace = workspaces.find(item => contained(item, candidate));
      if (!workspace || (explicit && candidate !== workspace)) {
        throw projectError('PROJECT_SCOPE_INVALID', 'Nested monorepo scope must be a declared workspace');
      }
      scope = workspace;
    }
  } else if (candidate !== projectRoot && explicit) {
    throw projectError('PROJECT_SCOPE_INVALID', 'Nested project scope is not declared by the repository');
  }

  return { projectRoot, scope, source: explicit ? 'explicit' : 'git-cwd' };
}

module.exports = { PROJECT_MARKERS, contained, packageWorkspaces, resolveProject };
