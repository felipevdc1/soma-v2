'use strict';
// @spec AC-05
// Smoke test: doctor + sync --dry-run against real ~/.soma-v2 don't break hooks 48/48

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SOMA_HOME = path.join(os.homedir(), '.soma-v2');
const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');

function sha256file(filepath) {
  try {
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

const CANONICAL_SOURCES = [
  path.join(os.homedir(), '.codex', 'AGENTS.md'),
  path.join(os.homedir(), 'AGENTS.md'),
  path.join(os.homedir(), '.claude', 'constitution.md'),
  path.join(os.homedir(), '.claude', 'CLAUDE.md')
].filter(p => fs.existsSync(p));

function captureCanonicalShas() {
  const result = {};
  for (const p of CANONICAL_SOURCES) {
    result[p] = sha256file(p);
  }
  return result;
}

/**
 * Run hooks tests using a wrapper script approach to avoid "node:test recursive" detection.
 * Node.js v22 detects when `node --test` is called from within a test file and blocks it.
 * Workaround: use a standalone runner script that requires the test runner programmatically.
 */
function runHooksTests() {
  spawnSync('bash', ['-c', 'rm -f /tmp/soma-state-trap* 2>/dev/null'], { encoding: 'utf8' });

  const hookTestFiles = getHooksTestFiles();
  if (hookTestFiles.length === 0) {
    return { tests: 0, pass: 0, fail: 0, raw: '' };
  }

  // Write a temporary wrapper script that runs the hooks tests
  // This bypasses the node:test recursive detection since it's a fresh node process
  // called via 'node wrapper.cjs' (no --test flag on the process itself)
  const wrapperPath = path.join(os.tmpdir(), `soma-hooks-runner-${Date.now()}.cjs`);
  const outFile = path.join(os.tmpdir(), `soma-hooks-out-${Date.now()}.txt`);

  // The wrapper calls 'node --test' via spawnSync, then writes output to the outFile.
  // Because the wrapper is invoked as 'node wrapper.cjs' (no --test flag on the process),
  // it is NOT a test runner context, so it can spawn 'node --test' without triggering
  // Node.js v22 recursive test detection (which checks NODE_TEST_CONTEXT env var).
  const wrapperCode = `
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const files = ${JSON.stringify(hookTestFiles)};
const outFile = ${JSON.stringify(outFile)};

const result = spawnSync(process.execPath, ['--test', ...files], {
  encoding: 'utf8',
  timeout: 60000,
  env: { ...process.env, FORCE_COLOR: '0', NODE_TEST_CONTEXT: undefined }
});

const output = (result.stdout || '') + (result.stderr || '');
fs.writeFileSync(outFile, output);
process.exit(result.status || 0);
`;

  fs.writeFileSync(wrapperPath, wrapperCode);

  try {
    spawnSync(process.execPath, [wrapperPath], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (!fs.existsSync(outFile)) {
      return { tests: null, pass: null, fail: null, raw: '' };
    }

    const raw = fs.readFileSync(outFile, 'utf8');
    const testsMatch = raw.match(/# tests (\d+)/);
    const passMatch = raw.match(/# pass (\d+)/);
    const failMatch = raw.match(/# fail (\d+)/);

    return {
      tests: testsMatch ? parseInt(testsMatch[1]) : null,
      pass: passMatch ? parseInt(passMatch[1]) : null,
      fail: failMatch ? parseInt(failMatch[1]) : null,
      raw
    };
  } finally {
    try { fs.unlinkSync(wrapperPath); } catch (e) { /* cleanup */ }
    try { fs.unlinkSync(outFile); } catch (e) { /* cleanup */ }
  }
}

function getHooksTestFiles() {
  const files = [];
  try {
    for (const f of fs.readdirSync(HOOKS_DIR)) {
      if (f.endsWith('.test.cjs')) files.push(path.join(HOOKS_DIR, f));
    }
  } catch (err) { /* ignore */ }
  const libTestDir = path.join(HOOKS_DIR, 'lib', '__tests__');
  try {
    for (const f of fs.readdirSync(libTestDir)) {
      if (f.endsWith('.test.cjs')) files.push(path.join(libTestDir, f));
    }
  } catch (err) { /* ignore */ }
  return files;
}

// ---- Tests ----

test('hooks-regression: hooks baseline has zero failures before running doctor/sync', () => {
  const { tests, pass, fail, raw } = runHooksTests();

  assert.equal(fail, 0,
    `Expected 0 hook failures, got pass=${pass} tests=${tests} fail=${fail}\nOutput snippet: ${raw.slice(-200)}`);
  assert.ok(pass >= 48, `Expected hooks baseline ≥48, got pass=${pass}`);
});

test('hooks-regression: doctor against real ~/.soma-v2 does not modify canonical sources', () => {
  const preShas = captureCanonicalShas();

  spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  for (const [filepath, preSha] of Object.entries(preShas)) {
    const postSha = sha256file(filepath);
    assert.equal(postSha, preSha,
      `Canonical source modified by doctor against real ~/.soma-v2: ${filepath}`);
  }
});

test('hooks-regression: sync --dry-run against real ~/.soma-v2 does not modify canonical sources', () => {
  const preShas = captureCanonicalShas();

  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json'], {
    cwd: SOMA_HOME,
    encoding: 'utf8',
    timeout: 15000
  });

  for (const [filepath, preSha] of Object.entries(preShas)) {
    const postSha = sha256file(filepath);
    assert.equal(postSha, preSha,
      `Canonical source modified by sync --dry-run against real ~/.soma-v2: ${filepath}`);
  }
});

test('hooks-regression: after doctor + sync, hooks still pass with zero failures', () => {
  // Run doctor + sync against real ~/.soma-v2 (read-only, safe)
  spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });
  spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });

  // Re-run hooks tests
  const { tests, pass, fail, raw } = runHooksTests();

  assert.equal(fail, 0,
    `Expected 0 hook failures after doctor+sync, got pass=${pass} tests=${tests} fail=${fail}\nOutput: ${raw.slice(-300)}`);
  assert.ok(pass >= 48,
    `Expected ≥48 hook passes after doctor+sync, got ${pass}`);
});

test('hooks-regression: doctor output is valid JSON (AC-06 real state)', () => {
  const result = spawnSync('node', ['scripts/doctor.cjs', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });

  const jqResult = spawnSync('jq', ['empty'], {
    input: result.stdout, encoding: 'utf8'
  });
  assert.equal(jqResult.status, 0,
    `doctor --json output is not valid JSON. jq error: ${jqResult.stderr}`);
});

test('hooks-regression: sync --dry-run output is valid JSON (AC-06 real state)', () => {
  const result = spawnSync('node', ['scripts/sync.cjs', '--dry-run', '--json'], {
    cwd: SOMA_HOME, encoding: 'utf8', timeout: 15000
  });

  const jqResult = spawnSync('jq', ['empty'], {
    input: result.stdout, encoding: 'utf8'
  });
  assert.equal(jqResult.status, 0,
    `sync --dry-run --json output is not valid JSON. jq error: ${jqResult.stderr}`);
});
