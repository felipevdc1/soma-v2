/**
 * foundation-check.cjs — SOMA v2.1 Phase 4d
 *
 * Foundation primitive: 9-criterion "fundação sólida" verifier (Bruno P6).
 *
 * Single-responsibility: encapsulates the 9 criterion verifiers +
 * orchestration for --foundation-check mode in doctor.cjs.
 *
 * Zero external deps — Node.js stdlib only (fs, path, child_process).
 *
 * @spec AC-01..AC-17, D1-D7
 * @contract CONTRACT-FOUNDATION-CHECK-01
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ---- Constants ----

const VALID_LAYERS = new Set(['roots', 'trunk', 'leaves']);
const FOUNDATION_LAYERS = new Set(['roots', 'trunk']);
const SCHEMA_VERSION = 'soma-foundation-check/v1';

// Bruno P6 D1: zero-tolerance regex patterns for criterion 4
const HARDCODED_PATTERNS = [
  {
    // Credentials: password, secret, api_key, api-key, apikey, token (with value assignment)
    regex: /(password|secret|api[_-]?key|token)\s*[:=]\s*['"]?[\w\-\.]+['"]?/i,
    category: 'credential',
  },
  {
    // Absolute paths: /Users/, /home/, C:\
    regex: /['"](\/Users\/|\/home\/|C:\\)[^\s'"]+/,
    category: 'absolute path',
  },
  {
    // Hardcoded localhost/127 URLs
    regex: /['"]https?:\/\/(localhost|127\.|0\.0\.0\.0)[^\s'"]/,
    category: 'hardcoded URL',
  },
];

// ---- Project.md parser ----

/**
 * Parse .soma/project.md YAML front-matter and return Phase 4d fields.
 * Returns all project fields including legacy-compat fields.
 *
 * @param {string} projectPath - absolute path to project directory
 * @returns {object} parsed fields (foundation_layers, expansion_layers, decisions, tech_stack, commands...)
 */
function parseProjectMd(projectPath) {
  const projectMdPath = path.join(projectPath, '.soma', 'project.md');
  if (!fs.existsSync(projectMdPath)) {
    throw Object.assign(new Error(`Project file not found: ${projectMdPath}`), { code: 'PROJECT_NOT_FOUND' });
  }

  const content = fs.readFileSync(projectMdPath, 'utf8');
  if (!content.startsWith('---\n')) {
    throw Object.assign(new Error('project.md: No front-matter start delimiter'), { code: 'MANIFEST_INVALID' });
  }

  const closingIdx = content.indexOf('\n---\n', 4);
  if (closingIdx === -1) {
    throw Object.assign(new Error('project.md: No front-matter end delimiter'), { code: 'MANIFEST_INVALID' });
  }

  const raw = content.slice(4, closingIdx);
  const result = {
    // New Phase 4d fields
    foundation_layers: null,
    expansion_layers: null,
    decisions: null,
    tech_stack: null,
    test_command: null,
    build_command: null,
    typecheck_command: null,
    lint_command: null,
  };

  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // foundation_layers: ["roots", "trunk"]
    const flMatch = line.match(/^foundation_layers:\s*(.+)/);
    if (flMatch) {
      result.foundation_layers = parseInlineArray(flMatch[1].trim());
      i++; continue;
    }

    // expansion_layers: ["leaves"]
    const elMatch = line.match(/^expansion_layers:\s*(.+)/);
    if (elMatch) {
      result.expansion_layers = parseInlineArray(elMatch[1].trim());
      i++; continue;
    }

    // decisions: ["adr-0001", "adr-0002"]
    const decMatch = line.match(/^decisions:\s*(.+)/);
    if (decMatch) {
      result.decisions = parseInlineArray(decMatch[1].trim());
      i++; continue;
    }

    // tech_stack: [{"name":"...","version":"...","role":"..."}]
    const tsMatch = line.match(/^tech_stack:\s*(.+)/);
    if (tsMatch) {
      const raw = tsMatch[1].trim();
      if (raw === '[]') {
        result.tech_stack = [];
      } else if (raw.startsWith('[')) {
        try {
          result.tech_stack = JSON.parse(raw);
        } catch (e) {
          // Multi-line tech_stack — collect subsequent lines
          let combined = raw;
          i++;
          while (i < lines.length && !lines[i].match(/^[a-z_]+:/)) {
            combined += lines[i].trim();
            i++;
          }
          try { result.tech_stack = JSON.parse(combined); } catch (e2) { result.tech_stack = null; }
          continue;
        }
      }
      i++; continue;
    }

    // test_command: "..."
    const tcMatch = line.match(/^test_command:\s*(.*)/);
    if (tcMatch) {
      result.test_command = parseCommandString(tcMatch[1].trim());
      i++; continue;
    }

    // build_command: "..."
    const bcMatch = line.match(/^build_command:\s*(.*)/);
    if (bcMatch) {
      result.build_command = parseCommandString(bcMatch[1].trim());
      i++; continue;
    }

    // typecheck_command: "..."
    const tccMatch = line.match(/^typecheck_command:\s*(.*)/);
    if (tccMatch) {
      result.typecheck_command = parseCommandString(tccMatch[1].trim());
      i++; continue;
    }

    // lint_command: "..."
    const lcMatch = line.match(/^lint_command:\s*(.*)/);
    if (lcMatch) {
      result.lint_command = parseCommandString(lcMatch[1].trim());
      i++; continue;
    }

    i++;
  }

  return result;
}

