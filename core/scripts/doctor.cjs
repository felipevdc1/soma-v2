#!/usr/bin/env node
'use strict';
/**
 * doctor.cjs — SOMA v2.1 health check CLI
 *
 * Read-only drift detection between ~/.soma-v2/manifest.json + install-targets
 * versus canonical sources (~/.codex/AGENTS.md, ~/AGENTS.md, etc.).
 *
 * Phase 4d extension: --foundation-check [--gate] mode for Bruno P6 9-criterion
 * "fundação sólida" verifier.
 *
 * Usage:
 *   node ~/.soma-v2/scripts/doctor.cjs [--json] [--quiet] [--verbose] [--soma-home=PATH]
 *   node ~/.soma-v2/scripts/doctor.cjs --foundation-check [--gate] [--json] [--project=PATH]
 *
 * Exit codes:
 *   0 — zero drift findings / foundation check non-blocking / foundation all-pass in gate mode
 *   1 — ≥1 drift finding / any criterion fail in gate mode / INVALID_LAYER
 *   2 — hard error (manifest missing/invalid, invalid args)
 *
 * @spec AC-01,02,06,07 (Phase 2); AC-01..AC-17 (Phase 4d)
 * @contract CONTRACT-DOCTOR-01, CONTRACT-FOUNDATION-CHECK-01
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { extractBlock, parseAnchorAttrs, computeBlockSha256 } = require('./lib/anchored-blocks.cjs');
const { loadManifest, loadInstallTargets, listAdapters } = require('./lib/manifest.cjs');
const { scanStaleHypothesis } = require('./lib/module-store.cjs');
const { runFoundationCheck, formatHumanOutput } = require('./lib/foundation-check.cjs');
const { runMigrationCheck } = require('./lib/migration.cjs');
// Spec 018 (T-06): file-drift detection (AC-08/AC-09/AC-10). Deliberately
// NOT `./lib/manifest.cjs`'s loadInstallTargets() — that loader's
// validateInstallTargetsSchema() requires block_id/source_doc/
// target_anchor_id on every entry and throws on a kind:"file" entry (see
// CONTRACT-FILES-LEDGER-02's "O que o doctor lê"). loadInstallTargetsWithKinds
// (T-07) is the mixed-aware loader: block entries validated the old way,
// file entries validated by files.cjs's own validateFileEntry, target_path
// left verbatim for file entries (the ledger key — CONTRACT-FILES-LEDGER-02).
const { loadInstallTargetsWithKinds } = require('./install/targets.cjs');
const { isFileEntry, expandHome: expandFileHome, sha256OfFile, readLedger, ledgerFilePath } = require('./install/files.cjs');

// ---- Arg parsing ----

function parseArgs(argv) {
  const flags = {
    json: false,
    quiet: false,
    verbose: false,
    somaHome: null,
    project: null,
    foundationCheck: false,
    gate: false,
    checkContextRouting: false,
    // checkMigration: true means run migration scan; false means skip.
    // checkMigrationExplicit: true means the flag was explicitly passed → activates
    // pure "checks mode" (skip drift detection, always exit 0 on WARNING).
    checkMigration: true,
    checkMigrationExplicit: false,
  };
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--verbose') flags.verbose = true;
    else if (arg === '--foundation-check') flags.foundationCheck = true;
    else if (arg === '--gate') flags.gate = true;
    else if (arg === '--check-context-routing') flags.checkContextRouting = true;
    else if (arg === '--check-migration') { flags.checkMigration = true; flags.checkMigrationExplicit = true; }
    else if (arg === '--check-migration=true') { flags.checkMigration = true; flags.checkMigrationExplicit = true; }
    else if (arg === '--check-migration=false') { flags.checkMigration = false; flags.checkMigrationExplicit = true; }
    else if (arg === '--soma-home') { flags.somaHome = argv[++i]; }
    else if (arg.startsWith('--soma-home=')) flags.somaHome = arg.slice('--soma-home='.length);
    else if (arg === '--project') { flags.project = argv[++i]; }
    else if (arg.startsWith('--project=')) flags.project = arg.slice('--project='.length);
    else if (arg.startsWith('--')) errors.push(`Unknown flag: ${arg}`);
  }

  if (flags.json && flags.quiet) errors.push('--json and --quiet are mutually exclusive');
  if (flags.json && flags.verbose) errors.push('--json and --verbose are mutually exclusive');
  if (flags.quiet && flags.verbose) errors.push('--quiet and --verbose are mutually exclusive');
  if (flags.gate && !flags.foundationCheck) errors.push('--gate requires --foundation-check');

  return { flags, errors };
}

// ---- Output helpers ----

function emitError(code, message, useJson) {
  const out = JSON.stringify({ error: code, message }, null, 2);
  if (useJson) {
    process.exitCode = 2;
    process.stdout.end(out + '\n');
  } else {
    process.stderr.write(`ERROR [${code}]: ${message}\n`);
    process.exit(2);
  }
}

function humanSeverityLabel(severity) {
  if (severity === 'missing') return '\x1b[33m[missing]\x1b[0m';
  if (severity === 'drift') return '\x1b[31m[drift]\x1b[0m';
  if (severity === 'ok') return '\x1b[32m[ok]\x1b[0m';
  return `[${severity}]`;
}

// ---- Core doctor logic ----

/**
 * Detect target_drift findings from install-targets entries.
 * For each entry, check if the target file has the expected anchored block.
 *
 * @param {string} somaHome
 * @param {string[]} adapters
 * @returns {object[]} findings
 */
