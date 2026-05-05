/**
 * AC-08: doctor surfaces stale_hypothesis warning for modules ≥90d old; exit 0 non-blocking
 * @spec AC-08
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_REPO = path.join(os.homedir(), '.soma-v2');

function runDoctor(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/doctor.cjs'), ...args], {
    cwd: SOMA_REPO, env: { ...process.env, ...env }, encoding: 'utf8'
  });
}

function runMod(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/module.cjs'), ...args], {
    cwd: SOMA_REPO, env: { ...process.env, ...env }, encoding: 'utf8'
  });
}

function setupProject() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac08-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

// Creates a module with backdated initialized_at (91 days ago)
function createStaleModule(projectPath, slug) {
  const r = runMod(['add', slug, `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `add ${slug} failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const modulePath = out.module_path;
  const content = fs.readFileSync(modulePath, 'utf8');
  const staleDate = new Date(Date.now() - 91 * 86400000).toISOString();
  const updated = content.replace(/initialized_at: "[^"]*"/, `initialized_at: "${staleDate}"`);
  fs.writeFileSync(modulePath, updated, 'utf8');
  return modulePath;
}

test('AC-08: doctor finds stale_hypothesis warning for module ≥90d old', () => {
  const projectPath = setupProject();
  createStaleModule(projectPath, 'old-hyp');
  const r = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  // Doctor may exit 0 or 1 (real SOMA home may have drift findings)
  // but stale-hypothesis warnings must NOT cause exit 2 (hard error per D6)
  assert.ok(r.status !== null, 'doctor must exit');
  assert.ok(r.status === 0 || r.status === 1,
    `Doctor must exit 0 (no drift) or 1 (drift findings), not 2 (hard error). Got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const staleFindings = (out.findings || []).filter(f => f.code === 'stale_hypothesis');
  assert.ok(staleFindings.length >= 1, `Expected at least 1 stale_hypothesis finding. Findings: ${JSON.stringify(out.findings)}`);
  const finding = staleFindings[0];
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.code, 'stale_hypothesis');
  assert.ok(finding.module, 'finding must have module slug');
  assert.ok(finding.age_days >= 90, `Expected age_days >= 90, got ${finding.age_days}`);
});

test('AC-08: doctor does NOT emit stale_hypothesis for fresh module (<90d)', () => {
  const projectPath = setupProject();
  runMod(['add', 'fresh-hyp', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  const out = JSON.parse(r.stdout);
  const staleFindings = (out.findings || []).filter(f => f.code === 'stale_hypothesis' && f.module === 'fresh-hyp');
  assert.equal(staleFindings.length, 0, 'fresh module must not produce stale_hypothesis warning');
});

test('AC-08: doctor does NOT emit stale_hypothesis for promoted (active) module', () => {
  const projectPath = setupProject();
  createStaleModule(projectPath, 'old-active');
  // Promote it
  runMod(['promote', 'old-active', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  const out = JSON.parse(r.stdout);
  const staleFindings = (out.findings || []).filter(f => f.code === 'stale_hypothesis' && f.module === 'old-active');
  assert.equal(staleFindings.length, 0, 'active module must not produce stale_hypothesis warning');
});

test('AC-08: stale_hypothesis finding includes slug and age_days', () => {
  const projectPath = setupProject();
  createStaleModule(projectPath, 'age-check');
  const r = runDoctor(['--json', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`]);
  const out = JSON.parse(r.stdout);
  const finding = (out.findings || []).find(f => f.code === 'stale_hypothesis' && f.module === 'age-check');
  assert.ok(finding, 'must find stale_hypothesis for age-check');
  assert.ok(typeof finding.age_days === 'number', 'age_days must be a number');
  assert.ok(finding.age_days >= 91, `age_days must be ≥91, got ${finding.age_days}`);
  assert.ok(finding.initialized_at, 'finding must include initialized_at');
});