/**
 * Parse a YAML inline array like ["a", "b"] or ['a', 'b'] or [a, b]
 * Returns array of strings, or null if input is not array-like.
 */
function parseInlineArray(raw) {
  if (!raw || raw === 'null' || raw === '~') return null;
  if (raw === '[]') return [];
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    // Try JSON parse first
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(x => typeof x === 'string' ? x : String(x));
    } catch (e) {
      // Manual parse: split by comma, strip quotes
      return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    }
  }
  return null;
}

/**
 * Parse a command string from YAML (strip surrounding quotes).
 */
function parseCommandString(raw) {
  if (!raw || raw === 'null' || raw === '~') return null;
  // Strip surrounding single or double quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw || null;
}

// ---- Module layer resolution ----

/**
 * Resolve the layer for a module from .soma/modules/{slug}.md front-matter.
 * Default: 'leaves' if layer field absent.
 *
 * @param {string} projectPath
 * @param {string} slug
 * @returns {string} layer value
 */
function resolveModuleLayer(projectPath, slug) {
  const modulePath = path.join(projectPath, '.soma', 'modules', `${slug}.md`);
  if (!fs.existsSync(modulePath)) {
    return 'leaves'; // default
  }
  const content = fs.readFileSync(modulePath, 'utf8');
  const layerMatch = content.match(/^layer:\s*(\S+)/m);
  if (!layerMatch) return 'leaves'; // default per AC-02
  const layer = layerMatch[1].trim().replace(/["']/g, '');
  return layer; // return raw — caller may validate
}

/**
 * Get all modules in .soma/modules/ for a project.
 * Returns array of { slug, layer, frontMatter } objects.
 */
function listModules(projectPath) {
  const modulesDir = path.join(projectPath, '.soma', 'modules');
  if (!fs.existsSync(modulesDir)) return [];

  let files;
  try {
    files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.md'));
  } catch (e) {
    return [];
  }

  return files.map(file => {
    const slug = path.basename(file, '.md');
    const modulePath = path.join(modulesDir, file);
    const content = fs.readFileSync(modulePath, 'utf8');

    // Parse layer from front-matter
    const layerMatch = content.match(/^layer:\s*(\S+)/m);
    const layer = layerMatch ? layerMatch[1].trim().replace(/["']/g, '') : 'leaves';

    // Parse source_files from front-matter
    const sfMatch = content.match(/^source_files:\s*(.+)/m);
    let sourceFiles = [];
    if (sfMatch) {
      const parsed = parseInlineArray(sfMatch[1].trim());
      if (Array.isArray(parsed)) sourceFiles = parsed;
    }

    return { slug, layer, sourceFiles, content, modulePath };
  });
}

// ---- Command security: injection prevention ----

const SHELL_METACHARACTERS = /[;&|`$<>\n\r]/;

/**
 * Validate and split a command string for safe spawnSync execution.
 * Rejects commands containing shell metacharacters per AD-06 + Security NFR.
 *
 * @param {string} cmd - command string from project.md
 * @returns {{ valid: boolean, argv: string[]|null, error: string|null }}
 */
function validateCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') {
    return { valid: false, argv: null, error: 'Empty or invalid command' };
  }

  if (SHELL_METACHARACTERS.test(cmd)) {
    return {
      valid: false,
      argv: null,
      error: `Command contains shell metacharacters (rejected for security): ${cmd}`
    };
  }

  // Split on whitespace into argv array (basic shell-words without quote handling)
  const argv = cmd.trim().split(/\s+/).filter(Boolean);
  if (argv.length === 0) {
    return { valid: false, argv: null, error: 'Empty command after split' };
  }

  return { valid: true, argv, error: null };
}

/**
 * Run a command via spawnSync with shell: false (injection-safe).
 * Returns { exitCode, stdout, stderr, timedOut, error }
 */
function runCommand(cmd, cwd) {
  const validation = validateCommand(cmd);
  if (!validation.valid) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: validation.error,
      timedOut: false,
      error: validation.error,
      rejected: true,
    };
  }

  const [executable, ...args] = validation.argv;
  const result = spawnSync(executable, args, {
    shell: false,
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
    timeout: 120000, // 2min timeout per criterion
  });

  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: result.signal === 'SIGTERM',
    error: result.error ? result.error.message : null,
    rejected: false,
  };
}

// ---- Criterion verifiers ----

/**
 * Criterion 1: "padrões claros"
 * Pass if ≥1 ADR file in docs/architecture-decisions/*.md
 * OR decisions array in project.md populated with ≥1 entry. (D2)
 */
function verifyCriterion1(projectPath, projectConfig) {
  // Path A: ADR files
  const adrDir = path.join(projectPath, 'docs', 'architecture-decisions');
  if (fs.existsSync(adrDir)) {
    const adrFiles = fs.readdirSync(adrDir).filter(f => f.endsWith('.md'));
    if (adrFiles.length >= 1) {
      return {
        status: 'pass',
        message: `${adrFiles.length} ADR file(s) detected: ${adrFiles.map(f => `docs/architecture-decisions/${f}`).join(', ')}`,
      };
    }
  }

  // Path B: decisions array in project.md
  if (projectConfig.decisions && projectConfig.decisions.length >= 1) {
    return {
      status: 'pass',
      message: `decisions array populated with ${projectConfig.decisions.length} entry(ies) in project.md`,
    };
  }

  return {
    status: 'fail',
    message: 'No ADR files in docs/architecture-decisions/*.md and no decisions array in project.md. Add ≥1 architecture decision record.',
  };
}

/**
 * Criterion 2: "rotas + APIs definidas zero ambiguidade"
 * Pass if each trunk module has ≥1 contract file in specs/{slug}/contracts/*.md
 */
function verifyCriterion2(projectPath, modules) {
  const trunkModules = modules.filter(m => m.layer === 'trunk');

  if (trunkModules.length === 0) {
    return { status: 'not-applicable', message: 'No trunk modules found' };
  }

  // Scan all specs/*/contracts/*.md files
  const specsDir = path.join(projectPath, 'specs');
  const contractFiles = [];
  if (fs.existsSync(specsDir)) {
    for (const spec of fs.readdirSync(specsDir)) {
      const contractsDir = path.join(specsDir, spec, 'contracts');
      if (!fs.existsSync(contractsDir)) continue;
      for (const f of fs.readdirSync(contractsDir)) {
        if (f.endsWith('.md')) {
          const content = fs.readFileSync(path.join(contractsDir, f), 'utf8');
          contractFiles.push({ file: `specs/${spec}/contracts/${f}`, content });
        }
      }
    }
  }

  const uncovered = [];
  for (const mod of trunkModules) {
    // Check if any contract file references this module (by spec_ref or module name)
    const covered = contractFiles.some(cf =>
      cf.content.includes(`spec_ref: ${mod.slug}`) ||
      cf.content.includes(`spec_ref: "${mod.slug}"`) ||
      cf.content.includes(`module: ${mod.slug}`) ||
      cf.content.includes(mod.slug) // loose match
    );
    if (!covered) uncovered.push(mod.slug);
  }

  if (uncovered.length === 0) {
    return {
      status: 'pass',
      message: `All ${trunkModules.length} trunk module(s) have ≥1 contract reference`,
    };
  }

  return {
    status: 'fail',
    message: `${uncovered.length} trunk module(s) have no contract reference: ${uncovered.join(', ')}`,
  };
}

/**
 * Criterion 3: "zero data leakage"
 * Foundation modules must not import/require expansion (leaves) modules.
 * Static grep on source_files.
 */
function verifyCriterion3(projectPath, modules) {
  const foundationModules = modules.filter(m => FOUNDATION_LAYERS.has(m.layer));
  const leavesModules = modules.filter(m => m.layer === 'leaves');

  if (foundationModules.length === 0) {
    return { status: 'not-applicable', message: 'No foundation modules (roots|trunk) found' };
  }

  const violations = [];

  for (const fm of foundationModules) {
    for (const srcFile of fm.sourceFiles) {
      const absPath = path.join(projectPath, srcFile);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf8');
      const lines = content.split('\n');

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        // Check if this line imports any leaves module
        for (const lm of leavesModules) {
          // Check for import/require of leaves module (by name or source_path pattern)
          const namePatterns = [lm.slug];
          for (const nPat of namePatterns) {
            if (
              line.match(new RegExp(`import.*['"](.*${nPat}.*)['"](\\s*;)?`)) ||
              line.match(new RegExp(`require.*['"](.*${nPat}.*)['"](\\s*)`))
            ) {
              violations.push({
                foundationModule: fm.slug,
                layer: fm.layer,
                leavesModule: lm.slug,
                file: srcFile,
                line: lineNum + 1,
              });
            }
          }
        }
      }
    }
  }

  if (violations.length === 0) {
    return {
      status: 'pass',
      message: 'No cross-layer leakage detected in foundation modules',
    };
  }

  const details = violations.map(v =>
    `module '${v.foundationModule}' (${v.layer}) imports '${v.leavesModule}' (leaves) at ${v.file}:${v.line}`
  ).join('; ');

  return {
    status: 'fail',
    message: `${violations.length} leakage violation(s): ${details}`,
  };
}