function detectTargetDrifts(somaHome, adapters) {
  const findings = [];

  for (const adapter of adapters) {
    let targetsData;
    try {
      targetsData = loadInstallTargets(somaHome, adapter);
    } catch (err) {
      if (err.code === 'INSTALL_TARGETS_INVALID') {
        // Skip invalid adapters with a warning finding
        findings.push({
          kind: 'target_drift',
          severity: 'error',
          adapter,
          target_path: null,
          target_anchor_id: null,
          source_doc: null,
          expected_sha256: null,
          actual_sha256: null,
          message: `Could not load install-targets for adapter "${adapter}": ${err.message}`
        });
        continue;
      }
      throw err;
    }

    for (const entry of targetsData.entries) {
      const targetPath = entry.target_path; // already expanded by loadInstallTargets
      const anchorId = entry.target_anchor_id;
      const sourceDocRelative = entry.source_doc;
      const sourceDocAbs = path.join(somaHome, sourceDocRelative);

      // Compute expected sha256 from source doc
      let expectedSha256 = null;
      let sourceContent = null;
      try {
        const sourceText = fs.readFileSync(sourceDocAbs, 'utf8');
        // Extract the block content from source doc (using legacy format typically)
        const blockInSource = extractBlock(sourceDocAbs, anchorId);
        if (blockInSource.found) {
          expectedSha256 = computeBlockSha256(blockInSource.content);
        } else {
          // Source doc exists but block not found — use file sha256 as fallback
          expectedSha256 = crypto.createHash('sha256').update(sourceText).digest('hex');
        }
      } catch (err) {
        // Source file unreadable — emit as finding, not fatal
        findings.push({
          kind: 'target_drift',
          severity: 'error',
          adapter,
          target_path: targetPath,
          target_anchor_id: anchorId,
          source_doc: sourceDocRelative,
          expected_sha256: null,
          actual_sha256: null,
          message: `Source doc unreadable: ${sourceDocRelative} — ${err.message}`
        });
        continue;
      }

      // Check if target file exists
      if (!fs.existsSync(targetPath)) {
        findings.push({
          kind: 'target_drift',
          severity: 'missing',
          adapter,
          target_path: targetPath,
          target_anchor_id: anchorId,
          source_doc: sourceDocRelative,
          expected_sha256: expectedSha256,
          actual_sha256: null,
          message: `Target file not found: ${targetPath}`
        });
        continue;
      }

      // Try to extract the anchor block from the target
      const blockInTarget = extractBlock(targetPath, anchorId);

      if (!blockInTarget.found) {
        // Block not present in target
        findings.push({
          kind: 'target_drift',
          severity: 'missing',
          adapter,
          target_path: targetPath,
          target_anchor_id: anchorId,
          source_doc: sourceDocRelative,
          expected_sha256: expectedSha256,
          actual_sha256: null,
          message: 'Anchored block missing in target file'
        });
        continue;
      }

      // Block found — check attributes
      const attrs = blockInTarget.attrs;
      const hasNewFormat = attrs.version !== null || attrs.sha256 !== null;

      if (!hasNewFormat) {
        // Block exists but lacks id/version/sha256 attrs (D3 scenario — legacy markers)
        findings.push({
          kind: 'target_drift',
          severity: 'drift',
          adapter,
          target_path: targetPath,
          target_anchor_id: anchorId,
          source_doc: sourceDocRelative,
          expected_sha256: expectedSha256,
          actual_sha256: '(no anchor attributes)',
          message: 'Anchor markers exist but lack id/version/sha256 attributes'
        });
        continue;
      }

      // Block has attributes — compare sha256
      const actualSha256 = computeBlockSha256(blockInTarget.content);

      if (attrs.sha256 && attrs.sha256 !== actualSha256) {
        // sha256 attribute exists but doesn't match actual content — manual edit (drift)
        findings.push({
          kind: 'target_drift',
          severity: 'drift',
          adapter,
          target_path: targetPath,
          target_anchor_id: anchorId,
          source_doc: sourceDocRelative,
          expected_sha256: expectedSha256,
          actual_sha256: actualSha256,
          message: 'Block sha256 attribute differs from actual content sha256'
        });
        continue;
      }

      if (actualSha256 !== expectedSha256) {
        // Content differs from source
        findings.push({
          kind: 'target_drift',
          severity: 'drift',
          adapter,
          target_path: targetPath,
          target_anchor_id: anchorId,
          source_doc: sourceDocRelative,
          expected_sha256: expectedSha256,
          actual_sha256: actualSha256,
          message: 'Block content differs from source document'
        });
        continue;
      }

      // All OK — emit ok finding (for verbose mode)
      findings.push({
        kind: 'target_drift',
        severity: 'ok',
        adapter,
        target_path: targetPath,
        target_anchor_id: anchorId,
        source_doc: sourceDocRelative,
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256,
        message: 'In sync'
      });
    }
  }

  return findings;
}

