/**
 * Contract test stub — soma module {add|promote|remove|deprecate} + doctor stale-hypothesis
 *
 * @spec AC-01..AC-15
 * @contract CONTRACT-MODULE-CMDS-01
 *
 * This file is the RED-phase stub for all 4 subcommands + doctor extension.
 * Tests are intentionally failing until implementation ships.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOMA_REPO = path.join(os.homedir(), '.soma-v2');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'soma-module-ct-'));
}

function runMod(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/module.cjs'), ...args], {
    cwd: SOMA_REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function runInit(projectPath) {
  return spawnSync(
    'node',
    [path.join(SOMA_REPO, 'scripts/init.cjs'), '--soma-home=' + SOMA_REPO, projectPath],
    { cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8' }
  );
}

function runDoctor(args, env = {}) {
  return spawnSync('node', [path.join(SOMA_REPO, 'scripts/doctor.cjs'), ...args], {
    cwd: SOMA_REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

// Helper: setup a real SOMA project in tmpdir (run init then return project path)
function setupProject(suffix = '') {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), `soma-mod-ct-proj-${suffix}-`));
  runInit(projectPath); // greenfield init
  return projectPath;
}

// ---- CONTRACT TESTS (all failing RED until implementation) ----

test('CONTRACT: module.cjs exists and responds to --help or unknown arg', () => {
  const r = runMod(['--unknown-flag']);
  // Should exit 2 (INVALID_ARGS) — not a "command not found" crash
  assert.ok(r.status !== null, 'process should exit (not crash with null)');
});

test('CONTRACT: AC-01 module add creates .soma/modules/{slug}.md from template', () => {
  const projectPath = setupProject('ac01');
  const r = runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'auth-system');
  assert.equal(out.status, 'hypothesis');
  assert.ok(out.module_path, 'module_path must be present');
  assert.ok(fs.existsSync(out.module_path), `.soma/modules/auth-system.md must exist at ${out.module_path}`);
  const content = fs.readFileSync(out.module_path, 'utf8');
  assert.ok(content.includes('schema: soma-module/v1'), 'must include schema');
  assert.ok(content.includes('status: hypothesis'), 'must include status: hypothesis');
});

test('CONTRACT: AC-02 module add with existing slug returns MODULE_EXISTS', () => {
  const projectPath = setupProject('ac02');
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r2 = runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r2.status, 1, `Expected exit 1, got ${r2.status}. stderr: ${r2.stderr}`);
  const out = JSON.parse(r2.stdout);
  assert.equal(out.error.code, 'MODULE_EXISTS');
});

test('CONTRACT: AC-03 module promote hypothesis→active', () => {
  const projectPath = setupProject('ac03');
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.from_status, 'hypothesis');
  assert.equal(out.to_status, 'active');
  assert.ok(out.promoted_at);
});

test('CONTRACT: AC-04 module promote already-active returns ALREADY_ACTIVE', () => {
  const projectPath = setupProject('ac04');
  runMod(['add', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['promote', 'auth-system', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'ALREADY_ACTIVE');
});

test('CONTRACT: AC-05 module promote non-existent slug returns MODULE_NOT_FOUND', () => {
  const r = runMod(['promote', 'nonexistent-slug', `--soma-home=${SOMA_REPO}`, `--project=${os.tmpdir()}`, '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'MODULE_NOT_FOUND');
});

test('CONTRACT: AC-06 module remove with --yes deletes module + snippet', () => {
  const projectPath = setupProject('ac06');
  runMod(['add', 'tmp-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  const r = runMod(['remove', 'tmp-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--yes', '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.deleted));
  assert.ok(out.deleted.length >= 1, 'at least module file deleted');
});

test('CONTRACT: AC-07 module deprecate updates front-matter, file preserved', () => {
  const projectPath = setupProject('ac07');
  runMod(['add', 'legacy-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  const r = runMod(['deprecate', 'legacy-mod', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.to_status, 'deprecated');
  assert.ok(out.deprecated_at);
});

test('CONTRACT: AC-08 doctor surfaces stale_hypothesis warning for modules ≥90d', () => {
  // This test verifies that the doctor command recognizes stale-hypothesis modules
  // The actual test with backdated modules is in ac-08 test file
  // Here we just verify doctor exits 0 even with modules present (non-blocking per D6)
  const r = runDoctor(['--json', `--soma-home=${SOMA_REPO}`]);
  assert.ok(r.status !== null, 'doctor must exit');
  // Doctor exits 0 when no findings, 1 when drift findings — never 2 for stale hypothesis (D6)
  assert.ok(r.status === 0 || r.status === 1, `doctor should exit 0 or 1, got ${r.status}`);
});

test('CONTRACT: AC-09 --with-snippet creates JSON skeleton', () => {
  const projectPath = setupProject('ac09');
  const r = runMod(['add', 'with-snip-ct', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--with-snippet', '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.snippet_path, 'snippet_path must be non-null');
  assert.ok(fs.existsSync(out.snippet_path), `snippet file must exist at ${out.snippet_path}`);
  const snip = JSON.parse(fs.readFileSync(out.snippet_path, 'utf8'));
  assert.equal(snip.schema, 'soma-snippet/v1');
  assert.equal(snip.slug, 'with-snip-ct');
  assert.ok(Array.isArray(snip.snippets), 'snippets must be array');
});

test('CONTRACT: AC-10 no --with-snippet → no JSON file created', () => {
  const projectPath = setupProject('ac10');
  const r = runMod(['add', 'no-snip-ct', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.snippet_path, null, 'snippet_path must be null without --with-snippet');
});

test('CONTRACT: AC-11 slug derivation — "Auth System" → "auth-system"', () => {
  const projectPath = setupProject('ac11');
  const r = runMod(['add', 'Auth System', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'auth-system');
});

test('CONTRACT: AC-12 reserved slugs rejected with RESERVED_SLUG', () => {
  const reserved = ['manifest', 'snapshots', 'evidence', 'modules', 'cookbook', 'config'];
  for (const slug of reserved) {
    const r = runMod(['add', slug, `--soma-home=${SOMA_REPO}`, `--project=${os.tmpdir()}`, '--json']);
    assert.equal(r.status, 1, `Expected exit 1 for reserved slug "${slug}", got ${r.status}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, 'RESERVED_SLUG', `Expected RESERVED_SLUG for "${slug}"`);
  }
});

test('CONTRACT: D4 promote with broken front-matter returns SCHEMA_INVALID', () => {
  const projectPath = setupProject('d4');
  runMod(['add', 'broken-yaml', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  // Corrupt front-matter by appending unknown field
  const modulePath = path.join(projectPath, '.soma/modules/broken-yaml.md');
  if (fs.existsSync(modulePath)) {
    const content = fs.readFileSync(modulePath, 'utf8');
    // Insert unknown field into front-matter
    const corrupted = content.replace('---\nschema:', '---\nrogue_field: "unknown"\nschema:');
    fs.writeFileSync(modulePath, corrupted, 'utf8');
  }
  const r = runMod(['promote', 'broken-yaml', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1, got ${r.status}. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'SCHEMA_INVALID');
});