/**
 * Criterion 4: "zero hardcoded" — Bruno strict 0 HARD (D1)
 * Regex patterns: credentials, absolute paths, hardcoded URLs.
 * ANY match in foundation source files = fail.
 */
function verifyCriterion4(projectPath, modules) {
  const foundationModules = modules.filter(m => FOUNDATION_LAYERS.has(m.layer) && m.sourceFiles.length > 0);

  if (foundationModules.length === 0) {
    return { status: 'not-applicable', message: 'No foundation modules with source_files to check' };
  }

  const hits = [];

  for (const fm of foundationModules) {
    for (const srcFile of fm.sourceFiles) {
      const absPath = path.join(projectPath, srcFile);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf8');
      const lines = content.split('\n');

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        for (const pat of HARDCODED_PATTERNS) {
          if (pat.regex.test(line)) {
            hits.push({ file: srcFile, line: lineNum + 1, category: pat.category });
            break; // one hit per line sufficient
          }
        }
      }
    }
  }

  if (hits.length === 0) {
    return {
      status: 'pass',
      message: 'No hardcoded credentials, absolute paths, or URLs in foundation source files',
    };
  }

  const details = hits.map(h => `${h.file}:${h.line} (${h.category})`).join('; ');
  return {
    status: 'fail',
    message: `${hits.length} hardcoded value(s) found in foundation source: ${details}`,
  };
}

