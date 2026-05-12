#!/usr/bin/env node
'use strict';
/**
 * bootstrap.cjs — SOMA v2.1 project bootstrap CLI
 *
 * Fast-path "is this project usable right now?" validator.
 * Steps:
 *   1. Detect .soma/ in cwd
 *   2. Validate SOMA_HOME (manifest.json schema v1)
 *   3. Delegate to doctor.scanContextRouting for drift detection
 *   4. Enumerate .soma/modules/ + SOMA_HOME adapters
 *   5. Emit soma-bootstrap/v1 JSON summary
 *
 * Read-only: ZERO modifications to SOMA_HOME or .soma/ (Adapter Contract Cláusula B).
 *
 * Usage:
 *   node ~/.soma-v2/scripts/bootstrap.cjs [--quiet] [--soma-home=PATH]
 *
 * Exit codes:
 *   0 — success (status: ready or drift)
 *   1 — error (NO_SOMA_PROJECT, INVALID_SOMA_HOME, SCHEMA_VERSION_UNSUPPORTED, CRITICAL_DRIFT)
 *   2 — invalid args (INVALID_ARGS)
 *
 * @spec AC-01..AC-14
 * @contract CONTRACT-BOOTSTRAP-01
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---- Arg parsing ----

/**
 * Parse CLI arguments.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ flags: object, errors: string[] }}
 */
function parseArgs(argv) {
  const flags = {
    quiet: false,
    somaHome: null,
  };
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') {
      flags.quiet = true;
    } else if (arg === '--soma-home') {
      flags.somaHome = argv[++i];
    } else if (arg.startsWith('--soma-home=')) {
      flags.somaHome = arg.slice('--soma-home='.length);
    } else if (arg.startsWith('--')) {
      errors.push(`Unknown flag: ${arg}. Did you mean --quiet?`);
    }
  }

  return { flags, errors };
}

// ---- Output helpers ----

/**
 * Expand ~ in path.
 * @param {string} p
 * @returns {string}
 */
function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Emit JSON to stdout and exit.
 * @param {object} payload
 * @param {number} exitCode
 * @param {boolean} quiet
 * @param {string|null} humanSummary - human-readable prefix (null = quiet only)
 */
function emitAndExit(payload, exitCode, quiet, humanSummary) {
  const json = JSON.stringify(payload, null, 2);
  if (quiet) {
    process.stdout.write(json + '\n');
  } else {
    if (humanSummary) {
      process.stdout.write(humanSummary + '\n');
    }
    process.stdout.write('\n' + json + '\n');
  }
  process.exit(exitCode);
}

// ---- Step 1: Detect .soma/ ----

/**
 * Check if .soma/ directory exists in projectRoot.
 * @param {string} projectRoot
 * @returns {{ ok: boolean, modulesDir: string }}
 */
function detectSomaDir(projectRoot) {
  const somaDir = path.join(projectRoot, '.soma');
  const modulesDir = path.join(somaDir, 'modules');
  return {
    ok: fs.existsSync(somaDir) && fs.statSync(somaDir).isDirectory(),
    somaDir,
    modulesDir,
  };
}

// ---- Step 2: Validate SOMA_HOME ----

/**
 * Validate SOMA_HOME: exists + manifest.json readable + schema matches soma-manifest/v1.
 * @param {string} somaHome
 * @returns {{ ok: boolean, errorCode: string|null, manifest: object|null, message: string|null }}
 */
