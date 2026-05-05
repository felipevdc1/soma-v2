/**
 * T-19: E2E integration smoke — full pipeline
 * init → module add×3 (incl. --with-snippet) → promote 1 → deprecate 1 → remove 1 → doctor
 *
 * Validates full pipeline per CONTRACT-MODULE-CMDS-01
 * @spec AC-01..AC-15
 * @contract CONTRACT-MODULE-CMDS-01
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_REPO = path.join(os.homedir(), '.soma-v2');

function runMod(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/module.cjs'), ...args], {
    cwd: SOMA_REPO, env: { ...process.env, ...env }, encoding: 'utf8'
  });
}

function runDoctor(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/doctor.cjs'), ...args], {
    cwd: SOMA_REPO, env: { ...process.env, ...env }, encoding: 'utf8'
  });
}

function runInit(projectPath) {
  return spawnSync(
    'node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, projectPath],
    { cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8' }
  );
}

test('T-19: E2E full pipeline — init → add×3 → promote → deprecate → remove → doctor', () => {
  // Setup: synthetic SOMA project
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-e2e-'));
  const initResult = runInit(projectPath);
  assert.equal(initResult.status, 0, `init must succeed. stderr: ${initResult.stderr}`);

  // Step 1: module add×3 (one with --with-snippet)
  const r1 = runMod(['add', 'auth-service', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r1.status, 0, `add auth-service failed: ${r1.stderr}`);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.slug, 'auth-service');
  assert.equal(out1.status, 'hypothesis');
  assert.equal(out1.snippet_path, null); // no snippet

  const r2 = runMod(['add', 'billing-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  assert.equal(r2.status, 0, `add billing-system failed: ${r2.stderr}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.slug, 'billing-system');
  assert.ok(out2.snippet_path, 'snippet_path must be non-null with --with-snippet');
  assert.ok(fs.existsSync(out2.snippet_path), 'snippet file must exist');

  const r3 = runMod(['add', 'legacy-monolith', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r3.status, 0, `add legacy-monolith failed: ${r3.stderr}`);

  // Verify all 3 modules exist
  assert.ok(fs.existsSync(path.join(projectPath, '.soma/modules/auth-service.md')));
  assert.ok(fs.existsSync(path.join(projectPath, '.soma/modules/billing-system.md')));
  assert.ok(fs.existsSync(path.join(projectPath, '.soma/modules/legacy-monolith.md')));

  // Step 2: promote auth-service (hypothesis → active)
  const r4 = runMod(['promote', 'auth-service', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r4.status, 0, `promote auth-service failed: ${r4.stderr}`);
  const out4 = JSON.parse(r4.stdout);
  assert.equal(out4.from_status, 'hypothesis');
  assert.equal(out4.to_status, 'active');
  // Verify file updated
  const authContent = fs.readFileSync(path.join(projectPath, '.soma/modules/auth-service.md'), 'utf8');
  assert.ok(authContent.includes('status: active'));
  assert.ok(authContent.match(/promoted_at: "/));

  // Step 3: deprecate legacy-monolith
  const r5 = runMod(['deprecate', 'legacy-monolith', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r5.status, 0, `deprecate legacy-monolith failed: ${r5.stderr}`);
  const out5 = JSON.parse(r5.stdout);
  assert.equal(out5.to_status, 'deprecated');
  // File still exists
  assert.ok(fs.existsSync(path.join(projectPath, '.soma/modules/legacy-monolith.md')));
  const legacyContent = fs.readFileSync(path.join(projectPath, '.soma/modules/legacy-monolith.md'), 'utf8');
  assert.ok(legacyContent.includes('status: deprecated'));

  // Step 4: remove billing-system (with snippet, --yes)
  const snippetPath = out2.snippet_path;
  assert.ok(fs.existsSync(snippetPath), 'snippet must exist before remove');
  const r6 = runMod(['remove', 'billing-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--yes', '--json']);
  assert.equal(r6.status, 0, `remove billing-system failed: ${r6.stderr}`);
  assert.ok(!fs.existsSync(path.join(projectPath, '.soma/modules/billing-system.md')), 'module deleted');
  assert.ok(!fs.existsSync(snippetPath), 'snippet deleted with module');

  // Step 5: doctor check — freshly created modules are NOT stale (all < 90d)
  const r7 = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  assert.ok(r7.status !== null, 'doctor must exit');
  const outDoc = JSON.parse(r7.stdout);
  const staleFindings = (outDoc.findings || []).filter(f => f.code === 'stale_hypothesis');
  // Fresh modules should NOT produce stale_hypothesis findings
  assert.equal(staleFindings.length, 0, 'freshly created modules must not produce stale_hypothesis');

  // Step 6: verify error paths
  // promote already-active
  const r8 = runMod(['promote', 'auth-service', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r8.status, 1);
  assert.equal(JSON.parse(r8.stdout).error.code, 'ALREADY_ACTIVE');

  // add with reserved slug
  const r9 = runMod(['add', 'config', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r9.status, 1);
  assert.equal(JSON.parse(r9.stdout).error.code, 'RESERVED_SLUG');

  // promote non-existent
  const r10 = runMod(['promote', 'does-not-exist', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r10.status, 1);
  assert.equal(JSON.parse(r10.stdout).error.code, 'MODULE_NOT_FOUND');

  // Cleanup snippet if created in SOMA_REPO
  if (snippetPath && !fs.existsSync(snippetPath)) {
    // already deleted — good
  }
});

test('T-19: E2E stale-hypothesis via doctor after backdating', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-e2e-stale-'));
  runInit(projectPath);

  // Add a module
  const r = runMod(['add', 'old-module', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);

  // Backdate initialized_at by 100 days
  const modulePath = out.module_path;
  const content = fs.readFileSync(modulePath, 'utf8');
  const staleDate = new Date(Date.now() - 100 * 86400000).toISOString();
  fs.writeFileSync(modulePath, content.replace(/initialized_at: "[^"]*"/, `initialized_at: "${staleDate}"`), 'utf8');

  // Doctor should find it
  const docR = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  const docOut = JSON.parse(docR.stdout);
  const staleFinding = (docOut.findings || []).find(f => f.code === 'stale_hypothesis' && f.module === 'old-module');
  assert.ok(staleFinding, 'must find stale_hypothesis for old-module');
  assert.ok(staleFinding.age_days >= 100, `age_days must be >= 100, got ${staleFinding.age_days}`);
  // Doctor exits 0 or 1 (not 2 — D6 non-blocking)
  assert.ok(docR.status === 0 || docR.status === 1, `Doctor must exit 0 or 1, got ${docR.status}`);

  // Promote it → should no longer be stale
  runMod(['promote', 'old-module', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const docR2 = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  const docOut2 = JSON.parse(docR2.stdout);
  const staleFinding2 = (docOut2.findings || []).find(f => f.code === 'stale_hypothesis' && f.module === 'old-module');
  assert.ok(!staleFinding2, 'promoted module must not appear as stale_hypothesis');
});