/**
 * Criterion 5: "tudo dados reais"
 * No fixture indicators (mock-*, fake-*, fixtures/ dir) in productive paths (source_files).
 */
function verifyCriterion5(projectPath, modules) {
  const foundationModules = modules.filter(m => FOUNDATION_LAYERS.has(m.layer) && m.sourceFiles.length > 0);

  if (foundationModules.length === 0) {
    return { status: 'not-applicable', message: 'No foundation modules with source_files to check' };
  }

  const violations = [];

  for (const fm of foundationModules) {
    for (const srcFile of fm.sourceFiles) {
      const basename = path.basename(srcFile);
      // Check for mock-* or fake-* naming
      if (basename.match(/^(mock|fake)-/) || basename.match(/\.(mock|fake)\./)) {
        violations.push({ file: srcFile, reason: 'mock/fake file in productive path' });
      }
      // Check for fixtures/ directory in path
      if (srcFile.includes('/fixtures/') || srcFile.includes('\\fixtures\\')) {
        violations.push({ file: srcFile, reason: 'file in fixtures/ directory' });
      }
    }
  }

  if (violations.length === 0) {
    return {
      status: 'pass',
      message: 'No fixture indicators detected in productive paths',
    };
  }

  const details = violations.map(v => `${v.file} (${v.reason})`).join('; ');
  return {
    status: 'fail',
    message: `${violations.length} fixture violation(s) in productive paths: ${details}`,
  };
}