function validateSomaHome(somaHome) {
  // Check directory exists
  if (!fs.existsSync(somaHome)) {
    return {
      ok: false,
      errorCode: 'INVALID_SOMA_HOME',
      manifest: null,
      message: `SOMA_HOME at ${somaHome} does not exist.`,
    };
  }

  const manifestPath = path.join(somaHome, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      errorCode: 'INVALID_SOMA_HOME',
      manifest: null,
      message: `manifest.json not found at ${manifestPath}.`,
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      errorCode: 'INVALID_SOMA_HOME',
      manifest: null,
      message: `Could not read manifest.json: ${err.message}`,
    };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      errorCode: 'INVALID_SOMA_HOME',
      manifest: null,
      message: `manifest.json is not valid JSON: ${err.message}`,
    };
  }

  // D8 lock: strict match soma-manifest/v1
  if (data.schema !== 'soma-manifest/v1') {
    return {
      ok: false,
      errorCode: 'SCHEMA_VERSION_UNSUPPORTED',
      manifest: null,
      message: `manifest.json schema "${data.schema}" is not supported. Expected "soma-manifest/v1" (D8 lock).`,
    };
  }

  return { ok: true, errorCode: null, manifest: data, message: null };
}

// ---- Step 3: Doctor delegation (context routing check) ----

/**
 * Delegate to doctor.scanContextRouting in-process (AD-02: no fork overhead).
 * Falls back gracefully if doctor fails to load.
 * @param {string} projectRoot
 * @param {string} somaHome - path to SOMA_HOME (for require resolution)
 * @returns {{ findings: object[], error: string|null }}
 */
function runDoctorCheck(projectRoot, somaHome) {
  // Resolve doctor.cjs path — prefer scratch repo copy if running in scratch context
  const doctorPath = path.join(somaHome, 'scripts', 'doctor.cjs');
  // Also try relative path (for scratch repo invocation)
  const doctorPaths = [
    doctorPath,
    path.join(__dirname, 'doctor.cjs'),
  ];

  let doctor = null;
  for (const p of doctorPaths) {
    if (fs.existsSync(p)) {
      try {
        doctor = require(p);
        break;
      } catch (e) {
        // Continue to next path
      }
    }
  }

  if (!doctor || typeof doctor.scanContextRouting !== 'function') {
    // Doctor not available or not exported — skip with empty findings
    return { findings: [], error: null };
  }

  try {
    const result = doctor.scanContextRouting(projectRoot);
    return { findings: result.findings || [], error: null };
  } catch (err) {
    // Doctor check failed — emit as warning but don't block bootstrap
    return {
      findings: [{
        severity: 'warning',
        code: 'DOCTOR_CHECK_FAILED',
        message: `Doctor context routing check failed: ${err.message}`,
      }],
      error: null,
    };
  }
}

// ---- Step 4: Module enumeration (AD-03) ----

/**
 * List modules in .soma/modules/ using module-store.cjs parseFrontMatter.
 * No inference re-run (D4 lock).
 * @param {string} modulesDir
 * @param {string} somaHome
 * @returns {Array<{slug: string, status: string}>}
 */
function enumerateModules(modulesDir, somaHome) {
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  // Load parseFrontMatter from module-store
  const moduleStorePath = path.join(somaHome, 'scripts', 'lib', 'module-store.cjs');
  const moduleStorePaths = [
    moduleStorePath,
    path.join(__dirname, 'lib', 'module-store.cjs'),
  ];

  let parseFrontMatter = null;
  for (const p of moduleStorePaths) {
    if (fs.existsSync(p)) {
      try {
        parseFrontMatter = require(p).parseFrontMatter;
        break;
      } catch (e) {
        // Continue
      }
    }
  }

  let files;
  try {
    // C-fu-2: exclude index.md (D-C9 — index is a navigation file, not a module)
    files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.md') && f !== 'index.md');
  } catch (err) {
    return [];
  }

  const modules = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const filePath = path.join(modulesDir, file);
    let status = 'hypothesis'; // default

    if (parseFrontMatter) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = parseFrontMatter(content);
        if (parsed.valid && parsed.frontMatter && parsed.frontMatter.status) {
          const rawStatus = parsed.frontMatter.status;
          // Normalize to known values
          if (['active', 'hypothesis', 'deprecated'].includes(rawStatus)) {
            status = rawStatus;
          }
        }
      } catch (e) {
        // Use default status
      }
    }

    modules.push({ slug, status });
  }

  return modules;
}

// ---- Step 4: Adapter enumeration ----

