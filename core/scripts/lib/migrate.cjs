'use strict';
/**
 * Migration library for cbm deprecation (Spec 013).
 *
 * @spec core/specs/013-cbm-deprecation/spec.md
 * @issue #9
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * Frozen libs baseline: name → expected SHA256. Must not be modified
 * without updating the spec and bumping SOMA version.
 */
const FROZEN_LIBS_BASELINE = {
  'anchored-blocks.cjs': '6db9bbcbe811b8b0e338d4bf199b969688744d7267ca2dec9a6f59f20c1a167f',
  'manifest.cjs':        '08a0f164c16bf6152d57ab737c5471d86439724d2e563abde4b8764944800462',
  'template-engine.cjs': 'f13ae144e88bb7ef6f2c0ec101eeab8ad7eb778a0eaeb9b960997ca96df14d8b',
};

/**
 * Compute frozen libs check: compare each lib against baseline SHA256.
 * Returns {match: boolean, drift: string[]}.
 *
 * @param {string} somaHome
 * @returns {{match: boolean, drift: string[]}}
 */
function computeFrozenLibsCheck(somaHome) {
  const drift = [];
  for (const [file, expectedSha] of Object.entries(FROZEN_LIBS_BASELINE)) {
    const fpath = require('node:path').join(somaHome, 'scripts', 'lib', file);
    if (!fs.existsSync(fpath)) {
      drift.push(`${file} missing`);
      continue;
    }
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(fpath)).digest('hex');
    if (actualSha !== expectedSha) drift.push(`${file} (${actualSha} != ${expectedSha})`);
  }
  return { match: drift.length === 0, drift };
}

/**
 * Extract content between <!-- codebase-memory-mcp:start --> and <!-- codebase-memory-mcp:end -->
 * markers from a target file. Returns null if file missing or markers not found.
 *
 * @param {string} labAgentsPath — absolute path to lab AGENTS.md
 * @returns {string|null}
 */
