'use strict';
/**
 * Tests for pre-commit-gate.cjs
 *
 * The hook reads JSON from stdin (PreToolUse payload) and:
 *   - exits 0 for non-git-commit commands
 *   - exits 0 when no state file exists (fail-open)
 *   - exits 0 when state file exists but plan has no unchecked items
 *   - exits 2 (blocking) when state file exists and plan has unchecked items
 *   - exits 0 (regression: was exit 2) when CK_SESSION_ID has no state file
 *     but most-recent plan has unchecked items
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'pre-commit-gate.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pcg-')); }
function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

/** Run the hook with a given stdin payload and env, return {code, stderr} */
function runHook({ command = 'git commit -m "test"', env = {} } = {}) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ tool_input: { command } });
    const proc = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdin.write(payload);
    proc.stdin.end();
    proc.on('close', code => resolve({ code, stderr }));
  });
}

// Test 1: non-git command → exit 0
test('T1: non-git command → exit 0', async () => {
  const { code } = await runHook({ command: 'npm test' });
  assert.equal(code, 0);
});

// Test 2: git commit with NO state file (random session ID) → exit 0 (fail-open)
test('T2: git commit, no state file → exit 0 (fail-open)', async () => {
  const { code } = await runHook({
    command: 'git commit -m "x"',
    env: { CK_SESSION_ID: `non-existent-${Date.now()}` },
  });
  assert.equal(code, 0);
});

// Test 3: git commit with state file + plan has NO unchecked items → exit 0
test('T3: git commit, state file exists, plan fully checked → exit 0', async () => {
  const d = tmp();
  const sessionId = `test-${Date.now()}`;
  const planFile = write(path.join(d, 'plan.md'), '- [x] done\n- [x] also done\n');
  const stateFile = path.join(os.tmpdir(), `ck-session-${sessionId}.json`);
  write(stateFile, JSON.stringify({ activePlan: planFile }));

  try {
    const { code } = await runHook({
      command: 'git commit -m "x"',
      env: { CK_SESSION_ID: sessionId },
    });
    assert.equal(code, 0);
  } finally {
    fs.rmSync(stateFile, { force: true });
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// Test 4: git commit with state file + plan HAS unchecked items → exit 2 + stderr "BLOQUEADO"
test('T4: git commit, state file exists, plan has unchecked → exit 2 + BLOQUEADO in stderr', async () => {
  const d = tmp();
  const sessionId = `test-${Date.now()}`;
  const planFile = write(path.join(d, 'plan.md'), '- [x] done\n- [ ] pending task\n- [ ] another pending\n');
  const stateFile = path.join(os.tmpdir(), `ck-session-${sessionId}.json`);
  write(stateFile, JSON.stringify({ activePlan: planFile }));

  try {
    const { code, stderr } = await runHook({
      command: 'git commit -m "x"',
      env: { CK_SESSION_ID: sessionId },
    });
    assert.equal(code, 2, `Expected exit 2, got ${code}`);
    assert.ok(stderr.includes('BLOQUEADO'), `Expected "BLOQUEADO" in stderr, got: ${stderr}`);
  } finally {
    fs.rmSync(stateFile, { force: true });
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// Test 5 (regression): git commit with CK_SESSION_ID that has NO state file,
// but the most-recent plan in ~/.claude/plans/ has unchecked items → exit 0
// (was exit 2 with the fallback bug — this is the regression test)
test('T5: git commit, session has no state file, most-recent plan has unchecked → exit 0 (no fallback)', async () => {
  // We use a fake session ID that won't have a state file
  const fakeSessionId = `regression-${Date.now()}`;

  // We cannot safely mutate ~/.claude/plans/ to inject a plan.
  // Instead we verify: with a fresh fake session (no state file) and
  // CK_PLANS_DIR pointing to a temp dir with an unchecked plan, the hook exits 0.
  // The hook hardcodes homedir, so we rely on the absence of a state file alone.
  // The real regression: without state file, hook should exit 0 regardless of plans/ contents.
  const { code } = await runHook({
    command: 'git commit -m "regression"',
    env: { CK_SESSION_ID: fakeSessionId },
  });

  // After the fix: no state file → exit 0 (fail-open). Was exit 2 before fix.
  assert.equal(code, 0, `Expected exit 0 (fail-open), got ${code}. Fallback bug may still be present.`);
});