/**
 * List adapters + install_targets_count from SOMA_HOME/adapters/.
 * @param {string} somaHome
 * @returns {Array<{tool: string, install_targets_count: number}>}
 */
function enumerateAdapters(somaHome) {
  const adaptersDir = path.join(somaHome, 'adapters');
  if (!fs.existsSync(adaptersDir)) {
    return [];
  }

  let adapterDirs;
  try {
    adapterDirs = fs.readdirSync(adaptersDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('_'))
      .map(e => e.name);
  } catch (err) {
    return [];
  }

  const adapters = [];
  for (const tool of adapterDirs) {
    const targetsPath = path.join(adaptersDir, tool, 'install-targets.json');
    let installTargetsCount = 0;
    if (fs.existsSync(targetsPath)) {
      try {
        const raw = fs.readFileSync(targetsPath, 'utf8');
        const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const data = JSON.parse(stripped);
        if (Array.isArray(data.entries)) {
          installTargetsCount = data.entries.length;
        }
      } catch (e) {
        // Keep 0
      }
    }
    adapters.push({ tool, install_targets_count: installTargetsCount });
  }

  return adapters;
}

// ---- Step 5: Build output ----

/**
 * Build the soma-bootstrap/v1 JSON payload.
 */
function buildOutput(opts) {
  const {
    status, somaHome, projectRoot, modules, adapters,
    findings, durationMs, suggestion, errorCode, message,
    criticalFindings, somaHomeAttempted,
  } = opts;

  const payload = {
    schema: 'soma-bootstrap/v1',
    status,
    soma_home: somaHome,
    project_root: projectRoot,
    modules: modules || [],
    adapters: adapters || [],
    findings: findings || [],
    duration_ms: Math.round(durationMs),
    suggestion: suggestion || null,
  };

  // Error-specific fields
  if (errorCode) {
    payload.error_code = errorCode;
    payload.message = message || null;
  }
  if (criticalFindings && criticalFindings.length > 0) {
    payload.critical_findings = criticalFindings;
  }
  if (somaHomeAttempted) {
    payload.soma_home_attempted = somaHomeAttempted;
  }

  return payload;
}

// ---- Human summary rendering ----

/**
 * Build a human-readable summary line for console output.
 * @param {string} status
 * @param {object[]} modules
 * @param {object[]} findings
 * @param {number} durationMs
 * @returns {string}
 */