exports.extractMcpContentFromLab = function(labAgentsPath) {
  if (!fs.existsSync(labAgentsPath)) return null;
  const content = fs.readFileSync(labAgentsPath, 'utf8');
  const startPattern = /<!--\s*codebase-memory-mcp:start\s*-->/;
  const endPattern = /<!--\s*codebase-memory-mcp:end\s*-->/;
  const startMatch = content.match(startPattern);
  const endMatch = content.match(endPattern);
  if (!startMatch || !endMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = endMatch.index;
  return content.slice(startIdx, endIdx).replace(/^\n/, '').replace(/\n$/, '');
};

/**
 * Remove a legacy `<!-- {markerName}:start -->...<!-- {markerName}:end -->` block from content.
 * Idempotent: returns content unchanged if marker not present.
 *
 * @param {string} content
 * @param {string} markerName — e.g., "codebase-memory-mcp"
 * @returns {string}
 */
exports.deleteLegacyBlock = function(content, markerName) {
  const escaped = markerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\n?<!--\\s*${escaped}:start\\s*-->[\\s\\S]*?<!--\\s*${escaped}:end\\s*-->\\n?`, 'g');
  return content.replace(pattern, '\n');
};

/**
 * Rename a soma-v2 anchor: change ID + sha256 in start marker, change ID in end marker.
 * Inner content untouched.
 *
 * @param {string} content
 * @param {string} oldId
 * @param {string} newId
 * @param {string} newSha
 * @returns {string}
 */
exports.renameAnchor = function(content, oldId, newId, newSha) {
  const escapedOld = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`(<!--\\s*soma-v2:start\\s+id=)${escapedOld}(\\s+version=[^\\s]+\\s+sha256=)[^\\s]+(\\s*-->)`, 'g');
  const endPattern = new RegExp(`(<!--\\s*soma-v2:end\\s+id=)${escapedOld}(\\s*-->)`, 'g');
  return content
    .replace(startPattern, `$1${newId}$2${newSha}$3`)
    .replace(endPattern, `$1${newId}$2`);
};

/**
 * Atomic write via tmp file + POSIX rename. Either succeeds entirely or leaves
 * target file unchanged.
 *
 * @param {string} filePath — absolute path
 * @param {string} content — string content to write
 * @throws {Error} on write or rename failure
 */
exports.atomicWrite = function(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Cleanup tmp on failure
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    throw err;
  }
};

const path = require('node:path');

/**
 * Create migration snapshot at ~/.soma-v2/.snapshots/{ISO-8601-Z}-cbm-deprecation/
 * Copies each file in `files` array to snapshot dir preserving basename.
 *
 * @param {string} somaHome
 * @param {string[]} files — absolute paths to snapshot
 * @returns {string} snapshotId
 */
exports.createMigrationSnapshot = function(somaHome, files) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const snapshotId = `${ts}-cbm-deprecation`;
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const fileMap = {};
  for (const file of files) {
    if (fs.existsSync(file)) {
      const absPath = path.resolve(file);
      const pathHash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 8);
      const snapshotFile = path.basename(file) + '.' + pathHash + '.snapshot';
      const dest = path.join(snapshotDir, snapshotFile);
      fs.copyFileSync(file, dest);
      fileMap[snapshotFile] = file;
    }
  }
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify({ files: fileMap }, null, 2));
  return snapshotId;
};

/**
 * Restore files from a named snapshot. Reads snapshot/manifest.json for file→target mapping.
 *
 * @param {string} somaHome
 * @param {string} snapshotId
 * @throws {Error} if snapshot dir or manifest missing
 */
exports.rollbackFromSnapshot = function(somaHome, snapshotId) {
  const snapshotDir = path.join(somaHome, '.snapshots', snapshotId);
  if (!fs.existsSync(snapshotDir)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Snapshot manifest missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [snapshotFile, target] of Object.entries(manifest.files)) {
    const src = path.join(snapshotDir, snapshotFile);
    if (fs.existsSync(src)) {
      exports.atomicWrite(target, fs.readFileSync(src, 'utf8'));
    }
  }
};

const { spawnSync } = require('node:child_process');

/**
 * Verify migration by running doctor.cjs in target somaHome.
 * Returns {ok: boolean, findings: string[]}.
 *
 * @param {string} somaHome
 * @returns {{ok: boolean, findings: string[]}}
 */
exports.verifyMigration = function(somaHome) {
  const doctorPath = path.join(somaHome, 'scripts', 'doctor.cjs');
  if (!fs.existsSync(doctorPath)) {
    return { ok: false, findings: [`doctor.cjs not found at ${doctorPath}`] };
  }
  const result = spawnSync('node', [doctorPath], { cwd: somaHome, encoding: 'utf8' });
  const findings = (result.stdout + result.stderr)
    .split('\n')
    .filter(l => l.includes('[drift]') || l.includes('DRIFT:'));
  const driftCount = findings.find(l => /DRIFT: (\d+) finding/.exec(l));
  const count = driftCount ? parseInt(/DRIFT: (\d+) finding/.exec(driftCount)[1], 10) : 0;
  return { ok: count === 0, findings };
};

/**
 * Run pre-flight gates G1-G6. Returns {gates: {...}, action: 'proceed'|'noop'|'abort', failures: []}.
 *
 * @param {object} ctx — { lab, install, frozenLibs, contentMismatch, force, somaHome }
 * @returns {{gates: object, action: string, failures: string[]}}
 */
exports.preFlightGates = function(ctx = {}) {
  const gates = {};
  const failures = [];

  // G1: lab files exist (graceful — only fail if ALL three are missing)
  const labFiles = [ctx.lab?.claudeMd, ctx.lab?.codexAgents, ctx.lab?.homeAgents].filter(Boolean);
  const existingLabs = labFiles.filter(f => fs.existsSync(f));
  gates.G1 = existingLabs.length > 0 ? 'pass' : 'noop';

  // G2: idempotency check
  const hasCbm = ctx.install?.hasCbm ?? false;
  const hasLegacy = ctx.install?.hasLegacy ?? false;
  gates.G2 = (hasCbm || hasLegacy) ? 'pass' : 'noop';

  // G3: content alignment
  if (ctx.contentMismatch && !ctx.force) {
    gates.G3 = 'fail';
    failures.push('G3: lab MCP doc differs from spec extraction. Use --force to override.');
  } else {
    gates.G3 = 'pass';
  }

  // G4: lock file
  if (ctx.somaHome) {
    const lockFile = path.join(ctx.somaHome, '.migration.lock');
    if (fs.existsSync(lockFile)) {
      gates.G4 = 'fail';
      failures.push(`G4: another migration running (lock at ${lockFile})`);
    } else {
      gates.G4 = 'pass';
    }
  } else {
    gates.G4 = 'pass';
  }

  // G5: snapshot disk space (≥1MB free)
  const G5_MIN_BYTES = 1024 * 1024; // 1 MB
  let availableBytes;
  if (typeof ctx.diskSpaceOverride === 'number') {
    // Test injection point — allows fail-path testing without filling disk
    availableBytes = ctx.diskSpaceOverride;
  } else if (ctx.somaHome && fs.existsSync(ctx.somaHome)) {
    try {
      const stats = fs.statfsSync(ctx.somaHome); // Node 18+
      availableBytes = stats.bavail * stats.bsize;
    } catch (err) {
      // statfsSync may not be available on all platforms — fall back to permissive pass
      availableBytes = G5_MIN_BYTES;
    }
  } else {
    // No somaHome to check — permissive pass (G1/G2 handle missing somaHome scenarios)
    availableBytes = G5_MIN_BYTES;
  }
  if (availableBytes < G5_MIN_BYTES) {
    gates.G5 = 'fail';
    failures.push(`G5: insufficient disk space (${availableBytes} bytes available, ${G5_MIN_BYTES} required)`);
  } else {
    gates.G5 = 'pass';
  }

  // G6: frozen libs match
  if (ctx.frozenLibs && !ctx.frozenLibs.match) {
    gates.G6 = 'fail';
    failures.push(`G6: frozen libs drifted: ${(ctx.frozenLibs.drift || []).join(', ')}`);
  } else {
    gates.G6 = 'pass';
  }

  // Determine action
  let action;
  if (gates.G1 === 'noop' || gates.G2 === 'noop') {
    action = 'noop';
  } else if (failures.length > 0) {
    action = 'abort';
  } else {
    action = 'proceed';
  }

  return { gates, action, failures };
};

/**
 * Main migration orchestration. Two-phase commit: snapshot → apply → verify or rollback.
 *
 * @param {object} opts — {somaHome, target, dryRun, force, revert}
 * @returns {{action, gates, snapshotId, failures}}
 */
exports.migrateCbmDeprecation = function(opts) {
  const { somaHome, target, dryRun = false, force = false, revert = null } = opts;

  // Revert path: just restore from named snapshot
  if (revert) {
    exports.rollbackFromSnapshot(somaHome, revert);
    return { action: 'reverted', snapshotId: revert };
  }

  // Pre-flight
  const ctx = buildPreFlightContext(somaHome, target, force);
  const gates = exports.preFlightGates(ctx);

  if (gates.action === 'noop') {
    return { action: 'noop', gates: gates.gates, message: 'Nothing to migrate' };
  }
  if (gates.action === 'abort') {
    return { action: 'abort', gates: gates.gates, failures: gates.failures };
  }

  // Dry run: report what would change, no mutations
  if (dryRun) {
    const preview = computePreview(target);
    return { action: 'dry-run', gates: gates.gates, preview };
  }

  // Phase 2: snapshot then mutate
  const filesToSnapshot = [target.claudeMd, target.codexAgents, target.homeAgents].filter(Boolean);
  const snapshotId = exports.createMigrationSnapshot(somaHome, filesToSnapshot);

  try {
    // Mutate each lab file
    if (target.claudeMd) migrateClaude(target.claudeMd);
    if (target.codexAgents) migrateCodexAgents(target.codexAgents);
    if (target.homeAgents) migrateCodexAgents(target.homeAgents);

    // Verify (skip if doctor.cjs not installed in somaHome — non-blocking)
    const verify = exports.verifyMigration(somaHome);
    const doctorMissing = verify.findings.some(f => f.includes('doctor.cjs not found'));
    if (!verify.ok && !doctorMissing) {
      throw new Error(`Verify failed: ${verify.findings.join('; ')}`);
    }

    return { action: 'completed', gates: gates.gates, snapshotId };
  } catch (err) {
    // Rollback
    exports.rollbackFromSnapshot(somaHome, snapshotId);
    return { action: 'rolled-back', gates: gates.gates, snapshotId, error: err.message };
  }
};

// Helpers

/**
 * Build pre-flight context by inspecting target files for cbm anchors and legacy markers.
 */
function buildPreFlightContext(somaHome, target, force) {
  const lab = {
    claudeMd: target.claudeMd || null,
    codexAgents: target.codexAgents || null,
    homeAgents: target.homeAgents || null,
  };

  const install = { hasCbm: false, hasLegacy: false };
  const filesToCheck = [target.claudeMd, target.codexAgents, target.homeAgents].filter(Boolean);
  for (const file of filesToCheck) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/id=block\.[^.]+\..*\.cbm/.test(content)) install.hasCbm = true;
    if (/<!--\s*codebase-memory-mcp:start\s*-->/.test(content)) install.hasLegacy = true;
  }

  return {
    lab,
    install,
    frozenLibs: computeFrozenLibsCheck(somaHome),
    somaHome,
    force,
  };
}

/**
 * Compute dry-run preview of mutations.
 */
function computePreview(target) {
  const changes = [];
  const filesToCheck = [target.claudeMd, target.codexAgents, target.homeAgents].filter(Boolean);
  for (const file of filesToCheck) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/id=block\.[^.]+\..*\.cbm/.test(content)) {
      changes.push({ file, action: 'rename-cbm-anchor' });
    }
    if (/<!--\s*codebase-memory-mcp:start\s*-->/.test(content)) {
      changes.push({ file, action: 'delete-legacy-block' });
    }
  }
  return { changes };
}

/**
 * Migrate CLAUDE.md: rename cbm → hyd-v2 anchor, delete legacy markers.
 */
function migrateClaude(claudeMdPath) {
  const content = fs.readFileSync(claudeMdPath, 'utf8');
  // Step 1: rename cbm → hyd-v2 anchor
  let mutated = exports.renameAnchor(
    content,
    'block.claude.CLAUDE_md.cbm',
    'block.claude.CLAUDE_md.hyd-v2',
    'migrated'
  );
  // Step 2: delete legacy codebase-memory-mcp markers if present
  mutated = exports.deleteLegacyBlock(mutated, 'codebase-memory-mcp');
  // Step 3: atomicWrite
  exports.atomicWrite(claudeMdPath, mutated);
}

/**
 * Migrate AGENTS.md: delete legacy codebase-memory-mcp markers.
 */
function migrateCodexAgents(agentsPath) {
  const content = fs.readFileSync(agentsPath, 'utf8');
  // Step 1: delete legacy markers OR existing soma-v2 anchor with cbm id
  let mutated = exports.deleteLegacyBlock(content, 'codebase-memory-mcp');
  mutated = exports.renameAnchor(
    mutated,
    'block.codex.AGENTS.cbm',
    'block.codex.AGENTS.codebase-memory-mcp',
    'migrated'
  );
  // Step 3: atomicWrite
  exports.atomicWrite(agentsPath, mutated);
}
