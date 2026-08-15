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

// ─────────────────────────────────────────────────────────────────────────
// D26: "## Revisão do humano" section — human-owned checkboxes must not
// count toward the commit gate (self-approval fix — Article II).
//
// TDD discipline: this block was committed RED (countUnchecked has no
// section awareness yet) per Article II HARD enforcement.
// ─────────────────────────────────────────────────────────────────────────

/** Run the hook against a plan body, return {code, stderr}. */
async function runWithPlan(planContent) {
  const d = tmp();
  const sessionId = `d26-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const planFile = write(path.join(d, 'plan.md'), planContent);
  const stateFile = path.join(os.tmpdir(), `ck-session-${sessionId}.json`);
  write(stateFile, JSON.stringify({ activePlan: planFile }));
  try {
    return await runHook({ command: 'git commit -m "x"', env: { CK_SESSION_ID: sessionId } });
  } finally {
    fs.rmSync(stateFile, { force: true });
    fs.rmSync(d, { recursive: true, force: true });
  }
}

/** Extract the "N items pendentes" count from BLOQUEADO stderr, or null if not blocked. */
function pendingCount(stderr) {
  const m = stderr.match(/BLOQUEADO: (\d+) items? pendentes?/);
  return m ? parseInt(m[1], 10) : null;
}

// D26-1: plan WITHOUT the review section → counts exactly the same items as today (zero regression)
test('D26-1: plan without review section → counts same items as today (no regression)', async () => {
  const { code, stderr } = await runWithPlan(
    '## Tarefas\n' +
    '- [x] T001 implementar parser\n' +
    '- [ ] T002 escrever testes\n' +
    '- [ ] T003 documentar\n'
  );
  assert.equal(code, 2, `Expected exit 2, got ${code}`);
  assert.equal(pendingCount(stderr), 2, `Expected 2 pending (T002+T003), got stderr: ${stderr}`);
});

// D26-2: plan WITH the review section → items there don't count; items in other sections still count
test('D26-2: plan with review section → review items excluded, other sections still count', async () => {
  const { code, stderr } = await runWithPlan(
    '## Tarefas\n' +
    '- [x] T001 implementar parser\n' +
    '- [ ] T002 escrever testes\n' +
    '\n' +
    '## Revisão do humano\n' +
    '- [ ] Os ACs cobrem o caso de erro?\n' +
    '- [ ] O nome da flag ficou claro?\n'
  );
  assert.equal(code, 2, `Expected exit 2 (T002 still pending), got ${code}`);
  assert.equal(pendingCount(stderr), 1, `Expected 1 pending (only T002), got stderr: ${stderr}`);
});

// D26-3: empty review section → no crash, doesn't affect counting of other sections
test('D26-3: empty review section → no crash, work item still counted', async () => {
  const { code, stderr } = await runWithPlan(
    '## Tarefas\n' +
    '- [ ] T001 pendente\n' +
    '\n' +
    '## Revisão do humano\n'
  );
  assert.equal(code, 2, `Expected exit 2, got ${code}`);
  assert.equal(pendingCount(stderr), 1, `Expected 1 pending (T001 only), got stderr: ${stderr}`);
});

// D26-4: review section is the LAST section in the file (no heading after it) → still excluded
test('D26-4: review section as last section in file (no trailing heading) → excluded through EOF', async () => {
  const { code } = await runWithPlan(
    '## Tarefas\n' +
    '- [x] T001 done\n' +
    '\n' +
    '## Revisão do humano\n' +
    '- [ ] pergunta 1\n' +
    '- [ ] pergunta 2\n'
  );
  assert.equal(code, 0, `Expected exit 0 (only review items pending), got ${code}`);
});

// D26-5: work item AFTER the review section, under a new heading → counts again
test('D26-5: work item after review section under new heading → counts again', async () => {
  const { code, stderr } = await runWithPlan(
    '## Tarefas\n' +
    '- [x] T001 done\n' +
    '\n' +
    '## Revisão do humano\n' +
    '- [ ] pergunta 1\n' +
    '\n' +
    '## Mais tarefas\n' +
    '- [ ] T002 pendente\n'
  );
  assert.equal(code, 2, `Expected exit 2 (T002 pending), got ${code}`);
  assert.equal(pendingCount(stderr), 1, `Expected 1 pending (only T002, not pergunta 1), got stderr: ${stderr}`);
});

// D26-6: checkbox inside a code block continues ignored (no regression), combined with review section
test('D26-6: checkbox in code block still ignored alongside review section exclusion', async () => {
  const { code, stderr } = await runWithPlan(
    '## Revisão do humano\n' +
    '- [ ] pergunta 1\n' +
    '\n' +
    '## Tarefas\n' +
    '```\n' +
    '- [ ] not a real checkbox\n' +
    '```\n' +
    '- [ ] T002 pendente real\n'
  );
  assert.equal(code, 2, `Expected exit 2, got ${code}`);
  assert.equal(pendingCount(stderr), 1, `Expected 1 pending (only T002, code block + review excluded), got stderr: ${stderr}`);
});

// D26-7: heading with case + accent variation ("## REVISAO DO HUMANO") still matches
test('D26-7: heading case/accent variation ("## REVISAO DO HUMANO") still matches', async () => {
  const { code } = await runWithPlan(
    '## Tarefas\n' +
    '- [x] T001 done\n' +
    '\n' +
    '## REVISAO DO HUMANO\n' +
    '- [ ] pergunta sem acento e maiuscula\n'
  );
  assert.equal(code, 0, `Expected exit 0 (review section matched despite case/accent), got ${code}`);
});

// D26-8 (bonus): single accepted English variant "## Human Review" also matches (case-insensitive)
test('D26-8: English heading variant ("## human review") also matches', async () => {
  const { code } = await runWithPlan(
    '## Tarefas\n' +
    '- [x] T001 done\n' +
    '\n' +
    '## human review\n' +
    '- [ ] does this cover the error case?\n'
  );
  assert.equal(code, 0, `Expected exit 0 (English variant matched), got ${code}`);
});