/**
 * Detect drift for `kind: "file"` install-targets entries (Spec 018, T-06;
 * AC-08/AC-09/AC-10; CONTRACT-FILES-LEDGER-02 §"O que o doctor lê").
 *
 * detectTargetDrifts() above is block-only — it "não confere arquivo
 * nenhum", which is exactly how 6 hooks went 3 months stale unnoticed. This
 * function is the file-world counterpart, and follows the contract's
 * 3-row table literally (not a per-file matrix crossed with ledger state):
 *
 *   | situação                                  | saída                    |
 *   | install-state ausente                     | "nunca instalado", 1x    |
 *   | arquivo declarado divergindo da fonte      | finding nomeando o arq.  |
 *   | todos os declarados idênticos              | silêncio (severity 'ok', filtered by default) |
 *
 * "Divergindo da fonte do repo" (AC-08) is a DIRECT disk-vs-repo sha256
 * comparison — it does NOT consult the ledger's recorded sha256. That is
 * deliberately different from files.cjs's classifyFileState()/
 * planFileInstall(), which compare disk state against what the ledger last
 * recorded (the install-time "is it safe to overwrite" decision). Doctor
 * is a health check, not an installer: it answers "does what's on disk
 * match what the repo says today", which is the literal question AC-08
 * asks and the literal gap the "6 hooks stale 3 months" incident exposed.
 *
 * Judgment call (undocumented by the contract, see task report "Lacunas do
 * documento"): if this SOMA home declares ZERO kind:"file" entries across
 * all adapters, this function returns [] — no "never installed" finding
 * either. Measured 2026-08-21: neither the repo's core/adapters/*
 * install-targets.json nor the real ~/.soma-v2 install has any kind:"file"
 * entry yet, so emitting the AC-10 warning unconditionally would add pure
 * noise to every existing doctor invocation. The warning only makes sense
 * once there is something declared to have (not) installed.
 *
 * @param {string} somaHome
 * @param {string[]} adapters
 * @param {string} projectPathAbs  absolute path to the project whose
 *   `.soma/install-state.json` is the file ledger (CONTRACT-FILES-LEDGER-02
 *   §"ONDE o ledger mora": `<projectPathAbs>/.soma/install-state.json`,
 *   never `somaHome` — that was T-07's own fixed bug).
 * @returns {object[]} findings, kind: 'file_drift'
 */