/**
 * Criterion 6: "testes passando"
 * Runs test_command via spawnSync. Pass if exit 0. Skipped if absent.
 */
function verifyCriterion6(projectPath, projectConfig) {
  const cmd = projectConfig.test_command;
  if (!cmd) {
    return { status: 'skipped', message: 'test_command not configured in project.md' };
  }

  const validation = validateCommand(cmd);
  if (!validation.valid) {
    return { status: 'fail', message: `test_command rejected: ${validation.error}` };
  }

  const result = runCommand(cmd, projectPath);
  if (result.rejected) {
    return { status: 'fail', message: `test_command rejected (injection prevention): ${result.error}` };
  }

  if (result.exitCode === 0) {
    return { status: 'pass', message: `test_command exit 0` };
  }

  return {
    status: 'fail',
    message: `test_command exited with code ${result.exitCode}`,
  };
}

/**
 * Criterion 7: "build limpo"
 * Runs build_command. Pass if exit 0 AND stderr has no WARNING|warn.
 * Skipped if absent.
 */
function verifyCriterion7(projectPath, projectConfig) {
  const cmd = projectConfig.build_command;
  if (!cmd) {
    return { status: 'skipped', message: 'build_command not configured in project.md' };
  }

  const validation = validateCommand(cmd);
  if (!validation.valid) {
    return { status: 'fail', message: `build_command rejected: ${validation.error}` };
  }

  const result = runCommand(cmd, projectPath);
  if (result.rejected) {
    return { status: 'fail', message: `build_command rejected (injection prevention): ${result.error}` };
  }

  if (result.exitCode !== 0) {
    return { status: 'fail', message: `build_command exited with code ${result.exitCode}` };
  }

  // Check stderr for warnings
  if (result.stderr && /WARNING|warn/i.test(result.stderr)) {
    return {
      status: 'fail',
      message: `build_command exited 0 but stderr contains warnings`,
    };
  }

  return { status: 'pass', message: 'build_command exit 0 with no stderr warnings' };
}

/**
 * Criterion 8: "IDE sem erro"
 * Runs typecheck_command + lint_command. Pass if both exit 0. Skipped if both absent.
 * If only one configured, run that one.
 */
