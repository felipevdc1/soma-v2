/**
 * phase008-regression.test.cjs — T-18
 * Bridge wrapper: validates cumulative test preservation post-Sprint-008.
 * Phase 4c bridge wrapper pattern — Node v22 nested test compatibility.
 *
 * @spec AC-14
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = process.env.SOMA_HOME || path.join(os.homedir(), '.soma-v2');
const SCRATCH_REPO = path.resolve(__dirname, '../..');

// ---- Shasum verification ----

const CANONICAL_FILES = [
  path.join(os.homedir(), '.codex', 'AGENTS.md'),
  path.join(os.homedir(), 'AGENTS.md'),
  path.join(os.homedir(), '.claude', 'constitution.md'),
];

const LIB_FILES = [
  path.join(SOMA_HOME, 'scripts', 'lib', 'anchored-blocks.cjs'),
  path.join(SOMA_HOME, 'scripts', 'lib', 'manifest.cjs'),
  path.join(SOMA_HOME, 'scripts', 'lib', 'template-engine.cjs'),
];

test('Regression: canonical+lib files match baseline shasums (shasum-locked)', () => {
  const baselineFile = '/tmp/phase008-shasum-before.txt';
  if (!fs.existsSync(baselineFile)) {
    // Skip gracefully if baseline not captured
    return;
  }
  const baselineContent = fs.readFileSync(baselineFile, 'utf8').trim();
  const baselineMap = new Map();
  for (const line of baselineContent.split('\n')) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length === 2) {
      baselineMap.set(parts[1], parts[0]);
    }
  }
  const filesToCheck = [...CANONICAL_FILES, ...LIB_FILES];
  for (const filePath of filesToCheck) {
    if (!fs.existsSync(filePath)) continue;
    if (!baselineMap.has(filePath)) continue;
    const content = fs.readFileSync(filePath);
    const actualSha = crypto.createHash('sha256').update(content).digest('hex');
    const expectedSha = baselineMap.get(filePath);
    assert.equal(actualSha, expectedSha,
      `SHASUM MISMATCH: ${filePath}\nExpected: ${expectedSha}\nActual: ${actualSha}`
    );
  }
});

test('Regression: locked lib files in scratch repo not modified', () => {
  const lockedLibs = [
    'scripts/lib/anchored-blocks.cjs',
    'scripts/lib/manifest.cjs',
    'scripts/lib/template-engine.cjs',
    'scripts/lib/module-store.cjs',
  ];
  for (const relPath of lockedLibs) {
    const scratchPath = path.join(SCRATCH_REPO, relPath);
    const somaPath = path.join(SOMA_HOME, relPath);
    if (!fs.existsSync(scratchPath) || !fs.existsSync(somaPath)) continue;
    const scratchSha = crypto.createHash('sha256').update(fs.readFileSync(scratchPath)).digest('hex');
    const somaSha = crypto.createHash('sha256').update(fs.readFileSync(somaPath)).digest('hex');
    assert.equal(scratchSha, somaSha,
      `Locked lib file modified in scratch: ${relPath}. These must not be modified.`
    );
  }
});

test('Regression: bootstrap.cjs exists after Sprint-008 implementation', () => {
  const bootstrapPath = path.join(SOMA_HOME, 'scripts', 'bootstrap.cjs');
  assert.ok(
    fs.existsSync(bootstrapPath),
    `bootstrap.cjs not found at ${bootstrapPath}`
  );
});

test('Regression: doctor.cjs drift-check mode still works (not affected by bootstrap)', () => {
  const result = spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
    env: { ...process.env, SOMA_HOME: SOMA_HOME },
    timeout: 15000,
  });
  assert.notEqual(result.status, 2, `Doctor drift-check mode crashed. stderr: ${result.stderr}`);
  let out;
  try {
    out = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`Doctor output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }
  assert.equal(out.tool, 'doctor');
});

test('Regression: doctor.cjs --foundation-check still works', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-reg-'));
  const somaDir = path.join(dir, '.soma');
  fs.mkdirSync(path.join(somaDir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(somaDir, 'project.md'), [
    '---', 'schema: soma-project/v1', 'name: "reg-project"', 'status: active',
    '---', '# Regression Project',
  ].join('\n'), 'utf8');
  const result = spawnSync('node', ['scripts/doctor.cjs', '--foundation-check', '--json', '--project', dir], {
    cwd: SCRATCH_REPO,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notEqual(result.status, 2, `--foundation-check flag not recognized. stderr: ${result.stderr}`);
  let out;
  try {
    out = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`Foundation check output is not valid JSON: ${result.stdout.slice(0, 200)}`);
  }
  assert.equal(out.schema, 'soma-foundation-check/v1');
});

test('Regression: doctor.cjs exports scanContextRouting (AD-02 programmatic API)', () => {
  // doctor.cjs was extended per AD-02 to export scanContextRouting for in-process bootstrap delegation.
  // This test verifies the export is present and callable.
  const doctorPath = path.join(SOMA_HOME, 'scripts', 'doctor.cjs');
  if (!fs.existsSync(doctorPath)) return;
  const doctor = require(doctorPath);
  assert.equal(typeof doctor.scanContextRouting, 'function',
    'doctor.cjs must export scanContextRouting() for bootstrap AD-02 in-process delegation'
  );
});
