'use strict';
// audit-deterministic.cjs — SOMA audit deterministic layer (Spec 012 T-04)
// @spec AC-01, AC-03, AC-04

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * Extract the top-level comment block from source (lines until first non-comment line).
 * Per AC-15 / Q6: only header comment allowed in prompt.
 */
function extractHeaderComment(src) {
  const lines = src.split('\n');
  const commentLines = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed === '') {
      commentLines.push(line);
      if (trimmed.startsWith('/*')) inBlock = true;
      if (trimmed.includes('*/')) inBlock = false;
    } else if (inBlock) {
      commentLines.push(line);
    } else {
      // First non-comment, non-empty line — stop
      if (commentLines.length > 0) break;
      // Skip shebang/use-strict
      if (trimmed.startsWith('#!') || trimmed === "'use strict';" || trimmed === '"use strict";') {
        commentLines.push(line);
      } else {
        break;
      }
    }
  }
  return commentLines.join('\n').trim();
}

/**
 * Extract export names from module source via regex.
 * Handles patterns:
 *   module.exports = { a, b, c }
 *   module.exports = { a: fn, b: fn }
 *   exports.foo = ...
 */
function extractExports(src) {
  const exports = [];

  // module.exports = { ... }
  const blockMatch = src.match(/module\.exports\s*=\s*\{([^}]*)\}/s);
  if (blockMatch) {
    const inner = blockMatch[1];
    const names = inner.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b(?:\s*[,:])/g);
    if (names) {
      for (const n of names) {
        const name = n.replace(/[\s:,]/g, '');
        if (name && !exports.includes(name)) exports.push(name);
      }
    }
    // Also handle simple { a, b } destructure list
    const simpleNames = inner.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g);
    if (simpleNames) {
      for (const n of simpleNames) {
        if (!exports.includes(n)) exports.push(n);
      }
    }
  }

  // exports.foo = ...
  const exportsAssigns = src.matchAll(/^exports\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/gm);
  for (const m of exportsAssigns) {
    if (!exports.includes(m[1])) exports.push(m[1]);
  }

  return [...new Set(exports)].filter(Boolean);
}

/**
 * Extract export signatures (function signature only, no body) per AC-15.
 * Looks for: function foo(a, b) { ... } patterns in source.
 */
function extractExportSignatures(src, exportNames) {
  const sigs = [];
  for (const name of exportNames) {
    // Match function declarations: function name(params)
    const fnMatch = src.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)`, ''));
    if (fnMatch) {
      sigs.push(fnMatch[0]);
      continue;
    }
    // Arrow function: const name = (params) =>
    const arrowMatch = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=>`, ''));
    if (arrowMatch) {
      sigs.push(arrowMatch[0]);
    }
  }
  return sigs;
}

/**
 * Get help text if module is a CLI (has process.argv or require.main).
 * Returns null if not CLI or --help fails.
 */
function getHelpText(modulePath) {
  const src = fs.readFileSync(modulePath, 'utf-8');
  const isCli = src.includes('process.argv') || src.includes('require.main');
  if (!isCli) return null;

  const result = spawnSync('node', [modulePath, '--help'], {
    encoding: 'utf-8',
    timeout: 10000,
  });
  // Some CLI tools write help to stdout, others to stderr — capture either
  const helpText = (result.stdout || '').trim() || (result.stderr || '').trim();
  if (helpText) {
    return helpText;
  }
  return null;
}

/**
 * Get recent git commits for a file (last 10).
 * Returns [] with warning if not in git repo.
 */
function getRecentCommits(modulePath) {
  const dir = path.dirname(modulePath);
  const result = spawnSync(
    'git',
    ['log', '-n', '10', '--pretty=format:%H %ai %s', '--', modulePath],
    { encoding: 'utf-8', timeout: 10000, cwd: dir }
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    // Check if it's a git repo at all
    const checkGit = spawnSync('git', ['rev-parse', '--git-dir'], {
      encoding: 'utf-8',
      timeout: 5000,
      cwd: dir,
    });
    if (checkGit.status !== 0) {
      return { commits: [], warning: { code: 'NOT_GIT_REPO', message: `Module directory ${dir} is not a git repository` } };
    }
    return { commits: [], warning: null };
  }

  const commits = result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split(' ');
    const sha = parts[0].slice(0, 7);
    const date = parts[1] ? parts[1].slice(0, 10) : '';
    const subject = parts.slice(3).join(' '); // skip sha, date, time, tz
    return { sha, date, subject };
  });

  return { commits, warning: null };
}

/**
 * Count test files matching *<basename>*.test.cjs in the __tests__ dir of the module's dir.
 */
function countTests(modulePath) {
  const dir = path.dirname(modulePath);
  const base = path.basename(modulePath, '.cjs');

  // Primary: look in <module-dir>/__tests__/ — handles scripts/sync.cjs → scripts/__tests__/
  const testDir = path.join(dir, '__tests__');
  if (fs.existsSync(testDir)) {
    try {
      const files = fs.readdirSync(testDir);
      return files.filter(f => f.includes(base) && f.endsWith('.test.cjs')).length;
    } catch {
      return 0;
    }
  }

  // Fallback: look in lib/../__tests__/ — handles scripts/lib/audit-X.cjs → scripts/__tests__/
  const parentTestDir = path.join(dir, '..', '__tests__');
  if (fs.existsSync(parentTestDir)) {
    try {
      const files = fs.readdirSync(parentTestDir);
      return files.filter(f => f.includes(base) && f.endsWith('.test.cjs')).length;
    } catch {
      return 0;
    }
  }

  return 0;
}

/**
 * collectDeterministic — main entry point for the deterministic layer.
 * @spec AC-01, AC-03, AC-04
 */
function collectDeterministic(modulePath) {
  // AC-04: module path must exist and be a file
  if (!fs.existsSync(modulePath)) {
    return {
      ok: false,
      error: {
        code: 'MODULE_NOT_FOUND',
        message: `Module not found: ${modulePath}`,
        hint: 'Check the path and ensure the file exists',
      },
    };
  }

  const stat = fs.statSync(modulePath);
  if (!stat.isFile()) {
    return {
      ok: false,
      error: {
        code: 'MODULE_NOT_FOUND',
        message: `Path is not a file: ${modulePath}`,
        hint: 'Provide a path to a .cjs file',
      },
    };
  }

  const src = fs.readFileSync(modulePath, 'utf-8');
  const loc = src.split('\n').length;

  const exports = extractExports(src);
  const exportSignatures = extractExportSignatures(src, exports);
  const headerComment = extractHeaderComment(src);
  const { commits: recentCommits, warning: gitWarning } = getRecentCommits(modulePath);
  const testCount = countTests(modulePath);
  const helpText = getHelpText(modulePath);

  const warnings = [];
  if (gitWarning) warnings.push(gitWarning);

  return {
    ok: true,
    module: {
      path: modulePath,
      loc,
      exports,
      export_signatures: exportSignatures,
      header_comment: headerComment,
      recent_commits: recentCommits,
      test_count: testCount,
      help_text: helpText,
    },
    warnings,
  };
}

module.exports = { collectDeterministic, extractExports, extractHeaderComment, extractExportSignatures, getHelpText, getRecentCommits, countTests };