function buildHumanSummary(status, modules, findings, durationMs) {
  const lines = [];
  lines.push('SOMA Bootstrap');
  lines.push('');

  if (status === 'ready') {
    lines.push(`  Project ready — ${modules.length} module(s) detected, 0 findings (${durationMs}ms)`);
  } else if (status === 'drift') {
    const warnCount = findings.filter(f => f.severity === 'warning').length;
    lines.push(`  Drift detected — ${modules.length} module(s), ${warnCount} warning(s) (${durationMs}ms)`);
    lines.push(`  Run 'soma sync --apply' to remediate drift.`);
  } else {
    lines.push(`  Bootstrap failed — see JSON output for details.`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---- Main ----

function main() {
  const startMs = Date.now();
  const { flags, errors } = parseArgs(process.argv.slice(2));

  // Resolve SOMA_HOME: --soma-home flag > SOMA_HOME env > ~/.soma-v2
  const somaHomeRaw = expandHome(flags.somaHome || process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2'));
  // Resolve realpath for somaHome if it exists (macOS /tmp → /private/tmp)
  let somaHome = somaHomeRaw;
  try {
    if (fs.existsSync(somaHomeRaw)) somaHome = fs.realpathSync(somaHomeRaw);
  } catch (e) { /* keep original */ }
  // Use realpath to resolve symlinks (macOS /tmp → /private/tmp)
  let projectRoot;
  try {
    projectRoot = fs.realpathSync(process.cwd());
  } catch (e) {
    projectRoot = process.cwd();
  }

  // Invalid args → exit 2
  if (errors.length > 0) {
    const payload = buildOutput({
      status: 'error',
      somaHome,
      projectRoot,
      modules: [],
      adapters: [],
      findings: [],
      durationMs: Date.now() - startMs,
      suggestion: null,
      errorCode: 'INVALID_ARGS',
      message: errors.join('; '),
    });
    emitAndExit(payload, 2, flags.quiet, null);
    return;
  }

  // Step 1: Detect .soma/
  const { ok: hasSoma, somaDir, modulesDir } = detectSomaDir(projectRoot);
  if (!hasSoma) {
    const payload = buildOutput({
      status: 'error',
      somaHome,
      projectRoot,
      modules: [],
      adapters: [],
      findings: [],
      durationMs: Date.now() - startMs,
      suggestion: "Run 'soma init --existing' in a SOMA-enabled repo, or 'soma init' to initialize a new one.",
      errorCode: 'NO_SOMA_PROJECT',
      message: `No .soma/ directory found in current working directory: ${projectRoot}`,
    });
    emitAndExit(payload, 1, flags.quiet,
      flags.quiet ? null : `SOMA Bootstrap\n\n  Error: No .soma/ project found in ${projectRoot}\n`
    );
    return;
  }

  // Step 2: Validate SOMA_HOME
  const somaValidation = validateSomaHome(somaHome);
  if (!somaValidation.ok) {
    const onboardingPath = path.join(somaHome, 'docs', 'onboarding.md');
    const onboardingRef = `~/.soma-v2/docs/onboarding.md`;
    const payload = buildOutput({
      status: 'error',
      somaHome,
      projectRoot,
      modules: [],
      adapters: [],
      findings: [],
      durationMs: Date.now() - startMs,
      suggestion: `See ${onboardingRef} or set SOMA_HOME env var to a valid SOMA installation path.`,
      errorCode: somaValidation.errorCode,
      message: somaValidation.message,
      somaHomeAttempted: somaHome,
    });
    emitAndExit(payload, 1, flags.quiet,
      flags.quiet ? null : `SOMA Bootstrap\n\n  Error: ${somaValidation.message}\n`
    );
    return;
  }

  // Step 3: Doctor delegation — context routing check (AD-02)
  const doctorResult = runDoctorCheck(projectRoot, somaHome);
  const findings = doctorResult.findings || [];

  // Classify findings
  const criticalFindings = findings.filter(f => f.severity === 'error' || f.severity === 'critical');
  const warningFindings = findings.filter(f => f.severity === 'warning');

  // Step 4: Enumerate modules + adapters (AD-03)
  const modules = enumerateModules(modulesDir, somaHome);
  const adapters = enumerateAdapters(somaHome);

  // Determine status
  let status;
  let exitCode = 0;
  let suggestion = null;

  if (criticalFindings.length > 0) {
    status = 'error';
    exitCode = 1;
    suggestion = "Run 'soma doctor --verbose' to inspect critical findings.";
  } else if (warningFindings.length > 0) {
    status = 'drift';
    exitCode = 0;
    suggestion = "Run 'soma sync --apply' to remediate drift findings.";
  } else {
    status = 'ready';
    exitCode = 0;
    suggestion = null;
  }

  const durationMs = Date.now() - startMs;

  // Build payload
  const nonCriticalFindings = findings.filter(f => f.severity !== 'error' && f.severity !== 'critical');
  const payload = buildOutput({
    status,
    somaHome,
    projectRoot,
    modules,
    adapters,
    findings: status === 'error' ? [] : nonCriticalFindings,
    durationMs,
    suggestion,
    errorCode: status === 'error' ? 'CRITICAL_DRIFT' : undefined,
    message: status === 'error' ? `${criticalFindings.length} critical finding(s) detected.` : undefined,
    criticalFindings: status === 'error' ? criticalFindings : undefined,
  });

  // Human summary (default mode only)
  const humanSummary = buildHumanSummary(status, modules, findings, Math.round(durationMs));

  emitAndExit(payload, exitCode, flags.quiet, flags.quiet ? null : humanSummary);
}

main();
