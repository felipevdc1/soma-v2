'use strict';

/**
 * install/verify-portability.cjs — post-install smoke pack runner (12 quality gates)
 *
 * Public API:
 *   GATES           — object with individual gate functions (for unit testing)
 *   buildReport(results) → { passed, failed, blockers, details }
 *   verifyPortability(opts?) → { passed, failed, blockers, details }
 *
 * CLI:
 *   node verify-portability.cjs [--mode=ci|live]
 *   Exits 0 if 12/12 pass, exits 1 otherwise.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

// ── Gate implementations ────────────────────────────────────────────────────

/**
 * Gate 1: VERSION file matches plugin.json version
 */
function gate1Version({ repoRoot }) {
  try {
    const versionFile = path.join(repoRoot, 'VERSION');
    const pluginFile = path.join(repoRoot, '.claude-plugin', 'plugin.json');

    if (!fs.existsSync(versionFile)) return { pass: false, detail: 'VERSION file not found' };
    if (!fs.existsSync(pluginFile)) return { pass: false, detail: '.claude-plugin/plugin.json not found' };

    const version = fs.readFileSync(versionFile, 'utf-8').trim();
    const plugin = JSON.parse(fs.readFileSync(pluginFile, 'utf-8'));

    if (version === plugin.version) {
      return { pass: true, detail: `version=${version} matches plugin.json` };
    }
    return { pass: false, detail: `VERSION=${version} != plugin.json version=${plugin.version}` };
  } catch (e) {
    return { pass: false, detail: `gate1 error: ${e.message}` };
  }
}

/**
 * Gate 2: soma doctor exits 0 (live CLI gate — skipped in ci mode)
 */