function detectFileDrifts(somaHome, adapters, projectPathAbs) {
  const findings = [];
  const declaredFileEntries = []; // { adapter, entry }

  for (const adapter of adapters) {
    let targetsData;
    try {
      targetsData = loadInstallTargetsWithKinds(somaHome, adapter);
    } catch (err) {
      // INSTALL_TARGETS_INVALID for this adapter is already reported as an
      // 'error' finding by detectTargetDrifts() above (it calls the OLD
      // block-only loader on the same file) — do not double-report here.
      // Any other error (e.g. a malformed kind:"file" entry — a config bug,
      // not a drift) propagates, matching detectTargetDrifts()'s own
      // precedent of rethrowing non-INSTALL_TARGETS_INVALID errors.
      if (err.code === 'INSTALL_TARGETS_INVALID') continue;
      throw err;
    }
    for (const entry of targetsData.entries) {
      if (isFileEntry(entry)) declaredFileEntries.push({ adapter, entry });
    }
  }

  if (declaredFileEntries.length === 0) return findings; // nothing declared -> nothing to check

  const { installed } = readLedger(projectPathAbs);
  if (!installed) {
    // AC-10: explicit "never installed", never silence, never "No drift
    // detected" — silence here is the exact bug this task exists to kill.
    findings.push({
      kind: 'file_drift',
      severity: 'warning',
      code: 'file_never_installed',
      adapter: null,
      target_path: null,
      source_path: null,
      expected_sha256: null,
      actual_sha256: null,
      message: `No install-state found for this project (${ledgerFilePath(projectPathAbs)}) — ` +
        `${declaredFileEntries.length} declared file(s) were never installed by SOMA; drift not evaluated.`,
    });
    return findings;
  }

  for (const { adapter, entry } of declaredFileEntries) {
    const targetPathAbs = expandFileHome(entry.target_path);
    const sourcePathAbs = path.resolve(somaHome, entry.source_path);

    if (!fs.existsSync(targetPathAbs)) {
      findings.push({
        kind: 'file_drift',
        severity: 'missing',
        adapter,
        target_path: entry.target_path,
        source_path: entry.source_path,
        expected_sha256: null,
        actual_sha256: null,
        message: `Installed file not found: ${entry.target_path}`,
      });
      continue;
    }

    const expectedSha256 = sha256OfFile(sourcePathAbs);
    const actualSha256 = sha256OfFile(targetPathAbs);

    if (expectedSha256 !== actualSha256) {
      // AC-08: never "No drift detected" — name the file.
      findings.push({
        kind: 'file_drift',
        severity: 'drift',
        adapter,
        target_path: entry.target_path,
        source_path: entry.source_path,
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256,
        message: `Installed file differs from repo source: ${entry.target_path}`,
      });
    } else {
      // AC-09: emitted as 'ok' for --verbose parity with target_drift; the
      // default/quiet filters in main() already drop severity:'ok', which
      // is what makes this "silence" in the default/quiet output.
      findings.push({
        kind: 'file_drift',
        severity: 'ok',
        adapter,
        target_path: entry.target_path,
        source_path: entry.source_path,
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256,
        message: 'In sync',
      });
    }
  }

  return findings;
}

/**
 * Detect source_staleness: compare manifest.sourceSha256 vs current source file sha256.
 * @param {string} somaHome
 * @param {object} manifest
 * @returns {object[]} findings
 */
function detectSourceStaleness(somaHome, manifest) {
  const findings = [];

  for (const file of manifest.files) {
    if (!file.sourceSha256) continue; // No source sha to compare

    const labPath = path.join(somaHome, file.path);
    let actualSha;
    try {
      const content = fs.readFileSync(labPath);
      actualSha = crypto.createHash('sha256').update(content).digest('hex');
    } catch (err) {
      findings.push({
        kind: 'source_staleness',
        severity: 'missing',
        file_id: file.id,
        lab_path: labPath,
        expected_sha256: file.sha256,
        actual_sha256: null,
        message: `Lab file not found: ${file.path}`
      });
      continue;
    }

    if (actualSha !== file.sha256) {
      findings.push({
        kind: 'source_staleness',
        severity: 'drift',
        file_id: file.id,
        lab_path: labPath,
        expected_sha256: file.sha256,
        actual_sha256: actualSha,
        message: `Lab file content differs from manifest sha256 (file may have been modified)`
      });
    }
    // ok → not emitted unless verbose
  }

  return findings;
}

/**
 * Build summary from findings array.
 * @param {object[]} findings
 * @returns {object} summary
 */
function buildSummary(findings) {
  const driftFindings = findings.filter(f => f.severity !== 'ok');
  const byKind = {};
  const bySeverity = {};

  for (const f of driftFindings) {
    byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }

  return {
    total_findings: driftFindings.length,
    by_kind: byKind,
    by_severity: bySeverity
  };
}

// ---- Foundation check mode (Phase 4d) ----

/**
 * Run foundation check mode (--foundation-check [--gate]).
 * AC-13: standalone exits 0 (non-blocking).
 * AC-15: --gate exits 0 if all 9 pass, 1 otherwise.
 * D7: always emits "fundação sólida o suficiente?" in --gate mode.
 */