function verifyCriterion8(projectPath, projectConfig) {
  const typecheckCmd = projectConfig.typecheck_command;
  const lintCmd = projectConfig.lint_command;

  if (!typecheckCmd && !lintCmd) {
    return { status: 'skipped', message: 'typecheck_command and lint_command not configured in project.md' };
  }

  const failures = [];
  const successes = [];

  if (typecheckCmd) {
    const validation = validateCommand(typecheckCmd);
    if (!validation.valid) {
      failures.push(`typecheck_command rejected: ${validation.error}`);
    } else {
      const result = runCommand(typecheckCmd, projectPath);
      if (result.rejected) {
        failures.push(`typecheck_command rejected (injection prevention): ${result.error}`);
      } else if (result.exitCode !== 0) {
        failures.push(`typecheck_command exited with code ${result.exitCode}`);
      } else {
        successes.push('typecheck exit 0');
      }
    }
  }

  if (lintCmd) {
    const validation = validateCommand(lintCmd);
    if (!validation.valid) {
      failures.push(`lint_command rejected: ${validation.error}`);
    } else {
      const result = runCommand(lintCmd, projectPath);
      if (result.rejected) {
        failures.push(`lint_command rejected (injection prevention): ${result.error}`);
      } else if (result.exitCode !== 0) {
        failures.push(`lint_command exited with code ${result.exitCode}`);
      } else {
        successes.push('lint exit 0');
      }
    }
  }

  if (failures.length > 0) {
    return { status: 'fail', message: failures.join('; ') };
  }

  return { status: 'pass', message: successes.join(', ') };
}

/**
 * Criterion 9: "tech stack bem definida"
 * Pass if project.md tech_stack array exists with ≥1 entry.
 */
function verifyCriterion9(projectPath, projectConfig) {
  const ts = projectConfig.tech_stack;
  if (!ts || !Array.isArray(ts)) {
    return { status: 'fail', message: 'tech_stack not configured in project.md. Add [{name, version, role}] entries.' };
  }
  if (ts.length === 0) {
    return { status: 'fail', message: 'tech_stack is empty. Add ≥1 entry with {name, version, role}.' };
  }

  return {
    status: 'pass',
    message: `tech_stack array with ${ts.length} entry(ies): ${ts.map(e => e.name || '?').join(', ')}`,
  };
}

// ---- Layer enum validation (D3) ----

/**
 * Validate that all layers in foundation_layers/expansion_layers are in the strict enum.
 * Returns { valid: boolean, invalidLayer: string|null }
 */
function validateLayerEnum(layers) {
  if (!layers) return { valid: true, invalidLayer: null };
  for (const layer of layers) {
    if (!VALID_LAYERS.has(layer)) {
      return { valid: false, invalidLayer: layer };
    }
  }
  return { valid: true, invalidLayer: null };
}

// ---- Foundation check orchestrator ----

/**
 * Run the full 9-criterion foundation check for a project.
 *
 * @param {string} projectPath - absolute path to project directory
 * @returns {object} result matching CONTRACT-FOUNDATION-CHECK-01 output schema
 */
