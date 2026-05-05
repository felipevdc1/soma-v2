'use strict';
/**
 * module-inference.cjs — SOMA v2.1 Phase 4a
 *
 * Module detection heuristics for `soma init --existing`.
 * H2: filesystem-based detection (src/* subdirs, package.json workspaces, framework dirs)
 * H1: git-history-ranked (--deep mode, 90d hardcoded window per NC-2)
 *
 * @spec AC-01,02,03,05,06,11
 * @contract CONTRACT-INIT-EXISTING-01
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Hardcoded blacklist (per spec D-C10+Q2 resolution)
const BLACKLIST = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache']);

// Framework dirs to detect at root when src/ absent (AC-03)
const FRAMEWORK_DIRS = ['app', 'pages', 'components', 'lib', 'api'];

// Hardcoded 90-day window for --deep (NC-2 lock)
const DEEP_WINDOW_DAYS = 90;

/**
 * Load .gitignore patterns from target project (simple line-based parse).
 * Returns a Set of patterns (relative dir/file names — not full glob support for MVP).
 *
 * @param {string} targetPath - project root
 * @returns {Set<string>}
 */
function loadGitignore(targetPath) {
  const gitignorePath = path.join(targetPath, '.gitignore');
  const ignored = new Set();
  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Strip leading slash for simple matching
      ignored.add(trimmed.replace(/^\//, '').replace(/\/$/, ''));
    }
  } catch (err) {
    // No .gitignore — that's fine
  }
  return ignored;
}

/**
 * Check if a directory name should be filtered out.
 * @param {string} name - directory basename
 * @param {Set<string>} gitignored - from loadGitignore()
 * @returns {boolean}
 */
function isBlacklisted(name, gitignored) {
  return BLACKLIST.has(name) || gitignored.has(name);
}

/**
 * Count source files (non-directory entries) recursively in a directory.
 * Stops recursing into blacklisted dirs. Non-blocking for large trees.
 *
 * @param {string} dirPath - absolute path to directory
 * @param {Set<string>} gitignored
 * @returns {number} count of files
 */
function countFiles(dirPath, gitignored) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!isBlacklisted(entry.name, gitignored)) {
          count += countFiles(path.join(dirPath, entry.name), gitignored);
        }
      } else if (entry.isFile()) {
        count++;
      }
    }
  } catch (err) {
    // Permission error or dir vanished — skip
  }
  return count;
}

/**
 * Get the list of relative paths for files in a directory (one level deep for verification.files_checked).
 *
 * @param {string} dirPath - absolute dir path
 * @param {string} relBase - relative base for output paths (e.g. "src/app")
 * @param {Set<string>} gitignored
 * @returns {string[]}
 */
function listFilesShallow(dirPath, relBase, gitignored) {
  const results = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        results.push(path.join(relBase, entry.name));
      } else if (entry.isDirectory() && !isBlacklisted(entry.name, gitignored)) {
        // Recurse one more level to capture immediate subdir files
        const subPath = path.join(dirPath, entry.name);
        const subRel = path.join(relBase, entry.name);
        try {
          const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile()) {
              results.push(path.join(subRel, subEntry.name));
            }
          }
        } catch (err) { /* skip */ }
      }
    }
  } catch (err) { /* skip */ }
  return results;
}

/**
 * H2 heuristic: detect module candidates from filesystem.
 * Priority order per NC-1:
 *   1. src/ subdirs (if src/ exists)
 *   2. package.json#workspaces paths (if no src/)
 *   3. root framework dirs (if no src/ and no workspaces)
 *
 * @param {string} targetPath - project root (absolute)
 * @param {object} [opts]
 * @param {boolean} [opts.verbose] - whether to log rationale
 * @returns {{ name: string, source_path: string, files_count: number, files_checked: string[] }[]}
 */