function runFoundationCheckMode(flags) {
  const useJson = flags.json;
  const gateMode = flags.gate;

  const projectPath = flags.project ? path.resolve(flags.project) : process.cwd();

  // Verify project exists
  if (!fs.existsSync(path.join(projectPath, '.soma'))) {
    const errObj = { error: { code: 'PROJECT_NOT_FOUND', message: `No .soma/ directory found at: ${projectPath}` }, schema: 'soma-foundation-check/v1', project: projectPath, foundation_layers: null, expansion_layers: null, criteria: [], summary: null, warnings: [] };
    if (useJson) {
      process.exitCode = 2;
      process.stdout.end(JSON.stringify(errObj, null, 2) + '\n');
    } else {
      process.stderr.write(`ERROR [PROJECT_NOT_FOUND]: No .soma/ directory found at: ${projectPath}\n`);
      process.exitCode = 2;
      process.stdout.end();
    }
    return;
  }

  const result = runFoundationCheck(projectPath);

  // Determine exit code
  let exitCode = 0;

  if (result.error) {
    // INVALID_LAYER → exit 1; others → exit 2
    if (result.error.code === 'INVALID_LAYER') {
      exitCode = 1;
    } else {
      exitCode = 2;
    }
  } else if (gateMode) {
    // D4: all 9 must pass; skipped/not-applicable do NOT count
    exitCode = (result.summary && result.summary.foundation_done) ? 0 : 1;
  } else {
    // AC-13: standalone is always non-blocking → exit 0
    exitCode = 0;
  }

  process.exitCode = exitCode;

  if (useJson) {
    const jsonOutput = JSON.stringify(result, null, 2) + '\n';
    if (gateMode) {
      // D7: emit rhetorical sentence AFTER JSON, before exit
      process.stdout.write(jsonOutput);
      process.stdout.end('fundação sólida o suficiente?\n');
    } else {
      process.stdout.end(jsonOutput);
    }
  } else {
    const humanOutput = formatHumanOutput(result);
    if (gateMode) {
      // D7: emit rhetorical sentence always in gate mode
      process.stdout.write(humanOutput);
      process.stdout.end('fundação sólida o suficiente?\n');
    } else {
      process.stdout.end(humanOutput);
    }
  }
}

// ---- Context routing check mode (Phase C-1) ----

/**
 * Scan .soma/CONTEXT.md routing table and validate each keyword→slug ref.
 * For each ref: checks module file exists + status is active.
 * Broken refs produce severity:warning findings (code: BROKEN_CONTEXT_ROUTING, D7 non-blocking).
 *
 * @param {string} projectPath - absolute path to project root
 * @returns {{ contextMdPresent: boolean, keywordsCount: number, brokenRefs: object[], findings: object[] }}
 */
function scanContextRouting(projectPath) {
  const contextMdPath = path.join(projectPath, '.soma', 'CONTEXT.md');
  const findings = [];
  const brokenRefs = [];

  if (!fs.existsSync(contextMdPath)) {
    return { contextMdPresent: false, keywordsCount: 0, brokenRefs: [], findings: [] };
  }

  // Parse CONTEXT.md using same auto-load-modules.cjs parser
  const autoLoadPath = path.join(os.homedir(), '.claude', 'hooks', 'lib', 'auto-load-modules.cjs');
  let parseContextMd;
  try {
    parseContextMd = require(autoLoadPath).parseContextMd;
  } catch (e) {
    // auto-load-modules.cjs not installed — emit error finding but exit 0
    findings.push({
      severity: 'warning',
      code: 'CONTEXT_MD_PARSE_ERROR',
      message: `auto-load-modules.cjs not found at ${autoLoadPath}: ${e.message}`,
    });
    return { contextMdPresent: true, keywordsCount: 0, brokenRefs: [], findings };
  }

  let raw;
  try { raw = fs.readFileSync(contextMdPath, 'utf8'); }
  catch (e) {
    findings.push({
      severity: 'warning',
      code: 'CONTEXT_MD_PARSE_ERROR',
      message: `Could not read .soma/CONTEXT.md: ${e.message}`,
    });
    return { contextMdPresent: true, keywordsCount: 0, brokenRefs: [], findings };
  }

  const { routes, valid, error } = parseContextMd(raw);
  if (!valid) {
    findings.push({
      severity: 'warning',
      code: 'CONTEXT_MD_PARSE_ERROR',
      message: `CONTEXT.md parse error: ${error}`,
    });
    return { contextMdPresent: true, keywordsCount: 0, brokenRefs: [], findings };
  }

  // Validate each route
  const { parseFrontMatter } = require(path.join(os.homedir(), '.soma-v2', 'scripts', 'lib', 'module-store.cjs'));
  for (const route of routes) {
    // C-fu-1: skip template placeholder rows — keyword or slug starting with '#' are
    // documentation examples in the greenfield CONTEXT.md template, not real routing entries.
    if (route.keyword.trim().startsWith('#') || route.slug.trim().startsWith('#')) continue;

    const modulePath = path.join(projectPath, '.soma', 'modules', `${route.slug}.md`);

    // Check module file exists
    if (!fs.existsSync(modulePath)) {
      const ref = { keyword: route.keyword, slug: route.slug, reason: 'module file not found' };
      brokenRefs.push(ref);
      findings.push({ severity: 'warning', code: 'BROKEN_CONTEXT_ROUTING', ...ref });
      continue;
    }

    // Check status is active
    let moduleContent;
    try { moduleContent = fs.readFileSync(modulePath, 'utf8'); }
    catch (e) {
      const ref = { keyword: route.keyword, slug: route.slug, reason: `module file unreadable: ${e.message}` };
      brokenRefs.push(ref);
      findings.push({ severity: 'warning', code: 'BROKEN_CONTEXT_ROUTING', ...ref });
      continue;
    }

    const { frontMatter, valid: fmValid } = parseFrontMatter(moduleContent);
    if (!fmValid || !frontMatter) {
      const ref = { keyword: route.keyword, slug: route.slug, reason: 'module front-matter not parseable' };
      brokenRefs.push(ref);
      findings.push({ severity: 'warning', code: 'BROKEN_CONTEXT_ROUTING', ...ref });
      continue;
    }

    const status = frontMatter.status || 'hypothesis';
    if (status !== 'active') {
      const ref = { keyword: route.keyword, slug: route.slug, reason: `status:${status} (not active)` };
      brokenRefs.push(ref);
      findings.push({ severity: 'warning', code: 'BROKEN_CONTEXT_ROUTING', ...ref });
    }
    // Active and exists → no finding
  }

  return { contextMdPresent: true, keywordsCount: routes.length, brokenRefs, findings };
}

