'use strict';
// @spec AC-06
// Integration tests for init.cjs --dry-run flag.
// Verifies: zero side effects, correct output schema, exit codes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const INIT = path.join(SOMA_HOME, 'scripts', 'init.cjs');

function mkFixture(prefix = 'soma-init-test') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runInit(args = []) {
  return spawnSync('node', [INIT, ...args], {
    encoding: 'utf8',
    timeout: 15000
  });
}

function computeFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ---- AC-06: --dry-run greenfield (zero side effects) ----

test('dry-run: exit code 0 on greenfield', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
});

test('dry-run: JSON mode is "dry-run" for greenfield', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.mode, 'dry-run');
});

test('dry-run: summary.files_planned = 5 for greenfield (no --with-agents-md)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const parsed = JSON.parse(result.stdout);

  // 4 template files + manifest.json = 5
  assert.equal(parsed.summary.files_planned, 5);
  assert.ok(Array.isArray(parsed.files_planned), 'files_planned must be array');
  assert.equal(parsed.files_planned.length, 5);
});

test('dry-run: summary.files_planned = 6 with --with-agents-md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--with-agents-md', '--json']);
  const parsed = JSON.parse(result.stdout);

  // 4 template + manifest.json + AGENTS.md = 6
  assert.equal(parsed.summary.files_planned, 6);
  assert.equal(parsed.files_planned.length, 6);
  assert.equal(parsed.summary.agents_md_managed, true);
});

test('dry-run: .soma/ directory NOT created after dry-run', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const before = fs.readdirSync(target);
  runInit([target, '--dry-run']);
  const after = fs.readdirSync(target);

  assert.deepEqual(before, after, '.soma/ must NOT be created after --dry-run');
  assert.ok(!fs.existsSync(path.join(target, '.soma')), '.soma/ must not exist after dry-run');
});

test('dry-run: AGENTS.md NOT created after dry-run with --with-agents-md', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  runInit([target, '--dry-run', '--with-agents-md']);

  assert.ok(!fs.existsSync(path.join(target, 'AGENTS.md')), 'AGENTS.md must NOT be created after --dry-run');
});

// ---- AC-06: --dry-run with pre-existing files (shasum check) ----

test('dry-run: existing files unchanged after dry-run (shasum check)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Put some pre-existing files in target
  const existingFile1 = path.join(target, 'existing.txt');
  const existingFile2 = path.join(target, 'README.md');
  fs.writeFileSync(existingFile1, 'do not touch');
  fs.writeFileSync(existingFile2, '# README\n\nDo not modify.');

  const sha1Before = computeFileSha256(existingFile1);
  const sha2Before = computeFileSha256(existingFile2);

  runInit([target, '--dry-run', '--with-agents-md']);

  const sha1After = computeFileSha256(existingFile1);
  const sha2After = computeFileSha256(existingFile2);

  assert.equal(sha1Before, sha1After, 'existing.txt must not be modified after dry-run');
  assert.equal(sha2Before, sha2After, 'README.md must not be modified after dry-run');
});

// ---- AC-06: --dry-run on already-initialized (existing .soma/) ----

test('dry-run: exit code 1 when .soma/ exists (redirect, even in dry-run)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // First: real init
  runInit([target]);
  assert.ok(fs.existsSync(path.join(target, '.soma')));

  // Then: dry-run on already-initialized → redirect (exit 1)
  const result = runInit([target, '--dry-run', '--json']);
  assert.equal(result.status, 1, `Expected exit 1 (redirect), got ${result.status}`);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, 'redirect');
  assert.equal(parsed.error, 'ALREADY_INITIALIZED');
});

test('dry-run: zero modification to .soma/ content on redirect dry-run', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Real init first
  runInit([target]);

  // Capture shasums of created files
  const projectMdPath = path.join(target, '.soma', 'project.md');
  const shaBefore = computeFileSha256(projectMdPath);

  // Dry-run (which redirects)
  runInit([target, '--dry-run']);

  const shaAfter = computeFileSha256(projectMdPath);
  assert.equal(shaBefore, shaAfter, 'project.md must not be modified during redirect dry-run');
});

// ---- jq validation ----

test('dry-run: JSON output is valid JSON (jq empty)', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const jqResult = spawnSync('jq', ['empty'], { input: result.stdout, encoding: 'utf8' });
  assert.equal(jqResult.status, 0, `jq empty failed: ${jqResult.stderr}`);
});