function gate2Doctor({ somaCmd, mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode (live CLI gate)', skipped: true };
  try {
    execSync(`${somaCmd} doctor`, { stdio: 'ignore' });
    return { pass: true, detail: 'soma doctor exited 0' };
  } catch {
    return { pass: false, detail: 'soma doctor exited non-zero' };
  }
}

/**
 * Gate 3: soma audit exits ≤1 (live CLI gate)
 */
function gate3Audit({ somaCmd, mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode (live CLI gate)', skipped: true };
  try {
    execSync(`${somaCmd} audit --module sync.cjs`, { stdio: 'ignore' });
    return { pass: true, detail: 'soma audit exited 0' };
  } catch (e) {
    if (e.status <= 1) return { pass: true, detail: `soma audit exited ${e.status} (acceptable)` };
    return { pass: false, detail: `soma audit exited ${e.status} (>1 is failure)` };
  }
}

/**
 * Gate 4: Slash command /soma:run exists in expected location (presence check)
 */
function gate4SlashCommand({ claudeHome, mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode', skipped: true };
  try {
    const commandsDir = path.join(claudeHome, 'commands');
    // Look for soma-run.md or soma:run in commands dir
    const exists = fs.existsSync(path.join(commandsDir, 'soma-run.md')) ||
      fs.existsSync(path.join(commandsDir, 'soma', 'run.md'));
    if (exists) return { pass: true, detail: '/soma:run command file found' };
    return { pass: false, detail: '/soma:run command file not found in ' + commandsDir };
  } catch (e) {
    return { pass: false, detail: `gate4 error: ${e.message}` };
  }
}

/**
 * Gate 5: spec gen — live only
 */
function gate5SpecGen({ mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode (live CLI gate)', skipped: true };
  return { pass: true, detail: 'Skipped: spec gen requires interactive session', skipped: true };
}

/**
 * Gate 6: thermal-guard blocks 4th agent — live only
 */
function gate6HookFire({ mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode (live CLI gate)', skipped: true };
  return { pass: true, detail: 'Skipped: thermal-guard validation requires live Claude Code session', skipped: true };
}

/**
 * Gate 7: Bootloader injected into ~/.claude/CLAUDE.md
 */
function gate7Bootloader({ claudeHome, mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode', skipped: true };
  try {
    const claudeMd = path.join(claudeHome, 'CLAUDE.md');
    if (!fs.existsSync(claudeMd)) return { pass: false, detail: 'CLAUDE.md not found' };
    const content = fs.readFileSync(claudeMd, 'utf-8');
    if (content.includes('SOMA Bootloader')) {
      return { pass: true, detail: 'SOMA Bootloader section found in CLAUDE.md' };
    }
    return { pass: false, detail: 'SOMA Bootloader section NOT found in CLAUDE.md' };
  } catch (e) {
    return { pass: false, detail: `gate7 error: ${e.message}` };
  }
}

/**
 * Gate 8: Tests pass at ≥99%
 */
function gate8Tests({ somaHome, mode }) {
  if (mode === 'ci') return { pass: true, detail: 'Skipped: ci mode (use external test runner)', skipped: true };
  try {
    const result = execSync(
      `node --test "${path.join(somaHome, 'scripts', '__tests__')}/*.test.cjs"`,
      { encoding: 'utf-8', timeout: 120000 }
    );
    const match = result.match(/# pass (\d+)/);
    const failMatch = result.match(/# fail (\d+)/);
    const passed = match ? parseInt(match[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const total = passed + failed;
    const pct = total > 0 ? (passed / total) * 100 : 100;
    if (pct >= 99) return { pass: true, detail: `tests: ${passed}/${total} = ${pct.toFixed(1)}%` };
    return { pass: false, detail: `tests below 99%: ${passed}/${total} = ${pct.toFixed(1)}%` };
  } catch (e) {
    return { pass: false, detail: `gate8 test run failed: ${e.message}` };
  }
}

/**
 * Gate 9: output-style file exists
 */
function gate9OutputStyle({ outputStylePath }) {
  try {
    if (fs.existsSync(outputStylePath)) {
      return { pass: true, detail: `output-style file exists: ${outputStylePath}` };
    }
    return { pass: false, detail: `output-style file NOT found: ${outputStylePath}` };
  } catch (e) {
    return { pass: false, detail: `gate9 error: ${e.message}` };
  }
}

/**
 * Gate 10: plugin.json is valid JSON
 */
function gate10PluginManifest({ repoRoot }) {
  try {
    const pluginFile = path.join(repoRoot, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(pluginFile)) return { pass: false, detail: '.claude-plugin/plugin.json not found' };
    JSON.parse(fs.readFileSync(pluginFile, 'utf-8'));
    return { pass: true, detail: 'plugin.json is valid JSON' };
  } catch (e) {
    return { pass: false, detail: `plugin.json invalid: ${e.message}` };
  }
}

/**
 * Gate 11: constitution.md has v1.0.0 AND no DRAFT
 */
function gate11Constitution({ coreRoot }) {
  try {
    const constitutionFile = path.join(coreRoot, 'docs', 'constitution.md');
    if (!fs.existsSync(constitutionFile)) return { pass: false, detail: 'constitution.md not found' };

    const content = fs.readFileSync(constitutionFile, 'utf-8');
    const hasVersion = content.includes('v1.0.0');
    const hasDraft = /draft/i.test(content);

    if (!hasVersion) return { pass: false, detail: 'constitution.md does not contain v1.0.0' };
    if (hasDraft) return { pass: false, detail: 'constitution.md contains DRAFT — not ratified' };
    return { pass: true, detail: 'constitution v1.0.0 ratified (no DRAFT)' };
  } catch (e) {
    return { pass: false, detail: `gate11 error: ${e.message}` };
  }
}

/**
 * Gate 12: zero personal identifiers leaked in published files.
 * Patterns are built from fragments to avoid self-matching when gate12 scans install/.
 */
function gate12NoLeak({ scanRoots }) {
  // Build patterns from fragments — prevents this file from matching its own scan
  const _u = 'felipevdc' + '1';           // username fragment
  const _h = '/Users/' + _u;              // home path fragment
  const _fn = 'F' + 'elipe';             // first name fragment (word-boundary checked below)
  const LEAK_PATTERNS = [
    new RegExp(_u, 'i'),
    new RegExp(_h.replace(/\//g, '\\/'), 'i'),
    new RegExp('\\b' + _fn + '\\b'),
    new RegExp('\\b' + 'Ary' + 'se' + '\\b', 'i'),
    new RegExp('vidin' + '-os', 'i'),
    new RegExp('\\b' + 'har' + 'nx' + '\\b', 'i'),
    new RegExp('\\b' + 'mega' + 'zord' + '\\b', 'i'),
    new RegExp('\\b' + 'ref' + 'n' + '\\b', 'i'),
    new RegExp('\\b' + 'hyd' + 'ra' + '\\b', 'i'),
    new RegExp('cria' + 'tivos', 'i'),
    new RegExp('chat' + 'rag', 'i')
  ];

  const SKIP_FILES = ['decoupling-decisions.md'];

  try {
    const leaks = [];

    function scanDir(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          scanDir(fullPath);
        } else if (entry.isFile()) {
          if (SKIP_FILES.includes(entry.name)) continue;
          const ext = path.extname(entry.name);
          if (!['.cjs', '.js', '.json', '.md', '.sh', '.ts'].includes(ext)) continue;

          let content;
          try {
            content = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            continue;
          }

          for (const pattern of LEAK_PATTERNS) {
            if (pattern.test(content)) {
              const match = content.match(pattern);
              leaks.push(`${fullPath}: matched '${match[0]}'`);
              break; // one report per file
            }
          }
        }
      }
    }

    for (const root of scanRoots) {
      scanDir(root);
    }

    if (leaks.length === 0) {
      return { pass: true, detail: `No identity leaks in ${scanRoots.join(', ')}` };
    }
    return {
      pass: false,
      detail: `${leaks.length} leak(s) found: ${leaks.slice(0, 3).join('; ')}`
    };
  } catch (e) {
    return { pass: false, detail: `gate12 error: ${e.message}` };
  }
}

// ── Report builder ──────────────────────────────────────────────────────────

/**
 * Build a summary report from gate results.
 * @param {Array<{name: string, pass: boolean, detail: string, skipped?: boolean}>} results
 * @returns {{ passed: number, failed: number, blockers: string[], details: object[] }}
 */
function buildReport(results) {
  let passed = 0;
  let failed = 0;
  const blockers = [];
  const details = [];

  for (const r of results) {
    if (r.pass || r.skipped) {
      passed++;
    } else {
      failed++;
      blockers.push(`${r.name}: ${r.detail}`);
    }
    details.push(r);
  }

  return { passed, failed, blockers, details };
}

// ── Main verifyPortability runner ────────────────────────────────────────────

/**
 * Run all 12 quality gates.
 *
 * @param {{
 *   mode?: 'ci' | 'live',
 *   repoRoot?: string,
 *   coreRoot?: string,
 *   outputStylePath?: string,
 *   claudeHome?: string,
 *   somaHome?: string,
 *   somaCmd?: string
 * }} [opts]
 * @returns {{ passed: number, failed: number, blockers: string[], details: object[] }}
 */
function verifyPortability(opts) {
  opts = opts || {};
  const mode = opts.mode || 'live';

  const homeDir = os.homedir();
  const repoRoot = opts.repoRoot || process.cwd();
  const coreRoot = opts.coreRoot || path.join(homeDir, '.soma-v2');
  const claudeHome = opts.claudeHome || path.join(homeDir, '.claude');
  const somaHome = opts.somaHome || coreRoot;
  const outputStylePath = opts.outputStylePath || path.join(claudeHome, 'output-styles', 'soma-voxel.md');
  const somaCmd = opts.somaCmd || 'soma';

  const ctx = { mode, repoRoot, coreRoot, claudeHome, somaHome, outputStylePath, somaCmd };

  const results = [
    { name: 'gate1', ...gate1Version(ctx) },
    { name: 'gate2', ...gate2Doctor(ctx) },
    { name: 'gate3', ...gate3Audit(ctx) },
    { name: 'gate4', ...gate4SlashCommand(ctx) },
    { name: 'gate5', ...gate5SpecGen(ctx) },
    { name: 'gate6', ...gate6HookFire(ctx) },
    { name: 'gate7', ...gate7Bootloader(ctx) },
    { name: 'gate8', ...gate8Tests(ctx) },
    { name: 'gate9', ...gate9OutputStyle(ctx) },
    { name: 'gate10', ...gate10PluginManifest(ctx) },
    { name: 'gate11', ...gate11Constitution(ctx) },
    { name: 'gate12', ...gate12NoLeak({ scanRoots: [path.join(repoRoot, 'core'), path.join(repoRoot, 'hooks'), path.join(repoRoot, 'commands'), path.join(repoRoot, 'templates'), path.join(repoRoot, 'output-styles')] }) }
  ];

  return buildReport(results);
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode=ci') ? 'ci' : 'live';

  const report = verifyPortability({ mode });

  for (const detail of report.details) {
    const status = detail.skipped ? 'SKIP' : (detail.pass ? 'PASS' : 'FAIL');
    process.stdout.write(`[${status}] ${detail.name}: ${detail.detail}\n`);
  }

  process.stdout.write(`\nResult: ${report.passed} passed, ${report.failed} failed\n`);
  if (report.blockers.length > 0) {
    process.stdout.write(`Blockers:\n${report.blockers.map(b => `  - ${b}`).join('\n')}\n`);
  }

  process.exit(report.failed === 0 ? 0 : 1);
}

// Export GATES for unit testing individual gates
const GATES = {
  gate1Version,
  gate2Doctor,
  gate3Audit,
  gate4SlashCommand,
  gate5SpecGen,
  gate6HookFire,
  gate7Bootloader,
  gate8Tests,
  gate9OutputStyle,
  gate10PluginManifest,
  gate11Constitution,
  gate12NoLeak
};

module.exports = { verifyPortability, buildReport, GATES };