/**
 * Run context routing check mode (--check-context-routing).
 * AC-13: iterates each keyword→slug ref in .soma/CONTEXT.md.
 * AC-14: broken refs emit severity:warning (BROKEN_CONTEXT_ROUTING). Doctor exits 0 (D7).
 */
function runContextRoutingMode(flags) {
  const useJson = flags.json;
  const projectPath = flags.project ? path.resolve(flags.project) : process.cwd();

  const { contextMdPresent, keywordsCount, brokenRefs, findings } = scanContextRouting(projectPath);

  // D7: always exits 0 (non-blocking — routing errors are UX issues, not data integrity)
  process.exitCode = 0;

  if (useJson) {
    const output = {
      schema: 'soma-doctor/v1',
      project: projectPath,
      context_routing: {
        context_md_present: contextMdPresent,
        keywords_count: keywordsCount,
        broken_refs: brokenRefs,
      },
      findings,
      error: null,
    };
    process.stdout.end(JSON.stringify(output, null, 2) + '\n');
  } else {
    process.stdout.write(`SOMA doctor — context routing check for ${projectPath}\n\n`);
    if (!contextMdPresent) {
      process.stdout.write('INFO: No .soma/CONTEXT.md found — nothing to check.\n');
    } else if (brokenRefs.length === 0) {
      process.stdout.write(`OK: ${keywordsCount} routing entries verified — no broken refs.\n`);
    } else {
      process.stdout.write(`WARNINGS: ${brokenRefs.length} broken routing ref(s):\n`);
      for (const ref of brokenRefs) {
        process.stdout.write(`  [warning] ${ref.keyword} → ${ref.slug}: ${ref.reason}\n`);
      }
    }
    process.stdout.end();
  }
}

// ---- Migration check mode (Phase 5, --check-migration) ----

/**
 * Run migration-check-only mode (--check-migration [--check-migration=false]).
 *
 * Pure read-only check: load manifest, compute install-targets summary, run
 * optional migration scan. Skip drift detection entirely.
 *
 * Exit codes:
 *   0 — manifest valid (even if migration_needed=true → WARNING, non-fatal)
 *   2 — MANIFEST_MISSING or hard error
 *
 * @spec AC-10 AC-11 AC-12
 * @contract CONTRACT-011-03-doctor-migration-check
 *
 * @param {object} flags
 */
