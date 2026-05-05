'use strict';
// @spec AC-07
// Integration test for end-to-end pipeline: init → doctor → sync --dry-run.
// Validates that a freshly init'd project has zero doctor findings and zero sync actionable.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');
const DOCTOR = path.join(SOMA_HOME, 'scripts', 'doctor.cjs');
const SYNC = path.join(SOMA_HOME, 'scripts', 'sync.cjs');

function mkSampleFixture() {
  const slug = crypto.randomBytes(4).toString('hex');
  const dir = path.join(os.tmpdir(), `soma-sample-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runScript(scriptPath, args = []) {
  return spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf8',
    timeout: 30000
  });
}

// ---- AC-07: init → doctor → sync pipeline ----

test('sample pipeline: init exit=0 with 6 files (--with-agents-md)', (t) => {
  const sample = mkSampleFixture();
  t.after(() => fs.rmSync(sample, { recursive: true, force: true }));

  const result = runScript(INIT, [sample, '--with-agents-md', '--json']);

  assert.equal(result.status, 0, `init must exit 0. stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  // 5 .soma/ files (4 template + manifest.json) + AGENTS.md = 6 total
  assert.equal(parsed.files_created.length, 6, 'init must create 6 files with --with-agents-md');
});

test('sample pipeline: doctor exit=0 with findings_count=0 on fresh init', (t) => {
  const sample = mkSampleFixture();
  t.after(() => fs.rmSync(sample, { recursive: true, force: true }));

  // Step 1: init
  runScript(INIT, [sample, '--with-agents-md', '--json']);

  // Step 2: doctor on the sample .soma/
  const doctorResult = runScript(DOCTOR, [`--soma-home=${path.join(sample, '.soma')}`, '--json']);

  assert.equal(doctorResult.status, 0, `doctor must exit 0. stderr: ${doctorResult.stderr}. stdout: ${doctorResult.stdout}`);

  const parsed = JSON.parse(doctorResult.stdout);
  // Check total_findings is 0 (the field name from doctor's buildSummary)
  assert.equal(
    parsed.summary.total_findings,
    0,
    `doctor must report 0 findings on fresh init. Got: ${JSON.stringify(parsed.summary)}`
  );
});

test('sample pipeline: sync --dry-run exit=0 with zero actionable on fresh init', (t) => {
  const sample = mkSampleFixture();
  t.after(() => fs.rmSync(sample, { recursive: true, force: true }));

  // Step 1: init
  runScript(INIT, [sample, '--with-agents-md', '--json']);

  // Step 2: sync --dry-run on the sample .soma/
  const syncResult = runScript(SYNC, ['--dry-run', `--soma-home=${path.join(sample, '.soma')}`, '--json']);

  assert.equal(syncResult.status, 0, `sync --dry-run must exit 0. stderr: ${syncResult.stderr}. stdout: ${syncResult.stdout}`);

  const parsed = JSON.parse(syncResult.stdout);
  // sync summary.by_action: actionable = insert + replace + drift (all should be 0 on fresh init)
  const byAction = parsed.summary.by_action;
  const actionable = (byAction.insert || 0) + (byAction.replace || 0) + (byAction.drift || 0);
  assert.equal(
    actionable,
    0,
    `sync --dry-run must report 0 actionable entries on fresh init. Got: ${JSON.stringify(parsed.summary)}`
  );
});

test('sample pipeline: full sequence init→doctor→sync all succeed', (t) => {
  const sample = mkSampleFixture();
  t.after(() => fs.rmSync(sample, { recursive: true, force: true }));

  // Step 1: init
  const initResult = runScript(INIT, [sample, '--with-agents-md', '--json']);
  assert.equal(initResult.status, 0, `init exit must be 0. stderr: ${initResult.stderr}`);

  // Step 2: doctor
  const somaHomeArg = `--soma-home=${path.join(sample, '.soma')}`;
  const doctorResult = runScript(DOCTOR, [somaHomeArg, '--json']);
  assert.equal(doctorResult.status, 0, `doctor exit must be 0. stdout: ${doctorResult.stdout}. stderr: ${doctorResult.stderr}`);

  // Step 3: sync --dry-run
  const syncResult = runScript(SYNC, ['--dry-run', somaHomeArg, '--json']);
  assert.equal(syncResult.status, 0, `sync --dry-run exit must be 0. stdout: ${syncResult.stdout}. stderr: ${syncResult.stderr}`);

  // Verify doctor and sync summaries
  const doctorParsed = JSON.parse(doctorResult.stdout);
  const syncParsed = JSON.parse(syncResult.stdout);

  assert.equal(doctorParsed.summary.total_findings, 0, 'doctor: zero findings');
  const byAction = syncParsed.summary.by_action;
  const actionable = (byAction.insert || 0) + (byAction.replace || 0) + (byAction.drift || 0);
  assert.equal(actionable, 0, 'sync: zero actionable');
});

test('sample pipeline: init creates valid .soma/ structure (all 6 files exist)', (t) => {
  const sample = mkSampleFixture();
  t.after(() => fs.rmSync(sample, { recursive: true, force: true }));

  runScript(INIT, [sample, '--with-agents-md', '--json']);

  const expectedFiles = [
    path.join(sample, '.soma', 'project.md'),
    path.join(sample, '.soma', 'CONTEXT.md'),
    path.join(sample, '.soma', 'modules', 'index.md'),
    path.join(sample, '.soma', 'installed-state.json'),
    path.join(sample, '.soma', 'manifest.json'),
    path.join(sample, 'AGENTS.md')
  ];

  for (const f of expectedFiles) {
    assert.ok(fs.existsSync(f), `Expected file to exist: ${f}`);
  }
});

test('sample pipeline: project .soma/manifest.json is valid (doctor can parse it)', (t) => {
  const sample = mkSampleFixture();
  t.after(() => fs.rmSync(sample, { recursive: true, force: true }));

  runScript(INIT, [sample, '--with-agents-md', '--json']);

  // Verify manifest.json exists and is valid JSON with correct schema
  const manifestPath = path.join(sample, '.soma', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must be created in project .soma/');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    assert.fail(`manifest.json is not valid JSON: ${e.message}`);
  }

  assert.equal(manifest.schema, 'soma-manifest/v1', 'manifest.schema must be soma-manifest/v1');
  assert.ok(Array.isArray(manifest.files), 'manifest.files must be an array');
  assert.equal(manifest.files.length, 0, 'manifest.files must be empty (no blocks to install)');
});