test('dry-run: files_planned paths point to expected .soma/ locations', (t) => {
  const target = mkFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit([target, '--dry-run', '--json']);
  const parsed = JSON.parse(result.stdout);

  const expectedSuffixes = [
    '.soma/project.md',
    '.soma/CONTEXT.md',
    '.soma/modules/index.md',
    '.soma/installed-state.json',
    '.soma/manifest.json'
  ];
  for (const suffix of expectedSuffixes) {
    assert.ok(
      parsed.files_planned.some(f => f.endsWith(suffix)),
      `Expected file ending with ${suffix} in files_planned: ${JSON.stringify(parsed.files_planned)}`
    );
  }
});

// ---- AC-06: --existing --dry-run purity (zero filesystem mutations) ----

function mkExistingFixture(prefix = 'soma-init-existing-dr') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  // Create minimal structure so module detection finds something (H2 heuristic)
  fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'api', 'index.ts'), '// stub\n');
  fs.writeFileSync(path.join(dir, 'src', 'ui', 'App.tsx'), '// stub\n');
  return dir;
}

test('dry-run: --existing exits 0 on uninitialized project', (t) => {
  const target = mkExistingFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit(['--existing', target, '--dry-run', '--json']);
  assert.equal(result.status, 0,
    `Expected exit 0 for --existing --dry-run on uninitialized project, got ${result.status}. stderr: ${result.stderr}`
  );
});

test('dry-run: --existing creates ZERO files (no .soma/ after dry-run)', (t) => {
  const target = mkExistingFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const entriesBefore = fs.readdirSync(target).sort();
  runInit(['--existing', target, '--dry-run']);
  const entriesAfter = fs.readdirSync(target).sort();

  assert.deepEqual(entriesBefore, entriesAfter,
    `--existing --dry-run must not create any top-level entries. Before: ${JSON.stringify(entriesBefore)}, After: ${JSON.stringify(entriesAfter)}`
  );
  assert.ok(!fs.existsSync(path.join(target, '.soma')),
    '.soma/ directory must NOT exist after --existing --dry-run'
  );
});

test('dry-run: --existing existing files unchanged after dry-run (shasum check)', (t) => {
  const target = mkExistingFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  // Capture shasums of all pre-existing files
  const apiIndex = path.join(target, 'src', 'api', 'index.ts');
  const uiApp = path.join(target, 'src', 'ui', 'App.tsx');
  const sha1Before = computeFileSha256(apiIndex);
  const sha2Before = computeFileSha256(uiApp);

  runInit(['--existing', target, '--dry-run']);

  const sha1After = computeFileSha256(apiIndex);
  const sha2After = computeFileSha256(uiApp);

  assert.equal(sha1Before, sha1After, 'src/api/index.ts must not be modified after --existing --dry-run');
  assert.equal(sha2Before, sha2After, 'src/ui/App.tsx must not be modified after --existing --dry-run');
});

test('dry-run: --existing JSON mode reports action:dry-run with planned files list', (t) => {
  const target = mkExistingFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = runInit(['--existing', target, '--dry-run', '--json']);
  assert.equal(result.status, 0, `exit 0 required. stderr: ${result.stderr}`);

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(`Output must be valid JSON. stdout: ${result.stdout}`);
  }

  assert.equal(parsed.mode, 'dry-run',
    `JSON mode must be "dry-run" for --existing --dry-run. Got: ${parsed.mode}`
  );
  assert.ok(Array.isArray(parsed.files_planned),
    'files_planned must be an array'
  );
  assert.ok(parsed.files_planned.length > 0,
    'files_planned must list at least one planned file'
  );
  assert.ok(typeof parsed.modules !== 'undefined',
    'modules field should be present (module detection summary)'
  );
});

test('dry-run: --existing --deep also pure-read (zero mutations)', (t) => {
  const target = mkExistingFixture();
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const entriesBefore = fs.readdirSync(target).sort();
  runInit(['--existing', target, '--deep', '--dry-run']);
  const entriesAfter = fs.readdirSync(target).sort();

  assert.deepEqual(entriesBefore, entriesAfter,
    `--existing --deep --dry-run must not create any entries. Before: ${JSON.stringify(entriesBefore)}, After: ${JSON.stringify(entriesAfter)}`
  );
  assert.ok(!fs.existsSync(path.join(target, '.soma')),
    '.soma/ must NOT exist after --existing --deep --dry-run'
  );
});