function runMigrationCheckMode(flags) {
  const useJson = flags.json;
  const somaHome = flags.somaHome || process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');

  // Load manifest (hard error)
  let manifest;
  try {
    manifest = loadManifest(somaHome);
  } catch (err) {
    emitError(err.code || 'MANIFEST_INVALID', err.message, useJson);
    return;
  }

  // Discover adapters + compute install-targets summary
  const adapters = listAdapters(somaHome);
  const itSummary = computeInstallTargetsSummary(somaHome, adapters);

  // Run migration scan (only if flag is true)
  let migrationCheck = null;
  const warnings = [];

  if (flags.checkMigration) {
    migrationCheck = runMigrationCheck();
    if (migrationCheck.migration_needed) {
      warnings.push({
        level: 'WARNING',
        code: 'MIGRATION_NEEDED',
        message: `${migrationCheck.old_markers_detected} OLD-format markers detected. Migration is OPTIONAL (coexist mode functional). Use --migrate flag with sync --apply to convert.`,
      });
    }
  }

  // Build checks object
  const checks = {
    manifest_valid: true,
    install_targets_valid: itSummary.valid,
    adapters_count: adapters.length,
    install_targets_count: itSummary.count,
    ...(migrationCheck !== null ? { migration_check: migrationCheck } : {}),
  };

  // Exit 0: migration issues are WARNING level (non-fatal, coexist mode)
  process.exitCode = 0;

  if (useJson) {
    const output = {
      checks,
      errors: [],
      warnings,
      exit_code: 0,
    };
    process.stdout.end(JSON.stringify(output, null, 2) + '\n');
  } else {
    process.stdout.write(`SOMA doctor — migration check for ${somaHome}\n\n`);
    if (migrationCheck && migrationCheck.migration_needed) {
      process.stdout.write(`WARNING: ${migrationCheck.old_markers_detected} OLD-format marker(s) detected.\n`);
      process.stdout.write(`Hint: ${migrationCheck.migration_command_hint}\n`);
    } else if (migrationCheck) {
      process.stdout.write(`OK: No OLD-format markers detected in ${migrationCheck.scanned_files.length} scanned file(s).\n`);
    } else {
      process.stdout.write(`OK: Migration scan skipped (--check-migration=false).\n`);
    }
    process.stdout.end();
  }
}

// ---- Install-targets summary (for checks object) ----

/**
 * Compute aggregate install-targets summary across all adapters.
 * Returns total entry count and a validity flag.
 *
 * @param {string} somaHome
 * @param {string[]} adapters
 * @returns {{ count: number, valid: boolean }}
 */
function computeInstallTargetsSummary(somaHome, adapters) {
  let count = 0;
  let valid = true;

  for (const adapter of adapters) {
    try {
      const data = loadInstallTargets(somaHome, adapter);
      count += data.entries.length;
    } catch (err) {
      if (err.code === 'INSTALL_TARGETS_INVALID') {
        // Adapter present but targets file invalid or missing → mark invalid
        valid = false;
      }
      // Other errors propagate
    }
  }

  return { count, valid };
}

// ---- Main ----

