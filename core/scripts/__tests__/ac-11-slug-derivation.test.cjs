/**
 * AC-11: slug derivation rules — table-driven tests
 * @spec AC-11
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

function setupProject() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ac11-'));
  spawnSync('node', [path.join(SOMA_REPO, 'scripts/init.cjs'), `--soma-home=${SOMA_REPO}`, p], {
    cwd: SOMA_REPO, env: { ...process.env }, encoding: 'utf8'
  });
  return p;
}

// CLI-testable cases (no leading-dash keywords — those need '--' separator which changes flag parsing)
const slugCases = [
  { keyword: 'Auth System', expected: 'auth-system' },
  { keyword: 'foo  bar!', expected: 'foo-bar' },
  { keyword: 'trailing-', expected: 'trailing' },
  { keyword: 'ALLCAPS', expected: 'allcaps' },
  { keyword: 'foo/bar', expected: 'foo-bar' },
  { keyword: 'multiple---dashes', expected: 'multiple-dashes' },
  { keyword: 'with.dots', expected: 'with-dots' },
  { keyword: 'under_score', expected: 'under-score' },
];

test('AC-11: slug derivation table-driven cases via CLI', () => {
  const projectPath = setupProject();
  const used = new Set();
  for (const { keyword, expected } of slugCases) {
    if (used.has(expected)) continue; // skip if slug already created in this project
    used.add(expected);
    const r = runMod(['add', keyword, `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
    assert.equal(r.status, 0, `Expected exit 0 for keyword "${keyword}". stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.slug, expected, `Expected slug "${expected}" for keyword "${keyword}", got "${out.slug}"`);
  }
});

test('AC-11: slug derivation edge cases via deriveSlug function (leading dashes)', () => {
  // Leading-dash keywords are handled by the deriveSlug function directly
  // (CLI users would use -- separator: `module add -- --leading-dash ...`)
  const { deriveSlug } = require(path.join(SOMA_REPO, 'scripts/lib/module-store.cjs'));
  assert.equal(deriveSlug('--leading-dash'), 'leading-dash', '--leading-dash → leading-dash');
  assert.equal(deriveSlug('-single-dash'), 'single-dash', '-single-dash → single-dash');
});

test('AC-11: slug is printed to stdout before file creation', () => {
  const projectPath = setupProject();
  const r = runMod(['add', 'My Feature Module', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 0, `Expected exit 0. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.slug, 'my-feature-module', 'Derived slug must be in JSON output');
  // File must exist at derived slug path
  assert.ok(fs.existsSync(out.module_path), 'file must exist at derived slug path');
});

test('AC-11: empty keyword after derivation returns INVALID_SLUG', () => {
  const projectPath = setupProject();
  // A keyword of only special chars should produce empty slug
  const r = runMod(['add', '!!!', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1 for invalid slug. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'INVALID_SLUG');
});

test('AC-11: path traversal slug rejected with INVALID_SLUG', () => {
  const projectPath = setupProject();
  // ../etc or ..etc should produce INVALID_SLUG
  const r = runMod(['add', '../etc/passwd', `--soma-home=${SOMA_REPO}`, `--project=${projectPath}`, '--json']);
  assert.equal(r.status, 1, `Expected exit 1 for path traversal slug. stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(['INVALID_SLUG', 'RESERVED_SLUG'].includes(out.error.code), `Expected INVALID_SLUG or RESERVED_SLUG, got ${out.error.code}`);
});