function runFoundationCheck(projectPath) {
  const result = {
    schema: SCHEMA_VERSION,
    project: projectPath,
    foundation_layers: null,
    expansion_layers: null,
    criteria: [],
    summary: null,
    warnings: [],
    error: null,
  };

  // Parse project.md
  let projectConfig;
  try {
    projectConfig = parseProjectMd(projectPath);
  } catch (err) {
    result.error = { code: err.code || 'MANIFEST_INVALID', message: err.message };
    return result;
  }

  // D6 legacy state: no foundation_layers configured
  if (projectConfig.foundation_layers === null) {
    result.warnings.push({
      code: 'FOUNDATION_NOT_CONFIGURED',
      message: 'foundation_layers not configured in .soma/project.md; assume project in expansion phase only — use `soma init --foundation` to set up Phase 4d primitive',
    });
    return result;
  }

  // D3 layer enum validation
  const flValidation = validateLayerEnum(projectConfig.foundation_layers);
  if (!flValidation.valid) {
    result.error = {
      code: 'INVALID_LAYER',
      message: `Invalid layer "${flValidation.invalidLayer}" in foundation_layers. Valid values: ${[...VALID_LAYERS].join(', ')}`,
    };
    return result;
  }

  const elValidation = validateLayerEnum(projectConfig.expansion_layers);
  if (!elValidation.valid) {
    result.error = {
      code: 'INVALID_LAYER',
      message: `Invalid layer "${elValidation.invalidLayer}" in expansion_layers. Valid values: ${[...VALID_LAYERS].join(', ')}`,
    };
    return result;
  }

  result.foundation_layers = projectConfig.foundation_layers;
  result.expansion_layers = projectConfig.expansion_layers;

  // List modules with layer info
  const modules = listModules(projectPath);

  // Run 9 criteria
  const criteriaNames = [
    'padrões claros',
    'rotas + APIs definidas',
    'zero data leakage',
    'zero hardcoded',
    'tudo dados reais',
    'testes passando',
    'build limpo',
    'IDE sem erro',
    'tech stack bem definida',
  ];

  const criteriaResults = [
    verifyCriterion1(projectPath, projectConfig),
    verifyCriterion2(projectPath, modules),
    verifyCriterion3(projectPath, modules),
    verifyCriterion4(projectPath, modules),
    verifyCriterion5(projectPath, modules),
    verifyCriterion6(projectPath, projectConfig),
    verifyCriterion7(projectPath, projectConfig),
    verifyCriterion8(projectPath, projectConfig),
    verifyCriterion9(projectPath, projectConfig),
  ];

  result.criteria = criteriaResults.map((cr, idx) => ({
    id: idx + 1,
    name: criteriaNames[idx],
    status: cr.status,
    message: cr.message,
  }));

  // Compute summary
  const pass = result.criteria.filter(c => c.status === 'pass').length;
  const fail = result.criteria.filter(c => c.status === 'fail').length;
  const skipped = result.criteria.filter(c => c.status === 'skipped').length;
  const notApplicable = result.criteria.filter(c => c.status === 'not-applicable').length;

  // D4: ALL 9 must pass binary.
  // 'skipped' does NOT count as pass (explicit opt-out blocks gate).
  // 'not-applicable' DOES count as pass (no applicable modules = trivially satisfied).
  const effectivePass = result.criteria.filter(c => c.status === 'pass' || c.status === 'not-applicable').length;
  const foundationDone = (effectivePass === 9) && (fail === 0) && (skipped === 0);

  result.summary = {
    total: 9,
    pass,
    fail,
    skipped,
    'not-applicable': notApplicable,
    foundation_done: foundationDone,
  };

  return result;
}

// ---- Human output formatter ----

/**
 * Format the foundation check result as human-readable text.
 * @param {object} result - from runFoundationCheck
 * @returns {string}
 */
function formatHumanOutput(result) {
  const lines = [];

  if (result.error) {
    lines.push(`ERROR [${result.error.code}]: ${result.error.message}`);
    return lines.join('\n') + '\n';
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      lines.push(`WARNING [${w.code}]: ${w.message}`);
    }
    return lines.join('\n') + '\n';
  }

  lines.push(`SOMA foundation-check — ${result.project}`);
  lines.push(`foundation_layers: [${result.foundation_layers.join(', ')}]`);
  lines.push('');

  const statusSymbol = { pass: '[pass]', fail: '[fail]', skipped: '[skipped]', 'not-applicable': '[n/a]' };

  for (const c of result.criteria) {
    const sym = statusSymbol[c.status] || `[${c.status}]`;
    lines.push(`  ${sym.padEnd(12)} ${c.id}. ${c.name}`);
    if (c.status !== 'pass') {
      lines.push(`             ${c.message}`);
    }
  }

  if (result.summary) {
    lines.push('');
    const s = result.summary;
    lines.push(`Summary: ${s.pass}/9 pass, ${s.fail} fail, ${s.skipped} skipped — foundation_done: ${s.foundation_done}`);
  }

  return lines.join('\n') + '\n';
}

// ---- Exports ----

module.exports = {
  parseProjectMd,
  resolveModuleLayer,
  validateCommand,
  validateLayerEnum,
  runFoundationCheck,
  formatHumanOutput,
  // Individual criterion verifiers (for unit testing)
  verifyCriterion1,
  verifyCriterion2,
  verifyCriterion3,
  verifyCriterion4,
  verifyCriterion5,
  verifyCriterion6,
  verifyCriterion7,
  verifyCriterion8,
  verifyCriterion9,
  // Helpers
  listModules,
  VALID_LAYERS,
  FOUNDATION_LAYERS,
  SCHEMA_VERSION,
};