function main() {
  const { flags, errors } = parseArgs(process.argv.slice(2));
  const useJson = flags.json;

  if (errors.length > 0) {
    if (useJson) {
      process.exitCode = 2;
      process.stdout.end(JSON.stringify({ error: 'INVALID_ARGS', message: errors.join('; ') }, null, 2) + '\n');
    } else {
      process.stderr.write(`ERROR [INVALID_ARGS]: ${errors.join('; ')}\n`);
      process.exit(2);
    }
    return;
  }

  // Route to foundation-check mode if flag present (Phase 4d)
  if (flags.foundationCheck) {
    runFoundationCheckMode(flags);
    return;
  }

  // Route to context-routing check mode if flag present (Phase C-1)
  if (flags.checkContextRouting) {
    runContextRoutingMode(flags);
    return;
  }

  // Route to migration check mode when --check-migration is explicitly passed (Phase 5, AC-10)
  // Pure scan mode: skips drift detection, always exits 0 (WARNING level for migration issues).
  if (flags.checkMigrationExplicit) {
    runMigrationCheckMode(flags);
    return;
  }

  const somaHome = flags.somaHome || process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
  const projectPath = flags.project || null;
  // T-06: file-drift ledger root — CONTRACT-FILES-LEDGER-02's
  // `<projectPathAbs>/.soma/install-state.json`. Unlike projectPath above
  // (which stays null when --project is omitted, and skips the stale-
  // hypothesis scan entirely), this defaults to process.cwd() to match
  // install.cjs/sync.cjs's own convention (sync.cjs:748 comment block,
  // install.cjs:841 `runStep(..., { cwd: projectPathAbs })`) — the file
  // ledger always has SOME project root, there is no "skip if absent" case
  // for it the way stale-hypothesis scanning has.
  const projectPathAbs = flags.project ? path.resolve(flags.project) : process.cwd();

  // Load manifest
  let manifest;
  try {
    manifest = loadManifest(somaHome);
  } catch (err) {
    emitError(err.code || 'MANIFEST_INVALID', err.message, useJson);
    return;
  }

  // Discover adapters
  const adapters = listAdapters(somaHome);

  // Compute install-targets summary (for checks object, AC-20 context)
  const itSummary = computeInstallTargetsSummary(somaHome, adapters);

  // Detect drifts
  const targetDriftFindings = detectTargetDrifts(somaHome, adapters);
  const stalenessFindings = detectSourceStaleness(somaHome, manifest);

  // AC-08: Detect stale hypothesis modules (non-blocking warnings, D6)
  // Only scan if --project is provided (doctor needs to know which project to scan)
  const staleHypothesisFindings = projectPath ? scanStaleHypothesis(projectPath) : [];

  // AC-08/AC-09/AC-10: file-drift findings (Spec 018, T-06).
  const fileDriftFindings = detectFileDrifts(somaHome, adapters, projectPathAbs);

  const allFindings = [...targetDriftFindings, ...stalenessFindings, ...staleHypothesisFindings, ...fileDriftFindings];

  // Filter based on verbosity
  let outputFindings;
  if (useJson) {
    // JSON mode: always emit all
    outputFindings = allFindings;
  } else if (flags.verbose) {
    outputFindings = allFindings;
  } else if (flags.quiet) {
    // quiet: only show actionable findings
    outputFindings = allFindings.filter(f => f.severity !== 'ok');
  } else {
    // default: show non-ok findings
    outputFindings = allFindings.filter(f => f.severity !== 'ok');
  }

  // For exit code: warnings (stale_hypothesis) are non-blocking per D6
  // driftFindings excludes 'ok' and 'warning' severity for exit code calculation
  const driftFindings = allFindings.filter(f => f.severity !== 'ok' && f.severity !== 'warning');
  const summary = buildSummary(allFindings);

  // Build checks object — added in Phase 5 for install-targets introspection (AC-20 context)
  // Migration check lives in runMigrationCheckMode (--check-migration explicit flag)
  const checks = {
    manifest_valid: true,
    install_targets_valid: itSummary.valid,
    adapters_count: adapters.length,
    install_targets_count: itSummary.count,
  };

  const exitCode = driftFindings.length > 0 ? 1 : 0;
  process.exitCode = exitCode;

  if (useJson) {
    const output = {
      tool: 'doctor',
      mode: 'check',
      soma_home: somaHome,
      summary,
      findings: outputFindings,
      checks,
      errors: [],
      warnings: [],
      exit_code: exitCode,
    };
    process.stdout.end(JSON.stringify(output, null, 2) + '\n');
  } else {
    // Human output
    process.stdout.write(`SOMA doctor — checking ${somaHome} vs canonical sources\n\n`);

    const warningFindings = allFindings.filter(f => f.severity === 'warning');
    if (driftFindings.length === 0 && warningFindings.length === 0) {
      process.stdout.write('OK: No drift detected.\n');
    } else {
      if (driftFindings.length > 0) {
        process.stdout.write(`DRIFT: ${driftFindings.length} finding(s)\n`);
      }
      if (warningFindings.length > 0) {
        // T-06: was hardcoded to "stale-hypothesis module(s)", which is now
        // false for the AC-10 file_never_installed warning this task adds
        // (and would have been misleading for any other future warning
        // kind too) — genericized to the count only; each finding's own
        // message is still printed individually in the loop below.
        process.stdout.write(`WARNINGS: ${warningFindings.length} warning(s)\n`);
      }
      for (const f of outputFindings) {
        if (f.severity === 'ok' && !flags.verbose) continue;
        const label = humanSeverityLabel(f.severity);
        if (f.target_path) {
          const shortTarget = f.target_path.replace(os.homedir(), '~');
          process.stdout.write(`  ${label}   ${shortTarget} ← ${f.target_anchor_id}\n`);
        } else if (f.code === 'stale_hypothesis') {
          process.stdout.write(`  ${label}   [stale_hypothesis] module "${f.module}" is ${f.age_days}d old in hypothesis status\n`);
        } else {
          process.stdout.write(`  ${label}   ${f.message}\n`);
        }
      }
      if (driftFindings.length > 0) {
        process.stdout.write('\nRun `node ~/.soma-v2/scripts/sync.cjs --dry-run` to preview repair actions.\n');
      }
    }
    process.stdout.end();
  }
}

// ---- Exports for programmatic use (Phase 008 AD-02) ----
// bootstrap.cjs requires these to run doctor checks in-memory (no fork overhead).
// Guard main() to avoid running when required programmatically.

if (require.main === module) {
  main();
}

module.exports = {
  scanContextRouting,
  detectTargetDrifts,
  detectFileDrifts,
  detectSourceStaleness,
  buildSummary,
};