function detectModulesFilesystem(targetPath, opts = {}) {
  const gitignored = loadGitignore(targetPath);
  const modules = [];

  // Priority 1: src/ exists → only scan src/* subdirs (NC-1 src/-first)
  const srcDir = path.join(targetPath, 'src');
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isBlacklisted(entry.name, gitignored)) continue;
      const absDir = path.join(srcDir, entry.name);
      const filesCount = countFiles(absDir, gitignored);
      if (filesCount < 1) continue; // AC-11: ≥1 file threshold
      const relPath = `src/${entry.name}/`;
      const filesChecked = listFilesShallow(absDir, `src/${entry.name}`, gitignored);
      modules.push({
        name: entry.name,
        source_path: relPath,
        files_count: filesCount,
        files_checked: filesChecked
      });
    }
    return modules;
  }

  // Priority 2: package.json#workspaces (AC-02) — only when no src/
  const pkgJsonPath = path.join(targetPath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch (err) { /* parse error — skip workspaces */ }

    if (pkg && pkg.workspaces && Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) {
      for (const wsPattern of pkg.workspaces) {
        // Expand simple workspace patterns (no glob — just direct paths for MVP)
        // Handle patterns like "packages/*" by reading the dir
        if (wsPattern.endsWith('/*')) {
          const wsDir = path.join(targetPath, wsPattern.slice(0, -2));
          if (fs.existsSync(wsDir) && fs.statSync(wsDir).isDirectory()) {
            const entries = fs.readdirSync(wsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              if (isBlacklisted(entry.name, gitignored)) continue;
              const absDir = path.join(wsDir, entry.name);
              const filesCount = countFiles(absDir, gitignored);
              if (filesCount < 1) continue;
              const relPath = `${wsPattern.slice(0, -2)}/${entry.name}/`;
              const filesChecked = listFilesShallow(absDir, `${wsPattern.slice(0, -2)}/${entry.name}`, gitignored);
              modules.push({
                name: entry.name,
                source_path: relPath,
                files_count: filesCount,
                files_checked: filesChecked
              });
            }
          }
        } else {
          // Direct path workspace like "packages/foo"
          const wsPath = path.join(targetPath, wsPattern);
          if (fs.existsSync(wsPath) && fs.statSync(wsPath).isDirectory()) {
            if (isBlacklisted(path.basename(wsPattern), gitignored)) continue;
            const filesCount = countFiles(wsPath, gitignored);
            if (filesCount < 1) continue;
            const relPath = `${wsPattern}/`;
            const filesChecked = listFilesShallow(wsPath, wsPattern, gitignored);
            modules.push({
              name: path.basename(wsPattern),
              source_path: relPath,
              files_count: filesCount,
              files_checked: filesChecked
            });
          }
        }
      }
      if (modules.length > 0) return modules;
    }
  }

  // Priority 3: root framework dirs (AC-03) — only when no src/ and no workspaces
  for (const dirName of FRAMEWORK_DIRS) {
    if (isBlacklisted(dirName, gitignored)) continue;
    const absDir = path.join(targetPath, dirName);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
    const filesCount = countFiles(absDir, gitignored);
    if (filesCount < 1) continue;
    const relPath = `${dirName}/`;
    const filesChecked = listFilesShallow(absDir, dirName, gitignored);
    modules.push({
      name: dirName,
      source_path: relPath,
      files_count: filesCount,
      files_checked: filesChecked
    });
  }

  return modules;
}

/**
 * H1 heuristic: rank H2 results by git commit count in last 90 days.
 * Returns only modules with ≥1 commit in the window.
 *
 * @param {{ name: string, source_path: string, files_count: number, files_checked: string[] }[]} modules - H2 candidates
 * @param {string} targetPath - project root (must have .git/)
 * @param {number} [windowDays=90] - git history window (hardcoded 90d per NC-2, param for testability)
 * @returns {{ modules: { name: string, source_path: string, files_count: number, files_checked: string[], commit_count_90d: number }[], modules_filtered_out: { name: string, reason: string }[] }}
 */
function rankByGitCommitCount(modules, targetPath, windowDays = DEEP_WINDOW_DAYS) {
  const active = [];
  const filtered = [];

  for (const mod of modules) {
    // Use git log with --since and count lines for commit count per module path
    const modPath = mod.source_path.replace(/\/$/, ''); // strip trailing slash for git
    let commitCount = 0;
    try {
      const gitOut = execSync(
        `git log --since="${windowDays} days ago" --pretty=format:"%H" -- "${modPath}"`,
        { cwd: targetPath, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      // Count non-empty lines = commit hashes
      commitCount = gitOut.split('\n').filter(l => l.trim().length > 0).length;
    } catch (err) {
      // git log failed for this path — treat as 0 commits
      commitCount = 0;
    }

    if (commitCount >= 1) {
      active.push({ ...mod, commit_count_90d: commitCount });
    } else {
      filtered.push({ name: mod.name, reason: `0 commits in ${windowDays}d window` });
    }
  }

  // Sort by commit_count desc
  active.sort((a, b) => b.commit_count_90d - a.commit_count_90d);

  return { modules: active, modules_filtered_out: filtered };
}

/**
 * Check if target path has a readable .git/ directory.
 *
 * @param {string} targetPath
 * @returns {boolean}
 */
function hasGitRepo(targetPath) {
  try {
    const gitPath = path.join(targetPath, '.git');
    return fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory();
  } catch (err) {
    return false;
  }
}

module.exports = {
  detectModulesFilesystem,
  rankByGitCommitCount,
  loadGitignore,
  hasGitRepo,
  DEEP_WINDOW_DAYS
};
